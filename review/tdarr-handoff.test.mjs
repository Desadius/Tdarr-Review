import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createTdarrHandoff} from './tdarr-handoff.mjs';
import {identityOf} from '../recovery/file-identity.mjs';
import {atomicJSON} from './core.mjs';

// Review's Tdarr handoff of an imported replacement without a Tdarr row (#231): synthetic files and a fake Tdarr.
const ID='a'.repeat(24),FILE='/tdarr/movies/Film/new.mkv',OLD=Date.now()-3600000;
async function fixture(t,{row=null,afterRescan={_id:FILE,DB:'library',TranscodeDecisionMaker:'Queued'},jobs=[],working=false,mode='repair',config={}}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'tdarr-handoff-')),data=path.join(root,'data'),media=path.join(root,'media','movies');
 await fs.mkdir(path.join(data,'recovery'),{recursive:true});await fs.mkdir(path.join(media,'Film'),{recursive:true});
 const library=path.join(media,'Film','new.mkv');await fs.writeFile(library,'IMPORTED REPLACEMENT');await fs.utimes(library,new Date(OLD),new Date(OLD));
 const c={id:ID,status:'replacement_imported',file:'/tdarr/movies/Film/old.mkv',source:path.join(media,'Film','old.mkv'),relative:'Film/old.mkv',replacementRelative:'Film/new.mkv',replacementSourceFP:identityOf(await fs.stat(library))};
 const cases={[ID]:c};const writeCases=()=>fs.writeFile(path.join(data,'recovery','state.json'),JSON.stringify({version:1,jobs:{},cases}));await writeCases();
 await fs.writeFile(path.join(data,'recovery','runtime-state.json'),mode===null?'{':JSON.stringify({version:1,mode,state:'running',reason:null,restarts:0,lastExitCode:null,lastExitSignal:null,lastStartedAt:null,lastExitedAt:null,updated:new Date().toISOString()}));
 const calls=[],state={row,journalAtCall:null};
 const handoff=createTdarrHandoff({data,getConfig:()=>({libraryId:'library',mediaRoot:media,...config}),atomicJSON,
  tdarr:async(route,body)=>{calls.push([route,body]);
   if(route==='/api/v2/cruddb'&&body.mode==='getById')return state.row&&{_id:body.docID,DB:'library',...state.row};
   if(route==='/api/v2/rescan-file'){state.journalAtCall=await fs.readFile(path.join(data,'recovery-handoffs',ID+'.json'),'utf8').catch(()=>null);if(afterRescan instanceof Error)throw afterRescan;state.row=afterRescan;return 'OK';}
   throw Error('unexpected Tdarr call '+route);},
  readRows:async()=>jobs,isWorkerBusy:async()=>{if(working instanceof Error)throw working;return working;}});
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 return {root,data,media,library,c,cases,writeCases,calls,state,handoff};
}

test('a replacement without a Tdarr row is eligible and its handoff only rescans that exact file after journalling the intent',async t=>{
 const f=await fixture(t);
 assert.equal(await f.handoff.rowMissing(f.c),true);
 const view=await f.handoff.view(ID);assert.equal(view.eligible,true);assert.equal(view.uncertain,false);assert.ok(!JSON.stringify(view).includes(f.root));
 await assert.rejects(f.handoff.handoff(ID,{snapshot:'x'.repeat(64)}),{code:'handoff_changed'});
 const before=identityOf(await fs.stat(f.library));
 assert.deepEqual(await f.handoff.handoff(ID,{snapshot:view.snapshot}),{state:'Queued'});
 assert.deepEqual(f.calls.filter(([route])=>route!=='/api/v2/cruddb'),[['/api/v2/rescan-file',{_id:'/tdarr/movies/Film/new.mkv',DB:'library'}]],'only a rescan is written');
 assert.ok(f.calls.filter(([route])=>route==='/api/v2/cruddb').every(([,body])=>body.mode==='getById'));
 const intent=JSON.parse(f.state.journalAtCall);assert.equal(intent.file,'/tdarr/movies/Film/new.mkv');assert.equal(intent.confirmedAt,undefined,'the intent is durable before the call');
 const journal=JSON.parse(await fs.readFile(path.join(f.data,'recovery-handoffs',ID+'.json'),'utf8'));assert.equal(journal.state,'Queued');assert.ok(journal.confirmedAt);
 assert.equal(identityOf(await fs.stat(f.library)),before,'the library file is untouched');
 assert.equal(JSON.parse(await fs.readFile(path.join(f.data,'recovery','state.json'),'utf8')).cases[ID].status,'replacement_imported','Recovery state is not written');
 assert.deepEqual((await f.handoff.view(ID)).blockers,['handoff-reached']);
});

for(const [name,options,setup,blocker]of [
 ['another phase',{},f=>{f.cases[ID]={...f.c,status:'manual'};return f.writeCases();},'handoff-not-applicable'],
 ['retention started',{},f=>{f.cases[ID]={...f.c,cleanup:{approvedAt:new Date().toISOString()}};return f.writeCases();},'handoff-not-applicable'],
 ['no Tdarr library ID',{config:{libraryId:''}},null,'handoff-library-id'],
 ['Verify mode',{mode:'verify'},null,'verify-mode'],
 ['an unreadable Recovery runtime',{mode:null},null,'handoff-unverified'],
 ['a case outside the library',{},f=>{f.cases[ID]={...f.c,source:'/elsewhere/Film/old.mkv'};return f.writeCases();},'handoff-unverified'],
 ['an unreadable case state',{},f=>fs.writeFile(path.join(f.data,'recovery','state.json'),'{'),'handoff-unverified'],
 ['the file is missing',{},f=>fs.rm(f.library),'handoff-file-missing'],
 ['a hard-linked file',{},f=>fs.link(f.library,path.join(f.root,'link.mkv')),'handoff-file-unsafe'],
 ['the file changed',{},async f=>{await fs.appendFile(f.library,'x');await fs.utimes(f.library,new Date(OLD),new Date(OLD));},'handoff-file-changed'],
 ['the file was just written',{},f=>{f.cases[ID]={...f.c};return fs.utimes(f.library,new Date(),new Date()).then(async()=>{f.cases[ID].replacementSourceFP=identityOf(await fs.stat(f.library));await f.writeCases();});},'handoff-file-unstable'],
 ['a row exists',{row:{TranscodeDecisionMaker:'Queued'}},null,'handoff-reached'],
 ['a Hold of unknown origin',{row:{TranscodeDecisionMaker:'Hold'}},null,'handoff-hold'],
 ['a Hold protected by another case',{row:{TranscodeDecisionMaker:'Hold'}},f=>{f.cases['b'.repeat(24)]={id:'b'.repeat(24),file:'/tdarr/movies/Film/new.mkv',skipCurrentEdition:true,preservedSourceFP:f.c.replacementSourceFP};return f.writeCases();},'handoff-hold-protected'],
 ['a job after the import',{jobs:[{file:FILE,status:'Transcode error',end:Date.now()+60000}]},null,'handoff-reached'],
 ['a worker processes it',{working:true},null,'handoff-worker-busy'],
 ['the worker state cannot be read',{working:Error('down')},null,'handoff-unverified'],
])test('eligibility names its blocker: '+name,async t=>{
 const f=await fixture(t,options);if(setup)await setup(f);
 assert.deepEqual(await f.handoff.view(ID),{eligible:false,blockers:[blocker]});
 await assert.rejects(f.handoff.handoff(ID,{snapshot:'x'}),e=>e.code==='handoff_not_eligible'&&e.blockers[0]===blocker);
 assert.equal(f.calls.some(([route])=>route!=='/api/v2/cruddb'),false,'nothing is written');
});
test('a job before the import and a job for another file do not count as reached',async t=>{
 const f=await fixture(t,{jobs:[{file:FILE,end:1},{file:'/tdarr/movies/Other/x.mkv',end:Date.now()}]});assert.equal((await f.handoff.view(ID)).eligible,true);
});
test('running work blocks the handoff',async t=>{
 const f=await fixture(t);assert.deepEqual((await f.handoff.view(ID,{busy:true})).blockers,['handoff-busy']);
});
test('an unconfirmed previous handoff is uncertain and a retry needs acknowledgement, then starts with a read',async t=>{
 const f=await fixture(t,{afterRescan:null});const {snapshot}=await f.handoff.view(ID);
 await assert.rejects(f.handoff.handoff(ID,{snapshot}),{code:'handoff_pending'});
 const view=await f.handoff.view(ID);assert.equal(view.uncertain,true);
 const rescans=()=>f.calls.filter(([route])=>route==='/api/v2/rescan-file').length;
 await assert.rejects(f.handoff.handoff(ID,{snapshot}),{code:'handoff_uncertain'});assert.equal(rescans(),1,'no retry without acknowledgement');
 f.state.row={TranscodeDecisionMaker:'Queued'};
 assert.deepEqual(await f.handoff.view(ID),{eligible:false,blockers:['handoff-reached']},'the fresh read reconciles the earlier scan');
 f.state.row=null;
 const last=f.calls.length;await assert.rejects(f.handoff.handoff(ID,{snapshot,acknowledgeUncertain:true}),{code:'handoff_pending'});
 assert.deepEqual(f.calls[last][0],'/api/v2/cruddb','a retry reads first');assert.equal(rescans(),2);
});
test('a failed rescan call leaves the intent uncertain',async t=>{
 const f=await fixture(t,{afterRescan:Error('Tdarr down')});const {snapshot}=await f.handoff.view(ID);
 await assert.rejects(f.handoff.handoff(ID,{snapshot}),/Tdarr down/);
 assert.equal((await f.handoff.view(ID)).uncertain,true);
});
test('a Hold that appears with the rescan is reported, never released',async t=>{
 const f=await fixture(t,{afterRescan:{_id:FILE,DB:'library',TranscodeDecisionMaker:'Hold'}});const {snapshot}=await f.handoff.view(ID);
 assert.deepEqual(await f.handoff.handoff(ID,{snapshot}),{state:'Hold'});
 assert.equal(f.calls.some(([route])=>route==='/api/v2/bulk-update-files'),false);
 assert.deepEqual((await f.handoff.view(ID)).blockers,['handoff-hold']);
});
