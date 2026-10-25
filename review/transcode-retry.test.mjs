import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createTranscodeRetry} from './transcode-retry.mjs';
import {identityOf} from '../recovery/file-identity.mjs';
import {atomicJSON} from './core.mjs';

// Diagnosis and the one Review retry of a failed replacement transcode (#232): synthetic files, reports and a fake Tdarr.
const ID='a'.repeat(24),FILE='/tdarr/movies/Film/new.mkv',OLD=Date.now()-3600000;
const MPEG2='Error: Bitrate sampling failed: [mpeg2video @ 0x55d1] ignoring pic cod ext after 0\n';
const REPORTS={mpeg2:MPEG2,operational:'ffmpeg: /mnt/media/Film/new.mkv: Permission denied\n',unrecognized:'Worker exited with code 1\n',damage:'[h264 @ 0x55d1] Invalid NAL unit size (4271 > 1022).\n'};
async function fixture(t,{row='Transcode error',report=REPORTS.operational,jobs=null,working=false,mode='repair',afterQueue='Queued',now}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'transcode-retry-')),data=path.join(root,'data'),media=path.join(root,'media','movies');
 await fs.mkdir(path.join(data,'recovery'),{recursive:true});await fs.mkdir(path.join(media,'Film'),{recursive:true});
 const library=path.join(media,'Film','new.mkv');await fs.writeFile(library,'IMPORTED REPLACEMENT');await fs.utimes(library,new Date(OLD),new Date(OLD));
 const c={id:ID,status:'replacement_imported',file:'/tdarr/movies/Film/old.mkv',source:path.join(media,'Film','old.mkv'),relative:'Film/old.mkv',replacementRelative:'Film/new.mkv',replacementSourceFP:identityOf(await fs.stat(library))};
 const cases={[ID]:c},writeCases=()=>fs.writeFile(path.join(data,'recovery','state.json'),JSON.stringify({version:1,jobs:{},cases}));await writeCases();
 await fs.writeFile(path.join(data,'recovery','runtime-state.json'),JSON.stringify({version:1,mode,state:'running',reason:null,restarts:0,lastExitCode:null,lastExitSignal:null,lastStartedAt:null,lastExitedAt:null,updated:new Date().toISOString()}));
 const calls=[],state={row,journalAtWrite:null,jobs:jobs||[{_id:'job-1',file:FILE,status:'Transcode error',end:Date.now()+1000}]};
 const retry=createTranscodeRetry({...(now?{now}:{}),data,getConfig:()=>({libraryId:'library',mediaRoot:media}),atomicJSON,
  tdarr:async(route,body)=>{calls.push([route,body]);
   if(route==='/api/v2/cruddb'&&body.mode==='getById')return state.row&&{_id:body.docID,DB:'library',TranscodeDecisionMaker:state.row};
   if(route==='/api/v2/bulk-update-files'){state.journalAtWrite=await fs.readFile(path.join(data,'recovery-retries',ID+'.json'),'utf8').catch(()=>null);if(afterQueue instanceof Error)throw afterQueue;state.row=afterQueue;return 'OK';}
   throw Error('unexpected Tdarr call '+route);},
  readRows:async()=>state.jobs,readReport:async job=>{if(report instanceof Error)throw report;assert.equal(job._id,state.jobs.at(-1)._id);return report;},isWorkerBusy:async()=>working});
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 return {root,data,media,library,c,cases,writeCases,calls,state,retry};
}
const writes=f=>f.calls.filter(([route])=>route!=='/api/v2/cruddb');

for(const [cause,report,eligible,blockers]of [['operational',REPORTS.operational,true,[]],['unrecognized',REPORTS.unrecognized,true,[]],['decode-damage',REPORTS.damage,false,['transcode-decode-damage']],['decode-damage',REPORTS.mpeg2,false,['transcode-decode-damage']],['unreadable',Error('gone'),false,['transcode-report-unreadable']]])
 test('the newest error report is classified as '+cause+(report===REPORTS.mpeg2?' (MPEG-2 preflight)':''),async t=>{
  const f=await fixture(t,{report});const view=await f.retry.view(ID);
  assert.equal(view.eligible,eligible);assert.equal(view.cause,cause);assert.deepEqual(view.blockers,blockers);
  if(report===REPORTS.damage)assert.equal(view.message,'Invalid NAL unit size (# > #).','a value-free decoder message');
  assert.ok(!JSON.stringify(view).includes('/mnt/media')&&!JSON.stringify(view).includes(f.root),'no path leaves the server');
 });

test('the retry journals its intent, re-queues exactly that row and is offered only once per replacement identity',async t=>{
 const f=await fixture(t);const view=await f.retry.view(ID);
 await assert.rejects(f.retry.retry(ID,{snapshot:'x'}),{code:'retry_changed'});
 assert.deepEqual(await f.retry.retry(ID,{snapshot:view.snapshot}),{state:'Queued'});
 assert.deepEqual(writes(f),[['/api/v2/bulk-update-files',{fileIds:[FILE],updatedObj:{TranscodeDecisionMaker:'Queued',holdUntil:0}}]]);
 const intent=JSON.parse(f.state.journalAtWrite);assert.equal(intent.jobId,'job-1');assert.equal(intent.confirmedAt,undefined,'the intent is durable before the write');
 assert.equal(JSON.parse(await fs.readFile(path.join(f.data,'recovery','state.json'),'utf8')).cases[ID].status,'replacement_imported','Recovery state is not written');
 assert.deepEqual((await f.retry.view(ID)).blockers,['transcode-not-failed']);
 f.state.row='Transcode error';f.state.jobs.push({_id:'job-2',file:FILE,status:'Transcode error',end:Date.now()+5000});
 assert.deepEqual((await f.retry.view(ID)).blockers,['transcode-retry-failed-again'],'no retry loop');
});
test('an unconfirmed retry is uncertain; a retry needs acknowledgement, and a later failure ends retries',async t=>{
 const f=await fixture(t,{afterQueue:'Transcode error',jobs:[{_id:'job-1',file:FILE,status:'Transcode error',end:Date.now()+1000}],now:()=>Date.now()+2000});const {snapshot}=await f.retry.view(ID);
 await assert.rejects(f.retry.retry(ID,{snapshot}),{code:'retry_pending'});
 const view=await f.retry.view(ID);assert.equal(view.uncertain,true);
 await assert.rejects(f.retry.retry(ID,{snapshot}),{code:'retry_uncertain'});assert.equal(writes(f).length,1);
 f.state.jobs.push({_id:'job-2',file:FILE,status:'Transcode error',end:Date.now()+5000});
 assert.deepEqual((await f.retry.view(ID)).blockers,['transcode-retry-failed-again']);
});
for(const [name,options,setup,blocker]of [
 ['the row is no longer failed',{row:'Queued'},null,'transcode-not-failed'],
 ['a Hold',{row:'Hold'},null,'transcode-not-failed'],
 ['the newest job is not the error',{jobs:[{_id:'job-1',file:FILE,status:'Transcode error',end:Date.now()+1000},{_id:'job-2',file:FILE,status:'Transcode success',end:Date.now()+2000}]},null,'transcode-newest-not-error'],
 ['the newest job has no end time while an older error job has',{jobs:[{_id:'job-1',file:FILE,status:'Transcode error',end:Date.now()+1000},{_id:'job-2',file:FILE,status:'Transcode error',start:Date.now()+2000}]},null,'transcode-job-unfinished'],
 ['an older error job but a newer one without an end time',{jobs:[{_id:'job-1',file:FILE,status:'Transcode error',end:Date.now()+1000},{_id:'job-2',file:FILE,status:'Queued',start:Date.now()+2000}]},null,'transcode-newest-not-error'],
 ['an unrecognized journal version',{},async f=>{await fs.mkdir(path.join(f.data,'recovery-retries'));await fs.writeFile(path.join(f.data,'recovery-retries',ID+'.json'),JSON.stringify({version:2,file:FILE}));},'transcode-unverified'],
 ['a corrupt journal',{},async f=>{await fs.mkdir(path.join(f.data,'recovery-retries'));await fs.writeFile(path.join(f.data,'recovery-retries',ID+'.json'),'{not json');},'transcode-unverified'],
 ['the error job is older than the import',{jobs:[{_id:'job-1',file:FILE,status:'Transcode error',end:1}]},null,'transcode-unverified'],
 ['the file changed',{},async f=>{await fs.appendFile(f.library,'x');},'handoff-file-changed'],
 ['a hard-linked file',{},f=>fs.link(f.library,path.join(f.root,'link.mkv')),'handoff-file-unsafe'],
 ['a worker processes it',{working:true},null,'handoff-worker-busy'],
 ['Verify mode',{mode:'verify'},null,'verify-mode'],
 ['a case outside the library',{},f=>{f.cases[ID]={...f.c,source:'/elsewhere/Film/old.mkv'};return f.writeCases();},'transcode-unverified'],
])test('the retry names its blocker: '+name,async t=>{
 const f=await fixture(t,options);if(setup)await setup(f);
 assert.deepEqual((await f.retry.view(ID)).blockers,[blocker]);
 await assert.rejects(f.retry.retry(ID,{snapshot:'x'}),e=>e.code==='retry_not_eligible'&&e.blockers[0]===blocker);
 assert.deepEqual(writes(f),[],'nothing is written');
});
test('running work blocks the retry',async t=>{const f=await fixture(t);assert.deepEqual((await f.retry.view(ID,{busy:true})).blockers,['handoff-busy']);});
