import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const reporter=new URL('./skip-summary.mjs',import.meta.url).href;
async function report(t,source){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'skip-summary-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'sample.test.mjs');await fs.writeFile(file,"import test from 'node:test';\n"+source);
  const run=spawnSync(process.execPath,['--test','--test-reporter='+reporter,'--test-reporter-destination=stdout',file],{encoding:'utf8',env:{...process.env,NODE_TEST_CONTEXT:undefined}});
  assert.equal(run.error,undefined);assert.doesNotMatch(run.stderr,/Error/,'the reporter itself must load and run');return run.stdout;
}

test('every skipped test is listed by name with its reason after the run',async t=>{
  const out=await report(t,"test('runs',()=>{});\ntest('needs posix fsync',{skip:'Requires POSIX directory fsync'},()=>{});\ntest('skipped inside',t=>{t.skip('no ffmpeg here')});\n");
  assert.match(out,/2 tests were SKIPPED and did not run/);
  assert.match(out,/sample\.test\.mjs: needs posix fsync \(Requires POSIX directory fsync\)/);
  assert.match(out,/sample\.test\.mjs: skipped inside \(no ffmpeg here\)/);
  assert.doesNotMatch(out,/: runs/);
  assert.match(out,/linux-tests\.yml/,'the summary says how to run them');
});

test('a skip without a reason is still listed',async t=>{
  const out=await report(t,"test('bare skip',{skip:true},()=>{});\n");
  assert.match(out,/1 test was SKIPPED and did not run/);
  assert.match(out,/sample\.test\.mjs: bare skip\n/);
});

test('a run without skips prints nothing',async t=>{
  assert.equal(await report(t,"test('runs',()=>{});\n"),'');
});
