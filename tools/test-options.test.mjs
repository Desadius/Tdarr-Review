import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {testRunnerFlags} from './test-options.mjs';

test('coverage enables Node collection without filtering tests or changing concurrency',()=>{
  const ordinary=testRunnerFlags([]),coverage=testRunnerFlags(['--coverage']);
  assert.deepEqual(ordinary.slice(0,2),['--test','--test-concurrency=1']);
  assert.ok(!ordinary.some(flag=>/only|name-pattern|skip-pattern|shard/.test(flag)));
  assert.deepEqual(coverage,[...ordinary,'--experimental-test-coverage']);
});

test('the suite keeps its normal report and ends with a list of skipped tests',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'test-options-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'sample.test.mjs');
  await fs.writeFile(file,"import test from 'node:test';\ntest('runs',()=>{});\ntest('posix only',{skip:'Requires POSIX directory fsync'},()=>{});\n");
  const run=spawnSync(process.execPath,[...testRunnerFlags([]),file],{encoding:'utf8',env:{...process.env,NODE_TEST_CONTEXT:undefined}});
  assert.match(run.stdout,/✔ runs/);
  assert.match(run.stdout,/ℹ skipped 1/);
  assert.match(run.stderr,/1 test was SKIPPED and did not run/);
  assert.match(run.stderr,/sample\.test\.mjs: posix only \(Requires POSIX directory fsync\)/);
});

test('unsupported and repeated arguments cannot silently select or bypass tests',()=>{
  for(const args of [['--test-only'],['--coverage','--test-only'],['--coverage','--coverage'],['--coverage=false'],['review/test.mjs']]){
    assert.throws(()=>testRunnerFlags(args),/Usage: node tools\/test\.mjs \[--coverage\]/);
  }
});
