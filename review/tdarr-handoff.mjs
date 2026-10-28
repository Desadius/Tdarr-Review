import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {readRecoveryCaseState,readRecoveryRuntime} from './recovery-snapshot.mjs';
import {withReviewPaths} from './recovery-case-alias.mjs';
import {compareIdentity,identityOf} from '../recovery/file-identity.mjs';
import {createTdarrFileState} from '../recovery/tdarr-file-state.mjs';
import {preservesHold} from '../recovery/replacement-handoff.mjs';
import {caseLibraryRoot as libraryRoot,replacementTdarrFile as tdarrFile,importTime} from './recovery-case-paths.mjs';

// Review's handoff of an imported replacement that never got a Tdarr entry (#231). Recovery marks a case
// replacement_imported once its own handoff returns and never retries it, so a replacement whose Tdarr row
// is missing stays outside Tdarr. Review offers one confirmed action: rescan that exact file. It never
// queues and never releases a Hold, of another case or of unknown origin. Its intent is journalled in
// Review's own data before the first Tdarr call; an intent without a confirmed row is uncertain and a retry
// needs the user's acknowledgement. Review never writes Recovery's files.

const SAME=new Set(['same','ctime-changed']);
export const HANDOFF_STABLE_MS=600000;
const token=value=>crypto.createHash('sha256').update(value).digest('hex');
const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fail=(code,blockers)=>Object.assign(Error(code),{code,blockers});

/**
 * @param {object} deps
 * @param {string} deps.data Review data directory.
 * @param {()=>any} deps.getConfig Review configuration (libraryId, mediaRoot).
 * @param {(route:string,body?:any)=>Promise<any>} deps.tdarr Tdarr API.
 * @param {(table:string)=>Promise<any[]>} deps.readRows Tdarr database rows.
 * @param {(item:{relative:string,reviewRelative:string,outputRelative:string})=>Promise<boolean>} deps.isWorkerBusy
 * @param {(file:string,value:any)=>Promise<void>} deps.atomicJSON Durable JSON write.
 * @param {()=>number} [deps.now]
 */
export function createTdarrHandoff({data,getConfig,tdarr,readRows,isWorkerBusy,atomicJSON,now=Date.now}){
 const directory=path.join(data,'recovery-handoffs');
 const journalFile=id=>path.join(directory,id+'.json');
 const files=()=>createTdarrFileState(tdarr,{libraryId:getConfig()?.libraryId});
 async function readJournal(id){try{const value=JSON.parse(await fs.readFile(journalFile(id),'utf8'));return object(value)&&value.version===1?value:null;}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 async function cases(){const read=await readRecoveryCaseState(path.join(data,'recovery','state.json'));return read.error?null:read.present?await withReviewPaths(read.cases,getConfig()?.mediaRoot):{};}

 /** Whether the replacement of a replacement_imported case verifiably has no Tdarr row (fresh read). */
 async function rowMissing(c){
  if(c?.status!=='replacement_imported'||!c.replacementRelative||!c.replacementSourceFP||c.cleanup)return false;
  const file=tdarrFile(c);if(!file)return false;
  try{return await files().read(file)===null;}catch{return false;}
 }

 /** Eligibility of the handoff from fresh reads; blocker codes are value-free. */
 async function eligibility(caseId,{busy=false}={}){
  const no=(...blockers)=>({eligible:false,blockers});
  let all;try{all=await cases();}catch{all=null;}
  if(!all)return no('handoff-unverified');
  const c=all[caseId];
  if(!c||c.status!=='replacement_imported'||!c.replacementRelative||!c.replacementSourceFP||c.cleanup)return no('handoff-not-applicable');
  const cfg=getConfig()||{},root=libraryRoot(c),file=tdarrFile(c);
  if(!root||!file||!cfg.mediaRoot||path.resolve(root)!==path.resolve(cfg.mediaRoot))return no('handoff-unverified');
  if(typeof cfg.libraryId!=='string'||!cfg.libraryId.trim())return no('handoff-library-id');
  let runtime;try{runtime=await readRecoveryRuntime(path.join(data,'recovery','runtime-state.json'));}catch{return no('handoff-unverified');}
  if(runtime?.state==='unreadable')return no('handoff-unverified');
  if(runtime?.mode==='verify')return no('verify-mode');
  let st;try{st=await fs.lstat(path.join(root,c.replacementRelative));}catch(e){return no(e.code==='ENOENT'?'handoff-file-missing':'handoff-unverified');}
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)return no('handoff-file-unsafe');
  const identity=identityOf(st);if(!SAME.has(compareIdentity(c.replacementSourceFP,identity)))return no('handoff-file-changed');
  if(now()-st.mtimeMs<HANDOFF_STABLE_MS)return no('handoff-file-unstable');
  let row,jobs,working;
  try{row=await files().read(file);jobs=await readRows('jobsjsondb');working=await isWorkerBusy({relative:c.replacementRelative,reviewRelative:'',outputRelative:c.replacementRelative});}catch{return no('handoff-unverified');}
  // Review never releases a Hold: one protected by another case and one of unknown origin alike.
  if(row?.TranscodeDecisionMaker==='Hold')return no(preservesHold(all,{id:c.id,file,sourceFP:c.replacementSourceFP,libraryId:cfg.libraryId})?'handoff-hold-protected':'handoff-hold');
  if(row)return no('handoff-reached');
  const imported=importTime(c.replacementSourceFP);
  if(!Number.isFinite(imported))return no('handoff-unverified');
  if(jobs.some(j=>j?.file===file&&Number(j?.end)>imported))return no('handoff-reached');
  if(working)return no('handoff-worker-busy');
  if(busy)return no('handoff-busy');
  let journal;try{journal=await readJournal(caseId);}catch{return no('handoff-unverified');}
  const bound=journal?.file===file&&journal.sourceFP===c.replacementSourceFP?journal:null;
  return {eligible:true,blockers:[],uncertain:!!bound&&!bound.confirmedAt,snapshot:token(file+'\0'+identity),c,file,libraryId:cfg.libraryId};
 }
 async function view(caseId,options){const e=await eligibility(caseId,options);return e.eligible?{eligible:true,blockers:[],uncertain:e.uncertain,snapshot:e.snapshot}:e;}

 /** Rescans the exact file after revalidation. Only a fresh row read confirms the handoff. */
 async function handoff(caseId,input){
  const e=await eligibility(caseId);
  if(!e.eligible)throw fail('handoff_not_eligible',e.blockers);
  if(input?.snapshot!==e.snapshot)throw fail('handoff_changed');
  if(e.uncertain&&input?.acknowledgeUncertain!==true)throw fail('handoff_uncertain');
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const intent={version:1,caseId,file:e.file,sourceFP:e.c.replacementSourceFP,libraryId:e.libraryId,intentAt:new Date(now()).toISOString()};
  await atomicJSON(journalFile(caseId),intent);
  await tdarr('/api/v2/rescan-file',{_id:e.file,DB:e.libraryId});
  const row=await files().read(e.file);
  if(!row)throw fail('handoff_pending');
  const state=String(row.TranscodeDecisionMaker||'');
  await atomicJSON(journalFile(caseId),{...intent,confirmedAt:new Date(now()).toISOString(),state});
  return {state};
 }
 return {rowMissing,eligibility,view,handoff};
}
