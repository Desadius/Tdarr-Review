import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createInstalledAssessment} from './installed-assessment.mjs';
import {identityOf} from '../recovery/file-identity.mjs';
import {retainCase,quarantineRetention} from '../recovery/quarantine-retention.mjs';
import {atomicJSON} from './core.mjs';

// Assessment of an already installed transcoded result (#230) over synthetic files, a fake Tdarr and an in-memory audit.
const ID='a'.repeat(24),TDARR='/tdarr/movies/Film/new.mkv';
async function fixture(t,{row={TranscodeDecisionMaker:'Transcode success'},jobs=null,hdr=false,transcode=true}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'installed-assessment-')),data=path.join(root,'data'),media=path.join(root,'media','movies'),quarantine=path.join(root,'quarantine');
 await fs.mkdir(path.join(data,'recovery'),{recursive:true});await fs.mkdir(path.join(media,'Film'),{recursive:true});await fs.mkdir(path.join(quarantine,ID),{recursive:true});
 const library=path.join(media,'Film','new.mkv'),quarantined=path.join(quarantine,ID,'old.mkv');
 await fs.writeFile(library,'IMPORTED REPLACEMENT');const replacementFP=identityOf(await fs.stat(library));
 if(transcode){await new Promise(r=>setTimeout(r,20));await fs.rm(library);await fs.writeFile(library,'TRANSCODED RESULT');}
 await fs.writeFile(quarantined,'FAULTY ORIGINAL');
 const c={id:ID,status:'replacement_imported',file:TDARR,source:path.join(media,'Film','old.mkv'),relative:'Film/old.mkv',fp:identityOf(await fs.stat(quarantined)),replacementRelative:'Film/new.mkv',replacementSourceFP:replacementFP,quarantine:quarantined,movieId:7};
 const writeCase=value=>fs.writeFile(path.join(data,'recovery','state.json'),JSON.stringify({version:1,jobs:{},cases:{[ID]:value}}));await writeCase(c);
 const calls={tdarr:[],rows:[]},audit=[],items={};
 const assessment=createInstalledAssessment({data,getConfig:()=>({libraryId:'library',mediaRoot:media}),getItems:()=>items,
  tdarr:async(route,body)=>{calls.tdarr.push([route,body]);if(route!=='/api/v2/cruddb'||body?.mode!=='getById')throw Error('read only');return row&&{_id:body.docID,DB:'library',...row};},
  readRows:async table=>{calls.rows.push(table);return jobs||[{file:TDARR,status:'Transcode success',end:Date.now()+1000}];},
  probe:async()=>({streams:[{codec_type:'video',...(hdr?{color_transfer:'smpte2084'}:{})}]}),atomicJSON,recordDecision:async entry=>{audit.push(entry);}});
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 return {root,data,media,quarantine,library,quarantined,c,writeCase,calls,audit,items,assessment};
}
const done={image:true,audio:true,syncStart:true,syncMiddle:true,syncEnd:true};

test('an installed transcoded result is eligible only when all four conditions hold',async t=>{
 const f=await fixture(t),view=await f.assessment.view(ID);
 assert.equal(view.eligible,true);assert.match(view.snapshot,/^[a-f0-9]{64}$/);assert.deepEqual(view.requirements,{hdr:false});assert.equal(view.draft,null);
 assert.ok(!JSON.stringify(view).includes(f.root),'no path leaves the server');
 assert.ok(!JSON.stringify(view).includes(identityOf(await fs.stat(f.library))),'no identity leaves the server');
});

for(const [name,setup,blocker]of [
 ['another case phase',async f=>f.writeCase({...f.c,status:'searching'}),'installed-not-applicable'],
 ['retention already started',async f=>f.writeCase({...f.c,cleanup:{approvedAt:new Date().toISOString()}}),'installed-not-applicable'],
 ['approval evidence already exists',async f=>{const d=path.join(f.root,'media','.tdarr-approvals');await fs.mkdir(d);const {approvalEvidencePath}=await import('../recovery/quarantine-retention.mjs');await fs.writeFile(await approvalEvidencePath(f.media,'Film/new.mkv',f.c.replacementSourceFP),'{}');},'installed-evidence-exists'],
 ['no file in the library',async f=>fs.rm(f.library),'installed-file-missing'],
 ['a hard-linked library file',async f=>fs.link(f.library,path.join(f.root,'link.mkv')),'installed-file-unsafe'],
 ['two candidate files',async f=>{await fs.rm(f.library);await fs.writeFile(path.join(f.media,'Film','new.mp4'),'a');await fs.writeFile(path.join(f.media,'Film','new.m4v'),'b');},'installed-ambiguous'],
 ['an unreadable case state',async f=>fs.writeFile(path.join(f.data,'recovery','state.json'),'{'),'installed-unverified'],
 ['a case outside the configured library',async f=>f.writeCase({...f.c,source:'/elsewhere/Film/old.mkv'}),'installed-unverified'],
 ['a pending Review result',async f=>{f.items.x={relative:'Film/new.mkv'};},'installed-review-pending'],
])test('eligibility names its blocker: '+name,async t=>{
 const f=await fixture(t);await setup(f);
 assert.deepEqual(await f.assessment.view(ID),{eligible:false,blockers:[blocker]});
});
test('the imported replacement itself, untranscoded, is not assessed as a result',async t=>{
 const f=await fixture(t,{transcode:false});assert.deepEqual((await f.assessment.view(ID)).blockers,['installed-not-transcoded']);
});
for(const [name,options,blocker]of [
 ['Tdarr row not Transcode success',{row:{TranscodeDecisionMaker:'Queued'}},'installed-tdarr-not-success'],
 ['no Tdarr row',{row:null},'installed-tdarr-not-success'],
 ['no successful job',{jobs:[{file:TDARR,status:'Transcode error',end:Date.now()+1000}]},'installed-no-success-job'],
 ['a successful job for another file',{jobs:[{file:'/tdarr/movies/Other/x.mkv',status:'Transcode success',end:Date.now()+1000}]},'installed-no-success-job'],
 ['a successful job finished before the import',{jobs:[{file:TDARR,status:'Transcode success',end:1}]},'installed-no-success-job'],
])test('eligibility names its Tdarr blocker: '+name,async t=>{
 const f=await fixture(t,options);assert.deepEqual((await f.assessment.view(ID)).blockers,[blocker]);
});
test('an unreadable Tdarr is unverified, never evidence',async t=>{
 const f=await fixture(t);f.assessment=createInstalledAssessment({data:f.data,getConfig:()=>({mediaRoot:f.media}),getItems:()=>({}),tdarr:async()=>{throw Error('down')},readRows:async()=>[],probe:async()=>({streams:[]}),atomicJSON,recordDecision:async()=>{}});
 assert.deepEqual((await f.assessment.view(ID)).blockers,['installed-unverified']);
});
test('running work blocks the assessment',async t=>{
 const f=await fixture(t);assert.deepEqual((await f.assessment.view(ID,{busy:true})).blockers,['installed-busy']);
});

test('approval needs a complete assessment of the current copy and writes evidence that Recovery retention accepts',async t=>{
 const f=await fixture(t),{snapshot}=await f.assessment.view(ID);
 await assert.rejects(f.assessment.approve(ID,{snapshot,confirm:true}),{code:'installed_incomplete'});
 let view=await f.assessment.save(ID,{snapshot,device:'Living room TV',checks:{...done,image:'true'},note:'Watched the start, middle and end.'});
 assert.equal(view.draft.complete,false,'only explicit booleans confirm');assert.equal(view.draft.checks.image,false);
 await assert.rejects(f.assessment.approve(ID,{snapshot,confirm:true}),{code:'installed_incomplete'});
 view=await f.assessment.save(ID,{snapshot,device:'Living room TV',checks:done,note:''});assert.equal(view.draft.complete,false,'a note is required');
 view=await f.assessment.save(ID,{snapshot,device:' ',checks:done,note:'ok'});assert.equal(view.draft.complete,false,'a device is required');
 view=await f.assessment.save(ID,{snapshot,device:'Living room TV',checks:done,note:'Watched the start, middle and end.'});assert.equal(view.draft.complete,true);
 await assert.rejects(f.assessment.approve(ID,{snapshot}),{code:'installed_changed'},'explicit confirmation is required');
 const before=identityOf(await fs.stat(f.library)),{approvedAt}=await f.assessment.approve(ID,{snapshot,confirm:true});
 assert.equal(identityOf(await fs.stat(f.library)),before,'the installed copy is not touched');
 assert.equal(await fs.readFile(f.quarantined,'utf8'),'FAULTY ORIGINAL');
 assert.deepEqual(f.calls.tdarr.map(([route,body])=>route+' '+body.mode),f.calls.tdarr.map(()=>'/api/v2/cruddb getById'),'Tdarr is only read');
 assert.equal(f.audit.length,1);assert.equal(f.audit[0].event,'installed-approval');assert.equal(f.audit[0].device,'Living room TV');assert.equal(f.audit[0].note,'Watched the start, middle and end.');
 const c={...f.c};let saved=null;
 await retainCase(c,{mediaRoot:f.media,reviewRoot:f.root,quarantineRoot:f.quarantine,reviewQuarantineRoot:f.quarantine,atomicCase:async v=>{saved=structuredClone(v);},now:Date.now()});
 assert.equal(saved.cleanup.approvedAt,approvedAt);assert.equal(Date.parse(saved.cleanup.deleteAfter)-Date.parse(approvedAt),quarantineRetention.retentionDays*86400000);
 assert.equal(await fs.readFile(f.quarantined,'utf8'),'FAULTY ORIGINAL','retention keeps the original until the deadline');
 assert.deepEqual((await f.assessment.view(ID)).blockers,['installed-evidence-exists'],'a second approval is refused');
});
test('HDR needs its own confirmation',async t=>{
 const f=await fixture(t,{hdr:true}),{snapshot,requirements}=await f.assessment.view(ID);assert.deepEqual(requirements,{hdr:true});
 assert.equal((await f.assessment.save(ID,{snapshot,device:'TV',checks:done,note:'ok'})).draft.complete,false);
 assert.equal((await f.assessment.save(ID,{snapshot,device:'TV',checks:{...done,hdr:true},note:'ok'})).draft.complete,true);
});
test('a changed current copy voids the draft and refuses approval',async t=>{
 const f=await fixture(t),{snapshot}=await f.assessment.view(ID);
 await f.assessment.save(ID,{snapshot,device:'TV',checks:done,note:'ok'});
 await fs.appendFile(f.library,' changed');
 const view=await f.assessment.view(ID);assert.notEqual(view.snapshot,snapshot);assert.equal(view.draft,null,'the draft belonged to another copy');
 await assert.rejects(f.assessment.approve(ID,{snapshot,confirm:true}),{code:'installed_changed'});
 await assert.rejects(f.assessment.approve(ID,{snapshot:view.snapshot,confirm:true}),{code:'installed_incomplete'});
 await assert.rejects(f.assessment.save(ID,{snapshot,device:'TV',checks:done,note:'ok'}),{code:'installed_changed'});
 assert.equal(f.audit.length,0);
});
test('a condition that fails between assessment and approval refuses the approval',async t=>{
 const f=await fixture(t),{snapshot}=await f.assessment.view(ID);
 await f.assessment.save(ID,{snapshot,device:'TV',checks:done,note:'ok'});
 f.items.x={relative:'Film/new.mkv'};
 await assert.rejects(f.assessment.approve(ID,{snapshot,confirm:true}),e=>e.code==='installed_not_eligible'&&e.blockers[0]==='installed-review-pending');
 await assert.rejects(fs.readdir(path.join(f.root,'media','.tdarr-approvals')),{code:'ENOENT'},'no evidence was written');
});

test('a replacement Tdarr skipped as Not required is assessed as it is, untranscoded, after a decision since the import',async t=>{
 const f=await fixture(t,{transcode:false,row:{TranscodeDecisionMaker:'Not required'},jobs:[{file:TDARR,status:'Not required',end:Date.now()+1000}]});
 const view=await f.assessment.view(ID);assert.equal(view.eligible,true,JSON.stringify(view));assert.equal(view.untranscoded,true);
 await f.assessment.save(ID,{snapshot:view.snapshot,device:'TV',checks:done,note:'Plays well.'});
 await f.assessment.approve(ID,{snapshot:view.snapshot,confirm:true});assert.equal(f.audit[0].untranscoded,true);
});
for(const [name,options,blocker]of [
 ['no Not required decision since the import',{transcode:false,row:{TranscodeDecisionMaker:'Not required'},jobs:[{file:TDARR,status:'Not required',end:1}]},'installed-no-decision'],
 ['a transcode error',{transcode:false,row:{TranscodeDecisionMaker:'Transcode error'}},'installed-not-transcoded'],
 ['a transcoded copy reported Not required',{row:{TranscodeDecisionMaker:'Not required'},jobs:[{file:TDARR,status:'Not required',end:Date.now()+1000}]},'installed-tdarr-not-success'],
])test('the untranscoded assessment names its blocker: '+name,async t=>{
 const f=await fixture(t,options);assert.deepEqual((await f.assessment.view(ID)).blockers,[blocker]);
});
test('a Not required decision on the original path does not count for the untranscoded replacement',async t=>{
 const f=await fixture(t,{transcode:false,row:{TranscodeDecisionMaker:'Not required'},jobs:[{file:'/tdarr/movies/Film/old.mkv',status:'Not required',end:Date.now()+1000}]});
 await f.writeCase({...f.c,file:'/tdarr/movies/Film/old.mkv'});
 assert.deepEqual((await f.assessment.view(ID)).blockers,['installed-no-decision']);
 const own=await fixture(t,{transcode:false,row:{TranscodeDecisionMaker:'Not required'},jobs:[{file:TDARR,status:'Not required',end:Date.now()+1000}]});
 await own.writeCase({...own.c,file:'/tdarr/movies/Film/old.mkv'});
 assert.equal((await own.assessment.view(ID)).eligible,true,'the replacement\'s own decision counts');
});
