import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createSonarrInspection} from './sonarr-inspection.mjs';
import {mapSonarrSourcePath} from './sonarr-source-path.mjs';

const workerFile=fileURLToPath(new URL('./sonarr-source-worker.mjs',import.meta.url));
const outputLimit=2048,requestLimit=4096;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const safeStatuses=new Set(['present','missing','unsafe','unsupported','changed','unavailable']);

/**
 * One server-lifetime Sonarr source checker. It accepts only IDs and a saved
 * revision; client paths never enter the worker protocol.
 */
export function createSonarrSourceInspection({getSnapshot,fetchFn=globalThis.fetch,requestTimeoutMs=7000,workerTimeoutMs=10000,killGraceMs=250,shutdownMs=1500,spawnChild=spawn,workerPath=workerFile}){
 let active=null,inspectionBusy=false,closing=false;
 async function terminate(record){
  if(record.closed)return;
  try{record.child.kill('SIGTERM')}catch{}
  record.killTimer=setTimeout(()=>{if(!record.closed)try{record.child.kill('SIGKILL')}catch{}},killGraceMs);
  record.killTimer.unref?.();
 }
 function runWorker(input){
  if(closing)return Promise.resolve({status:'unavailable'});
  if(active)return Promise.resolve({status:'busy'});
  const payload=JSON.stringify(input);if(Buffer.byteLength(payload)>requestLimit)return Promise.resolve({status:'unavailable'});
  let child;
  try{child=spawnChild(process.execPath,[workerPath],{shell:false,windowsHide:true,stdio:['pipe','pipe','ignore'],env:{PATH:process.env.PATH||'',...(process.platform==='win32'&&process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{})}})}
  catch{return Promise.resolve({status:'unavailable'});}
  const output=[];let outputBytes=0,overflow=false,settled=false,resolveResult;
  const result=new Promise(resolve=>{resolveResult=resolve});
  const record={child,closed:false,killTimer:null,closePromise:null};
  active=record;
  const finish=value=>{if(settled)return;settled=true;clearTimeout(deadline);resolveResult(value);};
  const deadline=setTimeout(()=>{finish({status:'unavailable'});void terminate(record)},workerTimeoutMs);deadline.unref?.();
  record.closePromise=new Promise(resolve=>{
   child.once('error',()=>{finish({status:'unavailable'});});
   child.stdin.once('error',()=>{finish({status:'unavailable'});void terminate(record)});
   child.stdout.once('error',()=>{finish({status:'unavailable'});void terminate(record)});
   child.stdout.on('data',chunk=>{
    if(overflow)return;
    const bytes=Buffer.from(chunk),remaining=outputLimit-outputBytes;
    if(bytes.length>remaining){overflow=true;void terminate(record);finish({status:'unavailable'});return;}
    output.push(bytes);outputBytes+=bytes.length;
   });
   child.once('close',code=>{
    record.closed=true;clearTimeout(record.killTimer);if(active===record)active=null;
    if(record.releaseInspection)inspectionBusy=false;
    if(!settled){let value;try{value=JSON.parse(Buffer.concat(output,outputBytes).toString('utf8'));if(overflow||code!==0||!plain(value)||!safeStatuses.has(value.status)||Object.keys(value).some(key=>!['status','size','modifiedAt'].includes(key))||value.status==='present'&&(!Number.isSafeInteger(value.size)||value.size<0||!Number.isSafeInteger(value.modifiedAt)))throw Error();}catch{value={status:'unavailable'};}finish(value);}
    resolve();
   });
  });
  try{child.stdin.end(payload)}catch{void terminate(record);finish({status:'unavailable'});}
  void result;return result;
 }
 async function inspect(revision,seriesId,episodeFileId){
  if(closing)return {status:'unavailable',source:'unverified'};
  if(!/^[a-f0-9]{64}$/.test(revision||'')||!Number.isSafeInteger(seriesId)||seriesId<=0||!Number.isSafeInteger(episodeFileId)||episodeFileId<=0)return {status:'invalid-request',source:'unverified'};
  if(inspectionBusy||active)return {status:'busy',source:'unverified'};
  inspectionBusy=true;
  try{
   let settings;
   try{settings=await getSnapshot(revision);}catch(error){if(error?.code==='settings_conflict')throw error;return {status:'unavailable',source:'unverified'};}
   if(!plain(settings)||settings.revision!==revision||!plain(settings.tv)||typeof settings.tv.sonarrRoot!=='string'||!settings.tv.sonarrRoot||typeof settings.tv.mediaRoot!=='string'||!settings.tv.mediaRoot)return {status:'unavailable',source:'unverified'};
   const sonarr=createSonarrInspection({getConnection:async requested=>{if(requested!==revision)throw Object.assign(Error('settings_conflict'),{code:'settings_conflict'});const value=await getSnapshot(revision);if(value.revision!==revision)throw Object.assign(Error('settings_conflict'),{code:'settings_conflict'});return value.sonarr;},fetchFn,requestTimeoutMs});
   const bound=await sonarr.inspectEpisodeFile(revision,seriesId,episodeFileId);
   if(bound.status!=='mapped')return {status:bound.status,reason:bound.reason||null,source:'unverified'};
   const mapped=mapSonarrSourcePath({sonarrRoot:settings.tv.sonarrRoot,filePath:bound.sonarrPath});
   if(mapped.status!=='mapped')return {status:'unmapped',source:'unverified'};
   const inspected=await runWorker({mediaRoot:settings.tv.mediaRoot,relative:mapped.relative});
   const current=await getSnapshot(revision);
   if(current.revision!==revision)throw Object.assign(Error('settings_conflict'),{code:'settings_conflict'});
   return {status:inspected.status,source:'unverified',relative:mapped.relative,...(inspected.status==='present'?{size:inspected.size,modifiedAt:inspected.modifiedAt}:{})};
  }finally{
   const record=active;
   if(record&&!record.closed)record.releaseInspection=true;
   else inspectionBusy=false;
  }
 }
 async function close(){
  if(closing)return;
  closing=true;
  const record=active;if(!record)return;
  await terminate(record);
  let timer;
  await Promise.race([record.closePromise,new Promise(resolve=>{timer=setTimeout(resolve,shutdownMs);timer.unref?.()})]);
  clearTimeout(timer);
  if(!record.closed){record.child.unref?.();record.child.stdin?.unref?.();record.child.stdout?.unref?.();record.child.stderr?.unref?.();}
 }
 return {inspect,close};
}
