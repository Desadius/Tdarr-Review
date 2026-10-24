import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {reviewFixture} from './test-helpers/review-fixture.mjs';
import {linuxServer as linux} from './test-helpers/server.mjs';
import {createSharedSettingsStore} from './shared-settings.mjs';

const CASE_ID='a'.repeat(24),MOVIE_ID=73,API_KEY='synthetic-radarr-key';
const RECOVERY_CONFIG=JSON.parse(await fs.readFile(new URL('../examples/recovery-config.example.json',import.meta.url),'utf8'));

test('Recovery import explanation uses a fresh exact Radarr binding and exposes only safe read-only guidance',linux,async t=>{
 const calls=[];
 let movieResponse={id:MOVIE_ID,tmdbId:9001,title:'Synthetic film',titleSlug:'synthetic-film'},movieStatus=200;
 let queueResponse={page:1,pageSize:100,totalRecords:1,records:[{
  id:600,movieId:MOVIE_ID,status:'completed',trackedDownloadState:'importBlocked',trackedDownloadStatus:'warning',
  statusMessages:[{title:'Import blocked',messages:['Quality profile does not allow this quality and language. SECRET=/private/radarr-error']}],
  errorMessage:'SECRET=/private/radarr-error',downloadUrl:'http://radarr.invalid/private'
 }]},queueStatus=200;
 let movieGate=null,recoveryStatusFile;
 const radarr=http.createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  calls.push({method:req.method,url:req.url,key:req.headers['x-api-key'],body:Buffer.concat(chunks).toString('utf8')});
  const url=new URL(req.url,'http://radarr.invalid');let result,status=200;
  if(req.method==='GET'&&url.pathname.startsWith('/api/v3/movie/')){if(movieGate){const gate=movieGate;movieGate=null;gate.entered();await gate.released;}result=movieResponse;status=movieStatus;}
  else if(req.method==='GET'&&url.pathname==='/api/v3/queue'&&url.searchParams.get('movieId')){result=queueResponse;status=queueStatus;}
  else {res.writeHead(404);res.end('{}');return;}
  res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(result));
 });
 await new Promise(resolve=>radarr.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>radarr.close(resolve)));
 const radarrUrl='http://127.0.0.1:'+radarr.address().port;
 const f=await reviewFixture({env:{RECOVERY_MODE:'verify'},beforeStart:async({data,media})=>{
  await fs.writeFile(path.join(data,'radarr.json'),JSON.stringify({url:radarrUrl,apiKey:API_KEY,mediaRoot:'/radarr-films',preferCzechEnglish:true}));
  await fs.mkdir(path.join(data,'recovery'),{recursive:true});
  const reviewConfig=JSON.parse(await fs.readFile(path.join(data,'settings.json'),'utf8'));
  const legacyRecovery={...RECOVERY_CONFIG,tdarrUrl:reviewConfig.tdarrUrl,radarrUrl,radarrApiKey:API_KEY,libraryId:reviewConfig.libraryId,sourceRoot:reviewConfig.sourceRoots[0],mediaRoot:reviewConfig.mediaRoot,radarrRoot:'/radarr-films',reviewRoot:reviewConfig.reviewRoot,reviewPrefixes:reviewConfig.reviewPrefixes,database:reviewConfig.database,ffmpeg:reviewConfig.ffmpeg,ffprobe:reviewConfig.ffprobe,quarantineRoot:path.join(path.dirname(media),'.tdarr-corrupt')};
  await fs.writeFile(path.join(data,'recovery','config.json'),JSON.stringify(legacyRecovery));
  await fs.writeFile(path.join(data,'recovery','state.json'),JSON.stringify({cases:{[CASE_ID]:{id:CASE_ID,status:'waiting_replacement',movieId:MOVIE_ID,tmdbId:9001,binding:{movieFileId:44}}}}));
  recoveryStatusFile=path.join(path.dirname(media),'.tdarr-recovery-status.json');
  await fs.writeFile(recoveryStatusFile,JSON.stringify({version:1,updated:new Date().toISOString(),cases:[{
   id:CASE_ID,title:'Synthetic film',phase:'waiting_replacement',statusUpdated:new Date().toISOString(),titleSlug:'stale-unverified-slug',tmdbId:9001,
   queue:[
    {title:'PRIVATE_QUEUE_FIELD /private/title',status:'completed',trackedDownloadState:'ImportBlocked',trackedDownloadStatus:'warning PRIVATE_QUEUE_FIELD',timeleft:'PRIVATE_QUEUE_FIELD',downloadUrl:'http://radarr.invalid/private/queue',error:'Old untrusted status'},
    {title:'PRIVATE_QUEUE_FIELD /private/second-title',status:'failed /private/second-status'}
   ]
  }]}));
  const store=createSharedSettingsStore({data,env:{RECOVERY_MODE:'verify'}}),draft=await store.current();
  const active=await store.applyGeneration({revision:draft.revision,invalidation:{level:'none',fields:[],shown:{reviews:0,approvals:0},cleared:{reviews:0,approvals:0}}});assert.equal(active.generation,1,'fixture must use a managed Recovery generation');
  await fs.writeFile(path.join(data,'recovery','config.json'),JSON.stringify({...legacyRecovery,radarrUrl:'http://127.0.0.1:1/stale-legacy-radarr',radarrApiKey:'stale-legacy-radarr-key',radarrRoot:'/stale-legacy-root'}));
 }});
 t.after(()=>f.close());

 const settings=await f.get('/api/shared-settings');assert.equal(settings.active.radarr.url,radarrUrl);assert.equal(settings.active.radarr.mediaRoot,'/radarr-films');
 const overview=await f.get('/api/radarr/requests');
 const initial=overview.requests.find(record=>record.id===CASE_ID);
 assert.ok(initial,'fixture must publish its exact Recovery case');
 assert.equal(initial.attention.reason,'import-blocked');
 assert.equal(JSON.parse(await fs.readFile(path.join(f.data,'recovery','config.json'),'utf8')).radarrUrl,'http://127.0.0.1:1/stale-legacy-radarr','managed Recovery settings must remain authoritative over stale legacy URL/key/root fields');
 assert.equal(JSON.parse(await fs.readFile(path.join(f.data,'recovery','state.json'),'utf8')).cases[CASE_ID].binding.movieFileId,44);
 assert.ok(initial.attention?.importDiagnosis,'Recovery attention must explain the import state through its public HTTP model');
 assert.equal(initial.attention.importDiagnosis.status,'unverified','saved queue state must not claim a fresh cause');
 assert.equal(initial.attention.importDiagnosis.category,null);
 assert.equal(initial.attention.importDiagnosis.movieUrl,null,'a stale saved slug is not an exact movie link');
 assert.equal(initial.attention.importDiagnosis.queueUrl,radarrUrl+'/activity/queue','the queue link must be clearly general');
 assert.equal(initial.attention.actions.some(action=>action.id==='openRadarr'),false,'the stale movie URL must not become an exact action');
 assert.equal(initial.attention.actions.some(action=>action.id==='openQueue'),true);
 assert.equal(JSON.stringify(overview).includes('Old untrusted status'),false,'saved upstream queue errors are not exposed in the public overview');
 assert.equal(JSON.stringify(overview).includes('PRIVATE_QUEUE_FIELD'),false,'queue title, status and time fields are not copied as arbitrary upstream text');
 assert.equal(JSON.stringify(overview).includes('/private/'),false,'queue paths and private URLs are not exposed');
 assert.equal(calls.length,0,'opening the list does not treat saved queue data as a fresh Radarr read');

 const before=JSON.parse(await fs.readFile(path.join(f.data,'recovery','state.json'),'utf8'));
 const refreshed=await f.post('/api/recovery/refresh',{keys:['recovery:'+CASE_ID]});
 assert.equal(refreshed.status,200,await refreshed.clone().text());
 const body=await refreshed.json(),record=body.requests.find(value=>value.id===CASE_ID),diagnosis=record.attention.importDiagnosis;
 assert.deepEqual(calls.map(call=>[call.method,call.url]),[
  ['GET','/api/v3/movie/'+MOVIE_ID],
  ['GET','/api/v3/queue?movieId='+MOVIE_ID+'&page=1&pageSize=100']
 ],f.diagnostics());
 assert.deepEqual(diagnosis,{status:'verified',category:'language-quality-mismatch',movieUrl:radarrUrl+'/movie/synthetic-film',queueUrl:radarrUrl+'/activity/queue',checkedAt:diagnosis.checkedAt});
 assert.ok(Number.isFinite(Date.parse(diagnosis.checkedAt)));
 assert.deepEqual(calls.map(call=>[call.method,call.url]),[
  ['GET','/api/v3/movie/'+MOVIE_ID],
  ['GET','/api/v3/queue?movieId='+MOVIE_ID+'&page=1&pageSize=100']
 ]);
 assert.ok(calls.every(call=>call.key===API_KEY&&call.body===''),'Radarr inspection must use authenticated GET requests only');
 assert.equal(JSON.stringify(body).includes(API_KEY),false,'credentials must never reach the HTTP response');
 assert.equal(JSON.stringify(body).includes('SECRET'),false,'raw upstream diagnostics must not reach the HTTP response');
 assert.equal(JSON.stringify(body).includes('Old untrusted status'),false,'saved upstream queue errors stay private after refresh');
 assert.equal(JSON.stringify(body).includes('/private/'),false,'private paths must not reach the HTTP response');
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.data,'recovery','state.json'),'utf8')),before,'inspection must not write Recovery state');
 assert.deepEqual(f.changes,[],'inspection must not pause or alter Tdarr');

 // A later overview has no in-memory authorization to reuse the previous fresh result.
 const afterRefresh=await f.get('/api/radarr/requests'),after=afterRefresh.requests.find(value=>value.id===CASE_ID);
 assert.equal(after.attention.importDiagnosis.status,'unverified');assert.equal(after.radarrMovieUrl,undefined);
 assert.equal(calls.length,2,'opening the overview does not repeat or reuse a fresh Radarr read');

 let state=JSON.parse(await fs.readFile(path.join(f.data,'recovery','state.json'),'utf8'));
 async function inspectAgain(){const response=await f.post('/api/recovery/refresh',{keys:['recovery:'+CASE_ID]});assert.equal(response.status,200,await response.clone().text());return (await response.json()).requests.find(value=>value.id===CASE_ID).attention.importDiagnosis;}
 queueResponse={page:1,pageSize:100,totalRecords:1,records:[{id:601,movieId:999,status:'completed',trackedDownloadState:'importBlocked'}]};
 let nextDiagnosis=await inspectAgain();assert.equal(nextDiagnosis.status,'unavailable');assert.equal(nextDiagnosis.category,null,'a movieId-filtered queue result must still prove record membership');
 queueResponse={page:1,pageSize:100,totalRecords:2,records:[{id:602,movieId:MOVIE_ID,status:'completed',trackedDownloadState:'importBlocked'}]};
 nextDiagnosis=await inspectAgain();assert.equal(nextDiagnosis.status,'unavailable','truncated queue pages are not complete evidence');
 queueResponse={page:1,pageSize:100,totalRecords:1,records:[{id:603,movieId:MOVIE_ID,status:'downloading',trackedDownloadState:'Downloading',trackedDownloadStatus:'Warning',statusMessages:[{messages:['Download client connection failed']}]}]};
 nextDiagnosis=await inspectAgain();assert.equal(nextDiagnosis.status,'verified');assert.equal(nextDiagnosis.category,'unrecognized','a download-client failure is not proof of an import or stalled-download cause');
 queueResponse={page:1,pageSize:100,totalRecords:1,records:[{id:604,movieId:MOVIE_ID,status:'downloading',trackedDownloadState:'Downloading'}]};
 nextDiagnosis=await inspectAgain();assert.equal(nextDiagnosis.category,'download-pending');
 queueResponse={page:1,pageSize:100,totalRecords:1,records:[{id:605,movieId:MOVIE_ID,status:'completed',trackedDownloadState:'ImportBlocked'}]};
 nextDiagnosis=await inspectAgain();assert.equal(nextDiagnosis.category,'import-problem');

 // A result is discarded if the Recovery case or active managed Radarr namespace changes during network I/O.
 state=JSON.parse(await fs.readFile(path.join(f.data,'recovery','state.json'),'utf8'));state.cases[CASE_ID].movieId=MOVIE_ID;
 await fs.writeFile(path.join(f.data,'recovery','state.json'),JSON.stringify(state));
 queueResponse={page:1,pageSize:100,totalRecords:1,records:[{id:609,movieId:MOVIE_ID,status:'completed',trackedDownloadState:'ImportBlocked'}]};
 let entered;const seenMovie=new Promise(resolve=>{entered=resolve});let releaseMovie;const movieReleased=new Promise(resolve=>{releaseMovie=resolve});movieGate={entered:()=>entered(),released:movieReleased};
 const pending=f.post('/api/recovery/refresh',{keys:['recovery:'+CASE_ID]});await seenMovie;
 state.cases[CASE_ID].movieId=MOVIE_ID+1;await fs.writeFile(path.join(f.data,'recovery','state.json'),JSON.stringify(state));
 const managedSettingsFile=path.join(f.data,'shared-settings.json'),managedSettingsBytes=await fs.readFile(managedSettingsFile),managedSettings=JSON.parse(managedSettingsBytes);
 for(const generation of [managedSettings.active,managedSettings.draft]){generation.radarr.url='http://127.0.0.1:1/changed-active';generation.radarr.apiKey='changed-active-key';generation.radarr.mediaRoot='/changed-root';generation.recovery.radarrUrl=generation.radarr.url;generation.recovery.radarrApiKey=generation.radarr.apiKey;generation.recovery.radarrRoot=generation.radarr.mediaRoot;}
 managedSettings.generation++;
 await fs.writeFile(managedSettingsFile,JSON.stringify(managedSettings));
 releaseMovie();const changedResponse=await pending;assert.equal(changedResponse.status,200);const changedBody=await changedResponse.json();
 const changedDiagnosis=changedBody.requests.find(value=>value.id===CASE_ID).attention.importDiagnosis;
 assert.equal(changedDiagnosis.status,'unavailable');assert.equal(changedDiagnosis.movieUrl,null);
 assert.deepEqual(calls.slice(-2).map(call=>call.url),['/api/v3/movie/'+MOVIE_ID,'/api/v3/queue?movieId='+MOVIE_ID+'&page=1&pageSize=100'],'the report is discarded after the active managed namespace changes during the reads');
 await fs.writeFile(path.join(f.data,'recovery','state.json'),JSON.stringify({...state,cases:{[CASE_ID]:{...state.cases[CASE_ID],movieId:MOVIE_ID}}}));
 await fs.writeFile(managedSettingsFile,managedSettingsBytes);

 queueResponse={page:1,pageSize:100,totalRecords:0,records:[]};queueStatus=206;
 nextDiagnosis=await inspectAgain();assert.equal(nextDiagnosis.status,'unavailable','partial-content responses are incomplete even when their JSON parses');
 queueStatus=200;queueResponse={page:1,pageSize:100,totalRecords:1,records:[{id:606,movieId:MOVIE_ID,status:'completed',trackedDownloadState:'ImportBlocked'}]};
 state=JSON.parse(await fs.readFile(path.join(f.data,'recovery','state.json'),'utf8'));
 state.cases['b'.repeat(24)]={id:'b'.repeat(24),status:'waiting_replacement',movieId:MOVIE_ID,tmdbId:9001,binding:{movieFileId:45}};
 await fs.writeFile(path.join(f.data,'recovery','state.json'),JSON.stringify(state));
 const beforeAmbiguous=calls.length;nextDiagnosis=await inspectAgain();assert.equal(nextDiagnosis.status,'unavailable','duplicate active case bindings are ambiguous');assert.equal(calls.length,beforeAmbiguous);
 state.cases['b'.repeat(24)]=undefined;delete state.cases['b'.repeat(24)];
 state.cases[CASE_ID].movieId=MOVIE_ID+1;await fs.writeFile(path.join(f.data,'recovery','state.json'),JSON.stringify(state));
 const beforeChanged=calls.length;nextDiagnosis=await inspectAgain();assert.equal(nextDiagnosis.status,'unavailable');assert.equal(nextDiagnosis.movieUrl,null);assert.equal(calls.length,beforeChanged+1,'a changed case binding is fetched only by its new exact ID, never the old cached movie');
 state.cases[CASE_ID].movieId=MOVIE_ID;await fs.writeFile(path.join(f.data,'recovery','state.json'),JSON.stringify(state));
 const oversizedMarker='OVERSIZED_PRIVATE_RADARR_ERROR';queueResponse={page:1,pageSize:100,totalRecords:1,records:[{id:607,movieId:MOVIE_ID,status:'completed',trackedDownloadState:'ImportBlocked',statusMessages:[{messages:[oversizedMarker+'x'.repeat(600000)]}]}]};
 nextDiagnosis=await inspectAgain();assert.equal(nextDiagnosis.status,'unavailable','oversized JSON is not parsed into a cause');
 const afterOversized=await f.get('/api/radarr/requests');assert.equal(JSON.stringify(afterOversized).includes(oversizedMarker),false);
 queueResponse={page:1,pageSize:100,totalRecords:1,records:[{id:608,movieId:MOVIE_ID,status:'completed',trackedDownloadState:'ImportBlocked'}]};
 const beforeQueueFailure=JSON.parse(await fs.readFile(recoveryStatusFile,'utf8'));
 beforeQueueFailure.cases[0].queue=[{title:'PRIVATE_QUEUE_FAILURE /private/title',status:'failed',trackedDownloadState:'Failed',error:'PRIVATE_QUEUE_FAILURE /private/error'}];
 await fs.writeFile(recoveryStatusFile,JSON.stringify(beforeQueueFailure));
 const failedOverview=await f.get('/api/radarr/requests'),failedRecord=failedOverview.requests.find(value=>value.id===CASE_ID);
 assert.equal(failedRecord.attention.reason,'queue-failed','a failed download remains a queue failure, not an inferred import failure');
 assert.equal(failedRecord.attention.importDiagnosis.status,'unverified');
 assert.equal(JSON.stringify(failedOverview).includes('PRIVATE_QUEUE_FAILURE'),false,'queue-failure errors and titles stay private');
 queueResponse={page:1,pageSize:100,totalRecords:1,records:[{id:610,movieId:MOVIE_ID,status:'failed',trackedDownloadState:'Failed',statusMessages:[{messages:['Download client failed']}]}]};
 const failedRefresh=await f.post('/api/recovery/refresh',{keys:['recovery:'+CASE_ID]});assert.equal(failedRefresh.status,200);
 const failedDiagnosis=(await failedRefresh.json()).requests.find(value=>value.id===CASE_ID).attention.importDiagnosis;
 assert.equal(failedDiagnosis.status,'verified');assert.equal(failedDiagnosis.category,'unrecognized','a failed queue does not prove an import failure or a stalled download');
 const beforeRestart=calls.length;await f.restart();const restarted=await f.get('/api/radarr/requests'),afterRestart=restarted.requests.find(value=>value.id===CASE_ID);
 assert.equal(afterRestart.attention.importDiagnosis.status,'unverified','fresh reports are ephemeral and restart requires another manual read');
 assert.equal(afterRestart.radarrMovieUrl,undefined);assert.equal(calls.length,beforeRestart,'restart overview does not silently fetch or reuse old evidence');
});

test('Recovery Off refuses the manual Radarr diagnosis without making upstream requests',linux,async t=>{
 const calls=[],radarr=http.createServer((req,res)=>{calls.push(req.method+' '+req.url);res.writeHead(200,{'content-type':'application/json'});res.end('{}');});
 await new Promise(resolve=>radarr.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>radarr.close(resolve)));
 const radarrUrl='http://127.0.0.1:'+radarr.address().port,caseId='c'.repeat(24);
 const f=await reviewFixture({env:{RECOVERY_MODE:'off'},beforeStart:async({data,media})=>{
  await fs.writeFile(path.join(data,'radarr.json'),JSON.stringify({url:radarrUrl,apiKey:'off-mode-synthetic-key',mediaRoot:'/radarr-films',preferCzechEnglish:true}));
  await fs.mkdir(path.join(data,'recovery'),{recursive:true});
  await fs.writeFile(path.join(data,'recovery','state.json'),JSON.stringify({cases:{[caseId]:{id:caseId,status:'waiting_replacement',movieId:73,tmdbId:9001,binding:{movieFileId:44}}}}));
  await fs.writeFile(path.join(path.dirname(media),'.tdarr-recovery-status.json'),JSON.stringify({version:1,updated:new Date().toISOString(),cases:[{id:caseId,title:'Synthetic Off case',phase:'waiting_replacement',statusUpdated:new Date().toISOString(),tmdbId:9001,queue:[{status:'completed',trackedDownloadState:'ImportBlocked'}]}]}));
 }});t.after(()=>f.close());
 const overview=await f.get('/api/radarr/requests'),initial=overview.requests.find(value=>value.id===caseId);
 assert.equal(initial.attention.importDiagnosis.status,'unverified');assert.equal(calls.length,0);
 const refreshed=await f.post('/api/recovery/refresh',{keys:['recovery:'+caseId]});assert.equal(refreshed.status,200);
 const diagnosis=(await refreshed.json()).requests.find(value=>value.id===caseId).attention.importDiagnosis;
 assert.equal(diagnosis.status,'unavailable','Off is a refusal, not an inferred verify/repair mode');assert.equal(diagnosis.movieUrl,null);assert.equal(calls.length,0);
});
