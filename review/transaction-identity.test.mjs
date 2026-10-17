import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {recoverTransactions,fingerprint} from './core.mjs';
import {identityVariants} from './test-helpers/identity-variants.mjs';

// Transaction recovery restores an original only when the recorded file identity matches.
// The rename into the backup changes ctime, so the recorded ctime is not compared.
async function interrupted(variant,phase){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'transaction-identity-')),journals=path.join(root,'journals'),media=path.join(root,'media');
 await fs.mkdir(journals);await fs.mkdir(media);
 const id='t1',original=path.join(media,'film.mkv'),review=path.join(root,'review.mkv');
 const tmp=path.join(media,`.tdarr-review-${id}.tmp`),backup=path.join(media,`.tdarr-review-${id}.old`);
 await fs.writeFile(review,'TRANSCODE');
 if(phase==='original-backed-up'){await fs.writeFile(backup,'ORIGINAL');}else await fs.writeFile(original,'ORIGINAL');
 const current=fingerprint(await fs.stat(phase==='original-backed-up'?backup:original));
 const originalFP=identityVariants(current)[variant];
 await fs.writeFile(path.join(journals,id+'.json'),JSON.stringify({id,original,review,destination:original,tmp,backup,originalFP,reviewFP:fingerprint(await fs.stat(review)),phase}));
 const exists=async p=>!!await fs.lstat(p).catch(()=>null);
 return {root,journals,original,backup,exists,cleanup:()=>fs.rm(root,{recursive:true,force:true})};
}

const accepted={same:true,ctimeChanged:true,deviceChanged:false,deviceAndCtimeChanged:false,inodeChanged:false,fourFields:false,emptyCtime:true,textCtime:true,textDevice:false,sixFields:false,missing:false};

test('rollback of a backed-up original follows the recorded identity',async()=>{
 for(const [variant,restores] of Object.entries(accepted)){
  const f=await interrupted(variant,'original-backed-up');
  try{
   const pending=await recoverTransactions(f.journals);
   assert.equal(pending.length,restores?0:1,variant);
   assert.equal(await f.exists(f.original),restores,variant);
   assert.equal(await f.exists(f.backup),!restores,variant);
   if(restores)assert.equal(await fs.readFile(f.original,'utf8'),'ORIGINAL');
   const journal=JSON.parse(await fs.readFile(path.join(f.journals,'t1.json'),'utf8'));
   assert.equal(journal.phase,restores?'aborted':'original-backed-up',variant);
   if(variant==='missing')assert.match(pending[0].error,/Neplatné cesty/);
   else if(!restores)assert.equal(pending[0].error,undefined,variant);
  }finally{await f.cleanup()}
 }
});

test('an untouched original is released only when its recorded identity matches',async()=>{
 for(const [variant,restores] of Object.entries(accepted)){
  const f=await interrupted(variant,'preparing');
  try{
   const pending=await recoverTransactions(f.journals);
   assert.equal(pending.length,restores?0:1,variant);
   assert.equal(await fs.readFile(f.original,'utf8'),'ORIGINAL',variant);
   assert.equal(await f.exists(f.backup),false,variant);
  }finally{await f.cleanup()}
 }
});
