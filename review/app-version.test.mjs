import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {appVersion} from './app-version.mjs';
import {versionMismatches,moduleVersionLiterals,docVersionMismatches} from '../tools/version-consistency.mjs';

const repo=new URL('..',import.meta.url);

test('the reported version comes from APP_VERSION, else package.json, never a literal',async()=>{
 const {version}=JSON.parse(await fs.readFile(new URL('package.json',repo),'utf8'));
 assert.equal(await appVersion({env:{}}),version);
 assert.equal(await appVersion({env:{APP_VERSION:'2.0.0'}}),'2.0.0');
 assert.equal(await appVersion({env:{APP_VERSION:'2.0.0-rc.1'}}),'2.0.0-rc.1');
 assert.equal(await appVersion({env:{APP_VERSION:'<script>'}}),version,'an invalid build argument is ignored');
 assert.equal(await appVersion({env:{},packageFile:new URL('missing.json',repo)}),'unknown');
 // The running server reports this version over HTTP: server-wiring-http.test.mjs.
 assert.match(await fs.readFile(new URL('Dockerfile',repo),'utf8'),/^ENV .*APP_VERSION=\$\{APP_VERSION\}/m);
});

test('package.json, Dockerfile defaults and .env.example agree; a mismatch is reported',async()=>{
 assert.deepEqual(await versionMismatches(fileURLToPath(repo)),[]);
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'version-check-'));
 try{
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({version:'2.0.0'}));
  await fs.writeFile(path.join(root,'Dockerfile'),'FROM x\nARG APP_VERSION=2.0.0\n');
  await fs.writeFile(path.join(root,'.env.example'),'REVIEW_IMAGE_TAG=2.0.0\n');
  assert.deepEqual(await versionMismatches(root),[],'one image: no Recovery Dockerfile or image tag is required');
  await fs.writeFile(path.join(root,'Dockerfile'),'FROM x\nARG APP_VERSION=1.9.0\n');
  await fs.writeFile(path.join(root,'.env.example'),'PUID=99\n');
  assert.deepEqual(await versionMismatches(root),['Dockerfile APP_VERSION is 1.9.0, package.json is 2.0.0','.env.example REVIEW_IMAGE_TAG is missing, package.json is 2.0.0']);
 }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('the README and the installation guide name the package.json version; an older one is reported by line',async()=>{
 assert.deepEqual(await docVersionMismatches(fileURLToPath(repo)),[]);
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'doc-version-'));
 try{
  await fs.mkdir(path.join(root,'docs'));
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({version:'2.1.0'}));
  await fs.writeFile(path.join(root,'README.md'),'Release version: **[2.1.0](https://example.invalid/releases/tag/v2.0.0)**.\n# Set REVIEW_IMAGE_TAG=2.1.0 for this release.\nThe image is `ghcr.io/desadius/tdarr-review:2.0.0`.\n');
  await fs.writeFile(path.join(root,'docs','INSTALL-UNRAID.md'),'Pin `REVIEW_IMAGE_TAG=2.1.0` or `ghcr.io/desadius/tdarr-review:2.1.0`; the 1.11.0 guide stays at its tag.\n');
  assert.deepEqual(await docVersionMismatches(root),['README.md:1 names 2.0.0, package.json is 2.1.0','README.md:3 names 2.0.0, package.json is 2.1.0']);
  await fs.rm(path.join(root,'docs','INSTALL-UNRAID.md'));
  assert.deepEqual((await docVersionMismatches(root)).at(-1),'docs/INSTALL-UNRAID.md is missing');
 }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('browser module URLs use only the app-version placeholder; a hand-written version is reported',async()=>{
 assert.deepEqual(await moduleVersionLiterals(fileURLToPath(repo)),[]);
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'module-version-'));
 try{
  await fs.mkdir(path.join(root,'review','public'),{recursive:true});
  await fs.writeFile(path.join(root,'review','public','app.js'),"import {tr} from './i18n.js?v=__APP_VERSION__';import {el} from './ui-kit.js?v=20261013-split1';");
  await fs.writeFile(path.join(root,'review','public','index.html'),'<script type="module" src="/app.js?v=__APP_VERSION__"></script>');
  assert.deepEqual(await moduleVersionLiterals(root),['review/public/app.js uses ?v=20261013-split1 instead of ?v=__APP_VERSION__']);
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
