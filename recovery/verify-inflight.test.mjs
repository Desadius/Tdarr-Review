import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {identityOf} from './file-identity.mjs';
import {publishApproval} from './quarantine-retention.mjs';

const linux={skip:process.platform!=='linux'?'Requires Linux filesystem identities and directory fsync':false};
async function fixture(t,status){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'verify-inflight-'));
 const data=path.join(root,'data'),media=path.join(root,'movies'),source=path.join(media,'Film/original.mkv'),quarantine=path.join(root,'quarantine/case/original.mkv'),replacement=path.join(media,'Film/new.mkv');
 for(const dir of [data,path.dirname(source),path.dirname(quarantine)])await fs.mkdir(dir,{recursive:true});
 const bytes='SYNTHETIC ORIGINAL';await fs.writeFile(quarantine,bytes);await fs.writeFile(replacement,'SYNTHETIC REPLACEMENT');
 const c={id:'case',status,movieId:1,file:'/media/Film/original.mkv',relative:'Film/original.mkv',source,quarantine,size:bytes.length,fp:identityOf(await fs.stat(quarantine)),binding:{movieFileId:10,sourceTitle:'Bad.Release'},mutationStarted:Date.now()-2*86400000,created:new Date(Date.now()-2*86400000).toISOString(),updated:new Date().toISOString(),originalQuality:{id:1,resolution:1080},searchCommand:5};
 if(status==='waiting_source_kept'){
  await fs.link(quarantine,source);Object.assign(c,{keptLink:true,preservedSourceFP:identityOf(await fs.stat(source)),keptMovieFileId:10,skipCurrentEdition:true,nextSearchAt:new Date(0).toISOString()});
 }
 if(['replacement_queue_intent','replacement_imported'].includes(status))Object.assign(c,{replacement:{movieFileId:11,path:'/radarr/Film/new.mkv',size:(await fs.stat(replacement)).size},replacementRelative:'Film/new.mkv',replacementSourceFP:identityOf(await fs.stat(replacement))});
 const state={version:1,jobs:{},cases:{case:c}},requests=[];
 const cfg={libraryId:'lib',sourceRoot:'/media',mediaRoot:media,radarrRoot:'/radarr',reviewRoot:path.join(root,'review'),reviewPrefixes:[],quarantineRoot:path.join(root,'quarantine'),database:path.join(root,'db.sqlite'),reports:path.join(root,'reports'),stableMinutes:0,pollSeconds:300,detectTerminalHeaders:false,approvedImportRepairs:{},maxRepairsPerDay:3,radarrApiKey:'fixture-only',ffmpeg:path.join(root,'ffmpeg'),decodeTimeoutHours:1,confirmDelaySeconds:0,movieCooldownDays:30,since:0};
 const movie={id:1,qualityProfileId:1,movieFileId:status==='waiting_source_kept'?10:['replacement_queue_intent','replacement_imported'].includes(status)?11:0};
 const oldFile={id:10,path:'/radarr/Film/original.mkv',size:bytes.length,sceneName:'Bad.Release',quality:{quality:{id:1,resolution:1080}}};
 const newFile={id:11,path:'/radarr/Film/new.mkv',size:(await fs.stat(replacement)).size,sceneName:'New.Release'};
 if(movie.movieFileId)movie.movieFile=movie.movieFileId===10?oldFile:newFile;
 const row={_id:'/media/Film/new.mkv',DB:'lib',TranscodeDecisionMaker:'Hold'},queue=[];
 const control={searchStatus:'completed'};
 const db=new DatabaseSync(cfg.database);db.exec('CREATE TABLE jobsjsondb (json_data TEXT); CREATE TABLE filejsondb (json_data TEXT)');
 const syncRow=()=>{db.exec('DELETE FROM filejsondb');db.prepare('INSERT INTO filejsondb VALUES (?)').run(JSON.stringify(row));};syncRow();
 const server=http.createServer(async(req,res)=>{
  try{
   let raw='';for await(const chunk of req)raw+=chunk;
   const parsed=raw?JSON.parse(raw):undefined,body=req.url.startsWith('/api/v2/')?parsed?.data:parsed;
   requests.push({method:req.method,url:req.url,body});res.setHeader('content-type','application/json');const reply=value=>res.end(JSON.stringify(value));
   if(req.method==='GET'){
    if(req.url==='/api/v3/movie')return reply([movie]);
    if(req.url==='/api/v3/movie/1')return reply(movie);
    if(req.url==='/api/v3/queue?pageSize=1000')return reply({records:queue});
    if(req.url==='/api/v3/command/6')return reply({id:6,status:'completed'});
    if(req.url==='/api/v3/command/5')return reply({id:5,status:control.searchStatus});
    if(req.url==='/api/v3/blocklist/movie?movieId=1')return reply([]);
    if(req.url==='/api/v3/qualityprofile/1')return reply({items:[{allowed:true,quality:{id:1,resolution:1080}}]});
    if(req.url==='/api/v3/release?movieId=1')return reply([{downloadAllowed:true,title:'New.Release',guid:'fixture',indexerId:1,quality:{quality:{id:1,resolution:1080}},rejections:[]}]);
    if(req.url==='/api/v2/get-nodes')return reply({});
   }
   if(req.url==='/api/v2/cruddb')return reply(row);
   if(req.url==='/api/v2/bulk-update-files'){Object.assign(row,body.updatedObj);syncRow();return reply('OK');}
   if(req.url==='/api/v2/rescan-file')return reply('OK');
   if(req.url==='/api/v3/command'&&body.name==='RescanMovie'){
    try{const s=await fs.stat(source);movie.movieFileId=10;movie.movieFile={...oldFile,size:s.size};}catch(e){if(e.code!=='ENOENT')throw e;movie.movieFileId=0;delete movie.movieFile;}
    return reply({id:6,status:'completed'});
   }
   if(req.url==='/api/v3/release')return reply({});
   res.writeHead(500);reply({error:'Unexpected synthetic fixture request'});
  }catch(e){res.writeHead(500);res.end(JSON.stringify({error:e.message}));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;cfg.radarrUrl=base;cfg.tdarrUrl=base;
 t.after(async()=>{db.close();await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});});
 async function run(mode='verify'){
  syncRow();await fs.writeFile(path.join(data,'config.json'),JSON.stringify(cfg));await fs.writeFile(path.join(data,'state.json'),JSON.stringify(state));requests.length=0;
  const child=spawn(process.execPath,[new URL('./worker.mjs',import.meta.url).pathname,'--once'],{env:{...process.env,DATA_ROOT:data,RECOVERY_MODE:mode},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  const timer=setTimeout(()=>child.kill('SIGKILL'),15000);
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);}).finally(()=>clearTimeout(timer));assert.equal(code,0,output);
  Object.assign(state,JSON.parse(await fs.readFile(path.join(data,'state.json'),'utf8')));
  const published=JSON.parse(await fs.readFile(path.join(root,'.tdarr-recovery-status.json'),'utf8'));
  assert.equal(state.lastError,null,output);return {c:state.cases.case,public:published.cases.find(c=>c.id==='case'),status:published};
 }
 return {root,data,media,source,quarantine,replacement,state,c,cfg,movie,newFile,row,queue,control,requests,run};
}
const nonProtective=requests=>requests.filter(r=>r.method!=='GET'||r.url.startsWith('/api/v3/release?'));

test('Verify pauses kept-source removal and replacement requests in the actual worker',linux,async t=>{
 const f=await fixture(t,'waiting_source_kept');const result=await f.run();
 assert.equal(await fs.readFile(f.source,'utf8').catch(()=>null),'SYNTHETIC ORIGINAL','Verify must preserve the kept library source');
 assert.deepEqual(nonProtective(f.requests),[],'Verify must not search, grab a release or mutate Tdarr');
 assert.equal(result.c.status,'waiting_source_kept');assert.equal(result.public.verifyPausedStep,'replacement_request');
 assert.equal(result.public.originalOutsideLibrary,false);
});

for(const status of ['waiting_replacement','replacement_queue_intent'])test('Verify observes imports but pauses Tdarr handoff from '+status,linux,async t=>{
 const f=await fixture(t,status);Object.assign(f.movie,{movieFileId:11,movieFile:f.newFile});
 const result=await f.run();
 assert.deepEqual(nonProtective(f.requests),[],'Verify must not submit or finish a Tdarr handoff');
 assert.equal(result.c.status,status,'a paused case keeps its phase');
 assert.equal(result.c.replacement.movieFileId,11,'read-only import observation continues');
 assert.equal(result.public.verifyPausedStep,'tdarr_handoff');assert.equal(result.public.originalOutsideLibrary,true);
 assert.equal(result.public.originalOutsideSince,new Date(f.c.mutationStarted).toISOString());
});

async function approveExpired(f){
 await publishApproval({mediaRoot:f.media,relative:'Film/new.mkv',sourceFP:f.c.replacementSourceFP,installedRelative:'Film/new.mkv',atomic:(p,v)=>fs.writeFile(p,JSON.stringify(v))});
 const dir=path.join(f.root,'.tdarr-approvals'),file=path.join(dir,(await fs.readdir(dir))[0]);
 const value=JSON.parse(await fs.readFile(file,'utf8'));value.approvedAt=new Date(Date.now()-9*86400000).toISOString();await fs.writeFile(file,JSON.stringify(value));return file;
}
test('Verify preserves approved quarantine past retention; Repair resumes the purge',linux,async t=>{
 const f=await fixture(t,'replacement_imported');await approveExpired(f);
 let result=await f.run();
 assert.equal(await fs.readFile(f.quarantine,'utf8').catch(()=>null),'SYNTHETIC ORIGINAL','Verify must never purge quarantine');
 assert.deepEqual(nonProtective(f.requests),[]);assert.equal(result.public.verifyPausedStep,'quarantine_purge');
 assert.equal(result.c.status,'replacement_imported');
 result=await f.run('repair');
 await assert.rejects(fs.stat(f.quarantine),{code:'ENOENT'});assert.equal(result.c.cleanup.complete,true);assert.equal(result.public.verifyPausedStep??null,null);
});

for(const blocked of ['none','queue','search','identity'])test('Verify protective restoration respects '+blocked+' condition',linux,async t=>{
 const f=await fixture(t,'waiting_replacement');
 if(blocked==='queue')f.queue.push({movieId:1,status:'downloading'});
 if(blocked==='search')f.control.searchStatus='started';
 if(blocked==='identity')await fs.appendFile(f.quarantine,' CHANGED');
 const result=await f.run();
 if(blocked==='none'){
  assert.equal(await fs.readFile(f.source,'utf8'),'SYNTHETIC ORIGINAL');assert.equal((await fs.stat(f.quarantine)).nlink,2);
  assert.equal(result.c.status,'waiting_source_kept');assert.equal(result.c.observationError,undefined);assert.equal(result.public.originalOutsideLibrary,false);
  assert.ok(Number.isFinite(Date.parse(result.public.originalRestoredAt)),'the status records when the original returned');
  const writes=nonProtective(f.requests);assert.equal(writes.length,2);
  assert.equal(writes[0].url,'/api/v2/bulk-update-files');assert.equal(writes[0].body.updatedObj.TranscodeDecisionMaker,'Hold');
  assert.equal(writes[1].body.name,'RescanMovie');
 }else{
  await assert.rejects(fs.stat(f.source),{code:'ENOENT'});assert.deepEqual(nonProtective(f.requests),[]);
  assert.equal(result.c.status,'waiting_replacement');assert.equal(result.public.originalOutsideLibrary,blocked==='identity'?null:true);
  assert.equal(result.public.originalOutsideSince,blocked==='identity'?null:new Date(f.c.mutationStarted).toISOString());
 }
});

test('Verify observes a differently named import without misreporting the kept original location',linux,async t=>{
 const f=await fixture(t,'waiting_source_kept');Object.assign(f.movie,{movieFileId:11,movieFile:f.newFile});
 const result=await f.run();
 assert.equal(result.c.status,'waiting_replacement');assert.equal(result.c.replacement.movieFileId,11);
 assert.deepEqual(nonProtective(f.requests),[]);assert.equal(result.public.verifyPausedStep,'tdarr_handoff');
 assert.equal(result.public.originalOutsideLibrary,false,'the recorded original still exists under its old library filename');
});

for(const changed of ['source','queue'])test('Repair revalidates '+changed+' after a kept-source pause',linux,async t=>{
 const f=await fixture(t,'waiting_source_kept');await f.run();
 if(changed==='source')await fs.appendFile(f.source,' CHANGED');else f.queue.push({movieId:1,status:'downloading'});
 const result=await f.run('repair');
 assert.ok((await fs.stat(f.source)).isFile());assert.equal(result.c.status,'waiting_source_kept');
 assert.equal(f.requests.some(r=>r.url==='/api/v3/release'||r.url==='/api/v2/bulk-update-files'),false);
 assert.equal(result.public.verifyPausedStep,null,'a pause marker never becomes authority after resuming');
});
for(const changed of ['source','movie','tdarr'])test('Repair revalidates '+changed+' before resuming a pending handoff',linux,async t=>{
 const f=await fixture(t,'replacement_queue_intent');await f.run();
 if(changed==='source')await fs.appendFile(f.replacement,' CHANGED');
 if(changed==='movie')f.movie.movieFileId=12;
 if(changed==='tdarr')f.row.TranscodeDecisionMaker='Unknown state';
 const paused=await f.run();assert.equal(paused.c.status,'replacement_queue_intent','Verify keeps the paused handoff phase even when its binding needs inspection');
 const result=await f.run('repair');
 assert.equal(result.c.status,changed==='source'?'replacement_queue_intent':'manual');assert.ok(result.c.observationError);
 assert.equal(f.requests.some(r=>['/api/v2/bulk-update-files','/api/v2/rescan-file'].includes(r.url)),false);
});
for(const changed of ['approval','installed','quarantine'])test('Repair revalidates '+changed+' before resuming a paused purge',linux,async t=>{
 const f=await fixture(t,'replacement_imported'),approval=await approveExpired(f);await f.run();
 if(changed==='approval'){const value=JSON.parse(await fs.readFile(approval,'utf8'));value.sourceFP='stale';await fs.writeFile(approval,JSON.stringify(value));}
 if(changed==='installed')await fs.appendFile(f.replacement,' CHANGED');
 if(changed==='quarantine')await fs.appendFile(f.quarantine,' CHANGED');
 const result=await f.run('repair');assert.ok((await fs.stat(f.quarantine)).isFile());assert.ok(result.c.retentionError);
});
test('Repair resumes replacement requests from fresh state without another confirmation',linux,async t=>{
 const f=await fixture(t,'waiting_source_kept');await f.run();const result=await f.run('repair');
 assert.equal(result.c.status,'waiting_replacement');await assert.rejects(fs.stat(f.source),{code:'ENOENT'});
 assert.equal(f.requests.filter(r=>r.method==='POST'&&r.url==='/api/v3/release').length,1);
 assert.equal(result.public.verifyPausedStep,null);assert.ok(Number.isFinite(Date.parse(result.public.originalOutsideSince)));
});
test('Repair resumes a paused Tdarr handoff from the current row',linux,async t=>{
 const f=await fixture(t,'replacement_queue_intent');await f.run();const result=await f.run('repair');
 assert.equal(result.c.status,'replacement_imported');assert.equal(f.row.TranscodeDecisionMaker,'Queued');
 assert.equal(f.requests.filter(r=>r.url==='/api/v2/bulk-update-files').length,1);
});

for(const changed of ['missing','changed'])test('Verify reports unknown original location when quarantine is '+changed,linux,async t=>{
 const f=await fixture(t,'waiting_replacement');
 if(changed==='missing')await fs.unlink(f.quarantine);else await fs.appendFile(f.quarantine,' CHANGED');
 const result=await f.run();assert.equal(result.public.originalOutsideLibrary,null);assert.equal(result.public.originalOutsideSince,null);assert.deepEqual(nonProtective(f.requests),[]);
});

test('Verify publications preserve the recorded outside-the-library clock',linux,async t=>{
 const f=await fixture(t,'waiting_replacement');f.queue.push({movieId:1,status:'downloading'});
 f.c.originalOutsideSince=new Date(f.c.mutationStarted+5000).toISOString();
 const first=await f.run(),second=await f.run();
 assert.equal(first.public.originalOutsideSince,f.c.originalOutsideSince);assert.equal(second.public.originalOutsideSince,first.public.originalOutsideSince);
 assert.equal(second.public.verifyPausedStep,'replacement_request');
});

// #77: Verify is strictly narrower than Repair, so a registry approved for Repair also starts in Verify.
test('a registry that froze enabled: true starts in Verify, keeps polling and reports the modes it allows',linux,async t=>{
 const f=await fixture(t,'waiting_source_kept');
 await fs.writeFile(path.join(f.data,'pending-approvals.json'),JSON.stringify({version:1,config:{enabled:true,libraryId:'lib'},cases:[]}),{mode:0o600});
 const result=await f.run();
 assert.deepEqual(nonProtective(f.requests),[],'Verify against a Repair approval stays paused');
 assert.equal(result.public.verifyPausedStep,'replacement_request');
 assert.deepEqual(result.status.registryAllowedModes,['verify','repair']);
 assert.deepEqual((await f.run('repair')).status.registryAllowedModes,['verify','repair']);
});
test('without a frozen enabled the status file reports no mode restriction',linux,async t=>{
 const f=await fixture(t,'waiting_source_kept');
 assert.equal((await f.run()).status.registryAllowedModes,null);
 await fs.writeFile(path.join(f.data,'pending-approvals.json'),JSON.stringify({version:1,config:{enabled:false},cases:[]}),{mode:0o600});
 const result=await f.run();
 assert.deepEqual(result.status.registryAllowedModes,['verify']);
 assert.deepEqual(Object.keys(result.status).sort(),['cases','configChange','registryAllowedModes','updated','version'],'no other configuration value is exported');
});
