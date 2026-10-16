import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {PromotionRefusal,promoteLatest} from './promote-latest.mjs';

// A stub registry behind a stub `docker buildx imagetools`; no real registry or network.
const IMAGE='ghcr.io/desadius/tdarr-review';
const COMMIT='0123456789abcdef0123456789abcdef01234567';
const VERIFIED='sha256:'+'a'.repeat(64),OTHER='sha256:'+'b'.repeat(64),INDEX='sha256:'+'c'.repeat(64);
const MANIFEST='application/vnd.docker.distribution.manifest.v2+json';
const config=revision=>({architecture:'amd64',os:'linux',config:{Labels:revision===null?{}:{'org.opencontainers.image.revision':revision}}});

function registry({revision=COMMIT,latest=OTHER,moveOnCreate=true}={}){
 const images=new Map([[VERIFIED,{manifest:{mediaType:MANIFEST,digest:VERIFIED,size:1},image:config(revision)}],[OTHER,{manifest:{mediaType:MANIFEST,digest:OTHER,size:1},image:config('f'.repeat(40))}]]);
 const tags=new Map(latest?[['latest',latest]]:[]),calls=[];
 const lookup=ref=>{const at=ref.indexOf('@');if(at>=0)return ref.slice(0,at)===IMAGE?images.get(ref.slice(at+1)):undefined;const [name,tag]=[ref.slice(0,ref.lastIndexOf(':')),ref.slice(ref.lastIndexOf(':')+1)];return name===IMAGE&&tags.has(tag)?images.get(tags.get(tag)):undefined;};
 async function docker(args){
  calls.push(args);
  if(args.slice(0,3).join(' ')==='buildx imagetools inspect'){
   const entry=lookup(args[3]),field=/\{\{json \.(\w+)\}\}/.exec(args[args.indexOf('--format')+1])?.[1];
   if(!entry)throw Error('ERROR: '+args[3]+': not found');
   return JSON.stringify(entry[field.toLowerCase()]);
  }
  if(args.slice(0,3).join(' ')==='buildx imagetools create'){
   const tag=args[args.indexOf('--tag')+1],source=args.at(-1);
   if(moveOnCreate)tags.set(tag.slice(tag.lastIndexOf(':')+1),source.slice(source.indexOf('@')+1));
   return '';
  }
  throw Error('unexpected docker '+args.join(' '));
 }
 return {docker,calls,images,tags};
}
const writes=calls=>calls.filter(args=>!(args[0]==='buildx'&&args[1]==='imagetools'&&args[2]==='inspect'));

test('promotion moves latest to exactly the verified digest without building or touching other tags',async()=>{
 const r=registry();
 const result=await promoteLatest({image:IMAGE,commit:COMMIT,digest:VERIFIED,docker:r.docker});
 assert.deepEqual(result,{before:OTHER,after:VERIFIED});
 assert.deepEqual(writes(r.calls),[['buildx','imagetools','create','--prefer-index=false','--tag',IMAGE+':latest',IMAGE+'@'+VERIFIED]]);
 assert.deepEqual([...r.tags],[['latest',VERIFIED]]);
});

test('promotion writes nothing when latest already is the verified digest',async()=>{
 const r=registry({latest:VERIFIED});
 assert.deepEqual(await promoteLatest({image:IMAGE,commit:COMMIT,digest:VERIFIED,docker:r.docker}),{before:VERIFIED,after:VERIFIED});
 assert.deepEqual(writes(r.calls),[]);
});

test('a first promotion works when latest does not exist yet',async()=>{
 const r=registry({latest:null});
 assert.deepEqual(await promoteLatest({image:IMAGE,commit:COMMIT,digest:VERIFIED,docker:r.docker}),{before:null,after:VERIFIED});
});

test('the revision label of a multi-platform index is read from its linux/amd64 image',async()=>{
 const r=registry();r.images.set(INDEX,{manifest:{mediaType:'application/vnd.oci.image.index.v1+json',digest:INDEX,size:1},image:{'linux/amd64':config(COMMIT),'linux/arm64':config('e'.repeat(40))}});
 assert.equal((await promoteLatest({image:IMAGE,commit:COMMIT,digest:INDEX,docker:r.docker})).after,INDEX);
 r.images.get(INDEX).image['linux/amd64']=config('e'.repeat(40));
 await assert.rejects(promoteLatest({image:IMAGE,commit:COMMIT,digest:INDEX,docker:r.docker}),PromotionRefusal);
});

for(const [name,input,setup,message] of [
 ['a digest without the sha256: prefix',{digest:'a'.repeat(64)},{},/^Expected a digest/],
 ['a short digest',{digest:'sha256:abc'},{},/^Expected a digest/],
 ['an upper-case digest',{digest:'sha256:'+'A'.repeat(64)},{},/^Expected a digest/],
 ['a tag instead of a digest',{digest:'latest'},{},/^Expected a digest/],
 ['a short commit',{commit:'0123456'},{},/^Expected a full lowercase commit SHA$/],
 ['an upper-case commit',{commit:COMMIT.toUpperCase()},{},/^Expected a full lowercase commit SHA$/],
 ['a digest missing from the registry',{digest:'sha256:'+'d'.repeat(64)},{},/not found/],
 ['an image built from another commit',{},{revision:'f'.repeat(40)},/revision/],
 ['an image without a revision label',{},{revision:null},/revision/],
 ['an image built without VCS_REF',{},{revision:'unknown'},/revision/],
]){
 test('promotion refuses '+name+' before any registry write',async()=>{
  const r=registry(setup);
  await assert.rejects(promoteLatest({image:IMAGE,commit:COMMIT,digest:VERIFIED,...input,docker:r.docker}),e=>e instanceof PromotionRefusal&&message.test(e.message));
  assert.deepEqual(writes(r.calls),[]);assert.deepEqual([...r.tags],[['latest',OTHER]]);
 });
}

test('a registry error other than a missing image is reported with its cause, not as a wrong digest',async()=>{
 const r=registry(),inner=r.docker;
 const denied=async args=>{if(args[2]==='inspect')throw Error('docker buildx imagetools exited with 1: ERROR: unauthorized: authentication required');return inner(args);};
 await assert.rejects(promoteLatest({image:IMAGE,commit:COMMIT,digest:VERIFIED,docker:denied}),e=>e instanceof PromotionRefusal&&/could not be inspected: .*unauthorized/.test(e.message));
 const latestDenied=async args=>{if(args[2]==='inspect'&&args[3]===IMAGE+':latest')throw Error('ERROR: 503 Service Unavailable');return inner(args);};
 await assert.rejects(promoteLatest({image:IMAGE,commit:COMMIT,digest:VERIFIED,docker:latestDenied}),e=>e instanceof PromotionRefusal&&/latest could not be read: .*503/.test(e.message));
 assert.deepEqual(writes(r.calls),[]);
});

test('promotion fails when latest does not resolve to the verified digest afterwards',async()=>{
 const r=registry({moveOnCreate:false});
 await assert.rejects(promoteLatest({image:IMAGE,commit:COMMIT,digest:VERIFIED,docker:r.docker}),e=>e instanceof PromotionRefusal&&/latest/.test(e.message));
});

test('the command line promotes through docker and writes the digests to the step summary',{skip:process.platform==='win32'&&'needs an executable stub on PATH'},async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'promote-latest-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 // The stub keeps the registry in a JSON file so that create changes what the next inspect sees.
 const state=path.join(dir,'registry.json');
 await fs.writeFile(state,JSON.stringify({latest:OTHER,images:{[VERIFIED]:{manifest:{mediaType:MANIFEST,digest:VERIFIED,size:1},image:config(COMMIT)},[OTHER]:{manifest:{mediaType:MANIFEST,digest:OTHER,size:1},image:config('f'.repeat(40))}}}));
 await fs.writeFile(path.join(dir,'docker'),`#!${process.execPath}
const fs=require('fs'),a=process.argv.slice(2),s=JSON.parse(fs.readFileSync(${JSON.stringify(state)},'utf8'));
fs.appendFileSync(${JSON.stringify(path.join(dir,'calls'))},a.join(' ')+'\\n');
if(a[2]==='inspect'){const ref=a[3],d=ref.includes('@')?ref.split('@')[1]:s.latest,e=s.images[d];if(!e){console.error('not found');process.exit(1);}const f=/\\.(\\w+)/.exec(a[a.indexOf('--format')+1])[1].toLowerCase();console.log(JSON.stringify(e[f]));}
else if(a[2]==='create'){s.latest=a.at(-1).split('@')[1];fs.writeFileSync(${JSON.stringify(state)},JSON.stringify(s));}
else process.exit(2);
`,{mode:0o755});
 const summary=path.join(dir,'summary.md');
 const run=env=>new Promise(resolve=>execFile(process.execPath,[fileURLToPath(new URL('./promote-latest.mjs',import.meta.url))],{env:{...process.env,PATH:dir+path.delimiter+process.env.PATH,GITHUB_STEP_SUMMARY:summary,IMAGE,COMMIT,...env}},(error,stdout,stderr)=>resolve({code:error?error.code:0,stdout,stderr})));
 const refused=await run({DIGEST:'sha256:'+'d'.repeat(64)});
 assert.equal(refused.code,1);assert.match(refused.stderr,/not found/);
 const done=await run({DIGEST:VERIFIED});
 assert.equal(done.code,0,done.stderr);
 assert.equal(JSON.parse(await fs.readFile(state,'utf8')).latest,VERIFIED);
 const summaryText=await fs.readFile(summary,'utf8');
 assert.match(summaryText,new RegExp('latest.*'+OTHER+'.*'+VERIFIED));
 assert.deepEqual((await fs.readFile(path.join(dir,'calls'),'utf8')).trim().split('\n').filter(line=>!line.includes(' inspect ')),['buildx imagetools create --prefer-index=false --tag '+IMAGE+':latest '+IMAGE+'@'+VERIFIED]);
});
