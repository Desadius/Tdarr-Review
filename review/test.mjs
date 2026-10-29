import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {safeFile,replaceChecked,inspect,recoverTransactions,sha256} from './core.mjs';
import {identityOf} from '../recovery/file-identity.mjs';
const directorySync={skip:process.platform==='win32'?'Requires POSIX directory fsync for durable replacement journals':false};
const fileSymlink={skip:process.platform==='win32'?'File symlinks require Windows Developer Mode or elevated privileges; covered by the Linux suite':false};

test('path traversal is rejected',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-test-'));
 try {await fs.writeFile(path.join(root,'film.mkv'),'original');await assert.rejects(safeFile(root,'../film.mkv'));}finally{await fs.rm(root,{recursive:true,force:true})}
});
test('file symlinks are rejected',fileSymlink,async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-test-'));
 try{await fs.writeFile(path.join(root,'film.mkv'),'original');await fs.symlink(path.join(root,'film.mkv'),path.join(root,'link.mkv'));await assert.rejects(safeFile(root,'link.mkv'),/Symbolické/)}finally{await fs.rm(root,{recursive:true,force:true})}
});
test('approval replaces only the selected original and cleans completed transaction',directorySync,async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-test-'));
 try {const original=path.join(root,'movie.mkv'),review=path.join(root,'review.mkv'),journal=path.join(root,'transaction.json');await fs.writeFile(original,'original film');await fs.writeFile(review,'new film');await fs.writeFile(path.join(root,'other.mkv'),'keep');
 const updates=[];await replaceChecked({original,review,journal,originalFP:identityOf(await fs.stat(original)),reviewFP:identityOf(await fs.stat(review)),onProgress:p=>updates.push(p)});assert(updates.some(p=>p.phase==='preparing'&&p.done===8&&p.total===8));assert(updates.some(p=>p.phase==='verifying-copy'&&p.done===16&&p.total===16));assert.equal(await fs.readFile(original,'utf8'),'new film');assert.equal(await fs.readFile(path.join(root,'other.mkv'),'utf8'),'keep');await assert.rejects(fs.stat(review));const record=JSON.parse(await fs.readFile(journal));assert.equal(record.phase,'complete');assert.equal(record.tvAudit,undefined);assert.equal(record.installedFP,undefined,'Movie transaction journal retains its existing fields');assert.equal((await fs.readdir(root)).filter(n=>n.endsWith('.old')||n.endsWith('.tmp')).length,0)
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
test('retained-original replacement verifies and keeps its quarantine copy after install',directorySync,async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-retained-'));
 try{
  const media=path.join(root,'media'),quarantine=path.join(root,'quarantine');await fs.mkdir(media);await fs.mkdir(quarantine);
  const original=path.join(media,'episode.mkv'),review=path.join(root,'review.mkv'),retained=path.join(quarantine,'episode.mkv'),journal=path.join(root,'transaction.json');
  await fs.writeFile(original,'byte-for-byte original');await fs.writeFile(review,'approved output');const installedHash=await sha256(review);
  await replaceChecked({original,review,journal,retainOriginal:{root:quarantine,path:retained},originalFP:identityOf(await fs.stat(original)),reviewFP:identityOf(await fs.stat(review))});
  const record=JSON.parse(await fs.readFile(journal,'utf8'));
  assert.equal(record.retainedPhase,'verified');assert.equal(record.phase,'complete');assert.equal(await fs.readFile(retained,'utf8'),'byte-for-byte original');assert.equal(await fs.readFile(original,'utf8'),'approved output');assert.equal(record.installedFP,identityOf(await fs.stat(original)));assert.equal(record.installedHash,installedHash);
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
test('TV audit preparation preserves an unrelated temp collision before media copy',directorySync,async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-tv-audit-hook-'));
 try{
  const media=path.join(root,'media'),quarantine=path.join(root,'quarantine');await fs.mkdir(media);await fs.mkdir(quarantine);
  const original=path.join(media,'episode.mkv'),review=path.join(root,'review.mkv'),journal=path.join(root,'tv-transaction.json');
  await fs.writeFile(original,'original');await fs.writeFile(review,'result');const originalBefore=await fs.readFile(original),reviewBefore=await fs.readFile(review);let unrelatedTmp;
  await assert.rejects(replaceChecked({original,review,journal,retainOriginal:{root:quarantine,path:path.join(quarantine,'episode.mkv')},originalFP:identityOf(await fs.stat(original)),reviewFP:identityOf(await fs.stat(review)),tvAudit:{version:1,transaction:path.basename(journal),context:{version:1}},beforeMediaMutation:async record=>{unrelatedTmp=record.tmp;await fs.writeFile(unrelatedTmp,'unrelated temp')}}),{code:'EEXIST'});
  assert.deepEqual(await fs.readFile(original),originalBefore);assert.deepEqual(await fs.readFile(review),reviewBefore);assert.equal(await fs.readFile(unrelatedTmp,'utf8'),'unrelated temp');
  const record=JSON.parse(await fs.readFile(journal,'utf8'));assert.equal(record.phase,'aborted');assert.equal((await fs.readdir(quarantine)).length,0);assert.deepEqual(await recoverTransactions(path.dirname(journal)),[]);
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
test('TV installed digest cannot be reused after the staged copy changes at the commit barrier',directorySync,async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-tv-stage-proof-'));
 try{
  const original=path.join(root,'original.mkv'),review=path.join(root,'result.mkv'),journal=path.join(root,'journal.json'),quarantine=path.join(root,'quarantine');await fs.mkdir(quarantine);await fs.writeFile(original,'untouched original');await fs.writeFile(review,'approved result');
  const originalFP=identityOf(await fs.stat(original)),reviewFP=identityOf(await fs.stat(review));
  await assert.rejects(replaceChecked({original,review,journal,originalFP,reviewFP,retainOriginal:{root:quarantine,path:path.join(quarantine,'kept.mkv')},beforeCommit:async()=>{const record=JSON.parse(await fs.readFile(journal));await fs.writeFile(record.tmp,'tampered staged result')}}),/ověřené kopii/);
  assert.equal(await fs.readFile(original,'utf8'),'untouched original');assert.equal(await fs.readFile(review,'utf8'),'approved result');const record=JSON.parse(await fs.readFile(journal));assert.equal(record.phase,'aborted');assert.equal(record.installedHash,undefined);
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
for(const capacity of ['insufficient','unverifiable'])test(`retained-original capacity ${capacity} blocks before writing or swapping`,directorySync,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-retained-capacity-'));
 try{
  const media=path.join(root,'media'),quarantine=path.join(root,'quarantine');await fs.mkdir(media);await fs.mkdir(quarantine);
  const original=path.join(media,'episode.mkv'),review=path.join(root,'review.mkv'),retained=path.join(quarantine,'episode.mkv'),journal=path.join(root,'transaction.json');
  await fs.writeFile(original,'original media');await fs.writeFile(review,'approved output');
  t.mock.method(fs,'statfs',async()=>{if(capacity==='unverifiable')throw Error('statfs unavailable');return {bavail:0,bsize:4096}});
  await assert.rejects(replaceChecked({original,review,journal,retainOriginal:{root:quarantine,path:retained},originalFP:identityOf(await fs.stat(original)),reviewFP:identityOf(await fs.stat(review))}),/Nedostatek ověřitelného místa/);
  assert.equal(await fs.readFile(original,'utf8'),'original media');assert.equal(await fs.readFile(review,'utf8'),'approved output');
  assert.deepEqual(await fs.readdir(quarantine),[]);await assert.rejects(fs.stat(journal));
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
for(const linked of ['original','review'])test(`retained-original install refuses a hardlinked ${linked} before effects`,directorySync,async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-retained-hardlink-'));
 try{
  const media=path.join(root,'media'),quarantine=path.join(root,'quarantine');await fs.mkdir(media);await fs.mkdir(quarantine);
  const original=path.join(media,'episode.mkv'),review=path.join(root,'review.mkv'),alias=path.join(root,'hardlink.mkv'),retained=path.join(quarantine,'episode.mkv'),journal=path.join(root,'transaction.json');
  await fs.writeFile(original,'original media');await fs.writeFile(review,'approved output');await fs.link(linked==='original'?original:review,alias);
  await assert.rejects(replaceChecked({original,review,journal,retainOriginal:{root:quarantine,path:retained},originalFP:identityOf(await fs.stat(original)),reviewFP:identityOf(await fs.stat(review))}),/Soubor se od kontroly změnil nebo má pevný odkaz/);
  assert.equal((await fs.stat(linked==='original'?original:review)).nlink,2);assert.equal(await fs.readFile(alias,'utf8'),linked==='original'?'original media':'approved output');
  assert.equal(await fs.readFile(original,'utf8'),'original media');assert.equal(await fs.readFile(review,'utf8'),'approved output');
  assert.deepEqual(await fs.readdir(quarantine),[]);await assert.rejects(fs.stat(journal));
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
test('retained-original quarantine on another filesystem is refused before media effects',directorySync,async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-retained-device-'));
 const quarantine=await fs.mkdtemp(path.join('/dev/shm','review-retained-device-'));
 try{
  const media=path.join(root,'media');await fs.mkdir(media);
  const original=path.join(media,'episode.mkv'),review=path.join(root,'review.mkv'),retained=path.join(quarantine,'episode.mkv'),journal=path.join(root,'transaction.json');
  await fs.writeFile(original,'original media');await fs.writeFile(review,'approved output');
  assert.notEqual((await fs.stat(root)).dev,(await fs.stat(quarantine)).dev,'fixture must use separate filesystems');
  await assert.rejects(replaceChecked({original,review,journal,retainOriginal:{root:quarantine,path:retained},originalFP:identityOf(await fs.stat(original)),reviewFP:identityOf(await fs.stat(review))}),/Trvalá karanténa musí být na stejném souborovém systému/);
  assert.equal(await fs.readFile(original,'utf8'),'original media');assert.equal(await fs.readFile(review,'utf8'),'approved output');
  assert.deepEqual(await fs.readdir(quarantine),[]);await assert.rejects(fs.stat(journal));
 }finally{await fs.rm(root,{recursive:true,force:true});await fs.rm(quarantine,{recursive:true,force:true})}
});
test('retained-copy tampering at the precommit barrier blocks installation and stays journaled',directorySync,async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-retained-race-'));
 try{
  const media=path.join(root,'media'),quarantine=path.join(root,'quarantine');await fs.mkdir(media);await fs.mkdir(quarantine);
  const original=path.join(media,'episode.mkv'),review=path.join(root,'review.mkv'),retained=path.join(quarantine,'episode.mkv'),journal=path.join(root,'transaction.json');
  await fs.writeFile(original,'original media');await fs.writeFile(review,'approved output');
  await assert.rejects(replaceChecked({original,review,journal,retainOriginal:{root:quarantine,path:retained},originalFP:identityOf(await fs.stat(original)),reviewFP:identityOf(await fs.stat(review)),beforeCommit:async()=>fs.writeFile(retained,'tampered')}));
  assert.equal(await fs.readFile(original,'utf8'),'original media');
  assert.equal(await fs.readFile(retained,'utf8'),'tampered');
  assert.equal(JSON.parse(await fs.readFile(journal,'utf8')).phase,'verifying-copy');
  assert.equal((await recoverTransactions(root)).length,1,'tampered retention journal remains visible for manual recovery');
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
test('retained-root symlink swap at the precommit barrier blocks installation and preserves the journal',directorySync,async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-retained-root-race-'));
 try{
  const media=path.join(root,'media'),quarantine=path.join(root,'quarantine'),moved=path.join(root,'quarantine-away'),outside=path.join(root,'outside');await fs.mkdir(media);await fs.mkdir(quarantine);await fs.mkdir(outside);
  const original=path.join(media,'episode.mkv'),review=path.join(root,'review.mkv'),retained=path.join(quarantine,'episode.mkv'),journal=path.join(root,'transaction.json');
  await fs.writeFile(original,'original media');await fs.writeFile(review,'approved output');
  await assert.rejects(replaceChecked({original,review,journal,retainOriginal:{root:quarantine,path:retained},originalFP:identityOf(await fs.stat(original)),reviewFP:identityOf(await fs.stat(review)),beforeCommit:async()=>{await fs.rename(quarantine,moved);await fs.symlink(outside,quarantine,'dir')}}));
  assert.equal(await fs.readFile(original,'utf8'),'original media','the media file must remain untouched after quarantine containment changes');
  assert.equal(await fs.readFile(path.join(moved,'episode.mkv'),'utf8'),'original media','the retained copy remains intact in the directory handle target');
  assert.equal(await fs.readdir(outside).then(entries=>entries.length),0,'the symlink target receives no retained copy operations');
  assert.equal(JSON.parse(await fs.readFile(journal,'utf8')).phase,'verifying-copy');
  assert.equal((await recoverTransactions(root)).length,1,'the unsafe retention journal remains visible for manual recovery');
  await fs.unlink(quarantine);
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
test('retained-copy tampering after install never deletes the transaction backup',directorySync,async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-retained-installed-race-'));
 try{
  const media=path.join(root,'media'),quarantine=path.join(root,'quarantine');await fs.mkdir(media);await fs.mkdir(quarantine);
  const original=path.join(media,'episode.mkv'),review=path.join(root,'review.mkv'),retained=path.join(quarantine,'episode.mkv'),journal=path.join(root,'transaction.json');
  await fs.writeFile(original,'original media');await fs.writeFile(review,'approved output');
  await assert.rejects(replaceChecked({original,review,journal,retainOriginal:{root:quarantine,path:retained},originalFP:identityOf(await fs.stat(original)),reviewFP:identityOf(await fs.stat(review)),onStage:phase=>{if(phase==='installed')fsSync.writeFileSync(retained,'tampered')}}));
  assert.equal(await fs.readFile(original,'utf8'),'approved output');
  const record=JSON.parse(await fs.readFile(journal,'utf8'));
  assert.equal(await fs.readFile(record.backup,'utf8'),'original media');
  assert.equal(record.phase,'installed');
  assert.equal((await recoverTransactions(root)).length,1,'installed, tampered retention journal stays unresolved');
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
test('changed source and interrupted commit never overwrite original',directorySync,async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-test-'));
 try{const original=path.join(root,'movie.mkv'),review=path.join(root,'review.mkv'),journal=path.join(root,'transaction.json');await fs.writeFile(original,'original');await fs.writeFile(review,'new');const originalFP=identityOf(await fs.stat(original)),reviewFP=identityOf(await fs.stat(review));
 await assert.rejects(replaceChecked({original,review,journal,originalFP,reviewFP,beforeCommit:async()=>{throw new Error('Tdarr started')}}));assert.equal(await fs.readFile(original,'utf8'),'original');assert.equal(await fs.readFile(review,'utf8'),'new');assert.equal((await fs.readdir(root)).filter(n=>n.endsWith('.old')||n.endsWith('.tmp')).length,0);
 assert.equal(JSON.parse(await fs.readFile(journal,'utf8')).phase,'aborted');assert.deepEqual(await recoverTransactions(root),[]);
 await fs.writeFile(original,'changed');await assert.rejects(replaceChecked({original,review,journal,originalFP,reviewFP}));assert.equal(await fs.readFile(original,'utf8'),'changed');
 }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('failed swap rolls back the exact original and records a terminal abort',directorySync,async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-test-'));
 try{
  const original=path.join(root,'movie.mkv'),review=path.join(root,'review.mkv'),journal=path.join(root,'transaction.json');
  await fs.writeFile(original,'original film');await fs.writeFile(review,'new film');
  await assert.rejects(replaceChecked({original,review,journal,originalFP:identityOf(await fs.stat(original)),reviewFP:identityOf(await fs.stat(review)),onStage:phase=>{if(phase==='original-backed-up')throw new Error('Simulated failure before installation')}}));
  assert.equal(await fs.readFile(original,'utf8'),'original film');assert.equal(await fs.readFile(review,'utf8'),'new film');
  assert.equal((await fs.stat(original)).nlink,1);assert.equal(JSON.parse(await fs.readFile(journal,'utf8')).phase,'aborted');
  assert.deepEqual(await recoverTransactions(root),[]);
 }finally{await fs.rm(root,{recursive:true,force:true})}
});

async function recoveryFixture(root,phase){
 const id='fixture',original=path.join(root,'movie.mkv'),review=path.join(root,'review.mkv'),tmp=path.join(root,`.tdarr-review-${id}.tmp`),backup=path.join(root,`.tdarr-review-${id}.old`),journal=path.join(root,'transaction.json');
 await fs.writeFile(original,'original film');await fs.writeFile(review,'new film');await fs.copyFile(review,tmp);
 const record={id,original,review,tmp,backup,originalFP:identityOf(await fs.stat(original)),reviewFP:identityOf(await fs.stat(review)),phase};
 await fs.writeFile(journal,JSON.stringify(record));return {...record,journal};
}

test('restart restores a missing original before installation without replaying approval',directorySync,async()=>{
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
