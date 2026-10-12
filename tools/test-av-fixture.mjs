// Disposable real-FFmpeg timing regression; never opens production media.
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {command} from '../review/core.mjs';import {extractPreview} from '../review/av-preview.mjs';import {extractAudio,alignment} from '../review/audio-compare.mjs';
const exe=process.env.FFMPEG||'ffmpeg',probe=process.env.FFPROBE||'ffprobe',root=await fs.mkdtemp(path.join(os.tmpdir(),'av-fixture-'));
try{
 const src=path.join(root,'source.mkv');
 await command(exe,['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i',"aevalsrc='if(lt(mod(t,1),0.13),sin(2*PI*440*t),0)':s=48000",'-af','adelay=300:all=1','-t','15','-c:v','libx264','-threads','1','-bf','0','-c:a','pcm_s16le','-output_ts_offset','5',src]);
 const meta=JSON.parse(await command(probe,['-v','error','-show_streams','-show_format','-of','json',src]));
 const v=meta.streams.find(s=>s.codec_type==='video'),a=meta.streams.find(s=>s.codec_type==='audio');
 const base=Number(meta.format.start_time);const output=await extractPreview(exe,src,a.index,1,base,v);const clip=path.join(root,'clip.mp4');await fs.writeFile(clip,Buffer.from(output,'base64'));
 const m=JSON.parse(await command(probe,['-v','error','-show_streams','-show_format','-of','json',clip]));assert(m.streams.some(s=>s.codec_name==='h264'));assert(m.streams.some(s=>s.codec_name==='aac'));assert(Number(m.format.duration)>11.8);
 const original=await extractAudio(exe,src,a.index,1,base),copy=await extractAudio(exe,clip,1,0,Number(m.format.start_time||0));
 // Periodic tone is ambiguous to correlation, inspect waveform's silence-to-tone onset directly.
 const onset=wave=>wave.findIndex(x=>x>.1)*10;
 assert(Math.abs(onset(original)-onset(copy))<=40,`Original ${onset(original)}ms vs preview ${onset(copy)}ms`);
 assert(onset(copy)>=250,`Deliberate 300ms audio delay was hidden: ${onset(copy)}ms`);
 console.log(JSON.stringify({passed:true,containerStart:base,originalOnsetMs:onset(original),previewOnsetMs:onset(copy),duration:Number(m.format.duration)}));
}finally{await fs.rm(root,{recursive:true,force:true})}
