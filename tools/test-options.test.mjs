import test from 'node:test';
import assert from 'node:assert/strict';
import {testRunnerFlags} from './test-options.mjs';

test('coverage enables Node collection without filtering tests or changing concurrency',()=>{
  const ordinary=testRunnerFlags([]),coverage=testRunnerFlags(['--coverage']);
  assert.deepEqual(ordinary,['--test','--test-concurrency=1']);
  assert.deepEqual(coverage,[...ordinary,'--experimental-test-coverage']);
});

test('unsupported and repeated arguments cannot silently select or bypass tests',()=>{
  for(const args of [['--test-only'],['--coverage','--test-only'],['--coverage','--coverage'],['--coverage=false'],['review/test.mjs']]){
    assert.throws(()=>testRunnerFlags(args),/Usage: node tools\/test\.mjs \[--coverage\]/);
  }
});
