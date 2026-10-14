// @ts-check
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {atomicJSON} from './core.mjs';
import {REFUSED_EXIT} from '../recovery/recovery-mode.mjs';

export const STATE_FILE='runtime-state.json';

// Container entrypoint: runs Review and, in Recovery mode verify or repair, Recovery (docs/ARCHITECTURE.md, Supervisor).
/**
 * @typedef {{initialMs:number,maxMs:number,crashLoopAfter:number,stableMs:number}} RestartPolicy
 * @param {{mode?:string,dataRoot:string,review:string[],recovery:string[],restart?:RestartPolicy,stopGraceMs?:number,lowPriority?:string[]}} options
 * @returns {Promise<number>}
 */
export async function supervise({mode,dataRoot,review,recovery,restart=RESTART,stopGraceMs=8000,lowPriority=LOW_PRIORITY}){
 // Only the supervisor applies the default. Any other value than off still goes to Recovery,
 // which refuses it (fail closed); the state file records it only as invalid.
 mode=mode||'off';
 const recoveryData=path.join(dataRoot,'recovery');
 const state={version:1,mode:['off','verify','repair'].includes(mode)?mode:'invalid',state:'off',restarts:0,lastExitCode:null,lastExitSignal:null,lastStartedAt:null,lastExitedAt:null,reason:null,updated:''};
 // The state file is informational: a failed write is logged and never affects Review.
 // Writes are serialized, because each one goes through the same temporary file.
 let writes=Promise.resolve();
 const update=changes=>{Object.assign(state,changes);return writes=writes.then(()=>publish(recoveryData,{...state,updated:new Date().toISOString()}));};
 // Not awaited: the signal handlers below must be in place at once, because PID 1 ignores signals without one.
 void update({});
 const reviewChild=spawn(review[0],review.slice(1),{stdio:'inherit'});
 const reviewExit=new Promise(resolve=>{
  reviewChild.on('exit',(code,signal)=>resolve(code??128+(signal?os.constants.signals[signal]:0)));
  // 127: the shell's status for a command that cannot be run.
  reviewChild.on('error',e=>{if(reviewChild.pid===undefined){console.error('Supervisor: cannot start Review: '+e.message);resolve(127);}});
 });
 // Consecutive crashes set the delay and, from crashLoopAfter on, report a crash loop.
 // A run that lasts stableMs starts the count again.
 let crashes=0,stopReason=null,restartTimer;
 /** @type {Promise<void>|null} */
 let workerExit=null;
 /** @type {import('node:child_process').ChildProcess|null} */
 let worker=null;
 const crashLoopReason=()=>crashes>=restart.crashLoopAfter?'crash-loop':null;
 const startRecovery=()=>{
  const child=worker=spawn(lowPriority[0],[...lowPriority.slice(1),...recovery],{stdio:['ignore','inherit','pipe'],env:{...process.env,DATA_ROOT:recoveryData,RECOVERY_MODE:mode}});
  // stderr still reaches the container log; its tail may hold the refusal line.
  let tail='';
  const drained=new Promise(resolve=>{child.stderr?.on('data',chunk=>{process.stderr.write(chunk);tail=(tail+chunk).slice(-4096);});child.stderr?.on('end',resolve);});
  void update({state:'running',reason:crashLoopReason(),lastStartedAt:new Date().toISOString()});
  const stable=setTimeout(()=>{crashes=0;void update({reason:null});},restart.stableMs);
  workerExit=new Promise(resolve=>{
   // A command that cannot be spawned emits only error; it counts as an exit without code.
   child.on('error',()=>{if(child.pid===undefined)child.emit('exit',null,null);});
   child.once('exit',async(code,signal)=>{
    clearTimeout(stable);worker=null;
    const exited={lastExitCode:code,lastExitSignal:signal,lastExitedAt:new Date().toISOString()};
    if(stopReason){await update({state:'stopped',reason:stopReason,...exited});return resolve();}
    if(code===REFUSED_EXIT){
     await Promise.race([drained,new Promise(resolve=>setTimeout(resolve,1000))]);
     void update({state:'refused',reason:refusalReason(tail),...exited});
     return resolve();
    }
    crashes++;
    const delay=Math.min(restart.initialMs*2**(crashes-1),restart.maxMs);
    void update({state:'restarting',reason:crashLoopReason()??'crash',...exited});
    restartTimer=setTimeout(()=>{state.restarts++;startRecovery();},delay);
    resolve();
   });
  });
 };
 // Stopping happens once: it cancels a pending restart and gives Recovery the signal, then SIGKILL after stopGraceMs.
 /** @type {Promise<void>|null} */
 let stopping=null;
 /** @type {(reason:string,signal?:NodeJS.Signals)=>Promise<void>} */
 const stopRecovery=(reason,signal='SIGTERM')=>stopping??=(async()=>{
  stopReason=reason;clearTimeout(restartTimer);
  if(state.state==='restarting')await update({state:'stopped',reason});
  if(!worker)return;
  worker.kill(signal);
  const kill=setTimeout(()=>worker?.kill('SIGKILL'),stopGraceMs);
  await workerExit;clearTimeout(kill);
 })();
 // A container stop reaches both children once; a repeated signal is not forwarded again,
 // so Review's own shutdown handler is never cut short by a second one.
 const onSignal=signal=>{if(stopping)return;reviewChild.kill(signal);void stopRecovery('shutdown',signal);};
 for(const signal of SIGNALS)process.on(signal,onSignal);
 try{
  if(mode!=='off')startRecovery();
  const status=await reviewExit;
  await stopRecovery('review-exited');
  await writes;
  return status;
 }finally{for(const signal of SIGNALS)process.off(signal,onSignal);}
}
/** @type {NodeJS.Signals[]} */
const SIGNALS=['SIGTERM','SIGINT'];

// A refusal (recovery/recovery-mode.mjs) exits 78 with a last stderr line `RECOVERY_REFUSED <reason>`.
// It is never restarted. Only a well-formed reason code is recorded, never other stderr text.
function refusalReason(stderr){
 const last=stderr.trimEnd().split('\n').at(-1)??'';
 return /^RECOVERY_REFUSED ([a-z0-9-]{1,64})$/.exec(last)?.[1]??'unknown-refusal';
}

/** @type {RestartPolicy} */
const RESTART={initialMs:10000,maxMs:300000,crashLoopAfter:5,stableMs:600000};

// Recovery runs at the lowest best-effort I/O priority (7) and CPU niceness 19, so reviewing stays responsive.
const LOW_PRIORITY=['/usr/bin/ionice','-c','2','-n','7','/usr/bin/nice','-n','19'];

async function publish(directory,snapshot){
 try{
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  await atomicJSON(path.join(directory,STATE_FILE),snapshot);
 }catch(e){console.error('Supervisor: cannot write the Recovery runtime state: '+(e instanceof Error?e.message:e));}
}

// Production: Review's server and the Recovery worker beside it, with RECOVERY_MODE and DATA_ROOT from the container.
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 process.exit(await supervise({
  mode:process.env.RECOVERY_MODE,
  dataRoot:process.env.DATA_ROOT||'/data',
  review:[process.execPath,fileURLToPath(new URL('./server.mjs',import.meta.url))],
  recovery:[process.execPath,fileURLToPath(new URL('../recovery/worker.mjs',import.meta.url))],
 }));
}
