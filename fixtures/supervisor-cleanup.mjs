import test from 'node:test';
import assert from 'node:assert/strict';
import {start,stop,started} from '../review/test-supervisor-helpers.mjs';

// A separate runner lets the parent verify teardown even when an assertion fails.
test('supervisor cleanup fixture',async t=>{
 const run=await start({mode:'verify',review:'stubborn',recovery:'stubborn'});
 t.after(()=>stop(run));
 const children=await started(run,'review','recovery');
 console.log('FIXTURE '+JSON.stringify({root:run.root,pids:[run.child.pid,...children.map(e=>e.pid)]}));
 assert.equal(process.env.SUPERVISOR_CLEANUP_FAIL,'no','intentional fixture assertion failure');
});
