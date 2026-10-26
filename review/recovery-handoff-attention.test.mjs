import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRecoveryAttention} from './recovery-attention.mjs';

// The attention model with Review's Tdarr handoff (#231): which cases get the action, and which only a blocker.
const ID='a'.repeat(24),now=Date.UTC(2026,9,22,12),record={source:'recovery',id:ID,title:'Synthetic film',phase:'replacement_imported',statusUpdated:new Date(now-60000).toISOString()};
async function attention(t,handoff){
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'handoff-attention-'));t.after(()=>fs.rm(data,{recursive:true,force:true}));
 await fs.mkdir(path.join(data,'recovery'));await fs.writeFile(path.join(data,'recovery','state.json'),JSON.stringify({version:1,jobs:{},cases:{[ID]:{id:ID,status:'replacement_imported'}}}));
 return createRecoveryAttention({data,getConfig:()=>({}),getItems:()=>({}),now:()=>now,tdarr:async()=>null,getConnection:async()=>{throw Error('none')},handoff,isBusy:()=>false});
}
test('a missing Tdarr row makes the handoff the recommended action, flagged when the previous one is uncertain',async t=>{
 let asked=null;const a=await attention(t,{rowMissing:async c=>c.id===ID,eligibility:async(id,options)=>{asked=[id,options];return {eligible:true,blockers:[],uncertain:true};}});
 const overview={requests:[{...record}]};await a.attach(overview);const r=overview.requests[0];
 assert.equal(r.tdarrMissing,true);assert.deepEqual(asked,[ID,{busy:false}]);
 assert.equal(r.attention.reason,'tdarr-missing');assert.equal(r.attention.recommended,'handoffTdarr');
 assert.deepEqual(r.attention.actions.find(x=>x.id==='handoffTdarr'),{id:'handoffTdarr',changes:'starts-work',uncertain:true});
});
test('an ineligible handoff names its blockers; a reported Tdarr state or a present row is never flagged',async t=>{
 const a=await attention(t,{rowMissing:async()=>true,eligibility:async()=>({eligible:false,blockers:['handoff-hold']})});
 const overview={requests:[{...record}]};await a.attach(overview);
 assert.deepEqual(overview.requests[0].attention.actions.map(x=>x.id),['refresh','exportDiagnostic']);assert.deepEqual(overview.requests[0].attention.blockers,['handoff-hold']);
 const reported={requests:[{...record,tdarrStatus:'Queued'}]};await a.attach(reported);assert.equal(reported.requests[0].tdarrMissing,undefined);
 const present=await attention(t,{rowMissing:async()=>false,eligibility:async()=>{throw Error('not asked')}});
 const again={requests:[{...record}]};await present.attach(again);assert.equal(again.requests[0].tdarrMissing,undefined);assert.equal(again.requests[0].attention,undefined);
});
test('a handoff Recovery gave up on is an administrator step, without the action',async t=>{
 const a=await attention(t,{rowMissing:async()=>false,eligibility:async()=>{throw Error('not asked')}});
 const overview={requests:[{...record,phase:'manual',error:'Unrecognized Tdarr state; handoff requires inspection.'}]};await a.attach(overview);
 assert.ok(overview.requests[0].attention.blockers.includes('handoff-manual'));assert.equal(overview.requests[0].attention.actions.some(x=>x.id==='handoffTdarr'),false);
});
