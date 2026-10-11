import test from 'node:test';import assert from 'node:assert/strict';import {classifyHeader} from './container-header.mjs';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import guard from './source-container-guard.cjs';
test('recognize only EBML and terminal signature; other formats are not automatic corruption',()=>{
 assert.equal(classifyHeader(Buffer.from('1a45dfa3424281','hex')),'ebml');
 assert.equal(classifyHeader(Buffer.from('\x1b[1;63H\x1b[37m')),'terminal_overwrite');
 for(const text of ['RIFF0000','0000ftypisom','OggS0000'])assert.equal(classifyHeader(Buffer.from(text)),'unknown');
 assert.equal(classifyHeader(Buffer.from('00','hex')),'short');
});
test('flow guard fails before Not required; I/O errors remain I/O errors',async()=>{
 const d=await fs.mkdtemp(path.join(os.tmpdir(),'header-guard-'));const f=path.join(d,'film.mkv');const args={inputFileObj:{_id:f,ffProbeData:{streams:[{codec_type:'video'}]}},variables:{}};
 try{
  await fs.writeFile(f,Buffer.from('1a45dfa3424281','hex'));assert.equal((await guard(args)).outputNumber,1);
  await fs.writeFile(f,'\x1b[1;63Hgarbage');await assert.rejects(guard(args),/SOURCE_CONTAINER_CORRUPT/);
  await fs.writeFile(f,'0000ftypisom');await assert.rejects(guard(args),/SOURCE_CONTAINER_REVIEW/);
  await fs.unlink(f);await assert.rejects(guard(args),{code:'ENOENT'});
 }finally{await fs.rm(d,{recursive:true,force:true});}
});
