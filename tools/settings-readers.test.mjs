import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {defaults} from '../review/config.mjs';
import {createSharedSettingsStore} from '../review/shared-settings.mjs';

test('healthcheck executable uses the committed Host and never falls back from corrupt managed authority',async t=>{
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'settings-health-reader-')),requests=[];let expected;
 const server=http.createServer((req,res)=>{requests.push({host:req.headers.host,path:req.url});if(req.headers.host!==expected){res.writeHead(403);res.end();return;}res.end(req.url==='/health'?'{}':'synthetic UI');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));await fs.rm(data,{recursive:true,force:true});});
 const port=server.address().port,legacy='legacy.invalid:'+port,active='active.invalid:'+port;
 await fs.writeFile(path.join(data,'settings.json'),JSON.stringify(defaults({PUBLIC_ORIGIN:'http://'+legacy})));
 const store=createSharedSettingsStore({data,env:{RECOVERY_MODE:'off'}}),initial=await store.current(),draft=await store.saveDraft({revision:initial.revision,patch:{review:{publicOrigin:'http://'+active}}});await store.applyGeneration({revision:draft.revision});
 const run=()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[fileURLToPath(new URL('../review/healthcheck.mjs',import.meta.url))],{env:{...process.env,DATA_ROOT:data,PORT:String(port),PUBLIC_ORIGIN:'http://'+legacy},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.on('error',reject);child.on('close',code=>resolve({code,output}));});
 expected=active;const healthy=await run();assert.equal(healthy.code,0,healthy.output);assert.deepEqual(requests.map(r=>r.host),[active,active,active]);
 expected=legacy;const before=requests.length;await fs.writeFile(path.join(data,'shared-settings.json'),'{"private":"SYNTHETIC-CORRUPT-SECRET",');const refused=await run();assert.equal(refused.code,1);assert.equal(requests.length,before,'corrupt authority must not probe the legacy endpoint');assert.equal(refused.output.includes('SYNTHETIC-CORRUPT-SECRET'),false);
});
