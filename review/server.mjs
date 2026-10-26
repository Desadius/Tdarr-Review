import {extractPreview} from './av-preview.mjs';
import {pruneSessions,pruneAuthAttempts} from './auth-state.mjs';
import {RESUME_RETRY_TICK_MS,resumeRetryDelay} from './resume-retry.mjs';
import {publishApproval} from '../recovery/quarantine-retention.mjs';
import {extractListeningAudio} from './audio-listen.mjs';
import {assessment} from './assessment.mjs';
import {extractAudio,alignment} from './audio-compare.mjs';
import {identityChange,unreadableIdentity,durationException} from './recheck.mjs';
import {defaults,validate,mapReview} from './config.mjs';
import {extractFrame} from './frames.mjs';
import {lowPriorityCommand} from './low-priority.mjs';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {safeFile,hash,atomicJSON,command,probe,inspect,replaceChecked,recoverTransactions} from './core.mjs';
import {measure} from './progress.mjs';
import {appVersion} from './app-version.mjs';
import {logEvent} from './log.mjs';
import {createApprovalTransaction,outcomeLog,auditFailed} from './approval-transaction.mjs';
import {recordDecision} from './decision-audit.mjs';
import {isLoopback,recoveryStatusHealth,healthSummary} from './health-status.mjs';
import {readRecoveryRuntime,recoveryStatusFile} from './recovery-snapshot.mjs';
import {captureReceipt,cleanupReviewed} from './cleanup.mjs';
import {resolveReviewSource} from './source-mapping.mjs';
import {matchReviewJob} from './job-matching.mjs';
import {createArtwork} from './artwork.mjs';
import {createReviewSessionStore,ReviewSessionError,reviewRequirements} from './review-session.mjs';
import {createPreviewCache,PreviewCacheError,previewCacheKey} from './preview-cache.mjs';
import {createPreviewRenderer} from './preview-render.mjs';
import {defaultPreviewPlan} from './preview-plan.mjs';
import {defaultPreviewSettings,validatePreviewSettings,previewLimits} from './preview-settings.mjs';
import {busyFor as policyBusyFor,mutationKind} from './busy-guards.mjs';
import {respond,apiError} from './routes/http.mjs';
import {login,authenticated} from './routes/auth.mjs';
import {libraryRoutes} from './routes/library.mjs';
import {itemRoutes} from './routes/items.mjs';
import {previewRoutes} from './routes/previews.mjs';
import {settingsRoutes} from './routes/settings.mjs';
import {staticRoutes} from './routes/static.mjs';
import {nodeRoutes} from './routes/nodes.mjs';
import {previewCodeVersion as readPreviewCodeVersion} from './preview-version.mjs';
import {createSharedSettingsStore,readActiveSettings} from './shared-settings.mjs';
import {createSettingsApply} from './settings-apply.mjs';
import {invalidationLevel} from './settings-invalidation.mjs';
import {createRecoveryControlClient} from './recovery-control.mjs';
import {sharedSettingsRoutes} from './routes/shared-settings.mjs';
import {sonarrRoutes} from './routes/sonarr.mjs';
import {createSonarrSourceInspection} from './sonarr-source-inspection.mjs';
import {createSonarrResultInspection} from './sonarr-result-inspection.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const DATA=process.env.DATA_ROOT||'/data',PORT=Number(process.env.PORT||8270),APP_VERSION=await appVersion();
const configfile=path.join(DATA,'settings.json');
let activeSettings=await readActiveSettings(DATA,{checkPrivate:false});
let config=activeSettings?.review||validate(JSON.parse(await fs.readFile(configfile,'utf8').catch(e=>{if(e.code!=='ENOENT')throw e;return JSON.stringify(defaults())})));
const sharedSettings=createSharedSettingsStore({data:DATA});
const sonarrSourceInspection=createSonarrSourceInspection({getSnapshot:async revision=>{
 const current=await sharedSettings.current();if(current.revision!==revision)throw Object.assign(Error('Settings changed'),{code:'settings_conflict'});
 const sonarr=await sharedSettings.sonarrConnection(revision);
 return {revision,sonarr,tv:current.draft.libraries?.tv??null};
}});
const sonarrResultInspection=createSonarrResultInspection({getSnapshot:async revision=>{
 const current=await sharedSettings.current();if(current.revision!==revision)throw Object.assign(Error('Settings changed'),{code:'settings_conflict'});
 const sonarr=await sharedSettings.sonarrConnection(revision);
 return {revision,sonarr,tv:current.draft.libraries?.tv??null,review:{database:current.draft.review?.database??''}};
}});
const activeConnection=async()=>activeSettings?activeSettings.radarr:JSON.parse(await fs.readFile(path.join(DATA,'radarr.json'),'utf8'));
let MEDIA,REVIEW,TDARR,DB,FFPROBE,HOST;
function applyConfig(){({mediaRoot:MEDIA,reviewRoot:REVIEW,tdarrUrl:TDARR,database:DB,ffprobe:FFPROBE}=config);HOST=new URL(config.publicOrigin).host;}
applyConfig();
let statsCache=null,statsTask=null;
let settingsBusy=false;
await fs.mkdir(DATA,{recursive:true});await fs.mkdir(path.join(DATA,'transactions'),{recursive:true});
const keyfile=path.join(DATA,'access-key');
let KEY=await fs.readFile(keyfile,'utf8').catch(()=>null);
if(!KEY){KEY=crypto.randomBytes(24).toString('base64url');await fs.writeFile(keyfile,KEY,{mode:0o600,flag:'wx'})}
KEY=KEY.trim();
const statefile=path.join(DATA,'state.json');
import { rejectionReason, recordRejection } from './rejection-audit.mjs';
import {createReplacement} from './radarr-replacement.mjs';
import {createRecoveryAttention} from './recovery-attention.mjs';
import {createRecoveryDeferrals} from './recovery-deferrals.mjs';
import {createDiagnosticExport} from './diagnostic-export.mjs';
import {createInstalledAssessment} from './installed-assessment.mjs';
import {createTdarrHandoff} from './tdarr-handoff.mjs';
import {createRecoverySafeRestore} from './recovery-safe-restore.mjs';
import {createTranscodeRetry} from './transcode-retry.mjs';
let state=JSON.parse(await fs.readFile(statefile,'utf8').catch(()=>'{"items":{},"history":[],"sessions":{},"pauses":[]}'));
if(!state.reviewSessions||typeof state.reviewSessions!=='object'||Array.isArray(state.reviewSessions))state.reviewSessions={};
// Confirmed replacements wait here while another replacement or batch runs (#155). After a restart
// nothing queued runs by itself: the entries are kept as interrupted until the person confirms again.
if(!Array.isArray(state.replacementQueue))state.replacementQueue=[];
if(!Array.isArray(state.queueInterrupted))state.queueInterrupted=[];
if(state.replacementQueue.length){const at=new Date().toISOString();state.queueInterrupted.push(...state.replacementQueue.map(q=>({id:q.id,title:q.title,queuedAt:q.queuedAt,interruptedAt:at})));state.queueInterrupted=state.queueInterrupted.slice(-50);state.replacementQueue=[]}
for(const h of state.history||[])if(h.status==='error'&&h.message?.includes('Unexpected token')&&h.message.includes('OK'))h.fixedIn='1.1.0';
let previewBusy=false;
let active=null,scanPromise=null,cache=null,cacheAt=0,batchRunning=false;
let mutationOwner=null;
let recoveryRestoreBusy=false;
// Node pauses taken by the running replacement or batch are owned by it, not unresolved: they do not
// block reviews of other films. Once the operation ends, any pause left behind blocks as before.
const operationPauses=()=>!!(active||batchRunning);
// The film being replaced, or waiting in the running batch, accepts no review, approval or preview work.
function itemInOperation(id){return active?.id===id||!!(batchRunning&&state.batch?.remaining?.some(x=>x.id===id))||state.replacementQueue.some(q=>q.id===id)}
// Adds a confirmed replacement to the queue; a repeated request for the same film adds nothing.
async function enqueueReplacement(item,{reviewRevision,acceptDuration=false}){
 const existing=state.replacementQueue.find(q=>q.id===item.id);if(existing)return {queued:true,duplicate:true,position:state.replacementQueue.indexOf(existing)+1};
 state.replacementQueue.push({id:item.id,title:item.title,snapshot:item.snapshot,reviewRevision,acceptDuration:acceptDuration===true,queuedAt:new Date().toISOString()});
 state.queueInterrupted=state.queueInterrupted.filter(q=>q.id!==item.id);await save();
 logEvent('replacement.queued',{id:item.id,title:item.title,position:state.replacementQueue.length});
 return {queued:true,duplicate:false,position:state.replacementQueue.length};
}
// Runs queued replacements one at a time once nothing else replaces media. Each one starts from a
// fresh scan: a changed snapshot or review revision fails that entry and keeps both files.
let queueRunning=false;
async function drainQueue(){
 if(queueRunning)return;queueRunning=true;
 try{
  while(!active&&!batchRunning&&state.replacementQueue.length){
   if(busyFor('approve'))break;
   // Reserve foreground work like a request does, so nothing else starts while the entry is checked.
   const q=state.replacementQueue[0],owner={kind:'queue'};mutationOwner=owner;
   let fresh=null;try{fresh=(await scan(true,null,owner)).find(x=>x.id===q.id)}catch{}
   state.replacementQueue.shift();await save();
   if(!fresh||fresh.snapshot!==q.snapshot){
    const outcome={id:q.id,title:q.title,action:'approve',status:'error',message:'Soubory se od zařazení do fronty změnily; nahrazení neproběhlo a oba soubory zůstaly zachované.',time:new Date().toISOString()};
    state.history.unshift(outcome);state.history=state.history.slice(0,150);mutationOwner=null;await save();logEvent('action.finished',outcomeLog(outcome));continue;
   }
   // perform() sets active before its first await, so the reservation hands over without a gap.
   const running=perform('approve',{...fresh,reviewRevision:q.reviewRevision},q.acceptDuration);mutationOwner=null;await running;
  }
 }finally{queueRunning=false;if(mutationOwner?.kind==='queue')mutationOwner=null}
}
function busyFor(kind,owner=null){
 return policyBusyFor(kind,{foreground:mutationOwner&&mutationOwner!==owner,active,batchRunning,resumeTask,previewBusy,settingsBusy,reviewSessions:reviewSessions.busy,recoveryRestore:recoveryRestoreBusy,scan:scanPromise,recovery:recovery.length,pauses:operationPauses()?0:state.pauses.length,statistics:statsTask,previewHolds:previewMutationHolds});
}
let saveChain=Promise.resolve();
const save=()=>{const snapshot=structuredClone(state);saveChain=saveChain.catch(()=>{}).then(()=>atomicJSON(statefile,snapshot));return saveChain};
const reviewSessions=createReviewSessionStore({getState:()=>state,save,verify:verifyReviewItem});
const previewSettingsFile=path.join(DATA,'preview-settings.json');
let previewSettings=validatePreviewSettings({...defaultPreviewSettings(),...JSON.parse(await fs.readFile(previewSettingsFile,'utf8').catch(e=>{if(e.code!=='ENOENT')throw e;return '{}'}))});
const previewCodeVersion=await readPreviewCodeVersion();
const previewVersion=()=>hash(previewCodeVersion+'|'+JSON.stringify([MEDIA,REVIEW,FFPROBE,config.ffmpeg]));
const previewPairs=new Map(),previewPlans=new Map(),previewAttempts=new Map();
let previewMutationHolds=0,previewPlanning=null;
async function previewIdentity(request){
 if(request.rendererVersion!==previewVersion())throw new ReviewSessionError('preview_settings_changed',409);
 const item=state.items[request.itemId];
 if(!item||item.snapshot!==request.snapshot)throw new ReviewSessionError('preview_files_changed',409);
 let a,b;try{a=await safeFile(MEDIA,item.relative);b=await safeFile(REVIEW,item.reviewRelative)}catch{throw new ReviewSessionError('preview_files_unavailable',409)}
 if(hash(a.fp+'|'+b.fp)!==request.snapshot)throw new ReviewSessionError('preview_files_changed',409);
 return {a,b};
}
async function previewPair(request,{background=false}={}){
 const {a,b}=await previewIdentity(request),key=request.itemId+'|'+request.snapshot+'|'+request.rendererVersion;
 let pair=previewPairs.get(key);
 if(!pair){
  const lower=background&&process.platform==='linux';
  const read=file=>command(...lowPriorityCommand(FFPROBE,['-v','error','-show_streams','-show_format','-of','json',file],lower),{timeout:30000}).then(JSON.parse);
  const [pa,pb]=await Promise.all([read(a.path),read(b.path)]);
  await previewIdentity(request);pair={a,b,pa,pb};
  previewPairs.set(key,pair);while(previewPairs.size>40)previewPairs.delete(previewPairs.keys().next().value);
 }
 return pair;
}
const previews=await createPreviewCache({directory:path.join(DATA,'preview-cache'),rendererVersion:previewVersion(),limits:previewLimits(previewSettings),backgroundDelayMs:1000,
 render:createPreviewRenderer({getPair:previewPair,getConfig:()=>config}),verify:async request=>{await previewIdentity(request);return true},
 allowBackground:()=>previewSettings.enabled&&!busyFor('background'),
 onError:error=>{if(!['CANCELLED','STALE'].includes(error.code))console.error('Preview preparation: '+error.message)}
});
function previewPreparation(id,snapshot){
 const plan=previewPlans.get(id),updated=Date.now();
 if(!plan||plan.snapshot!==snapshot)return {snapshot,updated,state:previewSettings.enabled?'waiting':'disabled',ready:0,total:0,error:null,defaultScope:null,jobs:[]};
 const jobs=plan.requests.map(request=>({mode:request.mode,seconds:request.seconds,originalIndex:request.originalIndex,reviewIndex:request.reviewIndex,previewProfile:request.profile,status:previews.status(request)}));
 const ready=jobs.filter(job=>job.status==='ready').length,failed=jobs.some(job=>job.status==='error'),running=jobs.some(job=>job.status==='running'),queued=jobs.some(job=>job.status==='queued');
 const quota=previews.stats().backgroundBudgetBlocked&&ready<jobs.length;
 return {snapshot,updated,state:!previewSettings.enabled?'disabled':running?'running':ready===jobs.length&&jobs.length&&!plan.unavailableReason?'ready':failed||quota?'error':ready?'partial':queued?'waiting':plan.unavailableReason?'unavailable':'waiting',ready,total:jobs.length,error:plan.unavailableReason||(quota?'Příprava čeká na místo v mezipaměti. Zvyš její limit nebo použij vytvoření ukázky na požádání.':failed?'Některé ukázky se nepodařilo předpřipravit. Zkus je vytvořit ručně nebo použij vlastní přehrávač.':null),defaultScope:plan.defaultScope,chosenAudioLanguage:plan.chosenAudioLanguage||null,jobs};
}
async function planPreviewItem(id,snapshot,background=false){
 const pair=await previewPair({itemId:id,snapshot,rendererVersion:previewVersion()},{background});
 const scope={...reviewSessions.get(id,snapshot).session.scope,seconds:null};
 const plan=defaultPreviewPlan({itemId:id,snapshot,durationA:Number(pair.pa.format?.duration),durationB:Number(pair.pb.format?.duration),originalTracks:(pair.pa.streams||[]).filter(s=>s.codec_type==='audio'),reviewTracks:(pair.pb.streams||[]).filter(s=>s.codec_type==='audio'),scope,rendererVersion:previewVersion(),...previewSettings});
 const prior=previewPlans.get(id);
 if(prior?.snapshot===snapshot&&(prior.defaultScope?.originalIndex!==plan.defaultScope.originalIndex||prior.defaultScope?.reviewIndex!==plan.defaultScope.reviewIndex)){
  await previews.cancelBackground({itemId:id,wait:true});for(const [key,request] of previewAttempts)if(request.itemId===id)previewAttempts.delete(key);
 }
 previewPlans.set(id,{...plan,snapshot});return plan;
}
async function preparePreviews(items=cache||[]){
 if(previewPlanning)return previewPlanning;
 previewPlanning=(async()=>{
  const valid=new Map(items.filter(item=>item.snapshot&&state.items[item.id]?.snapshot===item.snapshot).map(item=>[item.id,item.snapshot]));
  for(const [id,plan] of previewPlans)if(valid.get(id)!==plan.snapshot){previewPlans.delete(id);await previews.invalidate({itemId:id})}
  for(const [key,request] of previewAttempts)if(valid.get(request.itemId)!==request.snapshot||request.expiresAt&&Date.now()>=request.expiresAt)previewAttempts.delete(key);
  await previews.prune();
  if(!previewSettings.enabled)return;
  const candidates=items.filter(item=>valid.get(item.id)===item.snapshot&&state.items[item.id]?.info).slice(0,previewSettings.maxFilms);
  for(const item of candidates){
   if(busyFor('background'))break;
   try{
    const plan=await planPreviewItem(item.id,item.snapshot,true);
    for(const request of plan.requests){
     const key=previewCacheKey(request,previewVersion());if(previewAttempts.has(key))continue;
     const info=previews.entryInfo(request),record={...request,expiresAt:info?info.created+previewSettings.retentionDays*86400000:null};previewAttempts.set(key,record);
     if(previews.status(request)==='ready')continue;
     void previews.request(request,{priority:'background'}).then(()=>{const stored=previews.entryInfo(request);if(stored&&previewAttempts.get(key)===record)record.expiresAt=stored.created+previewSettings.retentionDays*86400000}).catch(error=>{if(error.code==='CANCELLED')previewAttempts.delete(key)});
    }
   }catch(error){if(state.items[item.id]?.snapshot===item.snapshot)previewPlans.set(item.id,{snapshot:item.snapshot,defaultScope:null,requests:[],unavailableReason:'Ukázky nyní nelze předpřipravit. Ověř dostupnost souborů.'});console.error('Preview plan: '+error.message)}
  }
 })().finally(()=>{previewPlanning=null});return previewPlanning;
}
async function forgetPreviews(id){
 previewPlans.delete(id);for(const [key,request] of previewAttempts)if(request.itemId===id)previewAttempts.delete(key);
 for(const key of previewPairs.keys())if(key.startsWith(id+'|'))previewPairs.delete(key);
 try{await previews.invalidate({itemId:id})}catch(error){console.error('Preview cleanup: '+error.message)}
}
function reviewMutationBlocked(){return busyFor('reviewSession')}
async function verifyReviewItem(item,{id,snapshot},guard=true){
 if(guard&&reviewMutationBlocked())throw new ReviewSessionError('finish_action_or_recovery',409);
 if(typeof item.reviewRelative!=='string'||hash(item.reviewRelative).slice(0,24)!==id||state.items[id]!==item||item.snapshot!==snapshot)throw new ReviewSessionError('review_item_unmapped',409);
 let a,b;
 try{a=await safeFile(MEDIA,item.relative);b=await safeFile(REVIEW,item.reviewRelative)}catch{throw new ReviewSessionError('review_files_unavailable',409)}
 if(hash(a.fp+'|'+b.fp)!==snapshot)throw new ReviewSessionError('review_files_changed',409);
 const read=async file=>JSON.parse(await command(FFPROBE,['-v','error','-show_streams','-show_format','-of','json',file],{timeout:30000}));
 const [original,review]=await Promise.all([read(a.path),read(b.path)]);
 let unchanged=false;try{unchanged=(await safeFile(MEDIA,item.relative)).fp===a.fp&&(await safeFile(REVIEW,item.reviewRelative)).fp===b.fp}catch{}
 if(!unchanged)throw new ReviewSessionError('review_files_changed_during_check',409);
 if(guard&&reviewMutationBlocked())throw new ReviewSessionError('review_action_started',409);
 if(state.items[id]!==item||item.snapshot!==snapshot)throw new ReviewSessionError('review_item_changed_during_check',409);
 const duration=Math.min(Number(original.format?.duration),Number(review.format?.duration));
 if(!Number.isFinite(duration)||duration<=0)throw new ReviewSessionError('review_duration_unverifiable',409);
 const indexes=probe=>(probe.streams||[]).filter(stream=>stream.codec_type==='audio').map(stream=>stream.index);
 return {duration,originalIndexes:indexes(original),reviewIndexes:indexes(review),requirements:reviewRequirements(original,review)};
}
const sessions=new Map(Object.entries(state.sessions||{}));pruneSessions(sessions);state.sessions=Object.fromEntries(sessions);
async function readRows(table,cfg=config){
 const collections={jobsjsondb:'JobsJSONDB',librarysettingsjsondb:'LibrarySettingsJSONDB',statisticsjsondb:'StatisticsJSONDB'};
 if(!collections[table])throw Error('Unsupported Tdarr collection');
 let db;
 try{db=new DatabaseSync(cfg.database,{readOnly:true});return db.prepare(`SELECT json_data FROM ${table}`).all().map(r=>JSON.parse(r.json_data))}
 catch(e){if(!/unable to open database file/.test(e.message))throw e}
 finally{db?.close()}
 const r=await fetch(cfg.tdarrUrl+'/api/v2/cruddb',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({data:{collection:collections[table],mode:'getAll'}}),signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error('Tdarr database API: '+r.status);
 const rows=await r.json();if(!Array.isArray(rows)||rows.some(x=>!x||typeof x!=='object'||Array.isArray(x)))throw Error('Invalid Tdarr database response');
 return rows;
}
const dbRows=table=>readRows(table);
async function tdarr(route,data){const r=await fetch(TDARR+route,{method:data?'POST':'GET',headers:{'content-type':'application/json'},body:data?JSON.stringify({data}):undefined,signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error('Tdarr neodpovídá: '+r.status);const t=await r.text();let value;try{value=t?JSON.parse(t):null}catch{value=t}if(route==='/api/v2/get-nodes'&&(!value||typeof value!=='object'||Array.isArray(value)))throw new Error('Tdarr vrátil neplatný seznam nodů.');return value}
function canonical(p,node){p=String(p||'').replaceAll('\\','/');for(const t of node.config?.pathTranslators||[]){const from=t.node.replaceAll('\\','/').replace(/\/$/,'');if(from&&(p===from||p.startsWith(from+'/')))return t.server+p.slice(from.length)}return p}
function workerBusy(nodes,item){
  for(const n of Object.values(nodes))for(const w of Object.values(n.workers||{})){
    if(w.idle||!w.file)continue;
    const p=canonical(w.file,n);
    if(config.sourceRoots.some(root=>p===root+'/'+item.relative||p===root+'/'+item.outputRelative)||p===config.tdarrReviewRoot+'/'+item.reviewRelative)return true;
  }return false;
}
let resumeTask=null;
// Backoff for the retry timer; any resume that clears every pause resets it.
let resumeFailures=0,nextResumeAt=0;
function resume(){
 if(resumeTask)return resumeTask;
 resumeTask=(async()=>{
  const pending=[],requested=(state.pauses||[]).map(p=>p.name);
  for(const p of state.pauses||[]){try{const ns=await tdarr('/api/v2/get-nodes');const n=Object.values(ns).find(n=>n.nodeName===p.name);if(!n){pending.push(p);continue}if(n.nodePaused)await tdarr('/api/v2/update-node',{nodeID:n._id,nodeUpdates:{nodePaused:false}})}catch{pending.push(p)}}
  state.pauses=pending;if(!pending.length)resumeFailures=nextResumeAt=0;await save();
  if(requested.length)logEvent('nodes.resume',{requested,pending:pending.map(p=>p.name),outcome:pending.length?'incomplete':'success'});
 })().finally(()=>{resumeTask=null});
 return resumeTask;
}
async function pauseDispatch(item){
  let nodes=await tdarr('/api/v2/get-nodes');
  if(workerBusy(nodes,item))throw new Error('Tento film právě zpracovává Tdarr. Schválení počká na dokončení úlohy; zkus ho poté znovu.');
  for(const n of Object.values(nodes))if(!n.nodePaused){
    state.pauses.push({name:n.nodeName,pausedAt:new Date().toISOString(),for:{id:item.id,title:item.title}});await save();
    await tdarr('/api/v2/update-node',{nodeID:n._id,nodeUpdates:{nodePaused:true}});
    logEvent('node.paused',{node:n.nodeName,id:item.id,title:item.title});
  }
  await new Promise(r=>setTimeout(r,2000));
  await verifyPaused(item);
}
// The user confirmed that a node Review would restore was paused on purpose in Tdarr (e.g. for
// maintenance). Review forgets it without contacting Tdarr, so no resume undoes that pause.
async function keepNodePaused(name){
  const index=state.pauses.findIndex(p=>p.name===name);if(index<0)return false;
  const [entry]=state.pauses.splice(index,1);if(!state.pauses.length)resumeFailures=nextResumeAt=0;await save();
  logEvent('node.kept-paused',{node:name,pausedAt:entry.pausedAt,id:entry.for?.id,title:entry.for?.title});
  return true;
}
const pendingRestores=()=>state.pauses.map(p=>({name:p.name,pausedAt:p.pausedAt||null,title:p.for?.title||null}));
async function verifyPaused(item){const nodes=await tdarr('/api/v2/get-nodes');if(Object.values(nodes).some(n=>!n.nodePaused)||workerBusy(nodes,item))throw new Error('Během výměny se změnil stav nodů. Originál nebyl vyměněn.');}

const replacements=createReplacement({data:DATA,getConfig:()=>config,getConnection:activeConnection,safeFile,hash,atomicJSON,tdarr,pauseDispatch,verifyPaused,isWorkerBusy:async item=>workerBusy(await tdarr('/api/v2/get-nodes'),item),resume,onProgress:stage=>progress(stage)});
// Needs attention projection plus Review-owned deferral metadata; the projection never writes Recovery state.
const installedAssessment=createInstalledAssessment({data:DATA,getConfig:()=>config,getItems:()=>state.items,tdarr,readRows:table=>dbRows(table),probe:file=>probe(FFPROBE,file),atomicJSON,recordDecision:entry=>recordDecision(DATA,entry)});
const tdarrHandoff=createTdarrHandoff({data:DATA,getConfig:()=>config,tdarr,readRows:table=>dbRows(table),isWorkerBusy:async item=>workerBusy(await tdarr('/api/v2/get-nodes'),item),atomicJSON});
// The Tdarr job report of a job (the same bounded reader as the health check), for the retry diagnosis (#232).
async function jobReport(job){const f=await safeFile(path.resolve(path.dirname(DB),'..','JobReports'),job.job.footprintId+'/'+job.job.fileId);if(f.stat.size>12*1024*1024)throw Object.assign(Error(),{code:'REPORT_TOO_LARGE'});return fs.readFile(f.path,'utf8');}
const transcodeRetry=createTranscodeRetry({data:DATA,getConfig:()=>config,tdarr,readRows:table=>dbRows(table),readReport:jobReport,isWorkerBusy:async item=>workerBusy(await tdarr('/api/v2/get-nodes'),item),atomicJSON});
const recoveryDeferrals=createRecoveryDeferrals({data:DATA});
const recoveryAttention=createRecoveryAttention({data:DATA,getConfig:()=>config,getItems:()=>state.items,tdarr,getConnection:activeConnection,mode:process.env.RECOVERY_MODE||'off',installed:installedAssessment,handoff:tdarrHandoff,retry:transcodeRetry,deferrals:recoveryDeferrals,getOverview:()=>replacements.overview(),isBusy:()=>!!busyFor('replace')});
const diagnosticExport=createDiagnosticExport({data:DATA,getOverview:()=>replacements.overview(),deferrals:recoveryDeferrals,version:()=>APP_VERSION,getConfig:()=>config,getConnection:activeConnection});
const localOff={requestDrain:async()=>({state:'off'}),status:async()=>({state:'off'}),cancel:async()=>({state:'off'}),stopAfterDrain:async()=>({state:'stopped'}),restart:async()=>({state:'off'}),wait:async()=>({state:'off'})};
const restoreControl=!process.connected&&(!process.env.RECOVERY_MODE||process.env.RECOVERY_MODE==='off')?localOff:createRecoveryControlClient();
const recoverySafeRestore=createRecoverySafeRestore({data:DATA,mode:process.env.RECOVERY_MODE||'off',tdarr,control:restoreControl});
await recoverySafeRestore.initialize();recoveryRestoreBusy=recoverySafeRestore.busy;
const artwork=createArtwork({data:DATA,getConnection:activeConnection});
await replacements.recover();
async function replacementAction(item,reason){
 logEvent('action.started',{action:'replace',id:item.id,title:item.title});
 active={id:item.id,title:item.title,action:'replace',stage:'Připravuji žádost Radarru',started:Date.now()};
 await forgetPreviews(item.id);
 let outcome;
 try{const request=await replacements.run(item,reason);outcome={id:item.id,title:item.title,action:'replace',status:'success',requestId:request.id,rejectionReason:reason,time:new Date().toISOString(),savedBytes:0};delete state.items[item.id];delete state.reviewSessions[item.id];}
 catch(e){outcome={id:item.id,title:item.title,action:'replace',status:'error',message:e.message,rejectionReason:reason,time:new Date().toISOString()};}
 finally{
  try{await recordDecision(DATA,{event:'replacement',id:item.id,title:item.title,relative:item.relative,reviewRelative:item.reviewRelative,snapshot:item.snapshot,jobId:item.jobId,reason,requestId:outcome.requestId,outcome:outcome.status,message:outcome.message})}catch(e){auditFailed(outcome,e)}
  state.history.unshift(outcome);state.history=state.history.slice(0,150);await save();active=null;cache=null;logEvent('action.finished',outcomeLog(outcome));void drainQueue().catch(e=>console.error('Replacement queue: '+e.message))}
}
let replacementTask=null;
const replacementTimer=setInterval(()=>{if(!replacementTask&&!busyFor('background'))replacementTask=replacements.observe().then(()=>replacements.cleanup()).catch(e=>console.error('Radarr status: '+e.message)).finally(()=>{replacementTask=null});},60000);replacementTimer.unref();

// Recover/inspect transactions before restarting dispatch; never replay approvals after restart.
const recovery=await recoverTransactions(path.join(DATA,'transactions'));
if(recovery.length)logEvent('transactions.unresolved',{transactions:recovery,message:'Exchange transactions need manual inspection; changes stay blocked.'});
if(!recovery.length)await resume();
if(state.batch?.status==='running'){
  logEvent('batch.interrupted',{batchId:state.batch.id,finished:state.batch.finished,total:state.batch.total,message:'Review restarted during the batch.'});
  state.batch.status='interrupted';
  state.batch.message='Aplikace byla restartována. Zbývající filmy nebyly automaticky schválené; vyber je znovu.';
  await save();
}
async function walk(dir,prefix=''){
  const result=[];
  for(const e of await fs.readdir(dir,{withFileTypes:true}).catch(()=>[])){
    if(e.isSymbolicLink()||e.name.startsWith('.'))continue;
    const rel=prefix?prefix+'/'+e.name:e.name;
    if(e.isDirectory()&&rel.split('/').length<12)result.push(...await walk(path.join(dir,e.name),rel));
    else if(e.isFile()&&e.name.toLowerCase().endsWith('.mkv'))result.push(rel);
  }return result;
}
const healthCache=new Map();
async function jobHealth(job){
 if(healthCache.has(job._id))return healthCache.get(job._id);
 try{
  const root=path.resolve(path.dirname(DB),'..','JobReports');
  const f=await safeFile(root,job.job.footprintId+'/'+job.job.fileId);
  if(f.stat.size>12*1024*1024)return 'unknown';
  const lines=(await fs.readFile(f.path,'utf8')).split('\n');let status='unknown';
  for(const line of lines){const m=line.match(/^\S+ ([^:]+):Node\[[^\]]+\]:Worker\[[^\]]+\]:(.*)$/);if(!m||m[1]!==job._id)continue;if(/^Strict health check passed: main video and all \d+ audio streams\./.test(m[2]))status='pass';if(/^STRICT HEALTH CHECK FAILED:/.test(m[2]))status='fail'}
  if(healthCache.size>256)healthCache.clear();healthCache.set(job._id,status);return status;
 }catch{return 'unknown'}
}
async function scan(force=false,recheckId=null,owner=null){
  if(reviewSessions.busy){if(cache)return cache;await reviewSessions.idle()}
  if(busyFor('scan',owner))return cache||[];
  if(scanPromise)return scanPromise;
  if(!force&&cache&&Date.now()-cacheAt<15000)return cache;
  scanPromise=(async()=>{
    const jobs=(await dbRows('jobsjsondb')).filter(j=>j.status==='Transcode success').sort((a,b)=>b.end-a.end);
    const list=[];
    for(const rel of await walk(REVIEW)){
      let relative=mapReview(rel,config.reviewPrefixes);if(!relative)continue;const outputRelative=relative;
      const id=hash(rel).slice(0,24);
      const item={id,title:relative.split('/')[0],relative,reviewRelative:rel,status:'ready',reason:'',audio:[],subtitles:[]};
      try {
        const mapping=await resolveReviewSource(MEDIA,REVIEW,outputRelative,rel);relative=mapping.relative;Object.assign(item,{relative,outputRelative});
        const a=await safeFile(MEDIA,relative),b=await safeFile(REVIEW,rel);
        item.originalBytes=a.stat.size;item.reviewBytes=b.stat.size;item.saving=100*(1-b.stat.size/a.stat.size);
        item.snapshot=hash(a.fp+'|'+b.fp);
        const prior=state.items[id],changed=!!prior&&prior.snapshot!==item.snapshot;
        // Until this pass succeeds, a changed item is only offered for verification (also when a later check fails).
        if(changed)item.identityChanged=true;
        const change=changed?identityChange(prior,a.fp,b.fp):{recheck:null,changes:[]};
        item.canRecheck=!!change.recheck;item.recheck=change.recheck;
        const job=matchReviewJob(jobs,{
          receipt:mapping.receipt,libraryId:config.libraryId,sourceRoots:config.sourceRoots,
          relative,sourceBytes:a.stat.size,outputBytes:b.stat.size,
        });
        if(b.stat.mtimeMs>Date.now()-120000)throw new Error('Soubor je čerstvě vytvořený. Čekám na dokončení zápisu.');
        const refreshed=changed&&prior.originalFP===a.fp&&prior.jobId!==job._id;
        const rechecked=!refreshed&&!!change.recheck&&recheckId===id;
        if(changed&&!refreshed&&!rechecked){
         // The list shows the new snapshot only as a blocked item to verify; no review of it is offered.
         item.identityChanged=true;
         throw new Error(unreadableIdentity(prior)?'Zaznamenaná identita souboru je nečitelná. Vyžaduje kontrolu.':change.recheck==='verify'?'Změnil se jen čas změny metadat souboru (ctime). Shodu obsahu nelze prokázat: ověř soubory a posuď film znovu od začátku.':'Soubory se od zařazení do review změnily. Vyžadují kontrolu.');
        }
        let info=(refreshed||rechecked)?null:prior?.info;
        if(info?.evidenceVersion!==1||typeof info.reviewRequirements?.hdr!=='boolean')info=null;
        if(!info){const pa=await probe(FFPROBE,a.path),pb=await probe(FFPROBE,b.path);info={...inspect(pa,pb),reviewRequirements:reviewRequirements(pa,pb)}}
        if(rechecked){
         // Verification: the same Tdarr job binding (matched above), unchanged technical metadata and
         // identities that stayed stable while probing. It never claims equal content.
         if(change.recheck==='verify'&&(prior.jobId!==job._id||JSON.stringify(info)!==JSON.stringify(prior.info))){item.identityChanged=true;throw new Error('Technické údaje nebo úloha Tdarr se od zařazení změnily; nové posouzení nelze založit.')}
         const [a2,b2]=[await safeFile(MEDIA,relative),await safeFile(REVIEW,rel)];
         if(a2.fp!==a.fp||b2.fp!==b.fp){item.identityChanged=true;throw new Error('Soubor se během ověření změnil. Vyžaduje kontrolu.')}
         logEvent('item.reverified',{id,title:item.title,previousSnapshot:prior.snapshot,snapshot:item.snapshot,changes:change.changes});
        }
        Object.assign(item,info);
        item.canApproveDuration=durationException(info)&&b.stat.size<a.stat.size;
        if(info.durationMismatch){item.status='blocked';item.reason='Rozdílná délka — vyžaduje zvláštní kontrolu, automatické schválení je zablokované.'}
        else if(b.stat.size>=a.stat.size){item.status='blocked';item.reason='Výsledek není menší než originál.'}
        else item.reason=`Úspora ${item.saving.toFixed(1)} %; rozdíl délky ${(info.durationB-info.durationA).toFixed(3)} s. ${item.saving>75?'Výrazné zmenšení: porovnej detaily obrazu, zrno a tmavé scény.':'Před schválením posuď obraz a zvuk při přehrávání.'}`;
        item.jobId=job._id;delete item.identityChanged;item.canRecheck=false;item.recheck=null;
        const samples=prior?.snapshot===item.snapshot?(prior.audioSamples||[]):[];
        item.assessment=assessment(item,info,{job:true,health:await jobHealth(job),samples});
        state.items[id]={snapshot:item.snapshot,info,originalFP:a.fp,reviewFP:b.fp,relative,outputRelative,reviewRelative:rel,jobId:job._id,audioSamples:samples,...(rechecked?{reverified:{at:new Date().toISOString(),previousSnapshot:prior.snapshot,changes:change.changes}}:prior?.snapshot===item.snapshot&&prior.reverified?{reverified:prior.reverified}:{})};
      }catch(e){item.status='blocked';item.reason=e.message}
      if(!item.assessment)item.assessment=assessment(item,null);
      list.push(item);
    }
    await save();cache=list;cacheAt=Date.now();return list;
  })().finally(()=>{scanPromise=null;void preparePreviews(cache||[]).catch(error=>console.error('Preview preparation: '+error.message))});return scanPromise;
}
function progress(stage,step=1,phase='metadata'){
  if(active)Object.assign(active,{stage,step,phase,phaseStarted:Date.now(),updatedAt:Date.now(),percent:null,done:null,total:null,unit:null,rate:null,speed:null,fps:null,etaSeconds:null});
}
function measured(p){
  if(!active||p.phase&&p.phase!==active.phase)return;
  Object.assign(active,measure(p.done,p.total,active.phaseStarted,Date.now(),p.speed),{unit:p.unit,updatedAt:Date.now(),speed:p.speed??null,fps:p.fps??null});
}
const perform=createApprovalTransaction({
 getState:()=>state,getConfig:()=>config,recovery,reviewSessions,
 files:{media:()=>MEDIA,review:()=>REVIEW,safeFile,hash,captureReceipt,cleanupReviewed,unlink:file=>fs.unlink(file),probe:file=>probe(FFPROBE,file),inspect,replaceChecked,
  newJournal:()=>path.join(DATA,'transactions',crypto.randomUUID()+'.json'),readJournal:async journal=>JSON.parse(await fs.readFile(journal,'utf8').catch(()=>'{"phase":"unknown"}'))},
 tdarr:{nodes:()=>tdarr('/api/v2/get-nodes'),workerBusy,pauseDispatch,verifyPaused,resume,libraries:()=>dbRows('librarysettingsjsondb'),rescan:body=>tdarr('/api/v2/rescan-file',body)},
 records:{publishApproval:entry=>publishApproval({...entry,atomic:atomicJSON}),recordRejection:entry=>recordRejection(DATA,entry),recordDecision:entry=>recordDecision(DATA,entry)},
 activity:{start:entry=>{active=entry},progress,measured,finish:()=>{active=null;cache=null}},
 log:logEvent,forgetPreviews,invalidateStats:()=>{statsCache=null},save,
 next:()=>void drainQueue().catch(e=>console.error('Replacement queue: '+e.message)),
});
async function performBatch(items){
  batchRunning=true;
  state.batch={id:crypto.randomUUID(),status:'running',total:items.length,finished:0,failed:0,started:new Date().toISOString(),results:[],remaining:items.map(x=>({id:x.id,title:x.title}))};
  logEvent('batch.started',{batchId:state.batch.id,total:items.length,ids:items.map(x=>x.id)});
  try {
    await save();
    for(const item of items){
      if(recovery.length||state.pauses.length){state.batch.status='interrupted';state.batch.message='Dávka je zastavená kvůli nedokončené výměně nebo obnovení nodů.';break}
      const result=await perform('approve',item);
      state.batch.results.push(result);state.batch.finished++;if(result.status==='error')state.batch.failed++;
      state.batch.remaining.shift();await save();
    }
    if(state.batch.status==='running')state.batch.status='complete';
  }catch(e){state.batch.status='interrupted';state.batch.message=e.message;console.error(e)}
  finally{state.batch.ended=new Date().toISOString();await save();batchRunning=false;cache=null;void drainQueue().catch(e=>console.error('Replacement queue: '+e.message));logEvent('batch.finished',{batchId:state.batch.id,outcome:state.batch.status,finished:state.batch.finished,failed:state.batch.failed,total:state.batch.total,message:state.batch.message})}
}
const authAttempts=new Map();
// Expired sessions and finished rate-limit windows are dropped hourly and on each login, so neither grows without bound.
const authTimer=setInterval(()=>{pruneAuthAttempts(authAttempts);if(pruneSessions(sessions)){state.sessions=Object.fromEntries(sessions);void save().catch(e=>console.error('Session cleanup: '+e.message))}},3600000);authTimer.unref();
// The one explicit server-state object handed to the route modules in routes/.
// Getters/setters keep the module variables above authoritative, so the scan,
// transaction and preview code shares exactly the state the routes change.
const ctx={
 ROOT,DATA,APP_VERSION,KEY,configfile,previewSettingsFile,sessions,authAttempts,recovery,previews,replacements,recoveryAttention,diagnosticExport,recoverySafeRestore,installedAssessment,tdarrHandoff,transcodeRetry,artwork,reviewSessions,previewPairs,previewPlans,previewAttempts,sharedSettings,sonarrSourceInspection,sonarrResultInspection,
 get config(){return config},set config(value){config=value},
 get previewSettings(){return previewSettings},set previewSettings(value){previewSettings=value},
 get state(){return state},
 get REVIEW(){return REVIEW},
 get active(){return active},set active(value){active=value},
 get batchRunning(){return batchRunning},
 get cache(){return cache},set cache(value){cache=value},
 get cacheAt(){return cacheAt},set cacheAt(value){cacheAt=value},
 get settingsBusy(){return settingsBusy},set settingsBusy(value){settingsBusy=value},
 get previewBusy(){return previewBusy},set previewBusy(value){previewBusy=value},
 get statsCache(){return statsCache},set statsCache(value){statsCache=value},
 get statsTask(){return statsTask},set statsTask(value){statsTask=value},
 get mutationOwner(){return mutationOwner},set mutationOwner(value){mutationOwner=value},
 setRecoveryRestoreBusy:value=>{recoveryRestoreBusy=value;},
 applyConfig,save,busyFor,itemInOperation,enqueueReplacement,keepNodePaused,pendingRestores,scan,perform,performBatch,replacementAction,resume,readRows,dbRows,verifyReviewItem,reviewMutationBlocked,
 previewIdentity,previewPair,previewVersion,previewPreparation,planPreviewItem,preparePreviews,forgetPreviews,
};
// How much saved review work a candidate configuration would invalidate, against the configuration
// this server runs with, and how many films' saved reviews and Approve decisions that clears.
function assessInvalidation(candidate){
 const {level,fields}=invalidationLevel(config,candidate.review);
 return {level,fields,reviews:level==='all'?Object.keys(state.reviewSessions||{}).length:0,approvals:level==='all'?Object.keys(state.approvals||{}).length:0};
}
// A committed generation clears only what its invalidation level requires (settings-invalidation.mjs).
// Without a level (an adopted ambiguous commit) everything is cleared, as before levels existed.
let pendingInvalidation='all';
const activateSettings=(value,invalidation={level:'all'})=>{
 activeSettings=value;config=value.review;applyConfig();pendingInvalidation=invalidation.level;
 if(invalidation.level==='all'){statsCache=null;state.items={};state.reviewSessions={};state.approvals={};cache=null;cacheAt=0;}
 if(invalidation.level!=='none'){previewPairs.clear();previewPlans.clear();previewAttempts.clear();}
 logEvent('settings.activated',{generation:invalidation.generation,invalidation:invalidation.level,fields:invalidation.fields,reviews:invalidation.cleared?.reviews,approvals:invalidation.cleared?.approvals});
};
activateSettings.flush=async()=>{if(pendingInvalidation!=='none')await previews.invalidate({all:true});await save();};
ctx.settingsApply=await createSettingsApply({assess:assessInvalidation,data:DATA,store:sharedSettings,mode:process.env.RECOVERY_MODE||'off',control:restoreControl,safe:()=>!busyFor('settings')&&!replacementTask&&!previewPlanning,barrier:value=>{settingsBusy=value;},activate:activateSettings,readRows});
const routes=[sharedSettingsRoutes,sonarrRoutes,libraryRoutes,itemRoutes,previewRoutes,settingsRoutes,nodeRoutes,staticRoutes];
const server=http.createServer(async(req,res)=>{
  let releasePreviewBackground=false;const request={mutation:null};
  try {
    if(req.headers.host!==HOST)return respond(res,403,apiError('host_forbidden'));
    const url=new URL(req.url,'http://'+HOST);
    if(req.method==='POST'&&req.headers.origin!==config.publicOrigin)return respond(res,403,apiError('origin_forbidden'));
    if(req.method==='POST'&&req.headers['content-type']!=='application/json')return respond(res,415,apiError('json_required'));
    if(url.pathname==='/health'&&req.method==='GET'){
      if(!isLoopback(req.socket.remoteAddress))return respond(res,404,apiError('not_found'));
      return respond(res,200,healthSummary({pendingTransactions:recovery.length,restorePending:state.pauses.length,recoveryStatus:await recoveryStatusHealth(recoveryStatusFile(config.mediaRoot)),recoveryRuntime:await readRecoveryRuntime(path.join(DATA,'recovery','runtime-state.json'))}));
    }
    if(await login(ctx,req,res,url))return;
    if(url.pathname.startsWith('/api/')&&!authenticated(ctx,req))return respond(res,401,apiError('login_required'));
    const kind=mutationKind(req.method,url.pathname);
    if(kind){
      const blocked=busyFor(kind);
      // A replacement confirmed while another one runs is queued instead of refused (#155).
      if(kind==='approve'&&['active','batchRunning'].includes(blocked)&&!busyFor('approveQueued'))request.queueOnly=true;
      else if(blocked)return respond(res,409,apiError(['recovery','pauses'].includes(blocked)?'finish_action_or_recovery':'busy'));
      // Claim before any await, including draining previews or reading a body.
      // Review writes retain their existing revision-aware serialization queue.
      if(kind!=='reviewSession'&&!request.queueOnly)mutationOwner=request.mutation={kind};
      previewMutationHolds++;releasePreviewBackground=true;await previews.pauseBackground({wait:true});
    }
    for(const route of routes)if(await route(ctx,req,res,url,request))return;
    respond(res,404,apiError('not_found'));
  }catch(e){const status=e instanceof ReviewSessionError?e.status:e instanceof PreviewCacheError?(['STALE','CANCELLED'].includes(e.code)?409:e.code==='INVALID_REQUEST'?400:500):500;logEvent('request.error',{method:req.method,route:String(req.url||'').split('?')[0],status,code:e instanceof ReviewSessionError?e.code:undefined,message:e.message});if(!res.headersSent)respond(res,status,e instanceof ReviewSessionError&&e.code?apiError(e.code,e.params):{error:e.message});else res.destroy()}
  finally{if(request.mutation&&mutationOwner===request.mutation)mutationOwner=null;if(releasePreviewBackground){previewMutationHolds--;if(!previewMutationHolds)previews.resumeBackground()}}
});
server.listen(PORT,'0.0.0.0',()=>console.log('Tdarr Review listening on '+PORT));
const previewTimer=setInterval(()=>{if(!busyFor('background'))void scan().then(preparePreviews).catch(error=>console.error('Preview preparation: '+error.message))},60000);previewTimer.unref();
// A failed node restore is retried here with backoff, never as a side effect of a GET request.
const resumeRetryTimer=setInterval(()=>{
 if(stopping||!state.pauses.length||busyFor('resume')||Date.now()<nextResumeAt)return;
 void resume().catch(e=>console.error('Node restore: '+e.message)).then(()=>{if(state.pauses.length)nextResumeAt=Date.now()+resumeRetryDelay(resumeFailures++)});
},RESUME_RETRY_TICK_MS);resumeRetryTimer.unref();
const previewStart=setTimeout(()=>{void scan().then(preparePreviews).catch(error=>console.error('Preview preparation: '+error.message))},1000);previewStart.unref();
let stopping=false;
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{
 if(stopping)return;stopping=true;clearInterval(previewTimer);clearTimeout(previewStart);clearInterval(replacementTimer);clearInterval(resumeRetryTimer);
 const drained=new Promise(resolve=>server.close(resolve));server.closeIdleConnections();
 void Promise.all([previews.close(),sonarrSourceInspection.close(),sonarrResultInspection.close(),drained]).then(async()=>{while(active||batchRunning||reviewSessions.busy||settingsBusy||resumeTask)await new Promise(resolve=>setTimeout(resolve,50));await saveChain;process.exit(0)}).catch(error=>{console.error('Review shutdown: '+error.message);process.exit(1)});
});
