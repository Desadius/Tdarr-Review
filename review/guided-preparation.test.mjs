import test from 'node:test';
import assert from 'node:assert/strict';
import {guidedExcerptTimes,decodeGuidedPCM,prepareGuidedExcerpts} from './public/guided-preparation.js';

test('three editable excerpts retain the actual film time and a full bounded interval',()=>{
 assert.deepEqual(guidedExcerptTimes(120),[2.16,54,102.6]);
 assert.deepEqual(guidedExcerptTimes(120,[0,20,108]),[0,20,108]);
 assert.throws(()=>guidedExcerptTimes(11),/krátký/);
 assert.throws(()=>guidedExcerptTimes(120,[0,1,109]),/úsek/);
 assert.throws(()=>guidedExcerptTimes(120,[5,5,85]),/úsek/);
 assert.throws(()=>guidedExcerptTimes(120,[85,45,5]),/úsek/);
});
test('default excerpt times stay strictly increasing at the millisecond limit or request an external player',()=>{
 assert.throws(()=>guidedExcerptTimes(12),/krátký/);
 assert.throws(()=>guidedExcerptTimes(12.001),/krátký/);
 assert.deepEqual(guidedExcerptTimes(12.002),[0,.001,.002]);
 assert.deepEqual(guidedExcerptTimes(12.003),[0,.002,.003]);
 const values=guidedExcerptTimes(12.002);assert.ok(values[0]<values[1]&&values[1]<values[2]);
});
test('PCM reads little-endian samples without changing gains or genuine offsets',()=>{
 const bytes=Buffer.alloc(12);bytes.writeFloatLE(.25,0);bytes.writeFloatLE(-.5,4);bytes.writeFloatLE(0,8);
 assert.deepEqual([...decodeGuidedPCM({pcm:bytes.toString('base64'),sampleRate:48000,frames:3})],[.25,-.5,0]);
 assert.throws(()=>decodeGuidedPCM({pcm:'',sampleRate:48000,frames:3}),/úsek/);
 bytes.writeFloatLE(NaN,0);assert.throws(()=>decodeGuidedPCM({pcm:bytes.toString('base64'),sampleRate:48000,frames:3}),/vzork/);
});
test('preparation serializes all six requests and stops instead of skipping an unavailable excerpt',async()=>{
 let active=0,max=0;const calls=[],observed=[];
 const packet={pcm:Buffer.alloc(4).toString('base64'),sampleRate:48000,frames:1};
 const result=await prepareGuidedExcerpts({times:[1,30,60],scope:{originalIndex:1,reviewIndex:2},snapshot:'fixture',current:()=>true,
  load:async request=>{calls.push(request);max=Math.max(max,++active);await Promise.resolve();active--;return request.mode==='listen'?{original:packet,review:packet}:{original:'video-a',review:'video-b'}},
  onState:state=>observed.push(state)});
 assert.equal(max,1);assert.equal(result.length,3);assert.deepEqual(calls.map(x=>[x.seconds,x.mode]),[[1,'listen'],[1,'av'],[30,'listen'],[30,'av'],[60,'listen'],[60,'av']]);
 assert.ok(calls.every(x=>x.originalIndex===1&&x.reviewIndex===2&&x.snapshot==='fixture'));
 assert.equal(observed.at(-1)[2].status,'ready');
 const failed=[];await assert.rejects(prepareGuidedExcerpts({times:[1,30,60],scope:{originalIndex:1,reviewIndex:2},snapshot:'fixture',current:()=>true,load:async request=>{failed.push(request);return {pending:true}}}),/připrav/);
 assert.equal(failed.length,1,'a pending first excerpt must not silently jump to the next one');
});
test('stale preparation never publishes a ready result or starts another encoder',async()=>{
 let current=true;const calls=[],states=[];
 const packet={pcm:Buffer.alloc(4).toString('base64'),sampleRate:48000,frames:1};
 await assert.rejects(prepareGuidedExcerpts({times:[1,30,60],scope:{originalIndex:1,reviewIndex:2},snapshot:'fixture',current:()=>current,onState:value=>states.push(value),load:async request=>{calls.push(request);current=false;return {original:packet,review:packet}}}),/změnil/);
 assert.equal(calls.length,1);assert.ok(!states.some(rows=>rows.some(x=>x.status==='ready')));
});
