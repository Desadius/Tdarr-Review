import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {serverHarness,linuxServer} from './test-helpers/server.mjs';

// An open client connection, such as a browser tab streaming a preview, must not hold the stop until the
// container runtime kills Review (exit 137 on 2.4.0).
test('stopping Review closes a connection that is still in the middle of a request',linuxServer,async t=>{
 const f=await serverHarness();t.after(()=>f.close());
 await f.start();
 const socket=net.connect(f.port,'127.0.0.1');t.after(()=>socket.destroy());
 await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject)});
 socket.on('error',()=>{});
 // Headers without their final blank line: the request has begun and never completes.
 socket.write('GET /api/items HTTP/1.1\r\nHost: 127.0.0.1\r\n');
 await new Promise(resolve=>setTimeout(resolve,200));
 const closed=new Promise(resolve=>socket.once('close',resolve));
 const started=Date.now();await f.stop();
 assert.ok(Date.now()-started<15000,'Review stopped within its grace period');
 await closed;
});
