import test from 'node:test';import assert from 'node:assert/strict';import {publishRecoveryStatus}from './waiting-source.mjs';
async function snapshot(cases,files=[]){let result;await publishRecoveryStatus({cfg:{mediaRoot:'/storage/movies',sourceRoot:'/media/movies',libraryId:'lib',radarrRoot:'/radarr',radarrApiKey:'SECRET'},state:{cases},tdarrFiles:files,atomic:async(p,v)=>{assert.equal(p.replaceAll(String.fromCharCode(92),'/'),'/storage/.tdarr-recovery-status.json');result=v}});return result;}
test('pending, downloading, imported, errors and retention remain visible without credentials',async()=>{const c={id:'case',relative:'Fixture/original.mkv',replacementRelative:'Fixture/new.mkv',status:'replacement_imported',quarantine:'/private/quarantine',secret:'SECRET'};for(const status of ['Queued','Transcode error','Transcode success','Not required']){const d=await snapshot({case:c},[{_id:'/media/movies/Fixture/new.mkv',DB:'lib',TranscodeDecisionMaker:status}]);assert.equal(d.cases.length,1);assert.equal(d.cases[0].tdarrStatus,status);assert(d.cases[0].pipelineLabel);assert(!JSON.stringify(d).includes('SECRET'));assert(!JSON.stringify(d).includes('/private/'));}assert.equal((await snapshot({a:{...c,status:'deferred_limit'}})).cases[0].phase,'deferred_limit');});
test('approval and cleanup use explicit evidence, never merely successful conversion',async()=>{const c={id:'x',relative:'Film/file',status:'replacement_imported'};const result=await snapshot({x:c});assert(!result.cases[0].pipelineLabel.includes('schválena'));const approved=await snapshot({x:{...c,cleanup:{approvedAt:'2026-10-11',deleteAfter:'2026-10-18'}}});assert(approved.cases[0].pipelineLabel.includes('schválena'));const cleaned=await snapshot({x:{...c,cleanup:{complete:true}}});assert.equal(cleaned.cases[0].quarantineRetained,false);});
test('wrong library cannot claim a matching Tdarr state',async()=>{const d=await snapshot({x:{id:'x',relative:'Film/file',replacementRelative:'Film/new',status:'replacement_imported'}},[{_id:'/media/movies/Film/new',DB:'other',TranscodeDecisionMaker:'Transcode success'}]);assert.equal(d.cases[0].tdarrStatus,null);});

 test('legacy exact paths show queue/success without creating authorization or mutating journals',async()=>{
 const c={id:'legacy',movieId:1,status:'replacement_imported',relative:'Movie/old.mkv',replacement:{movieFileId:2,path:'/radarr/Movie/new.mkv',size:100},quarantine:'/private/old.mkv'};
 const before=structuredClone(c);
 for(const status of ['Queued','Transcode success']){
 const d=await snapshot({legacy:c},[{_id:'/media/movies/Movie/new.mkv',DB:'lib',TranscodeDecisionMaker:status}]);
 assert.equal(d.cases[0].tdarrStatus,status);assert.equal(d.cases[0].legacyReplacementBinding,true);assert.equal(d.cases[0].replacementTitle,'new.mkv');assert.equal(d.cases[0].cleanupComplete,false);assert.equal(d.cases[0].deleteAfter,null);assert.deepEqual(c,before);
 }
 });
 test('legacy matching rejects unsafe paths, missing identities, wrong libraries and duplicate rows',async()=>{
 const c={id:'legacy',movieId:1,status:'replacement_imported',relative:'Movie/old.mkv',replacement:{movieFileId:2,path:'/radarr/Movie/new.mkv'}};
 const row={_id:'/media/movies/Movie/new.mkv',DB:'lib',TranscodeDecisionMaker:'Queued'};
 for(const patch of [{movieId:null},{replacement:{...c.replacement,movieFileId:null}},...['/other/Movie/new.mkv','/radarr/../Movie/new.mkv','/radarr/Movie//new.mkv','/radarr/Movie/new.txt'].map(path=>({replacement:{...c.replacement,path}}))])assert.equal((await snapshot({legacy:{...c,...patch}},[row])).cases[0].tdarrStatus,null);
 assert.equal((await snapshot({legacy:c},[{...row,DB:'other'}])).cases[0].tdarrStatus,null);
 assert.equal((await snapshot({legacy:c},[row,row])).cases[0].tdarrStatus,null);
 // An explicit modern path always wins over a differing historical path.
 assert.equal((await snapshot({legacy:{...c,replacementRelative:'Movie/modern.mkv'}},[row])).cases[0].tdarrStatus,null);
 });

 test('frozen approved quota cases display the current rolling release without altering authorization',async()=>{
 const now=Date.now(),state={cases:{pending:{id:'pending',status:'deferred_limit',approval:{private:'secret'},relative:'Movie/file.mkv'},a:{id:'a',mutationStarted:now-10000},b:{id:'b',mutationStarted:now-20000},c:{id:'c',mutationStarted:now-30000}}};
 const cfg={enabled:true,maxRepairsPerDay:2,libraryId:'lib',mediaRoot:'/storage/movies',sourceRoot:'/media/movies',radarrRoot:'/radarr',quarantineRoot:'/storage/quarantine'};
 const before=structuredClone(state);let result;
 await publishRecoveryStatus({cfg,state,atomic:async(p,v)=>{result=v}});
 assert.equal(result.cases.find(c=>c.id==='pending').nextRetryAt,new Date(now-20000+86400000).toISOString());assert.equal(result.cases.find(c=>c.id==='pending').sourceRetained,true);assert.deepEqual(state,before);assert(!JSON.stringify(result).includes('secret'));
 state.cases.a.mutationStarted=now-2*86400000;state.cases.b.mutationStarted=now-2*86400000;
 await publishRecoveryStatus({cfg,state,atomic:async(p,v)=>{result=v}});assert.equal(result.cases.find(c=>c.id==='pending').nextRetryAt,null);
 });

 test('imported publication omits old downloader errors without changing private history',async()=>{const c={id:'x',status:'replacement_imported',relative:'Movie/old.mkv',replacementRelative:'Movie/new.mkv',latestQueue:[{status:'completed',error:'Manual Import required'}]};const before=structuredClone(c);const out=await snapshot({x:c});assert.deepEqual(out.cases[0].queue,[]);assert.deepEqual(c,before);});
