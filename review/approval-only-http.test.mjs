import test from 'node:test';
import assert from 'node:assert/strict';
import {linuxServer as linux} from './test-helpers/server.mjs';
import {reviewFixture} from './test-helpers/review-fixture.mjs';

// "Schválit" records a durable decision bound to the snapshot and review revision; it never touches media.
// Batch replacement accepts only such approvals and re-validates them.
const film=async(f,title)=>(await f.items()).items.find(x=>x.title===title);
const approveOnly=(f,item,revision=item.reviewRevision)=>f.post(`/api/items/${item.id}/approval`,{snapshot:item.snapshot,reviewRevision:revision});
const batch=(f,...items)=>f.post('/api/approve-batch',{items:items.map(x=>({id:x.id,snapshot:x.snapshot,reviewRevision:x.reviewRevision}))});

test('HTTP approval only persists across restart and changes no media, Tdarr or history',linux,async()=>{
 const f=await reviewFixture();try{
  const a=await film(f,'A');await f.confirm(a);
  const response=await approveOnly(f,a);assert.equal(response.status,200,await response.clone().text());
  assert.equal((await response.json()).approval.reviewRevision,a.reviewRevision);
  let d=await f.items();assert.equal(d.approvals[a.id].reviewRevision,a.reviewRevision);assert.equal(d.history.length,0);assert.equal(d.active,null);
  await f.preserved();assert.deepEqual(f.changes,[],'no node pause');assert.equal(f.calls.some(c=>c.route==='/api/v2/rescan-file'),false);assert.deepEqual(await f.journals(),[]);
  const [event]=await f.eventually('item.approved');assert.equal(event.id,a.id);
  await f.restart();d=await f.items();assert.equal(d.approvals[a.id].reviewRevision,a.reviewRevision);await f.preserved();
 }finally{await f.close()}
});

test('HTTP approval needs a completed current review and refuses a stale snapshot or revision',linux,async()=>{
 const f=await reviewFixture();try{
  const a=await film(f,'A');
  assert.equal((await approveOnly(f,a,0)).status,409,'incomplete review');
  await f.confirm(a);
  assert.equal((await approveOnly(f,a,a.reviewRevision-1)).status,409,'older revision');
  assert.equal((await f.post(`/api/items/${a.id}/approval`,{snapshot:'0'.repeat(64),reviewRevision:a.reviewRevision})).status,409,'other snapshot');
  assert.equal((await f.items()).approvals[a.id],undefined);await f.preserved();
 }finally{await f.close()}
});

test('HTTP batch replacement takes only explicitly approved films; a newer review revision voids the approval',linux,async()=>{
 const f=await reviewFixture();try{
  const a=await film(f,'A'),b=await film(f,'B');await f.confirm(a);await f.confirm(b);
  const refused=await batch(f,a);assert.equal(refused.status,409);assert.equal((await refused.json()).code,'batch_item_not_approved');
  assert.equal((await approveOnly(f,a)).status,200);
  // Saving the review again after approval makes the old decision stale for the new revision.
  const route=`/api/items/${a.id}/review-session`,current=await f.get(route+'?snapshot='+a.snapshot);
  const saved=await f.post(route,{snapshot:a.snapshot,revision:current.revision,session:{...current.session,note:'Changed after approval'}});assert.equal(saved.status,200,await saved.clone().text());
  const stale={...a,reviewRevision:(await saved.json()).revision};assert.equal((await f.items()).approvals[a.id],undefined);
  assert.equal((await batch(f,stale)).status,409);
  await f.preserved();
  assert.equal((await approveOnly(f,stale)).status,200);assert.equal((await approveOnly(f,b)).status,200);
  const started=await batch(f,stale,b);assert.equal(started.status,202,await started.clone().text());
  const d=await f.settled(2);assert.deepEqual(d.history.map(h=>h.status),['success','success']);assert.deepEqual(d.approvals,{},'replaced films leave no approval behind');assert.deepEqual((await f.state()).approvals,{},'nor in the saved state');
 }finally{await f.close()}
});
