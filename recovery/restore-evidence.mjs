import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {caseId} from './policy.mjs';

const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const bindingKeys=['tdarrUrl','radarrUrl','radarrApiKey','libraryId','sourceRoot','radarrRoot','mediaRoot','quarantineRoot','database'];
const editionBindingKeys=bindingKeys.filter(key=>key!=='radarrApiKey');
export function recoveryRestoreBindingDigest(cfg){
 return crypto.createHash('sha256').update(JSON.stringify(Object.fromEntries(bindingKeys.map(key=>[key,cfg[key]])))).digest('hex');
}
export function recoveryRestoreEditionBindingDigest(cfg){
 return crypto.createHash('sha256').update(JSON.stringify(Object.fromEntries(editionBindingKeys.map(key=>[key,cfg[key]])))).digest('hex');
}
const evidenceFile=(reviewData,file,identity)=>path.join(reviewData,'recovery-restores','editions',caseId(file,identity)+'.json');
async function syncDirectory(directory){const handle=await fs.open(directory,'r');try{await handle.sync();}finally{await handle.close();}}

/** Persist exact Review-owned evidence after the destination copy is installed and verified. */
export async function writeRecoveryRestoreEvidence({data,operationId,caseId:sourceCaseId,movieId,tmdbId,file,identity,cfg,restoredAt}){
 const target=evidenceFile(data,file,identity);await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});
 const value={version:1,kind:'restored-recovery-original',operationId,sourceCaseId,movieId,tmdbId,file,identity,binding:recoveryRestoreEditionBindingDigest(cfg),restoredAt};
 let handle;
 try{handle=await fs.open(target,'wx',0o600);await handle.writeFile(JSON.stringify(value));await handle.sync();await handle.close();await syncDirectory(path.dirname(target));}
 catch(error){await handle?.close().catch(()=>{});if(error?.code!=='EEXIST')throw error;
  const existing=await readFile(target);if(!existing||existing.version!==value.version||existing.kind!==value.kind||existing.operationId!==value.operationId||existing.sourceCaseId!==value.sourceCaseId||existing.movieId!==value.movieId||existing.tmdbId!==value.tmdbId||existing.file!==value.file||existing.identity!==value.identity||existing.binding!==value.binding)throw Error('restore-evidence-conflict');
 }
 return target;
}
async function readFile(file){
 let stat;
 try{stat=await fs.lstat(file);}catch(error){if(error?.code==='ENOENT')return null;throw Object.assign(Error('restore-evidence-unreadable'),{code:'restore-evidence-unreadable'});}
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>16384)throw Object.assign(Error('restore-evidence-invalid'),{code:'restore-evidence-invalid'});
 try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{throw Object.assign(Error('restore-evidence-invalid'),{code:'restore-evidence-invalid'});}
}
/** Return true only for the same current path, exact current file identity and active binding. */
export async function hasRecoveryRestoreEvidence({data,file,identity,cfg}){
 const target=evidenceFile(data,file,identity),value=await readFile(target);
 if(!value)return false;
 if(!object(value)||value.version!==1||value.kind!=='restored-recovery-original'||typeof value.operationId!=='string'||!/^[-a-f0-9]{36}$/.test(value.operationId)||
  typeof value.sourceCaseId!=='string'||!/^[a-f0-9]{24}$/.test(value.sourceCaseId)||!Number.isSafeInteger(value.movieId)||!Number.isSafeInteger(value.tmdbId)||
  value.file!==file||value.identity!==identity||typeof value.binding!=='string'||!/^[a-f0-9]{64}$/.test(value.binding)||typeof value.restoredAt!=='string'||
  caseId(file,value.identity)!==path.basename(target,'.json'))throw Object.assign(Error('restore-evidence-invalid'),{code:'restore-evidence-invalid'});
 return value.binding===recoveryRestoreEditionBindingDigest(cfg);
}
