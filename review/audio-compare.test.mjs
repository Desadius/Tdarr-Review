import test from 'node:test';import assert from 'node:assert/strict';import {alignment,envelope} from './audio-compare.mjs';
let seed=42;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
const a=Array.from({length:1200},random);
test('zero and positive/negative lag',()=>{for(const lag of [0,15,-23]){const b=a.map((_,i)=>a[i-lag]||0);const r=alignment(a,b);assert(r.reliable);assert.equal(r.offsetMs,lag*10)}});
test('silence and unrelated audio are inconclusive',()=>{for(const b of [Array(1200).fill(0),Array.from({length:1200},random)])assert.equal(alignment(a,b).reliable,false);assert.equal(alignment(a.slice(0,100),a).reliable,false)});
test('PCM RMS bins',()=>{const p=Buffer.alloc(320);for(let i=0;i<160;i+=2)p.writeInt16LE(16384,i);assert.deepEqual(envelope(p),[.5,0])});
