import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {identityVariants} from '../review/test-helpers/identity-variants.mjs';
import {identityOf} from './file-identity.mjs';

// Review and Recovery each ship a copy of the retention rules; both must decide the same way.
const copies={review:await import('../review/quarantine-retention.mjs'),recovery:await import('./quarantine-retention.mjs')};

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

for(const [name,copy] of Object.entries(copies)){
 test(name+' retention refuses a changed approved replacement by the kind of change',async()=>{
  const metadata=/metadata timestamp changed/,changed=/^Error: Approved replacement changed; quarantine preserved$/;
  const expected={same:null,ctimeChanged:metadata,deviceChanged:changed,deviceAndCtimeChanged:changed,inodeChanged:changed,fourFields:changed,emptyCtime:changed,textCtime:changed,textDevice:changed,sixFields:changed,missing:changed};
  for(const [variant,error] of Object.entries(expected)){
   const s=await setup(copy);
   try{
    const record=JSON.parse(await fs.readFile(s.evidence,'utf8'));record.installedFP=identityVariants(record.installedFP)[variant];await fs.writeFile(s.evidence,JSON.stringify(record));
    const run=copy.retainCase(s.c,{...s,now:s.expired});
    if(error){await assert.rejects(run,error,variant);assert.equal(await exists(s.file),true,variant);assert.equal(s.c.cleanup,undefined,variant);}
    else{await run;assert.equal(await exists(s.file),false,variant);}
    assert.equal(await exists(s.installed),true,variant);
   }finally{await s.cleanup()}
  }
 });

 test(name+' retention purges quarantine only when the recorded original identity matches',async()=>{
  const purges={same:true,ctimeChanged:true,deviceChanged:false,deviceAndCtimeChanged:false,inodeChanged:false,fourFields:false,emptyCtime:false,textCtime:false,textDevice:false,sixFields:false,missing:false};
  for(const [variant,purged] of Object.entries(purges)){
   const s=await setup(copy);
   try{
    s.c.fp=identityVariants(s.c.fp)[variant];
    const run=copy.retainCase(s.c,{...s,now:s.expired});
    if(purged)await run;else await assert.rejects(run,/^Error: Quarantine file changed; preserved$/,variant);
    assert.equal(await exists(s.file),!purged,variant);
    assert.equal(await exists(s.installed),true,variant);
   }finally{await s.cleanup()}
  }
 });
}
