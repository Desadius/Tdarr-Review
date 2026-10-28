import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {compareIdentity} from './file-identity.mjs';

// Evidence that the user deleted one exact quarantined file through Review (#280). Review writes it durably
// before the unlink, in its own data directory; Recovery's and Review's quarantine retention then accept that
// file's absence instead of reporting a retention error. The record names the case folder, the file name and
// the file identity at deletion, never a mount-specific path, because Recovery and Review may reach the same
// share under different mounts.

const idPattern=/^[a-f0-9]{24}$/;
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const directory=data=>path.join(data,'quarantine-deletions');
const target=(data,caseId,name)=>path.join(directory(data),caseId+'-'+crypto.createHash('sha256').update(name).digest('hex').slice(0,32)+'.json');
async function syncDirectory(dir){if(process.platform==='win32')return;const handle=await fs.open(dir,'r');try{await handle.sync();}finally{await handle.close();}}
const validName=name=>typeof name==='string'&&!!name&&name.length<=1024&&!name.includes('/')&&!name.includes('\\')&&name!=='.'&&name!=='..'&&!name.includes('\0');

async function read(file){
 let st;try{st=await fs.lstat(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}
 if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>16384)throw Error('Invalid quarantine deletion evidence');
 const value=JSON.parse(await fs.readFile(file,'utf8'));
 if(!object(value)||value.version!==1||value.kind!=='user-deleted-quarantine'||!idPattern.test(value.caseId||'')||!validName(value.name)||typeof value.identity!=='string'||!Number.isFinite(Date.parse(value.deletedAt)))throw Error('Invalid quarantine deletion evidence');
 return value;
}

/** Durably records the deletion the user confirmed, before the file is removed. */
export async function writeQuarantineDeletion({data,caseId,name,identity,bytes,now=Date.now()}){
 if(!idPattern.test(caseId||'')||!validName(name)||typeof identity!=='string')throw Error('Invalid quarantine deletion');
 await fs.mkdir(directory(data),{recursive:true,mode:0o700});
 const file=target(data,caseId,name),value={version:1,kind:'user-deleted-quarantine',caseId,name,identity,bytes,deletedAt:new Date(now).toISOString()};
 const temp=file+'.'+crypto.randomBytes(8).toString('hex')+'.tmp',handle=await fs.open(temp,'wx',0o600);
 try{await handle.writeFile(JSON.stringify(value));await handle.sync();}finally{await handle.close();}
 await fs.rename(temp,file);await syncDirectory(directory(data));
 return value;
}

/** Whether the user deleted exactly this quarantined file: same case folder, name and (allowing a ctime change) identity. */
export async function userDeletedQuarantine({data,file,identity}){
 if(typeof data!=='string'||typeof file!=='string')return false;
 const caseId=path.basename(path.dirname(file)),name=path.basename(file);
 if(!idPattern.test(caseId)||!validName(name))return false;
 const value=await read(target(data,caseId,name));
 return !!value&&value.caseId===caseId&&value.name===name&&(!identity||['same','ctime-changed'].includes(compareIdentity(identity,value.identity)));
}

/** The case folders in which the user deleted a quarantined file. */
export async function deletedQuarantineCases({data}){
 const ids=new Set();let names;
 try{names=await fs.readdir(directory(data));}catch(error){if(error.code==='ENOENT')return ids;throw error;}
 for(const name of names){const id=name.slice(0,24);if(!name.endsWith('.json')||name[24]!=='-'||!idPattern.test(id)||ids.has(id))continue;try{if((await read(path.join(directory(data),name)))?.caseId===id)ids.add(id);}catch{}}
 return ids;
}
