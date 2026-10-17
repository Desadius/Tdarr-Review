import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

export const DELAY_MS=Number(process.env.SUPERVISOR_TEST_DELAY_MS??0);
if(!(Number.isInteger(DELAY_MS)&&DELAY_MS>=0))throw Error('SUPERVISOR_TEST_DELAY_MS must be a whole number of milliseconds');

// A stand-in child records its start, the signals it receives and its exit in events.log,
// then follows its plan. It installs its signal handlers before recording start, so a recorded start
// also means the child is ready for a signal. Plans: serve[:<shutdown ms>] (until SIGTERM), exit:<code>, exit-after-recovery:<code>, crash, crash-after:<ms>,
// refuse:<reason>, stubborn (ignores signals), killed (dies of SIGKILL).
const STAND_IN=String.raw`
const fs=require('node:fs'),os=require('node:os'),{execFileSync}=require('node:child_process');
const [name,plan]=process.argv.slice(2),events=process.env.STAND_IN_EVENTS;
const log=e=>fs.appendFileSync(events,JSON.stringify({name,pid:process.pid,time:Date.now(),...e})+'\n');
const delayMs=Number(process.env.STAND_IN_DELAY_MS),pause=()=>{if(delayMs>0)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,delayMs);};
const exit=code=>{log({event:'exit',code});process.exit(code);};
const [kind,code]=plan.split(':');
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{log({event:'signal',signal});if(kind!=='stubborn')setTimeout(()=>exit(name==='review'?5:0),kind==='serve'&&code?Number(code):300);});
if(name==='review')pause();
let ionice=null;try{ionice=execFileSync('ionice',['-p',String(process.pid)],{encoding:'utf8'}).trim();}catch{}
log({event:'start',nice:os.getPriority(),ionice,dataRoot:process.env.DATA_ROOT??null,mode:process.env.RECOVERY_MODE??null,delayMs});
pause();
if(kind==='serve'||kind==='stubborn')setInterval(()=>{},1000);
if(kind==='exit')setTimeout(()=>exit(Number(code)),100);
if(kind==='exit-after-recovery'){const t=setInterval(()=>{const text=fs.existsSync(events)?fs.readFileSync(events,'utf8'):'';if(text.includes('"name":"recovery","pid"')){clearInterval(t);setTimeout(()=>exit(Number(code)),200);}},25);}
if(kind==='crash')exit(1);
if(kind==='killed')setTimeout(()=>process.kill(process.pid,'SIGKILL'),100);
if(kind==='crash-after')setTimeout(()=>exit(1),Number(code));
if(kind==='refuse'){process.stderr.write('Recovery refused to start: config.json does not exist\nRECOVERY_REFUSED '+code+'\n',()=>exit(78));}
`;

export async function start({mode,review='serve',recovery='serve',restart={initialMs:200,maxMs:800,crashLoopAfter:3,stableMs:60000},env={},reviewCommand,beforeStart,...extra}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'supervisor-')),dataRoot=path.join(root,'data'),events=path.join(root,'events.log');
 await fs.mkdir(dataRoot);
 await beforeStart?.({dataRoot});
 const standIn=path.join(root,'stand-in.cjs'),launcher=path.join(root,'launcher.mjs');
 await fs.writeFile(standIn,STAND_IN);
 await fs.writeFile(launcher,'import {supervise} from '+JSON.stringify(new URL('./supervisor.mjs',import.meta.url).href)+';\nprocess.exit(await supervise(JSON.parse(process.env.SUPERVISE_OPTIONS)));\n');
 const options={mode,dataRoot,review:[process.execPath,standIn,'review',review],recovery:[process.execPath,standIn,'recovery',recovery],restart,...extra,...(reviewCommand?{review:reviewCommand}:{})};
 const child=spawn(process.execPath,[launcher],{detached:process.platform!=='win32',env:{...process.env,...env,STAND_IN_EVENTS:events,STAND_IN_DELAY_MS:String(DELAY_MS),SUPERVISE_OPTIONS:JSON.stringify(options)},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 const closed=new Promise(resolve=>child.on('close',resolve));
 const exited=new Promise(resolve=>child.on('exit',(code,signal)=>resolve({code,signal,time:Date.now()})));
 const readEvents=async()=>(await fs.readFile(events,'utf8').catch(()=>'')).split('\n').filter(Boolean).map(line=>JSON.parse(line));
 const stateFile=path.join(dataRoot,'recovery','runtime-state.json');
 const readState=async()=>JSON.parse(await fs.readFile(stateFile,'utf8'));
 return {root,dataRoot,child,exited,closed,readEvents,readState,stateFile,output:()=>output};
}
export async function waitFor(check,timeoutMs=10000){
 const until=Date.now()+timeoutMs;
 for(;;){const value=await check().catch(()=>undefined);if(value)return value;if(Date.now()>until)throw Error('Timed out waiting for '+check);await new Promise(r=>setTimeout(r,25));}
}
// Waits for the supervisor to exit, failing instead of hanging when it does not.
export function exitedWithin(run,ms){return Promise.race([run.exited,new Promise((_,reject)=>setTimeout(()=>reject(Error('The supervisor did not exit within '+ms+' ms')),ms).unref())]);}
// Kills the supervisor's whole process group as well, so a child that has not recorded its start yet
// cannot outlive the test and hold its output pipes open.
export async function stop(run){
 if(process.platform!=='win32')try{process.kill(-run.child.pid,'SIGKILL')}catch{}
 if(run.child.exitCode===null&&run.child.signalCode===null)run.child.kill('SIGKILL');
 await run.exited;for(const e of await run.readEvents())try{process.kill(e.pid,'SIGKILL')}catch{}
 // Descendants inherit the output pipes. Exit of the supervisor alone does not mean those
 // descendants are done; close waits for their pipes too, before deleting their working files.
 await run.closed;
 await fs.rm(run.root,{recursive:true,force:true});
}
// Waits until the named children have all recorded their start (and so are ready for signals).
export const started=(run,...names)=>waitFor(async()=>{const events=await run.readEvents();const found=names.map(name=>events.find(e=>e.name===name&&e.event==='start'));return found.every(Boolean)&&found;});
