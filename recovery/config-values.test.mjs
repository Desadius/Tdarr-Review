import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {RecoveryRefusal,resolveRecoveryConfig} from './recovery-mode.mjs';
import {startupValidator} from './config-watch.mjs';

const read=async file=>fs.readFile(new URL('../'+file,import.meta.url),'utf8');
const refused=(detail,reason='invalid-config')=>e=>e instanceof RecoveryRefusal&&e.reason===reason&&e.message.includes('('+detail);
const complete=async()=>{const cfg=JSON.parse(await read('examples/recovery-config.example.json'));return cfg;};
const check=(cfg,mode='verify')=>resolveRecoveryConfig({mode,text:JSON.stringify(cfg)});

test('the shipped example, a typical 1.11 config.json and every config in the docs start in both modes',async()=>{
 const configs={'examples/recovery-config.example.json':await read('examples/recovery-config.example.json'),'fixtures/recovery-config-1.11.json':await read('fixtures/recovery-config-1.11.json')};
 // A JSON block with a top-level libraryId is a complete Recovery config.json example.
 // Other settings documents may contain a libraryId inside a separate TV path plan.
 for(const doc of (await fs.readdir(new URL('../docs/',import.meta.url))).filter(f=>f.endsWith('.md'))){
  for(const [,block] of (await read('docs/'+doc)).matchAll(/```json\n([\s\S]*?)```/g))if(Object.hasOwn(JSON.parse(block),'libraryId'))configs['docs/'+doc]=block;
 }
 for(const [name,text] of Object.entries(configs)){
  const value=JSON.parse(text),modes=Object.hasOwn(value,'enabled')?[value.enabled?'repair':'verify']:['verify','repair'];
  for(const mode of modes)assert.doesNotThrow(()=>resolveRecoveryConfig({mode,text}),name+' in '+mode);
 }
});

test('a known setting of the wrong type or range refuses start-up, naming the key but never the value',async()=>{
 const secret='SECRET-VALUE-7731';
 const wrong={
  tdarrUrl:['',7,null],radarrUrl:[' ',{}],radarrApiKey:['',42],libraryId:['',1],sourceRoot:['',[]],radarrRoot:[null],
  mediaRoot:['media/movies',secret,''],reviewRoot:['review'],quarantineRoot:[1],database:['db.sqlite'],reports:[true],ffmpeg:['ffmpeg'],ffprobe:['ffprobe',''],
  reviewPrefixes:['PROD-Movies',[''],[1]],
  stableMinutes:['ten',secret,-1,null,true,'10'],confirmDelaySeconds:['30',-0.5],movieCooldownDays:[-1,'30'],pollSeconds:['300',-1],since:['0',-1],
  decodeTimeoutHours:[0,-1,'12'],maxRepairsPerDay:[0,1.5,'3',-1],
  fullSourceHash:['false',0,null],detectTerminalHeaders:['true',1],
  approvedCaseIds:['a',[1],{}],approvedImportRepairs:[[],'x',{a:1}],
  // Longer than Node's longest timer (2^31-1 ms), which fires after 1 ms instead.
  confirmDelaySeconds2:[2147484],pollSeconds2:[2147484],decodeTimeoutHours2:[597],
  // Paths the readers cannot use: the filesystem root (within() refuses every path below it), a
  // trailing separator on the remote roots (readers append '/'+relative), prefixes outside reviewRoot.
  mediaRoot2:['/'],quarantineRoot2:['/'],reviewRoot2:['/'],
  sourceRoot2:['/media/movies/','C:\\Media\\'],radarrRoot2:['/media/'],
  reviewPrefixes2:[['/PROD-Movies'],['../PROD'],['PROD/'],['a//b'],['C:/x']],
 };
 const base=await complete();
 for(const [entry,values] of Object.entries(wrong))for(const value of values){
  const key=entry.replace(/2$/,'');
  const label=key+'='+JSON.stringify(value);
  assert.throws(()=>check({...base,[key]:value}),refused(key+' must be '),label);
  try{check({...base,[key]:value});}catch(e){assert.ok(!e.message.includes(secret),label+' leaks its value: '+e.message);}
 }
});

test('a missing required setting refuses start-up; optional ones may be left out',async()=>{
 const base=await complete();
 for(const key of ['tdarrUrl','radarrUrl','radarrApiKey','libraryId','sourceRoot','mediaRoot','radarrRoot','reviewRoot','reviewPrefixes','quarantineRoot','database','reports','ffmpeg','stableMinutes','decodeTimeoutHours','confirmDelaySeconds','maxRepairsPerDay','movieCooldownDays','pollSeconds','since']){
  const {[key]:_,...rest}=base;assert.throws(()=>check(rest),refused(key+' is missing'),key);
 }
 const {fullSourceHash,detectTerminalHeaders,approvedCaseIds,approvedImportRepairs,...required}=base;
 assert.equal(check(required).cfg.libraryId,base.libraryId);
 assert.equal(check({...required,ffprobe:'/app/Tdarr_Node/assets/app/ffmpeg/linux_x64/ffprobe'}).cfg.ffprobe,'/app/Tdarr_Node/assets/app/ffmpeg/linux_x64/ffprobe');
});

test('values the worker works with today stay valid, including 0 and fractions; unknown keys are ignored',async()=>{
 const base=await complete();
 for(const [key,value] of [['stableMinutes',0],['stableMinutes',0.5],['confirmDelaySeconds',0],['movieCooldownDays',0],['pollSeconds',0],['pollSeconds',1],['since',0],['since',Date.parse('2026-01-01T00:00:00Z')],['decodeTimeoutHours',0.25],['decodeTimeoutHours',596],['confirmDelaySeconds',2147483],['pollSeconds',2147483],['mediaRoot','/media/movies/'],['mediaRoot','/media/../media/movies'],['reviewPrefixes',['PROD-Movies','PROD-Movies/nested']],['maxRepairsPerDay',1],['reviewPrefixes',[]],['radarrRoot','D:/Movies'],['sourceRoot','C:\\Media'],['approvedImportRepairs',{case:{movieFileId:1}}],['approvedCaseIds',['a'.repeat(24)]],['fullSourceHash',true],['detectTerminalHeaders',false]]){
  assert.deepEqual(check({...base,[key]:value}).cfg[key],value,key+'='+JSON.stringify(value));
 }
 assert.equal(check({...base,someFutureSetting:'x',legacy:{nested:1}},'repair').cfg.someFutureSetting,'x');
});

test('the enabled and mode checks still come first',async()=>{
 const base=await complete();
 assert.throws(()=>check({...base,enabled:true,stableMinutes:'ten'},'verify'),e=>e.reason==='mode-conflict');
 assert.throws(()=>resolveRecoveryConfig({mode:'off',text:'{"stableMinutes":"ten"}'}),e=>e.reason==='mode-off');
});

test('an edit with a wrong-typed setting is reported invalid by the configChange validator',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'recovery-config-values-'));try{
  const validate=startupValidator({data:root,mode:'verify',getState:()=>({version:1,jobs:{},cases:{}})}),base=await complete();
  assert.equal(await validate(base),null);
  const error=await validate({...base,stableMinutes:'SECRET-ten'});
  assert.match(error,/stableMinutes must be a number of 0 or more/);assert.doesNotMatch(error,/SECRET/);
  const {since,...withoutSince}=base;assert.match(await validate(withoutSince),/since is missing/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
