import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {classifyRecovery,recoveryFollowup,RECOVERY_STALE_MS} from './public/review-model.js';
import {readRecoveryCaseState} from './recovery-snapshot.mjs';
import {compareIdentity,identityOf} from '../recovery/file-identity.mjs';
import {createTdarrFileState} from '../recovery/tdarr-file-state.mjs';
import {readRecoveryConfiguration,readRecoveryRestoreBinding} from '../recovery/recovery-authority.mjs';
import {inspectRadarrImport,radarrQueueUrl} from './recovery-import-diagnostics.mjs';
import {diagnoseRetentionEvidence,hasMatchingReviewRetentionError} from './recovery-retention-diagnosis.mjs';

// Recovery attention (#225, #229): for every case in Needs attention the server says why, where the movie
// verifiably is, which action it recommends, which other actions are valid and what blocks the rest. The UI
// renders buttons only from these actions, and each action is revalidated when it is submitted.
// The attention projection only reads: Review never writes Recovery's files, and viewing or refreshing a case
// never changes media, Tdarr, Radarr or retention. Separate deferral code may write Review-only metadata.
// Locations carry state codes, never paths or values.

const SAME=new Set(['same','ctime-changed']);
const UNRESOLVED=new Set(['running','waiting','attention','unverified']);
const at=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const positive=value=>Number.isSafeInteger(value)&&value>0;
const importPhases=new Set(['waiting_replacement','waiting_source_kept']);
const importDiagnosisReasons=new Set(['import-blocked','queue-failed']);
const MAX_IMPORT_INSPECTIONS=10;
const SAFE_QUEUE_STATUSES=new Set(['queued','downloading','paused','completed','failed','warning']);
const SAFE_TRACKED_STATES=new Set(['queued','downloading','waiting','delay','paused','importpending','importing','imported','importblocked','failed','completed','unknown']);
const SAFE_TRACKED_STATUSES=new Set(['ok','warning','error','downloading','completed','failed','unknown']);
const safeQueueCode=(value,allowed)=>typeof value==='string'&&allowed.has(value.toLowerCase())?value.toLowerCase():null;

// Administrator or later steps for situations without a Review action yet. Texts live in the UI catalogue.
const BLOCKERS={
 'binding-failure':['source-not-confirmed'],
 manual:['inspect-case'],
 'fault-not-confirmed':['diagnosis-needed'],
 'verify-mode':['verify-mode'],
 'awaiting-review':[],
 'transcode-error':['transcode-retry-unavailable'],
 'transcode-skipped':['transcode-retry-unavailable'],
 'tdarr-hold':['hold-not-released'],
 'follow-up-complete':[],
 'tdarr-missing':[],
 'original-outside-library':['radarr-download-stuck'],
 'search-failed':[],'queue-failed':[],'import-blocked':['manual-import-in-radarr'],
 'case-error':['inspect-case'],'retention-error':['retention-evidence'],
 unverified:['status-unverified'],
};

/** Identity verdict of a file against its recorded identity: present, changed, missing or unverified. */
// The current identity is returned separately (never sent to the browser) for matching the Review result.
async function fileState(file,recorded){
 if(typeof file!=='string'||!path.isAbsolute(file))return {status:'not-used'};
 try{const st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink())return {status:'verified',detail:'changed'};
  const current=identityOf(st);return {status:'verified',detail:recorded&&!SAME.has(compareIdentity(recorded,current))?'changed':'present',identity:current};}
 catch(e){return e?.code==='ENOENT'?{status:'verified',detail:'missing'}:{status:'unverified'};}
}
// The current library copy of a Recovery case: the imported replacement when there is one, else the original.
function libraryTarget(c){
 if(typeof c?.source!=='string'||typeof c.relative!=='string')return null;
 if(!c.replacementRelative)return {file:c.source,fp:c.fp,relative:c.relative};
 const suffix='/'+c.relative;if(!c.source.endsWith(suffix))return null;
 const root=c.source.slice(0,-suffix.length);return {file:path.join(root,c.replacementRelative),fp:c.replacementSourceFP,relative:c.replacementRelative};
}

/**
 * @param {object} deps
 * @param {string} deps.data Review data directory.
 * @param {()=>any} deps.getConfig Review configuration (libraryId).
 * @param {()=>Record<string,any>} deps.getItems Review items by id (relative, originalFP).
 * @param {(route:string,body?:any)=>Promise<any>} deps.tdarr Tdarr API.
 * @param {()=>Promise<{url:string,apiKey:string}>} deps.getConnection Radarr connection.
 * @param {{eligibility:(id:string,options?:{busy?:boolean})=>Promise<{eligible:boolean,blockers:string[]}>}} [deps.installed] Assessment of an installed result (#230).
 * @param {{rowMissing:(c:any)=>Promise<boolean>,eligibility:(id:string,options?:{busy?:boolean})=>Promise<{eligible:boolean,blockers:string[],uncertain?:boolean}>}} [deps.handoff] Review's Tdarr handoff (#231).
 * @param {()=>boolean} [deps.isBusy] Whether running work excludes a mutation now.
 * @param {()=>number} [deps.now]
 */
export function createRecoveryAttention({data,getConfig,getItems,tdarr,getConnection,mode='off',installed=null,handoff=null,deferrals=null,getOverview=async()=>({requests:[]}),isBusy=()=>false,now=Date.now}){
 /** @type {Map<string,{at:string,tdarr?:string|null,tdarrError?:boolean,radarr?:string|null,radarrError?:boolean}>} */
 const refreshed=new Map();
 const caseFile=()=>path.join(data,'recovery','state.json');
 async function cases(){const read=await readRecoveryCaseState(caseFile());return read.present&&!read.error?read.cases:null;}
 const fresh=time=>{const t=Date.parse(time);return Number.isFinite(t)&&now()-t<=RECOVERY_STALE_MS&&t<=now()+120000;};

 // The Review result waiting for the library copy: same path, and the file in the library now is the one Review scanned.
 function reviewItem(target,identity){
  if(!target||!identity)return null;
  for(const [id,item] of Object.entries(getItems()||{}))if(item?.relative===target.relative&&item.originalFP&&SAME.has(compareIdentity(item.originalFP,identity)))return id;
  return null;
 }
 function radarrDetail(r){
  const queue=Array.isArray(r.queue)?r.queue:[];
  if(queue.some(q=>String(q?.trackedDownloadState||'').toLowerCase()==='importblocked'))return 'import-blocked';
  if(queue.some(q=>['failed','error','warning','downloadclientunavailable'].includes(String(q?.status||'').toLowerCase())))return 'queue-failed';
  if(queue.length)return 'downloading';
  if(['failed','aborted','cancelled'].includes(String(r.search?.status||'').toLowerCase()))return 'search-failed';
  return r.radarrMovieUrl?'no-download':null;
 }
 async function locate(record,c){
  const key=record.source+':'+record.id,update=refreshed.get(key),reported=fresh(record.statusUpdated||record.updated);
  const target=record.source==='recovery'?libraryTarget(c):null;
  const {identity,...library}=target?await fileState(target.file,target.fp):{status:'not-used'};
  const {identity:quarantineIdentity,...quarantine}=record.source==='recovery'&&c?.quarantine?await fileState(c.quarantine,c.preservedSourceFP||c.fp):record.quarantineRetained?{status:'unverified',detail:'retained'}:{status:'not-used'};
  const item=record.source==='recovery'?reviewItem(target,library.detail==='present'?identity:null):(typeof record.itemId==='string'&&getItems()?.[record.itemId]?record.itemId:null);
  const review=item?{status:'verified',detail:'pending'}:{status:'not-used'};
  const tdarrState=update&&'tdarr' in update?(update.tdarrError?{status:'unverified',at:update.at}:{status:'verified',detail:update.tdarr?String(update.tdarr).toLowerCase():'missing',at:update.at,by:'review'})
   :record.tdarrStatus?{status:reported?'verified':'unverified',detail:String(record.tdarrStatus).toLowerCase(),at:at(record.statusUpdated),by:'recovery'}:{status:'not-used'};
  const radarrReported=radarrDetail(record);
  const radarrState=update&&'radarr' in update?(update.radarrError?{status:'unverified',at:update.at}:{status:'verified',detail:update.radarr,at:update.at,by:'review'})
   :radarrReported?{status:reported?'verified':'unverified',detail:radarrReported,at:at(record.statusUpdated||record.updated),by:record.source==='recovery'?'recovery':'review'}:{status:'not-used'};
  // A transcoded result already installed in place of the imported replacement can be assessed as it is (#230).
  let installedResult=null;
  if(installed&&record.source==='recovery'&&!item&&library.detail==='changed'){try{installedResult=await installed.eligibility(record.id,{busy:isBusy()});}catch{installedResult={eligible:false,blockers:['installed-unverified']};}}
  return {location:{library,quarantine,review,tdarr:tdarrState,radarr:radarrState},reviewItemId:item,installedResult,libraryIdentity:identity,quarantineIdentity};
 }
 function decide(record,classification,{reviewItemId,installedResult,handoffResult,importDiagnosis}){
  const reason=classification.reason,actions=[{id:'refresh',changes:'information'}],blockers=[...(BLOCKERS[reason]||['inspect-case'])];
  if(importDiagnosisReasons.has(reason)){
   if(importDiagnosis?.movieUrl)actions.push({id:'openRadarr',changes:'nothing',href:importDiagnosis.movieUrl});
   if(importDiagnosis?.queueUrl)actions.push({id:'openQueue',changes:'nothing',href:importDiagnosis.queueUrl});
   if(!importDiagnosis?.movieUrl&&!importDiagnosis?.queueUrl)blockers.push('radarr-link-unavailable');
  }else if(record.radarrMovieUrl)actions.push({id:'openRadarr',changes:'nothing',href:record.radarrMovieUrl});
  else if(['import-blocked','queue-failed','search-failed','original-outside-library'].includes(reason))blockers.push('radarr-link-unavailable');
  if(reviewItemId)actions.push({id:'openReview',changes:'nothing',itemId:reviewItemId});
  else if(installedResult?.eligible)actions.push({id:'assessInstalled',changes:'nothing'});
  else if(reason==='awaiting-review'||reason==='follow-up-complete'){blockers.push('review-result-missing');for(const b of installedResult?.blockers||[])if(b!=='installed-not-applicable')blockers.push(b);}
  if(handoffResult?.eligible)actions.push({id:'handoffTdarr',changes:'starts-work',...(handoffResult.uncertain?{uncertain:true}:{})});
  else if(handoffResult)blockers.push(...handoffResult.blockers.filter(b=>b!=='handoff-not-applicable'));
  // A handoff Recovery gave up on is an administrator step: approval could not start its retention (#231).
  if(record.source==='recovery'&&record.phase==='manual'&&/Tdarr (?:file binding|state)|handoff/i.test(String(record.error||'')))blockers.push('handoff-manual');
  if(record.sourceReplacement)actions.push({id:'replaceSource',changes:'starts-work'});
  else if(record.sourceReplacementBlocked)blockers.push('replacement-blocked');
  // Never return the obsolete or faulty original over a current copy that can be assessed instead.
  if(record.canRestore===true&&!installedResult?.eligible)actions.push({id:'restore',changes:'moves-files'});
  else if(installedResult?.eligible)blockers.push('restore-over-installed');
  const prefer=importDiagnosisReasons.has(reason)?[importDiagnosis?.status!=='verified'?'refresh':importDiagnosis?.movieUrl?'openRadarr':importDiagnosis?.queueUrl?'openQueue':'refresh']:
   ({'binding-failure':['replaceSource'],'awaiting-review':['openReview','assessInstalled'],'follow-up-complete':['openReview','assessInstalled'],'tdarr-missing':['handoffTdarr'],'queue-failed':['openRadarr'],'search-failed':['openRadarr'],'original-outside-library':['openRadarr']}[reason]||[]);
  const recommended=prefer.map(id=>actions.find(a=>a.id===id)).find(Boolean)||actions[0];
  // An offered replacement is the confirmed-source case: nothing blocks it.
  const open=record.sourceReplacement?blockers.filter(b=>b!=='source-not-confirmed'):blockers;
  return {recommended:recommended.id,actions,blockers:[...new Set(open)]};
 }

 async function safePathSnapshot(file,root=null){
  if(typeof file!=='string'||!path.isAbsolute(file)||file.includes('\\')||file.split(path.sep).some(part=>part==='..'))return null;
  if(root){if(path.resolve(root)!==path.resolve(file)&&!file.startsWith(path.resolve(root)+path.sep))return null;try{const st=await fs.lstat(root);if(!st.isDirectory()||st.isSymbolicLink()||await fs.realpath(root)!==path.resolve(root))return null;}catch{return null;}}
  let current=path.parse(file).root;const parts=file.slice(current.length).split(path.sep).filter(Boolean);
  try{for(let i=0;i<parts.length;i++){current=path.join(current,parts[i]);let st;try{st=await fs.lstat(current)}catch(error){if(error.code==='ENOENT')return {state:'missing',identity:null};return null;}
    if(st.isSymbolicLink())return null;if(i<parts.length-1){if(!st.isDirectory())return null;continue;}if(!st.isFile()||st.nlink!==1)return null;return {state:'present',identity:identityOf(st)};
   }}catch{return null;}return null;
 }

 async function deferralFingerprint(record,c,found){
  if(!deferrals||record.source!=='recovery'||!object(c)||c.id!==record.id||found.location.library.status==='unverified'||c.quarantine&&found.location.quarantine.status==='unverified')return null;
  const cfg=getConfig(),relative=c.relative;if(typeof relative!=='string'||relative.startsWith('/')||relative.split('/').some(part=>!part||part==='.'||part==='..'||part.includes('\\')))return null;
  const source=path.resolve(cfg.mediaRoot,relative.split('/').join(path.sep));if(path.resolve(c.source)!==source)return null;
  const target=libraryTarget(c);if(!target||!target.relative||path.resolve(target.file)!==path.resolve(cfg.mediaRoot,target.relative.split('/').join(path.sep)))return null;
  const library=await safePathSnapshot(target.file,cfg.mediaRoot);if(!library)return null;
  const quarantine=c.quarantine?safePathSnapshot(c.quarantine):{state:'not-recorded',identity:null};if(!quarantine)return null;
  let authority;try{const resolved=await readRecoveryRestoreBinding({data:path.join(data,'recovery'),mode});if(!object(resolved.binding)||!resolved.binding.mediaRoot||!resolved.binding.reviewRoot||!resolved.binding.sourceRoot||!resolved.binding.radarrRoot||!resolved.binding.libraryId)return null;authority={mode:resolved.mode,managed:resolved.managed,generation:resolved.generation,binding:resolved.binding};}catch{return null;}
  const material={source:record.source,id:record.id,phase:record.phase,attention:classifyRecovery(record,now()).reason,reviewConfig:{mediaRoot:cfg.mediaRoot,reviewRoot:cfg.reviewRoot,sourceRoots:cfg.sourceRoots||[],reviewPrefixes:cfg.reviewPrefixes||[],libraryId:cfg.libraryId||null},authority,case:{status:c.status,source:c.source,relative:c.relative,fp:c.fp,replacementRelative:c.replacementRelative||null,replacementSourceFP:c.replacementSourceFP||null,preservedSourceFP:c.preservedSourceFP||null,quarantine:c.quarantine||null,sourceConfirmed:c.sourceConfirmed===true,movieId:c.movieId||null,tmdbId:c.tmdbId||null,binding:c.binding||null},library,quarantine};
  return crypto.createHash('sha256').update(JSON.stringify(material)).digest('hex');
 }
 async function bindingFor(id){
  const overview=await getOverview(),record=(Array.isArray(overview?.requests)?overview.requests:[]).find(r=>r?.source==='recovery'&&r.id===id);
  if(!record||classifyRecovery(record,now()).category!=='attention')return null;
  const state=await cases().catch(()=>null),found=await locate(record,state?.[id]);return await deferralFingerprint(record,state?.[id],found);
 }
 async function defer(id,{revision,note}){
  const overview=await getOverview(),record=(Array.isArray(overview?.requests)?overview.requests:[]).find(r=>r?.source==='recovery'&&r.id===id);
  if(!record||classifyRecovery(record,now()).category!=='attention')throw Object.assign(new Error('deferral_unavailable'),{code:'deferral_unavailable'});
  const state=await cases().catch(()=>null),c=state?.[id],found=await locate(record,c),fingerprint=await deferralFingerprint(record,c,found);
  if(!fingerprint||c?.status!==record.phase)throw Object.assign(new Error('deferral_unavailable'),{code:'deferral_unavailable'});
  const saved=await deferrals.view('recovery',id,fingerprint);if(saved?.state==='deferred')throw Object.assign(new Error('deferral_conflict'),{code:'deferral_conflict'});
  return deferrals.defer({source:'recovery',id,fingerprint,revision,note,recheck:()=>bindingFor(id)});
 }
 async function reopen(id,{revision}){
  const overview=await getOverview(),record=(Array.isArray(overview?.requests)?overview.requests:[]).find(r=>r?.source==='recovery'&&r.id===id),state=await cases().catch(()=>null),c=state?.[id];
  if(!record||!c||c.status!==record.phase)throw Object.assign(new Error('deferral_unavailable'),{code:'deferral_unavailable'});
  const found=await locate(record,c),fingerprint=await deferralFingerprint(record,c,found);
  if(!fingerprint)throw Object.assign(new Error('deferral_unavailable'),{code:'deferral_unavailable'});
  return deferrals.reopen({source:'recovery',id,fingerprint,revision,recheck:()=>bindingFor(id)});
 }

 /** The overview with a server-computed attention object on every Needs attention case. */
 function unverifiedImportDiagnosis(connection){return {status:'unverified',category:null,movieUrl:null,queueUrl:radarrQueueUrl(connection),checkedAt:null};}
 function unavailableImportDiagnosis(connection){return {status:'unavailable',category:null,movieUrl:null,queueUrl:radarrQueueUrl(connection),checkedAt:new Date(now()).toISOString()};}
 function recoveryNamespaceUrl(value){
  if(typeof value!=='string'||value.length>2048)return null;
  try{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)return null;url.pathname=url.pathname.replace(/\/+$/,'');return url.href;}catch{return null;}
 }
 async function recoveryConfigMatches(connection){
  try{
   const {cfg}=await readRecoveryConfiguration({data:path.join(data,'recovery'),mode});
   return object(cfg)&&recoveryNamespaceUrl(cfg.radarrUrl)===recoveryNamespaceUrl(connection?.url)&&cfg.radarrApiKey===connection?.apiKey&&typeof cfg.radarrRoot==='string'&&cfg.radarrRoot.replace(/\/+$/,'')===connection?.mediaRoot?.replace(/\/+$/,'');
  }catch{return false;}
 }
 function exactRecoveryBinding(record,c,cases){
  if(!object(c)||c.id!==record.id||c.status!==record.phase||!importPhases.has(c.status)||!positive(c.movieId)||!positive(c.tmdbId)||!positive(c.binding?.movieFileId)||record.tmdbId!==c.tmdbId)return false;
  const active=[...Object.values(cases||{})].filter(value=>object(value)&&importPhases.has(value.status)&&value.movieId===c.movieId);
  return active.length===1&&active[0]===c;
 }
 function redactQueueDiagnosis(record,classification){
  delete record.error;delete record.observationError;delete record.warning;delete record.message;delete record.reason;
  record.pipelineLabel=classification.label;
  if(Array.isArray(record.queue))record.queue=record.queue.filter(object).map(q=>Object.fromEntries([
   ['status',safeQueueCode(q.status,SAFE_QUEUE_STATUSES)],
   ['trackedDownloadState',safeQueueCode(q.trackedDownloadState,SAFE_TRACKED_STATES)],
   ['trackedDownloadStatus',safeQueueCode(q.trackedDownloadStatus,SAFE_TRACKED_STATUSES)],
   ['percent',typeof q.percent==='number'&&Number.isFinite(q.percent)?Math.max(0,Math.min(100,q.percent)):null],
   ['timeleft',typeof q.timeleft==='string'&&/^\d{1,6}:[0-5]\d:[0-5]\d$/.test(q.timeleft)?q.timeleft:null]
  ].filter(([,value])=>value!==null))).filter(q=>Object.keys(q).length);
 }
 async function attach(overview,importDiagnoses=new Map(),importDiagnosisBindings=new Map()){
  const requests=Array.isArray(overview?.requests)?overview.requests:[];
  let caseState=null;try{caseState=await cases();}catch{}
  if(importDiagnosisBindings.size){
   let finalConnection=null;try{finalConnection=await getConnection();}catch{}
   let finalConfigMatches=false;try{if(finalConnection)finalConfigMatches=await recoveryConfigMatches(finalConnection);}catch{}
   for(const [id,binding] of importDiagnosisBindings){
    const currentCase=caseState?.[id],record={id,phase:binding.phase,tmdbId:binding.tmdbId};
    const caseMatches=exactRecoveryBinding(record,currentCase,caseState)&&currentCase.movieId===binding.movieId&&currentCase.tmdbId===binding.tmdbId&&currentCase.binding.movieFileId===binding.movieFileId;
    const connectionMatches=finalConnection?.apiKey===binding.apiKey&&finalConnection?.mediaRoot===binding.mediaRoot&&recoveryNamespaceUrl(finalConnection?.url)===binding.url&&finalConfigMatches;
    if(!caseMatches||!connectionMatches){
     importDiagnoses.set(id,unavailableImportDiagnosis(finalConnection));
     const update=refreshed.get('recovery:'+id);if(update){update.radarr=null;update.radarrError=true;}
    }
   }
  }
  // A parent whose verified follow-up still carries unresolved work is shown once, as the follow-up.
  const classifiedChild=new Map(requests.filter(r=>r?.source==='recovery').map(r=>[r.id,classifyRecovery(r,now())]));
  // An imported replacement whose Tdarr row a fresh read finds missing (#231).
  for(const r of requests){delete r.tdarrMissing;if(handoff&&r?.source==='recovery'&&r.phase==='replacement_imported'&&!r.tdarrStatus&&caseState?.[r.id]&&await handoff.rowMissing(caseState[r.id]))r.tdarrMissing=true;}
  for(const r of requests){const child=recoveryFollowup(r,requests);delete r.supersededBy;if(child&&UNRESOLVED.has(classifiedChild.get(child.id)?.category)&&!r.error)r.supersededBy=child.id;}
  for(const r of requests){
   const freshDiagnosis=importDiagnoses.get(r.id);
   const c=r.source==='recovery'?caseState?.[r.id]:null;
   const hasCurrentRetentionError=r.source==='recovery'&&object(c)&&c.id===r.id&&c.status===r.phase&&!!c.retentionError;
    let hasCurrentReviewRetentionError=false,reviewConfig=null,activeRadarr=null;
    if(r.source!=='recovery'&&(r.error||r.retentionError||r.retentionErrorPresent===true)){
     reviewConfig=getConfig();try{activeRadarr=await getConnection();}catch{}
     hasCurrentReviewRetentionError=await hasMatchingReviewRetentionError({data,record:r,reviewConfig:{...reviewConfig,radarrUrl:activeRadarr?.url,radarrRoot:activeRadarr?.mediaRoot,radarr:{quarantineRoot:activeRadarr?.quarantineRoot}}});
    }
    const retentionSignal=r.retentionErrorPresent===true||!!r.retentionError;
    const unboundRetentionSignal=retentionSignal&&(r.source==='recovery'?!hasCurrentRetentionError:!hasCurrentReviewRetentionError);
    if(r.retentionErrorPresent!==undefined||hasCurrentRetentionError||hasCurrentReviewRetentionError)r.retentionErrorPresent=r.source==='recovery'?hasCurrentRetentionError:hasCurrentReviewRetentionError;
    const currentRecord=r.source==='recovery'?{...r,retentionErrorPresent:hasCurrentRetentionError}:{...r,retentionErrorPresent:hasCurrentReviewRetentionError};
    if(unboundRetentionSignal){currentRecord.error='Vazbu případu nelze ověřit.';delete currentRecord.retentionError;}
    else if(r.source!=='recovery'&&!hasCurrentReviewRetentionError)delete currentRecord.retentionError;
   const classification=classifyRecovery(freshDiagnosis?{...currentRecord,attention:{importDiagnosis:freshDiagnosis}}:currentRecord,now());delete r.attention;
   if(classification.category!=='attention')continue;
    let retentionDiagnosis=unboundRetentionSignal?{status:'unavailable',reason:'case-binding-unavailable'}:null;
   if(classification.reason==='retention-error'){
     if(hasCurrentRetentionError||hasCurrentReviewRetentionError)r.retentionErrorPresent=true;
     reviewConfig||=getConfig();if(!activeRadarr)try{activeRadarr=await getConnection();}catch{}
    retentionDiagnosis=await diagnoseRetentionEvidence({data,mode,record:r,reviewConfig:{...reviewConfig,radarrUrl:activeRadarr?.url,radarrRoot:activeRadarr?.mediaRoot,radarr:{quarantineRoot:activeRadarr?.quarantineRoot}}});
    const currentConfig=getConfig();let currentRadarr=null;try{currentRadarr=await getConnection();}catch{}
    if(currentConfig?.mediaRoot!==reviewConfig?.mediaRoot||currentConfig?.reviewRoot!==reviewConfig?.reviewRoot||currentConfig?.libraryId!==reviewConfig?.libraryId||currentConfig?.tdarrUrl!==reviewConfig?.tdarrUrl||JSON.stringify(currentConfig?.sourceRoots)!==JSON.stringify(reviewConfig?.sourceRoots)||currentRadarr?.url!==activeRadarr?.url||currentRadarr?.apiKey!==activeRadarr?.apiKey||currentRadarr?.mediaRoot!==activeRadarr?.mediaRoot||currentRadarr?.quarantineRoot!==activeRadarr?.quarantineRoot)retentionDiagnosis={status:'unavailable',reason:'configuration-binding-changed'};
    // The saved raw error is neither evidence nor safe UI copy. Diagnosis exposes only a bounded reason code.
     for(const key of ['error','retentionError','observationError','warning','message','reason','queue','search'])delete r[key];
   }
    if(unboundRetentionSignal){for(const key of ['retentionError','observationError','warning','message','reason','queue','search'])delete r[key];r.error='Vazbu případu nelze ověřit.';}
   if(importDiagnosisReasons.has(classification.reason))redactQueueDiagnosis(r,classification);
   const found=await locate(r,c);
   let importDiagnosis;
   if(importDiagnosisReasons.has(classification.reason)){
    const connection=await getConnection().catch(()=>null);
    importDiagnosis=importDiagnoses.get(r.id)||unverifiedImportDiagnosis(connection);
    delete r.radarrMovieUrl;
    if(importDiagnosis.movieUrl)r.radarrMovieUrl=importDiagnosis.movieUrl;
   }
   if(handoff&&classification.reason==='tdarr-missing'){try{found.handoffResult=await handoff.eligibility(r.id,{busy:isBusy()});}catch{found.handoffResult={eligible:false,blockers:['handoff-unverified']};}}
   r.attention={reason:classification.reason,location:found.location,...(importDiagnosis?{importDiagnosis:Object.fromEntries(['status','category','movieUrl','queueUrl','checkedAt'].map(key=>[key,importDiagnosis[key]??null]))}:{}),...(retentionDiagnosis?{retentionDiagnosis}:{}),...decide(r,classification,{...found,importDiagnosis}),recoveryPolledAt:at(r.statusUpdated)};
   r.attention.actions.push({id:'exportDiagnostic',changes:'nothing'});
   if(r.source==='recovery'){
    let fingerprint=null,saved=null,metadataUnavailable=false;try{fingerprint=await deferralFingerprint(r,c,found);if(fingerprint)saved=await deferrals?.view('recovery',r.id,fingerprint);}catch{metadataUnavailable=true;}
    const active=!!fingerprint&&saved?.state==='deferred'&&saved.fingerprint===fingerprint;
    r.deferral={state:!fingerprint||metadataUnavailable||saved?.invalid?'unavailable':active?'deferred':saved?.state||'active',...(fingerprint&&!metadataUnavailable&&saved?.note?{note:saved.note}:{}),revision:fingerprint&&!metadataUnavailable?deferrals?.revision('recovery',r.id,fingerprint,saved)||null:null};
    if(fingerprint&&!metadataUnavailable&&c?.status===r.phase&&!saved?.invalid)r.attention.actions.push({id:active?'reopen':'defer',revision:r.deferral.revision,changes:'review-only'});
   }
  }
  return overview;
 }

 /** Re-reads Tdarr and Radarr for the given cases (all attention cases when none are named). Only reads. */
 async function refresh(overview,keys=null){
  const requests=Array.isArray(overview?.requests)?overview.requests:[],state=await cases().catch(()=>null),stamp=new Date(now()).toISOString();
  let connection=null;try{connection=await getConnection();}catch{}
  const radarrGet=async route=>{const r=await fetch(connection.url.replace(/\/$/,'')+'/api/v3'+route,{redirect:'error',headers:{'X-Api-Key':connection.apiKey},signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('Radarr '+r.status);return r.json();};
  const importDiagnoses=new Map(),importDiagnosisBindings=new Map();let importInspections=0;
  let recoveryConfigIsCurrent=false;try{if(connection)recoveryConfigIsCurrent=await recoveryConfigMatches(connection);}catch{}
  for(const r of requests){
   const key=r.source+':'+r.id;if(keys?!keys.includes(key):classifyRecovery(r,now()).category!=='attention')continue;
   const c=r.source==='recovery'?state?.[r.id]:null,update={at:stamp};
   if(c?.file){try{const row=await createTdarrFileState(tdarr,{libraryId:getConfig()?.libraryId}).read(c.file);update.tdarr=row?.TranscodeDecisionMaker||null;}catch{update.tdarr=null;update.tdarrError=true;}}
   const movieId=c?.movieId??r.movieId;
   const needsImportDiagnosis=r.source==='recovery'&&importDiagnosisReasons.has(classifyRecovery(r,now()).reason);
   if(needsImportDiagnosis){
    let diagnosis=unavailableImportDiagnosis(connection);
    if(importInspections<MAX_IMPORT_INSPECTIONS&&connection&&exactRecoveryBinding(r,c,state)&&recoveryConfigIsCurrent){
     importInspections++;
     const inspected=await inspectRadarrImport({connection,movieId:c.movieId,tmdbId:c.tmdbId});
     const currentCases=await cases().catch(()=>null),currentCase=currentCases?.[r.id];let currentConnection=null;
     try{currentConnection=await getConnection()}catch{}
     const stillBound=exactRecoveryBinding(r,currentCase,currentCases)&&currentCase.movieId===c.movieId&&currentCase.tmdbId===c.tmdbId&&currentCase.binding.movieFileId===c.binding.movieFileId&&
      currentConnection?.apiKey===connection.apiKey&&currentConnection?.mediaRoot===connection.mediaRoot&&recoveryNamespaceUrl(currentConnection?.url)===recoveryNamespaceUrl(connection.url)&&await recoveryConfigMatches(currentConnection);
     if(inspected.status==='verified'&&stillBound){diagnosis=inspected;importDiagnosisBindings.set(r.id,{phase:c.status,movieId:c.movieId,tmdbId:c.tmdbId,movieFileId:c.binding.movieFileId,url:recoveryNamespaceUrl(connection.url),apiKey:connection.apiKey,mediaRoot:connection.mediaRoot});}
     else diagnosis=unavailableImportDiagnosis(currentConnection);
     if(diagnosis.status==='verified')update.radarr=diagnosis.category==='download-pending'?'downloading':diagnosis.category==='import-problem'||diagnosis.category==='language-quality-mismatch'?'import-blocked':null;
     else update.radarrError=true;
    }else update.radarrError=true;
    importDiagnoses.set(r.id,diagnosis);
   }else if(connection&&Number.isInteger(movieId)){try{const queue=await radarrGet('/queue?movieId='+movieId+'&pageSize=50');const records=Array.isArray(queue?.records)?queue.records:[];
    update.radarr=radarrDetail({source:'review',queue:records.map(q=>({status:q.status,trackedDownloadState:q.trackedDownloadState})),radarrMovieUrl:true});}catch{update.radarr=null;update.radarrError=true;}}
   refreshed.set(key,update);
  }
  return attach(overview,importDiagnoses,importDiagnosisBindings);
 }
 return {attach,refresh,defer,reopen};
}
