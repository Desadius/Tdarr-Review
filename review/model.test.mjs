import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {capabilities, classifyRecovery, recoveryProgress, liveRecoveryRecord, projectRequests, historyWarnings, historyFollowup, RECOVERY_STALE_MS} from './public/review-model.js';

const NOW = Date.parse('2026-10-11T11:35:00Z');
const freshTime = new Date(NOW - 30000).toISOString();
const ready = {id:'a'.repeat(24),snapshot:'b'.repeat(64),status:'ready',durationA:600,durationB:600};
const completedReview={version:1,requirements:{hdr:false},snapshot:ready.snapshot,complete:true,session:{step:4,deferred:false,checks:{preparation:true,image:true,audio:true,syncStart:true,syncMiddle:true,syncEnd:true}}};
const clear = {active:null,batchRunning:false,batch:null,recovery:[],restorePending:0,reviewSessions:{[ready.id]:completedReview}};
const context = {authenticated:true,fresh:true};
const writes = ['approve','approveBatch','select','reject','replace','recheck','restore','compareImage','compareAudio'];

test('read-only Recovery detail follows the exact live case while decision snapshots stay frozen',()=>{
 const current={source:'recovery',id:'case',canRestore:false,progress:{seconds:1}},fresh={...current,progress:{seconds:20}};
 assert.equal(liveRecoveryRecord(current,[{...fresh,id:'other'},fresh]),fresh);assert.equal(current.progress.seconds,1);
 assert.equal(liveRecoveryRecord(current,[{...fresh,id:'other'}]),null);
 for(const patch of [{source:undefined},{canRestore:true},{canRestore:undefined}])assert.equal(liveRecoveryRecord({...current,...patch},[fresh]),null);
 assert.equal(liveRecoveryRecord(current,[{...fresh,source:undefined}]),null);assert.equal(liveRecoveryRecord(current,[{...fresh,canRestore:true}]),null);
 assert.equal(liveRecoveryRecord(ready,[fresh]),null,'film approval must keep its reviewed snapshot');
});

test('deferred faulty replacements and completed diagnostics do not imply Review approval',()=>{
 const rec={source:'recovery',statusUpdated:freshTime};
 const deferred=classifyRecovery({...rec,phase:'deferred_cooldown',sourceRetained:true},NOW);assert.equal(deferred.category,'waiting');assert.match(deferred.nextStep,/Plexu/);
 assert.equal(classifyRecovery({...rec,phase:'no_action',originalCheckKind:'healthy'},NOW).category,'done');
 for(const kind of [null,'operational','unconfirmed'])assert.equal(classifyRecovery({...rec,phase:'no_action',originalCheckKind:kind},NOW).category,'attention');
 assert.equal(classifyRecovery({...rec,phase:'dry_run'},NOW).category,'attention');
 const hold=classifyRecovery({...rec,phase:'replacement_imported',tdarrStatus:'Hold'},NOW);assert.equal(hold.category,'attention');assert.equal(hold.unknown,false);assert.match(hold.label,/pozastavená/);
});

test('progress renders only original decode measurements, with unknown duration and stale ETA handled explicitly',()=>{
 const rec={source:'recovery',phase:'verifying',progress:{stage:'original_decode',pass:1,running:true,startedAt:new Date(NOW-20000).toISOString(),updatedAt:freshTime,lastAdvanceAt:freshTime,heartbeatAt:freshTime,seconds:20,durationSeconds:100,speed:2,etaSeconds:40}};
 const p=recoveryProgress(rec,NOW);assert.equal(p.percent,20);assert.equal(p.elapsedSeconds,20);assert.equal(p.etaSeconds,40);assert.equal(p.alive,true);
 assert.equal(recoveryProgress({...rec,phase:'replacement_imported'},NOW),null);
 assert.equal(recoveryProgress({...rec,progress:{...rec.progress,pass:3}},NOW),null);
 const unknown=recoveryProgress({...rec,progress:{...rec.progress,durationSeconds:'100',etaSeconds:NaN}},NOW);assert.equal(unknown.percent,null);assert.equal(unknown.etaSeconds,null);
 const quiet=recoveryProgress({...rec,progress:{...rec.progress,lastAdvanceAt:new Date(NOW-91000).toISOString()}},NOW);assert.equal(quiet.etaSeconds,null);assert.match(quiet.note,/nezměnila/);assert.match(quiet.note,/není potvrzená/);
 const disconnected=recoveryProgress({...rec,progress:{...rec.progress,heartbeatAt:new Date(NOW-91000).toISOString()}},NOW);assert.equal(disconnected.alive,false);assert.equal(disconnected.etaSeconds,null);assert.match(disconnected.note,/spojení/);
 const ended=recoveryProgress({...rec,progress:{...rec.progress,running:false,ended:true,seconds:100}},NOW);assert.equal(ended.percent,99.9);assert.equal(ended.etaSeconds,null);assert.match(ended.note,/vyhodnocení/);
});

test('safe defaults and identity validation prevent actions from incomplete data', () => {
  const closed = capabilities(ready,clear);
  for(const name of writes) assert.equal(closed[name],false,name);
  assert.equal(closed.download,false);
  for(const bad of [{snapshot:''},{snapshot:'x'.repeat(64)},{id:'bad-id'},{snapshot:null}]) {
    const caps=capabilities({...ready,...bad,canRecheck:true},clear,context);
    for(const name of writes) assert.equal(caps[name],false,`${name}: ${JSON.stringify(bad)}`);
  }
  assert.equal(capabilities(ready,undefined,context).approve,false);
});

test('valid ready item offers writes only under current authenticated state', () => {
  const caps=capabilities({...ready,canRecheck:true},clear,context);
  for(const name of ['approve','approveBatch','select','reject','replace','recheck','compareImage','compareAudio','download']) assert.equal(caps[name],true,name);
  assert.equal(caps.restore,false);
  assert.equal(caps.writeBlocked,false);
});

test('every global blocker disables all file/evidence writes including restore', () => {
  const restore={id:'c'.repeat(24),phase:'waiting',canRestore:true,queue:[]};
  const states=[{active:{}},{batchRunning:true},{batch:{status:'running'}},{recovery:['transaction']},{restorePending:1},{recovery:null}];
  const contexts=[{authenticated:false},{fresh:false},{previewBusy:true},{settingsBusy:true},{resumePending:true},{mutationPending:true},{scanBusy:true},{expectedSnapshot:'changed'}];
  for(const delta of states) {
    const caps=capabilities({...ready,canRecheck:true},{...clear,...delta},context);
    for(const name of writes) assert.equal(caps[name],false,`${name}: ${JSON.stringify(delta)}`);
    assert.equal(capabilities(restore,{...clear,...delta},context).restore,false);
    assert.ok(caps.reason);
  }
  for(const delta of contexts) {
    const caps=capabilities({...ready,canRecheck:true},clear,{...context,...delta});
    for(const name of writes) assert.equal(caps[name],false,`${name}: ${JSON.stringify(delta)}`);
  }
  assert.equal(capabilities(ready,{...clear,batch:{status:'complete'}},context).approve,true);
});

test('duration exception cannot enter bulk approval or selection', () => {
  const exception={...ready,status:'blocked',canApproveDuration:true,durationB:601};
  const caps=capabilities(exception,clear,context);
  assert.equal(caps.approve,true);
  assert.equal(caps.approveBatch,false);
  assert.equal(caps.select,false);
  assert.equal(capabilities({...exception,durationB:NaN},clear,context).approve,false);
  assert.equal(capabilities({...ready,status:'blocked'},clear,context).approve,false);
});

test('restore preserves server capability, phase, identity and observed queue guards', () => {
  const restore={id:'c'.repeat(24),phase:'waiting',canRestore:true,queue:[]};
  assert.equal(capabilities(restore,clear,context).restore,true);
  assert.equal(capabilities({...restore,phase:'manual'},clear,context).restore,true);
  for(const delta of [{canRestore:false},{phase:'imported'},{source:'recovery'},{queue:[{status:'downloading'}]},{replacement:{title:'new'}},{id:'bad'}]) {
    assert.equal(capabilities({...restore,...delta},clear,context).restore,false,JSON.stringify(delta));
  }
  assert.equal(capabilities(restore,clear,{...context,requestsFresh:false}).restore,false);
});

test('replacement conflicts use exact itemId, never same film title', () => {
  assert.equal(capabilities(ready,clear,{...context,requests:[{itemId:ready.id,phase:'waiting'}]}).replace,false);
  assert.equal(capabilities(ready,clear,{...context,requests:[{itemId:'other',title:ready.title,phase:'waiting'}]}).replace,true);
  assert.equal(capabilities(ready,clear,{...context,requests:[{itemId:ready.id,phase:'restored'}]}).replace,true);
  assert.equal(capabilities(ready,clear,{...context,requestsFresh:false}).replace,false);
});

test('imported, queued and transcode success do not invent approval', () => {
  const rec={id:'case',source:'recovery',phase:'replacement_imported',statusUpdated:freshTime};
  for(const status of [null,undefined,'Unknown','Anything else']) {
    const result=classifyRecovery({...rec,tdarrStatus:status,pipelineLabel:'Náhrada schválena'},NOW);
    assert.equal(result.category,'attention');assert.equal(result.unknown,true);
  }
  assert.equal(classifyRecovery({...rec,tdarrStatus:'Queued'},NOW).category,'running');
  assert.equal(classifyRecovery({...rec,tdarrStatus:'Transcoding'},NOW).category,'running');
  for(const status of ['Transcode success','Transcode error','Not required']) assert.equal(classifyRecovery({...rec,tdarrStatus:status},NOW).category,'attention');
  assert.equal(classifyRecovery({phase:'imported',updated:freshTime},NOW).category,'attention');
});

test('completion needs structured approval or cleanup evidence', () => {
  const rec={source:'recovery',phase:'replacement_imported',statusUpdated:freshTime};
  assert.equal(classifyRecovery({...rec,cleanupComplete:true},NOW).category,'done');
  assert.equal(classifyRecovery({...rec,deleteAfter:'2026-10-18T10:00:00Z'},NOW).category,'done');
  assert.equal(classifyRecovery({...rec,approvedAt:'2026-10-11T10:00:00Z'},NOW).category,'done');
  assert.equal(classifyRecovery({...rec,approvedAt:'2026-10-12T10:00:00Z'},NOW).category,'attention');
  assert.equal(classifyRecovery({...rec,deleteAfter:'invalid'},NOW).category,'attention');
  assert.equal(classifyRecovery({...rec,cleanupComplete:true,error:'Retention identity mismatch'},NOW).category,'attention');
  const restored=classifyRecovery({phase:'restored',updated:freshTime},NOW);
  assert.equal(restored.category,'done');assert.match(restored.label,/vráceny/);assert.match(restored.nextStep,/ověř/);
});

test('stale and unknown timestamps remain visible and cannot imply active success', () => {
  const rec={source:'recovery',phase:'deferred_limit',statusUpdated:new Date(NOW-RECOVERY_STALE_MS).toISOString()};
  assert.equal(classifyRecovery(rec,NOW).category,'waiting');
  const stale=classifyRecovery({...rec,statusUpdated:new Date(NOW-RECOVERY_STALE_MS-1).toISOString()},NOW);
  assert.equal(stale.stale,true);assert.equal(stale.category,'attention');assert.match(stale.warnings.join(' '),/12 minut/);
  for(const invalid of [null,'bad',new Date(NOW+120001).toISOString()]) {
    const result=classifyRecovery({...rec,statusUpdated:invalid,updated:freshTime},NOW);
    assert.equal(result.category,'attention');assert.equal(result.unknown,true);
  }
  const oldCompleted=classifyRecovery({...rec,cleanupComplete:true,statusUpdated:'2026-09-01T00:00:00Z'},NOW);
  assert.equal(oldCompleted.category,'done');assert.equal(oldCompleted.stale,true);assert.ok(oldCompleted.warnings.length);
});

test('waiting, active queue, manual failure and preserved source retain distinct semantics', () => {
  assert.equal(classifyRecovery({phase:'waiting',updated:freshTime,search:{status:'started'}},NOW).category,'running');
  assert.equal(classifyRecovery({phase:'waiting',updated:freshTime,search:{status:'completed'}},NOW).category,'waiting');
  assert.equal(classifyRecovery({phase:'waiting',updated:freshTime,queue:[{status:'downloading'}]},NOW).category,'running');
  assert.equal(classifyRecovery({phase:'waiting',updated:freshTime,queue:[{status:'failed'}]},NOW).category,'attention');
  assert.equal(classifyRecovery({phase:'waiting',updated:freshTime,search:{status:'failed'}},NOW).category,'attention');
  assert.equal(classifyRecovery({phase:'manual',updated:freshTime},NOW).category,'attention');
  const kept=classifyRecovery({source:'recovery',phase:'waiting_source_kept',statusUpdated:freshTime},NOW);
  assert.equal(kept.category,'waiting');assert.equal(kept.confirmedAudioFault,true);assert.match(kept.nextStep,/vadné/);
  assert.equal(classifyRecovery({source:'recovery',phase:'new_unknown_state',statusUpdated:freshTime},NOW).unknown,true);
});

test('projections keep cases independent and only link exact valid item identities', () => {
  const items=[{...ready,title:'Same movie'},{...ready,id:'d'.repeat(24),title:'Same movie'}];
  const requests=[{id:'1',title:'Same movie',phase:'waiting',itemId:ready.id,updated:freshTime},{id:'2',title:'Same movie',phase:'waiting',updated:freshTime},{id:'1',source:'recovery',title:'Same movie',phase:'deferred_limit',statusUpdated:freshTime}];
  const projected=projectRequests(requests,items,NOW);
  assert.equal(projected.length,3);assert.equal(projected[0].reviewItemId,ready.id);assert.equal(projected[1].reviewItemId,null);assert.equal(projected[2].reviewItemId,null);
  assert.equal(new Set(projected.map(x=>x.key)).size,3);
  assert.deepEqual(requests[0],{id:'1',title:'Same movie',phase:'waiting',itemId:ready.id,updated:freshTime});
});

test('history warnings remain events; repaired errors are not pending film alerts', () => {
  const entries=[{id:ready.id,action:'approve',status:'success',warning:'Tdarr timeout',time:'a'},{id:ready.id,action:'approve',status:'error',message:'Hash mismatch',time:'b'},{status:'error',fixedIn:'1.9.2',message:'Old error'},{status:'success',action:'approve'}];
  const warnings=historyWarnings(entries);
  assert.equal(warnings.length,2);assert.equal(warnings[0].severity,'warning');assert.equal(warnings[1].severity,'error');
  assert.equal(warnings[0].reviewItemId,null);assert.equal(warnings[1].reviewItemId,null);assert.notEqual(warnings[0].key,warnings[1].key);
});

test('history followup uses exact valid ID, action and a strictly later successful timestamp', () => {
  const error={id:ready.id,title:'Same title',action:'approve',status:'error',time:'2026-10-11T10:00:00Z'};
  const later={...error,status:'success',time:'2026-10-11T10:01:00Z'};
  const latest={...later,time:'2026-10-11T11:00:00Z'};
  const earlier={...later,time:'2026-10-11T09:00:00Z'};
  const sameTime={...later,time:error.time};
  const otherId={...later,id:'d'.repeat(24)};
  const otherAction={...later,action:'reject'};
  const laterError={...error,time:'2026-10-11T12:00:00Z'};
  const history=[latest,otherAction,laterError,earlier,error,otherId,sameTime,later];
  assert.equal(historyFollowup(error,history),later);
  assert.equal(historyFollowup(error,[...history].reverse()),later);
  assert.equal(historyFollowup(error,[otherId,otherAction,earlier,sameTime,laterError]),null);
  assert.equal(historyFollowup({...error,id:'invalid'},[{...later,id:'invalid'}]),null);
  assert.equal(historyFollowup({...error,time:'invalid'},history),null);
  assert.equal(historyFollowup({...error,action:''},[{...later,action:''}]),null);
  assert.equal(historyFollowup(error,[{...later,time:'invalid'}]),null);
});

test('later success suppresses prior error-only badge, but does not suppress warning events', () => {
  const error={id:ready.id,title:'Same title',action:'approve',status:'error',message:'Earlier failure',time:'2026-10-11T10:00:00Z'};
  const success={...error,status:'success',time:'2026-10-11T10:01:00Z'};
  assert.equal(historyWarnings([error,success]).length,0);
  assert.equal(historyWarnings([success,error]).length,0);
  assert.equal(historyWarnings([error,{...success,id:'d'.repeat(24)}]).length,1);
  assert.equal(historyWarnings([error,{...success,action:'reject'}]).length,1);
  assert.equal(historyWarnings([error,{...success,status:'error'}]).length,2);
  const warnedError={...error,warning:'Approval evidence unavailable'};
  const errorWarnings=historyWarnings([warnedError,success]);
  assert.equal(errorWarnings.length,1);assert.equal(errorWarnings[0].severity,'warning');assert.equal(errorWarnings[0].message,warnedError.warning);
  const warnedSuccess={...success,warning:'Tdarr timeout'};
  const laterSuccess={...success,time:'2026-10-11T10:02:00Z'};
  assert.equal(historyWarnings([warnedSuccess,laterSuccess]).length,1);
  const newestError={...error,time:'2026-10-11T10:03:00Z'};
  const remaining=historyWarnings([error,success,newestError]);
  assert.equal(remaining.length,1);assert.equal(remaining[0].time,newestError.time);
});

test('synthetic history badge preserves only the unresolved warning without deleting historic errors', async () => {
  const items=JSON.parse(await fs.readFile(new URL('../fixtures/items.json',import.meta.url),'utf8'));
  const originalLength=items.history.length;
  const warnings=historyWarnings(items.history);
  assert.equal(warnings.length,1);
  assert.equal(warnings[0].title,'Fixture film 4');
  const errors=items.history.filter(h=>h.status==='error'&&!h.fixedIn);
  assert.equal(errors.length,3);
  for(const error of errors) assert.ok(historyFollowup(error,items.history));
  assert.equal(items.history.length,originalLength);
});

test('synthetic fixtures: all 17 requests survive and no undocumented imported state is done', async () => {
  const items=JSON.parse(await fs.readFile(new URL('../fixtures/items.json',import.meta.url),'utf8'));
  const requests=JSON.parse(await fs.readFile(new URL('../fixtures/requests.json',import.meta.url),'utf8'));
  const projected=projectRequests(requests,items,NOW);
  assert.equal(projected.length,requests.requests.length);
  assert.equal(projected.filter(x=>x.category==='done').length,0);
  assert.equal(projected.filter(x=>x.phase==='deferred_limit'&&x.category==='waiting').length,4);
  assert.equal(projected.filter(x=>x.tdarrStatus==='Queued'&&x.category==='running').length,3);
  for(const item of items.items) { assert.equal(capabilities(item,items,context).approve,false); assert.equal(capabilities(item,{...items,reviewSessions:{[item.id]:{...completedReview,snapshot:item.snapshot}}},context).approve,true); }
});


test('approval requires the current individually completed review; tools remain available before confirmation',()=>{
 for(const review of [undefined,{...completedReview,snapshot:'c'.repeat(64)},{...completedReview,complete:false},{...completedReview,version:0},{...completedReview,session:{...completedReview.session,deferred:true}},{...completedReview,session:{...completedReview.session,checks:{...completedReview.session.checks,syncEnd:false}}}]){
  const c=capabilities(ready,{...clear,reviewSessions:{[ready.id]:review}},context);
  for(const k of ['approve','approveBatch','select'])assert.equal(c[k],false,k);assert.equal(c.compareImage,true);assert.equal(c.compareAudio,true);assert.equal(c.reject,true);
 }
});

test('HDR approval requires an explicit device attestation and remains conditional for SDR',()=>{
 for(const review of [{...completedReview,requirements:{hdr:true}},{...completedReview,requirements:{hdr:true},session:{...completedReview.session,device:'TV',checks:{...completedReview.session.checks,hdr:false}}}])assert.equal(capabilities(ready,{...clear,reviewSessions:{[ready.id]:review}},context).approve,false);
 const review={...completedReview,requirements:{hdr:true},session:{...completedReview.session,device:'TV',checks:{...completedReview.session.checks,hdr:true}}};assert.equal(capabilities(ready,{...clear,reviewSessions:{[ready.id]:review}},context).approve,true);
});
