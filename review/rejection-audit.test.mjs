import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {constants} from 'node:fs';
import {rejectionReason,recordRejection} from './rejection-audit.mjs';
for(const value of [undefined,null,42,{},'', '   ','a'.repeat(1001),'bad\u0000value'])test('Reject invalid reason '+JSON.stringify(value)?.slice(0,30),()=>assert.throws(()=>rejectionReason(value)));
test('Unicode, whitespace and multiline reason retained',()=>assert.equal(rejectionReason('  Chybí japonský zvuk.\nNesedí dialog.  '),'Chybí japonský zvuk.\nNesedí dialog.'));
test('Archive survives reopen and safely escapes hostile strings',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'review-reasons-'));
 try{const reason='<script>alert(1)</script>\n"zvuk"';await recordRejection(dir,{event:'requested',reason});await recordRejection(dir,{event:'completed',status:'success',reason});const rows=(await fs.readFile(path.join(dir,'rejection-decisions.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(rows.length,2);assert.equal(rows[0].reason,reason);assert.ok(rows[1].time);}
 finally{await fs.rm(dir,{recursive:true,force:true})}
});
// The server's rejection handling (reason validation before any scan, archive before deletion,
// retained job ID) is tested over HTTP in decision-http.test.mjs.

// The archive is only ever a regular file in DATA: a symlink, even one to a regular file, is refused
// before anything is written, so a rejection with a refused archive deletes nothing.
const linux={skip:process.platform!=='linux'?'Requires Linux symlink, FIFO and O_NOFOLLOW semantics':false,timeout:10000};
for(const [name,prepare] of [
 ['a symlink to a file',async(dir,archive)=>{await fs.writeFile(path.join(dir,'outside'),'keep');await fs.symlink(path.join(dir,'outside'),archive)}],
 ['a symlink to a directory',async(dir,archive)=>{await fs.mkdir(path.join(dir,'outside'));await fs.symlink(path.join(dir,'outside'),archive)}],
 ['a dangling symlink',async(dir,archive)=>fs.symlink(path.join(dir,'outside'),archive)],
 ['a directory',async(dir,archive)=>fs.mkdir(archive)],
 ['a named pipe',async(dir,archive)=>{const made=spawnSync('mkfifo',[archive]);assert.equal(made.status,0,String(made.stderr))}],
 // With a reader the pipe opens for writing without error, so only the check of the opened file refuses it.
 ['a named pipe that is being read',async(dir,archive,after)=>{const made=spawnSync('mkfifo',[archive]);assert.equal(made.status,0,String(made.stderr));const reader=await fs.open(archive,constants.O_RDONLY|constants.O_NONBLOCK);after.push(()=>reader.close())}],
])test('The rejection archive refuses '+name,linux,async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'review-reasons-')),archive=path.join(dir,'rejection-decisions.jsonl'),after=[];
 try{
  await prepare(dir,archive,after);
  await assert.rejects(recordRejection(dir,{event:'requested',reason:'SECRET-reason'}),/Archiv zamítnutí není běžný soubor/);
  const outside=await fs.lstat(path.join(dir,'outside')).catch(()=>null);
  if(outside?.isFile())assert.equal(await fs.readFile(path.join(dir,'outside'),'utf8'),'keep');
  if(outside?.isDirectory())assert.deepEqual(await fs.readdir(path.join(dir,'outside')),[]);
  if(!outside)await assert.rejects(fs.lstat(path.join(dir,'outside')),{code:'ENOENT'},'a dangling link is not followed to create its target');
 }finally{for(const close of after)await close();await fs.rm(dir,{recursive:true,force:true})}
});
test('The rejection archive is created private and appended to',linux,async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'review-reasons-'));
 try{
  await recordRejection(dir,{event:'requested',reason:'a'});await recordRejection(dir,{event:'completed',reason:'a'});
  const file=path.join(dir,'rejection-decisions.jsonl');
  assert.equal((await fs.stat(file)).mode&0o777,0o600);
  assert.deepEqual((await fs.readFile(file,'utf8')).trim().split('\n').map(line=>JSON.parse(line).event),['requested','completed']);
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
