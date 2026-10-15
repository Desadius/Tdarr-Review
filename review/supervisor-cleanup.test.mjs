import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

for(const delay of ['0','400'])for(const fail of ['no','yes'])test('supervisor teardown removes its root after '+(fail==='yes'?'an assertion failure':'a passing test')+' (stand-ins delayed '+delay+' ms)',{skip:process.platform!=='linux'?'Requires Linux process groups and /proc':false},async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'supervisor-cleanup-'));
 t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 const env={...process.env,TMPDIR:directory,SUPERVISOR_CLEANUP_FAIL:fail,SUPERVISOR_TEST_DELAY_MS:delay};
 delete env.NODE_TEST_CONTEXT;
 const child=spawn(process.execPath,['--test','--test-reporter=tap',fileURLToPath(new URL('../fixtures/supervisor-cleanup.mjs',import.meta.url))],{env,stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
 assert.equal(code,fail==='yes'?1:0,output);
 if(fail==='yes')assert.match(output,/intentional fixture assertion failure/);
 const fixture=JSON.parse(output.match(/FIXTURE (\{[^\n]+\})/)[1]);
 // Orphaned processes can remain as zombies until PID 1 reaps them; they cannot write files.
 for(const pid of fixture.pids){
  const stat=await fs.readFile('/proc/'+pid+'/stat','utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if(stat!==null)assert.equal(stat.slice(stat.lastIndexOf(')')+2).split(' ')[0],'Z','fixture process '+pid+' is still running');
 }
 assert.deepEqual(await fs.readdir(directory),[],'the test must remove its own temporary root');
});

// A short-lived detached descendant retains the real output pipes after the supervisor exits.
test('supervisor teardown keeps its files until the output pipes close',{skip:process.platform!=='linux'?'Requires Linux process groups':false},async t=>{
 const {start,stop,waitFor}=await import('./test-supervisor-helpers.mjs');
 const writer="setTimeout(()=>{require('node:fs').statSync(require('node:path').dirname(process.env.STAND_IN_EVENTS));console.log('ROOT_PRESENT');},500)";
 const command="require('node:child_process').spawn(process.execPath,['-e',"+JSON.stringify(writer)+"],{detached:true,stdio:'inherit'});require('node:fs').writeFileSync(process.env.STAND_IN_EVENTS+'.ready','ready');setInterval(()=>{},1000)";
 const run=await start({mode:'off',reviewCommand:[process.execPath,'-e',command]});
 t.after(()=>stop(run));
 await waitFor(()=>fs.stat(path.join(run.root,'events.log.ready')));
 await stop(run);
 assert.match(run.output(),/ROOT_PRESENT/,'the descendant must finish using its files before teardown returns');
 await assert.rejects(fs.stat(run.root),{code:'ENOENT'});
});
