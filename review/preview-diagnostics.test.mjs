import test from 'node:test';import assert from 'node:assert/strict';import {previewErrors,hasDolbyVisionEnhancementLayer}from './preview-diagnostics.mjs';
test('only exact Matroska seek message is tolerated; decode failures remain visible',()=>{
 const cue='[matroska,webm @ 0x0123abc] File is broken, keyframes not correctly marked!';
 assert.equal(previewErrors(cue+'\n'+cue),'');
 for(const failure of ['[truehd @ 0x01] Invalid data found when processing input','[hevc @ 0x01] Error decoding frame','[matroska,webm @ 0x01] File is broken!','unexpected failure'])assert.equal(previewErrors(cue+'\n'+failure),failure);
});
test('DV7 FEL enhancement-layer PPS message is tolerated only for that source (#300)',()=>{
 const pps='[hevc @ 0x55a9af27eec0] PPS changed between slices.',repeat='    Last message repeated 6 times';
 const stderr=[pps,repeat,pps.replace('27eec0','2a6dc0'),repeat].join('\n');
 assert.equal(previewErrors(stderr,{dolbyVisionEnhancementLayer:true}),'');
 assert.equal(previewErrors(stderr),stderr);
 assert.equal(previewErrors(stderr,{dolbyVisionEnhancementLayer:false}),stderr);
 for(const failure of ['[hevc @ 0x01] Error decoding frame','[h264 @ 0x01] PPS changed between slices.','[hevc @ 0x01] PPS changed between slices. extra'])assert.equal(previewErrors(pps+'\n'+failure,{dolbyVisionEnhancementLayer:true}),failure);
 // A repeat line belongs to the message before it: after a real failure it stays visible.
 assert.equal(previewErrors('[hevc @ 0x01] Error decoding frame\n'+repeat,{dolbyVisionEnhancementLayer:true}),'[hevc @ 0x01] Error decoding frame\n'+repeat);
 assert.equal(previewErrors(repeat,{dolbyVisionEnhancementLayer:true}),repeat);
});
test('only a Dolby Vision profile 7 stream with an enhancement layer qualifies (#300)',()=>{
 const dovi=(profile,el)=>({side_data_list:[{side_data_type:'DOVI configuration record',dv_profile:profile,el_present_flag:el,bl_present_flag:1,rpu_present_flag:1}]});
 assert.equal(hasDolbyVisionEnhancementLayer(dovi(7,1)),true);
 for(const video of [dovi(7,0),dovi(8,0),dovi(8,1),{side_data_list:[]},{},null,undefined])assert.equal(hasDolbyVisionEnhancementLayer(video),false);
});
