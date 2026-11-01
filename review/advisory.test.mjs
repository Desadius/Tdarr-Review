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
 const remount={salt:''},mounted=async(root,rel)=>{const f=await safeFile(root,rel);return {...f,fp:f.fp+remount.salt}};
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'advisory-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const mediaRoot=path.join(root,'media'),reviewRoot=path.join(root,'review'),data=path.join(root,'data');
 await fs.mkdir(path.join(mediaRoot,film),{recursive:true});await fs.mkdir(path.join(reviewRoot,'PROD-Movies',film),{recursive:true});await fs.mkdir(data);
 const source=path.join(mediaRoot,relative);await fs.writeFile(source,'original');const stat=await fs.stat(source);
 const marker={version:1,kind:'tdarr-review-advisory',reason:'container_crop',source:{relative,size:stat.size,mtimeMs:stat.mtimeMs},measured:{width:3840,height:2160,sampleAspectRatio:'803:1080',crop:{top:277,bottom:277,left:0,right:0}},jobId:'53JV7xm',createdAt:'2026-11-01T11:29:00Z',...override};
 const markerFile=path.join(reviewRoot,'PROD-Movies',relative+ADVISORY_SUFFIX);await fs.writeFile(markerFile,JSON.stringify(marker));
 const advisories=createAdvisories({data,getConfig:()=>({mediaRoot,reviewRoot,reviewPrefixes:['PROD-Movies']}),safeFile:mounted,hash,atomicJSON:writeJSON,openRequestRelatives:async()=>open});
 return {advisories,source,markerFile,data,remount};
}

test('a valid marker for an unchanged original is one advisory item, never a Review result (#299)',async t=>{
 const {advisories}=await setup(t);const [item,...rest]=await advisories.list();
 assert.equal(rest.length,0);assert.equal(item.status,'ready');assert.equal(item.relative,relative);assert.equal(item.reason,'container_crop');
 assert.deepEqual(item.measured.crop,{top:277,bottom:277,left:0,right:0});assert.equal('reviewRelative' in item,false);assert.equal('approve' in item,false);
 const candidate=await advisories.candidate(item.id,item.snapshot);
 assert.deepEqual({sourceOnly:candidate.sourceOnly,reviewRelative:candidate.reviewRelative,relative:candidate.relative,advisoryId:candidate.advisoryId},{sourceOnly:true,reviewRelative:'',relative,advisoryId:item.id});
});

test('a changed original hides the stale marker and refuses both actions; a stale snapshot is refused (#299)',async t=>{
 const {advisories,source}=await setup(t);const [before]=await advisories.list();
 await assert.rejects(advisories.candidate(before.id,'0'.repeat(64)),{code:'advisory_changed'});
 await fs.writeFile(source,'a different original');assert.deepEqual(await advisories.list(),[],'a replaced or edited original no longer needs the recommendation');
 await assert.rejects(advisories.candidate(before.id,before.snapshot),{code:'advisory_changed'});
 await assert.rejects(advisories.keep(before.id,before.snapshot),{code:'advisory_changed'});
});

test('Keep survives a remount and a rewritten marker; another reason or original shows again (#299)',async t=>{
 const {advisories,markerFile,data,remount}=await setup(t);const [item]=await advisories.list();
 await advisories.keep(item.id,item.snapshot);assert.deepEqual(await advisories.list(),[]);
 const saved=JSON.parse(await fs.readFile(path.join(data,'advisory-decisions.json'),'utf8'));assert.deepEqual(Object.values(saved.kept).map(k=>k.relative),[relative]);
 remount.salt=':remounted';assert.deepEqual(await advisories.list(),[],'a new device/inode after a reboot keeps the decision');
 const text=await fs.readFile(markerFile,'utf8');await fs.rm(markerFile);await fs.writeFile(markerFile,text);
 assert.deepEqual(await advisories.list(),[],'the flow rewriting the same marker keeps the decision');
 await fs.writeFile(markerFile,JSON.stringify({...JSON.parse(text),reason:'non_square_sar'}));
 const [again]=await advisories.list();assert.equal(again?.reason,'non_square_sar','a different reason is a new recommendation');
});

test('refused markers are reported once per change, not on every listing (#299)',async t=>{
 const {advisories}=await setup(t,{marker:{version:2}}),logged=[],original=console.error;console.error=m=>logged.push(m);
 try{await advisories.list();await advisories.list();await advisories.list()}finally{console.error=original}
 assert.deepEqual(logged,['Advisory markers refused: 1']);
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
