import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspect} from './core.mjs';
import hdr from './hdr10.cjs';
const side=[{side_data_type:'Mastering display metadata',red_x:'34000/50000',red_y:'16000/50000',green_x:'13250/50000',green_y:'34500/50000',blue_x:'7500/50000',blue_y:'3000/50000',white_point_x:'15635/50000',white_point_y:'16450/50000',min_luminance:'1/10000',max_luminance:'10000000/10000'},{side_data_type:'Content light level metadata',max_content:1000,max_average:200}];
const video={codec_type:'video',codec_name:'hevc',width:3840,height:2160,pix_fmt:'yuv420p10le',color_transfer:'smpte2084',color_primaries:'bt2020',color_space:'bt2020nc',color_range:'tv'};
const p=()=>({streams:[structuredClone(video),{codec_type:'audio',codec_name:'ac3',channels:6}],format:{duration:'60',tags:{}},chapters:[],hdr10:{streams:[structuredClone(video)],frames:[{side_data_list:structuredClone(side)}]}});
test('HDR Review requires marker and matching HDR metadata',()=>{const a=p(),b=p();assert.throws(()=>inspect(a,b));b.format.tags.TDARR_HDR_PROFILE=hdr.MARKER;assert.equal(inspect(a,b).durationMismatch,false);b.hdr10.frames[0].side_data_list[1].max_content=999;assert.throws(()=>inspect(a,b));});
test('HDR Review rejects already converted source and dynamic HDR',()=>{const a=p(),b=p();b.format.tags.TDARR_HDR_PROFILE=hdr.MARKER;a.format.tags.TDARR_HDR_PROFILE=hdr.MARKER;assert.throws(()=>inspect(a,b));delete a.format.tags.TDARR_HDR_PROFILE;a.hdr10.frames[0].side_data_list.push({side_data_type:'DOVI configuration record'});assert.throws(()=>inspect(a,b));});
