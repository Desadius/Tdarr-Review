// Disposable real-FFmpeg timing regression; never opens production media.
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {command} from '../review/core.mjs';import {extractPreview} from '../review/av-preview.mjs';import {extractAudio,alignment} from '../review/audio-compare.mjs';
const exe=process.env.FFMPEG||'ffmpeg',probe=process.env.FFPROBE||'ffprobe',root=await fs.mkdtemp(path.join(os.tmpdir(),'av-fixture-'));
try{
 const src=path.join(root,'source.mkv');
 await command(exe,['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i',"aevalsrc='if(lt(mod(t,1),0.13),sin(2*PI*440*t),0)':s=48000",'-af','adelay=300:all=1','-t','15','-c:v','libx264','-threads','1','-bf','0','-c:a','pcm_s16le','-output_ts_offset','5',src]);
 const meta=JSON.parse(await command(probe,['-v','error','-show_streams','-show_format','-of','json',src]));
 const v=meta.streams.find(s=>s.codec_type==='video'),a=meta.streams.find(s=>s.codec_type==='audio');
 const base=Number(meta.format.start_time);const output=await extractPreview(exe,src,a.index,1,base,v,'detail');const clip=path.join(root,'clip.mp4');await fs.writeFile(clip,Buffer.from(output,'base64'));
 const m=JSON.parse(await command(probe,['-v','error','-show_streams','-show_format','-of','json',clip]));assert(m.streams.some(s=>s.codec_name==='h264'));assert(m.streams.some(s=>s.codec_name==='aac'));assert(Number(m.format.duration)>11.8);
 const original=await extractAudio(exe,src,a.index,1,base),copy=await extractAudio(exe,clip,1,0,Number(m.format.start_time||0));
 // Periodic tone is ambiguous to correlation, inspect waveform's silence-to-tone onset directly.
 const onset=wave=>wave.findIndex(x=>x>.1)*10;
 assert(Math.abs(onset(original)-onset(copy))<=40,`Original ${onset(original)}ms vs preview ${onset(copy)}ms`);
 assert(onset(copy)>=250,`Deliberate 300ms audio delay was hidden: ${onset(copy)}ms`);
 // Display geometry must remain correct for anamorphic and portrait sources.
 for(const [name,width,height,sar,profile,rate=24]of [['anamorphic',320,240,'3/2','detail'],['portrait',360,640,'1/1','compact'],['oversized',2560,1440,'1/1','detail',2]]){
  const input=path.join(root,name+'.mkv');
  await command(exe,['-v','error','-f','lavfi','-i',`testsrc2=size=${width}x${height}:rate=${rate}`,'-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-vf','setsar='+sar,'-t','14','-c:v','libx264','-threads','1','-c:a','pcm_s16le',input]);
  const source=JSON.parse(await command(probe,['-v','error','-show_streams','-show_format','-of','json',input])),video=source.streams.find(s=>s.codec_type==='video'),audio=source.streams.find(s=>s.codec_type==='audio');
  const preview=await extractPreview(exe,input,audio.index,1,Number(source.format.start_time||0),video,profile),target=path.join(root,name+'.mp4');await fs.writeFile(target,Buffer.from(preview,'base64'));
  const result=JSON.parse(await command(probe,['-v','error','-show_streams','-of','json',target])).streams.find(s=>s.codec_type==='video');
  const [numerator,denominator]=sar.split('/').map(Number),expected=width/height*numerator/denominator;
  assert.equal(result.sample_aspect_ratio,'1:1');assert(Math.abs(result.width/result.height-expected)<.004);
  assert(result.width<=(profile==='detail'?1920:960)&&result.height<=(profile==='detail'?1080:540));
  assert(result.width<=width*numerator/denominator&&result.height<=height,'Source was needlessly enlarged');
  if(name==='oversized')assert.deepEqual([result.width,result.height],[1920,1080]);
 }
 // Open-GOP H.264 seeked one second past a 20-second keyframe emits only 'mmco: unref short failure'.
 const openGop=path.join(root,'open-gop.mkv');
 await command(exe,['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','60','-c:v','libx264','-preset','veryfast','-x264-params','open-gop=1:keyint=480:min-keyint=480:b-pyramid=normal:ref=8:bframes=3','-c:a','aac',openGop]);
 const gopSource=JSON.parse(await command(probe,['-v','error','-show_streams','-show_format','-of','json',openGop])),gopVideo=gopSource.streams.find(s=>s.codec_type==='video'),gopAudio=gopSource.streams.find(s=>s.codec_type==='audio');
 const recovered=await extractPreview(exe,openGop,gopAudio.index,41,Number(gopSource.format.start_time||0),gopVideo,'compact'),recoveredClip=path.join(root,'open-gop.mp4');await fs.writeFile(recoveredClip,Buffer.from(recovered,'base64'));
 const recoveredMeta=JSON.parse(await command(probe,['-v','error','-show_streams','-show_format','-of','json',recoveredClip]));
 assert(recoveredMeta.streams.some(s=>s.codec_name==='h264')&&recoveredMeta.streams.some(s=>s.codec_name==='aac'));assert(Number(recoveredMeta.format.duration)>11.8,`Recovered clip lasts ${recoveredMeta.format.duration}s`);
 console.log(JSON.stringify({passed:true,containerStart:base,originalOnsetMs:onset(original),previewOnsetMs:onset(copy),duration:Number(m.format.duration)}));
}finally{await fs.rm(root,{recursive:true,force:true})}
