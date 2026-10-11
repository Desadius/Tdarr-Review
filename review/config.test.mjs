import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaults,validate,mapReview} from './config.mjs';
const valid=()=>defaults({});
test('portable defaults and mapping preserve nested relative names',()=>{const c=validate(valid());assert.equal(c.tdarrUrl,'http://tdarr:8266');assert.equal(mapReview('Ready/Series/Season 1/Episode.mkv',['Ready']),'Series/Season 1/Episode.mkv');assert.equal(mapReview('../file.mkv',[]),null);assert.equal(mapReview('/file.mkv',[]),null)});
test('reject overlapping roots, traversal, invalid origins and malformed lists',()=>{for(const change of [{reviewRoot:'/media/output'},{mediaRoot:'/media/../etc'},{publicOrigin:'http://example.org/path'},{tdarrUrl:'file:///etc/passwd'},{sourceRoots:[]},{reviewPrefixes:['../x']}])assert.throws(()=>validate({...valid(),...change}));});
