import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import {safeFile,hash} from './core.mjs';
import {mapReview} from './config.mjs';
import {walk} from './media-walk.mjs';
import {resolveReviewSource} from './source-mapping.mjs';
import {matchReviewJob,ReviewJobMatchError} from './job-matching.mjs';
import {mapSonarrSourcePath} from './sonarr-source-path.mjs';
import {createEpisodeBindingResolver} from './episode-binding.mjs';
import {createSonarrDiscoveryReader} from './sonarr-inspection.mjs';
import {tvMode} from './library-paths.mjs';

// Read-only discovery of TV results (#271). A result is bound only to its exact Tdarr job and exactly one Sonarr
// EpisodeFile; everything else is unbound with a fixed reason. Nothing here writes to a library, Tdarr or Sonarr,
// and nothing here can approve, reject, replace or retain a result.

/** Why a result is unbound. Fixed codes, never free text; the UI owns the wording. */
export const UNBOUND_REASONS=Object.freeze(['receipt_missing','receipt_invalid','job_missing','job_other_library','job_not_successful','job_mismatch','source_unmapped','files_changed','file_in_progress','duplicate_result','series_not_found','series_ambiguous','no_episode_file','multiple_episode_files','no_linked_episodes']);
/** Why binding could not be verified. These results are never shown as bound. */
export const UNVERIFIED_REASONS=Object.freeze(['sonarr_not_configured','sonarr_unavailable','sonarr_inconsistent']);

const SAMPLE_BYTES=1024*1024,FRESH_MS=120000,CACHE_MS=15000,SONARR_BUDGET_MS=30000;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const identity=value=>plain(value)&&Number.isSafeInteger(value.size)&&value.size>0&&Number.isSafeInteger(value.mtime)&&/^[a-f0-9]{64}$/.test(value.sample);
const within=(parent,child)=>child===parent||child.startsWith(parent+'/');
const overlap=(a,b)=>within(a,b)||within(b,a);
const safeLabel=value=>typeof value==='string'&&value.length>0&&value.length<=2048&&!value.startsWith('/')&&!/^[a-z]:/i.test(value)&&!value.includes('\\')&&!value.includes('\0')&&value.split('/').every(part=>part&&part!=='.'&&part!=='..')?value:null;

/** TV ids are derived under their own key, so they can never equal a movie id (the movie id hashes the bare path). */
export const tvItemId=reviewRelative=>hash('tv\0'+reviewRelative).slice(0,24);

async function sampleOf(file){
 const handle=await fs.open(file.path,'r');
 try{
  const stat=await handle.stat(),length=Math.min(stat.size,SAMPLE_BYTES),buffer=Buffer.alloc(length),digest=crypto.createHash('sha256');
  for(const offset of [0,Math.max(0,stat.size-length)]){let done=0;while(done<length){const {bytesRead}=await handle.read(buffer,done,length-done,offset+done);if(!bytesRead)throw Error('changed');done+=bytesRead;}digest.update(buffer);}
  return {size:stat.size,mtime:Math.round(stat.mtimeMs),sample:digest.digest('hex')};
 }finally{await handle.close();}
}
const sameRecorded=(recorded,current)=>identity(recorded)&&current.size===recorded.size&&current.mtime===recorded.mtime&&current.sample===recorded.sample;

/**
 * @param {object} options
 * @param {() => ({tv:object|null,sonarr:{url:string,apiKey:string}|null}|null)} options.getSettings Active (applied) settings, never the draft.
 * @param {() => {mediaRoot:string,reviewRoot:string,reviewPrefixes:string[]}} options.getMovieRoots
 * @param {() => object} options.getState The server state; only `state.tv` is ever written.
 * @param {() => Promise<void>} options.save
 * @param {(table:string) => Promise<object[]>} options.dbRows
 */
export function createTvDiscovery({getSettings,getMovieRoots,getState,save,dbRows,fetchFn=globalThis.fetch,requestTimeoutMs=7000,now=Date.now}){
 let cache=null,running=null;
 const configured=()=>{const settings=getSettings();return settings&&tvMode(settings.tv)==='discovery'?settings:null;};
 const signature=settings=>hash(JSON.stringify([settings.tv,settings.sonarr?.url||'',hash(settings.sonarr?.apiKey||'')]));

 /** True when a result path belongs to the TV library, so the movie scan leaves it alone. Off mode owns nothing. */
 function ownsResult(reviewRelative){
  const settings=configured();if(!settings)return false;
  const first=String(reviewRelative).split('/')[0],movie=getMovieRoots();
  return settings.tv.reviewPrefixes.includes(first)&&!movie.reviewPrefixes.includes(first);
 }

 function misconfigured(tv){
  const movie=getMovieRoots();
  if(overlap(tv.mediaRoot,movie.mediaRoot)||overlap(tv.mediaRoot,movie.reviewRoot)||overlap(tv.reviewRoot,movie.mediaRoot))return true;
  if(tv.reviewRoot===movie.reviewRoot)return !tv.reviewPrefixes.length||tv.reviewPrefixes.some(prefix=>movie.reviewPrefixes.includes(prefix));
  return overlap(tv.reviewRoot,movie.reviewRoot);
 }

 // The file-side checks of one result: receipt, files, receipt identity and the exact Tdarr job. No Sonarr here.
 async function inspectResult(tv,jobs,reviewRelative,stored){
  const id=tvItemId(reviewRelative),item={id,reviewRelative,state:'unbound',reason:null};
  const unbound=reason=>{item.state='unbound';item.reason=reason;return {item};};
  const outputRelative=mapReview(reviewRelative,tv.reviewPrefixes);
  if(!outputRelative)return null;
  let mapping;
  try{mapping=await resolveReviewSource(tv.mediaRoot,tv.reviewRoot,outputRelative,reviewRelative);}
  catch(error){return unbound(error?.code==='ENOENT'?'source_unmapped':'receipt_invalid');}
  const receipt=mapping.receipt;
  if(receipt===null)return unbound('receipt_missing');
  if(!plain(receipt)||receipt.version!==1||typeof receipt.jobId!=='string'||!receipt.jobId||receipt.jobId!==receipt.jobId.trim()||receipt.jobId.length>512||!identity(receipt.source)||!identity(receipt.output))return unbound('receipt_invalid');
  item.relative=mapping.relative;item.jobId=receipt.jobId;
  let original,result;
  try{original=await safeFile(tv.mediaRoot,mapping.relative);}catch{return unbound('source_unmapped');}
  try{result=await safeFile(tv.reviewRoot,reviewRelative);}catch{return unbound('files_changed');}
  Object.assign(item,{originalBytes:original.stat.size,reviewBytes:result.stat.size});
  const snapshot=hash(original.fp+'|'+result.fp);
  if(result.stat.mtimeMs>now()-FRESH_MS)return unbound('file_in_progress');
  // The receipt recorded both files when Tdarr finished; any later change makes the result unbound.
  if(receipt.source.size!==original.stat.size||receipt.source.mtime!==Math.round(original.stat.mtimeMs)||receipt.output.size!==result.stat.size||receipt.output.mtime!==Math.round(result.stat.mtimeMs))return unbound('files_changed');
  let verified=stored?.snapshot===snapshot&&stored.receiptIdentity===true;
  if(!verified){
   try{
    const [a,b]=[await sampleOf(original),await sampleOf(result)];
    if(!sameRecorded(receipt.source,a)||!sameRecorded(receipt.output,b))return unbound('files_changed');
    const [a2,b2]=[await safeFile(tv.mediaRoot,mapping.relative),await safeFile(tv.reviewRoot,reviewRelative)];
    if(a2.fp!==original.fp||b2.fp!==result.fp)return unbound('files_changed');
   }catch{return unbound('files_changed');}
   verified=true;
  }
  // The exact job: found by the receipt's id, in the TV library, successful, mapped through the TV source roots.
  const job=jobs.find(entry=>entry&&entry._id===receipt.jobId);
  if(!job)return unbound('job_missing');
  if(job.DB!==tv.libraryId)return unbound('job_other_library');
  if(job.status!=='Transcode success')return unbound('job_not_successful');
  const normalize=value=>String(value||'').replaceAll('\\','/');
  if(!tv.sourceRoots.some(root=>normalize(root).replace(/\/+$/,'')+'/'+mapping.relative===normalize(job.file)))return unbound('source_unmapped');
  try{matchReviewJob(jobs,{receipt,libraryId:tv.libraryId,sourceRoots:tv.sourceRoots,relative:mapping.relative,sourceBytes:original.stat.size,outputBytes:result.stat.size});}
  catch(error){return unbound(error instanceof ReviewJobMatchError&&['INVALID_RECEIPT','INVALID_JOB_ID'].includes(error.code)?'receipt_invalid':'job_mismatch');}
  return {item,candidate:{id,reviewRelative,relative:mapping.relative,jobId:receipt.jobId,stored:{reviewRelative,relative:mapping.relative,snapshot,receiptIdentity:true,jobId:receipt.jobId}}};
 }

 // Sonarr stage for the results that passed the file-side checks. Reads only the series they belong to.
 async function bindWithSonarr(tv,sonarrConfig,candidates,items,observedAt){
  const info={status:'not_needed',observedAt:null,series:0};
  if(!candidates.length)return info;
  const unverify=(reason,list=candidates)=>{for(const candidate of list){const item=items.get(candidate.id);item.state='unverified';item.reason=reason;}};
  if(!sonarrConfig||typeof sonarrConfig.url!=='string'||!sonarrConfig.url||typeof sonarrConfig.apiKey!=='string'||!sonarrConfig.apiKey.trim()){unverify('sonarr_not_configured');info.status='not_configured';return info;}
  let reader;try{reader=createSonarrDiscoveryReader({connection:sonarrConfig,fetchFn,requestTimeoutMs});}catch{unverify('sonarr_unavailable');info.status='unavailable';return info;}
  const failure=error=>error?.message==='sonarr_inconsistent'?'sonarr_inconsistent':'sonarr_unavailable';
  let seriesList;
  try{seriesList=await reader.seriesList();}catch(error){const reason=failure(error);unverify(reason);info.status=reason==='sonarr_inconsistent'?'inconsistent':'unavailable';return info;}
  // The series folder is Sonarr's own path for the series, mapped exactly like an EpisodeFile path; names are never parsed.
  const folders=[];
  for(const series of seriesList){const mapped=mapSonarrSourcePath({sonarrRoot:tv.sonarrRoot,filePath:series.path});if(mapped.status==='mapped')folders.push({series,folder:mapped.relative});}
  const involved=new Map();
  for(const candidate of candidates){
   const matches=folders.filter(({folder})=>candidate.relative.startsWith(folder+'/'));
   const item=items.get(candidate.id);
   if(matches.length===0){item.state='unbound';item.reason='series_not_found';continue;}
   if(matches.length>1){item.state='unbound';item.reason='series_ambiguous';continue;}
   const series=matches[0].series;
   if(!involved.has(series.id))involved.set(series.id,{series,candidates:[]});
   involved.get(series.id).candidates.push(candidate);
  }
  info.series=involved.size;info.requestedSeries=[...involved.keys()];
  const started=now();let sawFailure=null;
  for(const {series,candidates:list} of involved.values()){
   let snapshot;
   try{
    if(now()-started>SONARR_BUDGET_MS)throw Error('sonarr_unavailable');
    snapshot=await reader.seriesSnapshot(series.id);
   }catch(error){const reason=failure(error);sawFailure??=reason;unverify(reason,list);continue;}
   const resolver=createEpisodeBindingResolver({instanceKey:'tv-discovery:'+crypto.randomUUID(),seriesId:series.id,episodeFiles:snapshot.episodeFiles,episodes:snapshot.episodes});
   const byRelative=new Map();
   for(const file of snapshot.episodeFiles){
    const mapped=mapSonarrSourcePath({sonarrRoot:tv.sonarrRoot,filePath:file.path});
    if(mapped.status!=='mapped')continue;
    const matches=byRelative.get(mapped.relative)||[];matches.push(file);byRelative.set(mapped.relative,matches);
   }
   for(const candidate of list){
    const item=items.get(candidate.id),files=byRelative.get(candidate.relative)||[];
    if(files.length===0){item.state='unbound';item.reason='no_episode_file';continue;}
    if(files.length>1){item.state='unbound';item.reason='multiple_episode_files';continue;}
    const result=resolver.resolve(files[0].path);
    if(result.status==='mapped'){
     Object.assign(item,{state:'bound',reason:null,observedAt,
      series:{id:series.id,title:series.title,seriesType:series.seriesType},
      file:{episodeFileId:result.binding.episodeFileId,label:safeLabel(result.file.relativePath),seasonNumber:result.file.seasonNumber},
      episodes:result.episodes.map(({id,...numbers})=>({id,...numbers}))});
    }else if(result.status==='unmapped'&&result.reason==='no-linked-episodes'){item.state='unbound';item.reason='no_linked_episodes';}
    else if(result.status==='ambiguous'&&result.reason==='duplicate-file-path'){item.state='unbound';item.reason='multiple_episode_files';}
    else{item.state='unverified';item.reason='sonarr_inconsistent';}
   }
  }
  info.status=sawFailure?(sawFailure==='sonarr_inconsistent'?'inconsistent':'unavailable'):'verified';
  info.observedAt=sawFailure?null:observedAt;
  return info;
 }

 function overview(settings,items,sonarr,observedAt){
  const all=[...items.values()],bound=all.filter(item=>item.state==='bound'),bySeries=new Map();
  for(const item of bound){
   if(!bySeries.has(item.series.id))bySeries.set(item.series.id,{...item.series,results:[]});
   bySeries.get(item.series.id).results.push(item);
  }
  const first=episode=>[episode.seasonNumber??Infinity,episode.episodeNumber??Infinity,episode.id];
  const order=(a,b)=>{const x=first(a.episodes[0]),y=first(b.episodes[0]);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]-y[i];return 0;};
  const series=[...bySeries.values()].sort((a,b)=>a.title.localeCompare(b.title)||a.id-b.id).map(entry=>{
   const seasons=new Map();
   for(const item of entry.results){
    // A file belongs to the lowest season among its linked episodes; its episodes keep their own numbering.
    const season=Math.min(...item.episodes.map(episode=>episode.seasonNumber??Infinity));
    const key=Number.isFinite(season)?season:null;
    if(!seasons.has(key))seasons.set(key,[]);seasons.get(key).push(item);
   }
   const episodes=entry.results.reduce((sum,item)=>sum+item.episodes.length,0);
   return {id:entry.id,title:entry.title,seriesType:entry.seriesType,
    totals:{results:entry.results.length,episodes,originalBytes:entry.results.reduce((s,i)=>s+i.originalBytes,0),reviewBytes:entry.results.reduce((s,i)=>s+i.reviewBytes,0)},
    seasons:[...seasons.entries()].sort(([a],[b])=>(a??Infinity)-(b??Infinity)).map(([seasonNumber,results])=>({seasonNumber,results:results.sort(order)}))};
  });
  const rest=state=>all.filter(item=>item.state===state).sort((a,b)=>a.reviewRelative.localeCompare(b.reviewRelative));
  return {mode:'discovery',status:'ok',observedAt:new Date(observedAt).toISOString(),
   sonarr:{status:sonarr.status,observedAt:sonarr.observedAt?new Date(sonarr.observedAt).toISOString():null,series:sonarr.series},
   totals:{results:all.length,bound:bound.length,unbound:rest('unbound').length,unverified:rest('unverified').length,episodes:series.reduce((s,e)=>s+e.totals.episodes,0),
    originalBytes:bound.reduce((s,i)=>s+i.originalBytes,0),reviewBytes:bound.reduce((s,i)=>s+i.reviewBytes,0)},
   series,unbound:rest('unbound'),unverified:rest('unverified')};
 }

 async function scan(settings,key){
  const {tv}=settings;
  if(misconfigured(tv))return {mode:'discovery',status:'unavailable',code:'tv_roots_overlap'};
  let jobs;
  try{jobs=await dbRows('jobsjsondb');}catch{return {mode:'discovery',status:'unavailable',code:'tv_tdarr_unavailable'};}
  const state=getState();
  const previous=state.tv&&state.tv.settingsKey===key&&plain(state.tv.items)?state.tv.items:{};
  const roots=tv.reviewPrefixes.length?tv.reviewPrefixes.map(prefix=>[path.join(tv.reviewRoot,prefix),prefix]):[[tv.reviewRoot,'']];
  const items=new Map(),candidates=[],stored={};
  const duplicates=new Map();
  for(const [directory,prefix] of roots)for(const reviewRelative of await walk(directory,prefix)){
   const found=await inspectResult(tv,jobs,reviewRelative,previous[tvItemId(reviewRelative)]);
   if(!found)continue;
   items.set(found.item.id,found.item);
   if(found.candidate){candidates.push(found.candidate);}
  }
  // One source file or one Tdarr job must never bind two results: both stay unbound.
  for(const candidate of candidates)for(const field of ['relative','jobId']){const entries=duplicates.get(field+'\0'+candidate[field])||[];entries.push(candidate);duplicates.set(field+'\0'+candidate[field],entries);}
  const dupes=new Set();for(const entries of duplicates.values())if(entries.length>1)for(const entry of entries)dupes.add(entry.id);
  const observedAt=now();
  const live=[];
  for(const candidate of candidates){if(dupes.has(candidate.id)){const item=items.get(candidate.id);item.state='unbound';item.reason='duplicate_result';}else live.push(candidate);}
  for(const candidate of candidates)stored[candidate.id]=candidate.stored;
  const sonarr=await bindWithSonarr(tv,settings.sonarr,live,items,observedAt);
  // Only the file-side evidence is kept (it avoids re-reading both files on every scan). A Sonarr binding never is.
  const next={version:1,settingsKey:key,items:stored};
  if(JSON.stringify(state.tv??null)!==JSON.stringify(next)){state.tv=next;await save();}
  return overview(settings,items,sonarr,observedAt);
 }

 /** The overview, or `{mode:'off'}` without any file or network access when discovery is not active. */
 async function result({force=false}={}){
  const settings=configured();
  if(!settings){cache=null;return {mode:'off'};}
  const key=signature(settings);
  if(running)return running;
  if(!force&&cache&&cache.key===key&&now()-cache.at<CACHE_MS)return cache.value;
  running=scan(settings,key).catch(()=>({mode:'discovery',status:'unavailable',code:'tv_scan_failed'})).then(value=>{cache={key,at:now(),value};return value;}).finally(()=>{running=null;});
  return running;
 }
 const mode=()=>configured()?'discovery':'off';
 return {result,mode,ownsResult};
}
