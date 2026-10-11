import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {identity,bindHistory} from './policy.mjs';
import {fp} from './waiting-source.mjs';
import {DEFERRED_HOLD_UNTIL} from './replacement-gate.mjs';

// Exercise the actual journal/worker wiring, using only disposable files,
// loopback APIs and a synthetic decoder. No production media or API contacts.
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'recovery-worker-')),data=root+'/data',media=root+'/media/movies',relative='Fixture/new.mkv',source=media+'/'+relative,file='/media/movies/'+relative;
 for(const dir of [data,path.dirname(source),root+'/review',root+'/quarantine',root+'/reports/fixture',root+'/decoder'])await fs.mkdir(dir,{recursive:true});
 await fs.writeFile(source,'DISPOSABLE SOURCE BYTES');const before=await fs.stat(source),sourceFP=fp(before),size=before.size;
 const cfg={enabled:true,libraryId:'fixture-library',sourceRoot:'/media/movies',mediaRoot:media,radarrRoot:'/radarr/movies',reviewRoot:root+'/review',reviewPrefixes:[],quarantineRoot:root+'/quarantine',database:root+'/db.sqlite',reports:root+'/reports',ffmpeg:root+'/decoder/ffmpeg',stableMinutes:0,decodeTimeoutHours:1,confirmDelaySeconds:0,maxRepairsPerDay:3,movieCooldownDays:30,pollSeconds:300,detectTerminalHeaders:false,since:0,approvedImportRepairs:{}};
 const movie={id:1,monitored:true,movieFileId:11,movieFile:{id:11,path:cfg.radarrRoot+'/'+relative,size,sceneName:'Fixture.New.Release'}};
 const history=[{id:21,eventType:'downloadFolderImported',movieId:1,downloadId:'fixture-download',sourceTitle:movie.movieFile.sceneName,data:{fileId:'11',importedPath:movie.movieFile.path,size:String(size)}},{id:22,eventType:'grabbed',movieId:1,downloadId:'fixture-download',sourceTitle:movie.movieFile.sceneName,data:{publishedDate:'2026-10-11T00:00:00Z',indexer:'Fixture',size:String(size),protocol:'1'}}];
 const parent={id:'a'.repeat(24),status:'manual',movieId:1,mutationStarted:Date.now()-1000,binding:{movieFileId:10,sourceTitle:'Fixture.Old.Release'},replacement:{movieFileId:11},replacementRelative:relative,replacementSourceFP:sourceFP,quarantine:root+'/quarantine/old.mkv',message:'Preserved historical quarantine'};
 await fs.writeFile(parent.quarantine,'PRESERVED PARENT');
 const state={version:1,jobs:{},cases:{[parent.id]:parent}};
 const db=new DatabaseSync(cfg.database);db.exec('CREATE TABLE jobsjsondb (json_data TEXT); CREATE TABLE filejsondb (json_data TEXT)');
 const row={_id:file,DB:cfg.libraryId,TranscodeDecisionMaker:'Transcode error'};
 db.prepare('INSERT INTO filejsondb VALUES (?)').run(JSON.stringify(row));
 db.prepare('INSERT INTO jobsjsondb VALUES (?)').run(JSON.stringify({_id:'fixture-job',DB:cfg.libraryId,file,start:Date.now()-2000,end:Date.now()-1000,status:'Transcode error',job:{footprintId:'fixture',fileId:'report'}}));
 await fs.writeFile(root+'/reports/fixture/report','quant_step_size larger than huff_lsbs');
 await fs.writeFile(root+'/decoder/ffprobe','#!/usr/bin/env node\nconsole.log(JSON.stringify({format:{duration:"100"}}));\n',{mode:0o755});
 await fs.writeFile(cfg.ffmpeg,'#!/usr/bin/env node\nconst fs=require("node:fs"),a=process.argv.slice(2);if(a.filter((v,i)=>a[i-1]==="-threads").join()!=="2,2"||!a.includes("0:a?"))process.exit(99);fs.appendFileSync(process.env.DATA_ROOT+"/decode-calls","1\\n");console.log("out_time_us=50000000\\nspeed=2x\\nprogress=end");console.error("quant_step_size larger than huff_lsbs");process.exit(1);\n',{mode:0o755});
 // Run these synthetic decoder scripts through Node, including in containers
 // whose temporary filesystem is noexec. Only exact fixture paths are wrapped.
 const preload=root+'/decoder/preload.cjs';await fs.writeFile(preload,'const cp=require("node:child_process"),path=require("node:path"),original=cp.spawn;cp.spawn=(exe,args,opts)=>[path.join(__dirname,"ffmpeg"),path.join(__dirname,"ffprobe")].includes(exe)?original(process.execPath,[exe,...args],opts):original(exe,args,opts);require("node:module").syncBuiltinESMExports();\n');
 const requests=[];let forbidden=false;
 const server=http.createServer(async(req,res)=>{try{
  let raw='';for await(const b of req)raw+=b;const body=raw?JSON.parse(raw).data:undefined;requests.push({method:req.method,url:req.url,body});res.setHeader('content-type','application/json');
  const reply=v=>res.end(JSON.stringify(v));
  if(req.method==='GET'&&req.url==='/api/v3/movie')return reply([movie]);
  if(req.method==='GET'&&req.url==='/api/v3/movie/1')return reply(movie);
  if(req.method==='GET'&&req.url==='/api/v3/history/movie?movieId=1')return reply(history);
  if(req.method==='GET'&&req.url==='/api/v2/get-nodes')return reply({});
  if(req.method==='POST'&&req.url==='/api/v2/cruddb'&&body.mode==='getById')return reply(row);
  if(req.method==='POST'&&req.url==='/api/v2/bulk-update-files'){Object.assign(row,body.updatedObj);db.prepare('UPDATE filejsondb SET json_data=?').run(JSON.stringify(row));res.setHeader('content-type','text/plain');res.end('OK');return;}
  forbidden=true;res.writeHead(500);reply({error:'Unexpected fixture request'});
 }catch(e){forbidden=true;res.writeHead(500);res.end(JSON.stringify({error:e.message}));}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;cfg.radarrUrl=base;cfg.tdarrUrl=base;cfg.radarrApiKey='fixture-only';
 async function write(){db.prepare('UPDATE filejsondb SET json_data=?').run(JSON.stringify(row));await fs.writeFile(data+'/config.json',JSON.stringify(cfg));await fs.writeFile(data+'/state.json',JSON.stringify(state));}
 async function run(){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--require',preload,new URL('./worker.mjs',import.meta.url).pathname,'--once'],{env:{...process.env,DATA_ROOT:data},stdio:['ignore','pipe','pipe']});let output='';const timer=setTimeout(()=>child.kill('SIGKILL'),20000);child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.on('error',reject);child.on('close',(code,signal)=>{clearTimeout(timer);if(code!==0||signal)return reject(Error('Worker fixture failed: '+output));resolve(output)});});}
 async function result(){return {state:JSON.parse(await fs.readFile(data+'/state.json')),public:JSON.parse(await fs.readFile(root+'/media/.tdarr-recovery-status.json'))};}
 async function unchanged(){assert.equal(fp(await fs.stat(source)),sourceFP);assert.equal(await fs.readFile(source,'utf8'),'DISPOSABLE SOURCE BYTES');assert.equal(await fs.readFile(parent.quarantine,'utf8'),'PRESERVED PARENT');assert.equal(forbidden,false,'worker attempted an unexpected download or API mutation');}
 async function cleanup(){db.close();await new Promise(r=>server.close(r));assert(root.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(root).startsWith('recovery-worker-'));await fs.rm(root,{recursive:true,force:true});}
 return {cfg,state,parent,row,requests,file,relative,source,sourceFP,size,data,write,run,result,unchanged,cleanup,id:identity(file,sourceFP),binding:bindHistory(movie,history,movie.movieFile.path,size),setDecoder:script=>fs.writeFile(cfg.ffmpeg,script,{mode:0o755})};
}

test('actual worker confirms a bad replacement during cooldown, holds it and never downloads or repeats its decode',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture();try{
  const parent=structuredClone(f.parent);await f.write();await f.run();let result=await f.result(),c=result.state.cases[f.id];
  assert.equal(result.state.lastError,null);assert.equal(c.status,'deferred_cooldown');assert.equal(c.evidence.checks.length,2);assert.equal(c.evidence.sourceFP,f.sourceFP);assert.equal(f.row.TranscodeDecisionMaker,'Hold');assert.equal(f.row.holdUntil,DEFERRED_HOLD_UNTIL);
  assert.deepEqual(result.state.cases[f.parent.id],parent);assert.equal(await fs.readFile(f.data+'/decode-calls','utf8'),'1\n1\n');assert.equal(f.requests.filter(r=>r.url==='/api/v2/bulk-update-files').length,1);
  const publicCase=result.public.cases.find(c=>c.id===f.id);assert.equal(publicCase.sourceRetained,true);assert.ok(publicCase.nextRetryAt);assert(!JSON.stringify(publicCase).includes(f.source));
  await f.run();result=await f.result();assert.equal(result.state.cases[f.id].status,'deferred_cooldown');assert.equal(await fs.readFile(f.data+'/decode-calls','utf8'),'1\n1\n');assert.equal(f.requests.filter(r=>r.url==='/api/v2/bulk-update-files').length,1);await f.unchanged();
 }finally{await f.cleanup();}
});

test('actual worker reconciles an already active replacement handoff without resetting Tdarr',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture();try{
  f.state.jobs['fixture-job']='superseded';f.row.TranscodeDecisionMaker='Transcoding';
  f.state.cases[f.parent.id]={...f.parent,status:'replacement_queue_intent',replacement:{movieFileId:11,path:f.cfg.radarrRoot+'/'+f.relative,size:f.size},replacementRelative:f.relative,replacementSourceFP:f.sourceFP};
  await f.write();await f.run();const result=await f.result(),c=result.state.cases[f.parent.id];assert.equal(result.state.lastError,null);assert.equal(c.status,'replacement_imported');assert.equal(c.handoffStatus,'Transcoding');assert.equal(f.row.TranscodeDecisionMaker,'Transcoding');
  assert.equal(f.requests.filter(r=>r.method!=='GET'&&r.url!=='/api/v2/cruddb').length,0);assert.equal(result.public.cases.find(c=>c.id===f.parent.id).tdarrStatus,'Transcoding');await assert.rejects(fs.stat(f.data+'/decode-calls'),{code:'ENOENT'});await f.unchanged();
 }finally{await f.cleanup();}
});

test('a disappeared Radarr handoff identity becomes manual without replaying any queue write',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture();try{
  f.state.jobs['fixture-job']='superseded';f.state.cases[f.parent.id]={...f.parent,status:'replacement_queue_intent',replacement:{movieFileId:99},replacementRelative:f.relative,replacementSourceFP:f.sourceFP};
  await f.write();await f.run();const result=await f.result();assert.equal(result.state.cases[f.parent.id].status,'manual');assert.match(result.state.cases[f.parent.id].message,/identity disappeared/);assert.equal(f.requests.filter(r=>r.method!=='GET').length,0);await f.unchanged();
 }finally{await f.cleanup();}
});

test('an older handoff cannot release a newer confirmed faulty-source Hold',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture();try{
  f.state.jobs['fixture-job']='superseded';f.row.TranscodeDecisionMaker='Hold';f.row.holdUntil=DEFERRED_HOLD_UNTIL;
  f.state.cases[f.parent.id]={...f.parent,status:'replacement_queue_intent'};
  const signature='quant_step_size larger than huff_lsbs',sampleSHA256=crypto.createHash('sha256').update('DISPOSABLE SOURCE BYTES'.repeat(3)).digest('hex'),retryAt=new Date(f.parent.mutationStarted+30*86400000).toISOString();
  f.state.cases[f.id]={id:f.id,status:'deferred_cooldown',movieId:1,file:f.file,relative:f.relative,source:f.source,size:f.size,fp:f.sourceFP,binding:f.binding,skipCurrentEdition:true,preservedSourceFP:f.sourceFP,
   evidence:{sourceFP:f.sourceFP,sampleSHA256,signature,confirmed:new Date(Date.now()-1000).toISOString(),checks:[{code:0,stderr:signature},{code:0,stderr:signature}]},
   deferredCooldown:{version:1,file:f.file,source:f.source,size:f.size,sourceFP:f.sourceFP,sourceRoot:f.cfg.sourceRoot,libraryId:f.cfg.libraryId,binding:f.binding,sampleSHA256,signature,retryAt}};
  await f.write();await f.run();const result=await f.result();assert.equal(result.state.lastError,null);assert.equal(result.state.cases[f.parent.id].status,'replacement_imported');assert.equal(result.state.cases[f.parent.id].handoffStatus,'Hold');assert.equal(result.state.cases[f.id].status,'deferred_cooldown');assert.equal(f.row.holdUntil,DEFERRED_HOLD_UNTIL);
  assert.equal(f.requests.filter(r=>r.method!=='GET'&&r.url!=='/api/v2/cruddb').length,0);await assert.rejects(fs.stat(f.data+'/decode-calls'),{code:'ENOENT'});await f.unchanged();
 }finally{await f.cleanup();}
});

test('a clean decode is a diagnostic completion only for the unchanged source',{skip:process.platform!=='linux'},async()=>{
 for(const changed of [false,true]){
  const f=await fixture();try{
   await f.setDecoder('const fs=require("node:fs"),a=process.argv.slice(2);'+(changed?'fs.writeFileSync(a[a.indexOf("-i")+1],"CHANGED DURING DECODE");':'')+'console.log("out_time_us=100000000\\nprogress=end");process.exit(0);');
   await f.write();await f.run();const result=await f.result(),c=result.state.cases[f.id];
   assert.equal(result.state.lastError,null);assert.equal(c.status,changed?'manual':'no_action');assert.equal(c.originalCheckKind,changed?undefined:'healthy');if(changed)assert.match(c.message,/Source changed/);else await f.unchanged();
   assert.equal(await fs.readFile(f.parent.quarantine,'utf8'),'PRESERVED PARENT');assert.equal(f.requests.filter(r=>r.method!=='GET').length,0,'clean or changed source must not trigger replacement mutations');
  }finally{await f.cleanup();}
 }
});
