import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {createRecoveryControlClient} from './recovery-control.mjs';

const wait=async check=>{for(let i=0;i<300;i++){const v=await check().catch(()=>null);if(v)return v;await new Promise(r=>setTimeout(r,25));}throw Error('Timed out');};
async function fixture(t,{mode='verify',prepareWorker,stopDelay=0}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'recovery-control-'));
 const launcher=path.join(root,'launcher.mjs'),review=path.join(root,'review.mjs'),worker=path.join(root,'worker.mjs');
 await fs.writeFile(review,`import http from 'node:http';import fs from 'node:fs';import {createRecoveryControlClient} from ${JSON.stringify(new URL('./recovery-control.mjs',import.meta.url).href)};const client=createRecoveryControlClient();const server=http.createServer(async(req,res)=>{try{const {action,id}=JSON.parse(await Array.fromAsync(req).then(a=>Buffer.concat(a).toString()));res.end(JSON.stringify(await client[action](id)));}catch(e){res.statusCode=409;res.end(JSON.stringify({error:e.message}));}});server.listen(0,'127.0.0.1',()=>fs.writeFileSync(${JSON.stringify(root+'/port')},String(server.address().port)));`);
 await fs.writeFile(worker,`import fs from 'node:fs';const root=${JSON.stringify(root)};fs.appendFileSync(root+'/starts','1\\n');if(fs.existsSync(root+'/fail')){console.error('RECOVERY_REFUSED invalid-config');process.exit(Number(fs.readFileSync(root+'/fail','utf8')));}process.send({channel:'recovery-worker',version:1,session:process.env.RECOVERY_CONTROL_SESSION,event:'ready'});let timer;process.on('message',m=>{if(m.channel!=='recovery-worker')return;if(m.action==='drain')timer=setTimeout(()=>process.send({...m,event:'drained'}),250);if(m.action==='cancel')clearTimeout(timer);if(m.action==='stop')setTimeout(()=>process.exit(0),${stopDelay});});setInterval(()=>{},1000);`);
 const recovery=prepareWorker?await prepareWorker(root):[process.execPath,worker];
 const lowPriority=process.platform==='linux'?['/usr/bin/ionice','-c','2','-n','7','/usr/bin/nice','-n','19']:[];
 await fs.writeFile(launcher,`import {supervise} from ${JSON.stringify(new URL('./supervisor.mjs',import.meta.url).href)};process.exit(await supervise({dataRoot:${JSON.stringify(root)},mode:${JSON.stringify(mode)},review:[process.execPath,${JSON.stringify(review)}],recovery:${JSON.stringify(recovery)},lowPriority:${JSON.stringify(lowPriority)},stopGraceMs:80,restart:{initialMs:30,maxMs:30,stableMs:1000,crashLoopAfter:2}}));`);
 let child,closed,output='';
 const launch=async()=>{child=spawn(process.execPath,[launcher],{stdio:['ignore','pipe','pipe']});closed=new Promise(r=>child.once('close',r));child.stderr.on('data',b=>output+=b);child.stdout.on('data',b=>output+=b);await wait(()=>fs.readFile(root+'/port','utf8'));};
 await launch();
 const call=async(action,id='apply-1')=>{const port=await fs.readFile(root+'/port','utf8');const response=await fetch('http://127.0.0.1:'+port,{method:'POST',body:JSON.stringify({action,id})});const body=await response.json();if(!response.ok)throw Error(body.error);return body;};
 const starts=async()=>(await fs.readFile(root+'/starts','utf8').catch(()=>'' )).trim().split('\n').filter(Boolean).length;
 const shutdown=async()=>{child.kill();await closed;};
 t.after(async()=>{await shutdown();await fs.rm(root,{recursive:true,force:true});});
 return {root,call,starts,output:()=>output,relaunch:async()=>{await shutdown();await fs.rm(root+'/port',{force:true});await launch();}};
}

test('an unavailable supervisor fails explicitly instead of claiming quiescence',async()=>{
 const client=createRecoveryControlClient({transport:{connected:false}});
 await assert.rejects(client.requestDrain('apply-1'),/unavailable/);
});

test('actual supervisor acknowledges drain asynchronously, refuses early stop and supports cancellation',async t=>{
 const f=await fixture(t);await wait(async()=>await f.starts()===1);
 assert.equal((await f.call('requestDrain')).state,'draining');
 await assert.rejects(f.call('stopAfterDrain'),/not_drained/);
 assert.equal((await f.call('cancel')).state,'cancelled');
 await new Promise(r=>setTimeout(r,350));
 assert.equal((await f.call('status')).state,'cancelled');
 assert.equal(await f.starts(),1);
 assert.equal((await f.call('requestDrain','apply-2')).state,'draining');
 assert.equal((await f.call('wait','apply-2')).state,'ready');
 assert.equal((await f.call('cancel','apply-2')).state,'cancelled');
});

test('settings stop has no forced timeout and restart replaces only Recovery',async t=>{
 const f=await fixture(t,{stopDelay:5200});await wait(async()=>await f.starts()===1);
 await f.call('requestDrain');await f.call('wait');
 assert.equal((await f.call('stopAfterDrain')).state,'stopped');
 const runtime=JSON.parse(await fs.readFile(f.root+'/recovery/runtime-state.json','utf8'));
 assert.equal(runtime.lastExitCode,0);assert.equal(runtime.lastExitSignal,null);
 assert.equal((await f.call('restart')).state,'starting');
 assert.equal((await f.call('wait')).state,'running');
 assert.equal(await f.starts(),2);
 // Same Review child still owns the HTTP listener/client and the old request id.
 assert.equal((await f.call('status')).state,'running');
});

test('a new explicit apply can take over after an abandoned stopped request',async t=>{
 const f=await fixture(t);await wait(async()=>await f.starts()===1);
 await f.call('requestDrain');await f.call('wait');await f.call('stopAfterDrain');
 assert.equal((await f.call('requestDrain','apply-2')).state,'ready');
 await assert.rejects(f.call('restart'),/expired/);
 await f.call('stopAfterDrain','apply-2');await f.call('restart','apply-2');
 assert.equal((await f.call('wait','apply-2')).state,'running');
});

for(const code of [78,1])test('failed apply startup exits '+code+' without retry and a new explicit request can recover',async t=>{
 const f=await fixture(t);await wait(async()=>await f.starts()===1);
 await f.call('requestDrain');await f.call('wait');await f.call('stopAfterDrain');
 await fs.writeFile(f.root+'/fail',String(code));await f.call('restart');
 await wait(async()=>await f.starts()>=2);
 await new Promise(r=>setTimeout(r,200));assert.equal(await f.starts(),2,'failed apply must not crash-loop');
 assert.equal((await f.call('status')).state,'failed','startup exit is a final failure');
 await fs.rm(f.root+'/fail');await f.call('requestDrain','apply-2');await f.call('stopAfterDrain','apply-2');await f.call('restart','apply-2');
 assert.equal((await f.call('wait','apply-2')).state,'running');
});

test('off never starts Recovery through settings apply',async t=>{
 const f=await fixture(t,{mode:'off'});
 assert.equal((await f.call('requestDrain')).state,'off');
 assert.equal((await f.call('stopAfterDrain')).state,'stopped');
 assert.equal((await f.call('restart')).state,'off');
 assert.equal(await f.starts(),0);
});

test('supervisor restart discards pending requests instead of replaying them',async t=>{
 const f=await fixture(t);await wait(async()=>await f.starts()===1);
 const before=await f.call('requestDrain');await f.call('wait');
 await f.relaunch();
 await assert.rejects(f.call('status'),/expired/);
 const after=await f.call('requestDrain','apply-2');
 assert.notEqual(before.session,after.session);
 assert.equal(after.state,'draining');
});

test('actual worker finishes its current case, admits no next case until cancel, and restarts through supervisor',{skip:process.platform!=='linux'?'Requires directory fsync':false},async t=>{
 const requests=[];let release,blocked=false;
 const server=http.createServer(async(req,res)=>{
  requests.push(req.url);res.setHeader('content-type','application/json');
  if(req.url==='/api/v3/movie/1'&&!blocked){blocked=true;await new Promise(r=>release=r);}
  if(req.url==='/api/v3/movie')return res.end('[]');
  if(req.url.startsWith('/api/v3/movie/'))return res.end('{"movieFileId":0}');
  if(req.url.startsWith('/api/v3/queue'))return res.end('{"records":[]}');
  res.statusCode=500;res.end('{}');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise(r=>{release?.();server.close(r);}));
 const base='http://127.0.0.1:'+server.address().port;
 const f=await fixture(t,{prepareWorker:async root=>{
  const data=path.join(root,'recovery');await fs.mkdir(data);
  const database=path.join(root,'synthetic.sqlite'),db=new DatabaseSync(database);
  db.exec('CREATE TABLE filejsondb (json_data TEXT); CREATE TABLE jobsjsondb (json_data TEXT)');db.close();
  const cfg=JSON.parse(await fs.readFile(new URL('../examples/recovery-config.example.json',import.meta.url),'utf8'));
  Object.assign(cfg,{radarrUrl:base,tdarrUrl:base,radarrApiKey:'synthetic',database,mediaRoot:root+'/media/movies',reviewRoot:root+'/review',quarantineRoot:root+'/quarantine',reports:root+'/reports',ffmpeg:root+'/ffmpeg',pollSeconds:300});delete cfg.enabled;
  await fs.mkdir(root+'/media/movies',{recursive:true});
  await fs.writeFile(data+'/config.json',JSON.stringify(cfg));
  await fs.writeFile(data+'/state.json',JSON.stringify({version:1,jobs:{},cases:{first:{id:'first',movieId:1,status:'waiting_replacement'},second:{id:'second',movieId:2,status:'waiting_replacement'}}}));
  return [process.execPath,new URL('../recovery/worker.mjs',import.meta.url).pathname];
 }});
 await wait(async()=>blocked);
 assert.equal((await f.call('requestDrain')).state,'draining');
 await new Promise(r=>setTimeout(r,100));
 assert.equal((await f.call('status')).state,'draining','current operation remains pending');
 release();
 assert.equal((await f.call('wait')).state,'ready');
 assert.equal(requests.includes('/api/v3/movie/2'),false,'the next case must not start');
 assert.equal((await f.call('cancel')).state,'cancelled');
 await wait(async()=>requests.includes('/api/v3/movie/2'));
 await f.call('requestDrain','apply-2');await f.call('wait','apply-2');
 assert.equal((await f.call('stopAfterDrain','apply-2')).state,'stopped');
 await f.call('restart','apply-2');
 assert.equal((await f.call('wait','apply-2')).state,'running');
});
