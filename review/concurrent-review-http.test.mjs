import test from 'node:test';
import assert from 'node:assert/strict';
import {linuxServer as linux,deadline} from './test-helpers/server.mjs';
import {reviewFixture} from './test-helpers/review-fixture.mjs';

// While film A is being replaced, film B can be reviewed and compared and its review is saved;
// A itself accepts no review, approval or preview work until its operation ends (#155).
test('HTTP another film is reviewed and saved while a replacement runs; the film in the operation stays locked',linux,async()=>{
 const f=await reviewFixture();try{
  const films=(await f.items()).items,a=films.find(x=>x.title==='A'),b=films.find(x=>x.title==='B');
  await f.confirm(a);
  const gate=f.hold('/api/v2/update-node',body=>body.data.nodeUpdates.nodePaused);
  assert.equal((await f.approve(a)).status,202);await deadline(gate.entered,'replacement of A paused the nodes');
  const during=await f.items();assert.equal(during.active?.id,a.id);
  // B: load, save checks and compare while A's replacement holds the nodes.
  const route=`/api/items/${b.id}/review-session`,current=await f.get(route+'?snapshot='+b.snapshot);
  const saved=await f.post(route,{snapshot:b.snapshot,revision:current.revision,session:{...current.session,method:'external',device:'Synthetic player',scope:{originalIndex:1,reviewIndex:1,seconds:null},note:'Reviewed during replacement'}});
  assert.equal(saved.status,200,await saved.clone().text());const savedB=await saved.json();
  const frames=await f.post(`/api/items/${b.id}/frames`,{snapshot:b.snapshot,seconds:1});assert.notEqual(frames.status,409,'B can be compared');
  // A: locked while its operation runs.
  for(const [path,body] of [[`/api/items/${a.id}/review-session`,{snapshot:a.snapshot,revision:a.reviewRevision,session:{}}],[`/api/items/${a.id}/frames`,{snapshot:a.snapshot,seconds:1}],[`/api/items/${a.id}/approval`,{snapshot:a.snapshot,reviewRevision:a.reviewRevision}]]){
   const r=await f.post(path,body);assert.equal(r.status,409,path);assert.equal((await r.json()).code,'item_in_operation',path);
  }
  // Media actions still wait for the running replacement.
  assert.equal((await f.post(`/api/items/${b.id}/reject`,{snapshot:b.snapshot,reason:'Synthetic reason'})).status,409);
  gate.release();const d=await f.settled(1);assert.equal(d.history[0].status,'success');
  assert.equal((await f.get(route+'?snapshot='+b.snapshot)).revision,savedB.revision,'B keeps the review saved during the replacement');
  await f.restart();assert.equal((await f.get(route+'?snapshot='+b.snapshot)).session.note,'Reviewed during replacement');
 }finally{await f.close()}
});
