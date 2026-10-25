import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {reviewFixture} from './test-helpers/review-fixture.mjs';
import {identityOf} from '../recovery/file-identity.mjs';
import {readRecoveryRestoreBinding} from '../recovery/recovery-authority.mjs';
import {recoveryRestoreBindingDigest} from '../recovery/restore-evidence.mjs';

const restoredCaseRevision=c=>({id:c.id,status:c.status,updated:c.updated,file:c.file,relative:c.relative,source:c.source,fp:c.fp,preservedSourceFP:c.preservedSourceFP,quarantine:c.quarantine,movieId:c.movieId,tmdbId:c.tmdbId,mutationStarted:c.mutationStarted,originalOutsideSince:c.originalOutsideSince,searchCommand:c.searchCommand,binding:c.binding});
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function interruptedRecord({f,caseId,operationId,source,destination,bytes,crossDevice,phase}){
 const state=JSON.parse(await fs.readFile(path.join(f.data,'recovery/state.json'),'utf8')),c=state.cases[caseId],
  authority=await readRecoveryRestoreBinding({data:path.join(f.data,'recovery'),mode:'off'}),
  sourceStat=await fs.stat(source),destinationStat=await fs.stat(destination),journal=path.join(f.data,'recovery-restores',caseId+'.json');
 return {version:1,operationId,caseId,state:'blocked',phase,mode:'off',createdAt:new Date().toISOString(),journal,
  confirmedSnapshot:'a'.repeat(64),bindingRevision:authority.generation??null,bindingHash:recoveryRestoreBindingDigest(authority.binding),
  caseRevision:hash(restoredCaseRevision(c)),sourcePath:source,destinationPath:destination,sourceIdentity:identityOf(sourceStat),
  sourceHash:crypto.createHash('sha256').update(bytes).digest('hex'),crossDevice,filesystemState:'unchanged',movieId:c.movieId,tmdbId:c.tmdbId,
  ...(crossDevice?{temporaryIdentity:identityOf(destinationStat)}:{destinationIdentity:identityOf(destinationStat)})};
}

async function crossDeviceFixture(t,caseId,{mode='off',supervisor=false,loseRestartAck=false}={}){
 const external=await fs.mkdtemp('/dev/shm/recovery234-');t.after(()=>fs.rm(external,{recursive:true,force:true}));
 let original,quarantine,dropAckFile;
 const f=await reviewFixture({supervisor,env:{RECOVERY_MODE:mode},beforeStart:async({data,media,root,dbpath,mockBase})=>{
  original=path.join(media,'A','A.mkv');quarantine=path.join(external,caseId,'A.mkv');
  await fs.mkdir(path.dirname(quarantine),{recursive:true});await fs.copyFile(original,quarantine);await fs.unlink(original);
  const fp=identityOf(await fs.stat(quarantine)),recoveryData=path.join(data,'recovery');await fs.mkdir(recoveryData,{recursive:true});
  await fs.writeFile(path.join(recoveryData,'config.json'),JSON.stringify({enabled:mode==='repair',tdarrUrl:mockBase,radarrUrl:mockBase,radarrApiKey:'synthetic-key',libraryId:'fixture-library',sourceRoot:'/fixture-library',radarrRoot:'/fixture-library',mediaRoot:media,reviewRoot:path.join(root,'review'),reviewPrefixes:['PROD-Movies'],quarantineRoot:external,database:dbpath,reports:path.join(root,'reports'),ffmpeg:process.execPath,ffprobe:process.execPath,stableMinutes:10,decodeTimeoutHours:12,fullSourceHash:false,confirmDelaySeconds:30,maxRepairsPerDay:3,movieCooldownDays:30,pollSeconds:300,detectTerminalHeaders:true,since:0,approvedCaseIds:[],approvedImportRepairs:{}}));
  const outside='2026-10-24T09:00:00.000Z',updated='2026-10-24T10:03:00.000Z';
  await fs.writeFile(path.join(recoveryData,'state.json'),JSON.stringify({version:1,jobs:{},cases:{[caseId]:{id:caseId,status:'manual',file:'/fixture-library/A/A.mkv',source:original,relative:'A/A.mkv',fp,preservedSourceFP:fp,quarantine,movieId:71,tmdbId:9001,binding:{movieFileId:72},bindingFailure:{code:'history-missing'},mutationStarted:Date.parse('2026-10-24T08:59:00.000Z'),originalOutsideSince:outside,searchCommand:84,updated}}}));
  await fs.writeFile(path.join(root,'.tdarr-recovery-status.json'),JSON.stringify({version:1,updated,cases:[{id:caseId,title:'A',phase:'manual',source:'recovery',updated,tmdbId:9001}]}));
  if(loseRestartAck){dropAckFile=path.join(root,'restart-reply-dropped');await fs.appendFile(path.join(root,'preload.cjs'),`\nconst savedSend=process.send.bind(process),savedEmit=process.emit,restartTokens=new Set(),fsSync=require('node:fs');process.send=function(message,...args){if(message?.channel==='recovery-control'&&message.action==='restart')restartTokens.add(message.token);return savedSend(message,...args)};process.emit=function(event,...args){const message=args[0];if(event==='message'&&message?.channel==='recovery-control-reply'&&restartTokens.delete(message.token)){fsSync.writeFileSync(${JSON.stringify(dropAckFile)},'dropped');return true}return savedEmit.call(this,event,...args)};\n`);}
 }});t.after(()=>f.close());return {f,original,quarantine,external,dropAckFile,bytes:await fs.readFile(quarantine)};
}

async function waitFor(predicate,message,timeout=30000){
 const end=Date.now()+timeout;let value;
 while(Date.now()<end){value=await predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,25));}
 assert.fail(message);
}

test('Off-mode operator can read exact original restore eligibility without changing files or Recovery state',async t=>{
 const caseId='a'.repeat(24);
 let originalFP,quarantine,quarantineFP;
 const f=await reviewFixture({env:{RECOVERY_MODE:'off'},beforeStart:async({data,media,root,dbpath,mockBase})=>{
  const original=path.join(media,'A','A.mkv');quarantine=path.join(root,'quarantine',caseId,'A.mkv');
  await fs.mkdir(path.dirname(quarantine),{recursive:true});
  originalFP=identityOf(await fs.stat(original));await fs.rename(original,quarantine);
  quarantineFP=identityOf(await fs.stat(quarantine));
  const recoveryData=path.join(data,'recovery');await fs.mkdir(recoveryData,{recursive:true});
  await fs.writeFile(path.join(recoveryData,'config.json'),JSON.stringify({
   enabled:false,tdarrUrl:mockBase,radarrUrl:mockBase,radarrApiKey:'synthetic-key',libraryId:'fixture-library',
   sourceRoot:'/fixture-library',radarrRoot:'/fixture-library',mediaRoot:media,reviewRoot:path.join(root,'review'),reviewPrefixes:['PROD-Movies'],quarantineRoot:path.join(root,'quarantine'),
   database:dbpath,reports:path.join(root,'reports'),ffmpeg:process.execPath,ffprobe:process.execPath,stableMinutes:10,decodeTimeoutHours:12,
   fullSourceHash:false,confirmDelaySeconds:30,maxRepairsPerDay:3,movieCooldownDays:30,pollSeconds:300,detectTerminalHeaders:true,since:0,
   approvedCaseIds:[],approvedImportRepairs:{}
  }));
  const originalOutsideSince='2026-10-24T10:00:00.000Z',updated='2026-10-24T10:03:00.000Z';
  await fs.writeFile(path.join(recoveryData,'state.json'),JSON.stringify({version:1,jobs:{},cases:{[caseId]:{
   id:caseId,status:'manual',file:'/fixture-library/A/A.mkv',source:original,relative:'A/A.mkv',fp:originalFP,preservedSourceFP:quarantineFP,
   quarantine,movieId:71,tmdbId:9001,binding:{movieFileId:72},bindingFailure:{code:'history-missing'},
   mutationStarted:Date.parse('2026-10-24T09:59:00.000Z'),originalOutsideSince,searchCommand:84,updated
  }}}));
  await fs.writeFile(path.join(root,'.tdarr-recovery-status.json'),JSON.stringify({version:1,updated:new Date().toISOString(),cases:[{
   id:caseId,title:'A',phase:'manual',source:'recovery',updated,tmdbId:9001
  }]}));
 }});t.after(()=>f.close());

 const stateBefore=await fs.readFile(path.join(f.data,'recovery','state.json'),'utf8'),callsBefore=f.calls.length;
 const eligibility=await f.get(`/api/recovery/cases/${caseId}/restore-original`);
 assert.equal(eligibility.eligible,true,JSON.stringify({eligibility,calls:f.calls}));
 assert.equal(eligibility.mode,'off','restore binding is metadata-only; Off remains Off');
 assert.deepEqual(await fs.readFile(quarantine),Buffer.alloc(128,'A'.charCodeAt(0)));
 assert.equal(identityOf(await fs.stat(quarantine)),quarantineFP);
 assert.equal(await fs.readFile(path.join(f.data,'recovery','state.json'),'utf8'),stateBefore);
 f.setRadarrQueue({page:1,pageSize:100,totalRecords:1,records:[{id:33,movieId:71,status:'downloading',trackedDownloadState:'Downloading'}]});
 const activeQueue=await f.get(`/api/recovery/cases/${caseId}/restore-original`);
 assert.equal(activeQueue.eligible,false,JSON.stringify(activeQueue));assert.ok(activeQueue.blockers.includes('radarr-queue-not-empty'));
 f.setRadarrQueue({page:1,pageSize:100,totalRecords:0,records:[]});
 const queueCleared=await f.get(`/api/recovery/cases/${caseId}/restore-original`);
 assert.equal(queueCleared.eligible,true,JSON.stringify(queueCleared));
 f.setRadarrMovie({id:71,tmdbId:9001,path:'/fixture-library',movieFileId:null});
 const nestedOriginal=await f.get(`/api/recovery/cases/${caseId}/restore-original`);
 assert.equal(nestedOriginal.eligible,true,'an original nested beneath the current Radarr movie folder remains eligible');
 for(const movie of [
  {id:71,tmdbId:9001,movieFileId:null},
  {id:71,tmdbId:9001,path:'/fixture-library/A-lookalike',movieFileId:null},
  {id:71,tmdbId:9001,path:'/outside-library/A',movieFileId:null}
 ]){
  f.setRadarrMovie(movie);
  const moved=await f.get(`/api/recovery/cases/${caseId}/restore-original`);assert.equal(moved.eligible,false,JSON.stringify(moved));assert.ok(moved.blockers.includes('radarr_binding_changed'));
  const stale=await f.post(`/api/recovery/cases/${caseId}/restore-original`,{confirm:true,snapshot:queueCleared.snapshot,attempt:queueCleared.attempt});assert.equal(stale.status,409);assert.equal((await stale.json()).code,'restore_not_eligible');
  await assert.rejects(fs.lstat(path.join(f.data,'recovery-restore-fence.json')),{code:'ENOENT'});await assert.rejects(fs.lstat(path.join(f.data,'recovery-restores',caseId+'.json')),{code:'ENOENT'});
  assert.deepEqual(await fs.readFile(quarantine),Buffer.alloc(128,'A'.charCodeAt(0)));
 }
 f.setRadarrMovie({id:71,tmdbId:9001,path:'/fixture-library/A',movieFileId:null});
 assert.ok(f.calls.slice(callsBefore).some(call=>call.route==='/api/v3/queue?movieId=71&page=1&pageSize=100'&&call.method==='GET'));
 const checks=f.calls.slice(callsBefore).filter(call=>call.route.startsWith('/api/v3/')||call.route.startsWith('/api/v2/'));
 assert.ok(checks.filter(call=>call.route.startsWith('/api/v3/')).every(call=>call.method==='GET'),'Radarr eligibility checks are GET-only');
 assert.ok(checks.filter(call=>call.route.startsWith('/api/v2/')).every(call=>call.route==='/api/v2/get-nodes'&&call.method==='GET'||call.route==='/api/v2/cruddb'&&call.method==='POST'&&call.input?.data?.mode==='getById'),'Tdarr eligibility checks read only the exact worker and file state');

 const destination=f.files.get('A').original,newer=Buffer.from('concurrent newer copy');
 const checkedCalls=f.calls.length;
 await fs.writeFile(destination,newer);
 const occupied=await f.get(`/api/recovery/cases/${caseId}/restore-original`);
 assert.equal(occupied.eligible,false);assert.ok(occupied.blockers.includes('destination-occupied'));
 assert.deepEqual(await fs.readFile(destination),newer,'an occupied destination is left untouched');
 assert.equal(identityOf(await fs.stat(quarantine)),quarantineFP,'the quarantined source is left untouched');
 await fs.unlink(destination);

 await fs.appendFile(quarantine,' changed after the eligibility read');
 const changed=await f.get(`/api/recovery/cases/${caseId}/restore-original`);
 assert.equal(changed.eligible,false);assert.ok(changed.blockers.includes('quarantine-changed'));
 assert.equal(await fs.readFile(path.join(f.data,'recovery','state.json'),'utf8'),stateBefore);
 assert.deepEqual(f.calls.slice(checkedCalls).filter(call=>call.route.startsWith('/api/v2/')),[],'refusal paths make no Tdarr API calls');
});

test('reconciliation rejects non-UUID operation paths before looking up an operation',{skip:process.platform!=='linux'?'Requires /dev/shm on a separate Linux filesystem':false},async t=>{
 const caseId='2'.repeat(24),{f,original,quarantine,bytes}=await crossDeviceFixture(t,caseId),eligibility=await f.get(`/api/recovery/cases/${caseId}/restore-original`);
 const accepted=await f.post(`/api/recovery/cases/${caseId}/restore-original`,{confirm:true,snapshot:eligibility.snapshot,attempt:eligibility.attempt});assert.equal(accepted.status,202);
 const status=await waitFor(async()=>{const value=await f.get(`/api/recovery/cases/${caseId}/restore-original/status`);return ['completed','blocked'].includes(value.state)&&value;},'restore did not settle');
 const journal=path.join(f.data,'recovery-restores',caseId+'.json'),journalBefore=await fs.readFile(journal);
 for(const operationId of ['../outside','..\\outside','/tmp/operation','00000000-0000-4000-8000-000000000001/../outside']){
  const response=await f.post(`/api/recovery/cases/${caseId}/restore-original/reconcile`,{confirm:true,operationId,revision:status.revision});
  assert.equal(response.status,409,operationId+': '+await response.clone().text());assert.equal((await response.json()).code,'restore_reconcile_confirmation_changed');
 }
 assert.deepEqual(await fs.readFile(journal),journalBefore,'invalid operation paths do not rewrite the current journal');
 assert.deepEqual(await fs.readFile(original),bytes);await assert.rejects(fs.lstat(quarantine),{code:'ENOENT'});
});

test('a confirmed Off-mode restore returns only the recorded original and publishes durable completion',async t=>{
 const caseId='b'.repeat(24);let original,quarantine;
 const f=await reviewFixture({env:{RECOVERY_MODE:'off'},beforeStart:async({data,media,root,dbpath,mockBase})=>{
  original=path.join(media,'A','A.mkv');quarantine=path.join(root,'quarantine',caseId,'A.mkv');
  await fs.mkdir(path.dirname(quarantine),{recursive:true});await fs.rename(original,quarantine);
  const fp=identityOf(await fs.stat(quarantine)),recoveryData=path.join(data,'recovery');await fs.mkdir(recoveryData,{recursive:true});
  await fs.writeFile(path.join(recoveryData,'config.json'),JSON.stringify({enabled:false,tdarrUrl:mockBase,radarrUrl:mockBase,radarrApiKey:'synthetic-key',libraryId:'fixture-library',sourceRoot:'/fixture-library',radarrRoot:'/fixture-library',mediaRoot:media,reviewRoot:path.join(root,'review'),reviewPrefixes:['PROD-Movies'],quarantineRoot:path.join(root,'quarantine'),database:dbpath,reports:path.join(root,'reports'),ffmpeg:process.execPath,ffprobe:process.execPath,stableMinutes:10,decodeTimeoutHours:12,fullSourceHash:false,confirmDelaySeconds:30,maxRepairsPerDay:3,movieCooldownDays:30,pollSeconds:300,detectTerminalHeaders:true,since:0,approvedCaseIds:[],approvedImportRepairs:{}}));
  const outside='2026-10-24T09:00:00.000Z',updated='2026-10-24T10:03:00.000Z';
  await fs.writeFile(path.join(recoveryData,'state.json'),JSON.stringify({version:1,jobs:{},cases:{[caseId]:{id:caseId,status:'manual',file:'/fixture-library/A/A.mkv',source:original,relative:'A/A.mkv',fp,preservedSourceFP:fp,quarantine,movieId:71,tmdbId:9001,binding:{movieFileId:72},bindingFailure:{code:'history-missing'},mutationStarted:Date.parse('2026-10-24T08:59:00.000Z'),originalOutsideSince:outside,searchCommand:84,updated}}}));
  await fs.writeFile(path.join(root,'.tdarr-recovery-status.json'),JSON.stringify({version:1,updated,cases:[{id:caseId,title:'A',phase:'manual',source:'recovery',updated,tmdbId:9001}]}));
 }});t.after(()=>f.close());
 const originalBytes=await fs.readFile(quarantine),privateState=await fs.readFile(path.join(f.data,'recovery','state.json'),'utf8');
 const eligibility=await f.get(`/api/recovery/cases/${caseId}/restore-original`);
 const response=await f.post(`/api/recovery/cases/${caseId}/restore-original`,{confirm:true,snapshot:eligibility.snapshot,attempt:eligibility.attempt});
 assert.equal(response.status,202,await response.clone().text());
 const accepted=await response.json();assert.equal(accepted.accepted,true);assert.equal(accepted.caseId,caseId);
 let status;
 for(let i=0;i<100;i++){status=await f.get(`/api/recovery/cases/${caseId}/restore-original/status`);if(['completed','blocked','unreadable'].includes(status.state))break;await new Promise(resolve=>setTimeout(resolve,10));}
 assert.equal(status.state,'completed',JSON.stringify(status));
 assert.deepEqual(await fs.readFile(original),originalBytes);
 await assert.rejects(fs.lstat(quarantine),{code:'ENOENT'});
 assert.equal(await fs.readFile(path.join(f.data,'recovery','state.json'),'utf8'),privateState,'Review leaves Recovery private state untouched');
 assert.equal((await f.get('/api/recovery/runtime')).mode,'off','restoring while Off never enables Recovery');
 const terminal=await f.get(`/api/recovery/cases/${caseId}/restore-original/status`),journal=path.join(f.data,'recovery-restores',caseId+'.json'),journalBefore=await fs.readFile(journal);
 const replay=await f.post(`/api/recovery/cases/${caseId}/restore-original/reconcile`,{confirm:true,operationId:terminal.operationId,revision:terminal.revision});
 assert.equal(replay.status,200,await replay.clone().text());assert.deepEqual(await replay.json(),terminal,'completed reconciliation is an idempotent read');
 assert.deepEqual(await fs.readFile(journal),journalBefore,'terminal reconciliation never rewrites its closed journal');
 const duplicate=await f.post(`/api/recovery/cases/${caseId}/restore-original`,{confirm:true,snapshot:eligibility.snapshot,attempt:eligibility.attempt});assert.equal(duplicate.status,409);
});

test('an unrelated idle Tdarr worker update does not stale the confirmed restore snapshot',{skip:process.platform!=='linux'?'Requires /dev/shm on a separate Linux filesystem':false},async t=>{
 const caseId='9'.repeat(24),{f,original,bytes}=await crossDeviceFixture(t,caseId),eligibility=await f.get(`/api/recovery/cases/${caseId}/restore-original`);
 assert.equal(eligibility.eligible,true,JSON.stringify(eligibility));
 f.nodes.fixture.workers.background={id:'background',idle:true,file:'/unrelated-library/Other.mkv',progress:{percent:42}};
 const accepted=await f.post(`/api/recovery/cases/${caseId}/restore-original`,{confirm:true,snapshot:eligibility.snapshot,attempt:eligibility.attempt});assert.equal(accepted.status,202,await accepted.clone().text());
 const result=await accepted.json();let status;
 for(let i=0;i<150;i++){status=await f.get(`/api/recovery/cases/${caseId}/restore-original/status`);if(['completed','blocked'].includes(status.state))break;await new Promise(resolve=>setTimeout(resolve,10));}
 assert.equal(status.state,'completed',JSON.stringify(status));assert.deepEqual(await fs.readFile(original),bytes);
});

test('a real cross-filesystem restore installs an exclusive verified copy before removing quarantine',{skip:process.platform!=='linux'?'Requires /dev/shm on a separate Linux filesystem':false},async t=>{
 const caseId='c'.repeat(24),{f,original,quarantine,bytes}=await crossDeviceFixture(t,caseId);
 assert.notEqual((await fs.stat(path.dirname(original))).dev,(await fs.stat(quarantine)).dev,'fixture crosses filesystem devices');
 const eligibility=await f.get(`/api/recovery/cases/${caseId}/restore-original`);
 const response=await f.post(`/api/recovery/cases/${caseId}/restore-original`,{confirm:true,snapshot:eligibility.snapshot,attempt:eligibility.attempt});assert.equal(response.status,202,await response.clone().text());
 let status;for(let i=0;i<150;i++){status=await f.get(`/api/recovery/cases/${caseId}/restore-original/status`);if(['completed','blocked'].includes(status.state))break;await new Promise(resolve=>setTimeout(resolve,10));}
 assert.equal(status.state,'completed',JSON.stringify(status));assert.equal(status.crossDevice,true,JSON.stringify(status));
 assert.deepEqual(await fs.readFile(original),bytes);assert.equal((await fs.stat(original)).nlink,1);await assert.rejects(fs.lstat(quarantine),{code:'ENOENT'});
});

test('a cross-filesystem temporary-name collision preserves the existing temp and both original copies',{skip:process.platform!=='linux'?'Requires /dev/shm on a separate Linux filesystem':false},async t=>{
 const caseId='d'.repeat(24),{f,original,quarantine,bytes}=await crossDeviceFixture(t,caseId),eligibility=await f.get(`/api/recovery/cases/${caseId}/restore-original`);
 let commandReads=0;const gate=f.hold('/api/v3/command/84',()=>++commandReads===2);
 const response=await f.post(`/api/recovery/cases/${caseId}/restore-original`,{confirm:true,snapshot:eligibility.snapshot,attempt:eligibility.attempt});assert.equal(response.status,202,await response.clone().text());
 const accepted=await response.json(),temporary=path.join(path.dirname(original),`.tdarr-review-restore-${accepted.operationId}.tmp`),existing=Buffer.from('pre-existing unrelated temporary file');
 await gate.entered;await fs.writeFile(temporary,existing);gate.release();
 let status;for(let i=0;i<150;i++){status=await f.get(`/api/recovery/cases/${caseId}/restore-original/status`);if(status.state==='blocked')break;await new Promise(resolve=>setTimeout(resolve,10));}
 assert.equal(status.state,'blocked',JSON.stringify(status));assert.equal(status.error,'EEXIST');assert.deepEqual(await fs.readFile(temporary),existing);
 assert.deepEqual(await fs.readFile(quarantine),bytes);await assert.rejects(fs.lstat(original),{code:'ENOENT'});
 assert.equal((await fs.stat(path.join(f.data,'recovery-restore-fence.json'))).isFile(),true,'uncertain operation stays fenced for explicit reconciliation');
});

test('a destination created after the final eligibility check is preserved by exclusive install',{skip:process.platform!=='linux'?'Requires /dev/shm on a separate Linux filesystem':false},async t=>{
 const caseId='6'.repeat(24),{f,original,quarantine,bytes}=await crossDeviceFixture(t,caseId),eligibility=await f.get(`/api/recovery/cases/${caseId}/restore-original`);
 let commandReads=0;const gate=f.hold('/api/v3/command/84',()=>++commandReads===2);
 const accepted=await f.post(`/api/recovery/cases/${caseId}/restore-original`,{confirm:true,snapshot:eligibility.snapshot,attempt:eligibility.attempt});assert.equal(accepted.status,202,await accepted.clone().text());
 await gate.entered;const newer=Buffer.from('newer copy created during the last eligibility read');await fs.writeFile(original,newer);gate.release();
 const status=await waitFor(async()=>{const value=await f.get(`/api/recovery/cases/${caseId}/restore-original/status`);return value.state==='blocked'&&value;},'exclusive install did not block on the raced destination');
 assert.deepEqual(await fs.readFile(original),newer,'install does not replace a file that appeared after preflight');assert.equal(status.error,'restore_destination_occupied',JSON.stringify(status));
 assert.deepEqual(await fs.readFile(quarantine),bytes,'the preserved source remains available after the refused install');
 assert.equal((await fs.stat(path.join(f.data,'recovery-restore-fence.json'))).isFile(),true,'the uncertain file effect remains fenced for reconciliation');
});

test('a changed private case snapshot is rejected before fencing or file effects',{skip:process.platform!=='linux'?'Requires /dev/shm on a separate Linux filesystem':false},async t=>{
 const caseId='e'.repeat(24),{f,original,quarantine,bytes}=await crossDeviceFixture(t,caseId),view=await f.get(`/api/recovery/cases/${caseId}/restore-original`);
 const stateFile=path.join(f.data,'recovery','state.json'),state=JSON.parse(await fs.readFile(stateFile,'utf8'));state.cases[caseId].binding.movieFileId++;
 await fs.writeFile(stateFile,JSON.stringify(state));
 const changed=await f.get(`/api/recovery/cases/${caseId}/restore-original`);assert.notEqual(changed.snapshot,view.snapshot);
 const refused=await f.post(`/api/recovery/cases/${caseId}/restore-original`,{confirm:true,snapshot:view.snapshot,attempt:view.attempt});
 assert.equal(refused.status,409);assert.equal((await refused.json()).code,'restore_snapshot_changed');
 await assert.rejects(fs.lstat(original),{code:'ENOENT'});assert.deepEqual(await fs.readFile(quarantine),bytes);
 await assert.rejects(fs.lstat(path.join(f.data,'recovery-restore-fence.json')),{code:'ENOENT'});
});

test('explicit reconciliation releases a proven unchanged Off-mode operation after a changed Radarr binding',{skip:process.platform!=='linux'?'Requires /dev/shm on a separate Linux filesystem':false},async t=>{
 const caseId='f'.repeat(24),{f,original,quarantine,bytes}=await crossDeviceFixture(t,caseId),view=await f.get(`/api/recovery/cases/${caseId}/restore-original`);
 let commandReads=0;const gate=f.hold('/api/v3/command/84',()=>++commandReads===2);
 const accepted=await f.post(`/api/recovery/cases/${caseId}/restore-original`,{confirm:true,snapshot:view.snapshot,attempt:view.attempt});assert.equal(accepted.status,202);
 await gate.entered;f.setRadarrMovie({id:71,tmdbId:1234,path:'/fixture-library/A',movieFileId:null});gate.release();
 let status;for(let i=0;i<150;i++){status=await f.get(`/api/recovery/cases/${caseId}/restore-original/status`);if(status.state==='blocked')break;await new Promise(resolve=>setTimeout(resolve,10));}
 assert.equal(status.state,'blocked');assert.equal((await fs.stat(path.join(f.data,'recovery-restore-fence.json'))).isFile(),true);
 assert.deepEqual(await fs.readFile(quarantine),bytes);await assert.rejects(fs.lstat(original),{code:'ENOENT'});
 f.setRadarrMovie({id:71,tmdbId:9001,path:'/fixture-library/A',movieFileId:null});
 const blockedStatus=await f.get(`/api/recovery/cases/${caseId}/restore-original/status`);
 const reconciled=await f.post(`/api/recovery/cases/${caseId}/restore-original/reconcile`,{confirm:true,operationId:blockedStatus.operationId,revision:blockedStatus.revision});assert.equal(reconciled.status,200,await reconciled.clone().text());
 const cancelled=await reconciled.json();assert.equal(cancelled.state,'cancelled');await assert.rejects(fs.lstat(path.join(f.data,'recovery-restore-fence.json')),{code:'ENOENT'});
 assert.deepEqual(await fs.readFile(quarantine),bytes);await assert.rejects(fs.lstat(original),{code:'ENOENT'});
 const cancelledStatus=await f.get(`/api/recovery/cases/${caseId}/restore-original/status`),journal=path.join(f.data,'recovery-restores',caseId+'.json'),journalBefore=await fs.readFile(journal);
 const replay=await f.post(`/api/recovery/cases/${caseId}/restore-original/reconcile`,{confirm:true,operationId:cancelledStatus.operationId,revision:cancelledStatus.revision});
 assert.equal(replay.status,200,await replay.clone().text());assert.deepEqual(await replay.json(),cancelledStatus,'cancelled reconciliation is an idempotent read');
 assert.deepEqual(await fs.readFile(journal),journalBefore,'terminal replay leaves the closed journal unchanged');
 const duplicate=await f.post(`/api/recovery/cases/${caseId}/restore-original`,{confirm:true,snapshot:view.snapshot,attempt:view.attempt});assert.equal(duplicate.status,409,'the pre-cancellation token cannot start another attempt');
 const fresh=await f.get(`/api/recovery/cases/${caseId}/restore-original`);assert.equal(fresh.eligible,true,JSON.stringify(fresh));
 const retry=await f.post(`/api/recovery/cases/${caseId}/restore-original`,{confirm:true,snapshot:fresh.snapshot,attempt:fresh.attempt});assert.equal(retry.status,202,await retry.clone().text());
 const retryAccepted=await retry.json();assert.notEqual(retryAccepted.operationId,cancelledStatus.operationId);
 const retryStatus=await waitFor(async()=>{const value=await f.get(`/api/recovery/cases/${caseId}/restore-original/status`);return ['completed','blocked'].includes(value.state)&&value;},'freshly confirmed retry did not settle');
 assert.equal(retryStatus.state,'completed',JSON.stringify(retryStatus));
 const currentJournal=path.join(f.data,'recovery-restores',caseId+'.json'),currentBefore=await fs.readFile(currentJournal);
 const archivedReplay=await f.post(`/api/recovery/cases/${caseId}/restore-original/reconcile`,{confirm:true,operationId:cancelledStatus.operationId,revision:cancelledStatus.revision});
 assert.equal(archivedReplay.status,200,await archivedReplay.clone().text());assert.equal((await archivedReplay.json()).state,'cancelled');
 assert.deepEqual(await fs.readFile(currentJournal),currentBefore,'an archived terminal replay cannot rewrite the newer operation');
 assert.equal((await f.get(`/api/recovery/cases/${caseId}/restore-original/status`)).operationId,retryStatus.operationId);
});

test('explicit reconciliation finishes an interrupted exact install without losing the last source link',{skip:process.platform!=='linux'?'Requires /dev/shm on a separate Linux filesystem':false},async t=>{
 for(const crossDevice of [false,true]){
  const caseId=(crossDevice?'8':'7').repeat(24),fixture=crossDevice?await crossDeviceFixture(t,caseId):await reviewFixture({env:{RECOVERY_MODE:'off'},beforeStart:async({data,media,root,dbpath,mockBase})=>{
   const external=path.join(root,'quarantine'),quarantine=path.join(external,caseId,'A.mkv'),original=path.join(media,'A','A.mkv');await fs.mkdir(path.dirname(quarantine),{recursive:true});await fs.rename(original,quarantine);
   const fp=identityOf(await fs.stat(quarantine)),recoveryData=path.join(data,'recovery');await fs.mkdir(recoveryData,{recursive:true});
   await fs.writeFile(path.join(recoveryData,'config.json'),JSON.stringify({enabled:false,tdarrUrl:mockBase,radarrUrl:mockBase,radarrApiKey:'synthetic-key',libraryId:'fixture-library',sourceRoot:'/fixture-library',radarrRoot:'/fixture-library',mediaRoot:media,reviewRoot:path.join(root,'review'),reviewPrefixes:['PROD-Movies'],quarantineRoot:external,database:dbpath,reports:path.join(root,'reports'),ffmpeg:process.execPath,ffprobe:process.execPath,stableMinutes:10,decodeTimeoutHours:12,fullSourceHash:false,confirmDelaySeconds:30,maxRepairsPerDay:3,movieCooldownDays:30,pollSeconds:300,detectTerminalHeaders:true,since:0,approvedCaseIds:[],approvedImportRepairs:{}}));
   const outside='2026-10-24T09:00:00.000Z',updated='2026-10-24T10:03:00.000Z';await fs.writeFile(path.join(recoveryData,'state.json'),JSON.stringify({version:1,jobs:{},cases:{[caseId]:{id:caseId,status:'manual',file:'/fixture-library/A/A.mkv',source:original,relative:'A/A.mkv',fp,preservedSourceFP:fp,quarantine,movieId:71,tmdbId:9001,binding:{movieFileId:72},originalOutsideSince:outside,searchCommand:84,updated}}}));
   await fs.writeFile(path.join(root,'.tdarr-recovery-status.json'),JSON.stringify({version:1,updated,cases:[{id:caseId,title:'A',phase:'manual',source:'recovery',updated,tmdbId:9001}]}));
  }});
  const f=crossDevice?fixture.f:fixture;if(!crossDevice)t.after(()=>f.close());
  const original=crossDevice?fixture.original:f.files.get('A').original,source=crossDevice?fixture.quarantine:path.join(f.root,'quarantine',caseId,'A.mkv'),bytes=await fs.readFile(source),operationId='00000000-0000-4000-8000-'+(crossDevice?'000000000018':'000000000017');
  if(crossDevice)await fs.copyFile(source,original);else await fs.link(source,original);
  const journal=path.join(f.data,'recovery-restores',caseId+'.json');await fs.mkdir(path.dirname(journal),{recursive:true});
  const record=await interruptedRecord({f,caseId,operationId,source,destination:original,bytes,crossDevice,phase:crossDevice?'installing':'destination-installed'});
  await fs.writeFile(journal,JSON.stringify(record));await fs.writeFile(path.join(f.data,'recovery-restore-fence.json'),JSON.stringify({version:1,kind:'recovery-original-restore',operationId,caseId,blocking:true,restartAuthorized:false}));
  const current=await f.get(`/api/recovery/cases/${caseId}/restore-original/status`);
  const response=await f.post(`/api/recovery/cases/${caseId}/restore-original/reconcile`,{confirm:true,operationId:current.operationId,revision:current.revision});assert.equal(response.status,200,JSON.stringify({body:await response.clone().text(),status:await f.get(`/api/recovery/cases/${caseId}/restore-original/status`)}));assert.equal((await response.json()).state,'completed');
  assert.deepEqual(await fs.readFile(original),bytes);assert.equal((await fs.stat(original)).nlink,1);await assert.rejects(fs.lstat(source),{code:'ENOENT'});await assert.rejects(fs.lstat(path.join(f.data,'recovery-restore-fence.json')),{code:'ENOENT'});
 }
});

test('reconciliation refuses forged paths and missing file-effect proof without touching any copy',{skip:process.platform!=='linux'?'Requires /dev/shm on a separate Linux filesystem':false},async t=>{
 for(const tamper of ['source-path','destination-path','missing-proof']){
  const caseId=({'source-path':'9','destination-path':'a','missing-proof':'b'}[tamper]).repeat(24),{f,original,quarantine,external,bytes}=await crossDeviceFixture(t,caseId);
  const operationId='00000000-0000-4000-8000-'+({'source-path':'000000000019','destination-path':'000000000020','missing-proof':'000000000021'}[tamper]);
  let source=quarantine,destination=original;
  if(tamper==='source-path'){
   source=path.join(external,'forged-source.mkv');await fs.copyFile(quarantine,source);await fs.copyFile(source,original);
  }else if(tamper==='destination-path'){
   destination=path.join(f.root,'forged-destination.mkv');await fs.copyFile(quarantine,destination);
  }else await fs.copyFile(quarantine,original);
  const record=await interruptedRecord({f,caseId,operationId,source,destination,bytes,crossDevice:true,phase:'installing'});
  if(tamper==='missing-proof')delete record.caseRevision;
  await fs.mkdir(path.dirname(record.journal),{recursive:true});await fs.writeFile(record.journal,JSON.stringify(record));
  await fs.writeFile(path.join(f.data,'recovery-restore-fence.json'),JSON.stringify({version:1,kind:'recovery-original-restore',operationId,caseId,blocking:true,restartAuthorized:false}));
  const current=await f.get(`/api/recovery/cases/${caseId}/restore-original/status`);
  const rejected=await f.post(`/api/recovery/cases/${caseId}/restore-original/reconcile`,{confirm:true,operationId:current.operationId,revision:current.revision});assert.equal(rejected.status,409,JSON.stringify(await rejected.clone().text()));
  const expected=tamper==='missing-proof'?'restore_journal_unproven':'restore_case_binding_changed';assert.equal((await rejected.json()).code,expected);
  assert.deepEqual(await fs.readFile(quarantine),bytes,'the Recovery quarantine remains untouched');
  if(tamper==='source-path'){assert.deepEqual(await fs.readFile(source),bytes);assert.deepEqual(await fs.readFile(original),bytes);}
  else if(tamper==='destination-path'){assert.deepEqual(await fs.readFile(destination),bytes);await assert.rejects(fs.lstat(original),{code:'ENOENT'});}
  else assert.deepEqual(await fs.readFile(original),bytes,'the unproven installed copy remains untouched');
 }
});

test('supervised HTTP restore drains and restarts the real worker in its original Verify and Repair modes',{skip:process.platform!=='linux'?'Requires Linux supervisor signals and directory fsync':false},async t=>{
 for(const [mode,key] of [['verify','c'],['repair','d']]){
  const caseId=key.repeat(24),{f,original,quarantine,bytes}=await crossDeviceFixture(t,caseId,{mode,supervisor:true});
  const started=()=>f.output().split('Tdarr recovery started; mode='+mode).length-1;
  await waitFor(async()=>started()===1,'initial '+mode+' Recovery worker did not become ready');
  const beforeRuntime=await f.get('/api/recovery/runtime');assert.equal(beforeRuntime.mode,mode);assert.equal(beforeRuntime.state,'running');
  const eligible=await f.get(`/api/recovery/cases/${caseId}/restore-original`);assert.equal(eligible.eligible,true,JSON.stringify(eligible));
  const accepted=await f.post(`/api/recovery/cases/${caseId}/restore-original`,{confirm:true,snapshot:eligible.snapshot,attempt:eligible.attempt});assert.equal(accepted.status,202,await accepted.clone().text());
  const status=await waitFor(async()=>{const value=await f.get(`/api/recovery/cases/${caseId}/restore-original/status`);return ['completed','blocked'].includes(value.state)&&value;},mode+' restore did not settle');
  assert.equal(status.state,'completed',JSON.stringify(status));assert.equal(status.workerState,'running');
  assert.deepEqual(await fs.readFile(original),bytes);await assert.rejects(fs.lstat(quarantine),{code:'ENOENT'});
  await waitFor(async()=>started()===2,mode+' Recovery worker was not restarted');
  const afterRuntime=await f.get('/api/recovery/runtime');assert.equal(afterRuntime.mode,mode);assert.equal(afterRuntime.state,'running');
  assert.equal((await f.get(`/api/recovery/cases/${caseId}/restore-original/status`)).state,'completed');
 }
});

test('supervised HTTP restore keeps its fence after a lost restart reply and reconciles the running worker without changing mode',{skip:process.platform!=='linux'?'Requires Linux supervisor signals and directory fsync':false},async t=>{
 const caseId='e'.repeat(24),{f,original,quarantine,bytes,dropAckFile}=await crossDeviceFixture(t,caseId,{mode:'verify',supervisor:true,loseRestartAck:true});
 const started=()=>f.output().split('Tdarr recovery started; mode=verify').length-1;
 await waitFor(async()=>started()===1,'initial Verify worker did not become ready');
 const eligible=await f.get(`/api/recovery/cases/${caseId}/restore-original`);
 const accepted=await f.post(`/api/recovery/cases/${caseId}/restore-original`,{confirm:true,snapshot:eligible.snapshot,attempt:eligible.attempt});assert.equal(accepted.status,202,await accepted.clone().text());
 const blocked=await waitFor(async()=>{const value=await f.get(`/api/recovery/cases/${caseId}/restore-original/status`);return value.state==='blocked'&&value;},'lost restart acknowledgement did not leave an explicit blocked result');
 assert.equal(blocked.error,'recovery_control_unavailable',JSON.stringify(blocked));await fs.access(dropAckFile);
 assert.deepEqual(await fs.readFile(original),bytes);await assert.rejects(fs.lstat(quarantine),{code:'ENOENT'});
 assert.equal((await fs.stat(path.join(f.data,'recovery-restore-fence.json'))).isFile(),true,'uncertain response retains the startup fence');
 await waitFor(async()=>started()===2,'worker restart after the dropped reply was not observed');
 const running=await f.get('/api/recovery/runtime');assert.equal(running.mode,'verify');assert.equal(running.state,'running');
 const blockedStatus=await f.get(`/api/recovery/cases/${caseId}/restore-original/status`);
 const reconciled=await f.post(`/api/recovery/cases/${caseId}/restore-original/reconcile`,{confirm:true,operationId:blockedStatus.operationId,revision:blockedStatus.revision});assert.equal(reconciled.status,200,await reconciled.clone().text());
 assert.equal((await reconciled.json()).state,'completed');await assert.rejects(fs.lstat(path.join(f.data,'recovery-restore-fence.json')),{code:'ENOENT'});
 const after=await f.get('/api/recovery/runtime');assert.equal(after.mode,'verify');assert.equal(after.state,'running');
 assert.deepEqual(await fs.readFile(original),bytes);await assert.rejects(fs.lstat(quarantine),{code:'ENOENT'});
});
