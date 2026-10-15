import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {identity} from './policy.mjs';
import {processPending} from './pending-approved.mjs';
import {loadApprovalRegistry,registryHasApproval,migrateApprovalRegistry} from './approval-registry.mjs';
import {configDigest,detectConfigChange,startupValidator} from './config-watch.mjs';

function evidence(){
 const cfg={enabled:true,libraryId:'fixture-library',sourceRoot:'/media/movies',mediaRoot:'/storage/movies',radarrRoot:'/radarr/movies',quarantineRoot:'/storage/.tdarr-corrupt',reviewRoot:'/review',reviewPrefixes:['PROD-Movies'],maxRepairsPerDay:3};
 const a={movieId:1,movieFileId:11,sourceTitle:'DISPOSABLE.Fixture.Release',relative:'Fixture/file.mkv',file:cfg.sourceRoot+'/Fixture/file.mkv',fp:'1:2:101:1000:1001',size:101,importId:21,grabId:22,downloadId:'DISPOSABLE-download',legacyMissingImportSize:true,signature:'quant_step_size larger than huff_lsbs',authorization:'Synthetic evidence only; never a production authorization'};
 a.id=identity(a.file,a.fp);
 a.checks=['7.1.4-Jellyfin','9.0.2-Gyan'].map(version=>({version,file:a.file,bytes:a.size,sourceUnchanged:true,hostIdentityUnchanged:true,timeout:false,exit:1,naturalComplete:false,stoppedAfterEvidence:true,decodeMarkers:[a.signature],stderrTail:a.signature}));
 const registry={version:1,config:structuredClone(cfg),cases:[a]};
 const state={version:1,jobs:{},cases:{[a.id]:{id:a.id,file:a.file,relative:a.relative,size:a.size,fp:a.fp,status:'deferred_limit',approval:structuredClone(a)}}};
 return {cfg,a,registry,state};
}
function importedHistory(f,shape='legacy'){
 const a=structuredClone(f.a);Object.assign(a,{movieId:2,movieFileId:12,importId:23,grabId:24,relative:'Historical/file.mkv',file:f.cfg.sourceRoot+'/Historical/file.mkv',fp:'1:3:202:2000:2001',size:202,downloadId:'DISPOSABLE-historical-download',sourceTitle:'DISPOSABLE.Historical.Release'});a.id=identity(a.file,a.fp);
 for(const c of a.checks){c.file=a.file;c.bytes=a.size;}
 const id=a.id;
 if(shape==='legacy'){delete a.id;delete a.checks;delete a.signature;Object.assign(a,{humanAuthorizedAt:'2026-01-01T00:00:00Z',linux:{synthetic:true},windows:{synthetic:true},linuxBuild:'synthetic-linux-build',windowsBuild:'synthetic-windows-build'});}
 return {id,status:'replacement_imported',mutationStarted:1,movieId:a.movieId,file:a.file,relative:a.relative,source:f.cfg.mediaRoot+'/'+a.relative,size:a.size,fp:a.fp,binding:{sourceTitle:a.sourceTitle,movieFileId:a.movieFileId,downloadId:a.downloadId},approval:a};
}
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'recovery-registry-')),data=path.join(root,'data'),source=path.join(root,'legacy.json');await fs.mkdir(data);
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const f={root,data,source,...evidence()};f.target=path.join(data,'pending-approvals.json');
 f.write=async(file,value)=>fs.writeFile(file,typeof value==='string'?value:JSON.stringify(value),{mode:0o600});
 f.load=()=>loadApprovalRegistry(f);f.migrate=()=>migrateApprovalRegistry(f);
 await f.write(path.join(data,'config.json'),f.cfg);await f.write(path.join(data,'state.json'),f.state);return f;
}

test('fresh missing registry returns an empty versioned registry without creating authorization',async t=>{
 const f=await fixture(t);f.state={cases:{ordinary:{id:'ordinary',status:'manual'}}};assert.deepEqual(await f.load(),{version:1,config:{},cases:[]});await assert.rejects(fs.stat(f.target),{code:'ENOENT'});
});
test('missing registry with historical state approval fails instead of reconstructing it',async t=>{
 const f=await fixture(t);await assert.rejects(f.load(),/historical state approval/);await assert.rejects(fs.stat(f.target),{code:'ENOENT'});
});
test('valid private registry survives source changes and accepts reordered object keys',async t=>{
 const f=await fixture(t);await f.write(f.target,f.registry);
 f.state.cases[f.a.id].approval=Object.fromEntries(Object.entries(f.a).reverse());
 const registry=await f.load();assert(registryHasApproval(registry,f.state.cases[f.a.id]));
 await f.write(f.source,{config:{},cases:[]});assert.deepEqual(await f.load(),registry,'bundled/source files are not authority');
});
test('frozen early-stop structural evidence remains eligible under the existing approval contract',async t=>{
 const f=await fixture(t);await f.write(f.target,f.registry);assert.equal((await f.load()).cases[0].checks[0].naturalComplete,false);
});
test('loaded approval authority cannot be mutated through a state approval reference',async t=>{
 const f=await fixture(t);await f.write(f.target,f.registry);const registry=await f.load(),c={id:f.a.id,approval:registry.cases[0]};
 assert.throws(()=>{c.approval.authorization='changed';},TypeError);assert.throws(()=>{c.approval.checks.reverse();},TypeError);assert(registryHasApproval(registry,c));
});
test('membership requires identical complete evidence, including array order and authorization',()=>{
 const {registry,state,a}=evidence(),c=state.cases[a.id];assert(registryHasApproval(registry,c));
 for(const change of [v=>{v.authorization+=' changed';},v=>{v.checks.reverse();},v=>{v.movieFileId++;},v=>{delete v.legacyMissingImportSize;}]){const changed=structuredClone(c);change(changed.approval);assert.equal(registryHasApproval(registry,changed),false);}
 assert.equal(registryHasApproval(registry,{...c,id:'f'.repeat(24)}),false);
});
test('malformed, unversioned and unsupported registries cannot silently become empty',async t=>{
 const f=await fixture(t);for(const value of ['invalid PRIVATE-CONTENT','{"config":{},"cases":[]}',{...f.registry,version:2},{...f.registry,unexpected:'PRIVATE-CONTENT'},null]){
  await f.write(f.target,typeof value==='string'?value:JSON.stringify(value));await assert.rejects(f.load(),e=>e.code==='RECOVERY_APPROVAL_REGISTRY'&&!e.message.includes('PRIVATE-CONTENT'));
 }
});
test('duplicated case IDs and missing frozen library mappings fail',async t=>{
 const f=await fixture(t);const duplicate=structuredClone(f.registry);duplicate.cases.push(duplicate.cases[0]);await f.write(f.target,duplicate);await assert.rejects(f.load(),/duplicate/);
 for(const key of ['libraryId','sourceRoot','mediaRoot','radarrRoot','quarantineRoot','reviewRoot','reviewPrefixes']){const r=structuredClone(f.registry);delete r.config[key];await f.write(f.target,r);await assert.rejects(f.load(),/missing frozen library mapping/);}
});
test('every frozen root must be normalized absolute POSIX and prefixes must stay inside review',async t=>{
 const f=await fixture(t);
 for(const key of ['sourceRoot','mediaRoot','radarrRoot','quarantineRoot','reviewRoot'])for(const invalid of ['relative','/','//network/path','/path//duplicate','/path/../other','/path/','/path\\other']){
  const cfg=structuredClone(f.cfg),registry=structuredClone(f.registry);cfg[key]=registry.config[key]=invalid;await f.write(f.target,registry);await assert.rejects(loadApprovalRegistry({...f,cfg}),/library roots/);
 }
 for(const invalid of [null,'PROD-Movies',[''],['/absolute'],['../escape'],['PROD/../other'],['PROD//Movies'],['PROD/'],['PROD\\Movies'],['C:drive'],['PROD','PROD']]){
  const cfg=structuredClone(f.cfg),registry=structuredClone(f.registry);cfg.reviewPrefixes=registry.config.reviewPrefixes=invalid;await f.write(f.target,registry);await assert.rejects(loadApprovalRegistry({...f,cfg}),/review prefixes/);
 }
 const cfg=structuredClone(f.cfg),registry=structuredClone(f.registry);cfg.reviewPrefixes=registry.config.reviewPrefixes=['PROD-Movies/nested'];await f.write(f.target,registry);assert.equal((await loadApprovalRegistry({...f,cfg})).cases.length,1);
 cfg.reviewPrefixes=registry.config.reviewPrefixes=[];await f.write(f.target,registry);assert.equal((await loadApprovalRegistry({...f,cfg})).cases.length,1,'an explicitly frozen empty prefix list remains valid');
});
test('changed configuration or historical state evidence fails without altering private files',async t=>{
 const f=await fixture(t);await f.write(f.target,f.registry);const before=await fs.readFile(f.target);
 f.cfg.libraryId='another-library';await assert.rejects(f.load(),/configuration differs/);f.cfg=f.registry.config;
 f.state.cases[f.a.id].approval.sourceTitle='another-release';await assert.rejects(f.load(),/historical state approval/);assert.deepEqual(await fs.readFile(f.target),before);
});
test('state cases cannot claim a different file or fingerprint than their registered approval',async t=>{
 const f=await fixture(t);await f.write(f.target,f.registry);for(const key of ['file','relative','fp','size']){const state=structuredClone(f.state);state.cases[f.a.id][key]=key==='size'?102:'changed';await assert.rejects(loadApprovalRegistry({...f,state}),/state source differs/);}
});
test('present registry preserves strictly bound imported legacy and earlier pending metadata without current authority',async t=>{
 const f=await fixture(t);await f.write(f.target,f.registry);
 for(const shape of ['legacy','pending']){
  const historical=importedHistory(f,shape),state=structuredClone(f.state);state.cases[historical.id]=historical;
  const registry=await loadApprovalRegistry({...f,state});assert.equal(registry.cases.length,1);assert.equal(registryHasApproval(registry,historical),false);assert.deepEqual(state.cases[historical.id],historical);
  const repaired=[];await processPending({approvals:registry,cfg:f.cfg,state,safeSource:async rel=>{assert.equal(rel,f.a.relative);return {p:f.cfg.mediaRoot+'/'+rel,fp:f.a.fp,size:f.a.size};},identity,phase:async(c,status,message)=>Object.assign(c,{status,message}),repair:async c=>{repaired.push(c.id);c.status='waiting_replacement';}});
  assert.deepEqual(repaired,[f.a.id]);assert.equal(state.cases[historical.id].status,'replacement_imported');assert.equal(registryHasApproval(registry,historical),false);
 }
});
test('even completed historical approvals require a present registry with every frozen mapping',async t=>{
 const f=await fixture(t),historical=importedHistory(f);f.state={cases:{[historical.id]:historical}};
 await assert.rejects(f.load(),/historical state approval/);
 for(const key of ['libraryId','sourceRoot','mediaRoot','radarrRoot','quarantineRoot','reviewRoot','reviewPrefixes']){
  const registry={version:1,config:structuredClone(f.cfg),cases:[]};delete registry.config[key];await f.write(f.target,registry);await assert.rejects(f.load(),/missing frozen library mapping/);
 }
 await f.write(f.target,{version:1,config:f.cfg,cases:[]});assert.equal((await f.load()).cases.length,0);assert.equal(registryHasApproval(await f.load(),historical),false);
});
test('historical approval metadata cannot activate another lifecycle phase or bypass an uncertain mutation',async t=>{
 const f=await fixture(t);await f.write(f.target,f.registry);
 for(const status of ['candidate','deferred_limit','manual','verifying','confirmed','holding','quarantine_intent','quarantined','blocked','waiting_replacement','replacement_queue_intent','waiting_source_kept','deferred_cooldown']){
  const historical=importedHistory(f);historical.status=status;const state={cases:{[historical.id]:historical}};await assert.rejects(loadApprovalRegistry({...f,state}),/historical state approval/);
 }
});
test('weak or mismatched imported historical identity is rejected for both known metadata shapes',async t=>{
 const f=await fixture(t);await f.write(f.target,f.registry);
 for(const shape of ['legacy','pending'])for(const change of [c=>{c.mutationStarted=0;},c=>{delete c.binding;},c=>{c.movieId++;},c=>{c.file='/media/movies/Changed/file.mkv';},c=>{delete c.relative;},c=>{c.fp+='0';},c=>{c.size++;},c=>{delete c.source;},c=>{c.source='/outside/file.mkv';},c=>{c.approval.movieFileId=0;},c=>{delete c.approval.importId;},c=>{delete c.approval.grabId;},c=>{delete c.approval.downloadId;},c=>{c.approval.authorization='';},c=>{c.binding.movieFileId++;},c=>{c.binding.sourceTitle='different release';},c=>{c.binding.downloadId='different download';},c=>{c.approval.id='f'.repeat(24);}]){
  const historical=importedHistory(f,shape);change(historical);await assert.rejects(loadApprovalRegistry({...f,state:{cases:{[historical.id]:historical}}}),{code:'RECOVERY_APPROVAL_REGISTRY'});
 }
});
test('changed evidence of a current member cannot be disguised as completed historical metadata',async t=>{
 const f=await fixture(t);await f.write(f.target,f.registry);const c=f.state.cases[f.a.id];Object.assign(c,{status:'replacement_imported',mutationStarted:1,movieId:f.a.movieId,source:f.cfg.mediaRoot+'/'+f.a.relative,binding:{sourceTitle:f.a.sourceTitle,movieFileId:f.a.movieFileId}});c.approval.authorization+=' changed';await assert.rejects(f.load(),/historical state approval/);
 delete c.approval.id;delete c.approval.checks;await assert.rejects(f.load(),/historical state approval/);
});
test('wrong IDs, traversal, size and incomplete frozen import identities fail',async t=>{
 const f=await fixture(t);for(const change of [a=>{a.id='a'.repeat(24);},a=>{a.file='/media/movies/../outside/file.mkv';},a=>{a.relative='../file.mkv';},a=>{a.size++;},a=>{a.fp='PRIVATE-FINGERPRINT';},a=>{delete a.importId;},a=>{delete a.grabId;},a=>{a.movieFileId=0;}]){
  const r=structuredClone(f.registry);change(r.cases[0]);await f.write(f.target,r);await assert.rejects(f.load(),{code:'RECOVERY_APPROVAL_REGISTRY'});
 }
});
test('timeouts, operational errors and ambiguous frozen diagnostic versions fail',async t=>{
 const f=await fixture(t);for(const change of [a=>{a.checks[0].timeout=true;},a=>{a.checks[0].sourceUnchanged='true';},a=>{a.checks[0].hostIdentityUnchanged=false;},a=>{a.checks[0].stderrTail='Permission denied';},a=>{a.checks[1].version='7.1.4';},a=>{a.checks[0].decodeMarkers=[];},a=>{a.signature='generic error';}]){
  const r=structuredClone(f.registry);change(r.cases[0]);await f.write(f.target,r);await assert.rejects(f.load(),/decode evidence/);
 }
});
test('nonregular and oversized registry files fail with no fallback',async t=>{
 const f=await fixture(t);await fs.mkdir(f.target);await assert.rejects(f.load(),/regular/);await fs.rmdir(f.target);
 await fs.writeFile(f.target,' '.repeat(2*1024*1024+1),{mode:0o600});await assert.rejects(f.load(),/size/);
});
test('registry symlinks and extra hardlinks are refused',async t=>{
 const f=await fixture(t);await f.write(f.source,f.registry);
 try{await fs.symlink(f.source,f.target);}catch(e){if(process.platform==='win32'&&['EPERM','EACCES'].includes(e.code)){t.skip('Creating symlinks needs Windows developer mode');return;}throw e;}
 await assert.rejects(f.load(),/regular/);await fs.unlink(f.target);await fs.link(f.source,f.target);await assert.rejects(f.load(),/regular/);
});
test('registry under a symlinked data directory is refused',async t=>{
 const f=await fixture(t);await f.write(f.target,f.registry);const alias=path.join(f.root,'alias');
 try{await fs.symlink(f.data,alias,process.platform==='win32'?'junction':'dir');}catch(e){if(process.platform==='win32'&&['EPERM','EACCES'].includes(e.code)){t.skip('Creating symlinks needs Windows developer mode');return;}throw e;}
 await assert.rejects(loadApprovalRegistry({...f,data:alias}),/symlinks/);
});
test('group or world writable registries are refused on Linux',async t=>{
 if(process.platform==='win32'){t.skip('POSIX mode bits are not Windows ACLs');return;}const f=await fixture(t);await f.write(f.target,f.registry);await fs.chmod(f.target,0o660);await assert.rejects(f.load(),/writable/);
});
test('offline migration preserves exact private backups and durable registry membership',async t=>{
 const f=await fixture(t),legacy={config:f.registry.config,cases:f.registry.cases};const raw=JSON.stringify(legacy,null,1)+'\n';await f.write(f.source,raw);const stateBefore=await fs.readFile(path.join(f.data,'state.json'));
 const result=await f.migrate();assert.equal(result.alreadyInstalled,false);assert.equal(result.caseCount,1);assert.match(result.registrySHA256,/^[a-f0-9]{64}$/);
 assert(!JSON.stringify(result).includes(f.a.sourceTitle));assert(!JSON.stringify(result).includes(f.a.authorization));assert(!JSON.stringify(result).includes(f.source));
 const backup=path.join(f.data,result.backupDirectory);assert.equal(await fs.readFile(path.join(backup,'pending-approvals.source.json'),'utf8'),raw);assert.deepEqual(await fs.readFile(path.join(backup,'state.json')),stateBefore);assert.deepEqual(await fs.readFile(path.join(f.data,'state.json')),stateBefore);
 assert(registryHasApproval(await f.load(),f.state.cases[f.a.id]));assert.deepEqual((await fs.readdir(f.data)).filter(n=>n.endsWith('.tmp')),[]);
 if(process.platform!=='win32'){assert.equal((await fs.stat(backup)).mode&0o777,0o700);for(const file of ['pending-approvals.source.json','state.json','manifest.json'])assert.equal((await fs.stat(path.join(backup,file))).mode&0o777,0o600);assert.equal((await fs.stat(f.target)).mode&0o777,0o600);}
});
test('identical valid migration is idempotent and does not create another backup',async t=>{
 const f=await fixture(t);await f.write(f.source,f.registry);const first=await f.migrate(),files=await fs.readdir(f.data),second=await f.migrate();assert.equal(second.alreadyInstalled,true);assert.equal(second.registrySHA256,first.registrySHA256);assert.deepEqual(await fs.readdir(f.data),files);
});
test('migration never overwrites a distinct or malformed existing target',async t=>{
 const f=await fixture(t);await f.write(f.source,f.registry);const other=structuredClone(f.registry);other.cases[0].authorization+=' different';f.state={cases:{}};await f.write(f.target,other);const before=await fs.readFile(f.target);await assert.rejects(f.migrate(),/replacement is forbidden/);assert.deepEqual(await fs.readFile(f.target),before);
 await f.write(f.target,'invalid');await assert.rejects(f.migrate(),/invalid JSON/);assert.equal(await fs.readFile(f.target,'utf8'),'invalid');
});
test('registry appearing at the exclusive installation step is preserved byte for byte',async t=>{
 const f=await fixture(t);await f.write(f.source,f.registry);const original=fs.link;let attempts=0;
 fs.link=async(from,to)=>{if(to===f.target){attempts++;await fs.writeFile(to,'CONCURRENT PRIVATE REGISTRY',{mode:0o600,flag:'wx'});}return original(from,to);};
 try{await assert.rejects(f.migrate(),/appeared during migration/);}finally{fs.link=original;}
 assert.equal(attempts,1);assert.equal(await fs.readFile(f.target,'utf8'),'CONCURRENT PRIVATE REGISTRY');assert.deepEqual((await fs.readdir(f.data)).filter(n=>n.endsWith('.tmp')),[]);
});
test('state changing after backup creation prevents registry installation',async t=>{
 const f=await fixture(t);await f.write(f.source,f.registry);const original=fs.mkdir,statePath=path.join(f.data,'state.json');let changed=false;
 fs.mkdir=async(dir,...args)=>{const result=await original(dir,...args);if(path.dirname(dir)===f.data&&path.basename(dir).startsWith('registry-migration-')){changed=true;await f.write(statePath,{...f.state,updated:'CONCURRENT-STATE'});}return result;};
 try{await assert.rejects(f.migrate(),/changed during migration/);}finally{fs.mkdir=original;}
 assert(changed);await assert.rejects(fs.stat(f.target),{code:'ENOENT'});assert.equal(JSON.parse(await fs.readFile(statePath,'utf8')).updated,'CONCURRENT-STATE');
});
test('migration cannot derive missing evidence or replace a changed state snapshot',async t=>{
 const f=await fixture(t);await f.write(f.source,{config:{},cases:[]});await assert.rejects(f.migrate(),/historical state approval/);await assert.rejects(fs.stat(f.target),{code:'ENOENT'});
 await f.write(f.source,f.registry);await f.write(path.join(f.data,'state.json'),{...f.state,updated:'changed'});await assert.rejects(f.migrate(),/state changed/);await assert.rejects(fs.stat(f.target),{code:'ENOENT'});
});
test('migration refuses a symlink source and requires absolute explicit source',async t=>{
 const f=await fixture(t);await f.write(f.source,f.registry);await assert.rejects(migrateApprovalRegistry({...f,source:'legacy.json'}),/explicit absolute/);const alias=path.join(f.root,'source-alias');
 try{await fs.symlink(f.source,alias);}catch(e){if(process.platform==='win32'&&['EPERM','EACCES'].includes(e.code)){t.skip('Creating symlinks needs Windows developer mode');return;}throw e;}
 await assert.rejects(migrateApprovalRegistry({...f,source:alias}),/regular/);await assert.rejects(fs.stat(f.target),{code:'ENOENT'});
});
test('offline CLI performs only explicit migration and does not print private evidence on failure',async t=>{
 const f=await fixture(t);await f.write(f.source,f.registry);const tool=fileURLToPath(new URL('../tools/migrate-recovery-registry.mjs',import.meta.url));
 const run=args=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[tool,...args],{env:{...process.env,RECOVERY_MODE:'repair'},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));});
 const ok=await run(['--source',f.source,'--data',f.data]);assert.equal(ok.code,0,ok.stderr);assert.equal(JSON.parse(ok.stdout).caseCount,1);assert(!ok.stdout.includes(f.a.sourceTitle));
 await f.write(f.target,'invalid SECRET-PRIVATE-EVIDENCE');const failed=await run(['--source',f.source,'--data',f.data]);assert.equal(failed.code,1);assert(!failed.stdout.includes('SECRET'));assert(!failed.stderr.includes('SECRET'));assert.equal(await fs.readFile(f.target,'utf8'),'invalid SECRET-PRIVATE-EVIDENCE');
 const missing=await run([]);assert.equal(missing.code,1);assert.equal(missing.stdout,'');
});

test('a config edit that changes a frozen registry value is reported invalid before any restart',async t=>{
 const {detectConfigChange,configDigest,startupValidator}=await import('./config-watch.mjs');
 const f=await fixture(t);await f.write(f.target,f.registry);const file=path.join(f.data,'config.json'),loaded=configDigest(await fs.readFile(file,'utf8'));
 const validate=startupValidator({data:f.data,mode:'repair',getState:()=>f.state});
 assert.equal(Object.hasOwn(f.registry.config,'pollSeconds'),false);await f.write(file,{...f.cfg,pollSeconds:600});const allowed=await detectConfigChange({file,loadedDigest:loaded,validate});assert.equal(allowed.valid,true,allowed.error);
 for(const edit of [{maxRepairsPerDay:5},{libraryId:'another-library'}]){await f.write(file,{...f.cfg,...edit});const frozen=await detectConfigChange({file,loadedDigest:loaded,validate});assert.equal(frozen.valid,false,JSON.stringify(edit));assert.equal(frozen.error,'Recovery approval registry: frozen configuration differs');}
 const {libraryId,...withoutLibrary}=f.cfg;await f.write(file,withoutLibrary);const refused=await detectConfigChange({file,loadedDigest:loaded,validate});
 assert.equal(refused.valid,false);assert.match(refused.error,/^Recovery approval registry: /);assert.doesNotMatch(refused.error,/fixture-library/,'no config value is echoed');
 assert.ok(!Object.isFrozen(f.state.cases[f.a.id]),'validation never freezes the live state');
});

test('offline CLI reads config.json with RECOVERY_MODE exactly as the worker does',async t=>{
 const tool=fileURLToPath(new URL('../tools/migrate-recovery-registry.mjs',import.meta.url));
 const run=(f,mode)=>new Promise((resolve,reject)=>{const env={...process.env};delete env.RECOVERY_MODE;if(mode!==undefined)env.RECOVERY_MODE=mode;const child=spawn(process.execPath,[tool,'--source',f.source,'--data',f.data],{env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));});
 // The registry froze enabled:true. Removing the deprecated key under RECOVERY_MODE=repair is what the docs advise.
 const {enabled,...withoutEnabled}=evidence().cfg;assert.equal(enabled,true);
 let f=await fixture(t);await f.write(f.source,f.registry);await f.write(path.join(f.data,'config.json'),withoutEnabled);
 const migrated=await run(f,'repair');assert.equal(migrated.code,0,migrated.stderr);assert.equal(JSON.parse(migrated.stdout).caseCount,1);
 // A config the worker would refuse must not be migrated either, and nothing is installed.
 for(const [mode,pattern] of [['verify',/disagrees with RECOVERY_MODE/],[undefined,/RECOVERY_MODE must be off, verify or repair/],['off',/RECOVERY_MODE is off/]]){
  f=await fixture(t);await f.write(f.source,f.registry);const refused=await run(f,mode);
  assert.notEqual(refused.code,0,String(mode));assert.match(refused.stderr,pattern);assert.doesNotMatch(refused.stderr+refused.stdout,/fixture-library|DISPOSABLE/);await assert.rejects(fs.stat(f.target),{code:'ENOENT'});
 }
});

// #77: one rule for the frozen enabled key, shared by every reader of the registry.
const verifyCfg=f=>({...f.cfg,enabled:false});
test('a registry approved for Repair also loads in Verify; one frozen to Verify still refuses Repair',async t=>{
 const f=await fixture(t);await f.write(f.target,f.registry);
 assert.equal(f.registry.config.enabled,true);
 assert.deepEqual((await loadApprovalRegistry({...f,cfg:verifyCfg(f)})).cases.length,1,'frozen enabled: true accepts Verify');
 assert.equal((await f.load()).cases.length,1,'and Repair as before');
 await f.write(f.target,{...f.registry,config:{...f.registry.config,enabled:false}});
 await assert.rejects(f.load(),/frozen configuration differs/,'frozen enabled: false refuses Repair');
 assert.equal((await loadApprovalRegistry({...f,cfg:verifyCfg(f)})).cases.length,1);
});
test('in Verify every frozen key other than enabled still requires an exact match',async t=>{
 const f=await fixture(t);await f.write(f.target,f.registry);
 for(const [k,v] of [['libraryId','another-library'],['sourceRoot','/media/other'],['mediaRoot','/storage/other'],['quarantineRoot','/storage/other-quarantine'],['reviewPrefixes',['Other']],['maxRepairsPerDay',4]]){
  await assert.rejects(loadApprovalRegistry({...f,cfg:{...verifyCfg(f),[k]:v}}),/frozen configuration differs/,k);
 }
});
test('the pending-approval loop accepts Verify against a Repair approval without running it',async t=>{
 const f=await fixture(t);let repairs=0;
 const run=cfg=>processPending({approvals:f.registry,cfg,state:f.state,safeSource:async()=>({p:'/x',fp:f.a.fp,size:f.a.size}),identity:()=>f.a.id,phase:async()=>{},repair:async()=>{repairs++;}});
 await run(verifyCfg(f));assert.equal(repairs,0,'frozen approvals never run in Verify');
 await assert.rejects(run({...verifyCfg(f),libraryId:'another-library'}),/Pending recovery mapping changed libraryId/);
 const toVerify={...f.registry,config:{...f.registry.config,enabled:false}};
 await assert.rejects(processPending({approvals:toVerify,cfg:f.cfg,state:f.state,repair:async()=>{repairs++;}}),/Pending recovery mapping changed enabled/,'a Verify approval never runs in Repair');
 assert.equal(repairs,0);
});
test('a config edit is validated with the same enabled rule as start-up',async t=>{
 const f=await fixture(t);await f.write(f.target,f.registry);
 const {enabled,...withoutEnabled}=f.cfg,file=path.join(f.data,'config.json');await f.write(file,withoutEnabled);const loaded=configDigest(await fs.readFile(file,'utf8'));
 await f.write(file,{...withoutEnabled,pollSeconds:600});
 const verify=await detectConfigChange({file,loadedDigest:loaded,validate:startupValidator({data:f.data,mode:'verify',getState:()=>f.state})});
 assert.equal(verify.valid,true,verify.error);
 await f.write(f.target,{...f.registry,config:{...f.registry.config,enabled:false}});
 const repair=await detectConfigChange({file,loadedDigest:loaded,validate:startupValidator({data:f.data,mode:'repair',getState:()=>f.state})});
 assert.equal(repair.valid,false);assert.equal(repair.error,'Recovery approval registry: frozen configuration differs');
});
test('offline migration accepts and refuses exactly the combinations the start-up gate does',async t=>{
 const tool=fileURLToPath(new URL('../tools/migrate-recovery-registry.mjs',import.meta.url));
 const run=(f,mode)=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[tool,'--source',f.source,'--data',f.data],{env:{...process.env,RECOVERY_MODE:mode},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));});
 for(const [frozen,mode,accepted] of [[true,'verify',true],[true,'repair',true],[false,'verify',true],[false,'repair',false]]){
  const label='frozen enabled: '+frozen+' in '+mode,{enabled,...withoutEnabled}=evidence().cfg,cfg={...withoutEnabled,enabled:mode==='repair'};
  const gate=await fixture(t);await gate.write(gate.target,{...gate.registry,config:{...gate.registry.config,enabled:frozen}});
  assert.equal(await loadApprovalRegistry({data:gate.data,cfg,state:gate.state}).then(()=>true,()=>false),accepted,label+' at start-up');
  const f=await fixture(t);await f.write(f.source,{...f.registry,config:{...f.registry.config,enabled:frozen}});await f.write(path.join(f.data,'config.json'),withoutEnabled);
  const migrated=await run(f,mode);
  assert.equal(migrated.code===0,accepted,label+' in migration: '+migrated.stderr);
  if(accepted)assert.equal(JSON.parse(migrated.stdout).caseCount,1,label);
  else{assert.match(migrated.stderr,/frozen configuration differs/,label);await assert.rejects(fs.stat(f.target),{code:'ENOENT'});}
 }
});
