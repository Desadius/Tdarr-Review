import fs from 'node:fs/promises';
import path from 'node:path';
import {classifyRecovery,recoveryFollowup,RECOVERY_STALE_MS} from './public/review-model.js';
import {readRecoveryCaseState} from './recovery-snapshot.mjs';
import {compareIdentity,identityOf} from '../recovery/file-identity.mjs';
import {createTdarrFileState} from '../recovery/tdarr-file-state.mjs';

// Recovery attention (#225, #229): for every case in Needs attention the server says why, where the movie
// verifiably is, which action it recommends, which other actions are valid and what blocks the rest. The UI
// renders buttons only from these actions, and each action is revalidated when it is submitted.
// Everything here only reads: Review never writes Recovery's files, and neither viewing nor refreshing a case
// changes a file, Tdarr, Radarr or a retention deadline. Locations carry state codes, never paths or values.

const SAME=new Set(['same','ctime-changed']);
const UNRESOLVED=new Set(['running','waiting','attention','unverified']);
const at=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;

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
 * @param {()=>boolean} [deps.isBusy] Whether running work excludes a mutation now.
 * @param {()=>number} [deps.now]
 */
export function createRecoveryAttention({data,getConfig,getItems,tdarr,getConnection,installed=null,isBusy=()=>false,now=Date.now}){
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
  const {identity:_,...quarantine}=record.source==='recovery'&&c?.quarantine?await fileState(c.quarantine,c.preservedSourceFP||c.fp):record.quarantineRetained?{status:'unverified',detail:'retained'}:{status:'not-used'};
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
  return {location:{library,quarantine,review,tdarr:tdarrState,radarr:radarrState},reviewItemId:item,installedResult};
 }
 function decide(record,classification,{reviewItemId,installedResult}){
  const reason=classification.reason,actions=[{id:'refresh',changes:'information'}],blockers=[...(BLOCKERS[reason]||['inspect-case'])];
  if(record.radarrMovieUrl)actions.push({id:'openRadarr',changes:'nothing',href:record.radarrMovieUrl});
  else if(['import-blocked','queue-failed','search-failed','original-outside-library'].includes(reason))blockers.push('radarr-link-unavailable');
  if(reviewItemId)actions.push({id:'openReview',changes:'nothing',itemId:reviewItemId});
  else if(installedResult?.eligible)actions.push({id:'assessInstalled',changes:'nothing'});
  else if(reason==='awaiting-review'||reason==='follow-up-complete'){blockers.push('review-result-missing');for(const b of installedResult?.blockers||[])if(b!=='installed-not-applicable')blockers.push(b);}
  if(record.sourceReplacement)actions.push({id:'replaceSource',changes:'starts-work'});
  else if(record.sourceReplacementBlocked)blockers.push('replacement-blocked');
  // Never return the obsolete or faulty original over a current copy that can be assessed instead.
  if(record.canRestore===true&&!installedResult?.eligible)actions.push({id:'restore',changes:'moves-files'});
  else if(installedResult?.eligible)blockers.push('restore-over-installed');
  const prefer={'binding-failure':['replaceSource'],'awaiting-review':['openReview','assessInstalled'],'follow-up-complete':['openReview','assessInstalled'],'import-blocked':['openRadarr'],'queue-failed':['openRadarr'],'search-failed':['openRadarr'],'original-outside-library':['openRadarr']}[reason]||[];
  const recommended=prefer.map(id=>actions.find(a=>a.id===id)).find(Boolean)||actions[0];
  // An offered replacement is the confirmed-source case: nothing blocks it.
  const open=record.sourceReplacement?blockers.filter(b=>b!=='source-not-confirmed'):blockers;
  return {recommended:recommended.id,actions,blockers:[...new Set(open)]};
 }

 /** The overview with a server-computed attention object on every Needs attention case. */
 async function attach(overview){
  const requests=Array.isArray(overview?.requests)?overview.requests:[];
  let caseState=null;try{caseState=await cases();}catch{}
  // A parent whose verified follow-up still carries unresolved work is shown once, as the follow-up.
  const classifiedChild=new Map(requests.filter(r=>r?.source==='recovery').map(r=>[r.id,classifyRecovery(r,now())]));
  for(const r of requests){const child=recoveryFollowup(r,requests);delete r.supersededBy;if(child&&UNRESOLVED.has(classifiedChild.get(child.id)?.category)&&!r.error)r.supersededBy=child.id;}
  for(const r of requests){
   const classification=classifyRecovery(r,now());delete r.attention;
   if(classification.category!=='attention')continue;
   const c=r.source==='recovery'?caseState?.[r.id]:null,found=await locate(r,c);
   r.attention={reason:classification.reason,location:found.location,...decide(r,classification,found),recoveryPolledAt:at(r.statusUpdated)};
  }
  return overview;
 }

 /** Re-reads Tdarr and Radarr for the given cases (all attention cases when none are named). Only reads. */
 async function refresh(overview,keys=null){
  const requests=Array.isArray(overview?.requests)?overview.requests:[],state=await cases().catch(()=>null),stamp=new Date(now()).toISOString();
  let connection=null;try{connection=await getConnection();}catch{}
  const radarrGet=async route=>{const r=await fetch(connection.url.replace(/\/$/,'')+'/api/v3'+route,{redirect:'error',headers:{'X-Api-Key':connection.apiKey},signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('Radarr '+r.status);return r.json();};
  for(const r of requests){
   const key=r.source+':'+r.id;if(keys?!keys.includes(key):classifyRecovery(r,now()).category!=='attention')continue;
   const c=r.source==='recovery'?state?.[r.id]:null,update={at:stamp};
   if(c?.file){try{const row=await createTdarrFileState(tdarr,{libraryId:getConfig()?.libraryId}).read(c.file);update.tdarr=row?.TranscodeDecisionMaker||null;}catch{update.tdarr=null;update.tdarrError=true;}}
   const movieId=c?.movieId??r.movieId;
   if(connection&&Number.isInteger(movieId)){try{const queue=await radarrGet('/queue?movieId='+movieId+'&pageSize=50');const records=Array.isArray(queue?.records)?queue.records:[];
    update.radarr=radarrDetail({source:'review',queue:records.map(q=>({status:q.status,trackedDownloadState:q.trackedDownloadState})),radarrMovieUrl:true});}catch{update.radarr=null;update.radarrError=true;}}
   refreshed.set(key,update);
  }
  return attach(overview);
 }
 return {attach,refresh};
}
