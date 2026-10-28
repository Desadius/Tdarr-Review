import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRecoveryDeferrals} from './recovery-deferrals.mjs';

const ID='c'.repeat(24),FP='f'.repeat(64);
async function store(t){const data=await fs.mkdtemp(path.join(os.tmpdir(),'deferrals-'));t.after(()=>fs.rm(data,{recursive:true,force:true}));return createRecoveryDeferrals({data});}

test('a case can be closed unchanged without a note, and reopened',async t=>{
 const s=await store(t),closed=await s.defer({source:'recovery',id:ID,fingerprint:FP,revision:s.revision('recovery',ID,FP,null),recheck:async()=>FP});
 assert.equal(closed.state,'deferred');
 const saved=await s.view('recovery',ID,FP);assert.equal(saved.state,'deferred');assert.equal(saved.note,'');
 assert.equal((await s.reopen({source:'recovery',id:ID,fingerprint:FP,revision:closed.revision,recheck:async()=>FP})).state,'reopened');
});

test('a note is optional but bounded and must be text',async t=>{
 const s=await store(t),revision=s.revision('recovery',ID,FP,null);
 for(const note of [42,'n'.repeat(1001)])await assert.rejects(s.defer({source:'recovery',id:ID,fingerprint:FP,revision,note,recheck:async()=>FP}),{code:'deferral_note_invalid'});
 await s.defer({source:'recovery',id:ID,fingerprint:FP,revision,note:'  Kept as it is.  ',recheck:async()=>FP});
 assert.equal((await s.view('recovery',ID,FP)).note,'Kept as it is.');
});
