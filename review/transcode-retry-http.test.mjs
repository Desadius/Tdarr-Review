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
