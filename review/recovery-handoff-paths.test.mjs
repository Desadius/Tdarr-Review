import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyRecovery} from './public/review-model.js';

// How an imported replacement that has not reached Tdarr is classified (#231): with no Tdarr state
// reported it is unverified, a failed handoff is a manual case error, and an open handoff intent runs.
const now=Date.UTC(2026,9,22,12),at=ms=>new Date(now-ms).toISOString(),base={source:'recovery',id:'a'.repeat(24),title:'Synthetic film',statusUpdated:at(60000)};

test('an imported replacement without a Tdarr row is unverified today, never attention or done',()=>{
 const c=classifyRecovery({...base,phase:'replacement_imported'},now);
 assert.deepEqual([c.category,c.reason,c.label],['unverified','unverified','Náhrada předána; stav Tdarru není doložen']);
});
test('a handoff Recovery could not finish is a manual case error, and an open handoff intent is running',()=>{
 assert.deepEqual([classifyRecovery({...base,phase:'manual',error:'Invalid Tdarr file binding'},now).category,classifyRecovery({...base,phase:'manual',error:'Invalid Tdarr file binding'},now).reason],['attention','case-error']);
 assert.equal(classifyRecovery({...base,phase:'replacement_queue_intent'},now).category,'running');
});

test('a replacement whose Tdarr row the server found missing needs attention, unless approval already exists',()=>{
 const c=classifyRecovery({...base,phase:'replacement_imported',tdarrMissing:true},now);
 assert.deepEqual([c.category,c.reason,c.label],['attention','tdarr-missing','Náhrada se do Tdarru nedostala']);
 assert.equal(classifyRecovery({...base,phase:'replacement_imported',tdarrMissing:true,cleanup:{approvedAt:at(1000)}},now).category,'done');
 assert.equal(classifyRecovery({...base,phase:'manual',tdarrMissing:true},now).reason,'manual','only an imported replacement');
});
