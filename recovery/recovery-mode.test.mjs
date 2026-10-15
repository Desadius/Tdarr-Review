import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {REFUSED_EXIT,RecoveryRefusal,resolveRecoveryConfig,readRecoveryConfig} from './recovery-mode.mjs';

const refused=reason=>e=>e instanceof RecoveryRefusal&&e.reason===reason;

test('verify and repair are the only modes a worker accepts',()=>{
 assert.equal(resolveRecoveryConfig({mode:'verify',text:'{}'}).mode,'verify');
 assert.equal(resolveRecoveryConfig({mode:'repair',text:'{}'}).mode,'repair');
 assert.throws(()=>resolveRecoveryConfig({mode:'off',text:'{}'}),refused('mode-off'));
 for(const mode of [undefined,'','Repair','REPAIR',' repair','true','enabled','dry_run'])assert.throws(()=>resolveRecoveryConfig({mode,text:'{}'}),refused('invalid-mode'),String(mode));
});

test('the mode alone decides whether repairs are allowed',()=>{
 assert.equal(resolveRecoveryConfig({mode:'verify',text:'{"libraryId":"x"}'}).cfg.enabled,false);
 assert.equal(resolveRecoveryConfig({mode:'repair',text:'{"libraryId":"x"}'}).cfg.enabled,true);
 assert.deepEqual(resolveRecoveryConfig({mode:'repair',text:'{"enabled":true,"libraryId":"x"}'}).cfg,{enabled:true,libraryId:'x'});
 assert.deepEqual(resolveRecoveryConfig({mode:'verify',text:'{"enabled":false}'}).cfg,{enabled:false});
});

test('an enabled key that disagrees with the mode refuses; a malformed one is invalid',()=>{
 assert.throws(()=>resolveRecoveryConfig({mode:'verify',text:'{"enabled":true}'}),refused('mode-conflict'));
 assert.throws(()=>resolveRecoveryConfig({mode:'repair',text:'{"enabled":false}'}),refused('mode-conflict'));
 for(const text of ['{"enabled":"true"}','{"enabled":null}','{"enabled":1}','[]','null','"x"','{','']){
  assert.throws(()=>resolveRecoveryConfig({mode:'repair',text}),refused('invalid-config'),text);
 }
});

test('the mode is checked before the configuration',()=>{
 assert.throws(()=>resolveRecoveryConfig({mode:'nope',text:'{'}),refused('invalid-mode'));
});

test('a missing or unreadable config.json is a named refusal',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'recovery-mode-'));
 try{
  await assert.rejects(readRecoveryConfig({file:path.join(dir,'config.json'),mode:'verify'}),refused('missing-config'));
  await assert.rejects(readRecoveryConfig({file:path.join(dir,'config.json'),mode:'off'}),refused('mode-off'));
  await assert.rejects(readRecoveryConfig({file:dir,mode:'verify'}),refused('unreadable-config'));
  await fs.writeFile(path.join(dir,'config.json'),'{"enabled":false}');
  const loaded=await readRecoveryConfig({file:path.join(dir,'config.json'),mode:'verify'});
  assert.equal(loaded.text,'{"enabled":false}');assert.deepEqual(loaded.cfg,{enabled:false});
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

// The actual worker process: every refusal exits 78 before any loopback API request,
// and its last stderr line names only the reason, never a configuration key or value.
async function refusal({mode,config,configDirectory=false,registry}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'recovery-refusal-')),data=path.join(root,'data');await fs.mkdir(data);
 const requests=[];const server=http.createServer((req,res)=>{requests.push(req.url);res.writeHead(500);res.end();});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  if(configDirectory)await fs.mkdir(path.join(data,'config.json'));
  if(registry!==undefined)await fs.writeFile(path.join(data,'pending-approvals.json'),JSON.stringify(registry),{mode:0o600});
  if(config!==undefined)await fs.writeFile(path.join(data,'config.json'),typeof config==='string'?config:JSON.stringify({radarrUrl:base,tdarrUrl:base,radarrApiKey:'fixture-secret-key',libraryId:'fixture-library',database:path.join(root,'missing.sqlite'),pollSeconds:300,...config}));
  const env={...process.env,DATA_ROOT:data};delete env.RECOVERY_MODE;if(mode!==undefined)env.RECOVERY_MODE=mode;
  const exit=await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,[fileURLToPath(new URL('./worker.mjs',import.meta.url)),'--once'],{env,stdio:['ignore','pipe','pipe']});
   let stdout='',stderr='';const timer=setTimeout(()=>child.kill('SIGKILL'),20000);
   child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);
   child.on('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,stdout,stderr});});
  });
  return {...exit,requests,files:(await fs.readdir(data)).sort()};
 }finally{await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});}
}

for(const [name,setup,reason] of [
 ['a missing mode',{config:{}},'invalid-mode'],
 ['an invalid mode',{mode:'Repair',config:{}},'invalid-mode'],
 ['mode off',{mode:'off',config:{}},'mode-off'],
 ['enabled true in verify mode',{mode:'verify',config:{enabled:true}},'mode-conflict'],
 ['enabled false in repair mode',{mode:'repair',config:{enabled:false}},'mode-conflict'],
 ['a non-boolean enabled',{mode:'repair',config:{enabled:'true'}},'invalid-config'],
 ['a missing config.json',{mode:'verify'},'missing-config'],
 ['a config.json that cannot be read',{mode:'verify',configDirectory:true},'unreadable-config'],
 ['config.json that is not JSON',{mode:'verify',config:'{"radarrApiKey":"fixture-secret-key"'},'invalid-config'],
 ['config.json that is not an object',{mode:'repair',config:'["fixture-secret-key"]'},'invalid-config'],
 ['an approval registry that does not match',{mode:'verify',config:{},registry:{version:99,config:{radarrApiKey:'fixture-secret-key'},cases:[]}},'registry-refused'],
 ['Repair against an approval registry frozen to Verify',{mode:'repair',config:{},registry:{version:1,config:{enabled:false},cases:[]}},'registry-refused'],
 ['an approval registry frozen to a non-boolean enabled',{mode:'verify',config:{},registry:{version:1,config:{enabled:'true'},cases:[]}},'registry-refused'],
]){
 test('the actual worker refuses '+name+' with exit 78 and RECOVERY_REFUSED '+reason,async()=>{
  const r=await refusal(setup);
  assert.equal(r.signal,null,r.stderr);assert.equal(r.code,REFUSED_EXIT,r.stderr);
  assert.equal(r.stderr.trimEnd().split('\n').at(-1),'RECOVERY_REFUSED '+reason);
  assert.deepEqual(r.requests,[],'refusal must happen before any API request');
  assert.deepEqual(r.files,[...(setup.config===undefined&&!setup.configDirectory?[]:['config.json']),...(setup.registry===undefined?[]:['pending-approvals.json'])],'a refusing worker writes nothing');
  for(const leaked of ['fixture-secret-key','radarrApiKey','fixture-library','127.0.0.1'])assert.ok(!(r.stdout+r.stderr).includes(leaked),'output leaks '+leaked);
 });
}

test('the reason line still arrives last when stderr is backed up at the moment of refusal',async()=>{
 // On Linux a full pipe queues the rest of a write, and an immediate process.exit dropped it, so the
 // reason never arrived (seen in CI). Windows pipes block instead, so there this only pins the order.
 const module=new URL('./recovery-mode.mjs',import.meta.url).href;
 const script=`import {RecoveryRefusal,exitRefused} from ${JSON.stringify(module)};process.stderr.write('x'.repeat(8*1024*1024)+'\\n');exitRefused(new RecoveryRefusal('mode-conflict'));`;
 const exit=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--input-type=module','-e',script],{stdio:['ignore','pipe','pipe']});
  let stderr='';const timer=setTimeout(()=>child.kill('SIGKILL'),20000);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);
  child.on('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,stderr});});
 });
 assert.equal(exit.code,REFUSED_EXIT);assert.equal(exit.stderr.trimEnd().split('\n').at(-1),'RECOVERY_REFUSED mode-conflict');
});
