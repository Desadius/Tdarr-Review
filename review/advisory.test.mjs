import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {safeFile,hash} from './core.mjs';
import {createAdvisories,parseAdvisory,ADVISORY_SUFFIX} from './advisory.mjs';

// The durable directory fsync of core atomicJSON is Linux-only; the decision logic is the same.
const writeJSON=(file,data)=>fs.writeFile(file,JSON.stringify(data));
const film='The Mule (2018)',file='The Mule (2018) WEBDL-2160p.mkv',relative=film+'/'+file;
async function setup(t,{open=new Set(),marker:override={}}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'advisory-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const mediaRoot=path.join(root,'media'),reviewRoot=path.join(root,'review'),data=path.join(root,'data');
 await fs.mkdir(path.join(mediaRoot,film),{recursive:true});await fs.mkdir(path.join(reviewRoot,'PROD-Movies',film),{recursive:true});await fs.mkdir(data);
 const source=path.join(mediaRoot,relative);await fs.writeFile(source,'original');const stat=await fs.stat(source);
 const marker={version:1,kind:'tdarr-review-advisory',reason:'container_crop',source:{relative,size:stat.size,mtimeMs:stat.mtimeMs},measured:{width:3840,height:2160,sampleAspectRatio:'803:1080',crop:{top:277,bottom:277,left:0,right:0}},jobId:'53JV7xm',createdAt:'2026-11-01T11:29:00Z',...override};
 const markerFile=path.join(reviewRoot,'PROD-Movies',relative+ADVISORY_SUFFIX);await fs.writeFile(markerFile,JSON.stringify(marker));
 const advisories=createAdvisories({data,getConfig:()=>({mediaRoot,reviewRoot,reviewPrefixes:['PROD-Movies']}),safeFile,hash,atomicJSON:writeJSON,openRequestRelatives:async()=>open});
 return {advisories,source,markerFile,data};
}

test('a valid marker for an unchanged original is one advisory item, never a Review result (#299)',async t=>{
 const {advisories}=await setup(t);const [item,...rest]=await advisories.list();
 assert.equal(rest.length,0);assert.equal(item.status,'ready');assert.equal(item.relative,relative);assert.equal(item.reason,'container_crop');
 assert.deepEqual(item.measured.crop,{top:277,bottom:277,left:0,right:0});assert.equal('reviewRelative' in item,false);assert.equal('approve' in item,false);
 const candidate=await advisories.candidate(item.id,item.snapshot);
 assert.deepEqual({sourceOnly:candidate.sourceOnly,reviewRelative:candidate.reviewRelative,relative:candidate.relative,advisoryId:candidate.advisoryId},{sourceOnly:true,reviewRelative:'',relative,advisoryId:item.id});
});

test('a changed original disables both actions; a stale snapshot is refused (#299)',async t=>{
 const {advisories,source}=await setup(t);const [before]=await advisories.list();
 await assert.rejects(advisories.candidate(before.id,'0'.repeat(64)),{code:'advisory_changed'});
 await fs.writeFile(source,'a different original');const [after]=await advisories.list();
 assert.equal(after.status,'changed');
 await assert.rejects(advisories.candidate(after.id,after.snapshot),{code:'advisory_source_changed'});
 await assert.rejects(advisories.keep(after.id,after.snapshot),{code:'advisory_source_changed'});
});

test('Keep persists for that exact identity; a new marker identity shows again (#299)',async t=>{
 const {advisories,markerFile,data}=await setup(t);const [item]=await advisories.list();
 await advisories.keep(item.id,item.snapshot);assert.deepEqual(await advisories.list(),[]);
 const saved=JSON.parse(await fs.readFile(path.join(data,'advisory-decisions.json'),'utf8'));assert.equal(saved.kept[item.snapshot].relative,relative);
 const text=await fs.readFile(markerFile,'utf8');await fs.rm(markerFile);await fs.writeFile(markerFile,text);
 const [again]=await advisories.list();assert.equal(again?.id,item.id);assert.notEqual(again.snapshot,item.snapshot);
});

test('an open replacement request or a missing original hides the marker (#299)',async t=>{
 assert.deepEqual(await (await setup(t,{open:new Set([relative])})).advisories.list(),[]);
 const {advisories,source}=await setup(t);await fs.rm(source);assert.deepEqual(await advisories.list(),[]);
});

test('malformed, mismatched or oversized markers are refused (#299)',async t=>{
 for(const marker of [{version:2},{kind:'other'},{reason:'unknown'},{source:{relative:'Other (2000)/'+file,size:8,mtimeMs:1}},{source:{relative,size:0,mtimeMs:1}},{padding:'x'.repeat(9000)}])
  assert.deepEqual(await (await setup(t,{marker})).advisories.list(),[],JSON.stringify(marker).slice(0,60));
 assert.throws(()=>parseAdvisory('not json'),{code:'advisory_invalid'});
 assert.throws(()=>parseAdvisory(JSON.stringify([1])),{code:'advisory_invalid'});
});
