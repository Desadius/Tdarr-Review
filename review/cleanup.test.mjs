import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {captureReceipt,cleanupReviewed,pruneEmpty} from './cleanup.mjs';

test('cleanup removes completed film and matching receipt, keeps roots and pending files',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cleanup-'));
 try{
  const relative='PROD-Movies/Film/movie.mkv',file=path.join(root,relative);
  await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'video');
  const stat=await fs.stat(file);
  await fs.writeFile(file+'.tdarr-receipt.json',JSON.stringify({version:1,relative:'Film/movie.mkv',output:{size:stat.size,mtime:Math.round(stat.mtimeMs)}}));
  const receipt=await captureReceipt(root,relative,'Film/movie.mkv',stat);assert.ok(receipt);
  await fs.mkdir(path.join(root,'PROD-Movies/Pending'));await fs.writeFile(path.join(root,'PROD-Movies/Pending/keep.mkv'),'pending');
  await fs.unlink(file);assert.equal(await cleanupReviewed(root,relative,receipt),1);
  assert.equal(await fs.stat(path.dirname(file)).catch(()=>null),null);
  assert.ok((await fs.stat(path.join(root,'PROD-Movies'))).isDirectory());
  assert.equal(await fs.readFile(path.join(root,'PROD-Movies/Pending/keep.mkv'),'utf8'),'pending');
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
test('cleanup preserves unknown receipts and recreated media',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cleanup-'));
 try{
  const relative='Film/movie.mkv',file=path.join(root,relative);
  await fs.mkdir(path.dirname(file));await fs.writeFile(file,'video');
  await fs.writeFile(file+'.tdarr-receipt.json','{}');
  assert.equal(await captureReceipt(root,relative,relative,await fs.stat(file)),null);
  assert.equal(await cleanupReviewed(root,relative,null),0);
  await fs.unlink(file);await cleanupReviewed(root,relative,null);
  assert.equal(await fs.readFile(file+'.tdarr-receipt.json','utf8'),'{}');
  await fs.writeFile(file,'recreated video');await pruneEmpty(root);
  assert.equal(await fs.readFile(file,'utf8'),'recreated video');
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
test('cleanup preserves directories behind symlinks',{skip:process.platform==='win32'?'Directory symlinks require Windows Developer Mode or elevated privileges; covered by the Linux suite':false},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cleanup-'));
 const outside=await fs.mkdtemp(path.join(os.tmpdir(),'cleanup-out-'));
 try{
  await fs.mkdir(path.join(outside,'empty'));await fs.symlink(outside,path.join(root,'link'),'dir');
  await pruneEmpty(root);assert.ok((await fs.stat(path.join(outside,'empty'))).isDirectory());
  assert.ok((await fs.lstat(path.join(root,'link'))).isSymbolicLink());
 }finally{await fs.rm(root,{recursive:true,force:true});await fs.rm(outside,{recursive:true,force:true})}
});
