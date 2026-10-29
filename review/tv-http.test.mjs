import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {linuxServer} from './test-helpers/server.mjs';
import {reviewFixture} from './test-helpers/review-fixture.mjs';
import {addTvResult,sonarrMock,episodeRecord,fileRecord,LIBRARY,SOURCE_ROOT,SONARR_ROOT,API_KEY} from './test-helpers/tv-fixture.mjs';
import {tvItemId} from './tv-discovery.mjs';

const SHOWN={level:'all',reviews:0,approvals:0};
const MOVIE_KEYS=['items','history','sessions','pauses','reviewSessions','approvals'];
const movieState=async f=>{const state=await f.state();return JSON.stringify(Object.fromEntries(MOVIE_KEYS.map(key=>[key,state[key]??null])));};

// The real server over synthetic movies A, B and C, synthetic TV results sharing the review root under TV/, a
// loopback Tdarr job database and a loopback Sonarr mock. The TV mode is turned on only through the settings flow.
async function tvServer(t,{strict=false}={}){
 const sonarr=await sonarrMock({series:[
  {id:7,title:'Synthetic Show',path:SONARR_ROOT+'\\Synthetic Show',seriesType:'standard'},
  {id:8,title:'Synthetic Anime',path:SONARR_ROOT+'\\Synthetic Anime',seriesType:'anime'},
  {id:9,title:'Uninvolved Show',path:SONARR_ROOT+'\\Uninvolved Show',seriesType:'standard'}],files:{7:[],8:[],9:[]},episodes:{7:[],8:[],9:[]}});
 t.after(()=>sonarr.close());
 let tvMedia,results={};
 const f=await reviewFixture({beforeStart:async({root,dbpath})=>{
  tvMedia=path.join(root,'tv-media');const review=path.join(root,'review');
  const jobs=new DatabaseSync(dbpath);
  jobs.prepare('INSERT INTO librarysettingsjsondb VALUES (?)').run(JSON.stringify({_id:LIBRARY,folder:SOURCE_ROOT}));
  const add=async(name,relative,options={},records)=>{
   const created=await addTvResult({mediaRoot:tvMedia,reviewRoot:review,relative,jobId:'tv-job-'+name,...options});results[name]={...created,relative,id:tvItemId('TV/'+relative)};
   jobs.prepare('INSERT INTO jobsjsondb VALUES (?)').run(JSON.stringify(created.job));
   if(records){sonarr.data.files[records.series].push(fileRecord(records.file,records.series,relative,{seasonNumber:records.episodes[0].season}));
    records.episodes.forEach((e,i)=>sonarr.data.episodes[records.series].push(episodeRecord(records.file*10+i,records.series,records.file,{seasonNumber:e.season,episodeNumber:e.number,absoluteEpisodeNumber:e.absolute??null})));}
  };
  try{
   await add('multi','Synthetic Show/Season 01/S01E01-E02.mkv',{},{series:7,file:101,episodes:[{season:1,number:1},{season:1,number:2}]});
   await add('special','Synthetic Show/Specials/S00E01.mkv',{},{series:7,file:102,episodes:[{season:0,number:1}]});
   await add('anime','Synthetic Anime/Season 01/Episode 045.mkv',{},{series:8,file:201,episodes:[{season:1,number:1,absolute:45}]});
   await add('norecord','Synthetic Show/Season 01/S01E09.mkv');
   await add('otherlibrary','Synthetic Show/Season 01/S01E08.mkv',{job:{DB:'movie-library'}});
   await add('noreceipt','Synthetic Show/Season 01/S01E07.mkv',{withReceipt:false});
   if(strict)await add('strict','Synthetic Show/Season 01/S01E03.mkv',{receiptVersion:2},{series:7,file:103,episodes:[{season:1,number:3}]});
  }finally{jobs.close();}
 }});
 t.after(()=>f.close());
 const tv={mode:'discovery',mediaRoot:tvMedia,reviewRoot:path.join(f.root,'review'),quarantineRoot:path.join(f.root,'tv-quarantine'),libraryId:LIBRARY,sourceRoots:[SOURCE_ROOT],tdarrReviewRoot:'/tdarr/review',reviewPrefixes:['TV'],sonarrRoot:SONARR_ROOT};await fs.mkdir(tv.quarantineRoot,{recursive:true});
 const apply=async mode=>{
  const current=await f.get('/api/shared-settings');
  const saved=await f.post('/api/shared-settings/draft',{revision:current.revision,patch:{libraries:{tv:{...tv,mode}},sonarr:{url:sonarr.url,apiKey:API_KEY}}});assert.equal(saved.status,200,await saved.clone().text());
  const {revision}=await saved.json();
  const tested=await f.post('/api/shared-settings/test',{revision});assert.equal(tested.status,200,await tested.clone().text());
  const started=await f.post('/api/shared-settings/apply',{revision,invalidation:SHOWN});assert.equal(started.status,202,await started.clone().text());
  const {id}=await started.json(),stop=Date.now()+20000;
  while(Date.now()<stop){const value=await f.get('/api/shared-settings/status');if(value.id===id&&['succeeded','failed','cancelled'].includes(value.state)){assert.equal(value.state,'succeeded',JSON.stringify(value));return;}await new Promise(r=>setTimeout(r,20));}
  assert.fail('apply did not settle');
 };
 f.setProbe((file,output)=>{if(!file.startsWith(tv.mediaRoot)&&!file.startsWith(tv.reviewRoot+path.sep+'TV'+path.sep))return output;return {...output,format:{...output.format,format_name:'matroska,webm'},streams:output.streams.map(stream=>stream.codec_type==='video'?{...stream,field_order:'progressive',pix_fmt:'yuv420p',color_transfer:'bt709',color_primaries:'bt709',color_space:'bt709'}:stream)}});
 return {f,sonarr,results,tv,apply};
}
const flat=value=>[...value.series.flatMap(s=>s.seasons.flatMap(x=>x.results)),...value.unbound,...value.unverified];
const appliedStatus=mode=>({mode,active:null,history:[]});

test('HTTP: mode off (the default) offers no TV section and makes no Sonarr call',linuxServer,async t=>{
 const {f,sonarr}=await tvServer(t);
 const unauthenticated=await f.request('/api/tv',{headers:{cookie:'review-session=invalid'}});assert.equal(unauthenticated.status,401);
 assert.deepEqual(await f.get('/api/tv/status'),appliedStatus('off'));assert.deepEqual(await f.get('/api/tv'),appliedStatus('off'));assert.deepEqual(await f.get('/api/tv?refresh=1'),appliedStatus('off'));
 assert.deepEqual(sonarr.calls,[],'no Sonarr request while the mode is off');
 const items=await f.items();assert.deepEqual(items.items.map(i=>i.title).sort(),['A','B','C','TV','TV','TV','TV','TV','TV'],'unchanged baseline: the movie scan lists whatever lies under its review root');
 assert.equal((await f.request('/api/tv?x=1')).status,400);
 assert.equal((await f.state()).tv,undefined,'no TV state exists in off mode');
});

test('HTTP: discovery binds exact results, lists unbound ones with reasons and leaves every movie record byte-identical',linuxServer,async t=>{
 const {f,sonarr,results,apply}=await tvServer(t);
 const itemsBefore=await f.items(),stateBefore=await movieState(f),files=await Promise.all(Object.values(results).flatMap(r=>[fs.readFile(r.sourcePath),fs.readFile(r.resultPath)]));
 await apply('discovery');
 assert.deepEqual(await f.get('/api/tv/status'),appliedStatus('discovery'));
 const value=await f.get('/api/tv?refresh=1');
 assert.equal(value.status,'ok');assert.equal(value.sonarr.status,'verified');
 assert.equal(value.totals.bound,3);assert.equal(value.totals.unbound,3);assert.equal(value.totals.unverified,0);assert.equal(value.totals.episodes,4);
 const show=value.series.find(s=>s.title==='Synthetic Show'),anime=value.series.find(s=>s.title==='Synthetic Anime');
 assert.deepEqual(show.seasons.map(s=>s.seasonNumber),[0,1]);assert.deepEqual(show.seasons[1].results[0].episodes.map(e=>e.episodeNumber),[1,2]);
 assert.equal(anime.seasons[0].results[0].episodes[0].absoluteEpisodeNumber,45);
 const by=name=>flat(value).find(item=>item.id===results[name].id);
 assert.equal(by('norecord').reason,'no_episode_file');assert.equal(by('otherlibrary').reason,'job_other_library');assert.equal(by('noreceipt').reason,'receipt_missing');
 assert.equal(by('multi').state,'bound');assert.ok(by('multi').observedAt);
 // Only the involved series, read-only.
 assert.ok(sonarr.calls.length>0&&sonarr.calls.every(c=>c.method==='GET'&&c.key===API_KEY));
 const requested=new Set(sonarr.calls.map(c=>new URL('http://x'+c.path+c.query).searchParams.get('seriesId')).filter(Boolean));
 assert.deepEqual([...requested].sort(),['7','8'],'the uninvolved series is never requested');
 const text=JSON.stringify(value);for(const secret of [API_KEY,f.root,SONARR_ROOT,SOURCE_ROOT])assert.equal(text.includes(secret),false,'no private value in the response');
 // Movies: ids, list, sessions, approvals, history untouched; the movie list does not show TV results.
 const itemsAfter=await f.items();
 const movies=list=>list.items.filter(i=>i.title!=='TV').map(i=>[i.id,i.title,i.snapshot]);
 assert.deepEqual(movies(itemsAfter),movies(itemsBefore));assert.deepEqual(itemsAfter.items.map(i=>i.title).sort(),['A','B','C'],'the movie list hands the TV results over to the TV scan');
 assert.equal(await movieState(f),stateBefore);
 const state=await f.state();assert.deepEqual(Object.keys(state.tv.items).sort(),Object.values(results).filter(r=>r!==results.noreceipt).map(r=>r.id).sort().filter(id=>state.tv.items[id]));
 for(const id of Object.keys(state.tv.items))assert.equal(id in state.items,false);
 for(const [index,r] of Object.values(results).entries()){assert.deepEqual(await fs.readFile(r.sourcePath),files[index*2]);assert.deepEqual(await fs.readFile(r.resultPath),files[index*2+1]);}
 await f.preserved();
});

test('HTTP: no route approves, rejects, replaces or retains a TV result',linuxServer,async t=>{
 const {f,results,apply}=await tvServer(t);await apply('discovery');
 const value=await f.get('/api/tv?refresh=1'),bound=value.series[0].seasons[0].results[0],id=bound.id;
 await f.items();
 const before=await movieState(f),callsBefore=f.calls.length,journals=await f.journals(),tvState=JSON.stringify((await f.state()).tv);
 const body={snapshot:'x',reviewRevision:1,reason:'Synthetic',confirm:true};
 const attempts=[
  ...['approve','reject','replace','approval','retain','recheck','review-session','frames','audio-compare'].flatMap(action=>[`/api/tv/${id}/${action}`,`/api/tv/items/${id}/${action}`,`/api/items/${id}/${action}`]),
  '/api/tv','/api/tv/approve','/api/tv/approve-batch','/api/approve-batch',
 ];
 for(const route of attempts){
  const response=await f.post(route,route==='/api/approve-batch'?{items:[{id,snapshot:'x',reviewRevision:1}]}:body);
  assert.ok(response.status>=400&&response.status<500,route+' answered '+response.status);
 }
 for(const route of [`/api/tv/${id}`,`/api/tv/items/${id}`,`/api/items/${id}/review-session?snapshot=x`,`/api/items/${id}/video`]){
  const response=await f.request(route);assert.ok([400,404,409].includes(response.status),route+' answered '+response.status);
 }
 assert.equal(await movieState(f),before,'nothing about movies changed');assert.equal(JSON.stringify((await f.state()).tv),tvState,'nothing about TV results changed');
 assert.deepEqual(await f.journals(),journals);assert.equal(f.calls.length,callsBefore,'no Tdarr or Radarr call');
 for(const r of Object.values(results)){await fs.stat(r.sourcePath);await fs.stat(r.resultPath);}
 await f.preserved();void results;
});

test('HTTP: Sonarr unavailable or inconsistent shows binding not verified and persists no verified state',linuxServer,async t=>{
 const {f,sonarr,apply}=await tvServer(t);await apply('discovery');
 for(const [prepare,reason] of [[()=>{sonarr.status=503;},'sonarr_unavailable'],[()=>{sonarr.status=200;sonarr.mixSeries=true;},'sonarr_inconsistent']]){
  prepare();const value=await f.get('/api/tv?refresh=1');
  assert.equal(value.totals.bound,0);assert.equal(value.series.length,0);assert.deepEqual([...new Set(value.unverified.map(i=>i.reason))],[reason]);assert.equal(value.sonarr.observedAt,null);
  for(const entry of Object.values((await f.state()).tv.items))assert.deepEqual(Object.keys(entry).sort(),['jobId','receiptIdentity','relative','reviewRelative','snapshot'],'only file-side evidence is persisted');
 }
 sonarr.status=200;sonarr.mixSeries=false;assert.equal((await f.get('/api/tv?refresh=1')).totals.bound,3,'a later scan binds again');
});

test('HTTP: switching the mode back to off stops scanning and Sonarr reads',linuxServer,async t=>{
 const {f,sonarr,apply}=await tvServer(t);await apply('discovery');assert.equal((await f.get('/api/tv?refresh=1')).totals.bound,3);
 await apply('off');const calls=sonarr.calls.length;
 assert.deepEqual(await f.get('/api/tv/status'),appliedStatus('off'));assert.deepEqual(await f.get('/api/tv?refresh=1'),appliedStatus('off'));assert.equal(sonarr.calls.length,calls);
});

test('settings: an applied generation written before the TV mode existed still loads and means off',linuxServer,async t=>{
 const {f,apply}=await tvServer(t);await apply('off');
 const file=path.join(f.data,'shared-settings.json'),doc=JSON.parse(await fs.readFile(file,'utf8'));
 assert.equal(doc.active.libraries.tv.mode,'off');
 delete doc.active.libraries.tv.mode;delete doc.draft.libraries.tv.mode;await fs.writeFile(file,JSON.stringify(doc));
 await f.restart();assert.deepEqual(await f.get('/api/tv/status'),appliedStatus('off'));
});

test('HTTP strict review: one v2 episode can be compared, explicitly reviewed, approved and installed with its original retained',linuxServer,async t=>{
 const {f,sonarr,results,tv,apply}=await tvServer(t,{strict:true});await apply('strict-review');
 const overview=await f.get('/api/tv?refresh=1');await f.get('/api/items');const moviesBefore=await movieState(f),item=flat(overview).find(value=>value.id===results.strict.id);
 assert.equal(item.state,'bound');assert.equal(item.strictEvidence,'passed');assert.equal(item.episodes.length,1);
 assert.equal(item.strictBlockReason,null);
 assert.equal(flat(overview).find(value=>value.id===results.multi.id).strictBlockReason,'multi_episode_file');
 assert.equal(flat(overview).find(value=>value.id===results.special.id).strictBlockReason,'strict_flow_evidence_missing');
 const sessionRoute=`/api/tv/${item.id}/review-session`,initial=await f.get(sessionRoute+'?snapshot='+item.snapshot);
 assert.equal(initial.item.snapshot,item.snapshot);assert.equal(initial.complete,false);
 const tracks=await f.post(`/api/tv/${item.id}/audio-compare`,{snapshot:item.snapshot,mode:'tracks'});assert.equal(tracks.status,200,await tracks.clone().text());
 assert.equal((await tracks.json()).original.length,1);
 const preparation=await f.get(`/api/tv/${item.id}/preview-status?snapshot=${encodeURIComponent(item.snapshot)}`);
 assert.ok(preparation.preparation.jobs.some(job=>job.mode==='av'&&job.previewProfile==='detail'));
 assert.ok(preparation.preparation.jobs.some(job=>job.mode==='listen'));
 const frames=await f.post(`/api/tv/${item.id}/frames`,{snapshot:item.snapshot,seconds:5});assert.equal(frames.status,200,await frames.clone().text());
 const identity={method:'external',device:'Synthetic player',scope:{originalIndex:1,reviewIndex:1,seconds:null},checks:{preparation:false,image:false,audio:false,syncStart:false,syncMiddle:false,syncEnd:false,hdr:false},step:0};
 let response=await f.post(sessionRoute,{snapshot:item.snapshot,revision:initial.revision,session:identity});assert.equal(response.status,200,await response.clone().text());
 const reviewed={...identity,checks:{preparation:true,image:true,audio:true,syncStart:true,syncMiddle:true,syncEnd:true,hdr:false},step:4};
 response=await f.post(sessionRoute,{snapshot:item.snapshot,revision:1,session:reviewed});assert.equal(response.status,200,await response.clone().text());
 const saved=await response.json();assert.equal(saved.complete,true);assert.equal(saved.revision,2);
 response=await f.post(`/api/tv/${item.id}/approval`,{snapshot:item.snapshot,reviewRevision:saved.revision});assert.equal(response.status,200,await response.clone().text());
 assert.deepEqual(await movieState(f),moviesBefore,'TV assessment and approval never touch movie records');
 const source=results.strict.sourcePath,original=await fs.readFile(source),install=await f.post(`/api/tv/${item.id}/install`,{snapshot:item.snapshot,reviewRevision:saved.revision});assert.equal(install.status,202,await install.clone().text());
 const stop=Date.now()+20000;let status;
 while(Date.now()<stop){status=await f.get('/api/tv/status');if(!status.active&&status.history.length)break;await new Promise(resolve=>setTimeout(resolve,30));}
 assert.equal(status.history[0].status,'success',JSON.stringify(status));
 assert.equal(status.history[0].refresh,'completed');
 assert.deepEqual(sonarr.calls.filter(call=>call.method==='POST').map(call=>[call.path,call.input]),[['/api/v3/command',{name:'RescanSeries',seriesId:7}]]);
 assert.ok(sonarr.calls.some(call=>call.method==='GET'&&call.path==='/api/v3/command/1'));
 assert.equal(await fs.readFile(path.join(tv.mediaRoot,'Synthetic Show/Season 01/S01E03.mkv'),'utf8'),'synthetic result Synthetic Show/Season 01/S01E03.mkv');
 const retained=(await fs.readdir(tv.quarantineRoot)).filter(name=>!name.endsWith('.pending'));assert.equal(retained.length,1);assert.deepEqual(await fs.readFile(path.join(tv.quarantineRoot,retained[0])),original);
 const duplicate=await f.post(`/api/tv/${item.id}/install`,{snapshot:item.snapshot,reviewRevision:saved.revision});assert.equal(duplicate.status,409);
 assert.ok(sonarr.calls.every(call=>call.method==='GET'||call.path==='/api/v3/command'), 'TV operations call Sonarr only for read-only binding and the pinned series rescan');
 await f.preserved();
});

test('HTTP strict review: a gated review save reserves the library and cannot race an accepted install revision',linuxServer,async t=>{
 const {f,sonarr,results,apply}=await tvServer(t,{strict:true});await apply('strict-review');
 const overview=await f.get('/api/tv?refresh=1');await f.get('/api/items');const item=flat(overview).find(value=>value.id===results.strict.id),route=`/api/tv/${item.id}/review-session`;
 const initial=await f.get(route+'?snapshot='+item.snapshot);await f.post(`/api/tv/${item.id}/audio-compare`,{snapshot:item.snapshot,mode:'tracks'});
 const empty={preparation:false,image:false,audio:false,syncStart:false,syncMiddle:false,syncEnd:false,hdr:false},identity={method:'external',device:'Synthetic player',scope:{originalIndex:1,reviewIndex:1,seconds:null},checks:empty,step:0};
 let response=await f.post(route,{snapshot:item.snapshot,revision:initial.revision,session:identity});assert.equal(response.status,200,await response.clone().text());
 const checks={preparation:true,image:true,audio:true,syncStart:true,syncMiddle:true,syncEnd:true,hdr:false},reviewed={...identity,checks,step:4};
 response=await f.post(route,{snapshot:item.snapshot,revision:1,session:reviewed});assert.equal(response.status,200,await response.clone().text());
 const saved=await response.json();response=await f.post(`/api/tv/${item.id}/approval`,{snapshot:item.snapshot,reviewRevision:saved.revision});assert.equal(response.status,200,await response.clone().text());
 let held=false;const gate=f.hold('/fixture/probe',input=>{if(!held&&input?.file===results.strict.sourcePath){held=true;return true}return false}),saveRequest=f.post(route,{snapshot:item.snapshot,revision:saved.revision,session:{...reviewed,note:'Changed while install was submitted'}});
 await gate.reached;
 const installResponse=await f.post(`/api/tv/${item.id}/install`,{snapshot:item.snapshot,reviewRevision:saved.revision});gate.release();
 response=await saveRequest;assert.equal(response.status,200,await response.clone().text());
 assert.equal(installResponse.status,409,'install is rejected while a TV review write owns async preflight');assert.equal((await installResponse.json()).code,'busy');
 assert.equal((await response.json()).revision,saved.revision+1);assert.equal((await f.state()).tvReview.approvals[item.id],undefined,'the new revision invalidates its prior approval');
 response=await f.post(`/api/tv/${item.id}/install`,{snapshot:item.snapshot,reviewRevision:saved.revision});assert.equal(response.status,409);assert.equal((await response.json()).code,'approval_required');
 assert.equal((await fs.readdir(path.join(f.root,'tv-quarantine')).catch(()=>[])).length,0,'a rejected stale install never writes the retained-original quarantine');
 assert.ok(!sonarr.calls.some(call=>call.method==='POST'&&call.path==='/api/v3/command'),'a rejected stale install never queues a Sonarr mutation');
 await f.preserved();
});

test('HTTP strict review: installation requires the unique configured TV library row before accepting a request',linuxServer,async t=>{
 const {f,sonarr,results,apply,tv}=await tvServer(t,{strict:true});await apply('strict-review');
 const overview=await f.get('/api/tv?refresh=1');await f.get('/api/items');const item=flat(overview).find(value=>value.id===results.strict.id),route=`/api/tv/${item.id}/review-session`,initial=await f.get(route+'?snapshot='+item.snapshot);
 const identity={method:'external',device:'Synthetic player',scope:{originalIndex:1,reviewIndex:1,seconds:null},checks:{preparation:false,image:false,audio:false,syncStart:false,syncMiddle:false,syncEnd:false,hdr:false},step:0};
 let response=await f.post(route,{snapshot:item.snapshot,revision:initial.revision,session:identity});assert.equal(response.status,200,await response.clone().text());
 response=await f.post(route,{snapshot:item.snapshot,revision:1,session:{...identity,checks:{preparation:true,image:true,audio:true,syncStart:true,syncMiddle:true,syncEnd:true,hdr:false},step:4}});assert.equal(response.status,200,await response.clone().text());
 const reviewed=await response.json();response=await f.post(`/api/tv/${item.id}/approval`,{snapshot:item.snapshot,reviewRevision:reviewed.revision});assert.equal(response.status,200,await response.clone().text());
 const source=await fs.readFile(results.strict.sourcePath),result=await fs.readFile(results.strict.resultPath),db=new DatabaseSync(path.join(f.root,'tdarr','DB','tdarr.db'));
 try{db.exec('DELETE FROM librarysettingsjsondb')}finally{db.close()}
 response=await f.post(`/api/tv/${item.id}/install`,{snapshot:item.snapshot,reviewRevision:reviewed.revision});assert.equal(response.status,409);assert.equal((await response.json()).code,'tv_tdarr_library_unavailable');
 assert.deepEqual(await fs.readFile(results.strict.sourcePath),source);assert.deepEqual(await fs.readFile(results.strict.resultPath),result);assert.deepEqual(await fs.readdir(tv.quarantineRoot),[],'a missing TV library row is rejected before retaining or replacing files');
 assert.equal((await f.state()).tvReview.history[0],undefined);assert.equal(sonarr.calls.filter(call=>call.method==='POST').length,0);
 await f.preserved();
});

test('HTTP strict review: a TV library row that changes at the precommit barrier aborts before replacement',linuxServer,async t=>{
 const {f,sonarr,results,apply,tv}=await tvServer(t,{strict:true});await apply('strict-review');
 const overview=await f.get('/api/tv?refresh=1');await f.get('/api/items');const item=flat(overview).find(value=>value.id===results.strict.id),route=`/api/tv/${item.id}/review-session`,initial=await f.get(route+'?snapshot='+item.snapshot);
 const identity={method:'external',device:'Synthetic player',scope:{originalIndex:1,reviewIndex:1,seconds:null},checks:{preparation:false,image:false,audio:false,syncStart:false,syncMiddle:false,syncEnd:false,hdr:false},step:0};
 let response=await f.post(route,{snapshot:item.snapshot,revision:initial.revision,session:identity});assert.equal(response.status,200,await response.clone().text());
 response=await f.post(route,{snapshot:item.snapshot,revision:1,session:{...identity,checks:{preparation:true,image:true,audio:true,syncStart:true,syncMiddle:true,syncEnd:true,hdr:false},step:4}});assert.equal(response.status,200,await response.clone().text());
 const reviewed=await response.json();response=await f.post(`/api/tv/${item.id}/approval`,{snapshot:item.snapshot,reviewRevision:reviewed.revision});assert.equal(response.status,200,await response.clone().text());
 const source=await fs.readFile(results.strict.sourcePath),result=await fs.readFile(results.strict.resultPath);let nodeReads=0;const gate=f.hold('/api/v2/get-nodes',()=>++nodeReads===3);
 response=await f.post(`/api/tv/${item.id}/install`,{snapshot:item.snapshot,reviewRevision:reviewed.revision});assert.equal(response.status,202,await response.clone().text());await gate.entered;
 const db=new DatabaseSync(path.join(f.root,'tdarr','DB','tdarr.db'));try{db.exec('DELETE FROM librarysettingsjsondb')}finally{db.close()}gate.release();
 const stop=Date.now()+10000;let current;while(Date.now()<stop){current=await f.state();if(!current.active&&current.tvReview?.history?.length)break;await new Promise(resolve=>setTimeout(resolve,20))}
 assert.equal(current.tvReview.history[0]?.status,'error');assert.match(current.tvReview.history[0]?.message,/Configured TV Tdarr library/);
 assert.deepEqual(await fs.readFile(results.strict.sourcePath),source);assert.deepEqual(await fs.readFile(results.strict.resultPath),result);const retained=await fs.readdir(tv.quarantineRoot);assert.ok(retained.length<=1);if(retained.length)assert.deepEqual(await fs.readFile(path.join(tv.quarantineRoot,retained[0])),source,'an interrupted precommit retention copy remains an intact recoverable original');
 assert.equal(sonarr.calls.filter(call=>call.method==='POST').length,0);
 const restoreDb=new DatabaseSync(path.join(f.root,'tdarr','DB','tdarr.db'));try{restoreDb.prepare('INSERT INTO librarysettingsjsondb VALUES (?)').run(JSON.stringify({_id:LIBRARY,folder:SOURCE_ROOT}))}finally{restoreDb.close()}
 response=await f.post(`/api/tv/${item.id}/install`,{snapshot:item.snapshot,reviewRevision:reviewed.revision});assert.equal(response.status,202,await response.clone().text());
 const retryDeadline=Date.now()+10000;let status;while(Date.now()<retryDeadline){status=await f.get('/api/tv/status');if(!status.active&&status.history[0]?.status==='success')break;await new Promise(resolve=>setTimeout(resolve,20))}
 assert.equal(status.history[0]?.status,'success','a later explicit installation can proceed after the TV library row is restored');assert.deepEqual(await fs.readFile(results.strict.sourcePath),result,'the retried transaction installs the reviewed result');
 const retainedAfterRetry=await fs.readdir(tv.quarantineRoot);assert.equal(retainedAfterRetry.length,2,'each explicit transaction keeps a distinct retained original');for(const name of retainedAfterRetry)assert.deepEqual(await fs.readFile(path.join(tv.quarantineRoot,name)),source);
 assert.equal(sonarr.calls.filter(call=>call.method==='POST').length,1);await f.preserved();
});

test('HTTP strict review: restart during Sonarr refresh preserves installed-pending state and never replays installation',linuxServer,async t=>{
 const {f,sonarr,results,tv,apply}=await tvServer(t,{strict:true});sonarr.autoCompleteCommands=false;await apply('strict-review');
 const overview=await f.get('/api/tv?refresh=1');await f.get('/api/items');const item=flat(overview).find(value=>value.id===results.strict.id);
 const route=`/api/tv/${item.id}/review-session`,initial=await f.get(route+'?snapshot='+item.snapshot);
 const identity={method:'external',device:'Synthetic player',scope:{originalIndex:1,reviewIndex:1,seconds:null},checks:{preparation:false,image:false,audio:false,syncStart:false,syncMiddle:false,syncEnd:false,hdr:false},step:0};
 let response=await f.post(route,{snapshot:item.snapshot,revision:initial.revision,session:identity});assert.equal(response.status,200,await response.clone().text());
 response=await f.post(route,{snapshot:item.snapshot,revision:1,session:{...identity,checks:{preparation:true,image:true,audio:true,syncStart:true,syncMiddle:true,syncEnd:true,hdr:false},step:4}});assert.equal(response.status,200,await response.clone().text());
 const reviewed=await response.json();response=await f.post(`/api/tv/${item.id}/approval`,{snapshot:item.snapshot,reviewRevision:reviewed.revision});assert.equal(response.status,200,await response.clone().text());
 const original=await fs.readFile(results.strict.sourcePath);response=await f.post(`/api/tv/${item.id}/install`,{snapshot:item.snapshot,reviewRevision:reviewed.revision});assert.equal(response.status,202,await response.clone().text());
 const deadline=Date.now()+10000;let state;
 while(Date.now()<deadline){state=await f.state();if(state.tvReview.history[0]?.status==='incomplete_refresh'&&state.tvReview.history[0]?.refresh==='pending'&&sonarr.calls.some(call=>call.method==='GET'&&call.path==='/api/v3/command/1'))break;await new Promise(resolve=>setTimeout(resolve,20))}
 assert.equal(state.tvReview.history[0]?.refresh,'pending','pending state must be durable before the readback barrier');assert.equal(sonarr.commands.get(1)?.status,'queued');
 await f.kill();await f.restart();const status=await f.get('/api/tv/status');assert.equal(status.active,null);assert.equal(status.history[0].status,'incomplete_refresh');assert.equal(status.history[0].refresh,'pending');
 assert.equal(sonarr.calls.filter(call=>call.method==='POST'&&call.path==='/api/v3/command').length,1,'restart must not issue another Sonarr rescan');
 const retained=(await fs.readdir(tv.quarantineRoot)).filter(name=>!name.endsWith('.pending'));assert.equal(retained.length,1);assert.deepEqual(await fs.readFile(path.join(tv.quarantineRoot,retained[0])),original);
 await f.preserved();
});

test('HTTP strict review: unsupported HDR technical facts stay visible and return a fixed public reason',linuxServer,async t=>{
 const {f,results,apply,tv}=await tvServer(t,{strict:true});await apply('strict-review');
 f.setProbe((file,output)=>{if(!file.startsWith(tv.mediaRoot)&&!file.startsWith(tv.reviewRoot+path.sep+'TV'+path.sep))return output;return {...output,format:{...output.format,format_name:'matroska,webm'},streams:output.streams.map(stream=>stream.codec_type==='video'?{...stream,field_order:'progressive',pix_fmt:'yuv420p',color_transfer:'smpte2084',color_primaries:'bt2020',color_space:'bt2020nc'}:stream)}});
 const overview=await f.get('/api/tv?refresh=1'),item=flat(overview).find(value=>value.id===results.strict.id);assert.equal(item.strictBlockReason,'tv_hdr_or_unknown_color');
 const response=await f.request(`/api/tv/${item.id}/review-session?snapshot=${item.snapshot}`);assert.equal(response.status,409);assert.equal((await response.json()).code,'tv_hdr_or_unknown_color');
});
