import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {serverHarness,linuxServer} from './test-helpers/server.mjs';
import {emptyTvLibrary} from './library-paths.mjs';

const apiKey='synthetic-sonarr-source-key';
const records={series:[{id:7,title:'Synthetic Show',path:'/private/sonarr/root'}],files:[{id:31,seriesId:7,path:'/sonarr/tv/Show/S01E01.mkv',relativePath:'Show/S01E01.mkv',seasonNumber:1}],episodes:[{id:42,seriesId:7,episodeFileId:31,hasFile:true,seasonNumber:1,episodeNumber:1}]};
const wait=async predicate=>{const stop=Date.now()+3000;while(Date.now()<stop){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('Expected event was not observed');};

test('authenticated manual source check uses only IDs, maps exactly, and leaves Movie HTTP responsive while child is stalled',linuxServer,async t=>{
 const calls=[];let releaseSeries,seriesEntered;const seriesGate=new Promise(resolve=>{releaseSeries=resolve}),seriesSeen=new Promise(resolve=>{seriesEntered=resolve});let holdFirstSeries=true;
 const sonarr=http.createServer(async(req,res)=>{calls.push({method:req.method,url:req.url,key:req.headers['x-api-key']});const route=new URL(req.url,'http://localhost').pathname;if(route.endsWith('/series')&&holdFirstSeries){holdFirstSeries=false;seriesEntered();await seriesGate;}const value=route.endsWith('/series')?records.series:route.endsWith('/episodefile')?records.files:route.endsWith('/episode')?records.episodes:null;if(!value){res.writeHead(404);return res.end();}res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));});
 await new Promise(resolve=>sonarr.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>sonarr.close(resolve)));
 const f=await serverHarness();t.after(()=>f.close());
 const worker=fileURLToPath(new URL('./sonarr-source-worker.mjs',import.meta.url)),slow=path.join(f.root,'slow-worker.mjs'),preload=path.join(f.root,'source-worker-preload.cjs'),started=path.join(f.root,'source-worker-started');
 await fs.writeFile(slow,"process.stdin.resume();setTimeout(()=>process.stdout.write(JSON.stringify({status:'present',size:9,modifiedAt:1})+'\\n'),650);");
 await fs.writeFile(preload,`const cp=require('node:child_process'),fs=require('node:fs'),original=cp.spawn;cp.spawn=(exe,args,options)=>{if(exe===process.execPath&&args?.[0]===${JSON.stringify(worker)}){fs.appendFileSync(${JSON.stringify(started)},'x');return original(exe,[${JSON.stringify(slow)}],options)}return original(exe,args,options)};require('node:module').syncBuiltinESMExports();`);
 const dbpath=path.join(f.root,'tdarr.db'),db=new DatabaseSync(dbpath);db.exec('CREATE TABLE jobsjsondb (json_data TEXT); CREATE TABLE librarysettingsjsondb (json_data TEXT); CREATE TABLE statisticsjsondb (json_data TEXT)');db.close();
 await f.start({preload,settings:{database:dbpath}});
 assert.equal((await f.request('/api/sonarr/source?revision='+('a'.repeat(64))+'&seriesId=7&episodeFileId=31')).status,401);
 const cookie=await f.login(),headers={cookie};
 const initial=await (await f.request('/api/shared-settings',{headers})).json(),tv={...emptyTvLibrary(),sonarrRoot:'/sonarr/tv',mediaRoot:f.media};
 const saved=await f.request('/api/shared-settings/draft',{method:'POST',headers,body:{revision:initial.revision,patch:{sonarr:{url:'http://127.0.0.1:'+sonarr.address().port+'/sonarr',apiKey},libraries:{tv}}}});
 assert.equal(saved.status,200,await saved.clone().text());const configured=await saved.json();
 await fs.mkdir(path.join(f.media,'Show'),{recursive:true});await fs.writeFile(path.join(f.media,'Show','S01E01.mkv'),'synthetic');
 const query='/api/sonarr/source?revision='+configured.revision+'&seriesId=7&episodeFileId=31';
 assert.equal((await f.request(query+'&filePath=%2Fetc%2Fpasswd',{headers})).status,400,'the browser cannot supply a path');
 const sourceRequest=f.request(query,{headers});await seriesSeen;
 try{
  const burst=await Promise.all(Array.from({length:4},()=>f.request(query,{headers})));
  assert.equal(calls.length,1,'requests arriving during the first Sonarr read do not start more snapshots');
  for(const response of burst){assert.equal(response.status,200);assert.equal((await response.json()).status,'busy');}
  assert.equal(new URL(calls[0].url,'http://localhost').pathname,'/sonarr/api/v3/series');
 }finally{releaseSeries();}
 await wait(async()=>{try{return (await fs.readFile(started,'utf8')).length>0}catch{return false;}});
 assert.equal((await fs.readFile(started,'utf8')).length,1,'only one child is launched for the burst');
 const startedAt=Date.now(),movie=await f.request('/api/items',{headers});assert.equal(movie.status,200,await movie.clone().text());assert.ok(Date.now()-startedAt<500,'Movie route responds while the isolated source child is still running');
 const response=await sourceRequest;assert.equal(response.status,200,await response.clone().text());const result=await response.json();
 assert.deepEqual(result,{status:'present',source:'unverified',relative:'Show/S01E01.mkv',size:9,modifiedAt:1});
 const serialized=JSON.stringify(result);for(const secret of [apiKey,f.media,'/sonarr/tv','/private/sonarr/root'])assert.equal(serialized.includes(secret),false);
 assert.deepEqual(calls.map(call=>call.method),['GET','GET','GET']);assert.ok(calls.every(call=>call.key===apiKey));assert.deepEqual(calls.map(call=>new URL(call.url,'http://localhost').pathname),['/sonarr/api/v3/series','/sonarr/api/v3/episodefile','/sonarr/api/v3/episode']);
 assert.equal((await f.request('/api/sonarr/source?revision='+configured.revision+'&seriesId=7&episodeFileId=31',{method:'POST',headers,body:{}})).status,404);
 assert.equal(f.output().includes(apiKey),false);
});
