import test from 'node:test';
import assert from 'node:assert/strict';
import {previewArgs,previewProfile,canRetryPreviewSeek,withPreviewSeekRetry} from './av-preview.mjs';
test('AV preview preserves stream differences by subtracting one container origin',()=>{
 const args=previewArgs('/source.mkv',3,300,5,{index:0,color_transfer:'bt709'}),f=args[args.indexOf('-filter_complex')+1];
 assert.match(f,/\[0:0\]trim=start=305:end=317,setpts=PTS-\(305\)\/TB/);
 assert.match(f,/\[0:3\]atrim=start=305:end=317,asetpts=PTS-\(305\)\/TB/);
 assert.doesNotMatch(f,/STARTPTS|loudnorm|dynaudnorm/);assert.equal(args[args.indexOf('-ss')+1],'298');assert(args.includes('-copyts'));assert.equal(args[args.indexOf('-bf')+1],'0');
});
test('AV preview rejects unsupported colours and invalid indexes rather than silent tone mapping',()=>{
 for(const v of ['arib-std-b67','linear'])assert.throws(()=>previewArgs('x',1,0,0,{index:0,color_transfer:v}));
 for(const [index,time] of [[-1,0],[1,-1],[1,NaN]])assert.throws(()=>previewArgs('x',index,time,0,{index:0}));
 const hdr=previewArgs('x',1,0,0,{index:0,color_transfer:'smpte2084'});assert.match(hdr[hdr.indexOf('-filter_complex')+1],/tonemap=tonemap=mobius/);
});

test('preview profiles enforce fixed pixel budgets and quality without weakening timing or threads',()=>{
 for(const [name,width,height,crf]of [['compact',960,540,24],['detail',1920,1080,16]]){
  assert.deepEqual(previewProfile(name),{width,height,crf});
  const args=previewArgs('movie',1,300,5,{index:0},name),filter=args[args.indexOf('-filter_complex')+1];
  assert.equal(args[args.indexOf('-crf')+1],String(crf));
  assert.match(filter,new RegExp(`min\\(${width},${height}\\*`));
  assert.match(filter,/iw\*if\(gt\(sar,0\),sar,1\)/);assert.match(filter,/setsar=1/);
  assert.equal(args[args.indexOf('-filter_complex_threads')+1],'1');assert.equal(args[args.indexOf('-t')+1],'12');
  assert.doesNotMatch(filter,/STARTPTS/);assert.equal(args[args.indexOf('-maxrate')+1],name==='detail'?'10M':'3M');assert.equal(args[args.indexOf('-bufsize')+1],name==='detail'?'10M':'3M');
 }
 for(const name of ['unknown','__proto__',null])assert.throws(()=>previewArgs('movie',1,0,0,{index:0},name));
});

const seekError=diagnostics=>Object.assign(Error('decode failed'),{previewDiagnostics:diagnostics,previewExitCode:0});
const decoderErrors='[h264 @ 0x123abc] top block unavailable for requested intra mode -1\n[h264 @ 0x123abc] Reference 2 >= 2\n[h264 @ 0x123abc] error while decoding MB 12 0, bytestream 547';
const seekContext={seconds:110,video:{index:0,codec_name:'h264',color_transfer:'bt709'}};

test('H264 seek recovery changes only input seek, preserving shared trim/PTS and every quality limit',()=>{
 const normal=previewArgs('movie',1,110,5,seekContext.video,'detail'),retry=previewArgs('movie',1,110,5,seekContext.video,'detail',30);
 const position=normal.indexOf('-ss')+1;assert.equal(normal[position],'108');assert.equal(retry[position],'80');retry[position]=normal[position];assert.deepEqual(retry,normal);
 assert.match(normal[normal.indexOf('-filter_complex')+1],/trim=start=115:end=127,setpts=PTS-\(115\)\/TB/);
 assert.equal(normal[normal.indexOf('-t')+1],'12');assert.equal(canRetryPreviewSeek(seekError(decoderErrors),seekContext),true);
 assert.equal(canRetryPreviewSeek(seekError('[matroska,webm @ 0xabcdef] File is broken, keyframes not correctly marked!\n'+decoderErrors),seekContext),true);
});

test('seek recovery excludes other codecs, non-earlier seeks, aborts, permissions, timeouts and other diagnostics',()=>{
 for(const context of [{...seekContext,video:{codec_name:'hevc'}},{...seekContext,seconds:2},{...seekContext,seconds:0},{...seekContext,signal:{aborted:true}}])assert.equal(canRetryPreviewSeek(seekError(decoderErrors),context),false);
 for(const error of [Error('Permission denied'),Error('Příprava náhledu překročila 90 sekund.'),Error('Náhled překročil limit velikosti.'),Object.assign(seekError(decoderErrors),{previewExitCode:null}),seekError(decoderErrors+'\nPermission denied'),seekError(decoderErrors+'\n[libx264 @ 0x123abc] Error initializing output stream'),seekError('[h264 @ 0x123abc] Invalid NAL unit size'),seekError('')])assert.equal(canRetryPreviewSeek(error,seekContext),false);
});

const mmco='[h264 @ 0x58b4eae58e00] mmco: unref short failure';
test('H264 mmco unref failure after a mid-GOP seek qualifies alone or with the other seek diagnostics',()=>{
 for(const diagnostics of [mmco+'\n',`${mmco}\n${mmco}\n`,decoderErrors+'\n'+mmco,'[matroska,webm @ 0xabcdef] File is broken, keyframes not correctly marked!\n'+mmco])assert.equal(canRetryPreviewSeek(seekError(diagnostics),seekContext),true,diagnostics);
 for(const context of [{...seekContext,video:{codec_name:'hevc'}},{...seekContext,video:{codec_name:'mpeg2video'}},{...seekContext,seconds:2},{...seekContext,seconds:0},{...seekContext,signal:{aborted:true}}])assert.equal(canRetryPreviewSeek(seekError(mmco),context),false);
 assert.equal(canRetryPreviewSeek(Object.assign(seekError(mmco),{previewExitCode:null}),seekContext),false);
 for(const diagnostics of [mmco+' at frame 12','[h264 @ 0x123abc] mmco: unref short failure: fatal','[h264 @ 0x123abc] mmco: unref long failure','[hevc @ 0x123abc] mmco: unref short failure',mmco+'\n[h264 @ 0x123abc] Missing reference picture, default is 0',mmco+'\n[h264 @ 0x123abc] co located POCs unavailable',mmco+'\n    Last message repeated 5 times',mmco+'\n[aac @ 0x123abc] Error submitting frame to encoder'])assert.equal(canRetryPreviewSeek(seekError(diagnostics),seekContext),false,diagnostics);
});

test('mmco unref failure retries once with 30 seconds of preroll and keeps the original error if it repeats',async()=>{
 const attempts=[];assert.equal(await withPreviewSeekRetry(async preroll=>{attempts.push(preroll);if(preroll===2)throw seekError(mmco);return 'validated MP4'},seekContext),'validated MP4');assert.deepEqual(attempts,[2,30]);
 let count=0;const failure=seekError(mmco);await assert.rejects(withPreviewSeekRetry(async()=>{count++;throw failure},seekContext),error=>error===failure);assert.equal(count,2);
 const controller=new AbortController();let calls=0;await assert.rejects(withPreviewSeekRetry(async()=>{calls++;controller.abort();throw seekError(mmco)},{...seekContext,signal:controller.signal}),error=>error.previewDiagnostics===mmco);assert.equal(calls,1);
});

test('eligible retry runs once; failure never becomes readiness and abort never triggers a retry',async()=>{
 const attempts=[];const result=await withPreviewSeekRetry(async preroll=>{attempts.push(preroll);if(preroll===2)throw seekError(decoderErrors);return 'validated MP4'},seekContext);
 assert.equal(result,'validated MP4');assert.deepEqual(attempts,[2,30]);
 let count=0;const failure=seekError(decoderErrors);await assert.rejects(withPreviewSeekRetry(async()=>{count++;throw failure},seekContext),error=>error===failure);assert.equal(count,2);
 for(const error of [Error('Permission denied'),Error('timeout'),seekError(decoderErrors+'\n[libx264 @ 0x123abc] invalid encoder quality')]){let calls=0;await assert.rejects(withPreviewSeekRetry(async()=>{calls++;throw error},seekContext),value=>value===error);assert.equal(calls,1)}
 const controller=new AbortController();let calls=0;await assert.rejects(withPreviewSeekRetry(async()=>{calls++;controller.abort();throw seekError(decoderErrors)},{...seekContext,signal:controller.signal}));assert.equal(calls,1);
 const aborted=new AbortController();aborted.abort();await assert.rejects(withPreviewSeekRetry(async()=>{calls++;return 'must not render'},{...seekContext,signal:aborted.signal}));assert.equal(calls,1);
});
