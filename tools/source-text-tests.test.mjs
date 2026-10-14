import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceTextReads,sourceTextViolations} from './source-text-tests.mjs';
// Built at run time so this file's own fixtures are not reads of source text.
const R='read'+'File',RS=R+'Sync';

test('reads of JavaScript source are found in every form the suite uses',()=>{
  assert.deepEqual(sourceTextReads("const a=await fs."+R+"(new URL('./server.mjs',import.meta.url),'utf8');"),['server.mjs']);
  assert.deepEqual(sourceTextReads("const g=fs."+RS+"('examples/tdarr/review-guard.cjs','utf8');"),['examples/tdarr/review-guard.cjs']);
  assert.deepEqual(sourceTextReads("fs."+RS+"(require('node:path').join(__dirname,'../examples/route.cjs'),'utf8')"),['../examples/route.cjs']);
  assert.deepEqual(sourceTextReads("const q=await fs."+R+"(new URL('./public/quarantine.js',import.meta.url),'utf8'),s=await fs."+R+"(new URL('./public/settings.js',import.meta.url),'utf8');"),['public/quarantine.js','public/settings.js']);
});

test('reads of data, media and computed paths are not source reads',()=>{
  assert.deepEqual(sourceTextReads("await fs."+R+"(path.join(dir,'state.json'),'utf8');fs."+RS+"(file);await fs."+R+"(new URL('../fixtures/a.mkv',import.meta.url));"),[]);
});

async function suite(t,files){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'source-text-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  for(const directory of ['review','recovery','tools'])await fs.mkdir(path.join(root,directory));
  for(const [file,text] of Object.entries(files))await fs.writeFile(path.join(root,file),text);
  return root;
}
const read=target=>"await fs."+R+"(new URL('./"+target+"',import.meta.url),'utf8');\n";

test('a test file that starts reading source text is reported',async t=>{
  const root=await suite(t,{'review/a.test.mjs':read('server.mjs'),'review/b.test.mjs':read('server.mjs')});
  const violations=await sourceTextViolations(root,{'review/a.test.mjs':['server.mjs']});
  assert.equal(violations.length,1);
  assert.match(violations[0],/review\/b\.test\.mjs reads the source text of server\.mjs/);
});

test('another read of an allowed file in the same test is reported too',async t=>{
  const root=await suite(t,{'review/a.test.mjs':read('server.mjs')+read('server.mjs')});
  const violations=await sourceTextViolations(root,{'review/a.test.mjs':['server.mjs']});
  assert.equal(violations.length,1);
  assert.match(violations[0],/review\/a\.test\.mjs reads the source text of server\.mjs/);
});

test('a read that was cleaned up must also leave the allowlist',async t=>{
  const root=await suite(t,{'review/a.test.mjs':"test('behaviour',()=>{});\n"});
  const violations=await sourceTextViolations(root,{'review/a.test.mjs':['server.mjs']});
  assert.equal(violations.length,1);
  assert.match(violations[0],/review\/a\.test\.mjs no longer reads server\.mjs/);
});

test('files outside the suite are not checked',async t=>{
  const root=await suite(t,{'review/server.mjs':read('routes/items.mjs'),'tools/helper.mjs':read('check.mjs')});
  assert.deepEqual(await sourceTextViolations(root,{}),[]);
});

test('the repository matches its allowlist',async()=>{
  assert.deepEqual(await sourceTextViolations(fileURLToPath(new URL('..',import.meta.url))),[]);
});
