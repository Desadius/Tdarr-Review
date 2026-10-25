import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {readRecoveryCaseState} from './recovery-snapshot.mjs';
import {compareIdentity,identityOf} from '../recovery/file-identity.mjs';
import {createTdarrFileState} from '../recovery/tdarr-file-state.mjs';
import {approvalEvidencePath,publishApproval} from '../recovery/quarantine-retention.mjs';
import {deviceSatisfied} from './public/review-rules.js';
import {reviewRequirements} from './review-session.mjs';
import {caseLibraryRoot as libraryRoot,importTime} from './recovery-case-paths.mjs';

// Assessment of an already installed transcoded result (#230). A Recovery case whose imported replacement was
// transcoded and installed outside a Review pair has no approval evidence, so its quarantine never enters
// retention. The user assesses the exact current copy in their own player; approval writes the same evidence a
// Review approval writes, keyed by the imported replacement, and Recovery's existing retention takes over.
// Nothing is encoded, downloaded, copied or moved, and Review never writes Recovery's files. The browser sees a
// token derived from the current copy's identity, never a path or the identity itself.

const SAME=new Set(['same','ctime-changed']);
const VIDEO=['.mkv','.mp4','.m4v','.avi','.ts'];
export const ASSESSMENT_CHECKS=Object.freeze(['image','audio','syncStart','syncMiddle','syncEnd']);
const token=identity=>crypto.createHash('sha256').update(identity).digest('hex');
const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);

/**
 * @param {object} deps
 * @param {string} deps.data Review data directory.
 * @param {()=>any} deps.getConfig Review configuration (libraryId, mediaRoot).
 * @param {()=>Record<string,any>} deps.getItems Review items by id.
 * @param {(route:string,body?:any)=>Promise<any>} deps.tdarr Tdarr API.
 * @param {(table:string)=>Promise<any[]>} deps.readRows Tdarr database rows.
 * @param {(file:string)=>Promise<any>} deps.probe FFprobe of a file.
 * @param {(file:string,value:any)=>Promise<void>} deps.atomicJSON Durable JSON write.
 * @param {(record:any)=>Promise<void>} deps.recordDecision Decision audit.
 * @param {()=>number} [deps.now]
 */
export function createInstalledAssessment({data,getConfig,getItems,tdarr,readRows,probe,atomicJSON,recordDecision,now=Date.now}){
 const directory=path.join(data,'recovery-assessments');
 const draftFile=id=>path.join(directory,id+'.json');

 // The installed copy: the replacement path, or one file with the same name and another video extension.
 async function installedCopy(root,relative){
  const at=async rel=>{try{const st=await fs.lstat(path.join(root,rel));return st.isFile()&&!st.isSymbolicLink()&&st.nlink===1?{relative:rel,identity:identityOf(st)}:{relative:rel,unsafe:true};}catch(e){if(e.code==='ENOENT')return null;throw e;}};
  const direct=await at(relative);if(direct)return direct;
  const parsed=path.posix.parse(relative),found=[];
  for(const ext of VIDEO)if(ext!==parsed.ext){const other=await at(path.posix.join(parsed.dir,parsed.name+ext));if(other)found.push(other);}
  return found.length===1?found[0]:found.length?{ambiguous:true}:null;
 }

 /** Whether the case may be assessed now, from fresh reads. Blocker codes are value-free. */
 async function eligibility(caseId,{busy=false}={}){
  const fail=(...blockers)=>({eligible:false,blockers});
  let c;try{const read=await readRecoveryCaseState(path.join(data,'recovery','state.json'));if(read.error)return fail('installed-unverified');c=read.present?read.cases[caseId]:null;}catch{return fail('installed-unverified');}
  if(!c||c.status!=='replacement_imported'||!c.replacementRelative||!c.replacementSourceFP||c.cleanup)return fail('installed-not-applicable');
  // The evidence must land where Recovery's retention reads it: beside Review's own library root.
  const root=libraryRoot(c);if(!root||!getConfig()?.mediaRoot||path.resolve(root)!==path.resolve(getConfig().mediaRoot))return fail('installed-unverified');
  try{await fs.lstat(await approvalEvidencePath(root,c.replacementRelative,c.replacementSourceFP));return fail('installed-evidence-exists');}catch(e){if(e.code!=='ENOENT')return fail('installed-unverified');}
  let copy;try{copy=await installedCopy(root,c.replacementRelative);}catch{return fail('installed-unverified');}
  if(!copy)return fail('installed-file-missing');
  if(copy.ambiguous)return fail('installed-ambiguous');
  if(copy.unsafe)return fail('installed-file-unsafe');
  // The imported replacement itself is assessed only when Tdarr's rules skipped it as Not required (#232).
  const untranscoded=SAME.has(compareIdentity(c.replacementSourceFP,copy.identity));
  const tdarrPath=path.posix.join(path.posix.dirname(c.file),path.posix.basename(copy.relative));
  let row,jobs;
  try{row=await createTdarrFileState(tdarr,{libraryId:getConfig()?.libraryId}).read(tdarrPath);jobs=await readRows('jobsjsondb');}catch{return fail('installed-unverified');}
  const imported=importTime(c.replacementSourceFP),decided=status=>Number.isFinite(imported)&&jobs.some(j=>[c.file,tdarrPath].includes(j?.file)&&status.test(String(j?.status||''))&&Number(j?.end)>imported);
  if(untranscoded){if(row?.TranscodeDecisionMaker!=='Not required')return fail('installed-not-transcoded');if(!decided(/^not required$/i))return fail('installed-no-decision');}
  else{if(row?.TranscodeDecisionMaker!=='Transcode success')return fail('installed-tdarr-not-success');if(!decided(/^Transcode success$/))return fail('installed-no-success-job');}
  if(Object.values(getItems()||{}).some(item=>item?.relative===copy.relative))return fail('installed-review-pending');
  if(busy)return fail('installed-busy');
  return {eligible:true,blockers:[],c,root,copy,tdarrPath,untranscoded,snapshot:token(copy.identity)};
 }

 async function readDraft(id){try{const value=JSON.parse(await fs.readFile(draftFile(id),'utf8'));return object(value)&&value.version===1?value:null;}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 const complete=(draft,{hdr})=>!!draft&&deviceSatisfied({method:'external',device:draft.device},{hdr})&&ASSESSMENT_CHECKS.every(k=>draft.checks?.[k]===true)&&(!hdr||draft.checks?.hdr===true)&&typeof draft.note==='string'&&draft.note.trim().length>0;
 async function requirements(e){return reviewRequirements(await probe(path.join(e.root,e.copy.relative)));}

 /** What the browser may know: eligibility, requirements and the draft for the current copy only. */
 async function view(caseId,options){
  const e=await eligibility(caseId,options);if(!e.eligible)return {eligible:false,blockers:e.blockers};
  let hdr;try{({hdr}=await requirements(e));}catch{return {eligible:false,blockers:['installed-unverified']};}
  const draft=await readDraft(caseId),current=draft?.snapshot===e.snapshot&&!draft.approvedAt?draft:null;
  return {eligible:true,blockers:[],...(e.untranscoded?{untranscoded:true}:{}),snapshot:e.snapshot,requirements:{hdr},draft:current?{device:current.device,checks:current.checks,note:current.note,updated:current.updated,complete:complete(current,{hdr})}:null};
 }
 /** Saves the user's observations for the current copy. Only explicit booleans confirm a check. */
 async function save(caseId,input,options){
  const e=await eligibility(caseId,options);if(!e.eligible)throw Object.assign(Error('installed_not_eligible'),{code:'installed_not_eligible',blockers:e.blockers});
  if(input?.snapshot!==e.snapshot)throw Object.assign(Error('installed_changed'),{code:'installed_changed'});
  const checks=Object.fromEntries([...ASSESSMENT_CHECKS,'hdr'].map(k=>[k,input?.checks?.[k]===true]));
  const device=typeof input?.device==='string'?input.device.trim().slice(0,160):'',note=typeof input?.note==='string'?input.note.trim().slice(0,2000):'';
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  await atomicJSON(draftFile(caseId),{version:1,caseId,snapshot:e.snapshot,installedRelative:e.copy.relative,device,checks,note,updated:new Date(now()).toISOString()});
  return view(caseId,options);
 }
 /** Approves the current copy: revalidates everything, then writes the approval evidence for the replacement. */
 async function approve(caseId,input,options){
  const e=await eligibility(caseId,options);if(!e.eligible)throw Object.assign(Error('installed_not_eligible'),{code:'installed_not_eligible',blockers:e.blockers});
  if(input?.snapshot!==e.snapshot||input?.confirm!==true)throw Object.assign(Error('installed_changed'),{code:'installed_changed'});
  const draft=await readDraft(caseId),{hdr}=await requirements(e);
  if(draft?.snapshot!==e.snapshot||draft.approvedAt||!complete(draft,{hdr}))throw Object.assign(Error('installed_incomplete'),{code:'installed_incomplete'});
  const evidence=await publishApproval({mediaRoot:e.root,relative:e.c.replacementRelative,sourceFP:e.c.replacementSourceFP,installedRelative:e.copy.relative,atomic:atomicJSON});
  if(!SAME.has(compareIdentity(evidence.installedFP,e.copy.identity)))throw Object.assign(Error('installed_changed'),{code:'installed_changed'});
  const approvedAt=evidence.approvedAt;await atomicJSON(draftFile(caseId),{...draft,approvedAt});
  await recordDecision({event:'installed-approval',...(e.untranscoded?{untranscoded:true}:{}),id:caseId,title:e.c.relative?.split('/')[0]||'Film',device:draft.device,checks:draft.checks,hdr,note:draft.note,approvedAt});
  return {approvedAt};
 }
 return {eligibility,view,save,approve};
}
