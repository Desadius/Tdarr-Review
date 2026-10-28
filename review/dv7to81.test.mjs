import {test} from 'node:test';
import assert from 'node:assert/strict';
import dv7to81 from './dv7to81.cjs';
import {inspect} from './core.mjs';
const staticSide=()=>[{side_data_type:'Mastering display metadata',red_x:'34000/50000',red_y:'16000/50000',green_x:'13250/50000',green_y:'34500/50000',blue_x:'7500/50000',blue_y:'3000/50000',white_point_x:'15635/50000',white_point_y:'16450/50000',min_luminance:'1/10000',max_luminance:'2000/1'},{side_data_type:'Content light level metadata',max_content:1800,max_average:678}];
const p7={side_data_type:'DOVI configuration record',dv_profile:7,dv_bl_signal_compatibility_id:6,rpu_present_flag:1,el_present_flag:1,bl_present_flag:1};
const p81={side_data_type:'DOVI configuration record',dv_profile:8,dv_bl_signal_compatibility_id:1,rpu_present_flag:1,el_present_flag:0,bl_present_flag:1};
const video=config=>({codec_type:'video',codec_name:'hevc',width:3840,height:2160,pix_fmt:'yuv420p10le',color_transfer:'smpte2084',color_primaries:'bt2020',color_space:'bt2020nc',color_range:'tv',side_data_list:[{...config}]});
const file=(config,tags={})=>({streams:[video(config),{codec_type:'audio',codec_name:'truehd',channels:8,tags:{language:'eng'}}],format:{duration:'5421',tags},chapters:[],
 hdr10:{streams:[video(config)],frames:[{side_data_list:[...staticSide(),{side_data_type:'Dolby Vision RPU Data'},{side_data_type:'Dolby Vision Metadata'}]}]}});
const original=()=>file(p7),result=()=>file(p81,{TDARR_HDR_PROFILE:dv7to81.MARKER});

test('Review accepts a DV7 dual-layer original converted to DV 8.1 with unchanged picture size and HDR10 metadata',()=>{
 assert.equal(inspect(original(),result()).durationMismatch,false);
});

test('DV7 to 8.1 result is rejected when the result is not DV 8.1 BL+RPU',()=>{
 for(const change of [d=>{d.el_present_flag=1},d=>{d.dv_profile=7},d=>{d.dv_bl_signal_compatibility_id=6},d=>{d.rpu_present_flag=0}]){
  const b=result();change(b.hdr10.streams[0].side_data_list[0]);assert.throws(()=>inspect(original(),b));
 }
 const noRecord=result();noRecord.hdr10.streams[0].side_data_list=[];assert.throws(()=>inspect(original(),noRecord));
 const noFrameDV=result();noFrameDV.hdr10.frames[0].side_data_list=noFrameDV.hdr10.frames[0].side_data_list.filter(s=>s.side_data_type!=='Dolby Vision Metadata');assert.throws(()=>inspect(original(),noFrameDV));
});

test('DV7 to 8.1 result is rejected when the original is not DV7 dual layer',()=>{
 const p81Original=file(p81);assert.throws(()=>inspect(p81Original,result()),/DV7/);
 const noEL=original();noEL.hdr10.streams[0].side_data_list[0].el_present_flag=0;assert.throws(()=>inspect(noEL,result()));
 const hdr10Only=original();hdr10Only.hdr10.streams[0].side_data_list=[];hdr10Only.hdr10.frames[0].side_data_list=staticSide();assert.throws(()=>inspect(hdr10Only,result()));
});

test('DV7 to 8.1 result is rejected when HDR10 static metadata changed',()=>{
 const light=result();light.hdr10.frames[0].side_data_list[1].max_content=1000;assert.throws(()=>inspect(original(),light),/HDR10 static metadata/);
 const master=result();master.hdr10.frames[0].side_data_list[0].max_luminance='1000/1';assert.throws(()=>inspect(original(),master),/HDR10 static metadata/);
});

test('A DV 8.1 result without the DV7 to 8.1 marker is still not accepted from a DV7 original',()=>{
 const b=result();delete b.format.tags.TDARR_HDR_PROFILE;assert.throws(()=>inspect(original(),b),/HDR profil/);
});
