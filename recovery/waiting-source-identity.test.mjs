import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {maintainWaitingSources,publishRecoveryStatus} from './waiting-source.mjs';
import {identityOf} from './file-identity.mjs';
import {identityVariants} from '../review/test-helpers/identity-variants.mjs';

// The preserved original is compared with its recorded identity without ctime: moving
// it into quarantine and linking it back into the library both change ctime.
const accepted={same:true,ctimeChanged:true,deviceChanged:false,deviceAndCtimeChanged:false,inodeChanged:false,fourFields:false,emptyCtime:false,textCtime:false,textDevice:false,sixFields:false,missing:false};
const good={downloadAllowed:true,title:'new release',guid:'new-guid',indexerId:2,quality:{quality:{id:30,resolution:1080}},rejections:[]};

async function fixture({status,kept=false,movie}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'waiting-identity-'));
 const cfg={mediaRoot:path.join(root,'movies'),radarrRoot:'/media',sourceRoot:'/media/movies',libraryId:'library'};
 await fs.mkdir(path.join(cfg.mediaRoot,'Movie'),{recursive:true});await fs.mkdir(path.join(root,'quarantine','case'),{recursive:true});
 const quarantine=path.join(root,'quarantine','case','file.mkv'),source=path.join(cfg.mediaRoot,'Movie/file.mkv');
 await fs.writeFile(quarantine,'retained original bytes');
 if(kept)await fs.link(quarantine,source);
 const size=(await fs.stat(quarantine)).size;
 const c={id:'case',movieId:1,file:'/media/movies/Movie/file.mkv',relative:'Movie/file.mkv',source,quarantine,size,fp:identityOf(await fs.stat(quarantine)),status,binding:{movieFileId:10,sourceTitle:'bad release'}};
 if(kept)Object.assign(c,{keptLink:true,keptMovieFileId:11,skipCurrentEdition:true,preservedSourceFP:identityOf(await fs.stat(source)),nextSearchAt:new Date(0).toISOString()});
 let current=movie(size);const downloads=[];
 const rad=async(p,body)=>{
  if(p==='/release'&&body){downloads.push(body);return {};}
  if(p.startsWith('/movie/'))return current;if(p.startsWith('/queue'))return {records:[]};
  if(p.startsWith('/qualityprofile'))return {items:[{allowed:true,quality:{id:30}}]};if(p.startsWith('/blocklist'))return [];if(p.startsWith('/release'))return [good];
 };
 const command=async()=>{current=await fs.stat(source).catch(()=>null)?{movieFileId:11,movieFile:{path:'/media/Movie/file.mkv',size}}:{movieFileId:0};};
 const deps={cfg,state:{cases:{case:c}},rad,td:async()=>{},phase:async(c,status,message)=>Object.assign(c,{status,message}),save:async()=>{},command,idle:async()=>{},
  safeSource:async rel=>{const st=await fs.stat(path.join(cfg.mediaRoot,rel));return {fp:identityOf(st),size:st.size};},sample:async p=>fs.readFile(p,'utf8')};
 const exists=async p=>!!await fs.lstat(p).catch(()=>null);
 return {c,cfg,deps,source,quarantine,downloads,exists,cleanup:()=>fs.rm(root,{recursive:true,force:true})};
}
function expectRefusal(c,variant,message){
 assert.equal(c.observationError,message,variant);
}

test('a missing replacement returns the quarantined original only when its recorded identity matches',async()=>{
 for(const [variant,returns] of Object.entries(accepted)){
  const f=await fixture({status:'waiting_replacement',movie:()=>({movieFileId:0})});
  try{
   f.c.fp=identityVariants(f.c.fp)[variant];
   await maintainWaitingSources(f.deps);
   assert.equal(f.c.status,returns?'waiting_source_kept':'waiting_replacement',variant);
   assert.equal(await f.exists(f.source),returns,variant);
   if(!returns)expectRefusal(f.c,variant,'Quarantine identity changed; cannot restore source');
  }finally{await f.cleanup()}
 }
});

test('a new import is accepted only when the recorded quarantine identity matches',async()=>{
 for(const [variant,accepts] of Object.entries(accepted)){
  const f=await fixture({status:'waiting_source_kept',kept:true,movie:size=>({movieFileId:12,movieFile:{path:'/media/Movie/file.mkv',sceneName:'new release',size}})});
  try{
   f.c.fp=identityVariants(f.c.fp)[variant];
   await maintainWaitingSources(f.deps);
   assert.equal(f.c.status,accepts?'waiting_replacement':'waiting_source_kept',variant);
   if(!accepts)expectRefusal(f.c,variant,'Quarantine identity changed');
  }finally{await f.cleanup()}
 }
});

test('the kept library copy is removed for a download only when the recorded quarantine identity matches',async()=>{
 for(const [variant,removes] of Object.entries(accepted)){
  const f=await fixture({status:'waiting_source_kept',kept:true,movie:size=>({movieFileId:11,qualityProfileId:4,movieFile:{path:'/media/Movie/file.mkv',size,quality:{quality:{id:30,resolution:1080}}}})});
  try{
   f.c.fp=identityVariants(f.c.fp)[variant];
   await maintainWaitingSources(f.deps);
   assert.equal(await f.exists(f.source),!removes,variant);
   assert.equal(f.downloads.length,removes?1:0,variant);
   assert.equal(await fs.readFile(f.quarantine,'utf8'),'retained original bytes',variant);
   if(!removes)expectRefusal(f.c,variant,'Original changed before replacement request');
  }finally{await f.cleanup()}
 }
});

test('original location display follows the recorded identities without authorizing anything',async()=>{
 const publish=async f=>{let snapshot;await publishRecoveryStatus({cfg:f.cfg,state:f.deps.state,atomic:async(file,value)=>{snapshot=value;}});return snapshot.cases[0].originalOutsideLibrary;};
 for(const [variant,matches] of Object.entries(accepted)){
  const outside=await fixture({status:'waiting_replacement',movie:()=>({movieFileId:0})});
  try{
   outside.c.fp=identityVariants(outside.c.fp)[variant];
   assert.equal(await publish(outside),matches?true:null,'quarantined original, '+variant);
  }finally{await outside.cleanup()}
  const kept=await fixture({status:'waiting_source_kept',kept:true,movie:()=>({movieFileId:11})});
  try{
   kept.c.preservedSourceFP=identityVariants(kept.c.preservedSourceFP)[variant];
   // Without a kept-copy identity the display falls back to the quarantine identity.
   assert.equal(await publish(kept),variant==='missing'?false:!matches,'kept library copy, '+variant);
  }finally{await kept.cleanup()}
 }
});
