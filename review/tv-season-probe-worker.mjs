import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {constants} from 'node:fs';
import {projectSeasonTechnicalFacts} from './sonarr-technical-facts.mjs';
import {DatabaseSync} from 'node:sqlite';

const formats='matroska';
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const changed=()=>Object.assign(Error(),{code:'changed'});
const controlError=code=>Object.assign(Error(),{code});
const activeProbes=new Set();let shuttingDown=false;
process.on('SIGTERM',()=>{shuttingDown=true;for(const value of activeProbes)value.stop()});
function validRelative(value){return typeof value==='string'&&value.length>0&&value.length<=2048&&!value.startsWith('/')&&!value.includes('\\')&&!value.includes('\0')&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'&&part.length<=255)}
function validRoot(value){return typeof value==='string'&&value.startsWith('/')&&value.length<=2048&&!value.includes('\\')&&!value.includes('\0')&&path.posix.normalize(value)===value}
function same(a,b){return a.dev===b.dev&&a.ino===b.ino&&a.mode===b.mode&&a.nlink===b.nlink&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs}

async function openFile(root,relative){
 if(!validRelative(relative))throw Object.assign(Error(),{code:'unsafe'});
 let directory;const dirs=await openDirectoryChain(root);directory=dirs.at(-1);let file=null;
 try{
  const parts=relative.split('/');
  for(const part of parts.slice(0,-1)){
   const named=`/proc/self/fd/${directory.fd}/${part}`,before=await fs.lstat(named);
   if(before.isSymbolicLink()||!before.isDirectory())throw Object.assign(Error(),{code:'unsafe'});
   const next=await fs.open(named,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW),opened=await next.stat(),after=await fs.lstat(named);
   if(!opened.isDirectory()||after.isSymbolicLink()||opened.dev!==before.dev||opened.ino!==before.ino||!same(opened,after)){await next.close();throw changed();}
   directory=next;dirs.push(next);
  }
  const leaf=`/proc/self/fd/${directory.fd}/${parts.at(-1)}`,before=await fs.lstat(leaf);
  if(before.isSymbolicLink()||!before.isFile()||before.nlink!==1)throw Object.assign(Error(),{code:'unsafe'});
  file=await fs.open(leaf,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const opened=await file.stat(),after=await fs.lstat(leaf);
  if(!opened.isFile()||opened.nlink!==1||!same(opened,before)||!same(opened,after))throw changed();
  const directoryStats=await Promise.all(dirs.map(value=>value.stat()));
  const record={handle:file,stat:opened,leaf,directory,directories:dirs,directoryStats};file=null;return record;
 }catch(error){await file?.close().catch(()=>{});await Promise.all(dirs.reverse().map(value=>value.close().catch(()=>{})));throw error;}
}
async function openDirectoryChain(root){
 const flags=constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW,parts=root.slice(path.posix.parse(root).root.length).split('/').filter(Boolean),dirs=[];
 let parent=await fs.open('/',flags);dirs.push(parent);
 try{for(const part of parts){const named=`/proc/self/fd/${parent.fd}/${part}`,before=await fs.lstat(named);if(before.isSymbolicLink()||!before.isDirectory())throw Object.assign(Error(),{code:'unsafe'});const next=await fs.open(named,flags),opened=await next.stat(),after=await fs.lstat(named);if(after.isSymbolicLink()||!same(before,opened)||!same(opened,after)){await next.close();throw changed()}dirs.push(next);parent=next;}return dirs}
 catch(error){await Promise.all(dirs.reverse().map(value=>value.close().catch(()=>{})));throw error}
}
async function closeFile(record){await record.handle.close();await Promise.all(record.directories.reverse().map(value=>value.close().catch(()=>{})))}
async function readReceipt(root,relative){
 const file=await openFile(root,relative);
 try{
  if(file.stat.size>65536)throw Object.assign(Error(),{code:'unsafe'});
  const bytes=await file.handle.readFile(),after=await file.handle.stat(),named=await fs.lstat(file.leaf);
  if(!same(file.stat,after)||named.isSymbolicLink()||!same(after,named))throw changed();
  return {receipt:JSON.parse(bytes.toString('utf8')),identity:{dev:file.stat.dev,ino:file.stat.ino,mode:file.stat.mode,nlink:file.stat.nlink,size:file.stat.size,mtimeMs:file.stat.mtimeMs,ctimeMs:file.stat.ctimeMs}};
 }finally{await closeFile(file)}
}
function probe(executable,record,remaining){
 return new Promise(resolve=>{
  if(shuttingDown)return resolve(null);
  const args=['-v','error','-protocol_whitelist','file','-format_whitelist',formats,'-enable_drefs','0','-use_absolute_path','0','-probesize','5000000','-analyzeduration','5000000','-max_alloc','33554432','-show_streams','-show_format','-of','json','/proc/self/fd/3'];
  let child;try{child=spawn(executable,args,{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe',record.handle.fd],env:{PATH:process.env.PATH||''}})}catch{return resolve(null)}
  const chunks=[];let out=0,err=0,failed=false,timed=false,stopping=false,kill=null;
  const stop=()=>{if(stopping)return;stopping=true;child.kill('SIGTERM');kill=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL')},200);kill.unref?.()};
  const active={stop};activeProbes.add(active);
  const timer=setTimeout(()=>{timed=true;stop()},Math.max(1,Math.min(10000,remaining())));timer.unref?.();
  child.once('error',()=>{failed=true});
  child.stdout.on('data',chunk=>{if(failed)return;out+=chunk.length;if(out>2*1024*1024){failed=true;stop();return}chunks.push(Buffer.from(chunk))});
  child.stderr.on('data',chunk=>{if(failed)return;err+=chunk.length;if(err>32*1024){failed=true;stop()}});
  child.once('close',async code=>{
   activeProbes.delete(active);clearTimeout(timer);clearTimeout(kill);
   try{const after=await record.handle.stat(),named=await fs.lstat(record.leaf);if(!same(record.stat,after)||named.isSymbolicLink()||!same(after,named))return resolve(null);}catch{return resolve(null)}
   if(timed||failed||code!==0)return resolve(null);
   try{const value=JSON.parse(Buffer.concat(chunks,out).toString('utf8'));resolve(projectSeasonTechnicalFacts(value))}catch{resolve(null)}
  });
 });
}
async function pair(input,remaining){
 let source,result,receipt=null;
 try{
  try{result=await openFile(input.reviewRoot,input.resultRelative)}catch(error){return error?.code==='ENOENT'?{episodeFileId:input.episodeFileId,status:'missing_result',reason:'no_staged_result'}:{episodeFileId:input.episodeFileId,status:'unknown',reason:error?.code==='unsafe'?'unsafe_result':'result_unavailable'};}
  try{receipt=await readReceipt(input.reviewRoot,input.resultRelative+'.tdarr-receipt.json')}catch(error){if(error?.code!=='ENOENT')return {episodeFileId:input.episodeFileId,status:'unknown',reason:error?.code==='unsafe'?'unsafe_receipt':'receipt_unavailable',identity:{result:identity(result.stat,result.directoryStats)}};}
  try{source=await openFile(input.mediaRoot,input.sourceRelative)}catch(error){return {episodeFileId:input.episodeFileId,status:'unknown',reason:error?.code==='unsafe'?'unsafe_source':'source_unavailable',receipt:receipt?.receipt??null,identity:{result:identity(result.stat,result.directoryStats),receipt:receipt?.identity??null}};}
  if(input.verifyOnly){return {episodeFileId:input.episodeFileId,status:'observed',receipt:receipt?.receipt??null,identity:{source:identity(source.stat,source.directoryStats),result:identity(result.stat,result.directoryStats),receipt:receipt?.identity??null}};}
  if(input.probe===false)return {episodeFileId:input.episodeFileId,status:'observed',receipt:receipt?.receipt??null,identity:{source:identity(source.stat,source.directoryStats),result:identity(result.stat,result.directoryStats),receipt:receipt?.identity??null}};
  if(!receipt)return {episodeFileId:input.episodeFileId,status:'unknown',reason:'receipt_missing',identity:{source:identity(source.stat,source.directoryStats),result:identity(result.stat,result.directoryStats),receipt:null}};
  const sf=await probe(input.ffprobe,source,remaining);if(!sf)return {episodeFileId:input.episodeFileId,status:'unknown',reason:'metadata_unavailable'};
  const rf=await probe(input.ffprobe,result,remaining);if(!rf)return {episodeFileId:input.episodeFileId,status:'unknown',reason:'metadata_unavailable'};
  return {episodeFileId:input.episodeFileId,status:'observed',receipt:receipt.receipt,facts:{source:sf,result:rf},identity:{source:identity(source.stat,source.directoryStats),result:identity(result.stat,result.directoryStats),receipt:receipt.identity}};
 }catch(error){return {episodeFileId:input.episodeFileId,status:'unknown',reason:error?.code==='unsafe'?'unsafe_file':'metadata_unavailable'};}
 finally{for(const value of [source,result])if(value)await closeFile(value).catch(()=>{});}
}
function identity(stat,directories=[]){return {dev:stat.dev,ino:stat.ino,mode:stat.mode,nlink:stat.nlink,size:stat.size,mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs,directories:directories.map(value=>({dev:value.dev,ino:value.ino,mode:value.mode,nlink:value.nlink,mtimeMs:value.mtimeMs,ctimeMs:value.ctimeMs}))}}
async function exactJobs(request){
 if(typeof request.database!=='string'||!request.database.startsWith('/')||request.database.length>2048||request.database.includes('\\')||request.database.includes('\0')||path.posix.normalize(request.database)!==request.database||!Array.isArray(request.jobIds)||request.jobIds.length>50||request.jobIds.some(value=>typeof value!=='string'||!value.trim()||value!==value.trim()||Buffer.byteLength(value)>512||/[\u0000-\u001f\u007f]/.test(value))||new Set(request.jobIds).size!==request.jobIds.length)throw controlError('invalid_input');
 const directoryPath=path.posix.dirname(request.database),directories=await openDirectoryChain(directoryPath),directory=directories.at(-1);let handle,db;
 try{
  const directoryBefore=await Promise.all(directories.map(value=>value.stat())),before=await fs.lstat(request.database);
  if(before.isSymbolicLink()||!before.isFile()||before.nlink!==1)throw controlError('unsafe');
  handle=await fs.open(request.database,constants.O_RDONLY|constants.O_NOFOLLOW);const opened=await handle.stat();if(!same(before,opened))throw Error('changed');
  db=new DatabaseSync(request.database,{readOnly:true});const statement=db.prepare("SELECT CASE WHEN length(CAST(json_data AS BLOB))<=65536 THEN json_data ELSE NULL END AS json_data,length(CAST(json_data AS BLOB)) AS bytes FROM jobsjsondb WHERE json_extract(json_data, '$._id') = ? LIMIT 2");
  const jobs=[];
  for(const id of request.jobIds){const rows=statement.all(id);if(rows.length>2||rows.some(row=>row.bytes>65536||typeof row.json_data!=='string'))throw controlError('oversized');const records=rows.map(row=>JSON.parse(row.json_data));jobs.push({jobId:id,records:records.map(value=>({ _id:typeof value._id==='string'&&value._id.length<=512?value._id:null,DB:typeof value.DB==='string'&&value.DB.length<=256?value.DB:null,status:typeof value.status==='string'&&value.status.length<=80?value.status:null,file:typeof value.file==='string'&&value.file.length<=4096?value.file:null,fileSizeStartGB:value.fileSizeStartGB,fileSizeEndGB:value.fileSizeEndGB}))});}
  const after=await fs.lstat(request.database),currentDirectories=await openDirectoryChain(directoryPath);
  try{const currentStats=await Promise.all(currentDirectories.map(value=>value.stat()));if(!same(before,after)||directoryBefore.length!==currentStats.length||directoryBefore.some((value,index)=>!same(value,currentStats[index])))throw controlError('changed')}finally{await Promise.all(currentDirectories.reverse().map(value=>value.close()))}
  return jobs;
 }finally{db?.close();await handle?.close();await Promise.all(directories.reverse().map(value=>value.close()))}
}
async function main(){
 let raw='';for await(const chunk of process.stdin){raw+=chunk;if(Buffer.byteLength(raw)>256*1024)throw controlError('input_too_large')}
 const request=JSON.parse(raw),started=Date.now();
 if(plain(request)&&request.jobsOnly===true){const jobs=await exactJobs(request),output=JSON.stringify({jobs});if(Buffer.byteLength(output)>4*1024*1024)throw controlError('output_too_large');process.stdout.write(output+'\n');return}
 if(!plain(request)||typeof request.verifyOnly!=='boolean'||(!request.verifyOnly&&(typeof request.ffprobe!=='string'||!validRoot(request.ffprobe)))||!Array.isArray(request.pairs)||request.pairs.length>50||request.pairs.some(item=>!plain(item)||!Number.isSafeInteger(item.episodeFileId)||!validRoot(item.mediaRoot)||!validRoot(item.reviewRoot)||!validRelative(item.sourceRelative)||!validRelative(item.resultRelative)||item.probe!==undefined&&typeof item.probe!=='boolean'))throw controlError('invalid_input');
 const results=Array(request.pairs.length);let next=0;
 await Promise.all(Array.from({length:Math.min(2,request.pairs.length)},async()=>{while(next<request.pairs.length&&!shuttingDown){const index=next++;results[index]=await pair({...request.pairs[index],ffprobe:request.ffprobe,verifyOnly:request.verifyOnly},()=>60000-(Date.now()-started));if(Date.now()-started>=60000)break}}));
 if(shuttingDown)throw controlError('cancelled');
 for(let i=0;i<results.length;i++)results[i]??={episodeFileId:request.pairs[i].episodeFileId,status:'unknown',reason:'operation_deadline'};
 const output=JSON.stringify({results}),bytes=Buffer.byteLength(output);if(bytes>4*1024*1024)throw controlError('output_too_large');process.stdout.write(output+'\n');
}
main().catch(()=>{process.stdout.write('{"error":"worker_unavailable"}\n');process.exitCode=1});
