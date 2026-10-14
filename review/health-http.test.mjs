import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {defaults} from './config.mjs';
import {hash} from './core.mjs';
import {checkHealth} from './healthcheck.mjs';

async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-health-http-')),data=path.join(root,'data');
 let child;
 const mock=http.createServer((req,res)=>res.end('{}'));
 const close=async()=>{
  if(child&&child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill();await ended}
  await new Promise(resolve=>mock.close(resolve));await fs.rm(root,{recursive:true,force:true});
 };
 try{
  await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
  const reservation=http.createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const base='http://127.0.0.1:'+port,token='synthetic-health-session';
  await fs.mkdir(path.join(data,'transactions'),{recursive:true});await fs.mkdir(path.join(data,'recovery'));
  // Container-style paths on the same Windows drive are used only within this fixture.
  const containerPath=file=>file.replace(/\\/g,'/').replace(/^[A-Za-z]:/,'');
  await fs.writeFile(path.join(data,'settings.json'),JSON.stringify(defaults({PUBLIC_ORIGIN:base,TDARR_URL:'http://127.0.0.1:'+mock.address().port,MEDIA_ROOT:containerPath(path.join(root,'media','movies')),REVIEW_ROOT:containerPath(path.join(root,'review')),TDARR_DB:containerPath(path.join(root,'synthetic.db')),FFPROBE:containerPath(path.join(root,'unused-probe')),FFMPEG:containerPath(path.join(root,'unused-decoder'))})));
  await fs.writeFile(path.join(data,'state.json'),JSON.stringify({items:{},history:[],sessions:{[hash(token)]:Date.now()+60000},pauses:[]}));
  await fs.writeFile(path.join(data,'preview-settings.json'),JSON.stringify({enabled:false}));
  // An unresolved synthetic transaction prevents scans and durable writes on all platforms.
  await fs.writeFile(path.join(data,'transactions','synthetic.json'),JSON.stringify({id:'synthetic',phase:'installed'}));
  let diagnostics='';
  child=spawn(process.execPath,[fileURLToPath(new URL('./server.mjs',import.meta.url))],{cwd:root,env:{...process.env,DATA_ROOT:data,PORT:String(port)},stdio:['ignore','pipe','pipe']});
  child.stderr.on('data',chunk=>{diagnostics+=chunk});
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Server did not start: '+diagnostics)),10000);
   child.stdout.on('data',chunk=>{if(String(chunk).includes('Tdarr Review listening')){clearTimeout(timer);resolve()}});
   child.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code+': '+diagnostics))});
  });
  const get=(route,headers={})=>new Promise((resolve,reject)=>{
   const request=http.get(base+route,{headers,timeout:4000},res=>{
    let text='';res.setEncoding('utf8');res.on('data',chunk=>{text+=chunk});res.on('end',()=>resolve({status:res.statusCode,text}));
   });
   request.on('timeout',()=>request.destroy(Error('Fixture HTTP timeout')));request.on('error',reject);
  });
  return {data,root,get,cookie:'review_session='+token,close};
 }catch(error){await close();throw error}
}

const runtime={version:1,mode:'repair',state:'refused',restarts:0,lastExitCode:78,lastExitSignal:null,lastStartedAt:null,lastExitedAt:'2026-10-14T12:00:00.000Z',updated:'2026-10-14T12:00:00.000Z',reason:'missing-config'};
test('real health endpoint reports Recovery runtime problems without changing container health', {timeout:20000},async()=>{
 const f=await fixture(),file=path.join(f.data,'recovery','runtime-state.json');
 try{
  const missing=await f.get('/health');assert.equal(missing.status,200);
  assert.deepEqual(JSON.parse(missing.text).recoveryRuntime,{present:false,mode:'off',state:'off',reason:null});
  assert.deepEqual(JSON.parse(missing.text).attention,['pending-transaction']);
  assert.equal((await f.get('/health',{host:'forbidden.invalid'})).status,403,'Host check applies before health');
  for(const [value,attention,state,reason] of [[runtime,'recovery-refused','refused','missing-config'],[{...runtime,state:'running',restarts:5,reason:'crash-loop'},'recovery-crash-loop','running','crash-loop'],['{broken','recovery-runtime-unreadable','unreadable',null]]){
   await fs.writeFile(file,typeof value==='string'?value:JSON.stringify(value));
   const res=await f.get('/health'),summary=JSON.parse(res.text);assert.equal(res.status,200);
   assert.deepEqual(summary.attention,['pending-transaction',attention]);
   assert.equal(summary.recoveryRuntime.state,state);assert.equal(summary.recoveryRuntime.reason,reason);
   const check=await checkHealth(f.get);assert.equal(check.ok,true);assert.ok(check.line.includes(attention));
  }
 }finally{await f.close()}
});

test('authenticated runtime diagnostics remain available when the Recovery case file cannot be read', {timeout:20000},async()=>{
 const f=await fixture();
 try{
  await fs.writeFile(path.join(f.data,'recovery','runtime-state.json'),JSON.stringify(runtime));
  await fs.mkdir(path.join(f.root,'media'));await fs.writeFile(path.join(f.root,'media','.tdarr-recovery-status.json'),'{broken');
  assert.equal((await f.get('/api/recovery/runtime')).status,401,'runtime diagnostics require authentication');
  const headers={cookie:f.cookie};assert.equal((await f.get('/api/radarr/requests',headers)).status,500,'case failure remains an error');
  const res=await f.get('/api/recovery/runtime',headers);assert.equal(res.status,200);
  assert.deepEqual(JSON.parse(res.text),{present:true,...runtime});
 }finally{await f.close()}
});
