import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import {spawn as spawnProcess} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Optional full-file SHA-256 of an original (config `fullSourceHash`). Sampling stays the
// default identity check; this reads every byte once at confirmation and once before the
// quarantine rename. The worker runs it in a child process at idle I/O and CPU priority.
const SELF=fileURLToPath(import.meta.url);

export async function hashFile(file,{onProgress=()=>{},chunkSize=4*1024*1024}={}){
 const total=(await fsp.stat(file)).size,hash=crypto.createHash('sha256');let done=0;
 await new Promise((resolve,reject)=>{
  const stream=fs.createReadStream(file,{highWaterMark:chunkSize});
  stream.on('data',chunk=>{hash.update(chunk);done+=chunk.length;onProgress({done,total})});
  stream.on('error',reject);stream.on('end',resolve);
 });
 if(done!==total)throw Error('Source size changed during full hash');
 return hash.digest('hex');
}

// Command for the child process: idle I/O class and lowest CPU priority when available.
export function hashCommand(file,{platform=process.platform,exists=fs.existsSync,node=process.execPath}={}){
 const child=[node,SELF,file];
 if(platform==='linux'&&exists('/usr/bin/ionice')&&exists('/usr/bin/nice'))return ['/usr/bin/ionice',['-c','3','/usr/bin/nice','-n','19',...child]];
 return [node,[SELF,file]];
}

export function lowPriorityHash(file,{onProgress=()=>{},spawn=spawnProcess,command=hashCommand(file)}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(command[0],command[1],{stdio:['ignore','pipe','pipe']});
  let buffer='',result=null,stderr='';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',chunk=>{buffer+=chunk;let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);let message;try{message=JSON.parse(line)}catch{continue}
   if(typeof message.sha256==='string'&&/^[a-f0-9]{64}$/.test(message.sha256))result=message.sha256;
   else if(Number.isSafeInteger(message.done)&&Number.isSafeInteger(message.total))onProgress({done:message.done,total:message.total});}});
  child.stderr.on('data',chunk=>{if(stderr.length<4000)stderr+=chunk});
  child.on('error',reject);
  child.on('close',code=>code===0&&result?resolve(result):reject(Error('Full source hash failed'+(stderr?': '+stderr.trim().slice(0,500):' (exit '+code+')'))));
 });
}

// Child entry point: prints progress at most every 2 s, then the digest.
if(process.argv[1]&&path.resolve(process.argv[1])===SELF){
 let last=0;
 hashFile(process.argv[2],{onProgress:p=>{const now=Date.now();if(now-last>=2000||p.done===p.total){last=now;process.stdout.write(JSON.stringify(p)+'\n')}}})
  .then(sha256=>{process.stdout.write(JSON.stringify({sha256})+'\n')})
  .catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1});
}
