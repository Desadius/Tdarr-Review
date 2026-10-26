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
async function tvServer(t){
 const sonarr=await sonarrMock({series:[
  {id:7,title:'Synthetic Show',path:SONARR_ROOT+'\\Synthetic Show',seriesType:'standard'},
  {id:8,title:'Synthetic Anime',path:SONARR_ROOT+'\\Synthetic Anime',seriesType:'anime'},
  {id:9,title:'Uninvolved Show',path:SONARR_ROOT+'\\Uninvolved Show',seriesType:'standard'}],files:{7:[],8:[],9:[]},episodes:{7:[],8:[],9:[]}});
 t.after(()=>sonarr.close());
 let tvMedia,results={};
 const f=await reviewFixture({beforeStart:async({root,dbpath})=>{
  tvMedia=path.join(root,'tv-media');const review=path.join(root,'review');
  const jobs=new DatabaseSync(dbpath);
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
  }finally{jobs.close();}
 }});
 t.after(()=>f.close());
 const tv={mode:'discovery',mediaRoot:tvMedia,reviewRoot:path.join(f.root,'review'),libraryId:LIBRARY,sourceRoots:[SOURCE_ROOT],tdarrReviewRoot:'/tdarr/review',reviewPrefixes:['TV'],sonarrRoot:SONARR_ROOT};
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
 return {f,sonarr,results,tv,apply};
}
const flat=value=>[...value.series.flatMap(s=>s.seasons.flatMap(x=>x.results)),...value.unbound,...value.unverified];

test('HTTP: mode off (the default) offers no TV section and makes no Sonarr call',linuxServer,async t=>{
 const {f,sonarr}=await tvServer(t);
 const unauthenticated=await f.request('/api/tv',{headers:{cookie:'review-session=invalid'}});assert.equal(unauthenticated.status,401);
 assert.deepEqual(await f.get('/api/tv/status'),{mode:'off'});assert.deepEqual(await f.get('/api/tv'),{mode:'off'});assert.deepEqual(await f.get('/api/tv?refresh=1'),{mode:'off'});
 assert.deepEqual(sonarr.calls,[],'no Sonarr request while the mode is off');
 const items=await f.items();assert.deepEqual(items.items.map(i=>i.title).sort(),['A','B','C','TV','TV','TV','TV','TV','TV'],'unchanged baseline: the movie scan lists whatever lies under its review root');
 assert.equal((await f.request('/api/tv?x=1')).status,400);
 assert.equal((await f.state()).tv,undefined,'no TV state exists in off mode');
});

test('HTTP: discovery binds exact results, lists unbound ones with reasons and leaves every movie record byte-identical',linuxServer,async t=>{
 const {f,sonarr,results,apply}=await tvServer(t);
 const itemsBefore=await f.items(),stateBefore=await movieState(f),files=await Promise.all(Object.values(results).flatMap(r=>[fs.readFile(r.sourcePath),fs.readFile(r.resultPath)]));
 await apply('discovery');
 assert.deepEqual(await f.get('/api/tv/status'),{mode:'discovery'});
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
 assert.deepEqual(await f.get('/api/tv/status'),{mode:'off'});assert.deepEqual(await f.get('/api/tv?refresh=1'),{mode:'off'});assert.equal(sonarr.calls.length,calls);
});

test('settings: an applied generation written before the TV mode existed still loads and means off',linuxServer,async t=>{
 const {f,apply}=await tvServer(t);await apply('off');
 const file=path.join(f.data,'shared-settings.json'),doc=JSON.parse(await fs.readFile(file,'utf8'));
 assert.equal(doc.active.libraries.tv.mode,'off');
 delete doc.active.libraries.tv.mode;delete doc.draft.libraries.tv.mode;await fs.writeFile(file,JSON.stringify(doc));
 await f.restart();assert.deepEqual(await f.get('/api/tv/status'),{mode:'off'});
});
