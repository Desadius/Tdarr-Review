import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {identityOf,compareIdentity} from './file-identity.mjs';
// Single source for the retention rules; the Review UI reads them from /api/quarantine.
export const quarantineRetention=Object.freeze({retentionDays:7,cleanupEnabled:true});
const unreadable=()=>Object.assign(Error('Recorded file identity is unreadable; quarantine preserved'),{code:'FILE_IDENTITY_INVALID'});
function under(root,rel){const p=path.resolve(root,rel);if(!rel||path.isAbsolute(rel)||p===root||!p.startsWith(root+path.sep))throw Error('Invalid retention path');return p;}
async function regular(p){if(await fs.realpath(path.dirname(p))!==path.dirname(p))throw Error('Symlink parent');const s=await fs.lstat(p);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)throw Error('Unsafe retention file');return s;}
function key(relative,sourceFP){return crypto.createHash('sha256').update(relative+'\0'+sourceFP).digest('hex')+'.json';}
/** The approval evidence file for an imported replacement, beside the library root (shared with Review, #230). */
export async function approvalEvidencePath(mediaRoot,relative,sourceFP){return path.join(path.dirname(await fs.realpath(mediaRoot)),'.tdarr-approvals',key(relative,sourceFP));}
/**
 * What an approval of an imported replacement is keyed by: the replacement's recorded identity, or for a case
 * recorded before Recovery kept that identity, Radarr's record of the imported file (#280). Null when neither binds.
 * @param {any} c The case.
 * @returns {{relative:string,sourceFP:string,legacy?:true}|null}
 */
export function approvalKey(c){
 if(typeof c?.replacementRelative!=='string'||!c.replacementRelative)return null;
 if(c.replacementSourceFP)return {relative:c.replacementRelative,sourceFP:c.replacementSourceFP};
 const r=c.replacement;
 if(!Number.isSafeInteger(r?.movieFileId)||r.movieFileId<=0||!Number.isSafeInteger(r?.size)||r.size<=0||typeof r.path!=='string'||!r.path.replaceAll('\\','/').endsWith('/'+c.replacementRelative))return null;
 return {relative:c.replacementRelative,sourceFP:'radarr-file:'+r.movieFileId+':'+r.size,legacy:true};
}
export async function publishApproval({mediaRoot,relative,sourceFP,installedRelative,atomic}){
 const parent=path.dirname(await fs.realpath(mediaRoot)),directory=path.join(parent,'.tdarr-approvals');await fs.mkdir(directory,{recursive:true,mode:0o770});if(await fs.realpath(directory)!==directory)throw Error('Approval directory symlink');
 const installed=under(mediaRoot,installedRelative),st=await regular(installed);
 const record={version:1,relative,sourceFP,installedRelative,installedFP:identityOf(st),approvedAt:new Date().toISOString()};
 const target=path.join(directory,key(relative,sourceFP));try{await fs.access(target);throw Error('Approval evidence already exists')}catch(e){if(e.code!=='ENOENT')throw e;}
 await atomic(target,record);return record;
}
const preserved=c=>[[c.quarantine||c.originalQuarantine,c.fp||c.originalFP],[c.reviewQuarantine,c.reviewFP]].filter(v=>v[0]);
async function absent(file){try{await fs.lstat(file);return false;}catch(e){if(e.code==='ENOENT')return true;throw e;}}
/**
 * @param {object} c The case.
 * @param {object} options
 * @param {(file:string,identity:string)=>Promise<boolean>} [options.deletedByUser] Whether the user deleted exactly this file through Review (#280).
 */
export async function retainCase(c,{mediaRoot,reviewRoot,quarantineRoot,reviewQuarantineRoot,atomicCase,deletedByUser=null,now=Date.now()}){
 const approval=approvalKey(c);if(!quarantineRetention.cleanupEnabled||!approval||c.cleanup?.complete)return;
 // Every preserved file was deleted by the user through Review: nothing is left to retain or to report.
 if(deletedByUser){const files=preserved(c);let all=files.length>0;for(const [file,expected]of files)if(!(all=all&&await absent(file)&&await deletedByUser(file,expected)))break;if(all)return;}
 let a;try{const f=await approvalEvidencePath(mediaRoot,approval.relative,approval.sourceFP);await regular(f);a=JSON.parse(await fs.readFile(f,'utf8'));}catch(e){if(e.code==='ENOENT')return;throw e;}
 if(a.version!==1||a.relative!==approval.relative||a.sourceFP!==approval.sourceFP||!Number.isFinite(Date.parse(a.approvedAt))||Date.parse(a.approvedAt)>now)throw Error('Invalid approval evidence');
 const installed=under(mediaRoot,a.installedRelative);const installedNow=identityOf(await regular(installed));
 if(installedNow!==a.installedFP){
  const change=compareIdentity(a.installedFP,installedNow);
  if(change==='invalid')throw unreadable();
  if(change==='ctime-changed')throw Error('Approved replacement metadata timestamp changed; content identity is not reverified; quarantine preserved');
  throw Error('Approved replacement changed; quarantine preserved');
 }
 if(!c.cleanup){c.cleanup={approvedAt:a.approvedAt,deleteAfter:new Date(Date.parse(a.approvedAt)+quarantineRetention.retentionDays*86400000).toISOString(),files:[]};await atomicCase(c);}
 if(now<Date.parse(c.cleanup.deleteAfter))return;
 const targets=preserved(c).map(([file,expected],i)=>[file,expected,i?reviewQuarantineRoot:quarantineRoot]);
 for(const [file,expected,root]of targets){
  const realRoot=await fs.realpath(root);const rel=path.relative(realRoot,file);if(under(realRoot,rel)!==file||path.dirname(file)!==path.join(realRoot,c.id))throw Error('Quarantine ownership mismatch');
  let entry=c.cleanup.files.find(v=>v.path===file);if(entry?.purged)continue;
  let st;try{st=await regular(file)}catch(e){
   if(e.code==='ENOENT'&&entry?.intent){entry.purged=true;await atomicCase(c);continue;}
   if(e.code==='ENOENT'&&await deletedByUser?.(file,expected)){c.cleanup.files.push({path:file,fp:expected,userDeleted:true,purged:true,time:new Date(now).toISOString()});await atomicCase(c);continue;}
   throw e;
  }
  // Moving the original into quarantine changes its ctime.
  const change=compareIdentity(expected,identityOf(st));if(change==='invalid')throw unreadable();
  if(!['same','ctime-changed'].includes(change))throw Error('Quarantine file changed; preserved');
  if(!entry){entry={path:file,fp:identityOf(st),intent:true};c.cleanup.files.push(entry);await atomicCase(c);}
  if(identityOf(await regular(installed))!==a.installedFP||identityOf(await regular(file))!==entry.fp)throw Error('Retention identity changed');
  await fs.unlink(file);entry.purged=true;entry.time=new Date(now).toISOString();await atomicCase(c);
  try{await fs.rmdir(path.dirname(file))}catch(e){if(!['ENOTEMPTY','ENOENT','EEXIST'].includes(e.code))throw e;}
 }
 c.cleanup.complete=true;c.cleanup.completedAt=new Date(now).toISOString();await atomicCase(c);
}
