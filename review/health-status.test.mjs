import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {isLoopback,recoveryStatusHealth,healthSummary} from './health-status.mjs';
import {RECOVERY_STALE_MS} from './public/review-model.js';
import {readRecoveryRuntime} from './recovery-runtime.mjs';

const NOW=Date.parse('2026-10-13T12:00:00Z');
const runtime={version:1,mode:'repair',state:'refused',restarts:0,lastExitCode:78,lastExitSignal:null,lastStartedAt:'2026-10-13T11:00:00.000Z',lastExitedAt:'2026-10-13T11:00:01.000Z',reason:'missing-config',updated:'2026-10-13T11:00:01.000Z'};

test('Recovery refusal includes its worker reason and only adds health attention',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'recovery-runtime-')),file=path.join(root,'runtime-state.json');
 try{
  await fs.writeFile(file,JSON.stringify(runtime));
  const recoveryRuntime=await readRecoveryRuntime(file);
  assert.deepEqual(recoveryRuntime,{present:true,...runtime});
  const summary=healthSummary({pendingTransactions:0,restorePending:0,recoveryStatus:{present:false,stale:false},recoveryRuntime});
  assert.equal(summary.ok,true);assert.deepEqual(summary.attention,['recovery-refused']);
  assert.equal(summary.recoveryRuntime.reason,'missing-config');
  const {checkHealth}=await import('./healthcheck.mjs');
  const check=await checkHealth(async route=>({status:200,text:route==='/health'?JSON.stringify(summary):'<html>'}));
  assert.equal(check.ok,true);assert.match(check.line,/recovery-refused/);
 }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('Recovery crash-loop attention persists during restarts and running without failing Review health',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'recovery-runtime-')),file=path.join(root,'runtime-state.json');
 try{
  const {checkHealth}=await import('./healthcheck.mjs');
  for(const state of ['restarting','running']){
   await fs.writeFile(file,JSON.stringify({...runtime,state,restarts:5,lastExitCode:1,reason:'crash-loop'}));
   const recoveryRuntime=await readRecoveryRuntime(file);
   const summary=healthSummary({pendingTransactions:0,restorePending:0,recoveryStatus:{present:false,stale:false},recoveryRuntime});
   assert.equal(summary.recoveryRuntime.state,state);assert.equal(summary.ok,true);
   assert.deepEqual(summary.attention,['recovery-crash-loop']);
   assert.equal((await checkHealth(async route=>({status:200,text:route==='/health'?JSON.stringify(summary):'<html>'}))).ok,true);
  }
 }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('an unreadable Recovery runtime snapshot raises attention without exposing file contents or failing health',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'recovery-runtime-')),file=path.join(root,'runtime-state.json');
 try{
  const {checkHealth}=await import('./healthcheck.mjs');
  for(const value of ['{"apiKey":"SECRET"',JSON.stringify({...runtime,version:2}),JSON.stringify({...runtime,reason:'secret /private/config'}),JSON.stringify({...runtime,padding:'x'.repeat(16385)})]){
   await fs.writeFile(file,value);
   const recoveryRuntime=await readRecoveryRuntime(file);
   assert.deepEqual(recoveryRuntime,{present:true,state:'unreadable',reason:null});
   const summary=healthSummary({pendingTransactions:0,restorePending:0,recoveryStatus:{present:false,stale:false},recoveryRuntime});
   assert.deepEqual(summary.attention,['recovery-runtime-unreadable']);assert.equal(summary.ok,true);
   assert.doesNotMatch(JSON.stringify(summary),/SECRET|private/);
   assert.equal((await checkHealth(async route=>({status:200,text:route==='/health'?JSON.stringify(summary):'<html>'}))).ok,true);
  }
 }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('missing or Off Recovery runtime adds no attention, and old running/stopped snapshots retain their state',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'recovery-runtime-')),file=path.join(root,'runtime-state.json');
 const summary=recoveryRuntime=>healthSummary({pendingTransactions:0,restorePending:0,recoveryStatus:{present:false,stale:false},recoveryRuntime});
 try{
  const missing=await readRecoveryRuntime(file);
  assert.deepEqual(missing,{present:false,mode:'off',state:'off',reason:null});assert.deepEqual(summary(missing).attention,[]);
  for(const [state,mode,reason] of [['off','off',null],['running','verify',null],['restarting','repair','crash'],['stopped','repair','shutdown'],['stopped','repair','review-exited']]){
   await fs.writeFile(file,JSON.stringify({...runtime,state,mode,reason}));
   const current=await readRecoveryRuntime(file);
   assert.equal(current.state,state);assert.equal(current.reason,reason);assert.deepEqual(summary(current).attention,[]);
  }
 }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('Recovery runtime validates the supervisor schema and strips unrelated fields',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'recovery-runtime-')),file=path.join(root,'runtime-state.json');
 try{
  for(const reason of ['missing-config','mode-conflict','invalid-mode','registry-refused','unknown-refusal','future-refusal']){
   await fs.writeFile(file,JSON.stringify({...runtime,reason,apiKey:'SECRET',stderr:'SECRET'}));
   assert.deepEqual(await readRecoveryRuntime(file),{present:true,...runtime,reason});
  }
  const invalid=[null,[],{}, {...runtime,version:2},{...runtime,mode:'SECRET'},{...runtime,state:'SECRET'},{...runtime,restarts:-1},{...runtime,restarts:1.5},{...runtime,lastExitCode:256},{...runtime,lastExitSignal:'SECRET'},{...runtime,lastStartedAt:'SECRET'},{...runtime,lastExitedAt:0},{...runtime,updated:null},{...runtime,reason:'SECRET /private'}];
  for(const value of invalid){await fs.writeFile(file,JSON.stringify(value));assert.deepEqual(await readRecoveryRuntime(file),{present:true,state:'unreadable',reason:null})}
  await fs.rm(file);await fs.mkdir(file);
  assert.deepEqual(await readRecoveryRuntime(file),{present:true,state:'unreadable',reason:null},'a directory is not a state file');
 }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('Recovery runtime timestamps accept ISO dates and reject parseable arbitrary text',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'recovery-runtime-')),file=path.join(root,'runtime-state.json');
 try{
  for(const field of ['lastStartedAt','lastExitedAt','updated']){
   await fs.writeFile(file,JSON.stringify({...runtime,[field]:'private note 1'}));
   assert.deepEqual(await readRecoveryRuntime(file),{present:true,state:'unreadable',reason:null},field);
  }
 }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('only loopback addresses may read the health summary',()=>{
 for(const address of ['127.0.0.1','::1','::ffff:127.0.0.1'])assert.equal(isLoopback(address),true);
 for(const address of ['192.168.2.90','::ffff:192.168.2.90','172.17.0.1','127.0.0.2',undefined])assert.equal(isLoopback(address),false);
});

test('Recovery status freshness uses the same 12-minute limit as the UI',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'health-status-'));const file=path.join(root,'.tdarr-recovery-status.json');
 try{
  assert.deepEqual(await recoveryStatusHealth(file,NOW),{present:false,stale:false});
  await fs.writeFile(file,JSON.stringify({version:1,updated:new Date(NOW-RECOVERY_STALE_MS).toISOString(),cases:[]}));
  assert.equal((await recoveryStatusHealth(file,NOW)).stale,false);
  assert.equal((await recoveryStatusHealth(file,NOW+1)).stale,true);
  await fs.writeFile(file,JSON.stringify({version:1,cases:[]}));
  assert.deepEqual(await recoveryStatusHealth(file,NOW),{present:true,stale:true,error:'missing update time'});
  await fs.writeFile(file,'{"radarrApiKey":"SECRET"');
  const broken=await recoveryStatusHealth(file,NOW);assert.equal(broken.stale,true);assert.doesNotMatch(JSON.stringify(broken),/SECRET/);
 }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('the summary flags operator conditions but always stays ok',()=>{
 const fresh={present:true,updated:'2026-10-13T12:00:00.000Z',stale:false};
 assert.deepEqual(healthSummary({pendingTransactions:0,restorePending:0,recoveryStatus:fresh}),{ok:true,attention:[],pendingTransactions:0,restorePending:0,recoveryStatus:fresh});
 assert.deepEqual(healthSummary({pendingTransactions:0,restorePending:0,recoveryStatus:{present:false,stale:false}}).attention,[],'Recovery not installed is not a problem');
 const all=healthSummary({pendingTransactions:1,restorePending:2,recoveryStatus:{...fresh,stale:true}});
 assert.equal(all.ok,true);assert.deepEqual(all.attention,['pending-transaction','node-restore-pending','recovery-status-stale']);
});

test('the container health check needs /health and the UI, but only reports operator conditions',async()=>{
 const {checkHealth,UI_PATHS}=await import('./healthcheck.mjs');
 const summary=JSON.stringify({ok:true,attention:['pending-transaction','node-restore-pending'],pendingTransactions:1});
 const server=(overrides={})=>async route=>({status:overrides[route]??200,text:route==='/health'?summary:'<html>'});
 const attention=await checkHealth(server());assert.equal(attention.ok,true,'attention never fails the check');assert.match(attention.line,/^Attention: pending-transaction, node-restore-pending /);
 assert.deepEqual(UI_PATHS,['/','/app.js']);
 for(const route of ['/health',...UI_PATHS]){const result=await checkHealth(server({[route]:404}));assert.equal(result.ok,false,route);assert.ok(result.line.endsWith('answered 404'),result.line)}
 assert.equal((await checkHealth(async route=>({status:200,text:route==='/health'?'not json':''}))).line,'OK (unreadable summary)');
 await assert.rejects(checkHealth(async()=>{throw Error('ECONNREFUSED')}),'no answer is a failure of the check');
});

// #89: an in-flight repair paused by Verify that keeps the original outside the library for over 24 h.
import {RECOVERY_ORIGINAL_OUTSIDE_MS} from './public/review-model.js';
async function outsideSummary(t,{age,updatedAgo=60000,patch={}}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'recovery-outside-')),file=path.join(root,'status.json');t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const record={id:'a'.repeat(24),source:'recovery',phase:'waiting_replacement',verifyPausedStep:'replacement_request',originalOutsideLibrary:true,originalOutsideSince:new Date(NOW-age).toISOString(),originalRestoredAt:null,...patch};
 await fs.writeFile(file,JSON.stringify({version:1,updated:new Date(NOW-updatedAgo).toISOString(),configChange:null,cases:[record]}));
 const summary=healthSummary({pendingTransactions:0,restorePending:0,recoveryStatus:await recoveryStatusHealth(file,NOW)});
 const {checkHealth}=await import('./healthcheck.mjs');
 const check=await checkHealth(async route=>({status:200,text:route==='/health'?JSON.stringify(summary):'<html>'}));
 assert.equal(summary.ok,true);assert.equal(check.ok,true,'the notice never fails the container health check');
 assert.equal(summary.recoveryStatus.originalsOutsideLibrary,summary.attention.includes('recovery-original-outside-library')?1:0,'the published count follows the same rule as the code');
 return summary.attention;
}
test('the original outside the library just past 24 h in Verify raises attention without failing health',async t=>{
 assert.deepEqual(await outsideSummary(t,{age:RECOVERY_ORIGINAL_OUTSIDE_MS+1000}),['recovery-original-outside-library']);
});
test('no outside-the-library attention before 24 h, in Repair, with the original in the library or for a stale status',async t=>{
 const past=RECOVERY_ORIGINAL_OUTSIDE_MS+1000;
 assert.deepEqual(await outsideSummary(t,{age:RECOVERY_ORIGINAL_OUTSIDE_MS-1000}),[],'just before 24 h');
 assert.deepEqual(await outsideSummary(t,{age:past,patch:{verifyPausedStep:null}}),[],'Repair exports no pause');
 assert.deepEqual(await outsideSummary(t,{age:past,patch:{originalOutsideLibrary:false,originalOutsideSince:null,originalRestoredAt:new Date(NOW).toISOString()}}),[],'original back in the library');
 assert.deepEqual(await outsideSummary(t,{age:past,patch:{originalOutsideLibrary:null}}),[],'unknown location');
 assert.deepEqual(await outsideSummary(t,{age:past,updatedAgo:RECOVERY_STALE_MS+1000}),['recovery-status-stale'],'a stale status raises only the stale code');
 for(const step of ['tdarr_handoff','quarantine_purge'])assert.deepEqual(await outsideSummary(t,{age:past,patch:{verifyPausedStep:step,phase:step==='quarantine_purge'?'replacement_imported':'replacement_queue_intent'}}),[],step+': the replacement is already in the library');
});
