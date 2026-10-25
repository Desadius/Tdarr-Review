import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRecoveryAttention} from './recovery-attention.mjs';
import {ATTENTION_PATHS,now} from './test-helpers/attention-paths.mjs';

// The attention model for a failed or skipped replacement transcode (#232): diagnosis, the one retry, the skipped-copy assessment.
async function attention(t,deps){
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'transcode-attention-'));t.after(()=>fs.rm(data,{recursive:true,force:true}));await fs.mkdir(path.join(data,'recovery'));
 return createRecoveryAttention({data,getConfig:()=>({}),getItems:()=>({}),now:()=>now,tdarr:async()=>null,getConnection:async()=>{throw Error('none')},isBusy:()=>false,...deps});
}
const failed=()=>({requests:[{...ATTENTION_PATHS['replacement transcode error']}]}),skipped=()=>({requests:[{...ATTENTION_PATHS['replacement skipped as not required'],canRestore:true}]});

test('an operational failure recommends the retry and shows its cause',async t=>{
 const a=await attention(t,{retry:{eligibility:async()=>({eligible:true,blockers:[],cause:'operational',uncertain:true})}});
 const o=failed();await a.attach(o);const x=o.requests[0].attention;
 assert.equal(x.recommended,'retryTranscode');assert.deepEqual(x.actions.find(v=>v.id==='retryTranscode'),{id:'retryTranscode',changes:'starts-work',uncertain:true});
 assert.deepEqual(x.diagnosis,{cause:'operational'});assert.deepEqual(x.blockers,[]);
});
test('decode damage offers no retry and names why, with the value-free decoder message',async t=>{
 const a=await attention(t,{retry:{eligibility:async()=>({eligible:false,blockers:['transcode-decode-damage'],cause:'decode-damage',message:'Invalid NAL unit size (# > #).'})}});
 const o=failed();await a.attach(o);const x=o.requests[0].attention;
 assert.deepEqual(x.actions.map(v=>v.id),['refresh']);assert.deepEqual(x.blockers,['transcode-decode-damage']);assert.deepEqual(x.diagnosis,{cause:'decode-damage',message:'Invalid NAL unit size (# > #).'});
});
test('a failing retry check is unverified, never a retry',async t=>{
 const a=await attention(t,{retry:{eligibility:async()=>{throw Error('broken')}}});
 const o=failed();await a.attach(o);assert.deepEqual(o.requests[0].attention.blockers,['transcode-report-unreadable']);assert.deepEqual(o.requests[0].attention.diagnosis,{cause:'unreadable'});
});
test('Not required recommends assessing the untranscoded copy, explains why there is no retry and never offers restore',async t=>{
 const a=await attention(t,{installed:{eligibility:async()=>({eligible:true,blockers:[]})}});
 const o=skipped();await a.attach(o);const x=o.requests[0].attention;
 assert.equal(x.recommended,'assessInstalled');assert.deepEqual(x.actions.map(v=>v.id),['refresh','assessInstalled']);
 assert.deepEqual(x.blockers,['transcode-not-required','restore-over-installed']);
 const b=await attention(t,{installed:{eligibility:async()=>({eligible:false,blockers:['installed-no-decision']})}});
 const p=skipped();await b.attach(p);assert.deepEqual(p.requests[0].attention.blockers,['transcode-not-required','installed-no-decision']);
});
