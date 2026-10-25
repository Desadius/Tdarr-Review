import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRecoveryAttention} from './recovery-attention.mjs';
import {classifyRecovery} from './public/review-model.js';
import {ATTENTION_PATHS,now} from './test-helpers/attention-paths.mjs';

// Characterization (#232): a Recovery replacement whose Tdarr transcode failed or was skipped stays in Needs attention with
// refresh and openRadarr only, and the transcode retry is never offered. Synthetic records and temporary directories only.
const cases=[['replacement transcode error','transcode-error','Převod náhrady skončil chybou'],['replacement skipped as not required','transcode-skipped','Tdarr náhradu vynechal']];

test('characterization: a failed or skipped transcode of the replacement is attention with refresh and openRadarr only',async t=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'transcode-failure-'));t.after(()=>fs.rm(data,{recursive:true,force:true}));
 await fs.mkdir(path.join(data,'recovery'),{recursive:true});
 const attention=createRecoveryAttention({data,getConfig:()=>({libraryId:'library'}),getItems:()=>({}),now:()=>now,tdarr:async()=>null,getConnection:async()=>{throw Error('none')}});
 for(const [key,reason] of cases){
  const overview={requests:[{...ATTENTION_PATHS[key],radarrMovieUrl:'http://radarr.invalid/movie/x'}]};
  await attention.attach(overview);const a=overview.requests[0].attention;
  assert.equal(a.reason,reason);
  assert.deepEqual(a.actions.map(x=>x.id),['refresh','openRadarr']);
  assert.equal(a.recommended,'refresh');
  assert.deepEqual(a.blockers,['transcode-retry-unavailable']);
 }
});

test('characterization: classifyRecovery labels a failed or skipped transcode of the replacement as attention',()=>{
 for(const [key,reason,label] of cases){
  const c=classifyRecovery({...ATTENTION_PATHS[key],radarrMovieUrl:'http://radarr.invalid/movie/x'},now);
  assert.equal(c.category,'attention');
  assert.equal(c.reason,reason);
  assert.equal(c.label,label);
 }
});
