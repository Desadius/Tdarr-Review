import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {serverHarness,linuxServer} from './test-helpers/server.mjs';

// Version, artwork, Radarr request overview and health wiring of the real server, over HTTP with a
// loopback Radarr mock. An unresolved synthetic transaction keeps the server from scanning or
// writing media; no film, database or real endpoint is involved.
const {version}=JSON.parse(await fs.readFile(new URL('../package.json',import.meta.url),'utf8'));
const MOVIE=7,ID='e'.repeat(24);
// The smallest JPEG the artwork validator accepts: SOI, a 1x1 SOF0, SOS and EOI.
const JPEG=Buffer.from('ffd8ffc00011080001000103011100021101031101ffda000801010000003f00d2cf20ffd9','hex');

async function fixture({env,status,beforeStart,host}={}){
 const harness=await serverHarness({host}),calls=[];
 const radarr=http.createServer((req,res)=>{
  calls.push(req.url);
  if(req.headers['x-api-key']!=='synthetic-artwork-key'){res.writeHead(401);return res.end()}
  if(req.url==='/api/v3/movie'){res.setHeader('content-type','application/json');return res.end(JSON.stringify([{id:MOVIE,tmdbId:70,movieFile:{path:'/fixture-library/A/A.mkv'}}]))}
  if(req.url===`/api/v3/mediacover/${MOVIE}/poster-250.jpg`){res.setHeader('content-type','image/jpeg');return res.end(JPEG)}
  res.writeHead(404);res.end();
 });
 const close=async()=>{try{await harness.close()}finally{await new Promise(resolve=>radarr.close(resolve))}};
 try{
  await new Promise(resolve=>radarr.listen(0,'127.0.0.1',resolve));
  await fs.writeFile(path.join(harness.data,'transactions','synthetic.json'),JSON.stringify({id:'synthetic',phase:'installed'}));
  await fs.writeFile(path.join(harness.data,'radarr.json'),JSON.stringify({url:'http://127.0.0.1:'+radarr.address().port,apiKey:'synthetic-artwork-key',mediaRoot:'/fixture-library',preferCzechEnglish:false}),{mode:0o600});
  // Recovery's shared status file lives in the parent of the media root.
  await beforeStart?.({data:harness.data,radarrUrl:'http://127.0.0.1:'+radarr.address().port});
  if(status)await fs.writeFile(path.join(path.dirname(harness.media),'.tdarr-recovery-status.json'),typeof status==='string'?status:JSON.stringify(status));
  // An empty synthetic Tdarr database: the scan lists no films.
  const database=path.join(harness.root,'tdarr.db'),db=new DatabaseSync(database);db.exec('CREATE TABLE jobsjsondb (json_data TEXT); CREATE TABLE librarysettingsjsondb (json_data TEXT)');db.close();
  await harness.start({env,settings:{database}});
  const cookie=await harness.login();
  const get=(route,headers={cookie})=>harness.request(route,{headers});
  return {...harness,calls,get,close};
 }catch(error){await close();throw error}
}
const DETECTED='2026-10-16T10:00:00.000Z';
// Radarr calls that only the artwork route makes (the background observer may also list movies).
const posters=f=>f.calls.filter(route=>route.startsWith('/api/v3/mediacover/'));
// The status of a request path sent byte for byte.
const rawStatus=(f,raw)=>new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:f.port,path:raw},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});req.on('error',reject);req.end();});
const recoveryCase=(fields={})=>({version:1,updated:new Date().toISOString(),configChange:{detectedAt:DETECTED,restartRequired:true,valid:false,error:'config.json is not valid JSON',digest:'private-digest'},cases:[{id:ID,phase:'waiting_replacement',movieId:MOVIE,tmdbId:70,title:'Synthetic',...fields}]});

test('HTTP the items API reports the package version, or APP_VERSION when the image sets it',linuxServer,async()=>{
 for(const [env,expected] of [[{APP_VERSION:''},version],[{APP_VERSION:'9.8.7'},'9.8.7'],[{APP_VERSION:'<script>'},version]]){
  const f=await fixture({env});try{
   const response=await f.get('/api/items');assert.equal(response.status,200,await response.clone().text());
   assert.equal((await response.json()).version,expected,JSON.stringify(env));
  }finally{await f.close()}
 }
});

test('HTTP request artwork is served from the configured Radarr only after login, with private caching',linuxServer,async()=>{
 const f=await fixture({status:recoveryCase()});try{
  const before=f.calls.length;
  assert.equal((await f.get('/api/artwork/request/'+ID,{})).status,401,'the artwork route is behind login');
  assert.deepEqual(f.calls.slice(before),[],'an unauthenticated request never reaches Radarr');
  const response=await f.get('/api/artwork/request/'+ID);assert.equal(response.status,200,await response.clone().text());
  assert.equal(response.headers.get('content-type'),'image/jpeg');assert.equal(response.headers.get('cache-control'),'private, max-age=300');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.equal(response.headers.get('content-security-policy'),"default-src 'none'; frame-ancestors 'none'");assert.match(response.headers.get('etag'),/^"[a-f0-9]{64}"$/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),JPEG);
  assert.deepEqual(posters(f),[`/api/v3/mediacover/${MOVIE}/poster-250.jpg`]);
  const served=f.calls.length;
  assert.equal((await f.get('/api/artwork/request/'+'f'.repeat(24))).status,404,'only a visible request has artwork');
  assert.equal((await f.get('/api/artwork/other/'+ID)).status,404);
  assert.deepEqual(f.calls.slice(served),[],'an id that is not a visible request never reaches Radarr');
 }finally{await f.close()}
});

test('HTTP request artwork uses the request\'s own movie identity',linuxServer,async()=>{
 const f=await fixture({status:recoveryCase({movieId:MOVIE+1,tmdbId:71})});try{
  assert.equal((await f.get('/api/artwork/request/'+ID)).status,404,'a request for another movie gets no poster');
  assert.deepEqual(posters(f),[]);
 }finally{await f.close()}
});

// A Review replacement request stores the Radarr it was made with; artwork for it comes only from
// that Radarr and root, never from another configured instance.
for(const [stored,served] of [[{},true],[{radarrUrl:'http://127.0.0.1:1'},false],[{radarrRoot:'/other-library'},false]])test(`HTTP stored request artwork ${served?'is served from its own Radarr':'is refused for another Radarr '+Object.keys(stored)[0]}`,linuxServer,async()=>{
 const f=await fixture({beforeStart:async({data,radarrUrl})=>{
  await fs.mkdir(path.join(data,'radarr-replacements'));
  await fs.writeFile(path.join(data,'radarr-replacements',ID+'.json'),JSON.stringify({id:ID,title:'Synthetic',phase:'waiting',movieId:MOVIE,tmdbId:70,radarrUrl,radarrRoot:'/fixture-library',...stored}));
 }});try{
  assert.equal((await f.get('/api/artwork/request/'+ID)).status,served?200:404);
  assert.deepEqual(posters(f),served?[`/api/v3/mediacover/${MOVIE}/poster-250.jpg`]:[]);
 }finally{await f.close()}
});

test('HTTP the static assets include the review model module and nothing outside the asset list',linuxServer,async()=>{
 const f=await fixture();try{
  const model=await f.get('/review-model.js',{});assert.equal(model.status,200);assert.match(model.headers.get('content-type'),/^text\/javascript/);
  assert.match(await model.text(),/export /);
  for(const route of ['/review-model.mjs','/server.mjs','/routes/library.mjs','/artwork.mjs','/public/review-model.js'])assert.equal((await f.get(route,{})).status,404,route);
  // Raw traversal paths, sent as they are (a URL object would normalize them first).
  for(const raw of ['/../package.json','/%2e%2e/package.json','/..%2fserver.mjs'])assert.equal(await rawStatus(f,raw),404,raw);
 }finally{await f.close()}
});

test('HTTP the Radarr request overview carries Recovery cases and only the safe restart-notice fields',linuxServer,async()=>{
 const f=await fixture({status:recoveryCase()});try{
  const response=await f.get('/api/radarr/requests');assert.equal(response.status,200,await response.clone().text());
  const overview=await response.json();
  assert.deepEqual(overview.requests.map(request=>request.id),[ID]);
  assert.deepEqual(overview.recoveryConfig,{detectedAt:DETECTED,restartRequired:true,valid:false,error:'config.json is not valid JSON'});
  assert.ok(!JSON.stringify(overview).includes('private-digest'));
  assert.equal((await f.get('/api/radarr/requests',{})).status,401);
 }finally{await f.close()}
});

test('HTTP /health answers loopback clients before login and is hidden from other addresses',linuxServer,async t=>{
 const address=Object.values(os.networkInterfaces()).flat().find(entry=>entry&&entry.family==='IPv4'&&!entry.internal)?.address;
 const f=await fixture({host:'0.0.0.0'});try{
  const local=await f.get('/health',{});assert.equal(local.status,200);assert.ok(Array.isArray((await local.json()).attention));
  if(!address)return t.skip('no non-loopback IPv4 interface to connect from');
  // Connect to the server's own non-loopback address, so the request does not come from loopback.
  const remote=await new Promise((resolve,reject)=>{
   const req=http.request({host:address,port:f.port,path:'/health',headers:{host:'127.0.0.1:'+f.port},timeout:3000},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});
   req.on('timeout',()=>{req.destroy();resolve('unreachable')});req.on('error',error=>resolve('unreachable: '+error.code));req.end();
  });
  if(typeof remote==='string')return t.skip('the non-loopback address '+address+' is not reachable here ('+remote+')');
  assert.equal(remote,404);
 }finally{await f.close()}
});
