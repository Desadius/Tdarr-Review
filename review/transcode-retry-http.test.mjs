import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {reviewFixture} from './test-helpers/review-fixture.mjs';
import {linuxServer as linux} from './test-helpers/server.mjs';
import {identityOf} from '../recovery/file-identity.mjs';

// The retry routes through the real server (#232). The fixture keeps no Tdarr job reports, so the newest error
// job's report is unreadable: the diagnosis says so and nothing is written. The retry itself is covered by
// transcode-retry.test.mjs with synthetic reports.
const ID='d'.repeat(24),FILE='/fixture-library/Film/new.mkv';
test('HTTP retry of a failed transcode: an unreadable report is diagnosed as such and blocks any write',linux,async t=>{
 const f=await reviewFixture({beforeStart:async({data,media,dbpath})=>{
  const library=path.join(media,'Film','new.mkv');await fs.mkdir(path.dirname(library),{recursive:true});await fs.writeFile(library,'IMPORTED REPLACEMENT');
  await fs.mkdir(path.join(data,'recovery'),{recursive:true});
  await fs.writeFile(path.join(data,'recovery','state.json'),JSON.stringify({version:1,jobs:{},cases:{[ID]:{id:ID,status:'replacement_imported',file:'/fixture-library/Film/old.mkv',source:path.join(media,'Film','old.mkv'),relative:'Film/old.mkv',replacementRelative:'Film/new.mkv',replacementSourceFP:identityOf(await fs.stat(library))}}}));
  const db=new DatabaseSync(dbpath);try{db.prepare('INSERT INTO jobsjsondb VALUES (?)').run(JSON.stringify({_id:'job-film',DB:'fixture-library',file:FILE,status:'Transcode error',end:Date.now()+1000,job:{footprintId:'synthetic-missing-'+ID,fileId:'none'}}))}finally{db.close()}
 }});
 t.after(()=>f.close());
 f.tdarrRows.set(FILE,{_id:FILE,DB:'fixture-library',TranscodeDecisionMaker:'Transcode error'});
 assert.deepEqual(await f.get('/api/recovery/cases/'+ID+'/retry'),{eligible:false,cause:'unreadable',blockers:['transcode-report-unreadable']});
 const unconfirmed=await f.post('/api/recovery/cases/'+ID+'/retry',{snapshot:'x'});assert.equal(unconfirmed.status,400);assert.equal((await unconfirmed.json()).code,'retry_confirm_required');
 const refused=await f.post('/api/recovery/cases/'+ID+'/retry',{snapshot:'x',confirm:true});assert.equal(refused.status,409);
 assert.deepEqual(await refused.json().then(b=>[b.code,b.blockers]),['retry_not_eligible',['transcode-report-unreadable']]);
 assert.ok(f.calls.filter(c=>c.route.startsWith('/api/v2/')).every(c=>['/api/v2/get-nodes','/api/v2/cruddb'].includes(c.route)),'Tdarr is only read');
 assert.deepEqual(f.changes,[]);
});

// The retry through the real server with a loopback fake Tdarr that records its writes (#232).
const REPORT='ffmpeg: Permission denied\n';
async function retryFixture(t){
 const f=await reviewFixture({beforeStart:async({data,media,root,dbpath})=>{
  const library=path.join(media,'Film','new.mkv');await fs.mkdir(path.dirname(library),{recursive:true});await fs.writeFile(library,'IMPORTED REPLACEMENT');
  await fs.mkdir(path.join(data,'recovery'),{recursive:true});
  await fs.writeFile(path.join(data,'recovery','state.json'),JSON.stringify({version:1,jobs:{},cases:{[ID]:{id:ID,status:'replacement_imported',file:'/fixture-library/Film/old.mkv',source:path.join(media,'Film','old.mkv'),relative:'Film/old.mkv',replacementRelative:'Film/new.mkv',replacementSourceFP:identityOf(await fs.stat(library))}}}));
  await fs.mkdir(path.join(root,'tdarr','JobReports','fp1'),{recursive:true});await fs.writeFile(path.join(root,'tdarr','JobReports','fp1','file1'),REPORT);
  await new Promise(r=>setTimeout(r,20));// the error ended after the import and before Review's intent
  const db=new DatabaseSync(dbpath);try{db.prepare('INSERT INTO jobsjsondb VALUES (?)').run(JSON.stringify({_id:'job-film',DB:'fixture-library',file:FILE,status:'Transcode error',end:Date.now(),job:{footprintId:'fp1',fileId:'file1'}}))}finally{db.close()}
 }});
 t.after(()=>f.close());
 f.tdarrRows.set(FILE,{_id:FILE,DB:'fixture-library',TranscodeDecisionMaker:'Transcode error'});
 return f;
}
const bulkWrites=f=>f.calls.filter(c=>c.route==='/api/v2/bulk-update-files');
test('HTTP retry: a confirmed POST queues exactly the replacement row once and a second attempt is refused',linux,async t=>{
 const f=await retryFixture(t);
 const view=await f.get('/api/recovery/cases/'+ID+'/retry');assert.equal(view.eligible,true,JSON.stringify(view));assert.equal(view.cause,'operational');assert.ok(!JSON.stringify(view).includes(f.root));
 const ok=await f.post('/api/recovery/cases/'+ID+'/retry',{snapshot:view.snapshot,confirm:true});assert.equal(ok.status,200);assert.deepEqual(await ok.json(),{ok:true,state:'Queued'});
 assert.equal(bulkWrites(f).length,1);assert.deepEqual(bulkWrites(f)[0].input.data??bulkWrites(f)[0].input,{fileIds:[FILE],updatedObj:{TranscodeDecisionMaker:'Queued',holdUntil:0}});
 const again=await f.post('/api/recovery/cases/'+ID+'/retry',{snapshot:view.snapshot,confirm:true});assert.equal(again.status,409);assert.equal(bulkWrites(f).length,1,'no second write');
});
test('HTTP retry: a stale snapshot is a 409 retry_changed and writes nothing',linux,async t=>{
 const f=await retryFixture(t);
 const response=await f.post('/api/recovery/cases/'+ID+'/retry',{snapshot:'stale',confirm:true});assert.equal(response.status,409);assert.equal((await response.json()).code,'retry_changed');
 assert.deepEqual(bulkWrites(f),[]);
});
test('HTTP retry: an unconfirmed queue write is retry_pending, and the next attempt needs the acknowledgement',linux,async t=>{
 const f=await retryFixture(t);f.afterBulk.set(FILE,{_id:FILE,DB:'fixture-library',TranscodeDecisionMaker:'Transcode error'});
 const view=await f.get('/api/recovery/cases/'+ID+'/retry');
 const pending=await f.post('/api/recovery/cases/'+ID+'/retry',{snapshot:view.snapshot,confirm:true});assert.equal(pending.status,409);assert.equal((await pending.json()).code,'retry_pending');
 const uncertain=await f.get('/api/recovery/cases/'+ID+'/retry');assert.equal(uncertain.uncertain,true);
 const refused=await f.post('/api/recovery/cases/'+ID+'/retry',{snapshot:uncertain.snapshot,confirm:true});assert.equal(refused.status,409);assert.equal((await refused.json()).code,'retry_uncertain');
 assert.equal(bulkWrites(f).length,1,'refused without acknowledgement');
 f.afterBulk.clear();
 const acknowledged=await f.post('/api/recovery/cases/'+ID+'/retry',{snapshot:uncertain.snapshot,confirm:true,acknowledgeUncertain:true});assert.equal(acknowledged.status,200);assert.equal(bulkWrites(f).length,2);
});
