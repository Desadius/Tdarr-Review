import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {publishApproval,retainCase} from './quarantine-retention.mjs';import {identityOf} from './file-identity.mjs';import {classify,confirmed} from './policy.mjs';
async function setup(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'tdarr-retention-')),mediaRoot=path.join(root,'movies'),quarantineRoot=path.join(root,'.tdarr-corrupt');await fs.mkdir(mediaRoot);await fs.mkdir(path.join(quarantineRoot,'case'),{recursive:true});const file=path.join(quarantineRoot,'case','bad.mkv'),installed=path.join(mediaRoot,'new.mkv');await fs.writeFile(file,'old film');await fs.writeFile(installed,'approved film');const c={id:'case',quarantine:file,fp:identityOf(await fs.stat(file)),replacementRelative:'new.mkv',replacementSourceFP:'source-fingerprint'};const atomic=async(p,v)=>{await fs.writeFile(p,JSON.stringify(v))};return {root,mediaRoot,quarantineRoot,file,installed,c,atomic,atomicCase:async()=>{}};}
for(const kind of ['unapproved','before deadline','expired','changed replacement','changed quarantine','outside quarantine'])test(kind,async()=>{const s=await setup();try{if(kind!=='unapproved')await publishApproval({...s,relative:'new.mkv',sourceFP:s.c.replacementSourceFP,installedRelative:'new.mkv'});if(kind==='changed replacement')await fs.appendFile(s.installed,' changed');if(kind==='changed quarantine')await fs.appendFile(s.file,' changed');if(kind==='outside quarantine'){s.c.quarantine=s.installed;s.c.fp=identityOf(await fs.stat(s.installed));}const run=()=>retainCase(s.c,{...s,now:Date.now()+(kind==='before deadline'?0:8*86400000)});if(kind.startsWith('changed')||kind==='outside quarantine')await assert.rejects(run);else await run();if(kind==='expired')await assert.rejects(fs.stat(s.file),{code:'ENOENT'});else assert.ok((await fs.stat(s.file)).isFile());assert.ok((await fs.stat(s.installed)).isFile());}finally{await fs.rm(s.root,{recursive:true,force:true})}});
test('exit zero with repeatable TrueHD decode errors is not healthy',()=>{const a={code:0,stderr:'[truehd @ 0x123] quant_step_size larger than huff_lsbs'},b={code:0,stderr:'[truehd @ 0x456] quant_step_size larger than huff_lsbs'};assert.equal(classify(a).kind,'corrupt');assert.ok(confirmed(a,b));});
test('timeouts, permissions and unknown stderr cannot trigger replacements',()=>{assert.equal(classify({code:0,stderr:''}).kind,'healthy');assert.equal(classify({code:0,stderr:'unknown error'}).kind,'unconfirmed');for(const r of [{code:1,timeout:true,stderr:'quant_step_size larger than huff_lsbs'},{code:1,stderr:'Permission denied quant_step_size larger than huff_lsbs'}])assert.equal(classify(r).kind,'operational');});

 test('metadata-only changes keep quarantine and produce a distinct diagnostic without resetting approval',{skip:process.platform==='win32'?'POSIX ctime semantics required':false},async()=>{
 const s=await setup();try{
 await publishApproval({...s,relative:'new.mkv',sourceFP:s.c.replacementSourceFP,installedRelative:'new.mkv'});
 await retainCase(s.c,{...s,now:Date.now()});const approval=structuredClone(s.c.cleanup);
 await new Promise(r=>setTimeout(r,30));const mode=(await fs.stat(s.installed)).mode&0o777;await fs.chmod(s.installed,mode===0o600?0o640:0o600);
 await assert.rejects(retainCase(s.c,{...s,now:Date.now()+8*86400000}),/metadata timestamp changed/);
 assert.deepEqual(s.c.cleanup,approval);assert.ok((await fs.stat(s.file)).isFile());
 }finally{await fs.rm(s.root,{recursive:true,force:true})}
 });

test('cleanup deadline and the published retention rules come from one policy',async()=>{
 const {quarantineRetention}=await import('./quarantine-retention.mjs');
 assert.ok(Object.isFrozen(quarantineRetention));
 assert.ok(Number.isInteger(quarantineRetention.retentionDays)&&quarantineRetention.retentionDays>0);assert.equal(typeof quarantineRetention.cleanupEnabled,'boolean');
 const s=await setup();try{
  await publishApproval({...s,relative:'new.mkv',sourceFP:s.c.replacementSourceFP,installedRelative:'new.mkv'});
  await retainCase(s.c,{...s,now:Date.now()});
  assert.equal(Date.parse(s.c.cleanup.deleteAfter)-Date.parse(s.c.cleanup.approvedAt),quarantineRetention.retentionDays*86400000);
 }finally{await fs.rm(s.root,{recursive:true,force:true})}
});

test('a preserved file the user deleted through Review ends retention without an error; any other missing file still fails',async()=>{
 const s=await setup();try{
  const fp=s.c.fp;await publishApproval({...s,relative:'new.mkv',sourceFP:s.c.replacementSourceFP,installedRelative:'new.mkv'});
  await retainCase(s.c,{...s,now:Date.now()});await fs.rm(s.file);
  await assert.rejects(retainCase(s.c,{...s,now:Date.now()+8*86400000}),{code:'ENOENT'},'an unexplained missing file is a retention error');
  const asked=[];const deletedByUser=async(file,identity)=>{asked.push([file,identity]);return file===s.file&&identity===fp;};
  await retainCase(s.c,{...s,deletedByUser,now:Date.now()+8*86400000});
  assert.deepEqual(asked,[[s.file,fp]]);
 }finally{await fs.rm(s.root,{recursive:true,force:true})}
});

test('when the user deleted every preserved file, a changed approved copy no longer reports a retention error',{skip:process.platform==='win32'?'POSIX ctime semantics required':false},async()=>{
 const s=await setup();try{
  await publishApproval({...s,relative:'new.mkv',sourceFP:s.c.replacementSourceFP,installedRelative:'new.mkv'});
  await retainCase(s.c,{...s,now:Date.now()});
  await new Promise(r=>setTimeout(r,30));await fs.chmod(s.installed,0o640);
  await assert.rejects(retainCase(s.c,{...s,now:Date.now()+8*86400000}),/metadata timestamp changed/);
  await fs.rm(s.file);
  await retainCase(s.c,{...s,deletedByUser:async()=>true,now:Date.now()+8*86400000});
  await assert.rejects(retainCase(s.c,{...s,deletedByUser:async()=>false,now:Date.now()+8*86400000}),/metadata timestamp changed/);
 }finally{await fs.rm(s.root,{recursive:true,force:true})}
});

test('a case recorded without the replacement identity is keyed by Radarr\'s record of the imported file (#280)',async()=>{
 const {approvalKey}=await import('./quarantine-retention.mjs');
 const replacement={movieFileId:11,path:'/radarr/movies/new.mkv',size:13};
 assert.deepEqual(approvalKey({replacementRelative:'new.mkv',replacement}),{relative:'new.mkv',sourceFP:'radarr-file:11:13',legacy:true});
 assert.deepEqual(approvalKey({replacementRelative:'new.mkv',replacementSourceFP:'1:2:3:4:5',replacement}),{relative:'new.mkv',sourceFP:'1:2:3:4:5'},'a recorded identity always wins');
 for(const r of [null,{...replacement,movieFileId:0},{...replacement,size:-1},{...replacement,path:'/radarr/movies/other.mkv'},{...replacement,path:'/radarr/movies/xnew.mkv'}])assert.equal(approvalKey({replacementRelative:'new.mkv',replacement:r}),null,JSON.stringify(r));
 assert.equal(approvalKey({replacement}),null);
 const s=await setup();try{
  delete s.c.replacementSourceFP;s.c.replacement={...replacement,size:(await fs.stat(s.installed)).size};
  await publishApproval({...s,relative:'new.mkv',sourceFP:'source-fingerprint',installedRelative:'new.mkv'});
  await retainCase(s.c,{...s,now:Date.now()+8*86400000});assert.equal(s.c.cleanup,undefined,'evidence under another key does not start retention');
  await publishApproval({...s,relative:'new.mkv',sourceFP:approvalKey(s.c).sourceFP,installedRelative:'new.mkv'});
  await retainCase(s.c,{...s,now:Date.now()+8*86400000});await assert.rejects(fs.stat(s.file),{code:'ENOENT'});assert.ok((await fs.stat(s.installed)).isFile());
 }finally{await fs.rm(s.root,{recursive:true,force:true})}
});
