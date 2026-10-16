import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {AUDIT_FILE} from './decision-audit.mjs';
import {reviewFixture} from './test-helpers/review-fixture.mjs';
import {linuxServer as linux} from './test-helpers/server.mjs';
import {hash,sha256} from './core.mjs';

// Decision and rejection records written by the real server for approvals, replacement requests and
// rejections, driven over HTTP against synthetic films and a loopback Tdarr mock (no Radarr is set up).
const REJECTIONS='rejection-decisions.jsonl';
const lines=async file=>(await fs.readFile(file,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
// A symlink where an audit file belongs: both audit writers refuse it and leave the target alone.
const unwritable=name=>async({data,root})=>{const outside=path.join(root,'outside-'+name);await fs.writeFile(outside,'keep');await fs.symlink(outside,path.join(data,name));};
const film=async(f,title)=>(await f.items()).items.find(item=>item.title===title);

test('HTTP an approval writes its decision audit record with the review evidence and transaction',linux,async()=>{
 const f=await reviewFixture();try{
  const a=await film(f,'A'),session=await f.confirm(a);
  assert.equal((await f.approve(a)).status,202);const done=await f.settled(1);assert.equal(done.history[0].status,'success',JSON.stringify(done.history));
  const [record,...more]=await lines(path.join(f.data,AUDIT_FILE));assert.deepEqual(more,[]);
  assert.equal(record.event,'approval');assert.equal(record.id,a.id);assert.equal(record.title,'A');assert.equal(record.outcome,'success');assert.equal(record.jobId,'fixture-A');
  assert.equal(record.snapshot,a.snapshot);assert.equal(record.reviewSession.revision,session.revision);
  assert.deepEqual([record.transaction+'.json'],await f.journals(),'the record names the approval\'s transaction journal');
  assert.equal(done.history[0].warning,undefined);
  const [finished]=await f.eventually('action.finished');assert.equal(finished.action,'approve');assert.ok(!('reviewSession' in finished)&&!JSON.stringify(finished).includes('Synthetic player'),'review evidence never reaches the operator log');
 }finally{await f.close()}
});

test('HTTP a replacement request writes its decision audit record with the reason and outcome',linux,async()=>{
 const f=await reviewFixture();try{
  const a=await film(f,'A');
  const response=await f.post(`/api/items/${a.id}/replace`,{snapshot:a.snapshot,reason:'Synthetic: wrong audio'});assert.equal(response.status,202,await response.clone().text());
  const done=await f.settled(1);assert.equal(done.history[0].action,'replace');
  const [record,...more]=await lines(path.join(f.data,AUDIT_FILE));assert.deepEqual(more,[]);
  // Without a Radarr connection the request fails, and the record says so (no request ID exists).
  assert.deepEqual({event:record.event,id:record.id,reason:record.reason,outcome:record.outcome,requestId:record.requestId,jobId:record.jobId,snapshot:record.snapshot},{event:'replacement',id:a.id,reason:'Synthetic: wrong audio',outcome:'error',requestId:undefined,jobId:'fixture-A',snapshot:a.snapshot});
  assert.equal(done.history[0].status,'error');assert.equal(record.message,done.history[0].message);
  await f.preserved();
 }finally{await f.close()}
});

test('HTTP an audit failure never stops an approval; it only adds a warning',linux,async()=>{
 const f=await reviewFixture({beforeStart:unwritable(AUDIT_FILE)});try{
  const a=await film(f,'A');await f.confirm(a);
  assert.equal((await f.approve(a)).status,202);const done=await f.settled(1);
  assert.equal(done.history[0].status,'success');assert.match(done.history[0].warning,/auditu rozhodnutí selhalo/);
  assert.match((await f.state()).history[0].warning,/auditu rozhodnutí selhalo/,'the warning is saved with the history entry');
  assert.equal(await sha256(f.files.get('A').original),hash(Buffer.alloc(32,97)),'the original was replaced');
  assert.equal(await fs.readFile(path.join(f.root,'outside-'+AUDIT_FILE),'utf8'),'keep');
 }finally{await f.close()}
});

test('HTTP an audit failure is reported as a warning on a replacement request',linux,async()=>{
 const f=await reviewFixture({beforeStart:unwritable(AUDIT_FILE)});try{
  const a=await film(f,'A');
  assert.equal((await f.post(`/api/items/${a.id}/replace`,{snapshot:a.snapshot,reason:'Synthetic: wrong audio'})).status,202);
  const done=await f.settled(1);assert.match(done.history[0].warning,/auditu rozhodnutí selhalo/);assert.match((await f.state()).history[0].warning,/auditu rozhodnutí selhalo/);
 }finally{await f.close()}
});

for(const action of ['reject','replace'])for(const reason of [undefined,'','   ','a'.repeat(1001),'bad\u0000value'])test(`HTTP ${action} with an invalid reason ${JSON.stringify(reason)?.slice(0,20)} is refused before any scan or Tdarr call`,linux,async()=>{
 const f=await reviewFixture();try{
  // A new film D that a scan would have to probe, so a scan shows up as a mock call.
  const a=await film(f,'A');await f.addFilm('D');const calls=f.calls.length;
  const response=await f.post(`/api/items/${a.id}/${action}`,{snapshot:a.snapshot,reason});assert.equal(response.status,400,await response.clone().text());
  assert.deepEqual(f.calls.slice(calls),[],'no scan probe and no Tdarr request');
  const after=await f.items();assert.equal(after.history.length,0);assert.ok(after.items.some(item=>item.id===a.id));
  await assert.rejects(fs.stat(path.join(f.data,REJECTIONS)),{code:'ENOENT'});await f.preserved();
 }finally{await f.close()}
});

test('HTTP a rejection archives its reason and job, deletes only the review copy and keeps the original',linux,async()=>{
 const f=await reviewFixture();try{
  const a=await film(f,'A'),reason='  Chybí japonský zvuk.\nNesedí dialog.  ';
  assert.equal((await f.post(`/api/items/${a.id}/reject`,{snapshot:a.snapshot,reason})).status,202);
  const done=await f.settled(1),entry=done.history[0];
  assert.deepEqual({status:entry.status,action:entry.action,rejectionReason:entry.rejectionReason,jobId:entry.jobId},{status:'success',action:'reject',rejectionReason:'Chybí japonský zvuk.\nNesedí dialog.',jobId:'fixture-A'});
  const rows=await lines(path.join(f.data,REJECTIONS));
  assert.equal(rows[0].snapshot,a.snapshot);assert.ok(!done.items.some(item=>item.id===a.id),'the rejected film leaves review');
  assert.deepEqual(rows.map(row=>[row.event,row.reason??row.rejectionReason,row.jobId]),[['requested','Chybí japonský zvuk.\nNesedí dialog.','fixture-A'],['completed','Chybí japonský zvuk.\nNesedí dialog.','fixture-A']]);
  await assert.rejects(fs.stat(f.files.get('A').review),{code:'ENOENT'});
  assert.equal(await sha256(f.files.get('A').original),hash(Buffer.alloc(128,65)));
  const [finished]=await f.eventually('action.finished');assert.equal(finished.reason,'Chybí japonský zvuk.\nNesedí dialog.');assert.equal(finished.jobId,'fixture-A');assert.ok(!('reviewSession' in finished),'review evidence is not logged');
 }finally{await f.close()}
});

test('HTTP a rejection whose archive cannot be written deletes nothing',linux,async()=>{
 // A directory where the archive belongs makes every append fail.
 const f=await reviewFixture({beforeStart:({data})=>fs.mkdir(path.join(data,REJECTIONS))});try{
  const a=await film(f,'A');
  assert.equal((await f.post(`/api/items/${a.id}/reject`,{snapshot:a.snapshot,reason:'Nesedí obraz'})).status,202);
  const done=await f.settled(1);assert.equal(done.history[0].status,'error');assert.equal(done.history[0].rejectionReason,'Nesedí obraz');assert.ok(done.history[0].message);
  await f.preserved();assert.ok(done.items.some(item=>item.id===a.id),'the film stays in review');
 }finally{await f.close()}
});
