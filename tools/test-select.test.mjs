import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {listTestFiles,testRunnerFlags} from './test-options.mjs';
import {selectedRunnerArgs} from './test-select.mjs';
const available=['recovery/worker.integration.test.mjs','review/test.mjs','tools/test-options.test.mjs'];

test('no files selects the whole suite without a name filter',()=>{
  assert.deepEqual(selectedRunnerArgs({available}),[...testRunnerFlags([]),...available]);
});

test('listed files run in the given order, filtered by the name pattern',()=>{
  assert.deepEqual(selectedRunnerArgs({files:' review/test.mjs\nrecovery/worker.integration.test.mjs ',namePattern:'verify mode',available}),
    [...testRunnerFlags([]),'--test-name-pattern=verify mode','review/test.mjs','recovery/worker.integration.test.mjs']);
});

test('anything that is not a suite file is refused by name before a test runs',()=>{
  for(const file of ['--import=./evil.mjs','../outside.test.mjs','review/server.mjs','tools/test-select.test.mjs']){
    assert.throws(()=>selectedRunnerArgs({files:'review/test.mjs '+file,available}),error=>error.message.includes(file));
  }
});

test('the selectable files are exactly the files npm test runs',async()=>{
  const files=await listTestFiles(fileURLToPath(new URL('..',import.meta.url)));
  for(const file of ['review/test.mjs','recovery/worker.integration.test.mjs','tools/test-select.test.mjs','review/tdarr-guard.test.cjs'])assert.ok(files.includes(file),file);
  for(const file of ['tools/test.mjs','review/server.mjs'])assert.ok(!files.includes(file),file);
});

test('the command runs only the selected tests and reports their result',()=>{
  const root=fileURLToPath(new URL('..',import.meta.url));
  const run=spawnSync(process.execPath,['tools/test-select.mjs'],{cwd:root,encoding:'utf8',
    env:{...process.env,NODE_TEST_CONTEXT:undefined,TEST_FILES:'tools/test-options.test.mjs',TEST_NAME_PATTERN:'^coverage enables'}});
  assert.equal(run.status,0,run.stderr);
  assert.match(run.stdout,/ℹ pass 1\n/);
  const refused=spawnSync(process.execPath,['tools/test-select.mjs'],{cwd:root,encoding:'utf8',env:{...process.env,NODE_TEST_CONTEXT:undefined,TEST_FILES:'review/server.mjs'}});
  assert.notEqual(refused.status,0);
  assert.match(refused.stderr,/review\/server\.mjs/);
});
