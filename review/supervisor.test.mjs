import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

// The supervisor runs as a real process with stand-in scripts in place of Review and Recovery.
// Only temporary directories are used; nothing touches media, Tdarr or Radarr.
const linux={skip:process.platform!=='linux'?'Requires Linux signals, ionice and directory fsync':false};

// Test mode: SUPERVISOR_TEST_DELAY_MS makes Review's stand-in start late and every stand-in pause right
// after recording its start. A test that reads an event it did not wait for, or signals a child before it
// is ready, then fails every time instead of now and then. supervisor-delayed.test.mjs runs this file so.
const DELAY_MS=Number(process.env.SUPERVISOR_TEST_DELAY_MS??0);
if(!(Number.isInteger(DELAY_MS)&&DELAY_MS>=0))throw Error('SUPERVISOR_TEST_DELAY_MS must be a whole number of milliseconds');
const test=(name,...rest)=>nodeTest(DELAY_MS?name+' (stand-ins delayed '+DELAY_MS+' ms)':name,...rest);

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

async function start({mode,review='serve',recovery='serve',restart={initialMs:200,maxMs:800,crashLoopAfter:3,stableMs:60000},env={},reviewCommand,...extra}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'supervisor-')),dataRoot=path.join(root,'data'),events=path.join(root,'events.log');
 await fs.mkdir(dataRoot);
 const standIn=path.join(root,'stand-in.cjs'),launcher=path.join(root,'launcher.mjs');
 await fs.writeFile(standIn,STAND_IN);
 await fs.writeFile(launcher,'import {supervise} from '+JSON.stringify(new URL('./supervisor.mjs',import.meta.url).href)+';\nprocess.exit(await supervise(JSON.parse(process.env.SUPERVISE_OPTIONS)));\n');
 const options={mode,dataRoot,review:[process.execPath,standIn,'review',review],recovery:[process.execPath,standIn,'recovery',recovery],restart,...extra,...(reviewCommand?{review:reviewCommand}:{})};
 const child=spawn(process.execPath,[launcher],{detached:process.platform!=='win32',env:{...process.env,...env,STAND_IN_EVENTS:events,STAND_IN_DELAY_MS:String(DELAY_MS),SUPERVISE_OPTIONS:JSON.stringify(options)},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 const exited=new Promise(resolve=>child.on('exit',(code,signal)=>resolve({code,signal,time:Date.now()})));
 const readEvents=async()=>(await fs.readFile(events,'utf8').catch(()=>'')).split('\n').filter(Boolean).map(line=>JSON.parse(line));
 const stateFile=path.join(dataRoot,'recovery','runtime-state.json');
 const readState=async()=>JSON.parse(await fs.readFile(stateFile,'utf8'));
 return {root,dataRoot,child,exited,readEvents,readState,stateFile,output:()=>output};
}
async function waitFor(check,timeoutMs=10000){
 const until=Date.now()+timeoutMs;
 for(;;){const value=await check().catch(()=>undefined);if(value)return value;if(Date.now()>until)throw Error('Timed out waiting for '+check);await new Promise(r=>setTimeout(r,25));}
}
// Waits for the supervisor to exit, failing instead of hanging when it does not.
function exitedWithin(run,ms){return Promise.race([run.exited,new Promise((_,reject)=>setTimeout(()=>reject(Error('The supervisor did not exit within '+ms+' ms')),ms).unref())]);}
// Kills the supervisor's whole process group as well, so a child that has not recorded its start yet
// cannot outlive the test and hold its output pipes open.
async function stop(run){
 if(process.platform!=='win32')try{process.kill(-run.child.pid,'SIGKILL')}catch{}
 if(run.child.exitCode===null&&run.child.signalCode===null)run.child.kill('SIGKILL');
 await run.exited;for(const e of await run.readEvents())try{process.kill(e.pid,'SIGKILL')}catch{}
}
// Waits until the named children have all recorded their start (and so are ready for signals).
const started=(run,...names)=>waitFor(async()=>{const events=await run.readEvents();const found=names.map(name=>events.find(e=>e.name===name&&e.event==='start'));return found.every(Boolean)&&found;});

test('the stand-ins run with the configured test delay',async t=>{
 const run=await start({mode:'off',review:'exit:0'});t.after(()=>stop(run));
 const [review]=await started(run,'review');
 assert.equal(review.delayMs,DELAY_MS);
});

test('Review exiting ends the supervisor with Review\'s exit status',async t=>{
 const run=await start({mode:'off',review:'exit:3'});t.after(()=>stop(run));
 const {code}=await run.exited;
 assert.equal(code,3,run.output());
});

test('a Review that cannot be started ends the supervisor with status 127',async t=>{
 const run=await start({mode:'off',review:'serve',reviewCommand:[path.join(os.tmpdir(),'missing-review-command')]});t.after(()=>stop(run));
 const {code}=await run.exited;
 assert.equal(code,127,run.output());
});

test('Review killed by a signal ends the supervisor with status 128 plus the signal number',linux,async t=>{
 const run=await start({mode:'off',review:'killed'});t.after(()=>stop(run));
 const {code}=await exitedWithin(run,5000);
 assert.equal(code,137,run.output());
});

for(const mode of ['off',undefined])test('Recovery mode '+(mode??'unset')+' never starts Recovery and records off',linux,async t=>{
 const run=await start({mode,review:'exit-after-recovery:0'});t.after(()=>stop(run));
 const state=await waitFor(()=>run.readState());
 assert.deepEqual({mode:state.mode,state:state.state,restarts:state.restarts,reason:state.reason},{mode:'off',state:'off',restarts:0,reason:null});
 await started(run,'review');
 await new Promise(r=>setTimeout(r,1000));
 assert.deepEqual((await run.readEvents()).map(e=>e.name+' '+e.event),['review start']);
});

for(const mode of ['verify','repair'])test('Recovery mode '+mode+' starts Recovery at the lowest CPU and I/O priority',linux,async t=>{
 const run=await start({mode});t.after(()=>stop(run));
 const [recovery,review]=await started(run,'recovery','review');
 assert.deepEqual({nice:recovery.nice,ionice:recovery.ionice,dataRoot:recovery.dataRoot,mode:recovery.mode},{nice:19,ionice:'best-effort: prio 7',dataRoot:path.join(run.dataRoot,'recovery'),mode});
 assert.equal(review.nice,0);
 const state=await waitFor(async()=>{const s=await run.readState();return s.state==='running'&&s;});
 assert.equal(state.mode,mode);assert.equal(state.restarts,0);assert.equal(state.reason,null);
 assert.ok(Date.parse(state.lastStartedAt)>0);
});

test('a Recovery crash is restarted with growing, capped delays and Review is untouched',linux,async t=>{
 const run=await start({mode:'verify',recovery:'crash'});t.after(()=>stop(run));
 const starts=await waitFor(async()=>{const s=(await run.readEvents()).filter(e=>e.name==='recovery'&&e.event==='start');return s.length>=5&&s;});
 await started(run,'review');
 const gaps=starts.slice(1).map((s,i)=>s.time-starts[i].time);
 // Delays 200, 400, 800 and then the 800 ms cap, each plus the stand-in's start-up time.
 assert.ok(gaps[0]>=200&&gaps[1]>=gaps[0]+150&&gaps[2]>=gaps[1]+300,'growing delays: '+gaps);
 assert.ok(gaps[3]>=800&&gaps[3]<gaps[2]+300,'capped delay: '+gaps);
 const review=(await run.readEvents()).filter(e=>e.name==='review');
 assert.deepEqual(review.map(e=>e.event),['start']);
 assert.equal(run.child.exitCode,null);
 const state=await waitFor(async()=>{const s=await run.readState();return s.restarts>=4&&s;});
 assert.equal(state.lastExitCode,1);assert.equal(state.lastExitSignal,null);
 assert.ok(Date.parse(state.lastExitedAt)>0);
});

test('repeated Recovery crashes are reported as a crash loop in the state file',linux,async t=>{
 const run=await start({mode:'repair',recovery:'crash'});t.after(()=>stop(run));
 const first=await waitFor(async()=>{const s=await run.readState();return s.state==='restarting'&&s;});
 assert.equal(first.reason,'crash');
 // crashLoopAfter is 3: the third consecutive crash is a loop.
 const looping=await waitFor(async()=>{const s=await run.readState();return s.reason==='crash-loop'&&s;});
 assert.equal(looping.state,'restarting');assert.equal(looping.restarts,2);assert.equal(looping.lastExitCode,1);
});

test('a Recovery run that lasted stableMs restarts the crash count',linux,async t=>{
 const run=await start({mode:'verify',recovery:'crash-after:400',restart:{initialMs:200,maxMs:800,crashLoopAfter:2,stableMs:300}});t.after(()=>stop(run));
 const starts=await waitFor(async()=>{const s=(await run.readEvents()).filter(e=>e.name==='recovery'&&e.event==='start');return s.length>=4&&s;});
 const gaps=starts.slice(1).map((s,i)=>s.time-starts[i].time);
 // Each gap is the 400 ms run plus the initial 200 ms delay; it never grows.
 assert.ok(gaps.every(gap=>gap<gaps[0]+150),'gaps: '+gaps);
 assert.notEqual((await run.readState()).reason,'crash-loop');
});

test('a refusing Recovery is recorded as refused with its reason and not restarted',linux,async t=>{
 const run=await start({mode:'verify',recovery:'refuse:missing-config'});t.after(()=>stop(run));
 const state=await waitFor(async()=>{const s=await run.readState();return s.state==='refused'&&s;});
 assert.deepEqual({reason:state.reason,code:state.lastExitCode,restarts:state.restarts},{reason:'missing-config',code:78,restarts:0});
 await new Promise(r=>setTimeout(r,1000));
 assert.deepEqual((await run.readEvents()).filter(e=>e.name==='recovery').map(e=>e.event),['start','exit']);
 assert.equal((await run.readState()).state,'refused');
 assert.equal(run.child.exitCode,null);
 // The refusal still reaches the container log.
 assert.match(run.output(),/RECOVERY_REFUSED missing-config/);
});

test('a refusal without a well-formed reason line is recorded without copying stderr',linux,async t=>{
 const run=await start({mode:'verify',recovery:'refuse:apiKey=fixture-secret'});t.after(()=>stop(run));
 const state=await waitFor(async()=>{const s=await run.readState();return s.state==='refused'&&s;});
 assert.equal(state.reason,'unknown-refusal');
 assert.doesNotMatch(await fs.readFile(run.stateFile,'utf8'),/fixture-secret/);
});

test('Review exiting stops Recovery, records stopped and ends the supervisor with Review\'s status',linux,async t=>{
 const run=await start({mode:'repair',review:'exit-after-recovery:4'});t.after(()=>stop(run));
 const {code,time}=await run.exited;
 assert.equal(code,4,run.output());
 const recovery=(await run.readEvents()).filter(e=>e.name==='recovery');
 assert.deepEqual(recovery.map(e=>e.event+(e.signal?' '+e.signal:'')),['start','signal SIGTERM','exit']);
 assert.ok(recovery[2].time<=time,'Recovery exited before the supervisor');
 const state=await run.readState();
 assert.deepEqual({state:state.state,reason:state.reason,restarts:state.restarts,code:state.lastExitCode},{state:'stopped',reason:'review-exited',restarts:0,code:0});
});

for(const signal of ['SIGTERM','SIGINT'])test(signal+' reaches both children once and the supervisor exits after them',linux,async t=>{
 const run=await start({mode:'verify'});t.after(()=>stop(run));
 await started(run,'review','recovery');
 await waitFor(async()=>(await run.readState()).state==='running');
 // A repeated signal is not forwarded again: Review's own handler runs once.
 run.child.kill(signal);await new Promise(r=>setTimeout(r,50));run.child.kill(signal);
 const {code,time}=await run.exited;
 assert.equal(code,5,run.output());
 const events=await run.readEvents();
 for(const name of ['review','recovery']){
  const own=events.filter(e=>e.name===name);
  assert.deepEqual(own.map(e=>e.event+(e.signal?' '+e.signal:'')),['start','signal '+signal,'exit'],name);
  assert.ok(own[2].time<=time,name+' exited before the supervisor');
 }
 const state=await run.readState();
 assert.deepEqual({state:state.state,reason:state.reason},{state:'stopped',reason:'shutdown'});
});

test('an invalid Recovery mode is handed to Recovery to refuse and recorded as invalid',linux,async t=>{
 const run=await start({mode:'Repair now',recovery:'refuse:invalid-mode'});t.after(()=>stop(run));
 const state=await waitFor(async()=>{const s=await run.readState();return s.state==='refused'&&s;});
 assert.deepEqual({mode:state.mode,reason:state.reason},{mode:'invalid',reason:'invalid-mode'});
 const started=(await run.readEvents()).find(e=>e.name==='recovery'&&e.event==='start');
 assert.equal(started.mode,'Repair now');
});

test('a Recovery that cannot be started is restarted like a crash and Review keeps running',linux,async t=>{
 const run=await start({mode:'verify',lowPriority:['/nonexistent/ionice']});t.after(()=>stop(run));
 const state=await waitFor(async()=>{const s=await run.readState();return s.state==='restarting'&&s.restarts>=1&&s;});
 assert.equal(state.reason,'crash');
 await started(run,'review');
 assert.equal(run.child.exitCode,null,run.output());
 assert.deepEqual((await run.readEvents()).map(e=>e.name+' '+e.event),['review start']);
});

test('a Recovery that ignores SIGTERM is killed after the stop grace period',linux,async t=>{
 const run=await start({mode:'verify',review:'exit-after-recovery:2',recovery:'stubborn',stopGraceMs:500});t.after(()=>stop(run));
 const {code}=await exitedWithin(run,5000);
 assert.equal(code,2,run.output());
 const state=await run.readState();
 assert.deepEqual({state:state.state,signal:state.lastExitSignal},{state:'stopped',signal:'SIGKILL'});
});

test('a stop during the restart delay cancels the restart',linux,async t=>{
 // Review takes longer to shut down than the restart delay, so a restart would happen meanwhile.
 const run=await start({mode:'verify',review:'serve:1500',recovery:'crash',restart:{initialMs:500,maxMs:500,crashLoopAfter:3,stableMs:60000}});t.after(()=>stop(run));
 await started(run,'review');
 await waitFor(async()=>(await run.readState()).state==='restarting');
 run.child.kill('SIGTERM');
 const {code}=await exitedWithin(run,4000);
 assert.equal(code,5,run.output());
 assert.equal((await run.readEvents()).filter(e=>e.name==='recovery'&&e.event==='start').length,1);
 const state=await run.readState();
 assert.deepEqual({state:state.state,reason:state.reason,restarts:state.restarts},{state:'stopped',reason:'shutdown',restarts:0});
});

test('the state file is replaced atomically, has the documented fields and no configuration values',linux,async t=>{
 const run=await start({mode:'repair',recovery:'crash',restart:{initialMs:20,maxMs:40,crashLoopAfter:3,stableMs:60000},env:{RADARR_API_KEY:'fixture-secret-env'}});t.after(()=>stop(run));
 await fs.mkdir(path.join(run.dataRoot,'recovery'),{recursive:true});
 await fs.writeFile(path.join(run.dataRoot,'recovery','config.json'),JSON.stringify({radarrApiKey:'fixture-secret-config',radarrUrl:'http://127.0.0.1:9/'}));
 // Readers never see a partial file while the supervisor rewrites it after every start and crash.
 // Keep reading until at least five restarts have been recorded.
 let text,state;
 for(const until=Date.now()+10000;!(state?.restarts>=5);){
  assert.ok(Date.now()<until,'restarts '+state?.restarts);
  text=await fs.readFile(run.stateFile,'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if(text!==null)state=JSON.parse(text);
 }
 assert.deepEqual(Object.keys(state).sort(),['lastExitCode','lastExitSignal','lastExitedAt','lastStartedAt','mode','reason','restarts','state','updated','version']);
 assert.equal(state.version,1);
 assert.doesNotMatch(text,/fixture-secret|127\.0\.0\.1/);
 if(process.platform!=='win32')assert.equal((await fs.stat(run.stateFile)).mode&0o777,0o600);
});
