import fs from 'node:fs/promises';
import path from 'node:path';

// Durable, append-only record of approvals and Radarr replacement requests
// (rejections keep their own archive in rejection-audit.mjs). Each record is
// fsynced; when the file would exceed maxBytes it is renamed to a timestamped
// archive, the directory is fsynced, and a new file starts. Archives are never
// deleted or rewritten.
export const AUDIT_FILE='decision-audit.jsonl';
export const AUDIT_MAX_BYTES=10*1024*1024;
let chain=Promise.resolve();

async function syncDirectory(directory){
 const handle=await fs.open(directory,'r');
 try{await handle.sync()}finally{await handle.close()}
}

async function rotate(directory,file,now){
 const stamp=now.toISOString().replace(/[:.]/g,'-');
 let target=path.join(directory,`decision-audit-${stamp}.jsonl`);
 for(let n=1;await fs.lstat(target).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e});n++)target=path.join(directory,`decision-audit-${stamp}-${n}.jsonl`);
 await fs.rename(file,target);
 await syncDirectory(directory);
 return target;
}

async function append(data,record,{maxBytes=AUDIT_MAX_BYTES,now=new Date()}={}){
 const file=path.join(data,AUDIT_FILE),line=JSON.stringify({...record,time:record.time||now.toISOString()})+'\n';
 const current=await fs.lstat(file).catch(e=>{if(e.code==='ENOENT')return null;throw e});
 if(current&&(!current.isFile()||current.isSymbolicLink()))throw Error('Audit rozhodnutí není běžný soubor.');
 if(current&&current.size>0&&current.size+Buffer.byteLength(line)>maxBytes)await rotate(data,file,now);
 const created=!current||current.size+Buffer.byteLength(line)>maxBytes;
 const handle=await fs.open(file,'a',0o600);
 try{await handle.writeFile(line);await handle.sync()}finally{await handle.close()}
 if(created)await syncDirectory(data);
}

// Appends are serialized so concurrent callers can never interleave or race a rotation.
export function recordDecision(data,record,options){
 const result=chain.then(()=>append(data,record,options));
 chain=result.catch(()=>{});
 return result;
}
