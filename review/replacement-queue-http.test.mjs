import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {linuxServer as linux,deadline} from './test-helpers/server.mjs';
import {reviewFixture} from './test-helpers/review-fixture.mjs';

// A replacement confirmed while another one runs is queued, deduplicated, locked and run afterwards,
// one at a time, after its snapshot and review revision are checked again (#155).
const films=async f=>{const list=(await f.items()).items;return {a:list.find(x=>x.title==='A'),b:list.find(x=>x.title==='B'),c:list.find(x=>x.title==='C')}};

test('HTTP a confirmed replacement during another one is queued once, locked and replaced afterwards',linux,async()=>{
 const f=await reviewFixture();try{
  const {a,b}=await films(f);await f.confirm(a);await f.confirm(b);
  const gate=f.hold('/api/v2/update-node',body=>body.data.nodeUpdates.nodePaused);
  assert.equal((await f.approve(a)).status,202);await deadline(gate.entered,'A pauses the nodes');
  const queued=await f.approve(b);assert.equal(queued.status,202,await queued.clone().text());assert.deepEqual(await queued.json(),{ok:true,queued:true,duplicate:false,position:1});
  const again=await f.approve(b);assert.equal(again.status,202);assert.equal((await again.json()).duplicate,true,'a repeated confirmation adds nothing');
  const d=await f.items();assert.deepEqual(d.replacementQueue.map(q=>q.id),[b.id]);
  const locked=await f.post(`/api/items/${b.id}/review-session`,{snapshot:b.snapshot,revision:b.reviewRevision,session:{}});assert.equal((await locked.json()).code,'item_in_operation');
  assert.equal((await f.approve(a)).status,409,'the running film cannot be queued');
  gate.release();
  const done=await f.settled(2);assert.deepEqual(done.history.map(h=>[h.id,h.status]).sort(),[[a.id,'success'],[b.id,'success']].sort());assert.deepEqual(done.replacementQueue,[]);
  assert.equal(f.events('action.started').length,2,'one replacement at a time, each started once');
 }finally{await f.close()}
});

test('HTTP a queued film whose files change meanwhile is not replaced and keeps both files',linux,async()=>{
 const f=await reviewFixture();try{
  const {a,b}=await films(f);await f.confirm(a);await f.confirm(b);
  const gate=f.hold('/api/v2/update-node',body=>body.data.nodeUpdates.nodePaused);
  assert.equal((await f.approve(a)).status,202);await deadline(gate.entered,'A pauses the nodes');
  assert.equal((await f.approve(b)).status,202);
  const original=f.files.get('B').original,before=await fs.readFile(original);await fs.appendFile(original,'X');
  gate.release();const done=await f.settled(2);
  const failed=done.history.find(h=>h.id===b.id);assert.equal(failed.status,'error');assert.match(failed.message,/změnily|changed/i);
  assert.deepEqual(await fs.readFile(original),Buffer.concat([before,Buffer.from('X')]),'B original untouched');
 }finally{await f.close()}
});

test('HTTP queued replacements never run by themselves after a restart; they are listed as interrupted',linux,async()=>{
 const queued={id:'b'.repeat(24),title:'B',snapshot:'c'.repeat(64),reviewRevision:2,acceptDuration:false,queuedAt:'2026-10-18T10:00:00.000Z'};
 const f=await reviewFixture({beforeStart:({data})=>fs.writeFile(data+'/state.json',JSON.stringify({items:{},history:[],sessions:{},pauses:[],replacementQueue:[queued]}))});try{
  const d=await f.items();assert.deepEqual(d.replacementQueue,[]);assert.deepEqual(d.queueInterrupted.map(q=>[q.id,q.title,q.queuedAt]),[[queued.id,'B',queued.queuedAt]]);
  assert.equal(f.events('action.started').length,0,'nothing queued runs by itself');assert.deepEqual(d.history,[]);
 }finally{await f.close()}
});
