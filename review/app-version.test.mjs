import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {appVersion} from './app-version.mjs';
import {versionMismatches} from '../tools/version-consistency.mjs';

const repo=new URL('..',import.meta.url);

test('the reported version comes from APP_VERSION, else package.json, never a literal',async()=>{
 const {version}=JSON.parse(await fs.readFile(new URL('package.json',repo),'utf8'));
 assert.equal(await appVersion({env:{}}),version);
 assert.equal(await appVersion({env:{APP_VERSION:'2.0.0'}}),'2.0.0');
 assert.equal(await appVersion({env:{APP_VERSION:'2.0.0-rc.1'}}),'2.0.0-rc.1');
 assert.equal(await appVersion({env:{APP_VERSION:'<script>'}}),version,'an invalid build argument is ignored');
 assert.equal(await appVersion({env:{},packageFile:new URL('missing.json',repo)}),'unknown');
 const server=await fs.readFile(new URL('server.mjs',import.meta.url),'utf8');
 const items=await fs.readFile(new URL('routes/items.mjs',import.meta.url),'utf8');
 assert.match(items,/\{version:ctx\.APP_VERSION,/);for(const source of [server,items])assert.doesNotMatch(source,/version:'\d+\.\d+\.\d+'/);
 assert.match(await fs.readFile(new URL('Dockerfile',repo),'utf8'),/^ENV .*APP_VERSION=\$\{APP_VERSION\}/m);
});

test('package.json, Dockerfile defaults and .env.example agree; a mismatch is reported',async()=>{
 assert.deepEqual(await versionMismatches(fileURLToPath(repo)),[]);
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'version-check-'));
 try{
  await fs.writeFile(path.join(root,'package.json'),JSON.stringify({version:'2.0.0'}));
  await fs.writeFile(path.join(root,'Dockerfile'),'FROM x\nARG APP_VERSION=2.0.0\n');
  await fs.writeFile(path.join(root,'Dockerfile.recovery'),'FROM x\nARG APP_VERSION=1.9.0\n');
  await fs.writeFile(path.join(root,'.env.example'),'REVIEW_IMAGE_TAG=2.0.0\n');
  assert.deepEqual(await versionMismatches(root),['Dockerfile.recovery APP_VERSION is 1.9.0, package.json is 2.0.0','.env.example RECOVERY_IMAGE_TAG is missing, package.json is 2.0.0']);
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
