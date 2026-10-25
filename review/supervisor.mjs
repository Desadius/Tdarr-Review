// @ts-check
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {atomicJSON} from './core.mjs';
import {REFUSED_EXIT} from '../recovery/recovery-mode.mjs';
import {randomUUID} from 'node:crypto';
import {CONTROL_VERSION,controlMessage,sendControl,validId,CHANNELS,controlTransition,runControlCommands} from './recovery-control.mjs';
import {readSettingsActivation} from './settings-activation.mjs';
import {readRecoveryRestoreFence} from '../recovery/recovery-authority.mjs';
import {LOW_PRIORITY} from './low-priority.mjs';

export const STATE_FILE='runtime-state.json';

// Container entrypoint: runs Review and, in Recovery mode verify or repair, Recovery (docs/ARCHITECTURE.md, Supervisor).
/**
 * @typedef {{initialMs:number,maxMs:number,crashLoopAfter:number,stableMs:number}} RestartPolicy
 * @param {{mode?:string,dataRoot:string,review:string[],recovery:string[],restart?:RestartPolicy,stopGraceMs?:number,lowPriority?:readonly string[],readRestoreFence?:typeof readRecoveryRestoreFence}} options
 * @returns {Promise<number>}
 */
export async function supervise({mode,dataRoot,review,recovery,restart=RESTART,stopGraceMs=8000,lowPriority=LOW_PRIORITY,readRestoreFence=readRecoveryRestoreFence}){
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
 const session=randomUUID();
 let control=null,resumeCrash=false,restoreBlocked=false,restoreFenceValid=false,restoreRestartAuthorized=false,restoreOperationId=null;
 const usedIds=new Set();
 const reviewChild=spawn(review[0],review.slice(1),{stdio:['inherit','inherit','inherit','ipc']});
 const reviewExit=new Promise(resolve=>{
  reviewChild.on('exit',(code,signal)=>resolve(code??128+(signal?os.constants.signals[signal]:0)));
  // 127: the shell's status for a command that cannot be run.
  reviewChild.on('error',e=>{if(reviewChild.pid===undefined){console.error('Supervisor: cannot start Review: '+e.message);resolve(127);}});
 });
 // Consecutive crashes set the delay and, from crashLoopAfter on, report a crash loop.
 // A run that lasts stableMs starts the count again.
 let crashes=0,stopReason=null,restartTimer;
 void reviewExit.then(()=>{if(!stopReason){stopReason='review-exited';clearTimeout(restartTimer);}});
 /** @type {Promise<void>|null} */
 let workerExit=null;
 /** @type {import('node:child_process').ChildProcess|null} */
 let worker=null;
 let startingRecovery=null,startingRecoveryIntent=null,spawnedRecoveryCount=0,countedRecoveryCount=0;
 const crashLoopReason=()=>crashes>=restart.crashLoopAfter?'crash-loop':null;
 const startRecovery=()=>{
  const intent=control?{id:control.id,state:control.state}:null;
  if(startingRecovery){
   if((!intent&&!startingRecoveryIntent)||(intent&&startingRecoveryIntent?.id===intent.id&&startingRecoveryIntent.state===intent.state))return startingRecovery;
   return startingRecovery.then(()=>startRecovery());
  }
  if(mode==='off'||stopReason||stopping||worker)return Promise.resolve(false);
  let flight;
  flight=(async()=>{
  const fence=await readRestoreFence({data:dataRoot});
  const intentStillCurrent=intent?control?.id===intent.id&&control.state===intent.state:control===null;
  if(stopReason||stopping||worker||!intentStillCurrent)return false;
  const admittedRestart=fence.present&&fence.valid&&fence.restartAuthorized&&control?.state==='starting'&&control.id===fence.operationId;
  if(fence.present&&!admittedRestart){
   if(control?.state==='starting')control={...control,state:'failed',reason:'restore-fence'};
   await update({state:'refused',reason:fence.valid?'recovery-restore-pending':'recovery-restore-fence-invalid'});
   return false;
  }
  const [command,...args]=[...lowPriority,...recovery];
  const child=worker=spawn(command,args,{stdio:['ignore','inherit','pipe','ipc'],env:{...process.env,DATA_ROOT:recoveryData,REVIEW_DATA_ROOT:dataRoot,RECOVERY_MODE:mode,RECOVERY_CONTROL_SESSION:session,RECOVERY_ACTIVATION_ID:control?.state==='starting'?control.id:'',RECOVERY_RESTORE_OPERATION_ID:admittedRestart?fence.operationId:''}});
  spawnedRecoveryCount++;
  child.on('message',m=>{
   if(worker!==child||!controlMessage(m)||m.channel!==CHANNELS.worker||m.session!==session)return;
   control=controlTransition(context(),{type:'worker',event:m.event,id:m.id}).control;
  });
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
    const ended=controlTransition(context(),{type:'exit'});
    if(ended.intentional!==undefined){
     const intentional=ended.intentional;control=ended.control;
     if(code===REFUSED_EXIT)await Promise.race([drained,new Promise(resolve=>setTimeout(resolve,1000))]);
     await update({state:code===REFUSED_EXIT?'refused':'stopped',reason:intentional?'settings-apply':code===REFUSED_EXIT?refusalReason(tail):'apply-start-failed',...exited});
     return resolve();
    }
    if(code===REFUSED_EXIT){
     await Promise.race([drained,new Promise(resolve=>setTimeout(resolve,1000))]);
     void update({state:'refused',reason:refusalReason(tail),...exited});
     return resolve();
    }
    crashes++;
    const delay=Math.min(restart.initialMs*2**(crashes-1),restart.maxMs);
    void update({state:'restarting',reason:crashLoopReason()??'crash',...exited});
    restartTimer=setTimeout(()=>{void startRecovery().then(started=>{if(started&&spawnedRecoveryCount>countedRecoveryCount){countedRecoveryCount++;state.restarts++;void update({restarts:state.restarts});}});},delay);
    resolve();
   });
  });
  return true;
  })();
  startingRecoveryIntent=intent;
  const tracked=flight.finally(()=>{if(startingRecovery===tracked){startingRecovery=null;startingRecoveryIntent=null;}});
  startingRecovery=tracked;return tracked;
 };
 // Requests are volatile and tied to this supervisor instance. Restart never replays an old request.
 // controlTransition() decides (recovery/control-protocol.mjs); this executes its commands in order.
 const workerCommand=action=>sendControl(worker,{channel:CHANNELS.worker,version:CONTROL_VERSION,session,id:control.id,action});
 const snapshot=()=>({...control,session});
 const context=()=>({control,mode,session,worker:!!worker,restarting:state.state==='restarting',resumeCrash,used:usedIds,stopping:!!(stopping||stopReason),restoreBlocked,restoreFenceValid,restoreRestartAuthorized,restoreOperationId});
 const handleControl=async m=>{
  if(!controlMessage(m)||m.channel!==CHANNELS.control||!validId(m.id)||!validId(m.token))return;
  const fence=await readRestoreFence({data:dataRoot});restoreBlocked=fence.present;restoreFenceValid=fence.valid===true;restoreRestartAuthorized=fence.restartAuthorized===true;restoreOperationId=fence.operationId??null;
  const step=controlTransition(context(),{type:'request',action:m.action,id:m.id,session:m.session});
  if(step.resumeCrash!==undefined)resumeCrash=step.resumeCrash;
  return runControlCommands(step,{send:workerCommand,start:startRecovery,clearRestart:()=>clearTimeout(restartTimer),markUsed:id=>usedIds.add(id),awaitExit:()=>workerExit,setControl:value=>{control=value},snapshot});
 };
 reviewChild.on('message',async m=>{
  if(!controlMessage(m)||m.channel!==CHANNELS.control)return;
  const result=await handleControl(m);
  if(!result)return;
  sendControl(reviewChild,{channel:CHANNELS.reply,version:CONTROL_VERSION,token:m.token,...(result.error?{error:result.error}:{result})});
 });
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
  if(mode!=='off'){
   const marker=await readSettingsActivation(dataRoot);
   if(marker?.blocking)await update({state:'refused',reason:'settings-activation-incomplete'});else if(!stopping)await startRecovery();
  }
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
