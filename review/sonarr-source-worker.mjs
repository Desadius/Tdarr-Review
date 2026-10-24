import fs from 'node:fs/promises';
import path from 'node:path';
import {identityOf} from '../recovery/file-identity.mjs';

const maxInput=4096,maxOutput=2048;
const supported=new Set(['.mkv','.mp4','.m4v','.avi','.mov','.wmv','.webm','.ts','.m2ts']);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sameDirectory=(a,b)=>a.isDirectory()&&b.isDirectory()&&a.dev===b.dev&&a.ino===b.ino&&a.mode===b.mode;
function reply(status,metadata={}){
 const text=JSON.stringify({status,...metadata});
 if(Buffer.byteLength(text)>maxOutput)process.exitCode=1;else process.stdout.write(text+'\n');
}
function inputShape(value){
 if(!plain(value)||Object.keys(value).some(key=>!['mediaRoot','relative'].includes(key))||typeof value.mediaRoot!=='string'||typeof value.relative!=='string')return false;
 if(!path.posix.isAbsolute(value.mediaRoot)||value.mediaRoot==='/'||value.mediaRoot.length>2048||value.mediaRoot.includes('\\')||value.mediaRoot.includes('\0')||path.posix.normalize(value.mediaRoot)!==value.mediaRoot)return false;
 if(!value.relative||value.relative.length>4096||value.relative.startsWith('/')||value.relative.includes('\\')||value.relative.includes('\0')||value.relative.split('/').some(part=>!part||part==='.'||part==='..'||part.length>255))return false;
 return true;
}
async function guarded(mediaRoot,relative){
 const rootParts=mediaRoot.split('/').filter(Boolean),roots=[];let at='/';
 roots.push({path:at,stat:await fs.lstat(at)});
 for(const part of rootParts){at=path.posix.join(at,part);const stat=await fs.lstat(at);if(stat.isSymbolicLink()||!stat.isDirectory())return {status:'unsafe'};roots.push({path:at,stat});}
 if(roots.some(entry=>entry.stat.isSymbolicLink()||!entry.stat.isDirectory()))return {status:'unsafe'};
 const rootReal=await fs.realpath(mediaRoot);if(rootReal!==mediaRoot)return {status:'unsafe'};
 const relativeParts=relative.split('/'),observed=[],full=path.posix.join(mediaRoot,...relativeParts);
 if(!full.startsWith(mediaRoot+'/'))return {status:'unsafe'};
 let walk=mediaRoot,first=null;
 for(let index=0;index<relativeParts.length;index++){
  walk=path.posix.join(walk,relativeParts[index]);let stat;
  try{stat=await fs.lstat(walk)}catch(error){if(error.code==='ENOENT'||error.code==='ENOTDIR')return {status:'missing'};throw error;}
  if(stat.isSymbolicLink()||index<relativeParts.length-1&&!stat.isDirectory())return {status:'unsafe'};
  observed.push({path:walk,stat});if(index===relativeParts.length-1)first=stat;
 }
 if(!first)return {status:'unsafe'};
 const extension=path.posix.extname(relative).toLowerCase();if(!supported.has(extension))return {status:'unsupported'};
 if(!first.isFile()||first.nlink!==1)return {status:'unsafe'};
 const fileReal=await fs.realpath(full);if(fileReal!==full)return {status:'unsafe'};
 const second=await fs.lstat(full);if(second.isSymbolicLink()||!second.isFile()||second.nlink!==1||identityOf(first)!==identityOf(second))return {status:'changed'};
 for(const entry of roots){const stat=await fs.lstat(entry.path);if(stat.isSymbolicLink()||!sameDirectory(entry.stat,stat))return {status:'changed'};}
 for(const entry of observed){const stat=await fs.lstat(entry.path);if(stat.isSymbolicLink()||entry.stat.isDirectory()&&!sameDirectory(entry.stat,stat)||!entry.stat.isDirectory()&&identityOf(entry.stat)!==identityOf(stat))return {status:'changed'};}
 if(await fs.realpath(full)!==full)return {status:'changed'};
 const rootRealAgain=await fs.realpath(mediaRoot);if(rootRealAgain!==mediaRoot)return {status:'changed'};
 return {status:'present',size:second.size,modifiedAt:Math.round(second.mtimeMs)};
}

let raw='';let rejected=false;
for await(const chunk of process.stdin){raw+=chunk;if(Buffer.byteLength(raw)>maxInput){rejected=true;break;}}
if(rejected){reply('unavailable');process.exitCode=1;}
else{
 let input;try{input=JSON.parse(raw);}catch{}
 if(!inputShape(input)){reply('unsafe');process.exitCode=1;}
 else try{const result=await guarded(input.mediaRoot,input.relative);const {status,...metadata}=result;reply(status,metadata);}catch{reply('unavailable');process.exitCode=1;}
}
