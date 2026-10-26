import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {constants as fsConstants} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {identityOf,compareIdentity} from '../recovery/file-identity.mjs';

const maxReceipt=65536,sampleBytes=1024*1024,maxOutput=256*1024;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sameDirectory=(a,b)=>a.isDirectory()&&b.isDirectory()&&a.dev===b.dev&&a.ino===b.ino&&a.mode===b.mode;
const sameIdentity=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;
const fault=code=>Object.assign(Error(),{code});
const sameFile=(a,b)=>compareIdentity(a,b)==='same';

function validInput(value){
 if(!plain(value)||Object.keys(value).some(key=>!['mediaRoot','reviewRoot','database','relative','outputRelatives'].includes(key))||
  typeof value.mediaRoot!=='string'||typeof value.reviewRoot!=='string'||typeof value.database!=='string'||!Array.isArray(value.outputRelatives)||value.outputRelatives.length<1||value.outputRelatives.length>40)return false;
 for(const root of [value.mediaRoot,value.reviewRoot,value.database])if(!root.startsWith('/')||root==='/'||root.length>2048||root.includes('\\')||root.includes('\0')||path.posix.normalize(root)!==root)return false;
 const relative=value=>typeof value==='string'&&value.length>0&&value.length<=4096&&!value.startsWith('/')&&!value.includes('\\')&&!value.includes('\0')&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'&&part.length<=255);
 return relative(value.relative)&&value.outputRelatives.every(relative)&&new Set(value.outputRelatives).size===value.outputRelatives.length;
}

async function rootSnapshot(root){
 const parts=root.split('/').filter(Boolean),entries=[];let current='/';
 entries.push({path:current,stat:await fs.lstat(current)});
 for(const part of parts){current=path.posix.join(current,part);const stat=await fs.lstat(current);if(stat.isSymbolicLink()||!stat.isDirectory())throw fault('unsafe');entries.push({path:current,stat});}
 if(await fs.realpath(root)!==root)throw fault('unsafe');return entries;
}
async function openBounded(root,relative,{optional=false,limit=Number.MAX_SAFE_INTEGER,readContent=false}={}){
 const roots=await rootSnapshot(root),parts=relative.split('/'),observed=[];let current=root;
 for(let i=0;i<parts.length-1;i++){
  current=path.posix.join(current,parts[i]);const stat=await fs.lstat(current);
  if(stat.isSymbolicLink()||!stat.isDirectory())throw fault('unsafe');observed.push({path:current,stat});
 }
 const file=path.posix.join(root,...parts);let handle,targetBefore;
 try{targetBefore=await fs.lstat(file);}catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
 if(targetBefore.isSymbolicLink()||!targetBefore.isFile()||targetBefore.nlink!==1)throw fault('unsafe');
 try{handle=await fs.open(file,fsConstants.O_RDONLY|fsConstants.O_NOFOLLOW|fsConstants.O_NONBLOCK);}
 catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
 try{
  const before=await handle.stat();if(!before.isFile()||before.nlink!==1||before.size>limit)throw fault('unsafe');if(!sameIdentity(before,targetBefore))throw fault('changed');
  const data=readContent?Buffer.alloc(before.size):null;
  if(data){let offset=0;while(offset<data.length){const {bytesRead}=await handle.read(data,offset,data.length-offset,offset);if(!bytesRead)throw fault('changed');offset+=bytesRead;}}
  const after=await handle.stat();if(!sameIdentity(before,after))throw fault('changed');
  for(const entry of roots){const currentStat=await fs.lstat(entry.path);if(!sameDirectory(entry.stat,currentStat))throw fault('changed');}
  for(const entry of observed){const currentStat=await fs.lstat(entry.path);if(!sameDirectory(entry.stat,currentStat))throw fault('changed');}
  const currentStat=await fs.lstat(file);if(currentStat.isSymbolicLink()||!currentStat.isFile()||!sameIdentity(before,currentStat))throw fault('changed');
  if(await fs.realpath(file)!==file)throw fault('unsafe');
  return {handle,stat:before,path:file,data,fingerprint:identityOf(before)};
 }catch(error){await handle.close();throw error;}
}
async function close(record){await record?.handle.close();}
async function sample(record){
 const len=Math.min(record.stat.size,sampleBytes),buf=Buffer.alloc(len),hash=crypto.createHash('sha256');
 for(const offset of [0,Math.max(0,record.stat.size-len)]){let done=0;while(done<len){const {bytesRead}=await record.handle.read(buf,done,len-done,offset+done);if(!bytesRead)throw fault('changed');done+=bytesRead;}hash.update(buf);}
 return {size:record.stat.size,mtime:Math.round(record.stat.mtimeMs),sample:hash.digest('hex')};
}
function validIdentity(value){return plain(value)&&Number.isSafeInteger(value.size)&&value.size>0&&Number.isSafeInteger(value.mtime)&&/^[a-f0-9]{64}$/.test(value.sample);}
function sameRecorded(a,b){return validIdentity(a)&&validIdentity(b)&&a.size===b.size&&a.mtime===b.mtime&&a.sample===b.sample;}
async function one(root,relative,receiptRelative=null){
 const file=await openBounded(root,relative);let receipt;
 try{
  const identity=await sample(file);if(receiptRelative){receipt=await openBounded(root,receiptRelative,{optional:true,limit:maxReceipt,readContent:true});}
  const fresh=await file.handle.stat();if(!sameIdentity(file.stat,fresh))throw fault('changed');
  return {identity,fileFingerprint:file.fingerprint,receiptFingerprint:receipt?.fingerprint??null,receipt:receipt?.data?JSON.parse(receipt.data.toString('utf8')):null};
 }finally{await close(receipt);await close(file);}
}
async function exactJobs(database,receipt){
 if(typeof receipt?.jobId!=='string'||!receipt.jobId||receipt.jobId!==receipt.jobId.trim()||receipt.jobId.length>512)return {status:'unsupported'};
 const parents=await rootSnapshot(path.posix.dirname(database)),fileStat=await fs.lstat(database);
 if(fileStat.isSymbolicLink()||!fileStat.isFile()||fileStat.nlink!==1)return {status:'unsafe'};
 let db;
 try{
  db=new DatabaseSync(database,{readOnly:true});
  const rows=db.prepare("SELECT CASE WHEN length(json_data)<=65536 THEN json_data ELSE NULL END AS json_data,length(json_data) AS bytes FROM jobsjsondb WHERE json_extract(json_data, '$._id') = ? LIMIT 2").all(receipt.jobId);
  if(rows.some(row=>row.bytes>65536||typeof row.json_data!=='string'))return {status:'unsupported'};
  const after=await fs.lstat(database);
  if(!sameIdentity(fileStat,after))return {status:'changed'};
  for(const entry of parents){const current=await fs.lstat(entry.path);if(!sameDirectory(entry.stat,current))return {status:'changed'};}
  return {status:'ok',rows:rows.map(row=>JSON.parse(row.json_data)),fileFingerprint:identityOf(fileStat)};
 }catch{return {status:'unavailable'};}finally{db?.close();}
}

export async function inspectSonarrResultFiles(input){
 if(process.platform!=='linux'||!validInput(input))return {status:'unverified',reason:'unsupported-layout'};
 try{
  const source=await one(input.mediaRoot,input.relative);
  const results=[];
  for(const relative of input.outputRelatives){
   try{results.push({relative,...await one(input.reviewRoot,relative,relative+'.tdarr-receipt.json')});}
   catch(error){if(error.code==='ENOENT')continue;if(error instanceof SyntaxError)return {status:'unverified',reason:'unsupported-evidence'};throw error;}
  }
  const afterSource=await one(input.mediaRoot,input.relative);
  if(!sameRecorded(source.identity,afterSource.identity)||!sameFile(source.fileFingerprint,afterSource.fileFingerprint))return {status:'unverified',reason:'file-changed'};
  if(!results.length)return {status:'unverified',reason:'result-missing',source:source.identity};
  if(results.length!==1)return {status:'unverified',reason:'ambiguous-result',source:source.identity};
  const result=results[0];
  if(!result.receipt)return {status:'unverified',reason:'receipt-missing',source:source.identity,result:result.identity};
  const jobs=await exactJobs(input.database,result.receipt);
  if(jobs.status!=='ok')return {status:'unverified',reason:jobs.status==='unsafe'?'unsafe-path':jobs.status==='changed'?'file-changed':jobs.status==='unsupported'?'unsupported-evidence':'evidence-unavailable',source:source.identity,result:result.identity,receipt:result.receipt,outputRelative:result.relative};
  const [currentSource,currentResult]=await Promise.all([one(input.mediaRoot,input.relative),one(input.reviewRoot,result.relative,result.relative+'.tdarr-receipt.json')]);
  if(!sameRecorded(source.identity,currentSource.identity)||!sameFile(source.fileFingerprint,currentSource.fileFingerprint)||
   !sameRecorded(result.identity,currentResult.identity)||!sameFile(result.fileFingerprint,currentResult.fileFingerprint)||
   !sameFile(result.receiptFingerprint,currentResult.receiptFingerprint)||JSON.stringify(result.receipt)!==JSON.stringify(currentResult.receipt))return {status:'unverified',reason:'file-changed'};
  const currentJobs=await exactJobs(input.database,result.receipt);
  if(currentJobs.status!=='ok'||!sameFile(jobs.fileFingerprint,currentJobs.fileFingerprint)||JSON.stringify(jobs.rows)!==JSON.stringify(currentJobs.rows))return {status:'unverified',reason:'file-changed'};
  return {status:'present',source:currentSource.identity,result:currentResult.identity,receipt:currentResult.receipt,outputRelative:result.relative,jobs:jobs.rows,
   fileProofs:{source:currentSource.fileFingerprint,result:currentResult.fileFingerprint,receipt:currentResult.receiptFingerprint,database:currentJobs.fileFingerprint}};
 }catch(error){
  return {status:'unverified',reason:error.code==='changed'?'file-changed':error.code==='unsafe'?'unsafe-path':error.code==='ENOENT'?'source-missing':'evidence-unavailable'};
 }
}

let raw='';
for await(const chunk of process.stdin){raw+=chunk;if(Buffer.byteLength(raw)>256*1024){process.stdout.write('{"status":"unverified","reason":"evidence-unavailable"}\n');process.exitCode=1;break;}}
if(!process.exitCode){let input;try{input=JSON.parse(raw);}catch{}
 const result=await inspectSonarrResultFiles(input);const text=JSON.stringify(result);
 if(Buffer.byteLength(text)>maxOutput){process.stdout.write('{"status":"unverified","reason":"evidence-unavailable"}\n');process.exitCode=1;}
 else process.stdout.write(text+'\n');}
