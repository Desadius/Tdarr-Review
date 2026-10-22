import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {reviewFixture} from './test-helpers/review-fixture.mjs';
import {linuxServer as linux} from './test-helpers/server.mjs';
import {identityOf} from '../recovery/file-identity.mjs';
import {approvalEvidencePath} from '../recovery/quarantine-retention.mjs';

// Assessment of an installed transcoded result through the real server (#230): synthetic files, the mock Tdarr.
const ID='f'.repeat(24),TDARR='/fixture-library/Film/new.mkv';
test('HTTP assessment of an installed result: view, save and confirmed approval write only the approval evidence',linux,async t=>{
 let replacementFP,library;
 const f=await reviewFixture({beforeStart:async({data,root,media,dbpath})=>{
  library=path.join(media,'Film','new.mkv');await fs.mkdir(path.dirname(library),{recursive:true});
  await fs.writeFile(library,'IMPORTED REPLACEMENT');replacementFP=identityOf(await fs.stat(library));
  await new Promise(r=>setTimeout(r,20));await fs.rm(library);await fs.writeFile(library,'TRANSCODED RESULT');
  const quarantined=path.join(root,'quarantine',ID,'old.mkv');await fs.mkdir(path.dirname(quarantined),{recursive:true});await fs.writeFile(quarantined,'FAULTY ORIGINAL');
  await fs.mkdir(path.join(data,'recovery'),{recursive:true});
  await fs.writeFile(path.join(data,'recovery','state.json'),JSON.stringify({version:1,jobs:{},cases:{[ID]:{id:ID,status:'replacement_imported',file:TDARR,source:path.join(media,'Film','old.mkv'),relative:'Film/old.mkv',
   fp:identityOf(await fs.stat(quarantined)),replacementRelative:'Film/new.mkv',replacementSourceFP:replacementFP,quarantine:quarantined}}}));
  const db=new DatabaseSync(dbpath);try{db.prepare('INSERT INTO jobsjsondb VALUES (?)').run(JSON.stringify({_id:'job-film',DB:'fixture-library',file:TDARR,status:'Transcode success',end:Date.now()+1000}))}finally{db.close()}
 }});
 t.after(()=>f.close());
 f.tdarrRows.set(TDARR,{_id:TDARR,DB:'fixture-library',TranscodeDecisionMaker:'Transcode success'});
 const view=await f.get('/api/recovery/cases/'+ID+'/installed');
 assert.equal(view.eligible,true,JSON.stringify(view));assert.ok(!JSON.stringify(view).includes(f.root),'no path leaves the server');
 const checks={image:true,audio:true,syncStart:true,syncMiddle:true,syncEnd:true};
 const unconfirmed=await f.post('/api/recovery/cases/'+ID+'/installed/approve',{snapshot:view.snapshot});
 assert.equal(unconfirmed.status,400);assert.equal((await unconfirmed.json()).code,'installed_confirm_required');
 const incomplete=await f.post('/api/recovery/cases/'+ID+'/installed/approve',{snapshot:view.snapshot,confirm:true});
 assert.equal(incomplete.status,409);assert.equal((await incomplete.json()).code,'installed_incomplete');
 const saved=await f.post('/api/recovery/cases/'+ID+'/installed',{snapshot:view.snapshot,device:'Living room TV',checks,note:'Watched start, middle and end.'});
 assert.equal(saved.status,200);assert.equal((await saved.json()).draft.complete,true);
 const evidence=await approvalEvidencePath(path.join(f.root,'media'),'Film/new.mkv',replacementFP);
 await assert.rejects(fs.access(evidence),{code:'ENOENT'},'saving starts nothing');
 const before=identityOf(await fs.stat(library));
 const approved=await f.post('/api/recovery/cases/'+ID+'/installed/approve',{snapshot:view.snapshot,confirm:true});
 assert.equal(approved.status,200,await approved.clone().text());
 const record=JSON.parse(await fs.readFile(evidence,'utf8'));
 assert.equal(record.relative,'Film/new.mkv');assert.equal(record.sourceFP,replacementFP);assert.equal(record.installedRelative,'Film/new.mkv');assert.equal(record.installedFP,before);
 assert.equal(identityOf(await fs.stat(library)),before,'the installed copy is untouched');
 const audit=(await fs.readFile(path.join(f.data,'decision-audit.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
 assert.equal(audit.at(-1).event,'installed-approval');assert.equal(audit.at(-1).id,ID);
 const again=await f.post('/api/recovery/cases/'+ID+'/installed/approve',{snapshot:view.snapshot,confirm:true});
 assert.equal(again.status,409);assert.deepEqual(await again.json().then(b=>[b.code,b.blockers]),['installed_not_eligible',['installed-evidence-exists']]);
 assert.ok(f.calls.filter(c=>c.route.startsWith('/api/v2/')).every(c=>['/api/v2/get-nodes','/api/v2/cruddb'].includes(c.route)),'Tdarr is only read');
 assert.ok(f.calls.filter(c=>c.route==='/api/v2/cruddb').every(c=>c.input.data.mode==='getById'));
 assert.deepEqual(f.changes,[],'no node was paused');
});
