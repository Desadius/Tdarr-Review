import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';

const MAX_BYTES=32*1024,MAX_NOTE=1000;
const idPattern=/^[a-f0-9]{24}$/;
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const invalid=()=>({invalid:true});
const validRecord=value=>object(value)&&value.version===1&&['recovery','radarr'].includes(value.source)&&idPattern.test(value.id||'')&&
 ['deferred','reopened','invalidated'].includes(value.state)&&typeof value.note==='string'&&value.note.length<=MAX_NOTE&&
 typeof value.fingerprint==='string'&&/^[a-f0-9]{64}$/.test(value.fingerprint)&&typeof value.revision==='string'&&/^[a-f0-9]{64}$/.test(value.revision);

/** Review-owned, source-namespaced records of attention cases closed unchanged ("deferred"), with an optional note. */
export function createRecoveryDeferrals({data}){
 const directory=path.join(data,'recovery-deferrals'),secret=crypto.randomBytes(32),queues=new Map();
 const file=(source,id)=>path.join(directory,source+'-'+id+'.json');
 const token=(source,id,fingerprint,state,revision)=>crypto.createHmac('sha256',secret).update([source,id,fingerprint,state,revision||'none'].join('\0')).digest('hex');
 async function safeDataRoot(){
  const st=await fs.lstat(data);if(!st.isDirectory()||st.isSymbolicLink()||await fs.realpath(data)!==path.resolve(data))throw Object.assign(new Error('deferral_unavailable'),{code:'deferral_unavailable'});return st;
 }
 async function read(source,id){
  const target=file(source,id);
  let handle;
  try{
   await safeDataRoot();
   let dirStat;try{dirStat=await fs.lstat(directory)}catch(error){if(error.code==='ENOENT')return null;return invalid();}
   if(!dirStat.isDirectory()||dirStat.isSymbolicLink()||(dirStat.mode&0o077)!==0||await fs.realpath(directory)!==path.resolve(directory))return invalid();
   const link=await fs.lstat(target);if(link.isSymbolicLink()||!link.isFile()||link.nlink!==1||link.size>MAX_BYTES||(link.mode&0o077)!==0)return invalid();
   handle=await fs.open(target,constants.O_RDONLY|(constants.O_NOFOLLOW||0)|(constants.O_NONBLOCK||0));const st=await handle.stat();if(!st.isFile()||st.nlink!==1||st.size>MAX_BYTES||(st.mode&0o077)!==0||st.dev!==link.dev||st.ino!==link.ino)return invalid();
   const before={dev:st.dev,ino:st.ino,size:st.size,mtimeMs:st.mtimeMs,ctimeMs:st.ctimeMs};
   const bytes=Buffer.alloc(MAX_BYTES+1);let size=0;while(size<bytes.length){const result=await handle.read(bytes,size,bytes.length-size,size);if(!result.bytesRead)break;size+=result.bytesRead;}if(size>MAX_BYTES)return invalid();
   const after=await handle.stat();if(after.dev!==before.dev||after.ino!==before.ino||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)return invalid();
   let value;try{value=JSON.parse(bytes.subarray(0,size).toString('utf8'));}catch{return invalid();}
   return validRecord(value)&&value.source===source&&value.id===id?value:invalid();
  }catch(error){return error.code==='ENOENT'?null:invalid();}finally{await handle?.close().catch(()=>{});}
 }
 async function syncDirectory(dir){if(process.platform==='win32')return;const handle=await fs.open(dir,'r');try{await handle.sync();}finally{await handle.close();}}
 async function write(record){
  await safeDataRoot();
  try{await fs.lstat(directory);}catch(error){if(error.code!=='ENOENT')throw error;try{await fs.mkdir(directory,{mode:0o700});}catch(createError){if(createError.code!=='EEXIST')throw createError;}}
  await safeDataRoot();const dirStat=await fs.lstat(directory);if(!dirStat.isDirectory()||dirStat.isSymbolicLink()||(dirStat.mode&0o077)!==0||await fs.realpath(directory)!==path.resolve(directory))throw Object.assign(new Error('deferral_unavailable'),{code:'deferral_unavailable'});await syncDirectory(path.dirname(directory));
  const target=file(record.source,record.id),temp=target+'.'+crypto.randomBytes(12).toString('hex')+'.tmp',handle=await fs.open(temp,'wx',0o600);
  try{await handle.writeFile(JSON.stringify(record));await handle.sync();}finally{await handle.close();}
  try{await safeDataRoot();const current=await fs.lstat(directory);if(!current.isDirectory()||current.isSymbolicLink()||current.dev!==dirStat.dev||current.ino!==dirStat.ino||await fs.realpath(directory)!==path.resolve(directory))throw Object.assign(new Error('deferral_unavailable'),{code:'deferral_unavailable'});await fs.rename(temp,target);const dir=await fs.open(directory,'r');try{await dir.sync();}finally{await dir.close();}}
  catch(error){await fs.rm(temp,{force:true});throw error;}
 }
 async function serialized(key,work){const previous=queues.get(key)||Promise.resolve();let release;const next=new Promise(resolve=>{release=resolve});queues.set(key,next);await previous;try{return await work()}finally{release();if(queues.get(key)===next)queues.delete(key);}}
 async function view(source,id,fingerprint){
  if(!['recovery','radarr'].includes(source)||!idPattern.test(id||''))return null;
  const old=await read(source,id);if(!old)return null;if(old.invalid)return old;
  if(old.state==='deferred'&&fingerprint&&old.fingerprint!==fingerprint){
   return serialized(source+':'+id,async()=>{const current=await read(source,id);if(!current||current.revision!==old.revision||current.state!=='deferred')return current;
    const invalidated={...current,state:'invalidated',revision:crypto.randomBytes(32).toString('hex')};await write(invalidated);return invalidated;});
  }
  return old;
 }
 async function defer({source,id,fingerprint,revision,note,recheck}){
  return serialized(source+':'+id,async()=>{
   if(!['recovery','radarr'].includes(source)||!idPattern.test(id||'')||!/^[a-f0-9]{64}$/.test(fingerprint||''))throw Object.assign(new Error('deferral_unavailable'),{code:'deferral_unavailable'});
   // Closing a case unchanged needs no note; one may still be left for the next person.
   if(note===undefined)note='';
   if(typeof note!=='string'||note.length>MAX_NOTE)throw Object.assign(new Error('deferral_note_invalid'),{code:'deferral_note_invalid'});
   const old=await read(source,id);if(old?.invalid)throw Object.assign(new Error('deferral_unavailable'),{code:'deferral_unavailable'});if(old?.state==='deferred')throw Object.assign(new Error('deferral_conflict'),{code:'deferral_conflict'});
   const expected=token(source,id,fingerprint,old?.state||'none',old?.revision||'none');if(typeof revision!=='string'||!/^[a-f0-9]{64}$/.test(revision)||!crypto.timingSafeEqual(Buffer.from(revision),Buffer.from(expected)))throw Object.assign(new Error('deferral_stale'),{code:'deferral_stale'});
   if(await recheck?.()!==fingerprint)throw Object.assign(new Error('deferral_stale'),{code:'deferral_stale'});
   const record={version:1,source,id,state:'deferred',note:note.trim(),fingerprint,revision:crypto.randomBytes(32).toString('hex'),updatedAt:new Date().toISOString()};await write(record);return {state:record.state,revision:token(source,id,fingerprint,record.state,record.revision)};
  });
 }
 async function reopen({source,id,fingerprint,revision,recheck}){
  return serialized(source+':'+id,async()=>{
   const old=await read(source,id);if(old?.invalid)throw Object.assign(new Error('deferral_unavailable'),{code:'deferral_unavailable'});if(!old||old.state!=='deferred'||old.fingerprint!==fingerprint)throw Object.assign(new Error('deferral_conflict'),{code:'deferral_conflict'});
   const expected=token(source,id,fingerprint,old.state,old.revision);if(typeof revision!=='string'||!/^[a-f0-9]{64}$/.test(revision)||!crypto.timingSafeEqual(Buffer.from(revision),Buffer.from(expected)))throw Object.assign(new Error('deferral_stale'),{code:'deferral_stale'});
   if(await recheck?.()!==fingerprint)throw Object.assign(new Error('deferral_stale'),{code:'deferral_stale'});
   const record={...old,state:'reopened',revision:crypto.randomBytes(32).toString('hex'),updatedAt:new Date().toISOString()};await write(record);return {state:record.state,note:record.note};
  });
 }
 function revision(source,id,fingerprint,record){return record?.invalid?null:token(source,id,fingerprint,record?.state||'none',record?.revision||'none');}
 return {view,defer,reopen,revision};
}
