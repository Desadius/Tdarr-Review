import test from 'node:test';
import assert from 'node:assert/strict';
import {projectSeasonTechnicalFacts,projectTechnicalFacts} from './sonarr-technical-facts.mjs';

const stream={index:0,codec_type:'video',codec_name:'hevc',width:1920,height:1080,avg_frame_rate:'24000/1001',r_frame_rate:'24000/1001',field_order:'progressive',pix_fmt:'yuv420p',bits_per_raw_sample:'8',color_primaries:'bt709',color_transfer:'bt709',color_space:'bt709',color_range:'tv',side_data_list:[],disposition:{},tags:{ENCODER:'Lavc61.19.100 libx265'}};

test('season facts preserve a self-declared video-stream encoder tag, not the format muxer tag',()=>{
 const result=projectSeasonTechnicalFacts({streams:[stream],format:{format_name:'matroska,webm',duration:'21.5',tags:{ENCODER:'Lavf61.1.100'}}});
 assert.equal(result.video[0].declaredEncoderTag,'Lavc61.19.100 libx265');
 assert.equal(Object.hasOwn(result,'declaredEncoderTag'),false);
 const noStreamTag=projectSeasonTechnicalFacts({streams:[{...stream,tags:{}}],format:{format_name:'matroska',tags:{ENCODER:'Lavf61.1.100'}}});
 assert.equal(noStreamTag.video[0].declaredEncoderTag,null,'the muxer tag cannot stand in for an encoder declaration');
});

test('existing technical-facts API projection keeps its established shape',()=>{
 const result=projectTechnicalFacts({streams:[stream],format:{format_name:'matroska',duration:'21.5',tags:{ENCODER:'Lavf61.1.100'}}});
 assert.deepEqual(Object.keys(result),['durationSeconds','video','audio','subtitles']);
 assert.equal(Object.hasOwn(result.video[0],'declaredEncoderTag'),false);
});
