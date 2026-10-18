// Real-extraction regression for #183 (npm run test:dts-seek): raw FFmpeg fails after the 2 and 30 s
// seeks, and the public extractor recovers the same sample. Never a production-media diagnostic.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {extractPreview,previewArgs} from '../review/av-preview.mjs';
import {validateRecoveredPreview} from '../review/preview-validation.mjs';
import {loadDtsSample} from './fetch-dts-seek-sample.mjs';
import {buildDtsSeekAudio} from './dts-seek-fixture.mjs';

const exe=process.env.FFMPEG||'ffmpeg',probe=process.env.FFPROBE||'ffprobe';
// --expect-recovered is kept for the reproduction handoff; recovery is now always required.
assert.ok(process.argv.slice(2).every(arg=>arg==='--expect-recovered'),'Unknown option');
assert.ok(process.env.DTS_SAMPLE_DIR,'Set DTS_SAMPLE_DIR to the pinned public-domain sample directory; see docs/DEVELOPMENT.md.');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'dts-seek-repro-'));
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const run=(command,args)=>spawnSync(command,args,{timeout:90000,maxBuffer:20*1024*1024,windowsHide:true});
function clean(command,args){
 const result=run(command,args);
 assert.ifError(result.error);
 assert.equal(result.status,0,result.stderr?.toString().slice(-4096));
 assert.equal(result.stderr.length,0,result.stderr.toString().slice(-4096));
 return result.stdout;
}
const metadata=file=>JSON.parse(clean(probe,['-v','error','-show_streams','-show_format','-of','json',file]));
const changedArgs=(args,seek)=>{
 const result=[...args],position=result.indexOf('-ss');
 assert.ok(position>=0&&position<result.indexOf('-i'),'Expected input seek');
 result[position+1]=String(seek);
 return result;
};
const decoded=(file,stream)=>clean(exe,['-v','error','-i',file,'-map',`0:${stream}`,...(stream==='v:0'?['-pix_fmt','yuv420p','-f','rawvideo']:['-ac','1','-ar','48000','-f','f32le']),'pipe:1']);
const failure=/Changing audio frame properties on the fly is not supported/;
const evidence=[];
try{
 const raw=path.join(root,'generated.dts');
 await fs.writeFile(raw,buildDtsSeekAudio(await loadDtsSample(process.env.DTS_SAMPLE_DIR)));
 // A continuous, strict decode must be clean. This distinguishes initialization
 // after seeking from a permanently broken source or an actual format switch.
 clean(exe,['-v','error','-xerror','-err_detect','crccheck+careful+explode','-f','dts','-i',raw,'-f','null','-']);
 for(const [side,codec,selected] of [['original','libx264',1],['review','libx265',2]]){
  const source=path.join(root,side+'.mkv');
  const videoOptions=codec==='libx264'?['-g','24','-keyint_min','24','-sc_threshold','0','-bf','0']:['-x265-params','log-level=error:pools=none:frame-threads=1:keyint=24:min-keyint=24:scenecut=0:bframes=0'];
  const maps=selected===1?['0:v','1:a','2:a']:['0:v','2:a','1:a'];
  clean(exe,['-v','error','-f','lavfi','-i','testsrc2=size=256x144:rate=24','-f','dts','-i',raw,'-f','lavfi','-i','sine=frequency=997:sample_rate=48000',...maps.flatMap(map=>['-map',map]),'-t','84','-c:v',codec,'-preset','veryfast','-threads','2',...videoOptions,'-c:a:0',selected===1?'copy':'pcm_s16le','-c:a:1',selected===2?'copy':'pcm_s16le','-cluster_time_limit','500','-output_ts_offset','5',source]);
  const meta=metadata(source),video=meta.streams.find(stream=>stream.codec_type==='video'),audio=meta.streams.find(stream=>stream.index===selected),origin=Number(meta.format.start_time);
  assert.equal(audio.codec_name,'dts');assert.equal(audio.sample_rate,'48000');assert.equal(audio.channels,6);assert.equal(origin,5);
  const sourceHash=digest(await fs.readFile(source));
  const seconds=68;
  for(const profile of ['compact','detail']){
   const args=previewArgs(source,selected,seconds,origin,video,profile);
   for(const preroll of [2,30]){
    const frames=JSON.parse(clean(probe,['-v','error','-read_intervals',`${seconds-preroll+origin}%+2`,'-select_streams',String(selected),'-show_frames','-show_entries','frame=sample_fmt,channels,channel_layout,pts_time','-of','json',source])).frames;
    assert.ok(frames.some(frame=>frame.sample_fmt==='s32p')&&frames.some(frame=>frame.sample_fmt==='s16p'),`${side}: the actual seek must decode a sample-format transition`);
    assert.ok(frames.every(frame=>frame.channels===6),'Channel count must stay fixed');
    const failed=run(exe,changedArgs(args,seconds-preroll));
    assert.ifError(failed.error);assert.notEqual(failed.status,0,'This fixture must exercise a real extraction failure');
    assert.match(failed.stderr.toString(),failure);
   }
   // The real public extractor must recover the sample by itself (2 → 30 → 60 s preroll).
   const recovered=await extractPreview(exe,source,selected,seconds,origin,video,profile);
   const reference=path.join(root,`${side}-${profile}-reference.mp4`),candidate=path.join(root,`${side}-${profile}-candidate.mp4`);
   await fs.writeFile(reference,clean(exe,changedArgs(args,0)));
   await fs.writeFile(candidate,Buffer.from(recovered,'base64'));
   const encoded=(await fs.readFile(candidate)).toString('base64');
   await validateRecoveredPreview(exe,encoded,{deadline:Date.now()+30000,frameRate:24});
   const missing=path.join(root,'missing-audio.mp4');
   clean(exe,['-v','error','-y','-i',candidate,'-map','0:v','-c','copy',missing]);
   await assert.rejects(validateRecoveredPreview(exe,(await fs.readFile(missing)).toString('base64'),{deadline:Date.now()+10000,frameRate:24}),'Video-only output must remain rejected');
   const short=path.join(root,'short-audio.mp4');
   clean(exe,['-v','error','-y','-i',candidate,'-af','atrim=end=1','-c:v','copy','-c:a','aac',short]);
   await assert.rejects(validateRecoveredPreview(exe,(await fs.readFile(short)).toString('base64'),{deadline:Date.now()+10000,frameRate:24}),'One second of audio must not satisfy the 12-second sample');
   const result=metadata(candidate),v=result.streams.find(stream=>stream.codec_type==='video'),a=result.streams.find(stream=>stream.codec_type==='audio');
   assert.equal(v.codec_name,'h264');assert.equal(a.codec_name,'aac');assert.equal(a.channels,1);assert.equal(a.sample_rate,'48000');
   assert.ok(Math.abs(Number(result.format.duration)-12)<.1);
   const pixels=decoded(candidate,'v:0'),pcm=decoded(candidate,'a:0');
   assert.equal(pixels.length,256*144*1.5*288,'All 288 requested video frames must be present');
   assert.equal(digest(pixels),digest(decoded(reference,'v:0')),'Decoded scene and frame coverage must match the no-seek reference');
   assert.equal(digest(pcm),digest(decoded(reference,'a:0')),'Selected audio and common timeline must match the no-seek reference');
   assert.ok(pcm.every(byte=>byte===0),'The generated selected DTS track is silent; the other track is a nonzero tone');
   const wrongArgs=previewArgs(source,selected===1?2:1,seconds,origin,video,profile),wrong=path.join(root,'wrong-track.mp4');
   await fs.writeFile(wrong,clean(exe,changedArgs(wrongArgs,seconds-60)));
   assert.notEqual(digest(decoded(wrong,'a:0')),digest(pcm),'The content assertion must detect a different selected input track');
   const shifted=path.join(root,'wrong-scene.mp4');
   await fs.writeFile(shifted,clean(exe,changedArgs(previewArgs(source,selected,seconds+1,origin,video,profile),seconds-60)));
   assert.notEqual(digest(decoded(shifted,'v:0')),digest(pixels),'The scene assertion must detect a one-second target shift');
   evidence.push({side,video:video.codec_name,profile,selectedAudioIndex:selected,targetSeconds:seconds,containerOrigin:origin,baseline:'real DTS sample-format error',recoveredBy:'extractPreview',frames:288,duration:Number(result.format.duration),decodedVideoMatchesReference:true,decodedAudioMatchesReference:true,wrongTrackDetected:true,wrongSceneDetected:true});
  }
  assert.equal(digest(await fs.readFile(source)),sourceHash,'Source file must remain unchanged');
 }
 console.log(JSON.stringify({passed:true,evidence},null,2));
}finally{
 await fs.rm(root,{recursive:true,force:true});
}
