import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {linuxServer as linux} from './test-helpers/server.mjs';
import {reviewFixture} from './test-helpers/review-fixture.mjs';
import {identityOf} from '../recovery/file-identity.mjs';

test('HTTP unresolved exchange transactions are listed with film, phase and reason, without paths',linux,async()=>{
 let root;
 const f=await reviewFixture({beforeStart:async({data,root:r})=>{
  root=r;const transactions=path.join(data,'transactions'),dir=path.join(r,'interrupted');await fs.mkdir(dir);
  const original=path.join(dir,'film.mkv'),backup=path.join(dir,'.tdarr-review-tx1.old'),review=path.join(dir,'result.mkv');
  await fs.writeFile(backup,'ORIGINAL');await fs.writeFile(review,'TRANSCODE');
  const [dev,ino,size,mtime]=identityOf(await fs.stat(backup)).split(':');
  await fs.writeFile(path.join(transactions,'tx1.json'),JSON.stringify({id:'tx1',original,review,destination:original,tmp:path.join(dir,'.tdarr-review-tx1.tmp'),backup,originalFP:[dev,ino,size,mtime,''].join(':'),reviewFP:identityOf(await fs.stat(review)),phase:'original-backed-up'}));
  const film=path.join(r,'media','A','A.mkv');
  await fs.writeFile(path.join(transactions,'tx2.json'),JSON.stringify({id:'tx2',original:film,review,destination:film,tmp:path.join(path.dirname(film),'.tdarr-review-tx2.tmp'),backup:path.join(path.dirname(film),'.tdarr-review-tx2.old'),originalFP:'1:2:3:4:5',reviewFP:'1:2:3:4:6',phase:'installed'}));
  await fs.writeFile(path.join(transactions,'tx3.json'),'{"phase":');
 }});
 try{
  const d=await f.items(),film=d.items.find(x=>x.relative==='A/A.mkv');assert.ok(film,'fixture film');
  const recovery=Object.fromEntries(d.recovery.map(t=>[t.journal,t]));
  assert.deepEqual(recovery['tx1.json'],{id:'tx1',journal:'tx1.json',phase:'original-backed-up',reason:'invalid-identity',title:null,itemId:null});
  assert.deepEqual(recovery['tx2.json'],{id:'tx2',journal:'tx2.json',phase:'installed',reason:'needs-inspection',title:film.title,itemId:film.id});
  assert.deepEqual(recovery['tx3.json'],{id:'tx3.json',journal:'tx3.json',phase:'unknown',reason:'unreadable',title:null,itemId:null});
  assert.equal(JSON.stringify(d.recovery).includes(root),false,'no filesystem path reaches the UI');
  assert.equal(JSON.stringify(d.recovery).includes('ORIGINAL'),false);
  const response=await f.post(`/api/items/${'a'.repeat(24)}/approve`,{snapshot:'synthetic',reviewRevision:0});
  assert.equal(response.status,409);assert.equal((await response.json()).code,'finish_action_or_recovery');
  await f.preserved();
 }finally{await f.close()}
});
