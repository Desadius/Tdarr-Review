import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {identityOf,compareIdentity} from '../recovery/file-identity.mjs';
// Single source for the retention rules; the Review UI reads them from /api/quarantine.
export const quarantineRetention=Object.freeze({retentionDays:7,cleanupEnabled:true});
function under(root,rel){const p=path.resolve(root,rel);if(!rel||path.isAbsolute(rel)||p===root||!p.startsWith(root+path.sep))throw Error('Invalid retention path');return p;}
async function regular(p){if(await fs.realpath(path.dirname(p))!==path.dirname(p))throw Error('Symlink parent');const s=await fs.lstat(p);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)throw Error('Unsafe retention file');return s;}
function key(relative,sourceFP){return crypto.createHash('sha256').update(relative+'\0'+sourceFP).digest('hex')+'.json';}
export async function publishApproval({mediaRoot,relative,sourceFP,installedRelative,atomic}){
 const parent=path.dirname(await fs.realpath(mediaRoot)),directory=path.join(parent,'.tdarr-approvals');await fs.mkdir(directory,{recursive:true,mode:0o770});if(await fs.realpath(directory)!==directory)throw Error('Approval directory symlink');
 const installed=under(mediaRoot,installedRelative),st=await regular(installed);
 const record={version:1,relative,sourceFP,installedRelative,installedFP:identityOf(st),approvedAt:new Date().toISOString()};
 const target=path.join(directory,key(relative,sourceFP));try{await fs.access(target);throw Error('Approval evidence already exists')}catch(e){if(e.code!=='ENOENT')throw e;}
 await atomic(target,record);return record;
}
export async function retainCase(c,{mediaRoot,reviewRoot,quarantineRoot,reviewQuarantineRoot,atomicCase,now=Date.now()}){
 if(!quarantineRetention.cleanupEnabled||!c.replacementSourceFP||!c.replacementRelative||c.cleanup?.complete)return;
 const directory=path.join(path.dirname(await fs.realpath(mediaRoot)),'.tdarr-approvals');
 let a;try{const f=path.join(directory,key(c.replacementRelative,c.replacementSourceFP));await regular(f);a=JSON.parse(await fs.readFile(f,'utf8'));}catch(e){if(e.code==='ENOENT')return;throw e;}
 if(a.version!==1||a.relative!==c.replacementRelative||a.sourceFP!==c.replacementSourceFP||!Number.isFinite(Date.parse(a.approvedAt))||Date.parse(a.approvedAt)>now)throw Error('Invalid approval evidence');
 const installed=under(mediaRoot,a.installedRelative);const installedNow=identityOf(await regular(installed));
 if(installedNow!==a.installedFP){
  if(compareIdentity(a.installedFP,installedNow)==='ctime-changed')throw Error('Approved replacement metadata timestamp changed; content identity is not reverified; quarantine preserved');
  throw Error('Approved replacement changed; quarantine preserved');
 }
 if(!c.cleanup){c.cleanup={approvedAt:a.approvedAt,deleteAfter:new Date(Date.parse(a.approvedAt)+quarantineRetention.retentionDays*86400000).toISOString(),files:[]};await atomicCase(c);}
 if(now<Date.parse(c.cleanup.deleteAfter))return;
 const targets=[[c.quarantine||c.originalQuarantine,c.fp||c.originalFP,quarantineRoot],[c.reviewQuarantine,c.reviewFP,reviewQuarantineRoot]].filter(v=>v[0]);
 for(const [file,expected,root]of targets){
  const realRoot=await fs.realpath(root);const rel=path.relative(realRoot,file);if(under(realRoot,rel)!==file||path.dirname(file)!==path.join(realRoot,c.id))throw Error('Quarantine ownership mismatch');
  let entry=c.cleanup.files.find(v=>v.path===file);if(entry?.purged)continue;
  let st;try{st=await regular(file)}catch(e){if(e.code==='ENOENT'&&entry?.intent){entry.purged=true;await atomicCase(c);continue;}throw e;}
  // Moving the original into quarantine changes its ctime.
  if(!['same','ctime-changed'].includes(compareIdentity(expected,identityOf(st))))throw Error('Quarantine file changed; preserved');
  if(!entry){entry={path:file,fp:identityOf(st),intent:true};c.cleanup.files.push(entry);await atomicCase(c);}
  if(identityOf(await regular(installed))!==a.installedFP||identityOf(await regular(file))!==entry.fp)throw Error('Retention identity changed');
  await fs.unlink(file);entry.purged=true;entry.time=new Date(now).toISOString();await atomicCase(c);
  try{await fs.rmdir(path.dirname(file))}catch(e){if(!['ENOTEMPTY','ENOENT','EEXIST'].includes(e.code))throw e;}
 }
 c.cleanup.complete=true;c.cleanup.completedAt=new Date(now).toISOString();await atomicCase(c);
}
