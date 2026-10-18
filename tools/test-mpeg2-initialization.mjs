import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mpeg2Fixture} from './mpeg2-fixture.mjs';
import {validateRecoveredPreview} from '../review/preview-validation.mjs';
import {createPreviewRenderer} from '../review/preview-render.mjs';
import {extractPreview} from '../review/av-preview.mjs';
import {extractAudio} from '../review/audio-compare.mjs';
import {extractListeningAudio} from '../review/audio-listen.mjs';
const exe=process.env.FFMPEG||'ffmpeg',probe=process.env.FFPROBE||'ffprobe',root=await fs.mkdtemp(path.join(os.tmpdir(),'mpeg2-fixture-'));
const binary=args=>execFileSync(exe,args,{maxBuffer:16*1024*1024,timeout:60000});
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
try{
 const {control,variant,unsupported}=await mpeg2Fixture(root,exe),before=digest(await fs.readFile(variant));
 for(const file of [control,variant])for(const kind of ['v:0','a:0','a:1']){
  const args=['-v','quiet','-i',file,'-map','0:'+kind,'-f',kind.startsWith('v')?'rawvideo':'s16le','pipe:1'];
  assert.equal(digest(binary(args)),digest(binary(args.map(v=>v===file?control:v))),'generated inputs decode identically');
 }
 for(const seconds of [0,1.25]){
  const reference=await extractListeningAudio(exe,control,2,seconds,5),wave=await extractAudio(exe,control,2,seconds,5);
  for(const [side,file] of [['variant',variant],['control',control]]){
   const audio=await extractListeningAudio(exe,file,2,seconds,5);assert.equal(audio.frames,576000);assert.equal(audio.pcm,reference.pcm,side+' preserves selected audio and timing');
   assert.deepEqual(await extractAudio(exe,file,2,seconds,5),wave,side+' waveform timing');
   const video={index:0,codec_name:'mpeg2video',avg_frame_rate:'25/1'},clip=path.join(root,'clip.mp4');
   await fs.writeFile(clip,Buffer.from(await extractPreview(exe,file,2,seconds,5,video),'base64'));
   const meta=JSON.parse(execFileSync(probe,['-v','error','-count_frames','-show_streams','-show_format','-of','json',clip],{encoding:'utf8'}));
   const v=meta.streams.find(s=>s.codec_type==='video'),a=meta.streams.find(s=>s.codec_type==='audio');
   assert.equal(v.codec_name,'h264');assert.equal(a.codec_name,'aac');assert.ok(Number(v.nb_read_frames)>=299&&Number(v.nb_read_frames)<=301);assert.ok(Math.abs(Number(meta.format.duration)-12)<.1);
   const frameArgs=['-v','error','-i',clip,'-map','0:v','-f','rawvideo','pipe:1'];
   const decoded=binary(frameArgs);assert.ok(decoded.length>0);
   const expected=path.join(root,'expected.mp4');await fs.writeFile(expected,Buffer.from(await extractPreview(exe,control,2,seconds,5,video),'base64'));
   assert.equal(digest(decoded),digest(binary(frameArgs.map(v=>v===clip?expected:v))),side+' video content and frame coverage match control');
   const pcmArgs=['-v','error','-i',clip,'-map','0:a','-f','f32le','pipe:1'],pcm=binary(pcmArgs);
   assert.ok(pcm.length>=48000*4*11.9&&pcm.length<=48000*4*12.1);
   assert.equal(digest(pcm),digest(binary(pcmArgs.map(v=>v===clip?expected:v))),side+' decoded AAC content matches control');
   const withoutAudio=path.join(root,'no-audio.mp4');binary(['-v','error','-y','-i',clip,'-map','0:v','-c','copy',withoutAudio]);
   await assert.rejects(validateRecoveredPreview(exe,(await fs.readFile(withoutAudio)).toString('base64'),{frameRate:25,deadline:Date.now()+10000}),'missing AAC rejected');
   const shortAudio=path.join(root,'short-audio.mp4');binary(['-v','error','-y','-i',clip,'-af','atrim=end=1','-c:v','copy','-c:a','aac',shortAudio]);
   await assert.rejects(validateRecoveredPreview(exe,(await fs.readFile(shortAudio)).toString('base64'),{frameRate:25,deadline:Date.now()+10000}),'truncated AAC rejected');
  }
 }
 const metadata=file=>JSON.parse(execFileSync(probe,['-v','quiet','-show_streams','-show_format','-of','json',file],{encoding:'utf8'}));
 for(const [original,review] of [[variant,control],[control,variant],[variant,variant]]){
  const renderer=createPreviewRenderer({getPair:async()=>({a:{path:original},b:{path:review},pa:metadata(original),pb:metadata(review)}),getConfig:()=>({ffmpeg:exe})});
  const selected=await renderer({mode:'listen',seconds:1.25,originalIndex:1,reviewIndex:2});
  assert.equal(selected.original.pcm,(await extractListeningAudio(exe,control,1,1.25,5)).pcm);
  assert.equal(selected.review.pcm,(await extractListeningAudio(exe,control,2,1.25,5)).pcm);
  assert.notEqual(selected.original.pcm,selected.review.pcm,'independent selected tracks remain distinct');
 }
 for(const run of [file=>extractPreview(exe,file,1,0,5,{index:0,codec_name:'mpeg2video',avg_frame_rate:'25/1'}),file=>extractAudio(exe,file,1,0,5),file=>extractListeningAudio(exe,file,1,0,5)]){
  await run(variant);
  await assert.rejects(run(unsupported),/ignoring pic cod ext after 0/,'same diagnostic without the supported header remains an error');
  const damaged=path.join(root,'damaged.mkv');const bytes=await fs.readFile(variant);await fs.writeFile(damaged,bytes.subarray(0,Math.floor(bytes.length/3)));
  await assert.rejects(run(damaged),'truncated in-window content must fail');
 }
 assert.equal(digest(await fs.readFile(variant)),before,'source bytes unchanged');
 console.log('MPEG-2 initialization: generated control and header variant pass all three real extractors; content, frames, selected audio and timing match at 0 and 1.25 seconds.');
}finally{await fs.rm(root,{recursive:true,force:true});}
