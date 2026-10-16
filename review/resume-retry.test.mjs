import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {RESUME_RETRY_TICK_MS,RESUME_RETRY_MAX_MS,resumeRetryDelay} from './resume-retry.mjs';
import {reviewFixture} from './test-helpers/review-fixture.mjs';
import {deadline,linuxServer as linux} from './test-helpers/server.mjs';

test('failed node restores back off exponentially up to a ceiling',()=>{
 assert.deepEqual([0,1,2,3].map(resumeRetryDelay),[RESUME_RETRY_TICK_MS,2*RESUME_RETRY_TICK_MS,4*RESUME_RETRY_TICK_MS,8*RESUME_RETRY_TICK_MS]);
 for(const failures of [6,20,1000,Infinity])assert.equal(resumeRetryDelay(failures),RESUME_RETRY_MAX_MS);
 assert.equal(resumeRetryDelay(-1),RESUME_RETRY_TICK_MS);
});

// The real server with a node it paused earlier and could not restore at start-up: the mock Tdarr
// reports no nodes until showNodes(true). Timer ticks come from the test clock, never real waits.
const TICK=RESUME_RETRY_TICK_MS;
// The server scans once for previews 1 s after start, and a running scan excludes a restore. Wait
// until that first scan has probed the films and then join it, so later ticks see an idle server.
async function idle(f){
 const stop=Date.now()+20000;
 while(!f.calls.some(call=>call.route==='/fixture/probe')){if(Date.now()>stop)assert.fail('the start-up scan did not run: '+f.diagnostics());await new Promise(resolve=>setTimeout(resolve,20))}
 await f.items();return f;
}
const pending=async()=>idle(await reviewFixture({nodesVisible:false,clock:true,beforeStart:({data})=>fs.writeFile(path.join(data,'state.json'),JSON.stringify({items:{},history:[],sessions:{},pauses:[{name:'fixture-node',pausedAt:'2026-10-16T00:00:00.000Z'}]}))}));
// Every restore attempt logs one nodes.resume event, whether or not it reached the node.
const attempts=f=>f.events('nodes.resume');
async function attempted(f,count,label){
 const stop=Date.now()+20000;
 while(attempts(f).length<count){if(Date.now()>stop)assert.fail('restore attempt '+count+' ('+label+') did not happen: '+f.diagnostics());await new Promise(resolve=>setTimeout(resolve,20))}
 assert.equal(attempts(f).length,count,label);
}
// A tick the guards skip starts nothing. A started attempt calls Tdarr at once and logs within
// milliseconds; this short wait is the only real delay in these tests.
async function skipped(f,count,label){await new Promise(resolve=>setTimeout(resolve,500));assert.equal(attempts(f).length,count,label)}
const tick=(f,advance=0)=>f.tick({advance,interval:TICK});
const unpaused=f=>f.calls.filter(call=>call.route==='/api/v2/update-node'&&call.input.data.nodeUpdates.nodePaused===false);

test('HTTP GET /api/items never restores a node; the retry timer does',linux,async()=>{
 const f=await pending();try{
  await attempted(f,1,'start-up');
  f.nodes.fixture.nodePaused=true;f.showNodes(true);
  for(let n=0;n<3;n++)assert.equal((await f.items()).restorePending,1);
  assert.deepEqual(unpaused(f),[],'listing films has no node side effect');assert.equal(attempts(f).length,1);
  await tick(f);await attempted(f,2,'timer');
  assert.equal(unpaused(f).length,1);assert.equal(attempts(f)[1].outcome,'success');
  const after=await f.items();assert.equal(after.restorePending,0);assert.deepEqual(after.pendingRestores,[]);
 }finally{await f.close()}
});

test('HTTP failed restores back off exponentially on the timer',linux,async()=>{
 const f=await pending();try{
  await attempted(f,1,'start-up');
  await tick(f);await attempted(f,2,'first retry');
  await tick(f);await skipped(f,2,'within the first backoff');
  await tick(f,TICK);await attempted(f,3,'after one tick');
  await tick(f,TICK);await skipped(f,3,'the second backoff is twice as long');
  await tick(f,TICK);await attempted(f,4,'after two ticks');
  assert.deepEqual(unpaused(f),[]);assert.equal((await f.items()).restorePending,1);
 }finally{await f.close()}
});

test('HTTP the timer never restores a node while an approval is running',linux,async()=>{
 const f=await reviewFixture({clock:true});try{
  const a=(await f.items()).items.find(item=>item.title==='A');await f.confirm(a);
  const before=attempts(f).length,gate=f.hold('/api/v2/update-node',body=>body.data.nodeUpdates.nodePaused);
  assert.equal((await f.approve(a)).status,202);await deadline(gate.entered,'approval dispatch pause');
  await tick(f,10*TICK);await skipped(f,before,'busy approval');assert.deepEqual(unpaused(f),[]);
  gate.release();const done=await f.settled(1);assert.equal(done.history[0].status,'success');assert.deepEqual(f.changes,[true,false]);
 }finally{await f.close()}
});

// After the backoff has grown, a restore that leaves no pending node resets it: the next failed
// restore (from a later approval whose node disappeared) is retried on the very next tick.
for(const clearedBy of ['keep','resume'])test(`HTTP clearing every pending node by ${clearedBy} resets the retry backoff`,linux,async()=>{
 const f=await pending();try{
  await attempted(f,1,'start-up');
  for(const [advance,count] of [[0,2],[TICK,3],[2*TICK,4]]){await tick(f,advance);await attempted(f,count,'failed retry '+count)}
  // The backoff is now 4 ticks.
  let count=4;
  if(clearedBy==='keep'){const kept=await f.post('/api/node-restores/keep',{name:'fixture-node',confirm:true});assert.equal(kept.status,200,await kept.clone().text())}
  else{f.nodes.fixture.nodePaused=true;f.showNodes(true);await tick(f,4*TICK);await attempted(f,++count,'successful retry');assert.equal(attempts(f).at(-1).outcome,'success')}
  assert.equal((await f.items()).restorePending,0);
  f.nodes.fixture.nodePaused=false;f.showNodes(true);
  const a=(await f.items()).items.find(item=>item.title==='A');await f.confirm(a);
  const rescan=f.hold('/api/v2/rescan-file');assert.equal((await f.approve(a)).status,202);await deadline(rescan.entered,'post-exchange rescan');
  f.showNodes(false);rescan.release();
  const done=await f.settled(1);assert.equal(done.history[0].status,'success');assert.equal(done.restorePending,1);
  await attempted(f,++count,'the approval\'s own restore');
  await tick(f);await attempted(f,++count,'retried at once after the reset');
  await tick(f,TICK);await attempted(f,++count,'first backoff again');
 }finally{await f.close()}
});
