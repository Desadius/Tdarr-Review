import {test} from 'node:test';
import assert from 'node:assert/strict';
import dv from './dv81.cjs';
import dual from './dual-hdr.cjs';
import {inspect} from './core.mjs';
const staticSide=[{side_data_type:'Mastering display metadata',red_x:'34000/50000',red_y:'16000/50000',green_x:'13250/50000',green_y:'34500/50000',blue_x:'7500/50000',blue_y:'3000/50000',white_point_x:'15635/50000',white_point_y:'16450/50000',min_luminance:'1/10000',max_luminance:'10000000/10000'},{side_data_type:'Content light level metadata',max_content:1000,max_average:200}];
const config={side_data_type:'DOVI configuration record',dv_profile:8,dv_bl_signal_compatibility_id:1,rpu_present_flag:1,el_present_flag:0,bl_present_flag:1};
const video={codec_type:'video',codec_name:'hevc',width:3840,height:2160,pix_fmt:'yuv420p10le',color_transfer:'smpte2084',color_primaries:'bt2020',color_space:'bt2020nc',color_range:'tv',side_data_list:[config]};
const p=()=>({streams:[structuredClone(video),{codec_type:'audio',codec_name:'ac3',channels:6}],format:{duration:'60',tags:{}},chapters:[],hdr10:{streams:[structuredClone(video)],frames:[{side_data_list:[...structuredClone(staticSide),{side_data_type:'Dolby Vision Metadata',rpu_type:2}]}]}});
test('Dual HDR Review accepts both profiles and rejects loss of either one',()=>{
 const a=p(),b=p();for(const q of [a,b])q.hdr10.frames[0].side_data_list.push({side_data_type:'HDR Dynamic Metadata SMPTE2094-40 (HDR10+)'});
 b.format.tags.TDARR_HDR_PROFILE=dual.MARKER;assert.equal(inspect(a,b).durationMismatch,false);
 const noPlus=structuredClone(b);noPlus.hdr10.frames[0].side_data_list=noPlus.hdr10.frames[0].side_data_list.filter(s=>!s.side_data_type.includes('HDR10+'));assert.throws(()=>inspect(a,noPlus));
 const noDV=structuredClone(b);noDV.hdr10.frames[0].side_data_list=noDV.hdr10.frames[0].side_data_list.filter(s=>s.side_data_type!=='Dolby Vision Metadata');assert.throws(()=>inspect(a,noDV));
 b.format.tags.TDARR_HDR_PROFILE=dv.MARKER;assert.throws(()=>inspect(a,b));
});
test('DV Review accepts DV81 marker and matching metadata; rejects stripping and wrong profile',()=>{
 const a=p(),b=p();b.format.tags.TDARR_HDR_PROFILE=dv.MARKER;assert.equal(inspect(a,b).durationMismatch,false);
 b.hdr10.streams[0].side_data_list=[];assert.throws(()=>inspect(a,b));
 const c=p();c.hdr10.streams[0].side_data_list[0].dv_profile=7;assert.throws(()=>dv.signature(c.hdr10));
 const d=p();d.hdr10.streams[0].side_data_list[0].el_present_flag=1;assert.throws(()=>dv.signature(d.hdr10));
 const e=p();e.hdr10.frames[0].side_data_list.push({side_data_type:'HDR10+ metadata'});assert.throws(()=>dv.signature(e.hdr10));
});
test('DV frame JSON streaming handles arbitrary chunks, escaped text, nesting and truncation',()=>{
 const frames=[{side_data_list:[{a:'text \\"',nested:{x:[1,2]}}]},{a:2}],s=JSON.stringify({frames});let got=[];const parser=dv.frameParser(f=>got.push(f));for(const c of s)parser.write(c);parser.end();assert.deepEqual(got,frames);
 const bad=dv.frameParser(()=>{});bad.write('{"frames":[{"a":1');assert.throws(()=>bad.end());
});
test('DV complete metadata proof rejects changed metadata, missing frames or shifted start',()=>{
 const a={count:100,first:0,last:4,sha256:'abc'};dv.compareDigests(a,{...a,last:4.001});
 for(const b of [{...a,count:99},{...a,sha256:'def'},{...a,first:1}])assert.throws(()=>dv.compareDigests(a,b));
});
