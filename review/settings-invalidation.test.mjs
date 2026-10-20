import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,validate} from './config.mjs';
import {NO_INVALIDATION,SAMPLES_ONLY,LEVELS,invalidationLevel,stricter} from './settings-invalidation.mjs';

const base=validate({...defaults({}),sourceRoots:['/library','/second'],reviewPrefixes:['PROD','TEST']});
// A different valid value for each Review setting.
const changedValue=key=>({label:'Other name',publicOrigin:'http://other:8270',tdarrUrl:'http://other-tdarr:8266',sourceRoots:['/second','/library'],reviewPrefixes:['TEST','PROD']}[key]??(typeof base[key]==='string'?base[key]+'-other':undefined));

test('every Review setting is classified: the two allowlists are disjoint, name real settings, and everything else is review binding',()=>{
 const keys=Object.keys(defaults({}));
 assert.deepEqual([...NO_INVALIDATION,...SAMPLES_ONLY].filter(key=>!keys.includes(key)),[],'an allowlist names a field Review does not have');
 assert.deepEqual(NO_INVALIDATION.filter(key=>SAMPLES_ONLY.includes(key)),[],'a field is in both allowlists');
 for(const key of keys){
  const value=changedValue(key);assert.notEqual(value,undefined,'no test value for '+key);
  const expected=NO_INVALIDATION.includes(key)?'none':SAMPLES_ONLY.includes(key)?'samples':'all';
  assert.deepEqual(invalidationLevel(base,{...base,[key]:value}),{level:expected,fields:expected==='none'?[]:[key]},key);
 }
});

test('the review binding includes FFprobe, the Tdarr address and database, and a reordered list',()=>{
 for(const key of ['ffprobe','tdarrUrl','database','mediaRoot','reviewRoot','libraryId','tdarrReviewRoot'])assert.equal(invalidationLevel(base,{...base,[key]:changedValue(key)}).level,'all',key);
 assert.equal(invalidationLevel(base,{...base,sourceRoots:[...base.sourceRoots].reverse()}).level,'all');
 assert.equal(invalidationLevel(base,{...base,reviewPrefixes:[...base.reviewPrefixes].reverse()}).level,'all');
});

test('the highest level wins and names only the fields that cause it; identical settings invalidate nothing',()=>{
 assert.deepEqual(invalidationLevel(base,structuredClone(base)),{level:'none',fields:[]});
 assert.deepEqual(invalidationLevel(base,{...base,label:'x',ffmpeg:'/other/ffmpeg'}),{level:'samples',fields:['ffmpeg']});
 assert.deepEqual(invalidationLevel(base,{...base,label:'x',ffmpeg:'/other/ffmpeg',mediaRoot:'/other'}),{level:'all',fields:['mediaRoot']});
 // A setting that appears or disappears (for example a new field after an update) is review binding.
 assert.deepEqual(invalidationLevel(base,{...base,futureSetting:'x'}),{level:'all',fields:['futureSetting']});
});

test('a level is stricter only when it clears more; against an unknown expected level every level is stricter',()=>{
 assert.deepEqual(LEVELS,['none','samples','all']);
 assert.equal(stricter('all','samples'),true);assert.equal(stricter('samples','none'),true);
 assert.equal(stricter('none','samples'),false);assert.equal(stricter('samples','samples'),false);
 for(const level of LEVELS)for(const unknown of [undefined,'bogus'])assert.equal(stricter(level,unknown),true,level);
});
