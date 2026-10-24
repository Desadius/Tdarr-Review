import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {linuxServer} from './test-helpers/server.mjs';
import {reviewFixture} from './test-helpers/review-fixture.mjs';
import path from 'node:path';

// What a settings Apply leaves of the saved review work: the confirmed review of film A, its explicit
// Approve decision and the films the server lists. Driven through the real server: save a draft, Test
// it, Apply it with what Test reported, then read the films again.
async function applied(f,patch,{send,section='review'}={}){
 const current=await f.get('/api/shared-settings');
 const saved=await f.post('/api/shared-settings/draft',{revision:current.revision,patch:{[section]:patch}});assert.equal(saved.status,200,await saved.clone().text());
 const {revision}=await saved.json();
 const tested=await f.post('/api/shared-settings/test',{revision});assert.equal(tested.status,200,await tested.clone().text());
 const report=await tested.json();
 await send?.(report);
 const started=await f.post('/api/shared-settings/apply',{revision,...(report.invalidation?{invalidation:{level:report.invalidation.level,reviews:report.invalidation.reviews,approvals:report.invalidation.approvals}}:{})});assert.equal(started.status,202,await started.clone().text());
 const {id}=await started.json(),deadline=Date.now()+20000;
 while(Date.now()<deadline){const value=await f.get('/api/shared-settings/status');if(value.id===id&&['succeeded','failed','cancelled'].includes(value.state)){assert.equal(value.state,'succeeded',JSON.stringify(value));return report;}await new Promise(r=>setTimeout(r,20));}
 assert.fail('Settings apply did not settle');
}
async function reviewedAndApproved(f){
 const a=(await f.items()).items.find(item=>item.title==='A');await f.confirm(a);
 assert.equal((await f.post(`/api/items/${a.id}/approval`,{snapshot:a.snapshot,reviewRevision:a.reviewRevision})).status,200);
 const before=await f.items();assert.equal(before.reviewSessions[a.id]?.complete,true);assert.ok(before.approvals[a.id]);
 return a;
}
const kept=async(f,a)=>{const after=await f.items();return {review:after.reviewSessions[a.id]?.complete===true,approval:!!after.approvals[a.id]};};

// A frame of film A is prepared, so the sample cache holds one artifact.
async function sampled(f,a){const r=await f.post(`/api/items/${a.id}/frames`,{snapshot:a.snapshot,seconds:0});assert.equal(r.status,200,await r.clone().text());return r.json();}
const artifacts=async f=>(await fs.readdir(path.join(f.data,'preview-cache'))).filter(name=>name.endsWith('.json'));
const lastApply=async f=>(await f.get('/api/shared-settings/audit')).history.filter(entry=>entry.action==='apply').at(-1);

test('Apply of a changed installation name clears nothing: review, Approve decision and samples stay',linuxServer,async t=>{
 const f=await reviewFixture();t.after(()=>f.close());const a=await reviewedAndApproved(f);await sampled(f,a);
 const report=await applied(f,{label:'Renamed installation'});
 assert.deepEqual(report.invalidation,{level:'none',fields:[],reviews:0,approvals:0});
 assert.deepEqual(await kept(f,a),{review:true,approval:true});
 assert.equal((await artifacts(f)).length,1);assert.equal((await sampled(f,a)).cached,true,'the prepared frame is still served');
 assert.deepEqual((await lastApply(f)).invalidation,{level:'none',fields:[],shown:{reviews:0,approvals:0},cleared:{reviews:0,approvals:0}});
});

test('an inactive offline TV path plan preserves movie settings, confirmations, approval and previews across restart',linuxServer,async t=>{
 const f=await reviewFixture();t.after(()=>f.close());const a=await reviewedAndApproved(f);await sampled(f,a);
 const before=(await f.get('/api/shared-settings')).draft.review;
 const report=await applied(f,{tv:{enabled:false,mediaRoot:path.join(f.root,'offline-tv'),reviewRoot:path.join(f.root,'offline-tv-results'),libraryId:'tv-only'}},{section:'libraries'});
 assert.deepEqual(report.invalidation,{level:'none',fields:[],reviews:0,approvals:0});assert.deepEqual(await kept(f,a),{review:true,approval:true});
 assert.deepEqual((await f.get('/api/settings')).config,before);assert.equal((await sampled(f,a)).cached,true);
 await f.restart();assert.deepEqual(await kept(f,a),{review:true,approval:true});assert.deepEqual((await f.get('/api/settings')).config,before);
 const shared=await f.get('/api/shared-settings');assert.equal(shared.active.libraries.tv.enabled,false);assert.equal(shared.active.libraries.tv.libraryId,'tv-only');assert.equal((await sampled(f,a)).cached,true);
 await f.preserved();
});

test('applying an optional Sonarr connection preserves Movie review, Approve and preview state across restart',linuxServer,async t=>{
 const f=await reviewFixture();t.after(()=>f.close());const a=await reviewedAndApproved(f);await sampled(f,a);
 const before=(await f.get('/api/settings')).config,sonarrUrl=f.mockBase+'/sonarr',secret='synthetic-sonarr-inspection-key';
 const report=await applied(f,{url:sonarrUrl,apiKey:secret},{section:'sonarr'});
 assert.deepEqual(report.invalidation,{level:'none',fields:[],reviews:0,approvals:0});
 assert.deepEqual(await kept(f,a),{review:true,approval:true});assert.equal((await artifacts(f)).length,1);assert.equal((await sampled(f,a)).cached,true);
 const shared=await f.get('/api/shared-settings');assert.equal(shared.active.sonarr.url,sonarrUrl);assert.equal(shared.active.sonarr.apiKey,undefined);assert.equal(JSON.stringify(shared).includes(secret),false);
 assert.equal(f.calls.filter(call=>call.route.startsWith('/sonarr/api/v3/')).length,0,'Test and Apply must not contact Sonarr');
 await f.restart();assert.deepEqual(await kept(f,a),{review:true,approval:true});assert.deepEqual((await f.get('/api/settings')).config,before);
 assert.equal((await artifacts(f)).length,1);assert.equal((await sampled(f,a)).cached,true);
 assert.equal(f.calls.filter(call=>call.route.startsWith('/sonarr/api/v3/')).length,0,'restart must not contact Sonarr');
 await f.preserved();
});

test('the first Apply of the imported settings unchanged, and a Recovery-only change, clear nothing',linuxServer,async t=>{
 const f=await reviewFixture();t.after(()=>f.close());const a=await reviewedAndApproved(f);await sampled(f,a);
 assert.deepEqual((await applied(f,{})).invalidation,{level:'none',fields:[],reviews:0,approvals:0});
 assert.deepEqual((await applied(f,{maxRepairsPerDay:5},{section:'recovery'})).invalidation,{level:'none',fields:[],reviews:0,approvals:0});
 assert.deepEqual(await kept(f,a),{review:true,approval:true});assert.equal((await artifacts(f)).length,1);
});

test('Apply of a changed FFmpeg path clears only the prepared samples',linuxServer,async t=>{
 const f=await reviewFixture();t.after(()=>f.close());const a=await reviewedAndApproved(f);await sampled(f,a);
 const {draft}=await f.get('/api/shared-settings'),copy=draft.review.ffmpeg+'.copy.mjs';
 await fs.copyFile(draft.review.ffmpeg,copy);await fs.chmod(copy,0o700);
 const report=await applied(f,{ffmpeg:copy});
 assert.deepEqual(report.invalidation,{level:'samples',fields:['ffmpeg'],reviews:0,approvals:0});
 assert.deepEqual(await kept(f,a),{review:true,approval:true});
 assert.deepEqual(await artifacts(f),[],'no sample prepared with the old FFmpeg is left to serve');
});

test('Apply of a changed Tdarr review root clears saved reviews, Approve decisions and samples',linuxServer,async t=>{
 const f=await reviewFixture();t.after(()=>f.close());const a=await reviewedAndApproved(f);await sampled(f,a);
 const report=await applied(f,{tdarrReviewRoot:'/elsewhere/review'});
 assert.deepEqual(report.invalidation,{level:'all',fields:['tdarrReviewRoot'],reviews:1,approvals:1});
 assert.deepEqual(await kept(f,a),{review:false,approval:false});assert.deepEqual(await artifacts(f),[]);
 assert.deepEqual((await lastApply(f)).invalidation,{level:'all',fields:['tdarrReviewRoot'],shown:{reviews:1,approvals:1},cleared:{reviews:1,approvals:1}});
});

test('a review saved between Test and Apply is cleared too and recorded as more than Test showed',linuxServer,async t=>{
 const f=await reviewFixture();t.after(()=>f.close());
 const a=(await f.items()).items.find(item=>item.title==='A');
 await applied(f,{tdarrReviewRoot:'/elsewhere/review'},{send:async report=>{assert.equal(report.invalidation.reviews,0);await f.confirm(a);}});
 assert.deepEqual((await lastApply(f)).invalidation,{level:'all',fields:['tdarrReviewRoot'],shown:{reviews:0,approvals:0},cleared:{reviews:1,approvals:0}});
});

test('Apply without a Test result, or with a milder level than the draft has, is refused and changes nothing',linuxServer,async t=>{
 const f=await reviewFixture();t.after(()=>f.close());const a=await reviewedAndApproved(f);
 const current=await f.get('/api/shared-settings');
 assert.equal((await f.post('/api/shared-settings/draft',{revision:current.revision,patch:{review:{tdarrReviewRoot:'/elsewhere/review'}}})).status,200);
 for(const [invalidation,code] of [[undefined,'settings_test_required'],[{level:'none'},'settings_test_required'],[{level:'none',reviews:0,approvals:0},null],[{level:'samples',reviews:0,approvals:0},null]]){
  // A refused Apply is audited, which changes the revision; each attempt uses the current one.
  const response=await f.post('/api/shared-settings/apply',{revision:(await f.get('/api/shared-settings')).revision,...(invalidation?{invalidation}:{})});
  if(code){assert.equal(response.status,409);assert.equal((await response.json()).code,code);continue;}
  assert.equal(response.status,202,await response.clone().text());const {id}=await response.json(),deadline=Date.now()+20000;let value;
  while(Date.now()<deadline){value=await f.get('/api/shared-settings/status');if(value.id===id&&['succeeded','failed','cancelled'].includes(value.state))break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(value.state,'failed');assert.equal(value.error.code,'settings_invalidation_changed');
 }
 assert.equal((await f.get('/api/shared-settings')).generation,0,'nothing was committed');
 assert.deepEqual(await kept(f,a),{review:true,approval:true});
});
