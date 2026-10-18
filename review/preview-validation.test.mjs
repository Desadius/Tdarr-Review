import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {validateRecoveredPreview} from './preview-validation.mjs';
async function decoder(t,body){const root=await fs.mkdtemp(path.join(os.tmpdir(),'preview-decode-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const exe=path.join(root,'decoder');await fs.writeFile(exe,'#!'+process.execPath+'\n'+body,{mode:0o700});return exe;}
const ordinary="process.stdin.resume();if(process.argv.includes('null'))process.stdout.write('frame=300\\nout_time_us=12000000\\n');else process.stdout.write(Buffer.alloc(48000*4*12));";
test('recovered video and audio must both decode completely',async t=>{
 const exe=await decoder(t,ordinary);assert.equal(await validateRecoveredPreview(exe,'AAAA',{frameRate:25,deadline:Date.now()+10000}),'AAAA');
 for(const body of [ordinary.replace('frame=300','frame=0'),ordinary.replace('frame=300','frame=3'),ordinary.replace('12000000','1000000'),ordinary.replace('48000*4*12','48000*4'),"process.stdin.resume();process.stderr.write('decoder damage');process.exitCode=1;"]){
  const bad=await decoder(t,body);await assert.rejects(validateRecoveredPreview(bad,'AAAA',{frameRate:25,deadline:Date.now()+10000}));
 }
});
test('validation terminates and drains its decoder at the remaining deadline',async t=>{
 const exe=await decoder(t,"process.stdin.resume();setTimeout(()=>{},10000);");const start=Date.now();
 await assert.rejects(validateRecoveredPreview(exe,'AAAA',{frameRate:25,deadline:Date.now()+30}),/90 sekund/);assert.ok(Date.now()-start<2000);
});
test('validation refuses cancellation and excessive decoded output',async t=>{
 const exe=await decoder(t,"process.stdin.resume();if(process.argv.includes('null'))process.stdout.write('frame=300\\nout_time_us=12000000\\n'+' '.repeat(70000));else process.stdout.write(Buffer.alloc(48000*4*12));");
 await assert.rejects(validateRecoveredPreview(exe,'AAAA',{frameRate:25,deadline:Date.now()+10000}));
 const controller=new AbortController();controller.abort();await assert.rejects(validateRecoveredPreview(exe,'AAAA',{frameRate:25,signal:controller.signal,deadline:Date.now()+10000}),{name:'AbortError'});
});
