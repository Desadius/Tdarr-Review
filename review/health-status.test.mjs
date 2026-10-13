import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {isLoopback,recoveryStatusHealth,healthSummary} from './health-status.mjs';
import {RECOVERY_STALE_MS} from './public/review-model.js';

const NOW=Date.parse('2026-10-13T12:00:00Z');

test('only loopback addresses may read the health summary',()=>{
 for(const address of ['127.0.0.1','::1','::ffff:127.0.0.1'])assert.equal(isLoopback(address),true);
 for(const address of ['192.168.2.90','::ffff:192.168.2.90','172.17.0.1','127.0.0.2',undefined])assert.equal(isLoopback(address),false);
});

test('Recovery status freshness uses the same 12-minute limit as the UI',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'health-status-'));const file=path.join(root,'.tdarr-recovery-status.json');
 try{
  assert.deepEqual(await recoveryStatusHealth(file,NOW),{present:false,stale:false});
  await fs.writeFile(file,JSON.stringify({version:1,updated:new Date(NOW-RECOVERY_STALE_MS).toISOString(),cases:[]}));
  assert.equal((await recoveryStatusHealth(file,NOW)).stale,false);
  assert.equal((await recoveryStatusHealth(file,NOW+1)).stale,true);
  await fs.writeFile(file,JSON.stringify({version:1,cases:[]}));
  assert.deepEqual(await recoveryStatusHealth(file,NOW),{present:true,stale:true,error:'missing update time'});
  await fs.writeFile(file,'{"radarrApiKey":"SECRET"');
  const broken=await recoveryStatusHealth(file,NOW);assert.equal(broken.stale,true);assert.doesNotMatch(JSON.stringify(broken),/SECRET/);
 }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('the summary flags operator conditions but always stays ok',()=>{
 const fresh={present:true,updated:'2026-10-13T12:00:00.000Z',stale:false};
 assert.deepEqual(healthSummary({pendingTransactions:0,restorePending:0,recoveryStatus:fresh}),{ok:true,attention:[],pendingTransactions:0,restorePending:0,recoveryStatus:fresh});
 assert.deepEqual(healthSummary({pendingTransactions:0,restorePending:0,recoveryStatus:{present:false,stale:false}}).attention,[],'Recovery not installed is not a problem');
 const all=healthSummary({pendingTransactions:1,restorePending:2,recoveryStatus:{...fresh,stale:true}});
 assert.equal(all.ok,true);assert.deepEqual(all.attention,['pending-transaction','node-restore-pending','recovery-status-stale']);
});

test('server serves /health before authentication to loopback only; the health check reports without failing',async()=>{
 const server=await fs.readFile(new URL('./server.mjs',import.meta.url),'utf8');
 const health=server.indexOf("if(url.pathname==='/health'&&req.method==='GET'){"),auth=server.indexOf("if(url.pathname.startsWith('/api/')&&!authenticated(ctx,req))");
 assert.ok(health>0&&health<auth);
 assert.match(server.slice(health,health+400),/if\(!isLoopback\(req\.socket\.remoteAddress\)\)return respond\(res,404/);
 assert.ok(server.indexOf("if(req.headers.host!==HOST)")<health,'Host check still applies');
 const check=await fs.readFile(new URL('./healthcheck.mjs',import.meta.url),'utf8');
 assert.match(check,/path:'\/health'/);assert.match(check,/if\(response\.statusCode!==200\)process\.exit\(1\)/);
 assert.doesNotMatch(check,/attention[^\n]*process\.exit\(1\)/);
});
