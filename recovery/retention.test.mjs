import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {publishApproval,retainCase,fp} from './quarantine-retention.mjs';import {classify,confirmed} from './policy.mjs';
async function setup(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'tdarr-retention-')),mediaRoot=path.join(root,'movies'),quarantineRoot=path.join(root,'.tdarr-corrupt');await fs.mkdir(mediaRoot);await fs.mkdir(path.join(quarantineRoot,'case'),{recursive:true});const file=path.join(quarantineRoot,'case','bad.mkv'),installed=path.join(mediaRoot,'new.mkv');await fs.writeFile(file,'old film');await fs.writeFile(installed,'approved film');const c={id:'case',quarantine:file,fp:fp(await fs.stat(file)),replacementRelative:'new.mkv',replacementSourceFP:'source-fingerprint'};const atomic=async(p,v)=>{await fs.writeFile(p,JSON.stringify(v))};return {root,mediaRoot,quarantineRoot,file,installed,c,atomic,atomicCase:async()=>{}};}
for(const kind of ['unapproved','before deadline','expired','changed replacement','changed quarantine','outside quarantine'])test(kind,async()=>{const s=await setup();try{if(kind!=='unapproved')await publishApproval({...s,relative:'new.mkv',sourceFP:s.c.replacementSourceFP,installedRelative:'new.mkv'});if(kind==='changed replacement')await fs.appendFile(s.installed,' changed');if(kind==='changed quarantine')await fs.appendFile(s.file,' changed');if(kind==='outside quarantine'){s.c.quarantine=s.installed;s.c.fp=fp(await fs.stat(s.installed));}const run=()=>retainCase(s.c,{...s,now:Date.now()+(kind==='before deadline'?0:8*86400000)});if(kind.startsWith('changed')||kind==='outside quarantine')await assert.rejects(run);else await run();if(kind==='expired')await assert.rejects(fs.stat(s.file),{code:'ENOENT'});else assert.ok((await fs.stat(s.file)).isFile());assert.ok((await fs.stat(s.installed)).isFile());}finally{await fs.rm(s.root,{recursive:true,force:true})}});
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

test('cleanup deadline and the published retention rules come from one policy shared by Review and Recovery',async()=>{
 const review=await import('../review/quarantine-retention.mjs');const {quarantineRetention}=await import('./quarantine-retention.mjs');
 assert.deepEqual(review.quarantineRetention,quarantineRetention);assert.ok(Object.isFrozen(quarantineRetention));
 assert.ok(Number.isInteger(quarantineRetention.retentionDays)&&quarantineRetention.retentionDays>0);assert.equal(typeof quarantineRetention.cleanupEnabled,'boolean');
 const s=await setup();try{
  await publishApproval({...s,relative:'new.mkv',sourceFP:s.c.replacementSourceFP,installedRelative:'new.mkv'});
  await retainCase(s.c,{...s,now:Date.now()});
  assert.equal(Date.parse(s.c.cleanup.deleteAfter)-Date.parse(s.c.cleanup.approvedAt),quarantineRetention.retentionDays*86400000);
 }finally{await fs.rm(s.root,{recursive:true,force:true})}
});
