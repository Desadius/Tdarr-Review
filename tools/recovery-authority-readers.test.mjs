import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readRecoveryConfiguration,resolveRecoveryConfig} from '../recovery/recovery-authority.mjs';
import {startupValidator} from '../recovery/config-watch.mjs';
import {createWorker} from '../recovery/create-worker.mjs';
import {main as migrateRegistry} from './migrate-recovery-registry.mjs';
import {createSharedSettingsStore,readActiveSettings} from '../review/shared-settings.mjs';
import {writeSettingsActivation} from '../review/settings-activation.mjs';

// Every reader of Recovery's configuration and approval registry (docs/ARCHITECTURE.md, "Readers of
// config.json and the approval registry") must give the same verdict for the same files. One table of
// cases runs against each reader that can see that case: `config` is the verdict on the configuration
// alone, `authority` the verdict once the approval registry is checked too. A verdict is "ok" or the
// refusal reason a refused worker prints after RECOVERY_REFUSED.
const root=fileURLToPath(new URL('../',import.meta.url));
const {enabled:_,...base}=JSON.parse(await fs.readFile(path.join(root,'fixtures/recovery-config-1.11.json'),'utf8'));
Object.assign(base,{tdarrUrl:'http://127.0.0.1:9',radarrUrl:'http://127.0.0.1:9',radarrApiKey:'synthetic-reader-key',libraryId:'reader-library'});
const frozen=config=>({version:1,config,cases:[]});
const STATE_CASE='d'.repeat(24);

const cases=[
 {name:'legacy, Verify',mode:'verify',legacy:base,config:'ok',authority:'ok'},
 {name:'legacy, Repair',mode:'repair',legacy:base,config:'ok',authority:'ok'},
 {name:'legacy, Off',mode:'off',legacy:base,config:'mode-off',authority:'mode-off'},
 {name:'legacy, unknown mode',mode:'fix',legacy:base,config:'invalid-mode',authority:'invalid-mode'},
 {name:'legacy, missing config.json',mode:'verify',legacy:null,config:'missing-config',authority:'missing-config'},
 {name:'legacy, not JSON',mode:'verify',legacy:'{"stableMinutes":',config:'invalid-config',authority:'invalid-config'},
 {name:'legacy, enabled as text',mode:'verify',legacy:{...base,enabled:'false'},config:'invalid-config',authority:'invalid-config'},
 {name:'legacy, enabled conflicts with Verify',mode:'verify',legacy:{...base,enabled:true},config:'mode-conflict',authority:'mode-conflict'},
 {name:'legacy, enabled matches Repair',mode:'repair',legacy:{...base,enabled:true},config:'ok',authority:'ok'},
 {name:'legacy, unusable value',mode:'verify',legacy:{...base,stableMinutes:'10 min'},config:'invalid-config',authority:'invalid-config'},
 {name:'legacy, missing setting',mode:'repair',legacy:(({pollSeconds,...rest})=>rest)(base),config:'invalid-config',authority:'invalid-config'},
 {name:'legacy, registry frozen for Verify, Repair',mode:'repair',legacy:base,registry:frozen({enabled:false}),config:'ok',authority:'registry-refused'},
 {name:'legacy, registry frozen for Repair, Verify',mode:'verify',legacy:base,registry:frozen({enabled:true}),config:'ok',authority:'ok'},
 {name:'legacy, registry frozen to another media root',mode:'verify',legacy:base,registry:frozen({mediaRoot:'/elsewhere'}),config:'ok',authority:'registry-refused'},
 {name:'legacy, historical approval in state without a registry',mode:'verify',legacy:base,stateApproval:true,config:'ok',authority:'registry-refused'},
 {name:'managed, Verify',mode:'verify',managed:true,config:'ok',authority:'ok'},
 {name:'managed, Repair',mode:'repair',managed:true,config:'ok',authority:'ok'},
 // After Apply the generation is the authority: an edit of config.json outside the private exceptions changes nothing.
 // Review's Apply is not asked: it first wants the outside edit resolved explicitly (legacyFiles), whatever its content.
 {name:'managed, config.json edited after Apply',mode:'verify',managed:true,legacyEdit:{stableMinutes:'10 min'},except:['Review settings Apply'],config:'ok',authority:'ok'},
 {name:'managed, corrupt authority',mode:'verify',managed:true,corrupt:true,config:'invalid-config',authority:'invalid-config'},
 {name:'managed, stale private exception',mode:'verify',managed:true,staleException:true,config:'invalid-config',authority:'invalid-config'},
 {name:'managed, registry frozen to another media root',mode:'verify',managed:true,registryAfterApply:frozen({mediaRoot:'/elsewhere'}),config:'ok',authority:'registry-refused'},
 {name:'managed, registry frozen for Verify, Repair',mode:'repair',managed:true,registryAfterApply:frozen({enabled:false}),config:'ok',authority:'registry-refused'},
 // Only the starting worker honours an interrupted activation; the other readers read without resuming it.
 {name:'managed, interrupted activation',mode:'verify',managed:true,interrupted:true,only:['worker process'],config:'invalid-config',authority:'invalid-config'},
];

async function setup(c){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'recovery-readers-')),data=path.join(dir,'recovery');
 await fs.mkdir(data,{recursive:true});
 const config={...base,mediaRoot:path.join(dir,'media/movies'),reviewRoot:path.join(dir,'review'),quarantineRoot:path.join(dir,'media/.tdarr-corrupt'),database:path.join(dir,'missing.db'),reports:path.join(dir,'reports')};
 const legacy=c.managed?config:c.legacy&&typeof c.legacy==='object'?{...c.legacy,...Object.fromEntries(['mediaRoot','reviewRoot','quarantineRoot','database','reports'].map(k=>[k,config[k]]))}:c.legacy;
 if(legacy!==null)await fs.writeFile(path.join(data,'config.json'),typeof legacy==='string'?legacy:JSON.stringify(legacy),{mode:0o600});
 await fs.writeFile(path.join(data,'state.json'),JSON.stringify({version:1,jobs:{},cases:c.stateApproval?{[STATE_CASE]:{id:STATE_CASE,status:'manual',approval:{id:STATE_CASE}}}:{}}),{mode:0o600});
 const registry=c.registry&&{...c.registry,config:remap(c.registry.config,config)};
 if(registry)await fs.writeFile(path.join(data,'pending-approvals.json'),JSON.stringify(registry),{mode:0o600});
 if(c.managed){
  const store=createSharedSettingsStore({data:dir,env:{RECOVERY_MODE:c.mode}}),current=await store.current();await store.applyGeneration({revision:current.revision});
  if(c.corrupt)await fs.writeFile(path.join(dir,'shared-settings.json'),'{"version":1,',{mode:0o600});
  if(c.legacyEdit)await fs.writeFile(path.join(data,'config.json'),JSON.stringify({...legacy,...c.legacyEdit}),{mode:0o600});
  if(c.staleException)await fs.writeFile(path.join(data,'config.json'),JSON.stringify({...legacy,approvedCaseIds:['revoked-after-apply']}),{mode:0o600});
  if(c.interrupted)await writeSettingsActivation(dir,{id:'00000000-0000-4000-8000-000000000000',state:'interrupted',stage:'interrupted',blocking:true,generation:1,updated:new Date().toISOString()});
  if(c.registryAfterApply)await fs.writeFile(path.join(data,'pending-approvals.json'),JSON.stringify({...c.registryAfterApply,config:remap(c.registryAfterApply.config,config)}),{mode:0o600});
 }
 return {dir,data,config,registry:registry||c.registryAfterApply&&{...c.registryAfterApply,config:remap(c.registryAfterApply.config,config)},cleanup:()=>fs.rm(dir,{recursive:true,force:true})};
}
// Frozen roots in the table are written for the synthetic paths of each temporary installation.
function remap(frozenConfig,config){return Object.fromEntries(Object.entries(frozenConfig).map(([k,v])=>[k,v==='/elsewhere'?v:Object.hasOwn(config,k)&&typeof v==='string'&&v.startsWith('/')?config[k]:v]));}

// A message from a reader that reports text instead of a reason, mapped to the refusal reason it names.
function reasonOf(message){
 if(/RECOVERY_MODE is off/.test(message))return 'mode-off';
 if(/RECOVERY_MODE must be/.test(message))return 'invalid-mode';
 if(/disagrees with RECOVERY_MODE/.test(message))return 'mode-conflict';
 if(/does not exist/.test(message))return 'missing-config';
 if(/must be a JSON object|managed settings/.test(message))return 'invalid-config';
 return 'registry-refused';
}

const readers={
 // The worker process itself: exit 78 with RECOVERY_REFUSED <reason>, or a started poll.
 'worker process':{scope:'authority',run:async(f,c)=>{
  const result=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(root,'recovery/worker.mjs'),'--once'],{env:{...process.env,DATA_ROOT:f.data,RECOVERY_MODE:c.mode},stdio:['ignore','pipe','pipe']});let output='';const timer=setTimeout(()=>child.kill('SIGKILL'),20000);child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.on('error',reject);child.on('close',code=>{clearTimeout(timer);resolve({code,output});});});
  if(result.code===78)return /RECOVERY_REFUSED (\S+)\s*$/.exec(result.output)[1];
  assert.equal(result.code,0,result.output);assert.match(result.output,/Tdarr recovery started/);return 'ok';
 }},
 // The offline registry migration utility, installing the case's registry (or the empty example).
 'registry migration':{scope:'authority',run:async(f,c)=>{
  const source=path.join(f.dir,'source-registry.json');await fs.writeFile(source,JSON.stringify(f.registry||frozen({})),{mode:0o600});
  try{await migrateRegistry(['--source',source,'--data',f.data],{RECOVERY_MODE:c.mode});return 'ok';}
  catch(e){return e.reason||(e.code==='RECOVERY_APPROVAL_REGISTRY'?'registry-refused':reasonOf(e.message));}
 }},
 // The running worker's check of a later config.json edit (legacy configuration, valid JSON object).
 'config.json edit check':{scope:'authority',applies:c=>!c.managed&&c.legacy&&typeof c.legacy==='object',run:async(f,c)=>{
  const value=JSON.parse(await fs.readFile(path.join(f.data,'config.json'),'utf8'));
  const state=JSON.parse(await fs.readFile(path.join(f.data,'state.json'),'utf8'));
  const error=await startupValidator({data:f.data,mode:c.mode,getState:()=>state})(value);
  return error===null?'ok':reasonOf(error);
 }},
 // The running worker's check of a changed managed generation (it reports valid or not, without a reason).
 'managed generation change':{scope:'authority',applies:c=>c.managed&&['verify','repair'].includes(c.mode),run:async(f,c)=>{
  const state={version:1,jobs:{},cases:{}};
  const worker=createWorker({data:f.data,mode:c.mode,cfg:{...f.config,enabled:c.mode==='repair'},configText:'loaded before the change',managed:true,state,pendingApprovals:frozen({}),canStart:()=>true});
  await worker.noteConfigChange();return state.configChange.valid?'ok':'refused';
 }},
 // Review's reader of the active managed generation, as Recovery uses it (strict).
 'Review active generation':{scope:'config',applies:c=>c.managed&&['verify','repair'].includes(c.mode),run:async(f,c)=>{
  try{await readActiveSettings(f.dir,{mode:c.mode});return 'ok';}catch{return 'invalid-config';}
 }},
 // Review's read-only Recovery diagnosis obtains its effective configuration only through the Recovery authority.
 'Review diagnosis effective configuration':{scope:'config',run:async(f,c)=>{
  try{await readRecoveryConfiguration({data:f.data,mode:c.mode});return 'ok';}catch(e){return e.reason||reasonOf(e.message);}
 }},
 // Review's settings Apply of the same configuration: it builds a generation in which RECOVERY_MODE alone
 // sets enabled, so it judges the registry for a configuration that is otherwise accepted.
 'Review settings Apply':{scope:'authority',applies:c=>c.config==='ok'&&['verify','repair'].includes(c.mode),run:async(f,c)=>{
  const store=createSharedSettingsStore({data:f.dir,env:{RECOVERY_MODE:c.mode}});
  try{await store.applyGeneration({revision:(await store.current()).revision});return 'ok';}
  catch(e){return ['settings_frozen','settings_registry_invalid'].includes(e.code)?'registry-refused':'invalid-config';}
 }},
 // The documented pre-update check of a config.json text (docs/CONFIGURATION.md).
 'pre-update check':{scope:'config',applies:c=>!c.managed&&c.legacy!==null&&['verify','repair'].includes(c.mode),run:async(f,c)=>{
  try{resolveRecoveryConfig({mode:c.mode,text:await fs.readFile(path.join(f.data,'config.json'),'utf8')});return 'ok';}catch(e){return e.reason;}
 }},
};

for(const [readerName,reader] of Object.entries(readers)){
 test('the '+readerName+' gives every applicable case the shared verdict',{skip:process.platform==='win32'&&'POSIX roots'},async()=>{
  let applicable=0;
  for(const c of cases){
   if(c.only&&!c.only.includes(readerName)||c.except?.includes(readerName)||reader.applies&&!reader.applies(c))continue;
   applicable++;
   const f=await setup(c);
   try{
    const actual=await reader.run(f,c),expected=c[reader.scope];
    if(actual==='refused')assert.notEqual(expected,'ok',c.name);else assert.equal(actual,expected,c.name);
   }finally{await f.cleanup();}
  }
  assert.ok(applicable>0);
 });
}
