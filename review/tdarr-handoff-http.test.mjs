import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {reviewFixture} from './test-helpers/review-fixture.mjs';
import {linuxServer as linux} from './test-helpers/server.mjs';
import {identityOf} from '../recovery/file-identity.mjs';

// Review's Tdarr handoff through the real server (#231): synthetic files and the mock Tdarr only.
const ID='e'.repeat(24),FILE='/fixture-library/Film/new.mkv';
test('HTTP Tdarr handoff: offered in the overview, confirmed, and only a rescan of the exact file is written',linux,async t=>{
 let library;
 const f=await reviewFixture({beforeStart:async({data,media})=>{
  library=path.join(media,'Film','new.mkv');await fs.mkdir(path.dirname(library),{recursive:true});await fs.writeFile(library,'IMPORTED REPLACEMENT');
  const old=new Date(Date.now()-3600000);await fs.utimes(library,old,old);
  await fs.mkdir(path.join(data,'recovery'),{recursive:true});
  await fs.writeFile(path.join(data,'recovery','state.json'),JSON.stringify({version:1,jobs:{},cases:{[ID]:{id:ID,status:'replacement_imported',file:'/fixture-library/Film/old.mkv',source:path.join(media,'Film','old.mkv'),relative:'Film/old.mkv',
   replacementRelative:'Film/new.mkv',replacementSourceFP:identityOf(await fs.stat(library))}}}));
 }});
 t.after(()=>f.close());
 const view=await f.get('/api/recovery/cases/'+ID+'/handoff');assert.equal(view.eligible,true,JSON.stringify(view));assert.equal(view.uncertain,false);
 const unconfirmed=await f.post('/api/recovery/cases/'+ID+'/handoff',{snapshot:view.snapshot});
 assert.equal(unconfirmed.status,400);assert.equal((await unconfirmed.json()).code,'handoff_confirm_required');
 assert.equal(f.calls.some(c=>c.route==='/api/v2/rescan-file'),false,'nothing written without confirmation');
 const pending=await f.post('/api/recovery/cases/'+ID+'/handoff',{snapshot:view.snapshot,confirm:true});
 assert.equal(pending.status,409);assert.equal((await pending.json()).code,'handoff_pending');
 assert.equal((await f.get('/api/recovery/cases/'+ID+'/handoff')).uncertain,true);
 const unacknowledged=await f.post('/api/recovery/cases/'+ID+'/handoff',{snapshot:view.snapshot,confirm:true});assert.equal((await unacknowledged.json()).code,'handoff_uncertain');
 f.afterRescan.set(FILE,{_id:FILE,DB:'fixture-library',TranscodeDecisionMaker:'Queued'});
 const done=await f.post('/api/recovery/cases/'+ID+'/handoff',{snapshot:view.snapshot,confirm:true,acknowledgeUncertain:true});
 assert.equal(done.status,200,await done.clone().text());assert.equal((await done.json()).state,'Queued');
 assert.deepEqual(f.calls.filter(c=>c.route==='/api/v2/rescan-file').map(c=>c.input.data),[{_id:FILE,DB:'fixture-library'},{_id:FILE,DB:'fixture-library'}]);
 assert.ok(f.calls.filter(c=>c.route.startsWith('/api/v2/')).every(c=>['/api/v2/get-nodes','/api/v2/cruddb','/api/v2/rescan-file'].includes(c.route)),'no other Tdarr write');
 assert.ok(f.calls.filter(c=>c.route==='/api/v2/cruddb').every(c=>c.input.data.mode==='getById'));
 assert.deepEqual(f.changes,[],'no node was paused');
 assert.equal(JSON.parse(await fs.readFile(path.join(f.data,'recovery','state.json'),'utf8')).cases[ID].status,'replacement_imported','Recovery state is untouched');
 const after=await f.get('/api/recovery/cases/'+ID+'/handoff');assert.deepEqual(after,{eligible:false,blockers:['handoff-reached']});
});
