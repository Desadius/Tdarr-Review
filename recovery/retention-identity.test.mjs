import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {identityVariants} from '../review/test-helpers/identity-variants.mjs';
import {identityOf} from './file-identity.mjs';
import * as retention from './quarantine-retention.mjs';
import {contentSample} from './content-sample.mjs';

async function setup({publishApproval}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'retention-identity-')),mediaRoot=path.join(root,'movies'),quarantineRoot=path.join(root,'.tdarr-corrupt');
 await fs.mkdir(mediaRoot);await fs.mkdir(path.join(quarantineRoot,'case'),{recursive:true});
 const file=path.join(quarantineRoot,'case','bad.mkv'),installed=path.join(mediaRoot,'new.mkv');await fs.writeFile(file,'old film');await fs.writeFile(installed,'approved film');
 const c={id:'case',quarantine:file,fp:identityOf(await fs.stat(file)),replacementRelative:'new.mkv',replacementSourceFP:'source-fingerprint'};
 const s={root,mediaRoot,quarantineRoot,file,installed,c,atomic:async(p,v)=>{await fs.writeFile(p,JSON.stringify(v))},atomicCase:async()=>{}};
 await publishApproval({...s,relative:'new.mkv',sourceFP:c.replacementSourceFP,installedRelative:'new.mkv'});
 const approvals=path.join(root,'.tdarr-approvals'),[evidence]=await fs.readdir(approvals);
 return {...s,evidence:path.join(approvals,evidence),expired:Date.now()+8*86400000,cleanup:()=>fs.rm(root,{recursive:true,force:true})};
}
const exists=async p=>!!await fs.lstat(p).catch(()=>null);

test('retention refuses a changed approved replacement by the kind of change and accepts a remount with the recorded content sample',async()=>{
 const metadata=/metadata timestamp changed/,changed=/^Error: Approved replacement changed; quarantine preserved$/,unreadable=/^Error: Recorded file identity is unreadable; quarantine preserved$/;
 const expected={same:null,ctimeChanged:metadata,deviceChanged:null,deviceAndCtimeChanged:null,inodeChanged:null,remounted:null,remountedCtimeChanged:null,sizeChanged:changed,mtimeChanged:changed,fourFields:unreadable,emptyCtime:unreadable,textCtime:unreadable,textDevice:unreadable,sixFields:unreadable,missing:unreadable};
 for(const [variant,error] of Object.entries(expected)){
  const s=await setup(retention);
  try{
   const record=JSON.parse(await fs.readFile(s.evidence,'utf8'));record.installedFP=identityVariants(record.installedFP)[variant];await fs.writeFile(s.evidence,JSON.stringify(record));
   const run=retention.retainCase(s.c,{...s,now:s.expired});
   if(error){await assert.rejects(run,error,variant);assert.equal(await exists(s.file),true,variant);assert.equal(s.c.cleanup,undefined,variant);}
   else{await run;assert.equal(await exists(s.file),false,variant);}
   assert.equal(await exists(s.installed),true,variant);
  }finally{await s.cleanup()}
 }
});

test('retention purges quarantine only when the recorded original identity matches or was remounted',async()=>{
 const purges={same:true,ctimeChanged:true,deviceChanged:true,deviceAndCtimeChanged:true,inodeChanged:true,remounted:true,remountedCtimeChanged:true,sizeChanged:false,mtimeChanged:false,fourFields:false,emptyCtime:false,textCtime:false,textDevice:false,sixFields:false,missing:false};
 for(const [variant,purged] of Object.entries(purges)){
  const s=await setup(retention);
  try{
   s.c.fp=identityVariants(s.c.fp)[variant];
   const run=retention.retainCase(s.c,{...s,now:s.expired});
   const unreadable=['fourFields','emptyCtime','textCtime','textDevice','sixFields','missing'].includes(variant);
   if(purged)await run;else await assert.rejects(run,unreadable?{code:'FILE_IDENTITY_INVALID',message:'Recorded file identity is unreadable; quarantine preserved'}:/^Error: Quarantine file changed; preserved$/,variant);
   assert.equal(await exists(s.file),!purged,variant);
   assert.equal(await exists(s.installed),true,variant);
  }finally{await s.cleanup()}
 }
});

test('approval evidence records a content sample of the installed copy',async()=>{
 const s=await setup(retention);
 try{
  const record=JSON.parse(await fs.readFile(s.evidence,'utf8'));
  assert.equal(record.installedSample,await contentSample(s.installed));
  assert.match(record.installedSample,/^[0-9a-f]{64}$/);
 }finally{await s.cleanup()}
});

test('after a remount retention refuses an approved copy whose content sample no longer matches',async()=>{
 const s=await setup(retention);
 try{
  const record=JSON.parse(await fs.readFile(s.evidence,'utf8'));
  // Same length and modification time, different bytes: only the sample tells them apart.
  const st=await fs.stat(s.installed);await fs.writeFile(s.installed,'APPROVED FILM');await fs.utimes(s.installed,st.atime,st.mtime);
  record.installedFP=identityVariants(identityOf(await fs.stat(s.installed))).remounted;await fs.writeFile(s.evidence,JSON.stringify(record));
  await assert.rejects(retention.retainCase(s.c,{...s,now:s.expired}),/^Error: Approved replacement changed; quarantine preserved$/);
  assert.equal(await exists(s.file),true);
 }finally{await s.cleanup()}
});

test('an approval recorded before content samples accepts a remount but not a remount with a ctime change',async()=>{
 for(const [variant,accepted] of [['remounted',true],['deviceChanged',true],['remountedCtimeChanged',false]]){
  const s=await setup(retention);
  try{
   const record=JSON.parse(await fs.readFile(s.evidence,'utf8'));delete record.installedSample;
   record.installedFP=identityVariants(record.installedFP)[variant];await fs.writeFile(s.evidence,JSON.stringify(record));
   const run=retention.retainCase(s.c,{...s,now:s.expired});
   if(accepted)await run;else await assert.rejects(run,/^Error: Approved replacement changed; quarantine preserved$/,variant);
   assert.equal(await exists(s.file),!accepted,variant);
  }finally{await s.cleanup()}
 }
});

test('after a remount retention purges the quarantined original only when its recorded content sample matches',async()=>{
 for(const [label,sample,purged] of [['matching',async f=>contentSample(f),true],['different',async()=>'0'.repeat(64),false]]){
  const s=await setup(retention);
  try{
   s.c.evidence={sampleSHA256:await sample(s.file)};s.c.fp=identityVariants(s.c.fp).remounted;
   const run=retention.retainCase(s.c,{...s,now:s.expired});
   if(purged)await run;else await assert.rejects(run,/^Error: Quarantine file changed; preserved$/,label);
   assert.equal(await exists(s.file),!purged,label);
  }finally{await s.cleanup()}
 }
});
