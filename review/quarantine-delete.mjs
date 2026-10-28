import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {classifyRecovery} from './public/review-model.js';
import {identityOf} from '../recovery/file-identity.mjs';
import {readRecoveryCaseState} from './recovery-snapshot.mjs';
import {withReviewPaths} from './recovery-case-alias.mjs';
import {writeQuarantineDeletion} from '../recovery/quarantine-deletion.mjs';

// Delete one quarantined file at the user's explicit request (#280). The quarantine listing offers it for
// every file; the server refuses while Recovery or a Review replacement still works with the case (running,
// waiting or unverified), while another action runs, or when the file changed since the confirmation was
// shown. Before the unlink, Review durably records the deletion so quarantine retention accepts the file's
// absence. Nothing else changes: the library, Tdarr, Radarr and the case records stay as they are.

const idPattern=/^[a-f0-9]{24}$/;
const ACTIVE=new Set(['running','waiting','unverified']);
const fail=(code,extra={})=>Object.assign(new Error(code),{code,...extra});
const validName=name=>typeof name==='string'&&!!name&&name.length<=1024&&!/[\\/\0]/.test(name)&&name!=='.'&&name!=='..';
async function syncDirectory(dir){if(process.platform==='win32')return;const handle=await fs.open(dir,'r');try{await handle.sync();}finally{await handle.close();}}

/**
 * @param {object} deps
 * @param {string} deps.data Review data directory.
 * @param {()=>any} deps.getConfig Review configuration (mediaRoot).
 * @param {()=>Promise<{requests?:any[]}>} deps.getOverview Recovery and Review replacement cases.
 * @param {()=>number} [deps.now]
 */
export function createQuarantineDelete({data,getConfig,getOverview,now=Date.now}){
 // The one quarantine root that holds <caseId>/<name> as a regular file, with no symlinked folder on the way.
 async function locate(roots,caseId,name){
  const found=[];
  for(const root of [...new Set(roots)]){
   try{
    if(await fs.realpath(root)!==root)continue;
    const folder=path.join(root,caseId);if(await fs.realpath(folder)!==folder)continue;
    const file=path.join(folder,name),st=await fs.lstat(file);
    if(st.isFile()&&!st.isSymbolicLink())found.push({root,folder,file,st});
   }catch(e){if(e.code!=='ENOENT')throw e;}
  }
  return found.length===1?found[0]:found.length?fail('quarantine_delete_ambiguous'):null;
 }
 // Where the case's current library copy is: the imported replacement when there is one, else the original.
 async function libraryState(caseId,source){
  const cfg=getConfig()||{};let relative=null;
  try{
   if(source==='recovery'){
    const read=await readRecoveryCaseState(path.join(data,'recovery','state.json')),c=read.present&&!read.error?(await withReviewPaths({[caseId]:read.cases[caseId]},cfg.mediaRoot))[caseId]:null;
    relative=c?.replacementRelative||c?.relative||null;
   }else if(source==='radarr'){
    const c=JSON.parse(await fs.readFile(path.join(data,'radarr-replacements',caseId+'.json'),'utf8'));relative=c?.replacementRelative||c?.relative||null;
   }
  }catch{return 'unknown';}
  if(typeof relative!=='string'||!relative||relative.startsWith('/')||relative.split('/').some(part=>!part||part==='.'||part==='..'))return 'unknown';
  try{const st=await fs.lstat(path.join(cfg.mediaRoot,...relative.split('/')));return st.isFile()&&!st.isSymbolicLink()?'present':'unknown';}
  catch(e){return e.code==='ENOENT'?'missing':'unknown';}
 }
 async function view(roots,caseId,name,{busy=false}={}){
  if(!idPattern.test(caseId||'')||!validName(name))throw fail('quarantine_delete_invalid');
  const located=await locate(roots,caseId,name);if(!located)throw fail('quarantine_delete_missing');
  const records=(await getOverview())?.requests||[],matches=records.filter(r=>r?.id===caseId),blockers=[];
  if(busy)blockers.push('quarantine-delete-busy');
  if(matches.length>1)blockers.push('quarantine-delete-ambiguous-case');
  const record=matches.length===1?matches[0]:null,category=record?classifyRecovery(record,now()).category:null;
  if(ACTIVE.has(category))blockers.push('quarantine-delete-case-active');
  const source=record?(record.source==='recovery'?'recovery':'radarr'):null,library=source?await libraryState(caseId,source):'unknown',identity=identityOf(located.st);
  const snapshot=crypto.createHash('sha256').update(JSON.stringify([located.file,identity,source,category,library])).digest('hex');
  return {located,identity,eligible:!blockers.length,blockers,snapshot,bytes:located.st.size,library,case:record?{source,category}:null};
 }
 /** What a deletion would do, from fresh reads; changes nothing. */
 async function inspect(roots,caseId,name,options){const {located,identity,...result}=await view(roots,caseId,name,options);return result;}
 /** Deletes the file after the confirmation the user saw, recording it first. */
 async function remove(roots,caseId,name,{snapshot,confirm,busy=false}={}){
  if(confirm!==true)throw fail('quarantine_delete_confirm_required');
  const current=await view(roots,caseId,name,{busy});
  if(!current.eligible)throw fail('quarantine_delete_not_eligible',{blockers:current.blockers});
  if(current.snapshot!==snapshot)throw fail('quarantine_delete_changed');
  const {file,folder}=current.located;
  await writeQuarantineDeletion({data,caseId,name,identity:current.identity,bytes:current.bytes,now:now()});
  const again=await fs.lstat(file);if(!again.isFile()||again.isSymbolicLink()||identityOf(again)!==current.identity)throw fail('quarantine_delete_changed');
  await fs.unlink(file);await syncDirectory(folder);
  try{await fs.rmdir(folder);await syncDirectory(path.dirname(folder));}catch(e){if(!['ENOTEMPTY','EEXIST','ENOENT'].includes(e.code))throw e;}
  return {deleted:true,bytes:current.bytes,library:current.library};
 }
 return {inspect,remove};
}
