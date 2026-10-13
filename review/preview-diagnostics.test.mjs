import test from 'node:test';import assert from 'node:assert/strict';import {previewErrors}from './preview-diagnostics.mjs';
test('only exact Matroska seek message is tolerated; decode failures remain visible',()=>{
 const cue='[matroska,webm @ 0x0123abc] File is broken, keyframes not correctly marked!';
 assert.equal(previewErrors(cue+'\n'+cue),'');
 for(const failure of ['[truehd @ 0x01] Invalid data found when processing input','[hevc @ 0x01] Error decoding frame','[matroska,webm @ 0x01] File is broken!','unexpected failure'])assert.equal(previewErrors(cue+'\n'+failure),failure);
});
