import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {hashFile,hashCommand,lowPriorityHash} from './full-hash.mjs';

const self=fileURLToPath(new URL('./full-hash.mjs',import.meta.url));
async function withFile(bytes,run){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'recovery-hash-'));const file=path.join(dir,'film.mkv');await fs.writeFile(file,bytes);try{await run(file)}finally{await fs.rm(dir,{recursive:true,force:true})}}
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

test('the full hash covers every byte, including regions the 3 × 1 MiB sampling skips',async()=>{
 const a=Buffer.alloc(5*1024*1024,7),b=Buffer.from(a);b[2*1024*1024+17]^=1;
 for(const bytes of [a,b])await withFile(bytes,async file=>{
  const progress=[];assert.equal(await hashFile(file,{onProgress:p=>progress.push(p),chunkSize:1024*1024}),digest(bytes));
  assert.deepEqual(progress.at(-1),{done:bytes.length,total:bytes.length});assert.ok(progress.length>=5);
 });
 assert.notEqual(digest(a),digest(b));
});

test('the child process runs at idle I/O and lowest CPU priority when ionice and nice exist',()=>{
 assert.deepEqual(hashCommand('/m/f.mkv',{platform:'linux',exists:()=>true,node:'/usr/bin/node'}),['/usr/bin/ionice',['-c','3','/usr/bin/nice','-n','19','/usr/bin/node',self,'/m/f.mkv']]);
 assert.deepEqual(hashCommand('/m/f.mkv',{platform:'linux',exists:()=>false,node:'/usr/bin/node'}),['/usr/bin/node',[self,'/m/f.mkv']]);
 assert.deepEqual(hashCommand('C:/f.mkv',{platform:'win32',exists:()=>true,node:'node'}),['node',[self,'C:/f.mkv']]);
});

test('the low-priority child returns the digest and reports progress',async()=>{
 const bytes=Buffer.from('DISPOSABLE SOURCE BYTES '.repeat(1000));
 await withFile(bytes,async file=>{
  const progress=[];
  const sha=await lowPriorityHash(file,{onProgress:p=>progress.push(p),command:[process.execPath,[self,file]]});
  assert.equal(sha,digest(bytes));assert.deepEqual(progress.at(-1),{done:bytes.length,total:bytes.length});
 });
});

test('a missing file or a failing child never yields a digest',async()=>{
 await assert.rejects(lowPriorityHash(path.join(os.tmpdir(),'missing-'+crypto.randomUUID()+'.mkv'),{command:[process.execPath,[self,path.join(os.tmpdir(),'missing.mkv')]]}),/Full source hash failed/);
 await assert.rejects(lowPriorityHash('x',{command:[process.execPath,['-e','console.log(JSON.stringify({sha256:"'+'a'.repeat(64)+'"}));process.exit(3)']]}),/exit 3/);
 await assert.rejects(lowPriorityHash('x',{command:[process.execPath,['-e','console.log(JSON.stringify({sha256:"not-a-digest"}))']]}),/Full source hash failed/);
});

test('the worker hashes at confirmation and compares again before any mutation and the rename',async()=>{
 const worker=await fs.readFile(new URL('./worker.mjs',import.meta.url),'utf8');
 const confirm=worker.indexOf("if(cfg.fullSourceHash===true&&!c.evidence.fullSHA256){c.evidence.fullSHA256=await fullSourceHash(c,'confirmation')"),confirmed=worker.indexOf("await phase(c,'confirmed'");
 assert.ok(confirm>0&&confirm<confirmed,'hash before the case is confirmed');
 const compare=worker.indexOf("if(await fullSourceHash(c,'before_quarantine')!==c.evidence.fullSHA256)throw Error('Full source hash changed before quarantine')"),rename=worker.indexOf('await fs.rename(c.source,c.quarantine)'),hold=worker.indexOf("TranscodeDecisionMaker:'Hold'",worker.indexOf("await phase(c,'holding'")),floor=worker.indexOf('if(isApprovedCase(c))await ensureApprovedFloor(c,movie);');
 assert.ok(compare>0&&compare<floor&&floor<hold&&hold<rename,'hash before the first Radarr/Tdarr mutation, so an interrupted hash leaves no Hold');
 assert.ok(worker.indexOf("if((await safeSource(c.relative)).fp!==c.fp||await sample(c.source)!==hash)throw Error('Source changed before quarantine')")>compare,'fingerprint and samples are rechecked after the long hash');
 const exported=await fs.readFile(new URL('./waiting-source.mjs',import.meta.url),'utf8');assert.match(exported,/fullHash:c\.fullHash\?\{stage:c\.fullHash\.stage,done:c\.fullHash\.done,total:c\.fullHash\.total/);
});
