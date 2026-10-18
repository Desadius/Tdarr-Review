import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DELAY_MS,start,stop,waitFor,started,exitedWithin} from './test-supervisor-helpers.mjs';

// The supervisor runs as a real process with stand-in scripts in place of Review and Recovery.
// Only temporary directories are used; nothing touches media, Tdarr or Radarr.
const linux={skip:process.platform!=='linux'?'Requires Linux signals, ionice and directory fsync':false};

// Test mode: SUPERVISOR_TEST_DELAY_MS makes Review's stand-in start late and every stand-in pause right
// after recording its start. A test that reads an event it did not wait for, or signals a child before it
// is ready, then fails every time instead of now and then. supervisor-delayed.test.mjs runs this file so.
const test=(name,...rest)=>nodeTest(DELAY_MS?name+' (stand-ins delayed '+DELAY_MS+' ms)':name,...rest);

test('an interrupted activation refuses initial Recovery startup while Review remains available',linux,async t=>{
 const run=await start({mode:'verify',beforeStart:async({dataRoot})=>fs.writeFile(path.join(dataRoot,'settings-activation.json'),JSON.stringify({version:1,id:'interrupted-apply',state:'committing',blocking:true}))});t.after(()=>stop(run));
 await started(run,'review');const state=await waitFor(async()=>{const s=await run.readState();return s.state!=='off'&&s;});
 assert.equal(state.state,'refused');
 assert.equal(state.reason,'settings-activation-incomplete');assert.equal(state.lastStartedAt,null);assert.equal((await run.readEvents()).some(e=>e.name==='recovery'),false);
});

// Waits for n Recovery restarts and returns the time from each recorded exit to the next recorded start:
// the supervisor's restart delay plus noise, without the stand-in's run or test pause (#98).
const restartGaps=(run,n)=>waitFor(async()=>{
 const recovery=(await run.readEvents()).filter(e=>e.name==='recovery');
 const starts=recovery.filter(e=>e.event==='start'),exits=recovery.filter(e=>e.event==='exit');
 return starts.length>n&&starts.slice(1,n+1).map((s,i)=>s.time-exits[i].time);
},20000);

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
 assert.equal(review.nice,os.getPriority(),'Review keeps the priority it was started with');
 const state=await waitFor(async()=>{const s=await run.readState();return s.state==='running'&&s;});
 assert.equal(state.mode,mode);assert.equal(state.restarts,0);assert.equal(state.reason,null);
 assert.ok(Date.parse(state.lastStartedAt)>0);
});

test('a Recovery crash is restarted with growing, capped delays and Review is untouched',linux,async t=>{
 const run=await start({mode:'verify',recovery:'crash-after:300',restart:{initialMs:300,maxMs:1200,crashLoopAfter:3,stableMs:60000}});t.after(()=>stop(run));
 const gaps=await restartGaps(run,4);
 await started(run,'review');
 // Delays 300, 600, 1200 and then the 1200 ms cap. Each gap adds the noticing of the exit and the next
 // stand-in's start-up, but stays below the next doubling. Recovery crashes only after 300 ms, so the first
 // exit is not noticed late while Review's stand-in is still starting.
 assert.ok(gaps.every((gap,i)=>gap>=[300,600,1200,1200][i]-5&&gap<[600,1200,2400,2400][i]),'growing, capped delays: '+gaps);
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
 const run=await start({mode:'verify',recovery:'crash-after:400',restart:{initialMs:300,maxMs:1200,crashLoopAfter:2,stableMs:300}});t.after(()=>stop(run));
 const gaps=await restartGaps(run,3);
 // Every 400 ms run outlasts stableMs, so each restart waits the initial 300 ms again and never the doubled 600 ms.
 assert.ok(gaps.every(gap=>gap>=295&&gap<600),'gaps: '+gaps);
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
