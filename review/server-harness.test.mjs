import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {serverHarness,linuxServer} from './test-helpers/server.mjs';

// Another process trying to bind the harness port, as in the EADDRINUSE flake (#191).
const competitor=(port,host)=>new Promise(resolve=>{const s=net.createServer();s.once('error',e=>resolve(e.code));s.listen(port,host,()=>s.close(()=>resolve('bound')))});

test('the harness port stays held from reservation through start and restart; the server listens on loopback',linuxServer,async t=>{
 const f=await serverHarness();t.after(()=>f.close());
 for(const host of ['127.0.0.1','0.0.0.0'])assert.equal(await competitor(f.port,host),'EADDRINUSE','reserved before start: '+host);
 await f.start();assert.match(await f.login(),/=/);
 assert.equal(await competitor(f.port,'127.0.0.1'),'EADDRINUSE','running');
 let attempts=0,stolen=false,stopping=true;
 const race=(async()=>{while(stopping){attempts++;await new Promise(resolve=>setImmediate(resolve));if(await competitor(f.port,'127.0.0.1')!=='EADDRINUSE')stolen=true}})();
 try{await f.stop();assert.equal(await competitor(f.port,'0.0.0.0'),'EADDRINUSE','held between stop and start');await f.start();}
 finally{stopping=false;await race}
 assert.equal(stolen,false,`the port was free during a restart (${attempts} attempts)`);assert.ok(attempts>0);
 assert.match(await f.login(),/=/,'the restarted server answers on the same port');
 const nonLoopback=Object.values((await import('node:os')).networkInterfaces()).flat().find(a=>a?.family==='IPv4'&&!a.internal);
 if(nonLoopback)await assert.rejects(new Promise((resolve,reject)=>{const s=net.connect(f.port,nonLoopback.address,()=>{s.destroy();resolve()});s.once('error',reject)}),{code:'ECONNREFUSED'},'not reachable outside loopback');
});
