import test from 'node:test';
import assert from 'node:assert/strict';
import legacy from './legacy-sdr.cjs';
import {inspect} from './core.mjs';
const source=codec=>({streams:[{codec_type:'video',codec_name:codec,width:1920,height:1080,pix_fmt:'yuv420p',field_order:'progressive',avg_frame_rate:'24000/1001',sample_aspect_ratio:'1:1',color_transfer:'bt709',color_primaries:'bt709',color_space:'bt709',color_range:'tv'},{codec_type:'audio',codec_name:'dts',channels:6,tags:{language:'eng'}}],format:{duration:'600'},chapters:[]});
const output=a=>{const b=structuredClone(a);Object.assign(b.streams[0],{codec_name:'hevc',pix_fmt:'yuv420p10le'});b.format.tags={TDARR_SDR_PROFILE:legacy.MARKER};return b};
test('legacy codecs accepted with matching progressive output and marker',()=>{for(const codec of ['vc1','mpeg2video']){const a=source(codec),b=output(a);assert(legacy.eligible('film.mkv',a));assert.equal(inspect(a,b).durationMismatch,false)}});
test('legacy scope rejects interlaced, DVD, HDR, 3D, multiple video, anamorphic and AV1',()=>{
 for(const change of [v=>v.field_order='tt',v=>v.width=720,v=>v.color_transfer='smpte2084',v=>v.sample_aspect_ratio='4:3',v=>v.codec_name='av1',v=>v.avg_frame_rate='50/1',v=>v.side_data_list=[{side_data_type:'Stereo 3D'}]]){const a=source('vc1');change(a.streams[0]);assert(!legacy.eligible('film.mkv',a))}
 const a=source('vc1');a.streams.push({...a.streams[0]});assert(!legacy.eligible('film.mkv',a));assert(!legacy.eligible('film.mp4',source('vc1')));
});
test('Review rejects lost marker, frame rate, colour, aspect and field changes',()=>{
 for(const change of [b=>delete b.format.tags.TDARR_SDR_PROFILE,b=>b.streams[0].avg_frame_rate='25/1',b=>b.streams[0].color_transfer='unknown',b=>b.streams[0].sample_aspect_ratio='4:3',b=>b.streams[0].field_order='tt']){const a=source('mpeg2video'),b=output(a);change(b);assert.throws(()=>inspect(a,b))}
});
