import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {safeFile,fingerprint,replaceChecked,inspect,recoverTransactions} from './core.mjs';

test('path traversal, symlinks and unsupported nesting are rejected',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-test-'));
 try {await fs.writeFile(path.join(root,'film.mkv'),'original');await fs.symlink('/etc/passwd',path.join(root,'link.mkv'));await assert.rejects(safeFile(root,'../film.mkv'));await assert.rejects(safeFile(root,'link.mkv'));}finally{await fs.rm(root,{recursive:true,force:true})}
});
test('approval replaces only the selected original and cleans completed transaction',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-test-'));
 try {const original=path.join(root,'movie.mkv'),review=path.join(root,'review.mkv'),journal=path.join(root,'transaction.json');await fs.writeFile(original,'original film');await fs.writeFile(review,'new film');await fs.writeFile(path.join(root,'other.mkv'),'keep');
 const updates=[];await replaceChecked({original,review,journal,originalFP:fingerprint(await fs.stat(original)),reviewFP:fingerprint(await fs.stat(review)),onProgress:p=>updates.push(p)});assert(updates.some(p=>p.phase==='preparing'&&p.done===8&&p.total===8));assert(updates.some(p=>p.phase==='verifying-copy'&&p.done===16&&p.total===16));assert.equal(await fs.readFile(original,'utf8'),'new film');assert.equal(await fs.readFile(path.join(root,'other.mkv'),'utf8'),'keep');await assert.rejects(fs.stat(review));assert.equal(JSON.parse(await fs.readFile(journal)).phase,'complete');assert.equal((await fs.readdir(root)).filter(n=>n.endsWith('.old')||n.endsWith('.tmp')).length,0)
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
test('changed source and interrupted commit never overwrite original',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-test-'));
 try{const original=path.join(root,'movie.mkv'),review=path.join(root,'review.mkv'),journal=path.join(root,'transaction.json');await fs.writeFile(original,'original');await fs.writeFile(review,'new');const originalFP=fingerprint(await fs.stat(original)),reviewFP=fingerprint(await fs.stat(review));
 await assert.rejects(replaceChecked({original,review,journal,originalFP,reviewFP,beforeCommit:async()=>{throw new Error('Tdarr started')}}));assert.equal(await fs.readFile(original,'utf8'),'original');assert.equal(await fs.readFile(review,'utf8'),'new');assert.equal((await fs.readdir(root)).filter(n=>n.endsWith('.old')||n.endsWith('.tmp')).length,0);
 assert.equal(JSON.parse(await fs.readFile(journal,'utf8')).phase,'aborted');assert.deepEqual(await recoverTransactions(root),[]);
 await fs.writeFile(original,'changed');await assert.rejects(replaceChecked({original,review,journal,originalFP,reviewFP}));assert.equal(await fs.readFile(original,'utf8'),'changed');
 }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('failed swap rolls back the exact original and records a terminal abort',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-test-'));
 try{
  const original=path.join(root,'movie.mkv'),review=path.join(root,'review.mkv'),journal=path.join(root,'transaction.json');
  await fs.writeFile(original,'original film');await fs.writeFile(review,'new film');
  await assert.rejects(replaceChecked({original,review,journal,originalFP:fingerprint(await fs.stat(original)),reviewFP:fingerprint(await fs.stat(review)),onStage:phase=>{if(phase==='original-backed-up')throw new Error('Simulated failure before installation')}}));
  assert.equal(await fs.readFile(original,'utf8'),'original film');assert.equal(await fs.readFile(review,'utf8'),'new film');
  assert.equal((await fs.stat(original)).nlink,1);assert.equal(JSON.parse(await fs.readFile(journal,'utf8')).phase,'aborted');
  assert.deepEqual(await recoverTransactions(root),[]);
 }finally{await fs.rm(root,{recursive:true,force:true})}
});

async function recoveryFixture(root,phase){
 const id='fixture',original=path.join(root,'movie.mkv'),review=path.join(root,'review.mkv'),tmp=path.join(root,`.tdarr-review-${id}.tmp`),backup=path.join(root,`.tdarr-review-${id}.old`),journal=path.join(root,'transaction.json');
 await fs.writeFile(original,'original film');await fs.writeFile(review,'new film');await fs.copyFile(review,tmp);
 const record={id,original,review,tmp,backup,originalFP:fingerprint(await fs.stat(original)),reviewFP:fingerprint(await fs.stat(review)),phase};
 await fs.writeFile(journal,JSON.stringify(record));return {...record,journal};
}

test('restart restores a missing original before installation without replaying approval',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-test-'));
 try{
  const f=await recoveryFixture(root,'ready');await fs.rename(f.original,f.backup);
  assert.deepEqual(await recoverTransactions(root),[]);
  assert.equal(await fs.readFile(f.original,'utf8'),'original film');assert.equal((await fs.stat(f.original)).nlink,1);
  assert.equal(await fs.readFile(f.review,'utf8'),'new film');assert.equal(await fs.readFile(f.tmp,'utf8'),'new film');
  assert.equal(JSON.parse(await fs.readFile(f.journal,'utf8')).phase,'aborted');assert.deepEqual(await recoverTransactions(root),[]);
 }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('restart preserves an installed result and backup for manual recovery',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-test-'));
 try{
  const f=await recoveryFixture(root,'original-backed-up');await fs.rename(f.original,f.backup);await fs.rename(f.tmp,f.original);
  const recovery=await recoverTransactions(root);assert.equal(recovery.length,1);assert.equal(recovery[0].id,f.id);
  assert.equal(await fs.readFile(f.original,'utf8'),'new film');assert.equal(await fs.readFile(f.backup,'utf8'),'original film');assert.equal(await fs.readFile(f.review,'utf8'),'new film');
  assert.equal(JSON.parse(await fs.readFile(f.journal,'utf8')).phase,'original-backed-up');
 }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('recovery rejects a changed backup and reports malformed journals without deleting files',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-test-'));
 try{
  const f=await recoveryFixture(root,'ready');await fs.rename(f.original,f.backup);await fs.writeFile(f.backup,'different content');
  await fs.writeFile(path.join(root,'broken.json'),'{');
  const recovery=await recoverTransactions(root);assert.equal(recovery.length,2);assert(recovery.some(x=>x.id==='broken.json'&&x.error));
  await assert.rejects(fs.stat(f.original));assert.equal(await fs.readFile(f.backup,'utf8'),'different content');assert.equal(await fs.readFile(f.tmp,'utf8'),'new film');assert.equal(await fs.readFile(f.review,'utf8'),'new film');
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
test('duration anomaly and missing audio are never silently approved',()=>{
 const original={format:{duration:'100'},streams:[{codec_type:'video',codec_name:'h264',width:1920,height:1080},{codec_type:'audio',codec_name:'aac',tags:{language:'eng'}}],chapters:[]};
 const review=structuredClone(original);review.streams[0].codec_name='hevc';review.streams[0].pix_fmt='yuv420p10le';assert.equal(inspect(original,review).durationMismatch,false);review.format.duration='99';assert.equal(inspect(original,review).durationMismatch,true);review.streams.pop();assert.throws(()=>inspect(original,review));
});
