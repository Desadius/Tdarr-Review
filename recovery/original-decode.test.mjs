import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {probeDuration,runOriginalDecode} from './original-decode.mjs';
import {classify} from './policy.mjs';
function child(){const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.kill=signal=>{c.killed=signal;queueMicrotask(()=>c.emit('close',null,signal));};return c;}
test('all original video/audio are decoded with the server thread limit; progress is separate from evidence',async()=>{
 let args,stdio;const progress=[];
 const result=await runOriginalDecode({ffmpeg:'/ffmpeg',file:'/source/file.mkv',timeoutMs:1000,onProgressData:b=>progress.push(b.toString()),spawnChild:(exe,a,opts)=>{assert.equal(exe,'/ffmpeg');args=a;stdio=opts.stdio;const c=child();queueMicrotask(()=>{c.stdout.emit('data',Buffer.from('out_time_us=1000000\nprogress=end\n'));c.stderr.emit('data',Buffer.from('quant_step_size larger than huff_lsbs'));c.emit('close',0,null)});return c;}});
 assert.deepEqual(stdio,['ignore','pipe','pipe']);assert.deepEqual(args.filter((v,i)=>args[i-1]==='-threads'),['2','2']);assert(args.includes('0:v:0'));assert(args.includes('0:a?'));assert(!args.includes('-ss'),'original decoding starts at time zero');assert.equal(progress.length,1);assert.equal(result.code,0);assert.equal(classify(result).kind,'corrupt','progress=end/exit zero cannot erase decoder errors');
});
test('timeout and spawn failures stay operational even when stderr has a decoding marker',async()=>{
 let c;const result=await runOriginalDecode({ffmpeg:'/ffmpeg',file:'/source/file.mkv',timeoutMs:10,spawnChild:()=>{c=child();queueMicrotask(()=>c.stderr.emit('data',Buffer.from('quant_step_size larger than huff_lsbs')));return c;}});
 assert.equal(c.killed,'SIGKILL');assert.equal(result.timeout,true);assert.equal(classify(result).kind,'operational');
 const failed=await runOriginalDecode({ffmpeg:'/missing',file:'/file',timeoutMs:1000,spawnChild:()=>{throw Object.assign(Error('absent'),{code:'ENOENT'})}});assert.equal(failed.error,'ENOENT');assert.equal(classify(failed).kind,'operational');
});
test('duration probes accept finite positive metadata only and never diagnose corruption',async()=>{
 for(const [body,exit,expected] of [[{format:{duration:'42.5'}},0,42.5],[{format:{duration:'N/A'}},0,null],[{format:{duration:-1}},0,null],[{format:{duration:42}},1,null],[{format:{duration:true}},0,null]]){
  const duration=await probeDuration({ffmpeg:'/runtime/ffmpeg',file:'/source/file.mkv',spawnChild:(exe,args)=>{assert.equal(exe.replaceAll('\\','/'),'/runtime/ffprobe');assert.equal(args.at(-1),'/source/file.mkv');const c=child();queueMicrotask(()=>{c.stdout.emit('data',Buffer.from(JSON.stringify(body)));c.emit('close',exit,null)});return c;}});assert.equal(duration,expected);
 }
 let c;assert.equal(await probeDuration({ffmpeg:'/ffmpeg',file:'/file',timeoutMs:10,spawnChild:()=>{c=child();return c}}),null);assert.equal(c.killed,'SIGKILL');
 assert.equal(await probeDuration({ffmpeg:'/ffmpeg',file:'/file',spawnChild:()=>{throw Error('unavailable')}}),null);
});

test('actual decoder capture preserves operational precedence after diagnostic overflow',async()=>{
 const result=await runOriginalDecode({ffmpeg:'/ffmpeg',file:'/source/file.mkv',timeoutMs:1000,spawnChild:()=>{const c=child();queueMicrotask(()=>{c.stderr.emit('data',Buffer.from('Permission denied\n'+'quant_step_size larger than huff_lsbs\n'.repeat(5000)));c.stdout.emit('data',Buffer.from('fra'));c.stdout.emit('data',Buffer.from('me=0\nprogress=end\n'));c.emit('close',0,null);});return c;}});
 assert.equal(result.diagnosticsTruncated,true);assert.equal(result.decodedFrames,0);assert.equal(classify(result).kind,'operational');
});
test('progress fragments report actual decoded frames; clean zero-frame exits remain unconfirmed',async()=>{
 for(const frames of [0,25]){
  const result=await runOriginalDecode({ffmpeg:'/ffmpeg',file:'/source/file.mkv',timeoutMs:1000,spawnChild:()=>{const c=child();queueMicrotask(()=>{c.stdout.emit('data',Buffer.from('fra'));c.stdout.emit('data',Buffer.from('me='+frames+'\nprogress=end\n'));c.emit('close',0,null);});return c;}});
  assert.equal(result.decodedFrames,frames);assert.equal(classify(result).kind,frames?'healthy':'unconfirmed');
 }
});
