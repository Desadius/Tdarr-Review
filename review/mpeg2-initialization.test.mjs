import test from 'node:test';
import {crc32} from 'node:zlib';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {correctedMpeg2Header,withMpeg2Initialization} from './mpeg2-initialization.mjs';
const extension=Buffer.from('000001b58ffff34180','hex');
const base=Buffer.from('000001b302002013ffffe018000001b5148a00010000','hex');
function element(id,data){assert.ok(data.length<127);return Buffer.concat([Buffer.from(id,'hex'),Buffer.from([128+data.length]),data]);}
function header(privateData=Buffer.concat([base,extension]),codec='V_MPEG2'){
 const track=element('ae',Buffer.concat([element('86',Buffer.from(codec)),element('63a2',privateData)]));
 return Buffer.concat([element('1a45dfa3',Buffer.alloc(0)),element('18538067',element('1654ae6b',track))]);
}
const diagnostic='[mpeg2video @ 0x123] ignoring pic cod ext after 0\n';
const failure=()=>Object.assign(Error('Poslech nelze připravit: '+diagnostic),{previewExitCode:0});
test('only the exact structured CodecPrivate is corrected; offsets and packets stay unchanged',()=>{
 const input=Buffer.concat([header(),Buffer.from('synthetic packet bytes')]),output=correctedMpeg2Header(input);
 assert.ok(output);assert.equal(output.length,input.length);assert.ok(output.subarray(-22).equals(input.subarray(-22)));
 assert.ok(output.includes(element('63a2',base)));assert.ok(output.includes(Buffer.from('ec8700000000000000','hex')));
 assert.ok(input.includes(extension),'input bytes unchanged');
 for(const b of [header(base),header(extension),header(Buffer.concat([base,extension]),'V_MPEG4/ISO/AVC'),Buffer.from('not matroska'),header().subarray(0,-1)])assert.equal(correctedMpeg2Header(b),null);
});
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'mpeg2-header-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=path.join(root,'input|with,delimiters.mkv');await fs.writeFile(file,header());return {file,root};}
test('recovery creates a private seekable view once and cleans it after the decoder closes',async t=>{
 const {file}=await fixture(t);let calls=0,temporary;
 assert.equal(await withMpeg2Initialization(file,async(input,remaining)=>{
  calls++;assert.ok(remaining>0&&remaining<=90000);if(calls===1)throw failure();
  assert.match(input,/^concat:/);const [prefix,subfile]=input.slice(7).split('|');temporary=path.dirname(prefix);
  assert.equal((await fs.stat(temporary)).mode&0o777,0o700);
  assert.deepEqual(await fs.readFile(prefix),correctedMpeg2Header(await fs.readFile(file)));
  const link=subfile.slice(subfile.indexOf(',,:' )+3);assert.equal(await fs.readlink(link),file);
  return 'complete';
 }), 'complete');assert.equal(calls,2);await assert.rejects(fs.stat(temporary),{code:'ENOENT'});
});
test('mixed errors, ordinary success, unsupported headers and cancelled work never recover',async t=>{
 const {file}=await fixture(t);
 for(const error of [Object.assign(failure(),{previewDiagnostics:('unrelated damage\n'+(diagnostic.trimEnd().padEnd(63,' ')+'\n').repeat(256)).slice(-16384)}),Object.assign(failure(),{previewExitCode:1}),Object.assign(failure(),{previewExitCode:null}),Object.assign(Error(diagnostic+'unexpected failure'),{previewExitCode:0}),Error('Permission denied'),Error('timed out')]){
  let count=0;await assert.rejects(withMpeg2Initialization(file,async()=>{count++;throw error;}),e=>e===error);assert.equal(count,1);
 }
 let count=0;assert.equal(await withMpeg2Initialization(file,async()=>{count++;return 'ordinary';}),'ordinary');assert.equal(count,1);
 await fs.writeFile(file,header(extension));count=0;await assert.rejects(withMpeg2Initialization(file,async()=>{count++;throw failure();}),/ignoring/);assert.equal(count,1);
 const controller=new AbortController();count=0;
 await assert.rejects(withMpeg2Initialization(file,async()=>{count++;controller.abort();throw failure();},{signal:controller.signal}),{name:'AbortError'});assert.equal(count,1);
});
test('failed corrected decodes remain failures and leave no temporary view',async t=>{
 const {file}=await fixture(t);let count=0,directory;
 await assert.rejects(withMpeg2Initialization(file,async input=>{if(++count===1)throw failure();directory=path.dirname(input.slice(7).split('|')[0]);throw Error('real packet damage');}),/real packet damage/);
 assert.equal(count,2);await assert.rejects(fs.stat(directory),{code:'ENOENT'});
});
test('a changed source cannot publish the corrected result',async t=>{
 const {file}=await fixture(t);let count=0;
 await assert.rejects(withMpeg2Initialization(file,async()=>{if(++count===1)throw failure();await fs.appendFile(file,'changed');return 'complete';}),/Soubory se změnily/);
});

test('expired budgets, symlinks and hardlinks never start a correction',async t=>{
 const {file,root}=await fixture(t);let calls=0;
 await assert.rejects(withMpeg2Initialization(file,async()=>{calls++;await new Promise(r=>setTimeout(r,15));throw failure();},{budgetMs:1}),/ignoring/);assert.equal(calls,1);
 const link=path.join(root,'link');await fs.symlink(file,link);calls=0;
 await assert.rejects(withMpeg2Initialization(link,async()=>{calls++;throw failure();}));assert.equal(calls,1);
 await fs.link(file,path.join(root,'hardlink'));calls=0;
 await assert.rejects(withMpeg2Initialization(file,async()=>{calls++;throw failure();}),/ignoring/);assert.equal(calls,1);
});

test('valid Track CRC is checked and recalculated, corrupt original CRC is refused',()=>{
 const track=element('ae',Buffer.concat([element('86',Buffer.from('V_MPEG2')),element('63a2',Buffer.concat([base,extension]))]));
 const crc=Buffer.alloc(4);crc.writeUInt32LE(crc32(track));
 const input=Buffer.concat([element('1a45dfa3',Buffer.alloc(0)),element('18538067',element('1654ae6b',Buffer.concat([element('bf',crc),track])))]);
 const output=correctedMpeg2Header(input);assert.ok(output);
 const pos=output.indexOf(Buffer.from('bf84','hex'))+2;
 assert.equal(output.readUInt32LE(pos),crc32(output.subarray(pos+4)));
 input[pos]^=1;assert.equal(correctedMpeg2Header(input),null);
});

test('duplicate and malformed checksums refuse structural recovery',()=>{
 const track=element('ae',Buffer.concat([element('86',Buffer.from('V_MPEG2')),element('63a2',Buffer.concat([base,extension]))]));
 const crc=Buffer.alloc(4);crc.writeUInt32LE(crc32(track));
 for(const checks of [Buffer.concat([element('bf',crc),element('bf',crc)]),element('bf',Buffer.alloc(3))]){
  const input=Buffer.concat([element('1a45dfa3',Buffer.alloc(0)),element('18538067',element('1654ae6b',Buffer.concat([checks,track])))]);
  assert.equal(correctedMpeg2Header(input),null);
 }
});
