import test from 'node:test';
import assert from 'node:assert/strict';
import {createSonarrInspection} from './sonarr-inspection.mjs';

const settings={url:'http://127.0.0.1:8989/sonarr',apiKey:'secret-sonarr-key'};
const revision='a'.repeat(64);
const series=[{id:7,title:'Example Show',path:'/library/tv/Example Show',unknown:'not returned'}];
const files=[{id:31,seriesId:7,path:'Z:\\TV\\Example Show\\Season 01\\Example Show - S01E02.mkv',relativePath:'Example Show/Season 01/Example Show - S01E02.mkv',seasonNumber:1,sceneName:'Example.Show.S01E02'}];
const episodes=[
 {id:42,seriesId:7,episodeFileId:31,hasFile:true,seasonNumber:1,episodeNumber:2,absoluteEpisodeNumber:2,sceneAbsoluteEpisodeNumber:202,sceneSeasonNumber:20,sceneEpisodeNumber:2,unverifiedSceneNumbering:true,airDate:'2020-01-02'},
 {id:45,seriesId:7,episodeFileId:31,hasFile:true,seasonNumber:1,episodeNumber:3,absoluteEpisodeNumber:5,sceneAbsoluteEpisodeNumber:105,unverifiedSceneNumbering:false,airDateUtc:'2020-01-03T00:00:00Z'},
 {id:43,seriesId:7,episodeFileId:0,hasFile:false,seasonNumber:1,episodeNumber:3},
];
const json=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});

test('manual snapshots use selected-series GET endpoints and return only safe metadata',async()=>{
 const calls=[];let connectionReads=0;
 const inspection=createSonarrInspection({getConnection:async input=>{assert.equal(input,revision);connectionReads++;return settings;},fetchFn:async(url,options)=>{
  calls.push({url:new URL(url),options});
  if(url.pathname.endsWith('/series'))return json(series);
  if(url.pathname.endsWith('/episodefile'))return json(files);
  if(url.pathname.endsWith('/episode'))return json(episodes);
  throw Error('unexpected upstream route');
 }});
 assert.deepEqual(await inspection.series(revision),{series:[{id:7,title:'Example Show'}]});
 const result=await inspection.inspect(revision,7);
 assert.equal(result.complete,true);assert.equal(result.source,'unverified');
 assert.equal(result.bindings.length,1);
 assert.deepEqual(result.bindings[0].binding.episodeIds,[42,45]);assert.deepEqual(result.bindings[0].episodes.map(item=>item.id),[42,45]);
 assert.equal(result.bindings[0].episodes[0].sceneAbsoluteEpisodeNumber,202);
 assert.equal(result.bindings[0].episodes[0].unverifiedSceneNumbering,true);
 assert.deepEqual(result.unacquiredEpisodes,[{id:43,seasonNumber:1,episodeNumber:3,absoluteEpisodeNumber:null,sceneAbsoluteEpisodeNumber:null,sceneSeasonNumber:null,sceneEpisodeNumber:null,unverifiedSceneNumbering:null,airDate:null,airDateUtc:null}]);
 assert.equal(result.bindings[0].episodes[1].absoluteEpisodeNumber,5);assert.equal(result.bindings[0].episodes[1].sceneAbsoluteEpisodeNumber,105);assert.equal(result.bindings[0].episodes[1].airDateUtc,'2020-01-03T00:00:00Z');
 assert.equal(result.bindings[0].file.label,'Example Show/Season 01/Example Show - S01E02.mkv');
 assert.equal(JSON.stringify(result).includes('Z:'),false);
 assert.equal(JSON.stringify(result).includes('/library/tv'),false);
 assert.equal(JSON.stringify(result).includes('unknown'),false);
 assert.equal(connectionReads,4);
 assert.equal(calls.length,4);
 assert.deepEqual(calls.map(({url})=>url.pathname),['/sonarr/api/v3/series','/sonarr/api/v3/series','/sonarr/api/v3/episodefile','/sonarr/api/v3/episode']);
 for(const {url,options} of calls){assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers['X-Api-Key'],settings.apiKey);assert.equal(url.searchParams.get('seriesId'),url.pathname.endsWith('/episodefile')||url.pathname.endsWith('/episode')?'7':null);}
});

test('unavailable, redirect, invalid JSON, oversized and stale results fail closed',async t=>{
 const base=async fetchFn=>createSonarrInspection({getConnection:async()=>settings,fetchFn});
 await t.test('redirect refusal',async()=>{
  const value=await base(async()=>new Response('',{status:302,headers:{location:'http://127.0.0.1:1/steal'}}));
  await assert.rejects(value.series(revision),/sonarr_unavailable/);
 });
 await t.test('invalid JSON',async()=>{
  const value=await base(async()=>new Response('{',{status:200,headers:{'content-type':'application/json'}}));
  await assert.rejects(value.series(revision),/sonarr_unavailable/);
 });
 await t.test('partial content is not a complete snapshot even when the body is valid JSON',async()=>{
  const value=await base(async()=>new Response(JSON.stringify(series),{status:206,headers:{'content-type':'application/json'}}));
  await assert.rejects(value.series(revision),/sonarr_unavailable/);
 });
 await t.test('oversized response',async()=>{
  const value=await base(async()=>new Response('[]',{status:200,headers:{'content-type':'application/json','content-length':'99999999'}}));
  await assert.rejects(value.series(revision),/sonarr_too_large/);
 });
 await t.test('record cap is reported rather than silently truncating',async()=>{
  const tooMany=Array.from({length:5001},(_,index)=>({id:index+1,title:'Series'}));
  const value=await base(async()=>json(tooMany));await assert.rejects(value.series(revision),/sonarr_too_large/);
 });
 await t.test('request timeout aborts the upstream read',async()=>{
  const value=createSonarrInspection({getConnection:async()=>settings,requestTimeoutMs:5,fetchFn:async(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))});
  await assert.rejects(value.series(revision));
 });
 await t.test('a declared partial record count is rejected',async()=>{
  const value=await base(async()=>new Response(JSON.stringify(series),{status:200,headers:{'content-type':'application/json','x-total-count':'2'}}));
  await assert.rejects(value.series(revision),/sonarr_unavailable/);
 });
 await t.test('stale saved revision',async()=>{
  let reads=0;const value=createSonarrInspection({getConnection:async()=>{if(++reads>1)throw Object.assign(Error('changed'),{code:'settings_conflict'});return settings;},fetchFn:async()=>json(series)});
  await assert.rejects(value.series(revision),error=>error.code==='settings_conflict');
 });
});

test('malformed URL and foreign episode records cannot be treated as a complete binding',async()=>{
 for(const url of ['http://user:pass@127.0.0.1:8989/sonarr','http://127.0.0.1:8989/sonarr?apikey=secret']){
  const unsafe=createSonarrInspection({getConnection:async()=>({...settings,url}),fetchFn:async()=>json(series)});
  await assert.rejects(unsafe.series(revision),/sonarr_unavailable/);
 }
 const inspection=createSonarrInspection({getConnection:async()=>settings,fetchFn:async url=>url.pathname.endsWith('/series')?json(series):url.pathname.endsWith('/episodefile')?json(files):json([...episodes,{id:44,seriesId:99,episodeFileId:31,hasFile:true}])});
 await assert.rejects(inspection.inspect(revision,7),/sonarr_unavailable/);
});

test('indexes a large selected-series snapshot once before resolving its episode files',async()=>{
 const count=1600;
 const manyFiles=Array.from({length:count},(_,index)=>({id:index+1,seriesId:7,path:'T:\\TV\\Show\\'+index+'.mkv',relativePath:'Show/'+index+'.mkv',seasonNumber:1}));
 const manyEpisodes=Array.from({length:count},(_,index)=>({id:100000+index,seriesId:7,episodeFileId:index+1,hasFile:true,seasonNumber:1,episodeNumber:index+1}));
 const inspection=createSonarrInspection({getConnection:async()=>settings,fetchFn:async url=>url.pathname.endsWith('/series')?json(series):url.pathname.endsWith('/episodefile')?json(manyFiles):json(manyEpisodes)});
 const started=performance.now(),result=await inspection.inspect(revision,7),elapsed=performance.now()-started;
 assert.equal(result.bindings.length,count);assert.ok(result.bindings.every(binding=>binding.status==='mapped'));
 assert.ok(elapsed<750,'1600-file complete snapshot should be indexed once; elapsed '+Math.round(elapsed)+'ms');
});
