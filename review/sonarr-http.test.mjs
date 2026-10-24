import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {serverHarness,linuxServer} from './test-helpers/server.mjs';

const apiKey='synthetic-sonarr-secret';
const records={
 series:[{id:7,title:'Synthetic Show',path:'/private/sonarr/root',images:[{remoteUrl:'https://secret.invalid'}]}],
 files:[{id:31,seriesId:7,path:'Z:\\TV\\Synthetic Show\\S00E01.mkv',relativePath:'Synthetic Show/Specials/S00E01.mkv',seasonNumber:0}],
 episodes:[{id:42,seriesId:7,episodeFileId:31,hasFile:true,seasonNumber:0,episodeNumber:1,absoluteEpisodeNumber:1,sceneAbsoluteEpisodeNumber:101,sceneSeasonNumber:100,sceneEpisodeNumber:1,unverifiedSceneNumbering:true,airDate:'2020-01-02'}],
};

test('authenticated manual inspector reads only Sonarr GET metadata at the saved revision',linuxServer,async t=>{
 const calls=[],sonarr=http.createServer((req,res)=>{calls.push({method:req.method,url:req.url,key:req.headers['x-api-key']});const route=new URL(req.url,'http://localhost').pathname;const value=route.endsWith('/series')?records.series:route.endsWith('/episodefile')?records.files:route.endsWith('/episode')?records.episodes:null;
  if(!value){res.writeHead(404);return res.end();}res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));});
 await new Promise(resolve=>sonarr.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>sonarr.close(resolve)));
 const f=await serverHarness();t.after(()=>f.close());await f.start();
 const route='/api/sonarr/series';assert.equal((await f.request(route)).status,401);
 const cookie=await f.login(),headers={cookie};const initial=await (await f.request('/api/shared-settings',{headers})).json();
 const settingsBytes=await fs.readFile(path.join(f.data,'settings.json'));
 const saved=await f.request('/api/shared-settings/draft',{method:'POST',headers,body:{revision:initial.revision,patch:{sonarr:{url:'http://127.0.0.1:'+sonarr.address().port+'/sonarr',apiKey}}}});assert.equal(saved.status,200,await saved.clone().text());const value=await saved.json();
 assert.equal(value.draft.sonarr.hasApiKey,true);assert.equal(value.draft.sonarr.apiKey,undefined);assert.equal(JSON.stringify(value).includes(apiKey),false);
 const savedSharedBytes=await fs.readFile(path.join(f.data,'shared-settings.json'));
 const asset=await f.request('/sonarr-view.js');assert.equal(asset.status,200);assert.match(await asset.text(),/renderSonarrInspector/);
 for(const bad of ['/api/sonarr/series','/api/sonarr/series?revision=stale','/api/sonarr/inspect?revision='+value.revision+'&seriesId=9007199254740992']){
  const response=await f.request(bad,{headers});assert.ok([400,409].includes(response.status),bad);
 }
 const stale=await f.request(route+'?revision='+initial.revision,{headers});assert.equal(stale.status,409);assert.equal((await stale.json()).code,'settings_conflict');
 const series=await f.request(route+'?revision='+value.revision,{headers});assert.equal(series.status,200);assert.deepEqual((await series.json()).series,[{id:7,title:'Synthetic Show'}]);
 const inspection=await f.request('/api/sonarr/inspect?revision='+value.revision+'&seriesId=7',{headers});assert.equal(inspection.status,200,await inspection.clone().text());const result=await inspection.json();
 assert.equal(result.complete,true);assert.equal(result.source,'unverified');assert.equal(result.bindings[0].status,'mapped');assert.equal(result.bindings[0].file.seasonNumber,0);assert.equal(result.bindings[0].episodes[0].sceneAbsoluteEpisodeNumber,101);assert.equal(result.bindings[0].episodes[0].unverifiedSceneNumbering,true);
 const text=JSON.stringify(result);assert.equal(text.includes('Z:'),false);assert.equal(text.includes('/private/sonarr/root'),false);assert.equal(text.includes('remoteUrl'),false);assert.equal(text.includes(apiKey),false);
 assert.deepEqual(calls.map(call=>call.method),['GET','GET','GET','GET']);assert.ok(calls.every(call=>call.key===apiKey));assert.deepEqual(calls.map(call=>new URL(call.url,'http://localhost').pathname),['/sonarr/api/v3/series','/sonarr/api/v3/series','/sonarr/api/v3/episodefile','/sonarr/api/v3/episode']);assert.equal(new URL(calls[3].url,'http://localhost').searchParams.get('seriesId'),'7');
 assert.deepEqual(await fs.readFile(path.join(f.data,'settings.json')),settingsBytes);assert.deepEqual(await fs.readFile(path.join(f.data,'shared-settings.json')),savedSharedBytes,'inspection bindings are not persisted');assert.equal((await f.request('/api/sonarr/series?revision='+value.revision)).status,401);
 assert.equal(f.output().includes(apiKey),false);
 const wrongMethod=await f.request(route+'?revision='+value.revision,{method:'POST',headers,body:{}});assert.equal(wrongMethod.status,404);
});
