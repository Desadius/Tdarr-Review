import fs from 'node:fs/promises';
import path from 'node:path';
import {RecoveryRefusal,exitRefused} from './recovery-mode.mjs';
import {createWorkerControl} from './control.mjs';
import {readRecoveryConfiguration,authorizeRecoveryApprovals} from './recovery-authority.mjs';
import {createWorker} from './create-worker.mjs';

const DATA=process.env.DATA_ROOT||'/data';
// The container runs the worker as PID 1, which ignores signals without a handler.
// A stop ends an idle wait at once; work already in progress is never cut short here.
let stopping=false,wake=()=>{};
const control=createWorkerControl({wake:()=>wake()});
const canStart=()=>!stopping&&control.canStart();
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{if(stopping)return;stopping=true;console.log('Recovery: '+signal+' received; stopping after the current step');wake();});
// Refuse (exit 78) before any state, registry or API access when the mode or config.json is unusable.
const {mode,cfg,text:configText,managed}=await readRecoveryConfiguration({data:DATA,mode:process.env.RECOVERY_MODE}).catch(e=>{if(e instanceof RecoveryRefusal)return exitRefused(e);throw e;});
const state=JSON.parse(await fs.readFile(path.join(DATA,'state.json'),'utf8').catch(e=>{if(e.code!=='ENOENT')throw e;return '{"version":1,"jobs":{},"cases":{}}'}));
// Validate persistent authorization before DB reads, APIs or restart recovery.
const pendingApprovals=await authorizeRecoveryApprovals({data:DATA,cfg,state}).catch(e=>{if(e instanceof RecoveryRefusal)return exitRefused(e);throw e;});
const worker=createWorker({data:DATA,mode,cfg,configText,managed,state,pendingApprovals,canStart});
await worker.markInterrupted();
console.log('Tdarr recovery started; mode='+mode);
control.ready();
const pause=ms=>new Promise(r=>{const t=setTimeout(r,ms);wake=()=>{clearTimeout(t);r();};});
while(!stopping&&!control.stopped()){
 if(canStart()){
  try{await worker.noteConfigChange();await worker.tick();state.lastError=null;}catch(e){state.lastError=e.message;console.error('Recovery: '+e.message);}
  await worker.refresh();await worker.save();
 }
 control.checkpoint();
 if(process.argv.includes('--once')||stopping||control.stopped())break;
 await pause(cfg.pollSeconds*1000);
}
await worker.close();
control.close();
if(stopping||control.stopped()){console.log('Recovery stopped');process.exit(0);}
