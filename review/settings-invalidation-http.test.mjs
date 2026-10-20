import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {linuxServer} from './test-helpers/server.mjs';
import {reviewFixture} from './test-helpers/review-fixture.mjs';

// What a settings Apply leaves of the saved review work: the confirmed review of film A, its explicit
// Approve decision and the films the server lists. Driven through the real server: save a draft, Test
// it, Apply it with what Test reported, then read the films again.
async function applied(f,patch){
 const current=await f.get('/api/shared-settings');
 const saved=await f.post('/api/shared-settings/draft',{revision:current.revision,patch:{review:patch}});assert.equal(saved.status,200,await saved.clone().text());
 const {revision}=await saved.json();
 const tested=await f.post('/api/shared-settings/test',{revision});assert.equal(tested.status,200,await tested.clone().text());
 const report=await tested.json();
 const started=await f.post('/api/shared-settings/apply',{revision,...(report.invalidation?{invalidation:{level:report.invalidation.level}}:{})});assert.equal(started.status,202,await started.clone().text());
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

test('Apply of a changed installation name: saved review and Approve decision',linuxServer,async t=>{
 const f=await reviewFixture();t.after(()=>f.close());const a=await reviewedAndApproved(f);
 await applied(f,{label:'Renamed installation'});
 assert.deepEqual(await kept(f,a),{review:false,approval:false});
});

test('Apply of a changed FFmpeg path: saved review and Approve decision',linuxServer,async t=>{
 const f=await reviewFixture();t.after(()=>f.close());const a=await reviewedAndApproved(f);
 const {draft}=await f.get('/api/shared-settings'),copy=draft.review.ffmpeg+'.copy.mjs';
 await fs.copyFile(draft.review.ffmpeg,copy);await fs.chmod(copy,0o700);
 await applied(f,{ffmpeg:copy});
 assert.deepEqual(await kept(f,a),{review:false,approval:false});
});

test('Apply of a changed Tdarr review root: saved review and Approve decision',linuxServer,async t=>{
 const f=await reviewFixture();t.after(()=>f.close());const a=await reviewedAndApproved(f);
 await applied(f,{tdarrReviewRoot:'/elsewhere/review'});
 assert.deepEqual(await kept(f,a),{review:false,approval:false});
});
