import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {linuxServer as linux} from './test-helpers/server.mjs';
import {reviewFixture} from './test-helpers/review-fixture.mjs';
import {hash} from './core.mjs';
import {identityOf} from '../recovery/file-identity.mjs';

// An unreadable recorded file identity never matches. Over the real server it must stay
// visible with its reason instead of moving files or silently blocking work.

test('HTTP an unreadable identity in a replacement journal moves nothing, stays pending with its reason and blocks approval',linux,async()=>{
 let tx;
 const f=await reviewFixture({beforeStart:async({data,root})=>{
  const dir=path.join(root,'interrupted');await fs.mkdir(dir);
  const original=path.join(dir,'film.mkv'),backup=path.join(dir,'.tdarr-review-tx1.old'),review=path.join(dir,'result.mkv'),file=path.join(data,'transactions','tx1.json');
  await fs.writeFile(backup,'ORIGINAL');await fs.writeFile(review,'TRANSCODE');
  // Before this change an empty recorded ctime matched, and recovery linked the backup back.
  const [dev,ino,size,mtime]=identityOf(await fs.stat(backup)).split(':');
  const journal={id:'tx1',original,review,destination:original,tmp:path.join(dir,'.tdarr-review-tx1.tmp'),backup,originalFP:[dev,ino,size,mtime,''].join(':'),reviewFP:identityOf(await fs.stat(review)),phase:'original-backed-up'};
  await fs.writeFile(file,JSON.stringify(journal));
  tx={original,backup,file,journal,ino:(await fs.stat(backup)).ino};
 }});
 try{
  const [event]=await f.eventually('transactions.unresolved');
  assert.deepEqual(event.transactions.map(t=>[t.id,t.phase,t.error]),[['tx1','original-backed-up','Neplatná identita souboru v záznamu výměny.']]);
  await assert.rejects(fs.lstat(tx.original),{code:'ENOENT'});
  assert.equal((await fs.stat(tx.backup)).ino,tx.ino);assert.equal(await fs.readFile(tx.backup,'utf8'),'ORIGINAL');
  assert.deepEqual(JSON.parse(await fs.readFile(tx.file,'utf8')),tx.journal);
  const response=await f.post(`/api/items/${'a'.repeat(24)}/approve`,{snapshot:'synthetic',reviewRevision:0});
  assert.equal(response.status,409);assert.equal((await response.json()).code,'finish_action_or_recovery');
  await f.preserved();
 }finally{await f.close()}
});

test('HTTP a changed item with an unreadable recorded identity is blocked with that reason',linux,async()=>{
 const unreadable=hash('PROD-Movies/A/A.mkv').slice(0,24),changed=hash('PROD-Movies/B/B.mkv').slice(0,24);
 const f=await reviewFixture({beforeStart:async({data})=>{
  const items={[unreadable]:{snapshot:'stale',originalFP:'unreadable',reviewFP:'unreadable'},[changed]:{snapshot:'stale',originalFP:'1:2:3:4:5',reviewFP:'1:2:3:4:6'}};
  await fs.writeFile(path.join(data,'state.json'),JSON.stringify({items,history:[],sessions:{},pauses:[]}));
 }});
 try{
  const list=(await f.items()).items,item=id=>list.find(v=>v.id===id);
  assert.equal(item(unreadable).status,'blocked');assert.equal(item(unreadable).canRecheck,false);
  assert.equal(item(unreadable).reason,'Zaznamenaná identita souboru je nečitelná. Vyžaduje kontrolu.');
  assert.equal(item(changed).status,'blocked');assert.equal(item(changed).reason,'Soubory se od zařazení do review změnily. Vyžadují kontrolu.');
  await f.preserved();
 }finally{await f.close()}
});
