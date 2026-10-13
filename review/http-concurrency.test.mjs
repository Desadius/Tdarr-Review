import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {defaults} from './config.mjs';
import {hash,sha256} from './core.mjs';

// The server's configured paths, executable fixtures and durable directory
// fsync require its supported Linux platform. No real media/API is contacted.
const linux={skip:process.platform!=='linux'?'Requires Linux directory fsync and executable fixture semantics':false,timeout:60000};
const serverFile=fileURLToPath(new URL('./server.mjs',import.meta.url));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
async function deadline(promise,label){
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Timed out: '+label)),20000)})])}finally{clearTimeout(timer)}
}

async function fixture({pauses=false,recovery=false}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-http-concurrency-'));
 const data=path.join(root,'data'),media=path.join(root,'media'),review=path.join(root,'review');
 const gates=[],calls=[],changes=[],nodes={fixture:{_id:'fixture',nodeName:'fixture-node',nodePaused:false,workers:{}}};
 let child,cookie,base,diagnostics='';
 function hold(route,predicate=()=>true){
  const entered=deferred(),released=deferred(),gate={route,predicate,entered:entered.promise,release:released.resolve};
  gate.wait=async body=>{if(predicate(body)){entered.resolve(body);await released.promise}};gates.push(gate);return gate;
 }
 const mock=http.createServer(async(req,res)=>{
  try{
   let raw='';for await(const chunk of req)raw+=chunk;
   const input=raw?JSON.parse(raw):null;calls.push({route:req.url,input});
   for(const gate of gates)if(gate.route===req.url)await gate.wait(input);
   let output;
   if(req.url==='/api/v2/get-nodes')output=pauses?{}:nodes;
   else if(req.url==='/api/v2/update-node'){const update=input.data;nodes.fixture.nodePaused=update.nodeUpdates.nodePaused;changes.push(update.nodeUpdates.nodePaused);res.end('OK');return}
   else if(req.url==='/api/v2/rescan-file'){res.end('OK');return}
   else if(req.url==='/api/v3/system/status')output={version:'synthetic'};
   else if(req.url==='/api/v3/movie')output=[{path:'/fixture-library/A'}];
   else if(req.url==='/fixture/probe'){
    const isReview=input.file.startsWith(review+'/');
    output={format:{duration:'60',start_time:'0'},chapters:[],streams:[{index:0,codec_type:'video',codec_name:isReview?'hevc':'h264',pix_fmt:isReview?'yuv420p10le':'yuv420p',width:320,height:180,avg_frame_rate:'24/1'},{index:1,codec_type:'audio',codec_name:'aac',channels:2,tags:{language:'eng'}}]};
   }else if(req.url==='/fixture/render')output={png:'89504e470d0a1a0a'};
   else{res.writeHead(404);res.end('{}');return}
   res.setHeader('content-type','application/json');res.end(JSON.stringify(output));
  }catch(error){res.writeHead(500);res.end(JSON.stringify({error:error.message}))}
 });
 const close=async()=>{
  for(const gate of gates)gate.release();
  if(child&&child.exitCode===null&&child.signalCode===null){const closed=new Promise(resolve=>child.once('close',resolve));child.kill('SIGTERM');await deadline(closed,'server shutdown')}
  await new Promise(resolve=>mock.close(resolve));await fs.rm(root,{recursive:true,force:true});
 };
 try{
  await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
  const mockBase='http://127.0.0.1:'+mock.address().port;
  for(const dir of [data,media,review,path.join(data,'transactions')])await fs.mkdir(dir,{recursive:true});
  const executable=async(name,script)=>{const file=path.join(root,name+'.mjs');await fs.writeFile(file,'#!'+process.execPath+'\n'+script,{mode:0o700});return file};
  const ffprobe=await executable('ffprobe',`const r=await fetch(${JSON.stringify(mockBase+'/fixture/probe')},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({file:process.argv.at(-1)})});if(!r.ok)process.exit(1);process.stdout.write(await r.text());`);
  const ffmpeg=await executable('ffmpeg',`const r=await fetch(${JSON.stringify(mockBase+'/fixture/render')},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({args:process.argv.slice(2)})});if(!r.ok)process.exit(1);process.stdout.write(Buffer.from((await r.json()).png,'hex'));`);
  // Only the two exact synthetic executable paths run through Node. This
  // keeps temporary scripts usable under Docker's noexec /tmp mount without
  // replacing any production decoder, file operation or server behavior.
  const preload=path.join(root,'preload.cjs');
  await fs.writeFile(preload,`const cp=require('node:child_process'),original=cp.spawn;cp.spawn=(exe,args,options)=>${JSON.stringify([ffprobe,ffmpeg])}.includes(exe)?original(process.execPath,[exe,...args],options):original(exe,args,options);require('node:module').syncBuiltinESMExports();`);
  // Reserve an ephemeral loopback port; each suite fixture starts serially.
  const portServer=http.createServer();await new Promise(resolve=>portServer.listen(0,'127.0.0.1',resolve));const port=portServer.address().port;await new Promise(resolve=>portServer.close(resolve));base='http://127.0.0.1:'+port;
  const dbpath=path.join(root,'tdarr.db'),db=new DatabaseSync(dbpath),files=new Map();
  db.exec('CREATE TABLE jobsjsondb (json_data TEXT); CREATE TABLE librarysettingsjsondb (json_data TEXT)');
  db.prepare('INSERT INTO librarysettingsjsondb VALUES (?)').run(JSON.stringify({_id:'fixture-library',folder:'/fixture-library'}));
  for(const title of ['A','B','C']){
   const original=path.join(media,title,title+'.mkv'),result=path.join(review,'PROD-Movies',title,title+'.mkv');
   await fs.mkdir(path.dirname(original),{recursive:true});await fs.mkdir(path.dirname(result),{recursive:true});
   await fs.writeFile(original,Buffer.alloc(128,title.charCodeAt(0)));await fs.writeFile(result,Buffer.alloc(32,title.charCodeAt(0)+32));
   await fs.utimes(result,new Date(Date.now()-300000),new Date(Date.now()-300000));files.set(title,{original,review:result});
   db.prepare('INSERT INTO jobsjsondb VALUES (?)').run(JSON.stringify({_id:'fixture-'+title,DB:'fixture-library',file:'/fixture-library/'+title+'/'+title+'.mkv',status:'Transcode success',end:Date.now(),fileSizeStartGB:128/2**30,fileSizeEndGB:32/2**30}));
  }
  db.close();
  await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({...defaults({MEDIA_ROOT:media,REVIEW_ROOT:review,TDARR_DB:dbpath,TDARR_URL:mockBase,PUBLIC_ORIGIN:base,FFPROBE:ffprobe,FFMPEG:ffmpeg}),sourceRoots:['/fixture-library'],reviewPrefixes:['PROD-Movies'],libraryId:'fixture-library'}));
  await fs.writeFile(path.join(data,'preview-settings.json'),JSON.stringify({enabled:false}));
  if(pauses)await fs.writeFile(path.join(data,'state.json'),JSON.stringify({items:{},history:[],sessions:{},pauses:[{name:'unavailable-node'}]}));
  if(recovery)await fs.writeFile(path.join(data,'transactions/manual.json'),JSON.stringify({id:'manual',phase:'installed'}));
  const ready=deferred();child=spawn(process.execPath,['--require',preload,serverFile],{env:{...process.env,DATA_ROOT:data,PORT:String(port)},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',chunk=>{if(String(chunk).includes('Tdarr Review listening'))ready.resolve()});child.stderr.on('data',chunk=>{diagnostics+=chunk});child.once('exit',code=>ready.resolve({code}));
  assert.equal(await deadline(ready.promise,'server startup'),undefined,diagnostics);
  const key=await fs.readFile(path.join(data,'access-key'),'utf8');
  const login=await fetch(base+'/api/login',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({key})});assert.equal(login.status,200,await login.clone().text());cookie=login.headers.get('set-cookie').split(';')[0];
  const post=(route,body={})=>fetch(base+route,{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify(body)});
  const get=async route=>{const result=await fetch(base+route,{headers:{cookie}});assert.equal(result.status,200,await result.clone().text());return result.json()};
  const items=()=>get('/api/items');
  const confirm=async item=>{
   const route=`/api/items/${item.id}/review-session`;let current=await get(route+'?snapshot='+item.snapshot);
   for(const session of [{...current.session,method:'external',device:'Synthetic player',scope:{originalIndex:1,reviewIndex:1,seconds:null}},{method:'external',device:'Synthetic player',step:4,checks:{preparation:true,image:true,audio:true,syncStart:true,syncMiddle:true,syncEnd:true,hdr:false},scope:{originalIndex:1,reviewIndex:1,seconds:null}}]){
    const result=await post(route,{snapshot:item.snapshot,revision:current.revision,session});assert.equal(result.status,200,await result.clone().text());current=await result.json();
   }
   assert.equal(current.complete,true);item.reviewRevision=current.revision;return current;
  };
  const approve=item=>post(`/api/items/${item.id}/approve`,{snapshot:item.snapshot,reviewRevision:item.reviewRevision});
  const allMutations=(item,session)=>{
   const selection={id:item.id,snapshot:item.snapshot,reviewRevision:item.reviewRevision};
   return [
    ['/api/settings',{}],['/api/settings/test',{}],['/api/radarr/settings',{}],['/api/radarr/settings/test',{}],['/api/preview-settings',{}],['/api/approve-batch',{items:[selection]}],
    ...['approve','reject','replace','recheck'].map(action=>[`/api/items/${item.id}/${action}`,{...selection,reason:'Synthetic rejection'}]),
    [`/api/items/${item.id}/review-session`,{snapshot:item.snapshot,revision:session?.revision||0,session:session?.session||{}}],
    [`/api/radarr/requests/${'f'.repeat(24)}/restore`,{confirm:true}],
    [`/api/items/${item.id}/frames`,{snapshot:item.snapshot,seconds:0}],
    [`/api/items/${item.id}/audio-compare`,{snapshot:item.snapshot,mode:'wave',seconds:0,originalIndex:1,reviewIndex:1}],
   ];
  };
  const journals=()=>fs.readdir(path.join(data,'transactions'));
  const settled=async count=>{
   // Completion is observed through HTTP, never inferred from elapsed delay.
   const stop=Date.now()+20000;
   while(Date.now()<stop){const state=await items();if(!state.active&&!state.batchRunning&&state.history.length===count)return state;await new Promise(resolve=>setTimeout(resolve,20))}
   assert.fail('Mutation did not settle: '+diagnostics);
  };
  const preserved=async()=>{for(const [title,fileset] of files){assert.equal(await sha256(fileset.original),hash(Buffer.alloc(128,title.charCodeAt(0))));assert.equal(await sha256(fileset.review),hash(Buffer.alloc(32,title.charCodeAt(0)+32)))}};
  return {root,data,files,mockBase,hold,calls,changes,post,get,items,confirm,approve,allMutations,journals,settled,preserved,close,diagnostics:()=>diagnostics};
 }catch(error){await close();throw error}
}

for(const different of [false,true])test(`HTTP simultaneous approvals (${different?'different items':'same item'}) start exactly one transaction`,linux,async()=>{
 const f=await fixture();try{
  const list=(await f.items()).items,a=list.find(item=>item.title==='A'),b=list.find(item=>item.title==='B');await f.confirm(a);await f.confirm(b);
  const gate=f.hold('/api/v2/update-node',body=>body.data.nodeUpdates.nodePaused);
  const results=await Promise.all([f.approve(a),f.approve(different?b:a)]);assert.deepEqual(results.map(result=>result.status).sort(),[202,409]);await deadline(gate.entered,'approval dispatch pause');
  assert.deepEqual(await f.journals(),[],'only the winning action reaches its dispatch pause');gate.release();
  const finished=await f.settled(1);assert.equal(finished.history[0].status,'success',JSON.stringify(finished.history));assert.equal((await f.journals()).length,1);assert.deepEqual(f.changes,[true,false]);
  const winner=f.files.get(finished.history[0].title);assert.equal(await sha256(winner.original),hash(Buffer.alloc(32,finished.history[0].title.charCodeAt(0)+32)));await assert.rejects(fs.stat(winner.review),{code:'ENOENT'});
 }finally{await f.close()}
});

test('HTTP every mutating route is excluded during an approval; read-only previews preserve confirmations',linux,async()=>{
 const f=await fixture();try{
  const list=(await f.items()).items,a=list.find(item=>item.title==='A'),b=list.find(item=>item.title==='B');await f.confirm(a);const session=await f.confirm(b);
  const gate=f.hold('/api/v2/update-node',body=>body.data.nodeUpdates.nodePaused);assert.equal((await f.approve(a)).status,202);await deadline(gate.entered,'approval dispatch pause');
  for(const [route,body] of f.allMutations(b,session)){const result=await f.post(route,body);assert.equal(result.status,409,route+' '+await result.clone().text())}
  const readonly=await f.post(`/api/items/${b.id}/frames`,{snapshot:b.snapshot,seconds:0,cachedOnly:true});assert.equal(readonly.status,202);
  const tracks=await f.post(`/api/items/${b.id}/audio-compare`,{snapshot:b.snapshot,mode:'tracks'});assert.equal(tracks.status,200);
  const saved=await f.get(`/api/items/${b.id}/review-session?snapshot=${b.snapshot}`);assert.deepEqual(saved,session,'preview loading cannot record a user confirmation');
  assert.deepEqual(await f.journals(),[]);gate.release();const finished=await f.settled(1);assert.equal(finished.history[0].status,'success');assert.equal((await f.journals()).length,1);
  assert.equal(await sha256(f.files.get('B').original),hash(Buffer.alloc(128,66)));assert.equal(await sha256(f.files.get('B').review),hash(Buffer.alloc(32,98)));
 }finally{await f.close()}
});

for(const route of ['/api/settings','/api/settings/test','/api/radarr/settings','/api/radarr/settings/test'])test(`HTTP approval cannot overlap ${route}`,linux,async()=>{
 const f=await fixture();try{
  const item=(await f.items()).items[0];await f.confirm(item);
  const radarr=route.includes('/radarr/'),settings=radarr?null:await f.get('/api/settings');
  const gate=f.hold(radarr?'/api/v3/system/status':'/api/v2/get-nodes');
  const pending=f.post(route,radarr?{url:f.mockBase,apiKey:'synthetic-test-key',mediaRoot:'/fixture-library',preferCzechEnglish:true}:settings);
  // A request that answers before reaching the gated call failed early; report why instead of timing out.
  await deadline(Promise.race([gate.entered,pending.then(async response=>{throw Error('settings request finished before validation reached Tdarr: '+response.status+' '+await response.clone().text()+' '+f.diagnostics())})]),'settings validation');assert.equal((await f.approve(item)).status,409);assert.equal((await f.post('/api/approve-batch',{items:[item]})).status,409);
  gate.release();const result=await pending;assert.equal(result.status,200,await result.clone().text());assert.deepEqual(await f.journals(),[]);await f.preserved();
 }finally{await f.close()}
});

test('HTTP approval is excluded during interactive preview and its failure releases the reservation',linux,async()=>{
 const f=await fixture();try{
  const item=(await f.items()).items[0];const session=await f.confirm(item),gate=f.hold('/fixture/render');
  const pending=f.post(`/api/items/${item.id}/frames`,{snapshot:item.snapshot,seconds:0});await deadline(gate.entered,'interactive preview renderer');
  assert.equal((await f.approve(item)).status,409);assert.equal((await f.post('/api/preview-settings',{})).status,409);assert.deepEqual(await f.journals(),[]);gate.release();assert.equal((await pending).status,200);
  assert.deepEqual(await f.get(`/api/items/${item.id}/review-session?snapshot=${item.snapshot}`),session);await f.preserved();
  assert.equal((await f.post(`/api/items/${item.id}/frames`,{snapshot:item.snapshot,seconds:-1})).status,400);
  const approvalGate=f.hold('/api/v2/update-node',body=>body.data.nodeUpdates.nodePaused);assert.equal((await f.approve(item)).status,202);await deadline(approvalGate.entered,'approval after failed preview');approvalGate.release();assert.equal((await f.settled(1)).history[0].status,'success');
 }finally{await f.close()}
});

for(const state of ['pauses','recovery'])test(`HTTP ${state} blocks media mutation while safe configuration stays available`,linux,async()=>{
 const f=await fixture({[state]:true});try{
  const item=(await f.items()).items[0];
  for(const action of ['approve','reject','replace','recheck','review-session'])assert.equal((await f.post(`/api/items/${item.id}/${action}`,{snapshot:item.snapshot,reviewRevision:0,reason:'Synthetic reason'})).status,409,action);
  assert.equal((await f.post('/api/approve-batch',{items:[item]})).status,409);assert.equal((await f.post(`/api/radarr/requests/${'f'.repeat(24)}/restore`,{confirm:true})).status,409);
  const settings=await f.get('/api/settings');assert.equal((await f.post('/api/settings/test',settings)).status,409);assert.equal((await f.post('/api/settings',settings)).status,409);
  const cacheSettings=await f.get('/api/preview-settings');assert.equal((await f.post('/api/preview-settings',cacheSettings)).status,200);
  for(const route of ['/api/radarr/settings','/api/radarr/settings/test'])assert.equal((await f.post(route,{url:f.mockBase,apiKey:'synthetic-test-key',mediaRoot:'/fixture-library',preferCzechEnglish:true})).status,200,route);
  assert.equal((await f.post(`/api/items/${item.id}/frames`,{snapshot:item.snapshot,seconds:0})).status,200);
  const remaining=await f.items();assert.equal(remaining.history.length,0);assert.equal(state==='pauses'?remaining.restorePending:remaining.recovery.length,1);assert.equal((await f.journals()).length,state==='recovery'?1:0);await f.preserved();
 }finally{await f.close()}
});

test('HTTP review writes keep revision serialization and exclude approval until the queue drains',linux,async()=>{
 const f=await fixture();try{
  const item=(await f.items()).items[0],session=await f.confirm(item),route=`/api/items/${item.id}/review-session`,gate=f.hold('/fixture/probe');
  const first=f.post(route,{snapshot:item.snapshot,revision:session.revision,session:{...session.session,note:'First explicit draft'}});await deadline(gate.entered,'review verification');
  const second=f.post(route,{snapshot:item.snapshot,revision:session.revision,session:{...session.session,note:'Competing draft'}});
  assert.equal((await f.approve(item)).status,409);gate.release();const result=await Promise.all([first,second]);assert.deepEqual(result.map(value=>value.status),[200,409]);
  const saved=await f.get(route+'?snapshot='+item.snapshot);assert.equal(saved.revision,session.revision+1);assert.equal(saved.session.note,'First explicit draft');assert.equal(saved.complete,true);assert.deepEqual(await f.journals(),[]);await f.preserved();
 }finally{await f.close()}
});

test('HTTP an in-flight node resume excludes settings and previews as well as approval',linux,async()=>{
 const f=await fixture({pauses:true});try{
  const item=(await f.items()).items[0],gate=f.hold('/api/v2/get-nodes'),pending=f.items();await deadline(gate.entered,'node resume');
  for(const [route,body] of f.allMutations(item))assert.equal((await f.post(route,body)).status,409,route);
  gate.release();assert.equal((await pending).restorePending,1);assert.deepEqual(await f.journals(),[]);await f.preserved();
 }finally{await f.close()}
});

test('HTTP settings and recheck cannot mutate while a fresh scan is running',linux,async()=>{
 const f=await fixture();try{
  const gate=f.hold('/fixture/probe'),pending=f.items();await deadline(gate.entered,'fresh scan probe');
  for(const route of ['/api/settings','/api/settings/test','/api/radarr/settings','/api/radarr/settings/test','/api/preview-settings',`/api/items/${'a'.repeat(24)}/recheck`])assert.equal((await f.post(route,{})).status,409,route);
  // Reject deliberately joins the scan, then its stale-snapshot preflight fails.
  const id=hash('PROD-Movies/A/A.mkv').slice(0,24),first=f.post(`/api/items/${id}/reject`,{snapshot:'stale',reason:'Synthetic reason'});
  gate.release();await pending;assert.equal((await first).status,409);
  assert.deepEqual(await f.journals(),[]);await f.preserved();
  const item=(await f.items()).items.find(value=>value.id===id);await f.confirm(item);const approval=f.hold('/api/v2/update-node',body=>body.data.nodeUpdates.nodePaused);assert.equal((await f.approve(item)).status,202);await deadline(approval.entered,'approval after preflight conflict');approval.release();assert.equal((await f.settled(1)).history[0].status,'success');
 }finally{await f.close()}
});

test('HTTP approval owns an asynchronous scan preflight before a transaction starts',linux,async()=>{
 const f=await fixture();try{
  const list=(await f.items()).items,a=list.find(item=>item.title==='A'),b=list.find(item=>item.title==='B');await f.confirm(a);const session=await f.confirm(b);
  // Introduce a new synthetic film so the approval's forced scan must probe
  // metadata. Existing A/B approval evidence remains bound to unchanged files.
  const original=path.join(f.root,'media/D/D.mkv'),review=path.join(f.root,'review/PROD-Movies/D/D.mkv');
  await fs.mkdir(path.dirname(original),{recursive:true});await fs.mkdir(path.dirname(review),{recursive:true});await fs.writeFile(original,Buffer.alloc(128,68));await fs.writeFile(review,Buffer.alloc(32,100));await fs.utimes(review,new Date(Date.now()-300000),new Date(Date.now()-300000));
  const db=new DatabaseSync(path.join(f.root,'tdarr.db'));db.prepare('INSERT INTO jobsjsondb VALUES (?)').run(JSON.stringify({_id:'fixture-D',DB:'fixture-library',file:'/fixture-library/D/D.mkv',status:'Transcode success',end:Date.now(),fileSizeStartGB:128/2**30,fileSizeEndGB:32/2**30}));db.close();
  const scanGate=f.hold('/fixture/probe',input=>input.file.endsWith('/D.mkv')),pauseGate=f.hold('/api/v2/update-node',body=>body.data.nodeUpdates.nodePaused),pending=f.approve(a);
  await deadline(scanGate.entered,'approval scan preflight');
  for(const [route,body] of f.allMutations(b,session))assert.equal((await f.post(route,body)).status,409,route);
  assert.deepEqual(await f.journals(),[]);scanGate.release();assert.equal((await pending).status,202);await deadline(pauseGate.entered,'approval after scan');pauseGate.release();assert.equal((await f.settled(1)).history[0].status,'success');assert.equal((await f.journals()).length,1);
 }finally{await f.close()}
});

test('HTTP a node kept paused during an approval is not resumed afterwards',linux,async()=>{
 const f=await fixture();try{
  const a=(await f.items()).items.find(item=>item.title==='A');await f.confirm(a);
  const gate=f.hold('/api/v2/rescan-file');assert.equal((await f.approve(a)).status,202);await deadline(gate.entered,'post-exchange rescan');
  const during=await f.items();assert.equal(during.restorePending,1);assert.deepEqual(during.pendingRestores.map(n=>[n.name,n.title]),[['fixture-node','A']]);assert.ok(Number.isFinite(Date.parse(during.pendingRestores[0].pausedAt)));
  const kept=await f.post('/api/node-restores/keep',{name:'fixture-node',confirm:true});assert.equal(kept.status,200,await kept.clone().text());assert.deepEqual((await kept.json()).pendingRestores,[]);
  gate.release();const finished=await f.settled(1);assert.equal(finished.history[0].status,'success',JSON.stringify(finished.history));
  assert.deepEqual(f.changes,[true],'Review paused the node and never resumed it');assert.equal(finished.restorePending,0);assert.deepEqual(finished.pendingRestores,[]);
 }finally{await f.close()}
});

test('HTTP a pending node restore can be kept paused only with confirmation and only for a recorded node',linux,async()=>{
 const f=await fixture({pauses:true});try{
  const before=await f.items();assert.equal(before.restorePending,1);assert.deepEqual(before.pendingRestores,[{name:'unavailable-node',pausedAt:null,title:null}]);
  const unconfirmed=await f.post('/api/node-restores/keep',{name:'unavailable-node'});assert.equal(unconfirmed.status,400);assert.equal((await unconfirmed.json()).code,'node_keep_confirm_required');
  const unknown=await f.post('/api/node-restores/keep',{name:'other-node',confirm:true});assert.equal(unknown.status,409);assert.equal((await unknown.json()).code,'node_restore_unknown');
  const kept=await f.post('/api/node-restores/keep',{name:'unavailable-node',confirm:true});assert.equal(kept.status,200,await kept.clone().text());
  const after=await f.items();assert.equal(after.restorePending,0);assert.deepEqual(after.pendingRestores,[]);
  assert.ok(!f.calls.some(call=>call.route==='/api/v2/update-node'),'keeping a node paused never contacts Tdarr');
 }finally{await f.close()}
});
