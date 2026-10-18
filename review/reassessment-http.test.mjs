import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {linuxServer as linux} from './test-helpers/server.mjs';
import {reviewFixture} from './test-helpers/review-fixture.mjs';

// A film whose original changed only in its metadata time (ctime) must not loop between the list and
// the review: it is blocked with an explicit verification action, and only a successful verification
// starts a fresh assessment.
const touchCtime=async file=>{const {mode}=await fs.stat(file);await new Promise(r=>setTimeout(r,20));await fs.chmod(file,mode);};
async function changed(f,mutate){
 const before=(await f.items()).items.find(x=>x.title==='A');await f.confirm(before);
 await mutate(f.files.get('A').original);await f.tick({advance:16000});
 return {before,item:(await f.items()).items.find(x=>x.title==='A'),d:await f.items()};
}

test('HTTP a ctime-only change is verified explicitly and starts a fresh assessment that survives restart',linux,async()=>{
 const f=await reviewFixture({clock:true});try{
  const {before,item,d}=await changed(f,touchCtime);
  assert.equal(item.status,'blocked');assert.equal(item.identityChanged,true);assert.equal(item.recheck,'verify');assert.equal(item.canRecheck,true);
  assert.match(item.reason,/ověř/i);assert.equal(d.reviewSessions[item.id],undefined,'no review is advertised for an unverified snapshot');
  const stale=await f.post(`/api/items/${item.id}/review-session`,{snapshot:item.snapshot,revision:0,session:{}});assert.equal(stale.status,409);assert.equal((await stale.json()).code,'item_needs_verification');
  const verified=await f.post(`/api/items/${item.id}/recheck`,{snapshot:item.snapshot});assert.equal(verified.status,200,await verified.clone().text());
  const ready=(await verified.json()).item;assert.equal(ready.status,'ready');assert.equal(ready.snapshot,item.snapshot);assert.notEqual(ready.snapshot,before.snapshot);assert.equal(ready.identityChanged,undefined);
  const session=await f.get(`/api/items/${item.id}/review-session?snapshot=${item.snapshot}`);assert.equal(session.complete,false);assert.equal(session.revision,0);assert.equal(Object.values(session.session.checks).some(Boolean),false,'previous checks never carry over');
  const [event]=await f.eventually('item.reverified');assert.equal(event.id,item.id);assert.equal(event.previousSnapshot,before.snapshot);assert.deepEqual(event.changes,['original:ctime']);
  await f.restart();const after=(await f.items()).items.find(x=>x.id===item.id);assert.equal(after.status,'ready');assert.equal(after.snapshot,item.snapshot);
  await f.preserved();
 }finally{await f.close()}
});

test('HTTP changed content with preserved size and mtime still needs a fresh assessment; nothing old authorizes it',linux,async()=>{
 const f=await reviewFixture({clock:true});try{
  const {item}=await changed(f,async file=>{const mtime=execFileSync('stat',['-c','%y',file],{encoding:'utf8'}).trim(),bytes=await fs.readFile(file);bytes[0]^=0xff;await fs.writeFile(file,bytes);execFileSync('touch',['-m','-d',mtime,file]);});
  assert.equal(item.recheck,'verify');
  const verified=await f.post(`/api/items/${item.id}/recheck`,{snapshot:item.snapshot});assert.equal(verified.status,200);
  const approve=await f.post(`/api/items/${item.id}/approve`,{snapshot:item.snapshot,reviewRevision:1});assert.equal(approve.status,409);
  const session=await f.get(`/api/items/${item.id}/review-session?snapshot=${item.snapshot}`);assert.equal(session.complete,false);
 }finally{await f.close()}
});

test('HTTP a real size change cannot be verified away and stays blocked with guidance',linux,async()=>{
 const f=await reviewFixture({clock:true});try{
  const {item}=await changed(f,file=>fs.appendFile(file,'X'));
  assert.equal(item.status,'blocked');assert.equal(item.identityChanged,true);assert.equal(item.canRecheck,false);assert.equal(item.recheck,null);
  assert.equal((await f.post(`/api/items/${item.id}/recheck`,{snapshot:item.snapshot})).status,409);
  const session=await f.post(`/api/items/${item.id}/review-session`,{snapshot:item.snapshot,revision:0,session:{}});assert.equal((await session.json()).code,'item_needs_verification');
 }finally{await f.close()}
});

test('HTTP a file that changes again during verification, or whose metadata differs, stays blocked',linux,async()=>{
 const f=await reviewFixture({clock:true});try{
  const {item}=await changed(f,touchCtime);
  const gate=f.hold('/fixture/probe');const pending=f.post(`/api/items/${item.id}/recheck`,{snapshot:item.snapshot});
  await gate.entered;await touchCtime(f.files.get('A').original);gate.release();
  const result=await pending;assert.equal(result.status,409);assert.equal((await result.json()).code,'recheck_failed');
  await f.tick({advance:16000});let current=(await f.items()).items.find(x=>x.id===item.id);assert.equal(current.status,'blocked');assert.equal(current.recheck,'verify');
  f.setProbe((file,output)=>file.endsWith('A.mkv')&&!file.includes('/review/')?{...output,format:{...output.format,duration:'61'}}:output);
  const differs=await f.post(`/api/items/${current.id}/recheck`,{snapshot:current.snapshot});assert.equal(differs.status,409);assert.equal((await differs.json()).code,'recheck_failed');
  await f.tick({advance:16000});current=(await f.items()).items.find(x=>x.id===item.id);assert.equal(current.status,'blocked');
  await f.preserved();
 }finally{await f.close()}
});
