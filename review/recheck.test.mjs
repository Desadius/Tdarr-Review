import test from 'node:test';
import assert from 'node:assert/strict';
import {remountOnly,durationException} from './recheck.mjs';
test('only device identity can differ',()=>{const p={originalFP:'48:123:400:500:600',reviewFP:'46:124:200:700:800'};assert(remountOnly(p,'47:123:400:500:600','45:124:200:700:800'));for(const a of ['47:999:400:500:600','47:123:401:500:600','47:123:400:501:600','47:123:400:500:601','bad'])assert(!remountOnly(p,a,'45:124:200:700:800'));assert(!remountOnly(null,'x','y'))});
test('duration exception is narrow and explicitly flagged',()=>{assert(durationException({durationMismatch:true,durationA:7948.428,durationB:7947.488}));for(const info of [{durationA:7948,durationB:7945},{durationA:10,durationB:9},{durationA:NaN,durationB:5},{durationA:0,durationB:0}])assert(!durationException({durationMismatch:true,...info}));assert(!durationException({durationA:7948.428,durationB:7947.488}))});
