import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {readRecoveryCaseState,readRecoveryRuntime} from './recovery-snapshot.mjs';
import {compareIdentity,identityOf} from '../recovery/file-identity.mjs';
import {createTdarrFileState} from '../recovery/tdarr-file-state.mjs';
import {classify,originalFailureReport} from '../recovery/policy.mjs';
import {caseLibraryRoot,replacementTdarrFile,importTime} from './recovery-case-paths.mjs';

// A failed Tdarr transcode of a Recovery replacement (#232). The server reads the report of the newest
// error job for exactly the replacement's Tdarr file and classifies it with Recovery's own rules:
// recognized decode damage is Recovery's (its job scan opens its own case), an operational or
// unrecognized failure may be retried once per replacement identity, an unreadable report is unverified.
// The retry re-queues that one row after revalidation, with its intent journalled in Review's own data
// first. Only the cause category and a value-free decoder message reach the browser.

const SAME=new Set(['same','ctime-changed']);
const RUNNING=new Set(['Queued','Transcoding']);
const token=value=>crypto.createHash('sha256').update(value).digest('hex');
const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fail=(code,blockers)=>Object.assign(Error(code),{code,blockers});
// A recognized decoder message without addresses, sizes or other values.
const valueFree=signature=>String(signature||'').split('\n')[0].replace(/0x[0-9a-f]+|\d+/gi,'#').slice(0,120);

/**
 * @param {object} deps
 * @param {string} deps.data Review data directory.
 * @param {()=>any} deps.getConfig Review configuration (libraryId, mediaRoot).
 * @param {(route:string,body?:any)=>Promise<any>} deps.tdarr Tdarr API.
 * @param {(table:string)=>Promise<any[]>} deps.readRows Tdarr database rows.
 * @param {(job:any)=>Promise<string>} deps.readReport The Tdarr job report of a job.
 * @param {(item:{relative:string,reviewRelative:string,outputRelative:string})=>Promise<boolean>} deps.isWorkerBusy
 * @param {(file:string,value:any)=>Promise<void>} deps.atomicJSON Durable JSON write.
 * @param {()=>number} [deps.now]
 */
export function createTranscodeRetry({data,getConfig,tdarr,readRows,readReport,isWorkerBusy,atomicJSON,now=Date.now}){
 const directory=path.join(data,'recovery-retries');
 const journalFile=id=>path.join(directory,id+'.json');
 const files=()=>createTdarrFileState(tdarr,{libraryId:getConfig()?.libraryId});
 async function readJournal(id){try{const value=JSON.parse(await fs.readFile(journalFile(id),'utf8'));if(!object(value)||value.version!==1)throw Object.assign(Error(),{code:'RETRY_JOURNAL'});return value;}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 async function cases(){const read=await readRecoveryCaseState(path.join(data,'recovery','state.json'));return read.error?null:read.present?read.cases:{};}

 /** The cause of the replacement's failed transcode: decode-damage, operational, unrecognized or unreadable. */
 async function diagnose(caseId){
  let all;try{all=await cases();}catch{all=null;}
  const c=all?.[caseId],file=replacementTdarrFile(c);
  if(!c||c.status!=='replacement_imported'||!file)return {cause:'unreadable'};
  let row,jobs;try{row=await files().read(file);jobs=await readRows('jobsjsondb');}catch{return {cause:'unreadable'};}
  if(row?.TranscodeDecisionMaker!=='Transcode error')return {cause:'not-failed'};
  // Every job of the file counts; a job without an end time is ordered by its start, or is treated as the newest when it has neither.
  const when=j=>Number.isFinite(Number(j.end))&&j.end!==null&&j.end!==''?Number(j.end):Number.isFinite(Number(j.start))&&j.start!==null&&j.start!==''?Number(j.start):Infinity;
  const newest=jobs.filter(j=>j?.file===file).sort((a,b)=>when(b)-when(a))[0];
  if(!newest)return {cause:'unreadable'};
  if(!/error/i.test(String(newest.status||'')))return {cause:'newer-job'};
  if(!Number.isFinite(Number(newest.end))||newest.end===null||newest.end==='')return {cause:'job-unfinished'};
  let report;try{report=await readReport(newest);}catch{return {cause:'unreadable',job:newest};}
  if(typeof report!=='string')return {cause:'unreadable',job:newest};
  // Recovery's own reading of a report: operational first, then every damage pattern its job scan opens a case for.
  const result=classify({code:1,stderr:report});
  const cause=result.kind==='operational'?'operational':originalFailureReport(report)?'decode-damage':'unrecognized';
  return {cause,...(cause==='decode-damage'&&result.signature?{message:valueFree(result.signature)}:{}),job:newest,c,file,row,all};
 }

 /** Whether the one Review retry may run now, from fresh reads. */
 async function eligibility(caseId,{busy=false}={}){
  const d=await diagnose(caseId),no=(...blockers)=>({eligible:false,cause:d.cause,...(d.message?{message:d.message}:{}),blockers});
  if(d.cause==='not-failed')return no('transcode-not-failed');
  if(d.cause==='unreadable')return no('transcode-report-unreadable');
  if(d.cause==='newer-job')return no('transcode-newest-not-error');
  if(d.cause==='job-unfinished')return no('transcode-job-unfinished');
  if(d.cause==='decode-damage')return no('transcode-decode-damage');
  const {c,file,job}=d,cfg=getConfig()||{},root=caseLibraryRoot(c);
  if(!root||!cfg.mediaRoot||path.resolve(root)!==path.resolve(cfg.mediaRoot))return no('transcode-unverified');
  if(typeof cfg.libraryId!=='string'||!cfg.libraryId.trim())return no('handoff-library-id');
  let runtime;try{runtime=await readRecoveryRuntime(path.join(data,'recovery','runtime-state.json'));}catch{return no('transcode-unverified');}
  if(runtime?.state==='unreadable')return no('transcode-unverified');
  if(runtime?.mode==='verify')return no('verify-mode');
  let st;try{st=await fs.lstat(path.join(root,c.replacementRelative));}catch(e){return no(e.code==='ENOENT'?'handoff-file-missing':'transcode-unverified');}
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)return no('handoff-file-unsafe');
  const identity=identityOf(st);if(!SAME.has(compareIdentity(c.replacementSourceFP,identity)))return no('handoff-file-changed');
  if(!(Number(job.end)>importTime(c.replacementSourceFP)))return no('transcode-unverified');
  let journal;try{journal=await readJournal(caseId);}catch{return no('transcode-unverified');}
  const previous=journal?.file===file&&journal.sourceFP===c.replacementSourceFP?journal:null;
  // One retry per replacement identity: a failure after it, or a confirmed earlier one, ends Review's retries.
  if(previous&&(previous.confirmedAt||Number(job.end)>Date.parse(previous.intentAt)))return no(Number(job.end)>Date.parse(previous.intentAt)?'transcode-retry-failed-again':'transcode-retry-used');
  let working;try{working=await isWorkerBusy({relative:c.replacementRelative,reviewRelative:'',outputRelative:c.replacementRelative});}catch{return no('transcode-unverified');}
  if(working)return no('handoff-worker-busy');
  if(busy)return no('handoff-busy');
  return {eligible:true,blockers:[],cause:d.cause,...(d.message?{message:d.message}:{}),uncertain:!!previous,snapshot:token(file+'\0'+identity+'\0'+job._id),c,file,job};
 }
 async function view(caseId,options){const {c:_,file:__,job:___,...visible}=await eligibility(caseId,options);return visible;}

 /** Re-queues the replacement once after revalidation. Only a read-back Queued or Transcoding confirms it. */
 async function retry(caseId,input){
  const e=await eligibility(caseId);
  if(!e.eligible)throw fail('retry_not_eligible',e.blockers);
  if(input?.snapshot!==e.snapshot)throw fail('retry_changed');
  if(e.uncertain&&input?.acknowledgeUncertain!==true)throw fail('retry_uncertain');
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const intent={version:1,caseId,file:e.file,sourceFP:e.c.replacementSourceFP,jobId:String(e.job._id),intentAt:new Date(now()).toISOString()};
  await atomicJSON(journalFile(caseId),intent);
  const row=await files().queue(e.file);
  const state=String(row?.TranscodeDecisionMaker||'');
  if(!RUNNING.has(state))throw fail('retry_pending');
  await atomicJSON(journalFile(caseId),{...intent,confirmedAt:new Date(now()).toISOString(),state});
  return {state};
 }
 return {diagnose,eligibility,view,retry};
}
