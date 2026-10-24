import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {caseId,bindHistory} from './policy.mjs';
import {identityOf} from './file-identity.mjs';
import {HOLD_FOREVER as DEFERRED_HOLD_UNTIL} from './tdarr-file-state.mjs';
import {createSharedSettingsStore} from '../review/shared-settings.mjs';
import {createWorker} from './create-worker.mjs';
import {readRecoveryConfiguration} from './recovery-authority.mjs';
import {loadApprovalRegistry} from './approval-registry.mjs';
import {writeRecoveryRestoreEvidence} from './restore-evidence.mjs';

// Exercise the actual journal/worker wiring, using only disposable files,
// loopback APIs and a synthetic decoder. No production media or API contacts.
async function fixture({terminalHeader=false,mode='repair',largeSource=false,sourceBytesOverride=null}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'recovery-worker-')),data=root+'/data',media=root+'/media/movies',relative='Fixture/new.mkv',source=media+'/'+relative,file='/media/movies/'+relative;
 for(const dir of [data,path.dirname(source),root+'/review',root+'/quarantine',root+'/reports/fixture',root+'/decoder'])await fs.mkdir(dir,{recursive:true});
 const sourceBytes=sourceBytesOverride??(largeSource?Buffer.alloc(5*1024*1024,7):(terminalHeader?'\x1b[0m':'')+'DISPOSABLE SOURCE BYTES');await fs.writeFile(source,sourceBytes);const before=await fs.stat(source),sourceFP=identityOf(before),size=before.size;
 const cfg={libraryId:'fixture-library',sourceRoot:'/media/movies',mediaRoot:media,radarrRoot:'/radarr/movies',reviewRoot:root+'/review',reviewPrefixes:[],quarantineRoot:root+'/quarantine',database:root+'/db.sqlite',reports:root+'/reports',ffmpeg:root+'/decoder/ffmpeg',stableMinutes:0,decodeTimeoutHours:1,confirmDelaySeconds:0,maxRepairsPerDay:3,movieCooldownDays:30,pollSeconds:300,detectTerminalHeaders:false,since:0,approvedImportRepairs:{}};
 const movie={id:1,monitored:true,movieFileId:11,movieFile:{id:11,path:cfg.radarrRoot+'/'+relative,size,sceneName:'Fixture.New.Release'}};
 const history=[{id:21,eventType:'downloadFolderImported',movieId:1,downloadId:'fixture-download',sourceTitle:movie.movieFile.sceneName,data:{fileId:'11',importedPath:movie.movieFile.path,size:String(size)}},{id:22,eventType:'grabbed',movieId:1,downloadId:'fixture-download',sourceTitle:movie.movieFile.sceneName,data:{publishedDate:'2026-10-11T00:00:00Z',indexer:'Fixture',size:String(size),protocol:'1'}}];
 const parent={id:'a'.repeat(24),status:'manual',movieId:1,mutationStarted:Date.now()-1000,binding:{movieFileId:10,sourceTitle:'Fixture.Old.Release'},replacement:{movieFileId:11},replacementRelative:relative,replacementSourceFP:sourceFP,quarantine:root+'/quarantine/old.mkv',message:'Preserved historical quarantine'};
 await fs.writeFile(parent.quarantine,'PRESERVED PARENT');
 const state={version:1,jobs:{},cases:{[parent.id]:parent}};
 const db=new DatabaseSync(cfg.database);db.exec('CREATE TABLE jobsjsondb (json_data TEXT); CREATE TABLE filejsondb (json_data TEXT)');
 const row={_id:file,DB:cfg.libraryId,TranscodeDecisionMaker:'Transcode error'},job={_id:'fixture-job',DB:cfg.libraryId,file,start:Date.now()-2000,end:Date.now()-1000,status:'Transcode error',job:{footprintId:'fixture',fileId:'report'}};
 db.prepare('INSERT INTO filejsondb VALUES (?)').run(JSON.stringify(row));
 db.prepare('INSERT INTO jobsjsondb VALUES (?)').run(JSON.stringify(job));
 await fs.writeFile(root+'/reports/fixture/report','quant_step_size larger than huff_lsbs');
 await fs.writeFile(root+'/decoder/ffprobe','#!/usr/bin/env node\nconsole.log(JSON.stringify({format:{duration:"100"}}));\n',{mode:0o755});
 await fs.writeFile(cfg.ffmpeg,'#!/usr/bin/env node\nconst fs=require("node:fs"),a=process.argv.slice(2);if(a.filter((v,i)=>a[i-1]==="-threads").join()!=="2,2"||!a.includes("0:a?"))process.exit(99);fs.appendFileSync(process.env.DATA_ROOT+"/decode-calls","1\\n");console.log("out_time_us=50000000\\nspeed=2x\\nprogress=end");console.error("quant_step_size larger than huff_lsbs");process.exit(1);\n',{mode:0o755});
 // Run these synthetic decoder scripts through Node, including in containers
 // whose temporary filesystem is noexec. Only exact fixture paths are wrapped.
 const preload=root+'/decoder/preload.cjs';await fs.writeFile(preload,'const cp=require("node:child_process"),path=require("node:path"),original=cp.spawn;cp.spawn=(exe,args,opts)=>[path.join(__dirname,"ffmpeg"),path.join(__dirname,"ffprobe")].includes(exe)?original(process.execPath,[exe,...args],opts):original(exe,args,opts);require("node:module").syncBuiltinESMExports();\n');
 const requests=[];let forbidden=false,allowRepair=false,releaseBlocked=false,beforeHold=null,ignoreHold=false;const commands=new Map();
 const server=http.createServer(async(req,res)=>{try{
  let raw='';for await(const b of req)raw+=b;const parsed=raw?JSON.parse(raw):undefined,body=req.url.startsWith('/api/v2/')?parsed?.data:parsed;requests.push({method:req.method,url:req.url,body});res.setHeader('content-type','application/json');
  const reply=v=>res.end(JSON.stringify(v));
  if(req.method==='GET'&&req.url==='/api/v3/movie')return reply([movie]);
  if(req.method==='GET'&&req.url==='/api/v3/movie/1')return reply(movie);
  if(req.method==='GET'&&req.url==='/api/v3/history/movie?movieId=1')return reply(history);
  if(req.method==='GET'&&req.url==='/api/v2/get-nodes')return reply({});
  if(req.method==='POST'&&req.url==='/api/v2/cruddb'&&body.mode==='getById')return reply(row);
  if(req.method==='POST'&&req.url==='/api/v2/bulk-update-files'){if(beforeHold)await beforeHold();if(!ignoreHold)Object.assign(row,body.updatedObj);db.prepare('UPDATE filejsondb SET json_data=?').run(JSON.stringify(row));res.setHeader('content-type','text/plain');res.end('OK');return;}
  if(allowRepair){
   if(req.method==='POST'&&req.url==='/api/v3/command'){
    assert.ok(['RescanMovie','MoviesSearch'].includes(body.name));if(body.name==='RescanMovie'){movie.movieFileId=0;delete movie.movieFile;}
    const command={id:100+commands.size,name:body.name,body,status:'completed',queued:new Date().toISOString()};commands.set(command.id,command);return reply(command);
   }
   if(req.method==='GET'&&req.url==='/api/v3/command')return reply([...commands.values()]);
   if(req.method==='GET'&&req.url==='/api/v3/queue?pageSize=1000')return reply({records:[]});
   if(req.method==='GET'&&/^\/api\/v3\/command\/\d+$/.test(req.url))return reply(commands.get(Number(req.url.split('/').at(-1))));
   if(req.method==='GET'&&req.url==='/api/v3/blocklist/movie?movieId=1')return reply(releaseBlocked?[{sourceTitle:'Fixture.New.Release',indexer:'Fixture',protocol:'usenet',size}]:[]);
   if(req.method==='POST'&&req.url==='/api/v3/history/failed/22'){releaseBlocked=true;return reply({});}
  }
  forbidden=true;res.writeHead(500);reply({error:'Unexpected fixture request'});
 }catch(e){forbidden=true;res.writeHead(500);res.end(JSON.stringify({error:e.message}));}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;cfg.radarrUrl=base;cfg.tdarrUrl=base;cfg.radarrApiKey='fixture-only';
 async function write(){db.prepare('UPDATE filejsondb SET json_data=?').run(JSON.stringify(row));await fs.writeFile(data+'/config.json',JSON.stringify(cfg));await fs.writeFile(data+'/state.json',JSON.stringify(state));}
 async function setLibrary(value){cfg.libraryId=value;row.DB=value;job.DB=value;db.prepare('UPDATE filejsondb SET json_data=?').run(JSON.stringify(row));db.prepare('UPDATE jobsjsondb SET json_data=?').run(JSON.stringify(job));await fs.writeFile(data+'/config.json',JSON.stringify(cfg));}
 async function run(){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--require',preload,new URL('./worker.mjs',import.meta.url).pathname,'--once'],{env:{...process.env,DATA_ROOT:data,RECOVERY_MODE:mode},stdio:['ignore','pipe','pipe']});let output='';const timer=setTimeout(()=>child.kill('SIGKILL'),20000);child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.on('error',reject);child.on('close',(code,signal)=>{clearTimeout(timer);if(code!==0||signal)return reject(Error('Worker fixture failed: '+output));resolve(output)});});}
 // Long-running worker as in the container: no --once, stopped only by a signal.
 function daemon(){const child=spawn(process.execPath,['--require',preload,new URL('./worker.mjs',import.meta.url).pathname],{env:{...process.env,DATA_ROOT:data,RECOVERY_MODE:mode},stdio:['ignore','pipe','pipe']});let output='';const timer=setTimeout(()=>child.kill('SIGKILL'),20000);child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);const closed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,output})});});return {child,closed};}
 async function result(){assert.equal((await fs.stat(root+'/media/.tdarr-recovery-status.json')).mode&0o777,0o644);assert.equal((await fs.stat(data+'/state.json')).mode&0o777,0o600);return {state:JSON.parse(await fs.readFile(data+'/state.json')),public:JSON.parse(await fs.readFile(root+'/media/.tdarr-recovery-status.json'))};}
 async function unchanged(){assert.equal(identityOf(await fs.stat(source)),sourceFP);assert.deepEqual(await fs.readFile(source),Buffer.from(sourceBytes));assert.equal(await fs.readFile(parent.quarantine,'utf8'),'PRESERVED PARENT');assert.equal(forbidden,false,'worker attempted an unexpected download or API mutation');}
 async function cleanup(){db.close();await new Promise(r=>server.close(r));assert(root.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(root).startsWith('recovery-worker-'));await fs.rm(root,{recursive:true,force:true});}
 return {root,cfg,state,parent,movie,row,requests,file,relative,source,sourceFP,size,sourceBytes,data,write,setLibrary,run,daemon,result,unchanged,cleanup,id:caseId(file,sourceFP),binding:bindHistory(movie,history,movie.movieFile.path,size),allowRepair:()=>{allowRepair=true;},ignoreHold:()=>{ignoreHold=true;},onHold:callback=>{beforeHold=callback;},setDecoder:script=>fs.writeFile(cfg.ffmpeg,script,{mode:0o755})};
}

test('actual worker loads committed shared authority without a legacy worker config file',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture({mode:'verify'});try{
  await f.write();f.state.jobs['fixture-job']='manual: fixture';await f.write();
  await fs.mkdir(path.join(f.root,'recovery'));await fs.writeFile(path.join(f.root,'recovery/config.json'),JSON.stringify(f.cfg));
  const store=createSharedSettingsStore({data:f.root,env:{RECOVERY_MODE:'verify'}}),current=await store.current();await store.applyGeneration({revision:current.revision});
  await fs.unlink(path.join(f.data,'config.json'));
  const output=await f.run();assert.match(output,/Tdarr recovery started; mode=verify/);assert.equal(f.requests.filter(r=>r.method!=='GET').length,0);await f.unchanged();
 }finally{await f.cleanup();}
});

test('actual worker refuses a Review restore fence before reading Recovery state or contacting APIs',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture({mode:'repair'});try{
  await f.write();const stateBefore=await fs.readFile(path.join(f.data,'state.json'),'utf8');
  await fs.writeFile(path.join(f.root,'recovery-restore-fence.json'),JSON.stringify({version:1,kind:'recovery-original-restore',operationId:'00000000-0000-4000-8000-000000000001',caseId:'c'.repeat(24),blocking:true}));
  await assert.rejects(f.run(),/RECOVERY_REFUSED recovery-restore-pending/);
  assert.deepEqual(f.requests,[],'no Radarr or Tdarr API is contacted before the startup fence check');
  assert.equal(await fs.readFile(path.join(f.data,'state.json'),'utf8'),stateBefore,'Recovery private state is not loaded or changed');
 }finally{await f.cleanup();}
});

test('actual worker skips the exact Review-restored edition in both candidate admission paths',{skip:process.platform!=='linux'},async()=>{
 for(const terminalHeader of [true,false]){
  const f=await fixture({terminalHeader});try{
   f.cfg.detectTerminalHeaders=terminalHeader;
   await f.write();
   await writeRecoveryRestoreEvidence({data:f.data,operationId:'00000000-0000-4000-8000-000000000001',caseId:'b'.repeat(24),movieId:1,tmdbId:9001,file:f.file,identity:f.sourceFP,cfg:f.cfg,restoredAt:new Date().toISOString()});
   f.cfg.radarrApiKey='rotated-fixture-key';await fs.writeFile(path.join(f.data,'config.json'),JSON.stringify(f.cfg));
   await f.run();
   const result=await f.result();
   assert.equal(result.state.cases[f.id],undefined,terminalHeader?'terminal-header scan must skip the exact restored edition':'Tdarr error-job scan must skip the exact restored edition');
   assert.equal(f.requests.filter(r=>r.method!=='GET').length,0,'the matching edition must not trigger any API mutation');
   await assert.rejects(fs.stat(path.join(f.data,'decode-calls')),{code:'ENOENT'},'the matching edition must not be decoded again');
   await f.unchanged();
  }finally{await f.cleanup();}
 }
});

test('a different configured library does not inherit exact restored-edition suppression',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture({terminalHeader:true,mode:'verify'});try{
  f.cfg.detectTerminalHeaders=true;await f.write();
  await writeRecoveryRestoreEvidence({data:f.data,operationId:'00000000-0000-4000-8000-000000000002',caseId:'c'.repeat(24),movieId:1,tmdbId:9001,file:f.file,identity:f.sourceFP,cfg:f.cfg,restoredAt:new Date().toISOString()});
  await f.setLibrary('another-library');await f.run();
  const result=await f.result();assert.equal(result.state.cases[f.id]?.status,'dry_run','a changed library binding does not inherit an old edition record');
  assert.equal(f.requests.filter(r=>r.method!=='GET').length,0);await f.unchanged();
 }finally{await f.cleanup();}
});

test('a malformed present restored-edition record blocks candidate mutation instead of looking absent',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture({terminalHeader:true});try{
  f.cfg.detectTerminalHeaders=true;await f.write();const file=path.join(f.data,'recovery-restores','editions',f.id+'.json');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'{not-json');
  await f.run();const result=await f.result();assert.equal(result.state.cases[f.id],undefined);assert.match(result.state.jobs['fixture-job'],/manual: restore-evidence-invalid/);
  assert.equal(f.requests.filter(r=>r.method!=='GET').length,0);await f.unchanged();
 }finally{await f.cleanup();}
});

test('actual worker retries an old unrecognized XLL report, links its exact parent and preserves cooldown',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture();try{
  f.state.jobs['fixture-job']='not_confirmed_decode_error_v2';Object.assign(f.parent,{status:'replacement_imported',replacement:{movieFileId:11,size:f.size}});
  await fs.writeFile(path.join(f.data,'../reports/fixture/report'),'[dca] Read past end of XLL band data');
  await f.setDecoder((await fs.readFile(f.cfg.ffmpeg,'utf8')).replace('quant_step_size larger than huff_lsbs','Read past end of XLL band data'));
  const parent=structuredClone(f.parent);await f.write();await f.run();let result=await f.result();
  assert.equal(result.state.cases[f.id].status,'deferred_cooldown');assert.equal(result.state.jobs['fixture-job'],f.id);assert.deepEqual(result.state.cases[f.parent.id],parent);
  const published=result.public.cases.find(c=>c.id===f.parent.id);assert.equal(published.replacementFollowupId,f.id);assert.equal(published.replacementFollowup.phase,'deferred_cooldown');assert.equal(published.replacementFollowup.sourceRetained,true);assert.ok(published.replacementFollowup.nextRetryAt);
  assert.equal(await fs.readFile(f.data+'/decode-calls','utf8'),'1\n1\n');await f.run();result=await f.result();assert.equal(result.state.cases[f.id].status,'deferred_cooldown');assert.equal(await fs.readFile(f.data+'/decode-calls','utf8'),'1\n1\n');await f.unchanged();
 }finally{await f.cleanup();}
});

test('XLL in a job report cannot authorize repairs when the unchanged original decodes cleanly',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture();try{
  f.state.jobs['fixture-job']='not_confirmed_decode_error_v2';await fs.writeFile(path.join(f.data,'../reports/fixture/report'),'Read past end of XLL band data');await f.setDecoder('console.log("frame=2500\\nout_time_us=100000000\\nprogress=end");process.exit(0);');
  await f.write();await f.run();const result=await f.result();assert.equal(result.state.cases[f.id].status,'no_action');assert.equal(result.state.cases[f.id].originalCheckKind,'healthy');assert.equal(f.requests.filter(r=>r.method!=='GET').length,0);await f.unchanged();
 }finally{await f.cleanup();}
});
test('a changed historical ctime affects display linkage only; fresh original evidence still controls the repair',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture();try{
  Object.assign(f.parent,{status:'replacement_imported',replacement:{movieFileId:11,size:f.size}});
  const old=f.parent.replacementSourceFP.split(':');old[4]=String(Number(old[4])+1);f.parent.replacementSourceFP=old.join(':');const parent=structuredClone(f.parent);
  await f.write();await f.run();const result=await f.result(),c=result.state.cases[f.id],p=result.public.cases.find(c=>c.id===f.parent.id);
  assert.equal(c.status,'deferred_cooldown');assert.equal(c.evidence.sourceFP,f.sourceFP);assert.equal(c.fp,f.sourceFP);assert.equal(c.evidence.checks.length,2);assert.deepEqual(result.state.cases[f.parent.id],parent);
  assert.equal(p.replacementFollowupId,f.id);assert.equal(p.replacementFollowupBinding,'ctime_changed');assert.equal(p.replacementFollowup.phase,'deferred_cooldown');await f.unchanged();
 }finally{await f.cleanup();}
});

test('unrecognized old reports are reconsidered once, without reopening manual cursors',{skip:process.platform!=='linux'},async()=>{
 for(const cursor of ['not_confirmed_decode_error_v2','manual: operator review']){
  const f=await fixture();try{
   f.state.jobs['fixture-job']=cursor;await fs.writeFile(path.join(f.data,'../reports/fixture/report'),'Conversion failed!');await f.write();await f.run();let result=await f.result();assert.equal(result.state.jobs['fixture-job'],cursor.startsWith('manual:')?cursor:'not_confirmed_decode_error_v5');
   await fs.writeFile(path.join(f.data,'../reports/fixture/report'),'Read past end of XLL band data');await f.run();result=await f.result();assert.equal(result.state.cases[f.id],undefined);await assert.rejects(fs.stat(f.data+'/decode-calls'),{code:'ENOENT'});await f.unchanged();
  }finally{await f.cleanup();}
 }
});

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
   await f.setDecoder('const fs=require("node:fs"),a=process.argv.slice(2);'+(changed?'fs.writeFileSync(a[a.indexOf("-i")+1],"CHANGED DURING DECODE");':'')+'console.log("frame=2500\\nout_time_us=100000000\\nprogress=end");process.exit(0);');
   await f.write();await f.run();const result=await f.result(),c=result.state.cases[f.id];
   assert.equal(result.state.lastError,null);assert.equal(c.status,changed?'manual':'no_action');assert.equal(c.originalCheckKind,changed?undefined:'healthy');if(changed)assert.match(c.message,/Source changed/);else await f.unchanged();
   assert.equal(await fs.readFile(f.parent.quarantine,'utf8'),'PRESERVED PARENT');assert.equal(f.requests.filter(r=>r.method!=='GET').length,0,'clean or changed source must not trigger replacement mutations');
  }finally{await f.cleanup();}
 }
});

test('job-based quota deferral resumes after capacity clears with only the original two decodes',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture();try{
  f.parent.movieId=2;f.cfg.maxRepairsPerDay=1;await f.write();await f.run();let result=await f.result(),c=result.state.cases[f.id];
  assert.equal(result.state.lastError,null);assert.equal(c.status,'deferred_limit');assert.ok(c.deferredLimit);assert.ok(c.nextRetryAt);assert.equal(f.row.holdUntil,DEFERRED_HOLD_UNTIL);assert.equal(await fs.readFile(f.data+'/decode-calls','utf8'),'1\n1\n');
  await f.run();result=await f.result();assert.equal(result.state.cases[f.id].status,'deferred_limit');assert.equal(await fs.readFile(f.data+'/decode-calls','utf8'),'1\n1\n');assert.equal(f.requests.filter(r=>r.url==='/api/v2/bulk-update-files').length,1);await f.unchanged();
  result.state.cases[f.parent.id].mutationStarted=Date.now()-86400001;await fs.writeFile(f.data+'/state.json',JSON.stringify(result.state));f.allowRepair();await f.run();result=await f.result();c=result.state.cases[f.id];
  assert.equal(result.state.lastError,null);assert.equal(c.status,'waiting_replacement');assert.equal(await fs.readFile(f.data+'/decode-calls','utf8'),'1\n1\n');assert.equal(await fs.readFile(c.quarantine,'utf8'),f.sourceBytes);await assert.rejects(fs.stat(f.source),{code:'ENOENT'});assert.equal(await fs.readFile(f.parent.quarantine,'utf8'),'PRESERVED PARENT');
  assert.equal(f.requests.filter(r=>r.url==='/api/v3/command'&&r.method==='POST'&&r.body.name==='MoviesSearch').length,1);
 }finally{await f.cleanup();}
});

test('a terminal-header quota case is held without repeating full decoding on later scans',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture({terminalHeader:true});try{
  f.parent.movieId=2;f.cfg.maxRepairsPerDay=1;f.cfg.detectTerminalHeaders=true;await f.write();await f.run();let result=await f.result();assert.equal(result.state.cases[f.id].status,'deferred_limit');assert.equal(result.state.cases[f.id].headerDamage,true);
  await f.run();result=await f.result();assert.equal(result.state.lastError,null);assert.equal(result.state.cases[f.id].status,'deferred_limit');assert.equal(await fs.readFile(f.data+'/decode-calls','utf8'),'1\n1\n');assert.equal(f.requests.filter(r=>r.url==='/api/v2/bulk-update-files').length,1);await f.unchanged();
 }finally{await f.cleanup();}
});

test('missing or malformed persistent approval authority stops the actual worker before any API',{skip:process.platform!=='linux'},async()=>{
 for(const malformed of [false,true]){
  const f=await fixture();try{
   if(malformed)await fs.writeFile(f.data+'/pending-approvals.json',JSON.stringify({version:99,config:{},cases:[]}),{mode:0o600});
   else f.parent.approval={id:f.parent.id,authorization:'Not authorization from a registry'};
   await f.write();const stateBefore=await fs.readFile(f.data+'/state.json');await assert.rejects(f.run(),/Recovery approval registry[^\n]*\nRECOVERY_REFUSED registry-refused\s*$/);assert.equal(f.requests.length,0);assert.deepEqual(await fs.readFile(f.data+'/state.json'),stateBefore);await assert.rejects(fs.stat(f.data+'/decode-calls'),{code:'ENOENT'});await f.unchanged();
  }finally{await f.cleanup();}
 }
});

async function until(check,ms=10000){const end=Date.now()+ms;while(!await check()){if(Date.now()>end)throw Error('Timed out waiting for the worker');await new Promise(r=>setTimeout(r,25));}}

test('SIGTERM ends an idle worker promptly with exit code 0 and an intact journal',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture();try{
  f.state.jobs['fixture-job']='manual: operator review';await f.write();
  const worker=f.daemon();
  // The first completed cycle stamps the journal; the worker then waits pollSeconds (300 s).
  await until(async()=>JSON.parse(await fs.readFile(f.data+'/state.json','utf8')).updated);
  const signalled=Date.now();worker.child.kill('SIGTERM');const exit=await worker.closed;
  assert.equal(exit.signal,null,exit.output);assert.equal(exit.code,0,exit.output);assert.ok(Date.now()-signalled<5000,'worker kept waiting after SIGTERM');
  assert.match(exit.output,/SIGTERM received; stopping after the current step/);assert.match(exit.output,/Recovery stopped/);
  const result=await f.result();assert.deepEqual(Object.keys(result.state.cases),[f.parent.id]);assert.equal(result.state.cases[f.parent.id].status,'manual');assert.equal(result.state.jobs['fixture-job'],'manual: operator review');
  await assert.rejects(fs.stat(f.data+'/decode-calls'),{code:'ENOENT'});await f.unchanged();
 }finally{await f.cleanup();}
});

test('SIGTERM during an original decode finishes the step instead of leaving an interrupted case',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture();try{
  f.state.jobs['fixture-job']='not_confirmed_decode_error_v2';Object.assign(f.parent,{status:'replacement_imported',replacement:{movieFileId:11,size:f.size}});
  await fs.writeFile(path.join(f.data,'../reports/fixture/report'),'[dca] Read past end of XLL band data');
  await f.setDecoder((await fs.readFile(f.cfg.ffmpeg,'utf8')).replace('quant_step_size larger than huff_lsbs','Read past end of XLL band data').replace('console.log("out_time_us','Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);console.log("out_time_us'));
  await f.write();const worker=f.daemon();
  await until(async()=>(await fs.readFile(f.data+'/decode-calls','utf8').catch(()=>''))==='1\n');
  worker.child.kill('SIGTERM');const exit=await worker.closed;
  assert.equal(exit.signal,null,exit.output);assert.equal(exit.code,0,exit.output);
  assert.equal(await fs.readFile(f.data+'/decode-calls','utf8'),'1\n1\n');
  const result=await f.result();assert.equal(result.state.cases[f.id].status,'deferred_cooldown');assert.doesNotMatch(result.state.cases[f.id].message,/Interrupted/);await f.unchanged();
 }finally{await f.cleanup();}
});

// Observe real hash-child launches after the worker publishes its initial
// progress. The optional stat shim hides only the fixture's mtime/ctime so the
// regression isolates full hashing from the independent fingerprint defense.
async function observeHashes(f,{preserveTimes=false}={}){
 const preload=path.join(f.root,'decoder/preload.cjs'),stat=await fs.stat(f.source);
 await fs.appendFile(preload,`
 const fs=require('node:fs'),fsp=require('node:fs/promises'),spawnHash=cp.spawn;
 cp.spawn=(exe,args,opts)=>{
  if(args.some(arg=>arg.endsWith('/recovery/full-hash.mjs'))){
   const status=JSON.parse(fs.readFileSync(${JSON.stringify(path.join(f.root,'media/.tdarr-recovery-status.json'))},'utf8'));
   fs.appendFileSync(${JSON.stringify(path.join(f.data,'hash-status.jsonl'))},JSON.stringify(status)+String.fromCharCode(10));
  }
  return spawnHash(exe,args,opts);
 };
 ${preserveTimes?`const realStat=fsp.stat;fsp.stat=async(file,...args)=>{const value=await realStat(file,...args);if(file===${JSON.stringify(f.source)})Object.assign(value,{mtimeMs:${stat.mtimeMs},ctimeMs:${stat.ctimeMs}});return value};`:''}
 require('node:module').syncBuiltinESMExports();
 `);
 return async()=> (await fs.readFile(path.join(f.data,'hash-status.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
}

test('optional full-file hash is taken at confirmation and matched before the quarantine rename',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture();try{
  const snapshots=await observeHashes(f);
  f.parent.movieId=2;f.cfg.maxRepairsPerDay=1;f.cfg.fullSourceHash=true;await f.write();await f.run();let result=await f.result(),c=result.state.cases[f.id];
  const expected=crypto.createHash('sha256').update(f.sourceBytes).digest('hex');
  assert.equal(result.state.lastError,null);assert.equal(c.status,'deferred_limit');assert.equal(c.evidence.fullSHA256,expected);assert.equal(c.fullHash,undefined,'progress is cleared after the hash');
  result.state.cases[f.parent.id].mutationStarted=Date.now()-86400001;await fs.writeFile(f.data+'/state.json',JSON.stringify(result.state));f.allowRepair();await f.run();result=await f.result();c=result.state.cases[f.id];
  assert.equal(result.state.lastError,null);assert.equal(c.status,'waiting_replacement');assert.equal(await fs.readFile(c.quarantine,'utf8'),f.sourceBytes);assert.equal(c.evidence.fullSHA256,expected);
  const progress=(await snapshots()).map(snapshot=>snapshot.cases.find(c=>c.id===f.id).fullHash);
  assert.ok(progress.every(Boolean),'running worker publishes full-hash progress');
  assert.deepEqual(progress.map(p=>({stage:p.stage,done:p.done,total:p.total})),[
   {stage:'confirmation',done:0,total:f.size},{stage:'before_quarantine',done:0,total:f.size}
  ]);
  for(const p of progress)assert.ok(Number.isFinite(Date.parse(p.started)),'public hash progress has a start timestamp');
  assert.equal(result.public.cases.find(c=>c.id===f.id).fullHash,null,'public progress clears on completion');
 }finally{await f.cleanup();}
});

test('a full-file hash detects changed bytes outside sampled regions before any new mutation',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture({largeSource:true});try{
  const snapshots=await observeHashes(f,{preserveTimes:true});
  f.parent.movieId=2;f.cfg.maxRepairsPerDay=1;f.cfg.fullSourceHash=true;await f.write();await f.run();let result=await f.result();
  const confirmed=result.state.cases[f.id].evidence.fullSHA256;
  assert.equal(confirmed,crypto.createHash('sha256').update(f.sourceBytes).digest('hex'));
  const changed=Buffer.from(f.sourceBytes);changed[1024*1024+17]^=1;
  // 5 MiB fixture samples cover [0,1), [2,3), [4,5) MiB. The changed byte is in [1,2).
  for(const start of [0,2*1024*1024,4*1024*1024])assert.deepEqual(changed.subarray(start,start+1024*1024),f.sourceBytes.subarray(start,start+1024*1024));
  await fs.writeFile(f.source,changed);
  result.state.cases[f.parent.id].mutationStarted=Date.now()-86400001;
  await fs.writeFile(f.data+'/state.json',JSON.stringify(result.state));f.allowRepair();const before=f.requests.length;await f.run();result=await f.result();const c=result.state.cases[f.id];
  assert.match(JSON.stringify(c)+String(result.state.lastError),/Full source hash changed before quarantine/);
  assert.equal(c.evidence.fullSHA256,confirmed,'confirmation evidence is not rewritten');
  assert.equal(c.quarantine,undefined);assert.deepEqual(await fs.readFile(f.source),changed);
  assert.equal(await fs.readFile(f.parent.quarantine,'utf8'),'PRESERVED PARENT');
  assert.deepEqual(f.requests.slice(before).filter(r=>r.method!=='GET'&&!(r.url==='/api/v2/cruddb'&&r.body.mode==='getById')),[],'no Tdarr or Radarr mutation after changed full hash');
  assert.deepEqual((await snapshots()).map(s=>s.cases.find(c=>c.id===f.id).fullHash.stage),['confirmation','before_quarantine']);
 }finally{await f.cleanup();}
});

for(const guard of ['fingerprint','sample'])test(`worker rechecks ${guard} after hashing and immediately before the quarantine rename`,{skip:process.platform!=='linux'},async()=>{
 const f=await fixture({largeSource:true});try{
  await observeHashes(f,{preserveTimes:guard==='sample'});
  f.parent.movieId=2;f.cfg.fullSourceHash=true;f.allowRepair();
  const changed=Buffer.from(f.sourceBytes);changed[guard==='sample'?17:1024*1024+17]^=1;
  // The Hold acknowledgment is after both real full hashes. Change the source
  // before the worker's final identity/sample check and rename, without sleeps.
  f.onHold(()=>fs.writeFile(f.source,changed));
  await f.write();await f.run();const result=await f.result(),c=result.state.cases[f.id];
  assert.match(JSON.stringify(c)+String(result.state.lastError),/Source changed before quarantine/);
  assert.equal(c.evidence.fullSHA256,crypto.createHash('sha256').update(f.sourceBytes).digest('hex'));
  assert.equal(c.quarantine,undefined);assert.deepEqual(await fs.readFile(f.source),changed);
  assert.equal(await fs.readFile(f.parent.quarantine,'utf8'),'PRESERVED PARENT');
  assert.equal(f.requests.filter(r=>r.url==='/api/v3/command'&&r.method==='POST').length,0,'no Radarr mutation follows final identity refusal');
 }finally{await f.cleanup();}
});

test('verify mode reaches only the confirmation phase and changes nothing outside Recovery',{skip:process.platform!=='linux'},async()=>{
 for(const enabled of [undefined,false]){
  const f=await fixture({mode:'verify'});try{
   // No cooldown parent: in repair mode this case would quarantine the original at once.
   f.parent.movieId=2;if(enabled!==undefined)f.cfg.enabled=enabled;f.allowRepair();await f.write();const output=await f.run();const result=await f.result(),c=result.state.cases[f.id];
   assert.match(output,/Tdarr recovery started; mode=verify/);assert.equal(result.state.lastError,null);
   assert.equal(c.status,'dry_run');assert.equal(c.evidence.checks.length,2);assert.equal(await fs.readFile(f.data+'/decode-calls','utf8'),'1\n1\n');
   assert.equal(f.row.TranscodeDecisionMaker,'Transcode error');assert.deepEqual(f.requests.filter(r=>r.method!=='GET'),[],'verify mode must not hold, blocklist or search');
   assert.equal(c.quarantine,undefined);await f.unchanged();
  }finally{await f.cleanup();}
 }
});

test('repair mode with a matching enabled key repairs like the enabled worker',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture({mode:'repair'});try{
  f.parent.movieId=2;f.cfg.enabled=true;f.allowRepair();await f.write();const output=await f.run();const result=await f.result(),c=result.state.cases[f.id];
  assert.match(output,/Tdarr recovery started; mode=repair/);assert.equal(result.state.lastError,null);
  assert.equal(c.status,'waiting_replacement');assert.equal(await fs.readFile(c.quarantine,'utf8'),f.sourceBytes);await assert.rejects(fs.stat(f.source),{code:'ENOENT'});
  assert.ok(Date.parse(c.originalOutsideSince)>=c.mutationStarted,'new quarantine records the actual original removal time');
  assert.equal(result.public.cases.find(x=>x.id===c.id).originalOutsideSince,c.originalOutsideSince);
  assert.equal(f.requests.filter(r=>r.url==='/api/v3/history/failed/22').length,1);assert.equal(f.requests.filter(r=>r.method==='POST'&&r.body?.name==='MoviesSearch').length,1);
 }finally{await f.cleanup();}
});

test('the actual worker refuses an enabled key that conflicts with its mode before any API',{skip:process.platform!=='linux'},async()=>{
 for(const [mode,enabled] of [['verify',true],['repair',false]]){
  const f=await fixture({mode});try{
   f.cfg.enabled=enabled;await f.write();const stateBefore=await fs.readFile(f.data+'/state.json');
   await assert.rejects(f.run(),/RECOVERY_REFUSED mode-conflict\s*$/);assert.deepEqual(f.requests,[]);assert.deepEqual(await fs.readFile(f.data+'/state.json'),stateBefore);
   await assert.rejects(fs.stat(f.data+'/decode-calls'),{code:'ENOENT'});await f.unchanged();
  }finally{await f.cleanup();}
 }
});

test('the running worker reports a config.json edit whose enabled conflicts with its mode as invalid',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture({mode:'repair'});try{
  f.state.jobs['fixture-job']='manual: operator review';f.cfg.pollSeconds=1;await f.write();
  const worker=f.daemon(),status=async()=>JSON.parse(await fs.readFile(path.join(f.data,'../media/.tdarr-recovery-status.json'),'utf8').catch(()=>'{}'));
  // The first completed cycle publishes the shared status with no pending config change.
  await until(async()=>(await status()).updated);
  assert.equal((await status()).configChange,null);
  await fs.writeFile(f.data+'/config.json',JSON.stringify({...f.cfg,enabled:false}));
  await until(async()=>(await status()).configChange);
  const change=(await status()).configChange;assert.equal(change.restartRequired,true);assert.equal(change.valid,false);assert.match(change.error,/disagrees with RECOVERY_MODE/);
  worker.child.kill('SIGTERM');const exit=await worker.closed;assert.equal(exit.code,0,exit.output);assert.match(exit.output,/restart the worker to apply it after fixing it/);
  assert.deepEqual(f.requests.filter(r=>r.method!=='GET'),[]);await f.unchanged();
 }finally{await f.cleanup();}
});

test('the running worker reports a config.json edit with an unusable value as invalid without echoing it',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture({mode:'verify'});try{
  f.state.jobs['fixture-job']='manual: operator review';f.cfg.pollSeconds=1;await f.write();
  const worker=f.daemon(),status=async()=>JSON.parse(await fs.readFile(path.join(f.data,'../media/.tdarr-recovery-status.json'),'utf8').catch(()=>'{}'));
  await until(async()=>(await status()).updated);
  assert.equal((await status()).configChange,null);
  await fs.writeFile(f.data+'/config.json',JSON.stringify({...f.cfg,stableMinutes:'SECRET-ten'}));
  await until(async()=>(await status()).configChange);
  const change=(await status()).configChange;assert.equal(change.valid,false);assert.match(change.error,/\(stableMinutes must be a number of 0 or more\)$/);
  worker.child.kill('SIGTERM');const exit=await worker.closed;assert.equal(exit.code,0,exit.output);
  assert.doesNotMatch(exit.output+JSON.stringify(change),/SECRET/);
  assert.deepEqual(f.requests.filter(r=>r.method!=='GET'),[]);await f.unchanged();
 }finally{await f.cleanup();}
});

// Paths, types, sizes and content digests of every entry below root.
async function snapshot(root){
 const tree={};
 async function walk(dir){for(const name of (await fs.readdir(dir)).sort()){const p=path.join(dir,name),key=path.relative(root,p).split(path.sep).join('/'),s=await fs.lstat(p);
  if(s.isDirectory()){tree[key+'/']='directory';await walk(p);}
  else if(s.isSymbolicLink())tree[key]='symlink -> '+await fs.readlink(p);
  else if(s.isFile()){const bytes=await fs.readFile(p);tree[key]={size:s.size,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};}
  else tree[key]='special';}}
 await walk(root);return tree;
}

// Recovery and Review share one container and UID (ADR 0001), so no read-only
// mount keeps Recovery out of Review's data any more. This comparison does.
test('a complete repair case writes nothing in the review-results root or in Review\'s other data',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture({mode:'repair'});try{
  const rel=p=>path.relative(f.root,p).split(path.sep).join('/'),results=f.cfg.reviewRoot,reviewData=path.join(f.root,'review-data'),approvals=path.join(path.dirname(f.cfg.mediaRoot),'.tdarr-approvals');
  // With a prefix the worker looks for a review result of the case's own film.
  f.cfg.reviewPrefixes=['Reviewed'];
  for(const [file,bytes] of [[results+'/Reviewed/Other Film/other.mkv','REVIEWED TRANSCODE'],[results+'/Reviewed/Other Film/other.json','{"decision":"approved"}'],[reviewData+'/settings.json','{"language":"en"}'],[reviewData+'/review.sqlite','REVIEW DATABASE'],[reviewData+'/journal/approval.json','{"phase":"done"}']]){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,bytes);}
  await fs.mkdir(results+'/Reviewed/Fixture',{recursive:true});await fs.mkdir(approvals);
  const snapshotReview=async()=>({results:await snapshot(results),reviewData:await snapshot(reviewData),approvals:await snapshot(approvals)});
  // Everything else a scan changes must be Recovery's data root, the shared status file,
  // the original-language cache, quarantine or the repaired film itself.
  // The Tdarr database stands in for Tdarr; only the loopback mock writes it.
  const allowedFiles=[path.join(path.dirname(f.cfg.mediaRoot),'.tdarr-recovery-status.json'),path.join(f.cfg.mediaRoot,'.tdarr-original-languages.json'),f.source,f.cfg.database].map(rel),allowedTrees=[f.data,f.cfg.quarantineRoot].map(p=>rel(p)+'/');
  const outside=[],touched=new Set();
  async function scan(){const before=await snapshot(f.root);await f.run();const after=await snapshot(f.root);
   for(const k of new Set([...Object.keys(before),...Object.keys(after)]))if(JSON.stringify(before[k])!==JSON.stringify(after[k])){touched.add(k);if(!allowedFiles.includes(k)&&!allowedTrees.some(t=>k.startsWith(t)))outside.push(k);}
   return f.result();}
  // No cooldown parent, so the first scan confirms the original, quarantines it and requests a replacement.
  f.parent.movieId=2;f.allowRepair();await f.write();const reviewBefore=await snapshotReview();
  let result=await scan(),c=result.state.cases[f.id];
  assert.equal(result.state.lastError,null);assert.equal(c.status,'waiting_replacement');assert.equal(await fs.readFile(c.quarantine,'utf8'),f.sourceBytes);
  // Radarr imports a replacement at the same path; the next scan hands it to Tdarr.
  await fs.writeFile(f.source,'DISPOSABLE REPLACEMENT BYTES');const installed=await fs.stat(f.source);
  Object.assign(f.movie,{movieFileId:12,movieFile:{id:12,path:f.cfg.radarrRoot+'/'+f.relative,size:installed.size,sceneName:'Fixture.Replacement.Release'}});
  result=await scan();c=result.state.cases[f.id];
  assert.equal(result.state.lastError,null);assert.equal(c.status,'replacement_imported');assert.equal(c.handoffStatus,'Queued');assert.equal(f.row.TranscodeDecisionMaker,'Queued');
  // Review approved the replacement more than the retention period ago; the next scan purges the quarantined original.
  const evidence=path.join(approvals,crypto.createHash('sha256').update(c.replacementRelative+'\0'+c.replacementSourceFP).digest('hex')+'.json');
  await fs.writeFile(evidence,JSON.stringify({version:1,relative:c.replacementRelative,sourceFP:c.replacementSourceFP,installedRelative:f.relative,installedFP:identityOf(installed),approvedAt:new Date(Date.now()-8*86400000).toISOString()}));
  const reviewApproved=await snapshotReview();
  result=await scan();c=result.state.cases[f.id];
  assert.equal(result.state.lastError,null);assert.equal(c.retentionError,undefined);assert.equal(c.cleanup?.complete,true);await assert.rejects(fs.stat(c.quarantine),{code:'ENOENT'});
  assert.deepEqual(await snapshotReview(),reviewApproved,'the worker wrote in the review-results root or in Review\'s other data');
  assert.deepEqual({results:reviewApproved.results,reviewData:reviewApproved.reviewData},{results:reviewBefore.results,reviewData:reviewBefore.reviewData},'the worker wrote in the review-results root or in Review\'s other data');
  assert.deepEqual(outside,[]);assert.ok(touched.has(allowedFiles[0])&&[...touched].some(k=>k.startsWith(allowedTrees[1])));
 }finally{await f.cleanup();}
});

const RESIDUAL='[dca @ 0x5581a2c0] Residual encoded channels are present without core';
const MASTER='[matroska,webm @ 0x55d1f00] Element at 0x1a2b3c ending at 0x1a2c00 exceeds containing master element ending at 0x1a2bf0';
const decoder=(stderr,code,extra='')=>'#!/usr/bin/env node\nconst fs=require("node:fs"),a=process.argv.slice(2);'+extra+'fs.appendFileSync(process.env.DATA_ROOT+"/decode-calls","1\\n");console.log("out_time_us=50000000\\nspeed=2x\\nprogress=end");console.error('+JSON.stringify(stderr)+');process.exit('+code+');\n';
async function skippedV3(f,report,script){
 f.state.jobs['fixture-job']='not_confirmed_decode_error_v3';Object.assign(f.parent,{status:'replacement_imported',replacement:{movieFileId:11,size:f.size}});
 await fs.writeFile(path.join(f.data,'../reports/fixture/report'),report);await f.setDecoder(script);await f.write();
}
const decodeCalls=async f=>(await fs.readFile(f.data+'/decode-calls','utf8').catch(()=>'')).split('\n').filter(Boolean).length;

test('actual worker reconsiders a job skipped as v3 once when two original decodes repeat a DTS core error',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture();try{
  await skippedV3(f,'Tdarr health check\n'+RESIDUAL,decoder(RESIDUAL.replace('0x5581a2c0','0x7ffd0010'),183));
  await f.run();let result=await f.result();
  assert.equal(result.state.jobs['fixture-job'],f.id);assert.equal(result.state.cases[f.id].status,'deferred_cooldown',result.state.cases[f.id].message);assert.equal(await decodeCalls(f),2);
  await f.run();result=await f.result();assert.equal(result.state.cases[f.id].status,'deferred_cooldown');assert.equal(await decodeCalls(f),2,'the reconsidered job is not decoded again');await f.unchanged();
 }finally{await f.cleanup();}
});

test('actual worker treats a Matroska structure error with exit 0 as a failure, not as a healthy original',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture();try{
  await skippedV3(f,MASTER,decoder(MASTER,0));await f.run();const result=await f.result();
  assert.equal(result.state.jobs['fixture-job'],f.id);assert.equal(result.state.cases[f.id].status,'deferred_cooldown');assert.notEqual(result.state.cases[f.id].originalCheckKind,'healthy');await f.unchanged();
 }finally{await f.cleanup();}
});

test('actual worker records a still-unrecognized v3 report as v5 and never reconsiders v5 again',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture();try{
  await skippedV3(f,'[matroska @ 0x1] Non-monotonous DTS in output stream 0:1; previous: 5, current: 4; changing to 6.',decoder(RESIDUAL,183));
  await f.run();assert.equal((await f.result()).state.jobs['fixture-job'],'not_confirmed_decode_error_v5');
  await fs.writeFile(path.join(f.data,'../reports/fixture/report'),RESIDUAL);await f.run();const result=await f.result();
  assert.equal(result.state.jobs['fixture-job'],'not_confirmed_decode_error_v5');assert.equal(result.state.cases[f.id],undefined);assert.equal(await decodeCalls(f),0);
  assert.equal(f.requests.filter(r=>r.method!=='GET').length,0);await f.unchanged();
 }finally{await f.cleanup();}
});

test('an operational failure beside a recognized DTS error never authorizes repair',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture();try{
  await skippedV3(f,RESIDUAL,decoder(RESIDUAL+'\nInput/output error',183));await f.run();const result=await f.result(),c=result.state.cases[f.id];
  assert.ok(c,'case');assert.ok(!['deferred_cooldown','waiting_replacement','replacement_imported'].includes(c.status),c.status);assert.equal(c.originalCheckKind,'operational');
  assert.equal(f.requests.filter(r=>r.method!=='GET').length,0);await f.unchanged();
 }finally{await f.cleanup();}
});

test('a source that changes during the original decode is never repaired on the new DTS evidence',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture();try{
  await skippedV3(f,RESIDUAL,decoder(RESIDUAL,183,'const input=a[a.indexOf("-i")+1];fs.appendFileSync(input,"X");'));await f.run();const result=await f.result(),c=result.state.cases[f.id];
  assert.ok(c,'case');assert.equal(c.status,'manual');assert.equal(f.requests.filter(r=>r.method!=='GET').length,0);
 }finally{await f.cleanup();}
});

test('a confirmed DTS failure without an exact Radarr release binding stays manual with its reason',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture();try{
  f.movie.movieFile.sceneName='Fixture.Unmatched.Release';
  await skippedV3(f,RESIDUAL,decoder(RESIDUAL,183));await f.run();const c=(await f.result()).state.cases[f.id];
  assert.ok(c,'case');assert.equal(c.status,'manual');assert.match(c.message,/grabbed release|history|binding/i);
  // The binding failure no longer skips the original check: the damage is confirmed and the reason is exact.
  assert.equal(c.bindingFailure.code,'grab-conflicting');assert.equal(c.evidence.checks.length,2);assert.equal(c.evidence.sourceFP,f.sourceFP);assert.equal(await decodeCalls(f),2);
  const published=(await f.result()).public.cases.find(x=>x.id===f.id);assert.deepEqual([published.bindingFailure,published.sourceConfirmed],['grab-conflicting',true]);
  assert.equal(f.requests.filter(r=>r.method!=='GET').length,0);await f.unchanged();
 }finally{await f.cleanup();}
});

test('a binding failure with a cleanly decoding original records no damage and no binding reason',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture();try{
  f.movie.movieFile.sceneName='Fixture.Unmatched.Release';
  await skippedV3(f,RESIDUAL,'#!/usr/bin/env node\nrequire("node:fs").appendFileSync(process.env.DATA_ROOT+"/decode-calls","1\\n");console.log("out_time_us=100000000\\nprogress=end");process.exit(0);\n');await f.run();
  const c=(await f.result()).state.cases[f.id];assert.equal(c.status,'no_action');assert.equal(c.evidence,undefined);assert.equal(c.bindingFailure,undefined);
  assert.equal(f.requests.filter(r=>r.method!=='GET').length,0);await f.unchanged();
 }finally{await f.cleanup();}
});

test('bitrate-preflight EOF and MPEG-2 reports become actionable once from v3/v4 cursors',{skip:process.platform!=='linux'},async()=>{
 for(const cursor of ['not_confirmed_decode_error_v3','not_confirmed_decode_error_v4'])for(const diagnostic of ['[matroska,webm @ 0x123] File ended prematurely','[mpeg2video @ 0x123] ignoring pic cod ext after 0']){
  const f=await fixture();try{
   f.state.jobs['fixture-job']=cursor;
   f.movie.movieFile.sceneName='Unmatched synthetic release';
   await fs.writeFile(path.join(f.data,'../reports/fixture/report'),'Starting bitrate preflight\nError: Bitrate sampling failed: '+diagnostic+'\nPipeline stopped before encoding.');
   await f.write();await f.run();let result=await f.result(),c=result.state.cases[f.id];assert.ok(c,'preflight case must be visible');assert.equal(c.status,'manual');assert.match(c.message,/history|grabbed release/);
   const recorded=structuredClone(c);await f.run();result=await f.result();assert.deepEqual(result.state.cases[f.id],recorded,'manual decision is never reopened');assert.equal(f.requests.filter(r=>r.method!=='GET').length,0);await f.unchanged();
  }finally{await f.cleanup();}
 }
});

const PREMATURE='[matroska,webm @ 0x123] File ended prematurely';
const MPEG_FATAL='[mpeg2video @ 0x123] ignoring pic cod ext after 0\nError submitting packet to decoder: Invalid data found when processing input';
test('finite premature EOF is independently confirmed twice; unknown Segment stays preserved without Hold',{skip:process.platform!=='linux'},async()=>{
 for(const finite of [true,false]){
  const bytes=Buffer.concat([Buffer.from(finite?'1a45dfa380185380674100':'1a45dfa38018538067ff','hex'),Buffer.alloc(64)]);
  const f=await fixture({sourceBytesOverride:bytes});try{
   await skippedV3(f,'Error: Bitrate sampling failed: '+PREMATURE,decoder(PREMATURE,0));await f.run();let result=await f.result(),c=result.state.cases[f.id];
   assert.equal(c.status,finite?'deferred_cooldown':'manual');assert.equal(await decodeCalls(f),2);
   assert.equal(f.row.TranscodeDecisionMaker,finite?'Hold':'Transcode error');
   if(finite){assert.equal(c.evidence.checks.length,2);assert.ok(c.evidence.checks.every(c=>c.finiteContainerTruncation===true));}
   await f.run();assert.equal(await decodeCalls(f),2,'no repeated decoding after restart');await f.unchanged();
  }finally{await f.cleanup();}
 }
});
test('repeat fatal MPEG-2 decoding from time zero is compatibility attention without destructive authority',{skip:process.platform!=='linux'},async()=>{
 for(const diagnostic of [MPEG_FATAL,'[mpeg2video @ 0x123] ignoring pic cod ext after 0']){
  const f=await fixture();try{
   await skippedV3(f,'Error: Bitrate sampling failed: [mpeg2video @ 0x123] ignoring pic cod ext after 0',decoder(diagnostic,1));await f.run();const c=(await f.result()).state.cases[f.id];
   assert.equal(c.status,diagnostic===MPEG_FATAL?'manual':'no_action');assert.equal(c.originalCheckKind,diagnostic===MPEG_FATAL?'compatibility':'unconfirmed');
   assert.equal(await decodeCalls(f),diagnostic===MPEG_FATAL?2:1);assert.equal(c.evidence,undefined);assert.equal(f.requests.filter(r=>r.method!=='GET').length,0);await f.unchanged();
  }finally{await f.cleanup();}
 }
});

test('v5 migration inspects at most one hundred legacy reports per pass and preserves superseded cursors',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture();try{
  const db=new DatabaseSync(f.cfg.database);const job=JSON.parse(db.prepare('SELECT json_data FROM jobsjsondb').get().json_data);db.exec('DELETE FROM jobsjsondb');
  for(let i=0;i<101;i++){const id='legacy-'+i;db.prepare('INSERT INTO jobsjsondb VALUES (?)').run(JSON.stringify({...job,_id:id}));f.state.jobs[id]='not_confirmed_decode_error_v4';}db.close();
  f.state.jobs.superseded='superseded';await fs.writeFile(path.join(f.data,'../reports/fixture/report'),'Conversion failed without recognized source evidence');await f.write();
  await f.run();let state=(await f.result()).state;assert.equal(Object.values(state.jobs).filter(v=>v==='not_confirmed_decode_error_v5').length,100);assert.equal(state.jobs.superseded,'superseded');
  await f.run();state=(await f.result()).state;assert.equal(Object.values(state.jobs).filter(v=>v==='not_confirmed_decode_error_v5').length,101);assert.equal(await decodeCalls(f),0);await f.unchanged();
 }finally{await f.cleanup();}
});
test('a growing finite-EOF source stays manual without a Hold or a replacement',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture({sourceBytesOverride:Buffer.concat([Buffer.from('1a45dfa380185380674100','hex'),Buffer.alloc(64)])});try{
  await skippedV3(f,'Error: Bitrate sampling failed: '+PREMATURE,decoder(PREMATURE,0,'fs.appendFileSync(a[a.indexOf("-i")+1],"X");'));
  await f.run();assert.equal((await f.result()).state.cases[f.id].status,'manual');assert.equal(f.requests.filter(r=>r.method!=='GET').length,0);assert.equal(f.row.TranscodeDecisionMaker,'Transcode error');
 }finally{await f.cleanup();}
});

test('a hundred missing recent reports cannot starve an older preflight case after restart',{skip:process.platform!=='linux'},async()=>{
 const f=await fixture();try{
  const db=new DatabaseSync(f.cfg.database),job=JSON.parse(db.prepare('SELECT json_data FROM jobsjsondb').get().json_data);db.exec('DELETE FROM jobsjsondb');
  for(let i=0;i<100;i++){const id='missing-'+i;db.prepare('INSERT INTO jobsjsondb VALUES (?)').run(JSON.stringify({...job,_id:id,file:f.file+'.missing-'+i,end:job.end+1,job:{...job.job,fileId:'absent-'+i}}));f.state.jobs[id]='not_confirmed_decode_error_v4';}
  db.prepare('INSERT INTO jobsjsondb VALUES (?)').run(JSON.stringify(job));db.close();f.state.jobs[job._id]='not_confirmed_decode_error_v4';f.movie.movieFile.sceneName='Unmatched release';
  await fs.writeFile(path.join(f.data,'../reports/fixture/report'),'Bitrate preflight started\nError: Bitrate sampling failed: '+PREMATURE+'\nStopped before encoding.');await f.write();
  await f.run();assert.equal((await f.result()).state.cases[f.id],undefined);await f.run();assert.equal((await f.result()).state.cases[f.id]?.status,'manual','readable older candidate must be reached after restarting');await f.unchanged();
 }finally{await f.cleanup();}
});

test('actual worker leaves the source in place when Tdarr does not confirm the Hold before quarantine (#196)',async()=>{
 const f=await fixture();try{
  f.parent.movieId=2;f.allowRepair();f.ignoreHold();
  await f.write();await f.run();const result=await f.result(),c=result.state.cases[f.id];
  assert.match(JSON.stringify(c)+String(result.state.lastError),/Tdarr Hold was not confirmed; source not quarantined/);
  assert.equal(c.quarantine,undefined);assert.equal(String(await fs.readFile(f.source)),String(f.sourceBytes),'the source stays in the library');
  assert.equal(f.row.TranscodeDecisionMaker,'Transcode error','Tdarr kept its state');
  assert.equal(f.requests.filter(r=>r.url==='/api/v3/command'&&r.method==='POST').length,0,'no Radarr mutation follows an unconfirmed Hold');
  const write=f.requests.findIndex(r=>r.url==='/api/v2/bulk-update-files');assert.equal(f.requests[write+1]?.url,'/api/v2/cruddb','the Hold is read back right after the write');
 }finally{await f.cleanup();}
});

// A state.json written by the 2.1.0 worker for each frozen-deferral kind, and the state after the
// next poll of that worker, are fixtures. A later worker must load that file and continue identically.
// Values that differ per run (temporary root, file identity, case ID, times) are placeholders.
// UPDATE_GOLDEN=1 regenerates both files from the current worker.
function stateCodec(f){
 const started=f.parent.mutationStarted,iso=ms=>new Date(ms).toISOString();
 const swaps=[[f.root,'{{ROOT}}'],[f.sourceFP,'{{FP}}'],[f.id,'{{ID}}'],[iso(started+30*86400000),'{{COOLDOWN_UNTIL}}'],[iso(started+86400000),'{{LIMIT_UNTIL}}']];
 const encode=value=>{let text=JSON.stringify(value);for(const [from,to] of swaps)text=text.split(from).join(to);
  return JSON.parse(text,(key,v)=>key==='mutationStarted'&&v===started?'{{STARTED}}':['updated','created','confirmed','queued','time'].includes(key)&&typeof v==='string'?'{{TIME}}':v);};
 const decode=value=>{let text=JSON.stringify(value);for(const [from,to] of swaps)text=text.split(to).join(from);
  return JSON.parse(text,(key,v)=>v==='{{STARTED}}'?started:v==='{{TIME}}'?new Date(Date.now()-500).toISOString():v);};
 return {encode,decode};
}
for(const kind of ['cooldown','limit']){
 test('a '+kind+' deferral state.json written by the 2.1.0 worker continues identically',{skip:process.platform!=='linux'},async()=>{
  const fixtureFile=new URL('../fixtures/recovery-state-2.1-deferred-'+kind+'.json',import.meta.url);
  const prepare=async()=>{const f=await fixture();if(kind==='limit'){f.parent.movieId=2;f.cfg.maxRepairsPerDay=1;}return f;};
  if(process.env.UPDATE_GOLDEN==='1'){
   const f=await prepare();try{const codec=stateCodec(f);await f.write();await f.run();
    await fs.writeFile(fixtureFile,JSON.stringify({input:codec.encode((await f.result()).state),row:codec.encode({...f.row})},null,1)+'\n');}finally{await f.cleanup();}
  }
  const f=await prepare();try{
   const codec=stateCodec(f),golden=JSON.parse(await fs.readFile(fixtureFile,'utf8'));
   Object.assign(f.row,codec.decode(golden.row));await f.write();await fs.writeFile(f.data+'/state.json',JSON.stringify(codec.decode(golden.input)));
   await f.run();const after=codec.encode((await f.result()).state),requests=codec.encode(f.requests);
   if(process.env.UPDATE_GOLDEN==='1'){await fs.writeFile(fixtureFile,JSON.stringify({...golden,requests,after},null,1)+'\n');return;}
   assert.deepEqual(after,golden.after);assert.deepEqual(requests,golden.requests);
   await assert.rejects(fs.stat(f.data+'/decode-calls'),{code:'ENOENT'});await f.unchanged();
  }finally{await f.cleanup();}
 });
}

// The same poll, driven in-process through createWorker instead of a worker process.
for(const kind of ['cooldown','limit']){
 test('createWorker runs one poll of a 2.1.0 '+kind+' deferral in-process with the same result as the worker process',async()=>{
  const golden=JSON.parse(await fs.readFile(new URL('../fixtures/recovery-state-2.1-deferred-'+kind+'.json',import.meta.url),'utf8'));
  const f=await fixture();try{
   if(kind==='limit'){f.parent.movieId=2;f.cfg.maxRepairsPerDay=1;}
   const codec=stateCodec(f);Object.assign(f.row,codec.decode(golden.row));await f.write();
   const state=codec.decode(golden.input),{mode,cfg,text:configText,managed}=await readRecoveryConfiguration({data:f.data,mode:'repair'});
   const pendingApprovals=await loadApprovalRegistry({data:f.data,cfg,state});
   const worker=createWorker({data:f.data,mode,cfg,configText,managed,state,pendingApprovals,canStart:()=>true});
   await worker.markInterrupted();await worker.noteConfigChange();await worker.tick();state.lastError=null;await worker.refresh();await worker.save();await worker.close();
   assert.deepEqual(codec.encode((await f.result()).state),golden.after);assert.deepEqual(codec.encode(f.requests),golden.requests);
   await assert.rejects(fs.stat(f.data+'/decode-calls'),{code:'ENOENT'});await f.unchanged();
  }finally{await f.cleanup();}
 });
}
