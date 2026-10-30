import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const worker=fileURLToPath(new URL('./tv-season-probe-worker.mjs',import.meta.url));

function runTvWorker(request,{timeoutMs=60000,signal,expectedKey,expectedLength}={}){
 const input=JSON.stringify(request);if(Buffer.byteLength(input)>256*1024)return Promise.reject(Error('tv_plan_too_large'));
 return new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(Error('tv_plan_cancelled'));
  let child;try{child=spawn(process.execPath,[worker],{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH||''},cwd:path.dirname(worker)})}catch{return reject(Error('tv_plan_worker_unavailable'))}
  const chunks=[];let stdout=0,stderr=0,overflow=false,closed=false,timer=null,killTimer=null;const killDelay=Math.min(2000,Math.max(100,Math.floor(timeoutMs/4)));
  const stop=()=>{if(closed)return;try{child.kill('SIGTERM')}catch{}killTimer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)try{child.kill('SIGKILL')}catch{}},killDelay);killTimer.unref?.()};
  const cancel=()=>{stop();};signal?.addEventListener('abort',cancel,{once:true});
  timer=setTimeout(stop,Math.max(1,timeoutMs-killDelay-50));timer.unref?.();
  child.stdout.on('data',chunk=>{if(overflow)return;stdout+=chunk.length;if(stdout>4*1024*1024+4096){overflow=true;stop();return}chunks.push(Buffer.from(chunk))});
  child.stderr.on('data',chunk=>{if(overflow)return;stderr+=chunk.length;if(stderr>32*1024){overflow=true;stop()}});
  child.once('error',()=>{overflow=true});
  child.once('close',code=>{
   closed=true;clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',cancel);
   if(signal?.aborted)return reject(Error('tv_plan_cancelled'));
   if(overflow||code!==0)return reject(Error('tv_plan_worker_unavailable'));
   let value;try{value=JSON.parse(Buffer.concat(chunks,stdout).toString('utf8'))}catch{return reject(Error('tv_plan_worker_unavailable'))}
   if(value?.error)return reject(Error('tv_plan_worker_unavailable'));
   if(!Array.isArray(value?.[expectedKey])||(expectedLength!==null&&value[expectedKey].length!==expectedLength))return reject(Error('tv_plan_worker_unavailable'));
   resolve(value[expectedKey]);
  });
  child.stdin.end(input);
 });
}
export function runTvSeasonProbe(request,options={}){return runTvWorker(request,{...options,expectedKey:'results',expectedLength:request.pairs.length});}
export function runTvSeasonJobs(request,options={}){return runTvWorker({...request,jobsOnly:true},{...options,expectedKey:'jobs',expectedLength:request.jobIds.length});}
