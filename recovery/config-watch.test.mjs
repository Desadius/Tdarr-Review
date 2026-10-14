import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {configDigest,checkConfigText,detectConfigChange,startupValidator} from './config-watch.mjs';
import {publishRecoveryStatus} from './waiting-source.mjs';

async function setup(text){const root=await fs.mkdtemp(path.join(os.tmpdir(),'recovery-config-'));const file=path.join(root,'config.json');await fs.writeFile(file,text);return {root,file,loadedDigest:configDigest(text)};}

test('an unchanged config reports nothing; an edit reports restart required without applying it',async()=>{
 const s=await setup('{"enabled":false}');try{
  assert.equal(await detectConfigChange(s),null);
  await fs.writeFile(s.file,'{"enabled":true}');
  const first=await detectConfigChange({...s,now:new Date('2026-10-13T10:00:00Z')});
  assert.deepEqual({...first,digest:undefined},{digest:undefined,detectedAt:'2026-10-13T10:00:00.000Z',restartRequired:true,valid:true,error:null});
  assert.strictEqual(await detectConfigChange({...s,previous:first,now:new Date('2026-10-13T11:00:00Z')}),first,'the first detection time is kept');
  await fs.writeFile(s.file,'{"enabled":false}');
  assert.equal(await detectConfigChange({...s,previous:first}),null,'reverting the edit clears the notice');
 }finally{await fs.rm(s.root,{recursive:true,force:true})}
});

test('invalid or missing config is reported without echoing file content',async()=>{
 const secret='{"radarrApiKey":"SECRET-VALUE",';
 const s=await setup('{"enabled":false}');try{
  await fs.writeFile(s.file,secret);
  const invalid=await detectConfigChange(s);assert.equal(invalid.valid,false);assert.doesNotMatch(JSON.stringify(invalid),/SECRET/);
  await fs.rm(s.file);
  const missing=await detectConfigChange({...s,previous:invalid});assert.equal(missing.valid,false);assert.match(missing.error,/ENOENT/);assert.notEqual(missing.detectedAt,undefined);
 }finally{await fs.rm(s.root,{recursive:true,force:true})}
 assert.equal(checkConfigText('[]'),'config.json must contain a JSON object');assert.equal(checkConfigText('{}'),null);
});

test('the shared status file carries the restart notice but not the config digest',async()=>{
 let written;const atomic=async(_file,value)=>{written=value};
 const cfg={mediaRoot:'/storage/movies',sourceRoot:'/media/movies',libraryId:'lib'};
 await publishRecoveryStatus({cfg,state:{cases:{}},atomic});assert.equal(written.configChange,null);
 await publishRecoveryStatus({cfg,state:{cases:{},configChange:{digest:'abc',detectedAt:'2026-10-13T10:00:00.000Z',restartRequired:true,valid:false,error:'config.json is not valid JSON'}},atomic});
 assert.deepEqual(written.configChange,{detectedAt:'2026-10-13T10:00:00.000Z',restartRequired:true,valid:false,error:'config.json is not valid JSON'});
});

test('an edit that parses is checked once against the start-up rules; their error marks it invalid',async()=>{
 const s=await setup('{"enabled":false}');try{
  const seen=[];const validate=async value=>{seen.push(value);return value.libraryId==='other'?'Recovery approval registry: missing frozen library mapping':null};
  await fs.writeFile(s.file,'{"enabled":true,"libraryId":"other"}');
  const first=await detectConfigChange({...s,validate});assert.equal(first.valid,false);assert.equal(first.error,'Recovery approval registry: missing frozen library mapping');
  assert.deepEqual(seen,[{enabled:true,libraryId:'other'}]);
  assert.strictEqual(await detectConfigChange({...s,validate,previous:first}),first);assert.equal(seen.length,1,'the same edit is not re-validated every poll');
  await fs.writeFile(s.file,'{"enabled":true,"libraryId":"same"}');assert.equal((await detectConfigChange({...s,validate,previous:first})).valid,true);
  await fs.writeFile(s.file,'{broken');assert.equal((await detectConfigChange({...s,validate})).valid,false);assert.equal(seen.length,2,'unparseable edits never reach the start-up checks');
  await fs.writeFile(s.file,'{"x":1}');const thrown=await detectConfigChange({...s,validate:async()=>{throw Error('SECRET detail')}});
  assert.equal(thrown.valid,false);assert.doesNotMatch(JSON.stringify(thrown),/SECRET/);
 }finally{await fs.rm(s.root,{recursive:true,force:true})}
});

test('an edit is checked with the start-up gate: the Recovery mode, then the approval registry',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'recovery-config-gate-'));try{
  await fs.writeFile(path.join(root,'pending-approvals.json'),JSON.stringify({version:1,config:{libraryId:'frozen-library'},cases:[]}),{mode:0o600});
  const state={version:1,jobs:{},cases:{}};
  const repair=startupValidator({data:root,mode:'repair',getState:()=>state}),verify=startupValidator({data:root,mode:'verify',getState:()=>state});
  assert.equal(await repair({libraryId:'frozen-library'}),null);
  assert.equal(await repair({libraryId:'frozen-library',enabled:true}),null,'a matching enabled is accepted');
  assert.equal(await verify({libraryId:'frozen-library',enabled:false}),null);
  for(const [validate,value] of [[repair,{libraryId:'frozen-library',enabled:false}],[verify,{libraryId:'frozen-library',enabled:true}]])assert.match(await validate(value),/disagrees with RECOVERY_MODE/);
  assert.match(await repair({libraryId:'frozen-library',enabled:'yes'}),/must be a JSON object, and enabled/);
  const frozen=await repair({libraryId:'another-library'});assert.equal(frozen,'Recovery approval registry: frozen configuration differs');
  assert.ok(!Object.isFrozen(state),'validation never freezes the live state');
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
