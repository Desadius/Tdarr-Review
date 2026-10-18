import test from 'node:test';
import assert from 'node:assert/strict';
import {startDemo,testFrame,scenario} from './demo-ui.mjs';

test('the synthetic test frame is a PNG of the requested size',()=>{
 const png=Buffer.from(testFrame(320,180),'base64');
 assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
 assert.equal(png.subarray(12,16).toString(),'IHDR');assert.equal(png.readUInt32BE(16),320);assert.equal(png.readUInt32BE(20),180);
});

test('the demo serves the real UI with synthetic data on loopback only',async()=>{
 const demo=await startDemo();
 try{
  assert.match(demo.base,/^http:\/\/127\.0\.0\.1:\d+$/);assert.equal(demo.host,'127.0.0.1','listens on loopback only');
  const page=await (await fetch(demo.base+'/')).text();
  assert.match(page,/<dialog id="filmDetail"/);assert.doesNotMatch(page,/__APP_VERSION__/);assert.match(page,/\?v=demo/);
  // Every module and stylesheet the UI references is served.
  const seen=new Set(),queue=['/'];
  while(queue.length){const route=queue.shift(),text=await (await fetch(demo.base+route)).text();
   for(const [,url] of text.matchAll(/(?:from\s*|import\s*\(\s*|src=|href=)["'](\/[^"']+\.(?:js|css))(?:\?[^"']*)?["']/g))if(!seen.has(url)){seen.add(url);const r=await fetch(demo.base+url);assert.equal(r.status,200,url);queue.push(url)}}
  assert.ok(seen.has('/app.js')&&seen.has('/review-workflow.js')&&seen.has('/style.css'),[...seen].join(' '));
  const items=await (await fetch(demo.base+'/api/items')).json(),data=scenario();
  assert.equal(items.items.length,data.items.length);assert.ok(items.items.every(x=>/^[a-f0-9]{24}$/.test(x.id)&&/^[a-f0-9]{64}$/.test(x.snapshot)));
  assert.ok(items.items.some(x=>x.status==='blocked'));assert.equal(Object.keys(items.approvals).length,1);assert.equal(items.reviewSessions[items.items[4].id].complete,true);
  const frames=await (await fetch(demo.base+'/api/items/'+items.items[0].id+'/frames',{method:'POST',body:'{}'})).json();
  assert.ok(Buffer.from(frames.original,'base64').subarray(1,4).toString()==='PNG'&&frames.review!==frames.original);
  assert.equal((await fetch(demo.base+'/api/settings')).status,404,'no other API is emulated');
  assert.equal((await fetch(demo.base+'/..%2Fpackage.json')).status,404,'only files of review/public are served');
  assert.equal((await fetch(demo.base+'/server.mjs')).status,404);
 }finally{await demo.close()}
});
