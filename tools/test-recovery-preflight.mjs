// Actual decoding of generated finite Matroska data; no production inputs.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {runOriginalDecode} from '../recovery/original-decode.mjs';
import {hasFiniteTruncation} from '../recovery/matroska-bounds.mjs';
import {classify,confirmed} from '../recovery/policy.mjs';
const exe=process.env.FFMPEG||'ffmpeg',root=await fs.mkdtemp(path.join(os.tmpdir(),'recovery-preflight-'));
try{
 const valid=path.join(root,'valid.mkv');
 execFileSync(exe,['-v','error','-f','lavfi','-i','testsrc2=size=64x64:rate=25','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','4','-c:v','ffv1','-threads','1','-c:a','pcm_s16le',valid],{timeout:60000});
 const bytes=await fs.readFile(valid),broken=path.join(root,'truncated.mkv');await fs.writeFile(broken,bytes.subarray(0,Math.floor(bytes.length/2)));
 const check=async file=>{const r=await runOriginalDecode({ffmpeg:exe,file,timeoutMs:15000});r.finiteContainerTruncation=await hasFiniteTruncation(file);return r;};
 assert.equal(classify(await check(valid)).kind,'healthy');
 const a=await check(broken),b=await check(broken);assert.match(a.stderr,/File ended prematurely/);assert.equal(a.finiteContainerTruncation,true);assert.equal(confirmed(a,b),true);
 const unknown=Buffer.from(await fs.readFile(broken)),p=unknown.indexOf(Buffer.from('18538067','hex'))+4;let width=1;while(!(unknown[p]&(128>>(width-1))))width++;unknown.fill(255,p,p+width);unknown[p]=256/(2**(width-1))-1;
 const uncertain=path.join(root,'unknown.mkv');await fs.writeFile(uncertain,unknown);const c=await check(uncertain);assert.equal(c.finiteContainerTruncation,false);assert.equal(confirmed(c,c),false);
 assert.deepEqual(await fs.readFile(valid),bytes);console.log('Recovery preflight: valid generated MKV healthy, finite truncated Segment confirmed twice, unknown-size Segment never confirmed.');
}finally{await fs.rm(root,{recursive:true,force:true});}
