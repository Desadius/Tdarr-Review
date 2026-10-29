import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {createEpisodeBindingResolver} from './episode-binding.mjs';
import {createSonarrDiscoveryReader} from './sonarr-inspection.mjs';
import {mapSonarrSourcePath} from './sonarr-source-path.mjs';

const workerFile=fileURLToPath(new URL('./sonarr-reconciliation-worker.mjs',import.meta.url));
export const SONARR_RECONCILIATION_LIMITS=Object.freeze({totalMs:30000,workerMs:20000,workerOutputBytes:4*1024*1024,episodeFiles:5000,episodes:50000,diskEntries:10000,directories:256,depth:16,sonarrPasses:2,sonarrRequestMs:7000,sonarrSeriesBytes:4*1024*1024,sonarrSnapshotBytes:16*1024*1024});
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const safeStatuses=new Set(['complete','limited','changed','unsafe','inaccessible','unsupported','unavailable']);
const apiKey=value=>typeof value?.apiKey==='string'?value.apiKey:'';
const roots=value=>({sonarrRoot:value?.libraries?.tv?.sonarrRoot||'',mediaRoot:value?.libraries?.tv?.mediaRoot||''});
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const validId=value=>Number.isSafeInteger(value)&&value>0;
const emptyCounts=()=>({episodeFiles:0,episodes:0,linkedEpisodes:0,unlinkedEpisodes:0,diskEntries:0,directories:0,present:0,missing:0,localOnly:0,sidecars:0,unsafe:0,unknown:0});
const publicLimits=Object.freeze({episodeFiles:SONARR_RECONCILIATION_LIMITS.episodeFiles,episodes:SONARR_RECONCILIATION_LIMITS.episodes,diskEntries:SONARR_RECONCILIATION_LIMITS.diskEntries,directories:SONARR_RECONCILIATION_LIMITS.directories,depth:SONARR_RECONCILIATION_LIMITS.depth,operationMs:SONARR_RECONCILIATION_LIMITS.totalMs,workerMs:SONARR_RECONCILIATION_LIMITS.workerMs,responseBytes:SONARR_RECONCILIATION_LIMITS.workerOutputBytes,sonarrPasses:SONARR_RECONCILIATION_LIMITS.sonarrPasses,sonarrRequestMs:SONARR_RECONCILIATION_LIMITS.sonarrRequestMs,sonarrSeriesBytes:SONARR_RECONCILIATION_LIMITS.sonarrSeriesBytes,sonarrSnapshotBytes:SONARR_RECONCILIATION_LIMITS.sonarrSnapshotBytes});
const incomplete=(reason,revision,generation)=>({status:'incomplete',complete:false,reason,revision,generation,observedAt:Date.now(),limits:publicLimits,counts:emptyCounts(),rows:[]});
const safeLabel=value=>typeof value==='string'&&value.length>0&&value.length<=2048&&!value.startsWith('/')&&!value.includes('\\')&&!value.includes('\0')&&value.split('/').every(part=>part&&part!=='.'&&part!=='..')?value:null;
const sameSnapshot=(a,b)=>{
 const normalize=value=>({series:value.series,episodeFiles:[...value.episodeFiles].map(item=>JSON.stringify(item)).sort(),episodes:[...value.episodes].map(item=>JSON.stringify(item)).sort()});
 return same(normalize(a),normalize(b));
};
const diskSignature=value=>JSON.stringify({root:value.rootIdentity,anchors:value.anchorIdentities,entries:[...value.entries].map(entry=>[entry.relative,entry.kind,entry.fingerprint]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))||String(a[1]).localeCompare(String(b[1])))});
const episodeView=episode=>({
 id:episode.id,
 seasonNumber:Number.isSafeInteger(episode.seasonNumber)&&episode.seasonNumber>=0?episode.seasonNumber:null,
 episodeNumber:Number.isSafeInteger(episode.episodeNumber)&&episode.episodeNumber>=0?episode.episodeNumber:null,
 absoluteEpisodeNumber:Number.isSafeInteger(episode.absoluteEpisodeNumber)&&episode.absoluteEpisodeNumber>=0?episode.absoluteEpisodeNumber:null,
 sceneAbsoluteEpisodeNumber:Number.isSafeInteger(episode.sceneAbsoluteEpisodeNumber)&&episode.sceneAbsoluteEpisodeNumber>=0?episode.sceneAbsoluteEpisodeNumber:null,
 sceneSeasonNumber:Number.isSafeInteger(episode.sceneSeasonNumber)&&episode.sceneSeasonNumber>=0?episode.sceneSeasonNumber:null,
 sceneEpisodeNumber:Number.isSafeInteger(episode.sceneEpisodeNumber)&&episode.sceneEpisodeNumber>=0?episode.sceneEpisodeNumber:null,
 unverifiedSceneNumbering:typeof episode.unverifiedSceneNumbering==='boolean'?episode.unverifiedSceneNumbering:null,
 airDate:typeof episode.airDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(episode.airDate)?episode.airDate:null,
 airDateUtc:typeof episode.airDateUtc==='string'&&/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(episode.airDateUtc)&&Number.isFinite(Date.parse(episode.airDateUtc))?episode.airDateUtc:null,
});
const videoExtensions=new Set(['.mkv','.mp4','.m4v','.avi','.mov','.wmv','.webm','.ts','.m2ts']);
const sidecarExtensions=new Set(['.srt','.ass','.ssa','.sub','.idx','.nfo','.jpg','.jpeg','.png','.txt','.xml']);
const scanReason=status=>status==='limited'?'scan_limit':status==='changed'?'scan_changed':status==='unsafe'?'scan_unsafe':status==='inaccessible'?'scan_inaccessible':status==='unsupported'?'scan_unsupported':'worker_unavailable';

function appliedAuthority(current,revision){
 if(!plain(current)||current.revision!==revision)throw Object.assign(Error('settings_conflict'),{code:'settings_conflict'});
 const active=current.active,draft=current.draft;if(!plain(active)||!plain(draft))return {reason:'settings_not_applied'};
 const activeSonarr={url:active.sonarr?.url||'',apiKey:apiKey(active.sonarr)},draftSonarr={url:draft.sonarr?.url||'',apiKey:apiKey(draft.sonarr)};
 const activeRoots=roots(active),draftRoots=roots(draft);
 if(!activeSonarr.url||!activeSonarr.apiKey||!activeRoots.sonarrRoot||!activeRoots.mediaRoot)return {reason:'settings_not_applied'};
 if(!same(activeSonarr,draftSonarr)||!same(activeRoots,draftRoots))return {reason:'settings_not_applied'};
 return {revision,generation:current.generation,sonarr:activeSonarr,tv:active.libraries?.tv};
}

function localCategory(entry,expectedStems){
 const name=entry.relative.split('/').at(-1),extension=name.lastIndexOf('.')>=0?name.slice(name.lastIndexOf('.')).toLowerCase():'';
 if(/\.sample(?:\.[^.]+)?$/i.test(name))return 'possible_sample';
 if(sidecarExtensions.has(extension))return 'sidecar';
 const stem=name.slice(0,name.length-extension.length),directory=entry.relative.slice(0,Math.max(0,entry.relative.length-name.length));
 if(expectedStems.has((directory+stem).toLocaleLowerCase()))return 'possible_alternate';
 return videoExtensions.has(extension)?'media':'other';
}

/** Explicit, request-scoped selected-series reconciliation. It reads only the applied Sonarr/media roots. */
export function createSonarrReconciliation({getSnapshot,fetchFn=globalThis.fetch,spawnChild=spawn,workerPath=workerFile,now=Date.now,totalTimeoutMs=SONARR_RECONCILIATION_LIMITS.totalMs,workerTimeoutMs=SONARR_RECONCILIATION_LIMITS.workerMs}){
 let active=null,closing=false,busy=false,pendingInspection=null,closePromise=null;
 const shutdownController=new AbortController();
 function stop(record){if(!record||record.closed)return;try{record.child.kill('SIGTERM')}catch{}record.killTimer=setTimeout(()=>{if(!record.closed)try{record.child.kill('SIGKILL')}catch{}},250);record.killTimer.unref?.();}
 function runWorker(input,signal,remaining){
  if(closing||signal?.aborted)return Promise.resolve({status:'unavailable',entries:[]});
  if(active)return Promise.resolve({status:'unavailable',entries:[]});
  const payload=JSON.stringify(input);if(Buffer.byteLength(payload)>4096)return Promise.resolve({status:'limited',entries:[]});
  let child;try{child=spawnChild(process.execPath,[workerPath],{shell:false,windowsHide:true,stdio:['pipe','pipe','ignore'],env:{PATH:process.env.PATH||'',...(process.platform==='win32'&&process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{})}})}catch{return Promise.resolve({status:'unavailable',entries:[]});}
  const record={child,closed:false,killTimer:null,resolve:null,closedPromise:null,closeResolve:null};
  record.closedPromise=new Promise(resolve=>{record.closeResolve=resolve});active=record;
  return new Promise(resolve=>{
   record.resolve=resolve;let output=[],length=0,done=false,timer,forcedStatus=null;
   const finish=value=>{if(done)return;done=true;clearTimeout(timer);resolve(value);};
   const cancel=()=>{forcedStatus='unavailable';stop(record);};
   const onAbort=()=>cancel();signal?.addEventListener('abort',onAbort,{once:true});
   shutdownController.signal.addEventListener('abort',onAbort,{once:true});
   timer=setTimeout(cancel,Math.max(1,Math.min(workerTimeoutMs,remaining)));timer.unref?.();
   child.once('error',()=>{forcedStatus='unavailable';});
   child.stdin.once('error',()=>{forcedStatus='unavailable';stop(record);});
   child.stdout.on('data',chunk=>{
    if(forcedStatus)return;const bytes=Buffer.from(chunk);if(length+bytes.length>SONARR_RECONCILIATION_LIMITS.workerOutputBytes){forcedStatus='limited';stop(record);return;}length+=bytes.length;output.push(bytes);
   });
   child.once('close',code=>{
    record.closed=true;clearTimeout(record.killTimer);signal?.removeEventListener('abort',onAbort);shutdownController.signal.removeEventListener('abort',onAbort);record.closeResolve();
    if(forcedStatus)finish({status:forcedStatus,entries:[]});
    else{let parsed;try{parsed=JSON.parse(Buffer.concat(output,length).toString('utf8'));if(code!==0||!plain(parsed)||!safeStatuses.has(parsed.status)||!Array.isArray(parsed.entries)||parsed.entries.length>SONARR_RECONCILIATION_LIMITS.diskEntries+SONARR_RECONCILIATION_LIMITS.directories||Object.keys(parsed).some(key=>!['status','entries','rootIdentity','anchorIdentities'].includes(key))||parsed.status==='complete'&&(typeof parsed.rootIdentity!=='string'||!Array.isArray(parsed.anchorIdentities)||parsed.anchorIdentities.length>SONARR_RECONCILIATION_LIMITS.depth||parsed.entries.some(entry=>!plain(entry)||typeof entry.fingerprint!=='string')))throw Error();}catch{parsed={status:'unavailable',entries:[]};}finish(parsed);}
    if(active===record)active=null;
    if(record.releaseBusy)busy=false;
   });
   if(signal?.aborted){cancel();return;}
   try{child.stdin.end(JSON.stringify(input));}catch{forcedStatus='unavailable';stop(record);}
  });
 }
 async function runInspection(revision,seriesId,{signal}={}){
  if(closing)return incomplete('unavailable',revision,null);
  if(!/^[a-f0-9]{64}$/.test(revision||'')||!validId(seriesId))return incomplete('invalid_request',revision,null);
  if(active)return incomplete('busy',revision,null);
  const started=now(),deadline=started+totalTimeoutMs;
  const timeLeft=()=>Math.max(0,deadline-now());
  let authority;
  try{authority=appliedAuthority(await getSnapshot(revision),revision);}catch(error){if(error?.code==='settings_conflict')throw error;return incomplete('unavailable',revision,null);}
  if(authority.reason)return incomplete(authority.reason,revision,authority.generation??null);
  if(!authority.sonarr||!authority.tv||!authority.tv.sonarrRoot||!authority.tv.mediaRoot)return incomplete('settings_not_applied',revision,authority.generation);
  if(signal?.aborted)return incomplete('cancelled',revision,authority.generation);
  let sonarrSnapshot;
  try{
   const reader=createSonarrDiscoveryReader({connection:authority.sonarr,fetchFn,requestTimeoutMs:7000,remainingMs:timeLeft,signal});
   const series=(await reader.seriesList()).filter(value=>value.id===seriesId);
   if(series.length!==1)return incomplete('series_unavailable',revision,authority.generation);
   const data=await reader.seriesSnapshot(seriesId);
   sonarrSnapshot={series:series[0],episodeFiles:data.episodeFiles,episodes:data.episodes};
  }catch(error){return incomplete(signal?.aborted?'cancelled':error?.message==='sonarr_too_large'?'sonarr_too_large':'sonarr_unavailable',revision,authority.generation);}
  if(signal?.aborted)return incomplete('cancelled',revision,authority.generation);
  if(sonarrSnapshot.episodeFiles.length>SONARR_RECONCILIATION_LIMITS.episodeFiles||sonarrSnapshot.episodes.length>SONARR_RECONCILIATION_LIMITS.episodes)return incomplete('snapshot_limit',revision,authority.generation);
  const anchor=mapSonarrSourcePath({sonarrRoot:authority.tv.sonarrRoot,filePath:sonarrSnapshot.series.path});
  if(anchor.status!=='mapped'||!anchor.relative||anchor.relative==='.')return incomplete('series_path_unmapped',revision,authority.generation);
  const anchorDepth=anchor.relative.split('/').length;if(anchorDepth>SONARR_RECONCILIATION_LIMITS.depth)return incomplete('series_path_unmapped',revision,authority.generation);
  const resolver=createEpisodeBindingResolver({instanceKey:'sonarr-reconcile:'+randomUUID(),seriesId,episodeFiles:sonarrSnapshot.episodeFiles,episodes:sonarrSnapshot.episodes});
  const graphIntegrity=resolver.integrity();
  const expected=[],expectedPaths=new Map(),expectedStems=new Set();let linkedEpisodes=0;
  for(const file of sonarrSnapshot.episodeFiles){
   const mapped=mapSonarrSourcePath({sonarrRoot:authority.tv.sonarrRoot,filePath:file.path});
   let relative=null,status='unmapped',binding=null;
   if(mapped.status==='mapped'&&mapped.relative.startsWith(anchor.relative+'/')){
    relative=mapped.relative.slice(anchor.relative.length+1);const resolved=resolver.resolve(file.path);
    if(resolved.status==='mapped'&&resolved.binding.episodeFileId===file.id){status='mapped';binding=resolved;linkedEpisodes+=resolved.episodes.length;}
    else status=resolved.status==='ambiguous'?'ambiguous':'invalid';
    const peers=expectedPaths.get(relative)||[];peers.push(file);expectedPaths.set(relative,peers);
    const pathName=relative.split('/').at(-1),ext=path.extname(pathName),stem=pathName.slice(0,pathName.length-ext.length),dir=relative.slice(0,Math.max(0,relative.length-pathName.length));expectedStems.add((dir+stem).toLocaleLowerCase());
   }else if(mapped.status==='mapped')status='unmapped';
   expected.push({file,relative,status,binding});
  }
  if([...expectedPaths.values()].some(values=>values.length>1))for(const item of expected)if(item.relative&&expectedPaths.get(item.relative)?.length>1)item.status='ambiguous';
  if(timeLeft()<=0)return incomplete('timeout',revision,authority.generation);
  let beforeWorkerAuthority;
  try{beforeWorkerAuthority=appliedAuthority(await getSnapshot(revision),revision);}catch(error){if(error?.code==='settings_conflict')throw error;return incomplete('unavailable',revision,authority.generation);}
  if(beforeWorkerAuthority.reason)return incomplete(beforeWorkerAuthority.reason,revision,authority.generation);
  if(beforeWorkerAuthority.generation!==authority.generation||!same(beforeWorkerAuthority.sonarr,authority.sonarr)||!same(roots({libraries:{tv:beforeWorkerAuthority.tv}}),roots({libraries:{tv:authority.tv}})))return incomplete('settings_conflict',revision,authority.generation);
  const worker=await runWorker({mediaRoot:authority.tv.mediaRoot,relative:anchor.relative},signal,timeLeft());
  let afterAuthority;
  try{afterAuthority=appliedAuthority(await getSnapshot(revision),revision);}catch(error){if(error?.code==='settings_conflict')throw error;return incomplete('unavailable',revision,authority.generation);}
  if(afterAuthority.reason)return incomplete(afterAuthority.reason,revision,authority.generation);
  if(afterAuthority.generation!==authority.generation||!same(afterAuthority.sonarr,authority.sonarr)||!same(roots({libraries:{tv:afterAuthority.tv}}),roots({libraries:{tv:authority.tv}})))return incomplete('settings_conflict',revision,authority.generation);
  if(signal?.aborted)return incomplete('cancelled',revision,authority.generation);
  if(timeLeft()<=0)return incomplete('timeout',revision,authority.generation);
  if(worker.status!=='complete')return incomplete(scanReason(worker.status),revision,authority.generation);
  let afterSonarr;
  try{
   const reader=createSonarrDiscoveryReader({connection:authority.sonarr,fetchFn,requestTimeoutMs:7000,remainingMs:timeLeft,signal});
   const series=(await reader.seriesList()).filter(value=>value.id===seriesId);
   if(series.length!==1)return incomplete('series_changed',revision,authority.generation);
   const data=await reader.seriesSnapshot(seriesId);afterSonarr={series:series[0],episodeFiles:data.episodeFiles,episodes:data.episodes};
  }catch{return incomplete(signal?.aborted?'cancelled':'sonarr_unavailable',revision,authority.generation);}
  try{afterAuthority=appliedAuthority(await getSnapshot(revision),revision);}catch(error){if(error?.code==='settings_conflict')throw error;return incomplete('unavailable',revision,authority.generation);}
  if(afterAuthority.reason||afterAuthority.generation!==authority.generation||!same(afterAuthority.sonarr,authority.sonarr)||!same(roots({libraries:{tv:afterAuthority.tv}}),roots({libraries:{tv:authority.tv}})))return incomplete('settings_conflict',revision,authority.generation);
  if(signal?.aborted)return incomplete('cancelled',revision,authority.generation);
  if(!sameSnapshot(sonarrSnapshot,afterSonarr))return incomplete('snapshot_changed',revision,authority.generation);
  if(timeLeft()<=0)return incomplete('timeout',revision,authority.generation);
  const finalWorker=await runWorker({mediaRoot:authority.tv.mediaRoot,relative:anchor.relative},signal,timeLeft());
  if(signal?.aborted)return incomplete('cancelled',revision,authority.generation);
  if(timeLeft()<=0)return incomplete('timeout',revision,authority.generation);
  try{afterAuthority=appliedAuthority(await getSnapshot(revision),revision);}catch(error){if(error?.code==='settings_conflict')throw error;return incomplete('unavailable',revision,authority.generation);}
  if(afterAuthority.reason||afterAuthority.generation!==authority.generation||!same(afterAuthority.sonarr,authority.sonarr)||!same(roots({libraries:{tv:afterAuthority.tv}}),roots({libraries:{tv:authority.tv}})))return incomplete('settings_conflict',revision,authority.generation);
  if(finalWorker.status!=='complete')return incomplete(scanReason(finalWorker.status),revision,authority.generation);
  if(diskSignature(worker)!==diskSignature(finalWorker))return incomplete('scan_changed',revision,authority.generation);
  const entries=worker.entries.filter(entry=>plain(entry)&&typeof entry.relative==='string'),diskByPath=new Map(entries.filter(entry=>entry.relative).map(entry=>[entry.relative,entry]));
  const integrityFailure=graphIntegrity.status!=='valid'||expected.some(item=>item.status!=='mapped');
  const complete=worker.status==='complete'&&!integrityFailure;
  const incompleteReason=expected.some(item=>item.status==='unmapped')?'sonarr_path_unmapped':'sonarr_inconsistent';
  const rows=[];
  for(const item of expected){
   const row={kind:'episodeFile',episodeFileId:validId(item.file.id)?item.file.id:null,episodeIds:item.binding?.binding?.episodeIds||[],episodes:item.binding?.episodes?.map(episodeView)||[],relative:safeLabel(item.relative),status:'unknown'};
   if(item.status==='unmapped')row.status='unmapped';
   else if(item.status==='ambiguous')row.status='ambiguous';
   else if(item.status==='invalid')row.status='invalid';
   else if(!complete){row.status='unknown';}
   else{
    const found=diskByPath.get(item.relative);
    if(!found){
     let blocked=false,ancestor=item.relative;
     while(ancestor.includes('/')){ancestor=ancestor.slice(0,ancestor.lastIndexOf('/'));const entry=diskByPath.get(ancestor);if(entry&&entry.kind!=='directory'){blocked=true;break;}}
     row.status=blocked?'unsafe':'missing';
    }
    else if(found.kind==='file'){row.status='present';row.size=found.size;row.modifiedAt=found.modifiedAt;}
    else if(found.kind==='hardlink'||found.kind==='symlink'||found.kind==='special'||found.kind==='directory')row.status='unsafe';
    else row.status='unsafe';
   }
   rows.push(row);
  }
  const referenced=new Set(expected.flatMap(item=>item.relative?[item.relative]:[]));
  for(const entry of entries){
   if(entry.kind==='directory'){
    if(entry.relative)rows.push({kind:'directory',category:'directory',episodeFileId:null,episodeIds:[],episodes:[],relative:safeLabel(entry.relative),status:complete?'observed':'unknown'});
    continue;
   }
   if(referenced.has(entry.relative))continue;
   const localOnly=entry.kind==='file',category=entry.kind==='file'?localCategory(entry,expectedStems):entry.kind==='symlink'?'unsafe':entry.kind==='hardlink'?'hardlink':'unsupported';
   rows.push({kind:complete&&localOnly?'localOnly':'diskEntry',category,episodeFileId:null,episodeIds:[],episodes:[],relative:safeLabel(entry.relative),status:complete?(localOnly?'local_only':category==='unsafe'||category==='hardlink'||category==='unsupported'?'unsafe':'observed'):'unknown',...(entry.kind==='file'?{size:entry.size,modifiedAt:entry.modifiedAt}:{})});
  }
  const unacquiredEpisodes=sonarrSnapshot.episodes.filter(episode=>episode.episodeFileId===0||episode.episodeFileId===null).map(episodeView);
  const counts=emptyCounts();counts.episodeFiles=expected.length;counts.episodes=sonarrSnapshot.episodes.length;counts.linkedEpisodes=linkedEpisodes;counts.unlinkedEpisodes=unacquiredEpisodes.length;counts.diskEntries=entries.length;counts.directories=entries.filter(entry=>entry.kind==='directory').length;
  for(const row of rows){if(row.status==='present')counts.present++;else if(row.status==='missing')counts.missing++;else if(row.status==='local_only')counts.localOnly++;else if(row.status==='unsafe'||row.status==='hardlink')counts.unsafe++;else if(['unknown','unmapped','ambiguous','invalid'].includes(row.status))counts.unknown++;if(complete&&row.category==='sidecar')counts.sidecars++;}
  if(!complete){counts.localOnly=0;counts.missing=0;}
  const result={status:complete?'complete':'incomplete',complete,reason:complete?null:incompleteReason,revision,generation:authority.generation,observedAt:now(),limits:publicLimits,counts,rows,unacquiredEpisodes};
  if(Buffer.byteLength(JSON.stringify(result))>SONARR_RECONCILIATION_LIMITS.workerOutputBytes)return incomplete('response_limit',revision,authority.generation);
  return result;
 }
 async function inspect(revision,seriesId,options={}){
  if(busy||closing)return incomplete('busy',revision,null);busy=true;
  const signal=options.signal?AbortSignal.any([options.signal,shutdownController.signal]):shutdownController.signal;
  const task=runInspection(revision,seriesId,{...options,signal});pendingInspection=task;
  try{return await task;}
  finally{if(pendingInspection===task)pendingInspection=null;if(!active)busy=false;else active.releaseBusy=true;}
 }
 function close(){
  if(closePromise)return closePromise;closing=true;shutdownController.abort();
  closePromise=(async()=>{const record=active;if(record){stop(record);await record.closedPromise;}const work=pendingInspection;if(work)await work.catch(()=>{});})();
  return closePromise;
 }
 return {inspect,close};
}
