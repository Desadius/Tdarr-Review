import fs from 'node:fs/promises';
import {constants as fsConstants} from 'node:fs';
import path from 'node:path';
import {approvalEvidencePath} from '../recovery/quarantine-retention.mjs';
import {compareIdentity,identityOf} from '../recovery/file-identity.mjs';
import {readRecoveryCaseState} from './recovery-snapshot.mjs';
import {readRecoveryRestoreBinding} from '../recovery/recovery-authority.mjs';

const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const unavailable=reason=>({status:'unavailable',reason});
const verified=reason=>({status:'verified',reason});
const safeRelative=value=>typeof value==='string'&&!!value&&!path.isAbsolute(value)&&!value.includes('\\')&&!value.split('/').some(part=>!part||part==='.'||part==='..');
function within(root,relative){
 if(!safeRelative(relative))return null;
 const base=path.resolve(root),file=path.resolve(base,relative);
 return file!==base&&file.startsWith(base+path.sep)?file:null;
}
async function boundedJson(file,limit){
 const parent=path.dirname(file),grandparent=path.dirname(parent);
 try{if(await fs.realpath(grandparent)!==grandparent)return {unavailable:true};}catch{return {unavailable:true};}
 let parentStat;
 try{parentStat=await fs.lstat(parent);}catch(error){return error?.code==='ENOENT'?{missing:true}:{unavailable:true};}
 if(!parentStat.isDirectory()||parentStat.isSymbolicLink())return {unavailable:true};
 try{if(await fs.realpath(parent)!==parent)return {unavailable:true};}catch{return {unavailable:true};}
 let handle;
 try{handle=await fs.open(file,fsConstants.O_RDONLY|(fsConstants.O_NOFOLLOW||0)|(fsConstants.O_NONBLOCK||0));}
 catch(error){return error?.code==='ENOENT'?{missing:true}:{unavailable:true};}
 try{
  const before=await handle.stat();if(!before.isFile()||before.nlink!==1||before.size>limit)return {unavailable:true};
  const buffer=Buffer.alloc(limit+1),{bytesRead}=await handle.read(buffer,0,limit+1,0),after=await handle.stat();
  if(bytesRead>limit||after.size>limit||compareIdentity(identityOf(before),identityOf(after))!=='same')return {unavailable:true};
  return {value:JSON.parse(buffer.subarray(0,bytesRead).toString('utf8'))};
 }catch{return {unavailable:true};}finally{await handle.close().catch(()=>{});}
}
async function regularIdentity(file){
 let handle;
 try{
  if(await fs.realpath(path.dirname(file))!==path.dirname(file))return {reason:'file-unavailable'};
  try{handle=await fs.open(file,fsConstants.O_RDONLY|(fsConstants.O_NOFOLLOW||0)|(fsConstants.O_NONBLOCK||0));}catch(error){return {reason:error?.code==='ENOENT'?'file-missing':'file-unavailable'};}
  const before=await handle.stat();if(!before.isFile()||before.nlink!==1)return {reason:'file-unavailable'};
  const after=await handle.stat();if(compareIdentity(identityOf(before),identityOf(after))!=='same')return {reason:'file-unavailable'};
  return {identity:identityOf(after)};
 }catch{return {reason:'file-unavailable'};}finally{await handle?.close().catch(()=>{});}
}
function validIdentity(value){return typeof value==='string'&&compareIdentity(value,value)==='same';}
async function recoveryCase({data,record}){
 if(!/^[a-f0-9]{24}$/.test(record.id||''))return unavailable('case-binding-unavailable');
 const state=await readRecoveryCaseState(path.join(data,'recovery','state.json'));
 if(!state.present||state.error)return unavailable('case-binding-unavailable');
 const c=state.cases[record.id];
 if(!object(c))return unavailable('case-binding-unavailable');
 if(c.id!==record.id||c.status!=='replacement_imported'||!c.retentionError||!record.error)return unavailable('case-binding-changed');
 return {c};
}
async function reviewCase({data,record,reviewConfig}){
 if(!/^[a-f0-9]{24}$/.test(record.id||''))return unavailable('case-binding-unavailable');
 if(!reviewConfig||typeof reviewConfig.radarrUrl!=='string'||typeof reviewConfig.radarrRoot!=='string'||typeof reviewConfig.mediaRoot!=='string'||!path.isAbsolute(reviewConfig.mediaRoot)||typeof reviewConfig.reviewRoot!=='string'||!path.isAbsolute(reviewConfig.reviewRoot))return unavailable('configuration-unavailable');
 const file=path.join(data,'radarr-replacements',record.id+'.json'),read=await boundedJson(file,2*1024*1024);
 if(read.unavailable||read.missing)return unavailable('case-binding-unavailable');
 const c=read.value;
 if(!object(c)||c.id!==record.id||c.phase!=='imported'||!c.retentionError||!record.error||c.mediaRoot!==reviewConfig?.mediaRoot||c.reviewRoot!==reviewConfig?.reviewRoot||c.radarrUrl!==reviewConfig.radarrUrl||c.radarrRoot!==reviewConfig.radarrRoot)return unavailable('case-binding-changed');
 return {c};
}
/** Fresh, value-free check used only to preserve a Review-owned retention attention if evidence is unreadable. */
export async function hasMatchingReviewRetentionError({data,record,reviewConfig}){
 try{return !!(await reviewCase({data,record,reviewConfig})).c;}catch{return false;}
}
async function quarantineReason(c,binding,source,reviewConfig){
 const targets=[];
 if(source==='recovery'){
  const file=c.quarantine||c.originalQuarantine,fp=c.preservedSourceFP||c.fp||c.originalFP;
  if(typeof file!=='string'||!path.isAbsolute(file)||!validIdentity(fp)||typeof binding?.quarantineRoot!=='string'||!path.isAbsolute(binding.quarantineRoot))return 'quarantine-binding-unavailable';
  targets.push({file,fp,root:binding.quarantineRoot,id:c.id});
 }else{
  const radarr=reviewConfig?.radarr;
  const originalRoot=radarr?.quarantineRoot||path.join(path.dirname(reviewConfig.mediaRoot),'.tdarr-review-quarantine');
  if(typeof c.originalQuarantine!=='string'||!path.isAbsolute(c.originalQuarantine)||!validIdentity(c.originalFP))return 'quarantine-binding-unavailable';
  targets.push({file:c.originalQuarantine,fp:c.originalFP,root:originalRoot,id:c.id});
  if(c.reviewQuarantine){if(typeof c.reviewQuarantine!=='string'||!path.isAbsolute(c.reviewQuarantine)||!validIdentity(c.reviewFP))return 'quarantine-binding-unavailable';targets.push({file:c.reviewQuarantine,fp:c.reviewFP,root:path.join(reviewConfig.reviewRoot,'.radarr-quarantine'),id:c.id});}
 }
 for(const target of targets){
  if(typeof target.file!=='string'||!path.isAbsolute(target.file)||typeof target.root!=='string'||!path.isAbsolute(target.root)||typeof target.id!=='string'||!/^[a-f0-9]{24}$/.test(target.id))return 'quarantine-binding-unavailable';
  let root;try{root=await fs.realpath(target.root);if(root!==target.root)return 'quarantine-binding-unavailable';}catch{return 'quarantine-binding-unavailable';}
  const rel=path.relative(root,target.file);
  if(path.isAbsolute(rel)||rel.split(path.sep).some(part=>!part||part==='.'||part==='..')||path.dirname(target.file)!==path.join(root,target.id))return 'quarantine-binding-unavailable';
  const actual=await regularIdentity(target.file);if(actual.reason)return actual.reason==='file-missing'?'quarantine-file-missing':'quarantine-file-unavailable';
  const difference=compareIdentity(target.fp,actual.identity);
  if(difference==='invalid')return 'quarantine-identity-unavailable';
  if(!['same','ctime-changed'].includes(difference))return 'quarantine-file-changed';
 }
 return null;
}

/** Read-only, bounded diagnosis for a retention error. It never grants approval or changes cleanup state. */
export async function diagnoseRetentionEvidence({data,mode='off',record,reviewConfig}){
 if(!object(record)||!record.error)return unavailable('case-binding-unavailable');
 let c,binding=null,evidenceFile=null,evidenceValue=null,evidenceWasMissing=false;
 const caseKey=value=>JSON.stringify([value?.id,value?.status,value?.phase,value?.retentionError,value?.source,value?.relative,value?.fp,value?.originalFP,value?.preservedSourceFP,value?.reviewFP,value?.replacementRelative,value?.replacementSourceFP,value?.quarantine,value?.originalQuarantine,value?.reviewQuarantine,value?.sourceRoot,value?.tdarrSource,value?.libraryId,value?.mediaRoot,value?.reviewRoot,value?.radarrUrl,value?.radarrRoot,value?.cleanup?.approvedAt,value?.cleanup?.deleteAfter,value?.cleanup?.complete]);
 const finish=async result=>{
  if(result.status!=='verified'||!c)return result;
  let current;
  if(record.source==='recovery'){
   const state=await readRecoveryCaseState(path.join(data,'recovery','state.json'));
   if(!state.present||state.error)return unavailable('case-binding-unavailable');current=state.cases[record.id];
   if(caseKey(current)!==caseKey(c))return unavailable('case-binding-changed');
   try{const now=await readRecoveryRestoreBinding({data:path.join(data,'recovery'),mode});
    if(!now||now.mode!==binding.mode||JSON.stringify(now.binding)!==JSON.stringify(binding.binding))return unavailable('configuration-binding-changed');
   }catch{return unavailable('configuration-unavailable');}
  }else{
   const read=await boundedJson(path.join(data,'radarr-replacements',record.id+'.json'),2*1024*1024);
   if(!read.value)return unavailable('case-binding-unavailable');current=read.value;
   if(caseKey(current)!==caseKey(c))return unavailable('case-binding-changed');
  }
  if(evidenceFile){
   const fresh=await boundedJson(evidenceFile,16384);
   if(evidenceWasMissing){if(!fresh.missing)return unavailable('approval-evidence-unavailable');}
   else if(fresh.unavailable||JSON.stringify(fresh.value)!==JSON.stringify(evidenceValue))return unavailable('approval-evidence-unavailable');
  }
  const usable=evidenceValue?.version===1&&evidenceValue.relative===c.replacementRelative&&evidenceValue.sourceFP===c.replacementSourceFP&&safeRelative(evidenceValue.installedRelative)&&validIdentity(evidenceValue.installedFP)&&Number.isFinite(Date.parse(evidenceValue.approvedAt))&&Date.parse(evidenceValue.approvedAt)<=Date.now();
  if(usable){
   const file=within(reviewConfig.mediaRoot,evidenceValue.installedRelative);if(!file)return unavailable('approval-binding-unavailable');
   const actual=await regularIdentity(file);let reason=actual.reason==='file-missing'?'approved-copy-missing':actual.reason?'approved-copy-unavailable':null;
   if(!reason){const change=compareIdentity(evidenceValue.installedFP,actual.identity);reason=change==='ctime-changed'?'approved-copy-metadata-changed':change==='invalid'?'approved-identity-unavailable':change!=='same'?'approved-copy-changed':null;}
   if(result.reason.startsWith('approved-copy-')){if(reason!==result.reason)return unavailable('approved-copy-unavailable');}
   else if(reason)return unavailable('case-binding-changed');
   if(result.reason.startsWith('quarantine-')||result.reason==='retention-error-unresolved'){
    const qreason=await quarantineReason(c,binding?.binding,record.source,reviewConfig);
    if(result.reason.startsWith('quarantine-')&&qreason!==result.reason)return unavailable('quarantine-file-unavailable');
    if(result.reason==='retention-error-unresolved'&&qreason)return verified(qreason);
   }
  }
  return result;
 };
 if(record.source==='recovery'){
  const result=await recoveryCase({data,record});if(result.reason)return result;c=result.c;
  try{binding=await readRecoveryRestoreBinding({data:path.join(data,'recovery'),mode});}catch{return unavailable('configuration-unavailable');}
  const active=binding?.binding;
  if(!active||typeof active.mediaRoot!=='string'||typeof reviewConfig?.mediaRoot!=='string'||!path.isAbsolute(active.mediaRoot)||!path.isAbsolute(reviewConfig.mediaRoot)||path.resolve(active.mediaRoot)!==path.resolve(reviewConfig.mediaRoot)||typeof c.source!=='string'||!safeRelative(c.relative)||path.relative(path.resolve(active.mediaRoot),path.resolve(c.source)).replaceAll('\\','/')!==c.relative)return unavailable('configuration-binding-changed');
 }else if(record.source!=='recovery'){
  const result=await reviewCase({data,record,reviewConfig});if(result.reason)return result;c=result.c;
  if(typeof c.mediaRoot!=='string'||!path.isAbsolute(c.mediaRoot)||typeof c.reviewRoot!=='string'||!path.isAbsolute(c.reviewRoot)||typeof reviewConfig?.mediaRoot!=='string'||!path.isAbsolute(reviewConfig.mediaRoot)||typeof reviewConfig?.reviewRoot!=='string'||!path.isAbsolute(reviewConfig.reviewRoot)||path.resolve(c.mediaRoot)!==path.resolve(reviewConfig.mediaRoot)||path.resolve(c.reviewRoot)!==path.resolve(reviewConfig.reviewRoot))return unavailable('configuration-binding-changed');
 }else return unavailable('case-binding-unavailable');
 const relative=c.replacementRelative,sourceFP=c.replacementSourceFP;
 if(!safeRelative(relative)||!validIdentity(sourceFP))return unavailable('replacement-binding-unavailable');
 try{evidenceFile=await approvalEvidencePath(reviewConfig.mediaRoot,relative,sourceFP);}catch{return unavailable('configuration-binding-changed');}
 const evidence=await boundedJson(evidenceFile,16384);evidenceValue=evidence.value;evidenceWasMissing=evidence.missing===true;
 if(evidence.missing)return finish(verified('approval-evidence-missing'));
 if(evidence.unavailable)return unavailable('approval-evidence-unavailable');
 const approval=evidence.value;
 if(!object(approval)||approval.version!==1||typeof approval.relative!=='string'||typeof approval.sourceFP!=='string'||typeof approval.installedRelative!=='string'||typeof approval.installedFP!=='string'||typeof approval.approvedAt!=='string')return finish(verified('approval-evidence-invalid'));
 if(approval.relative!==relative||approval.sourceFP!==sourceFP)return finish(verified('approval-evidence-mismatch'));
 if(!safeRelative(approval.installedRelative)||!validIdentity(approval.installedFP))return finish(verified('approval-evidence-invalid'));
 if(!Number.isFinite(Date.parse(approval.approvedAt))||Date.parse(approval.approvedAt)>Date.now())return finish(verified('approval-time-invalid'));
 const installed=within(reviewConfig.mediaRoot,approval.installedRelative);
 if(!installed)return unavailable('approval-binding-unavailable');
 const current=await regularIdentity(installed);
 if(current.reason)return finish(verified(current.reason==='file-missing'?'approved-copy-missing':'approved-copy-unavailable'));
 const difference=compareIdentity(approval.installedFP,current.identity);
 if(difference==='invalid')return unavailable('approved-identity-unavailable');
 if(difference==='ctime-changed')return finish(verified('approved-copy-metadata-changed'));
 if(difference!=='same')return finish(verified('approved-copy-changed'));
 const quarantine=await quarantineReason(c,binding?.binding,record.source,reviewConfig);
 if(quarantine)return quarantine.endsWith('-unavailable')||quarantine==='quarantine-identity-unavailable'?unavailable(quarantine):finish(verified(quarantine));
 return finish(verified('retention-error-unresolved'));
}
