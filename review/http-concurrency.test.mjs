import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {deadline} from './test-helpers/server.mjs';
import {reviewFixture as fixture} from './test-helpers/review-fixture.mjs';
import {hash,sha256} from './core.mjs';

// The server's configured paths, executable fixtures and durable directory
// fsync require its supported Linux platform. No real media/API is contacted.
const linux={skip:process.platform!=='linux'?'Requires Linux directory fsync and executable fixture semantics':false,timeout:60000};
for(const different of [false,true])test(`HTTP simultaneous approvals (${different?'different items':'same item'}) start exactly one transaction`,linux,async()=>{
 const f=await fixture();try{
  const list=(await f.items()).items,a=list.find(item=>item.title==='A'),b=list.find(item=>item.title==='B');await f.confirm(a);await f.confirm(b);
  const gate=f.hold('/api/v2/update-node',body=>body.data.nodeUpdates.nodePaused);
  const results=await Promise.all([f.approve(a),f.approve(different?b:a)]);assert.deepEqual(results.map(result=>result.status).sort(),[202,409]);await deadline(gate.entered,'approval dispatch pause');
  assert.deepEqual(await f.journals(),[],'only the winning action reaches its dispatch pause');gate.release();
  const finished=await f.settled(1);assert.equal(finished.history[0].status,'success',JSON.stringify(finished.history));assert.equal((await f.journals()).length,1);assert.deepEqual(f.changes,[true,false]);
  const winner=f.files.get(finished.history[0].title);assert.equal(await sha256(winner.original),hash(Buffer.alloc(32,finished.history[0].title.charCodeAt(0)+32)));await assert.rejects(fs.stat(winner.review),{code:'ENOENT'});
 }finally{await f.close()}
});

test('HTTP every mutating route is excluded during an approval; read-only previews preserve confirmations',linux,async()=>{
 const f=await fixture();try{
  const list=(await f.items()).items,a=list.find(item=>item.title==='A'),b=list.find(item=>item.title==='B');await f.confirm(a);const session=await f.confirm(b);
  const gate=f.hold('/api/v2/update-node',body=>body.data.nodeUpdates.nodePaused);assert.equal((await f.approve(a)).status,202);await deadline(gate.entered,'approval dispatch pause');
  for(const [route,body] of f.allMutations(b,session)){const result=await f.post(route,body);assert.equal(result.status,409,route+' '+await result.clone().text())}
  const readonly=await f.post(`/api/items/${b.id}/frames`,{snapshot:b.snapshot,seconds:0,cachedOnly:true});assert.equal(readonly.status,202);
  const tracks=await f.post(`/api/items/${b.id}/audio-compare`,{snapshot:b.snapshot,mode:'tracks'});assert.equal(tracks.status,200);
  const saved=await f.get(`/api/items/${b.id}/review-session?snapshot=${b.snapshot}`);assert.deepEqual(saved,session,'preview loading cannot record a user confirmation');
  assert.deepEqual(await f.journals(),[]);gate.release();const finished=await f.settled(1);assert.equal(finished.history[0].status,'success');assert.equal((await f.journals()).length,1);
  assert.equal(await sha256(f.files.get('B').original),hash(Buffer.alloc(128,66)));assert.equal(await sha256(f.files.get('B').review),hash(Buffer.alloc(32,98)));
 }finally{await f.close()}
});

for(const route of ['/api/settings/test','/api/radarr/settings/test'])test(`HTTP approval cannot overlap ${route}`,linux,async()=>{
 const f=await fixture();try{
  const item=(await f.items()).items[0];await f.confirm(item);
  const radarr=route.includes('/radarr/');
  if(radarr){const current=await f.get('/api/radarr/settings');assert.equal((await f.post('/api/radarr/settings',{revision:current.revision,url:f.mockBase,apiKey:'synthetic-test-key',mediaRoot:'/fixture-library',preferCzechEnglish:true})).status,200);}
  const settings=await f.get('/api/settings');
  const gate=f.hold(radarr?'/api/v3/system/status':'/api/v2/get-nodes');
  const pending=f.post(route,settings);
  // A request that answers before reaching the gated call failed early; report why instead of timing out.
  await deadline(Promise.race([gate.entered,pending.then(async response=>{throw Error('settings request finished before validation reached Tdarr: '+response.status+' '+await response.clone().text()+' '+f.diagnostics())})]),'settings validation');assert.equal((await f.approve(item)).status,409);assert.equal((await f.post('/api/approve-batch',{items:[item]})).status,409);
  gate.release();const result=await pending;assert.equal(result.status,200,await result.clone().text());assert.deepEqual(await f.journals(),[]);await f.preserved();
 }finally{await f.close()}
});

test('HTTP approval is excluded during interactive preview and its failure releases the reservation',linux,async()=>{
 const f=await fixture();try{
  const item=(await f.items()).items[0];const session=await f.confirm(item),gate=f.hold('/fixture/render');
  const pending=f.post(`/api/items/${item.id}/frames`,{snapshot:item.snapshot,seconds:0});await deadline(gate.entered,'interactive preview renderer');
  assert.equal((await f.approve(item)).status,409);assert.equal((await f.post('/api/preview-settings',{})).status,409);assert.deepEqual(await f.journals(),[]);gate.release();assert.equal((await pending).status,200);
  assert.deepEqual(await f.get(`/api/items/${item.id}/review-session?snapshot=${item.snapshot}`),session);await f.preserved();
  assert.equal((await f.post(`/api/items/${item.id}/frames`,{snapshot:item.snapshot,seconds:-1})).status,400);
  const approvalGate=f.hold('/api/v2/update-node',body=>body.data.nodeUpdates.nodePaused);assert.equal((await f.approve(item)).status,202);await deadline(approvalGate.entered,'approval after failed preview');approvalGate.release();assert.equal((await f.settled(1)).history[0].status,'success');
 }finally{await f.close()}
});

for(const state of ['pauses','recovery'])test(`HTTP ${state} blocks media mutation while safe configuration stays available`,linux,async()=>{
 const f=await fixture({[state]:true});try{
  const item=(await f.items()).items[0];
  for(const action of ['approve','reject','replace','recheck','review-session','approval'])assert.equal((await f.post(`/api/items/${item.id}/${action}`,{snapshot:item.snapshot,reviewRevision:0,reason:'Synthetic reason'})).status,409,action);
  assert.equal((await f.post('/api/approve-batch',{items:[item]})).status,409);assert.equal((await f.post(`/api/radarr/requests/${'f'.repeat(24)}/restore`,{confirm:true})).status,409);
  const settings=await f.get('/api/settings');assert.equal((await f.post('/api/settings/test',settings)).status,409);assert.equal((await f.post('/api/settings',settings)).status,409);
  const cacheSettings=await f.get('/api/preview-settings');assert.equal((await f.post('/api/preview-settings',cacheSettings)).status,200);
  for(const route of ['/api/radarr/settings','/api/radarr/settings/test']){const current=await f.get('/api/radarr/settings');assert.equal((await f.post(route,{revision:current.revision,url:f.mockBase,apiKey:'synthetic-test-key',mediaRoot:'/fixture-library',preferCzechEnglish:true})).status,200,route);}
  assert.equal((await f.post(`/api/items/${item.id}/frames`,{snapshot:item.snapshot,seconds:0})).status,200);
  const remaining=await f.items();assert.equal(remaining.history.length,0);assert.equal(state==='pauses'?remaining.restorePending:remaining.recovery.length,1);assert.equal((await f.journals()).length,state==='recovery'?1:0);await f.preserved();
 }finally{await f.close()}
});

test('HTTP review writes keep revision serialization and exclude approval until the queue drains',linux,async()=>{
 const f=await fixture();try{
  const item=(await f.items()).items[0],session=await f.confirm(item),route=`/api/items/${item.id}/review-session`,gate=f.hold('/fixture/probe');
  const first=f.post(route,{snapshot:item.snapshot,revision:session.revision,session:{...session.session,note:'First explicit draft'}});await deadline(gate.entered,'review verification');
  const second=f.post(route,{snapshot:item.snapshot,revision:session.revision,session:{...session.session,note:'Competing draft'}});
  assert.equal((await f.approve(item)).status,409);gate.release();const result=await Promise.all([first,second]);assert.deepEqual(result.map(value=>value.status),[200,409]);
  const saved=await f.get(route+'?snapshot='+item.snapshot);assert.equal(saved.revision,session.revision+1);assert.equal(saved.session.note,'First explicit draft');assert.equal(saved.complete,true);assert.deepEqual(await f.journals(),[]);await f.preserved();
 }finally{await f.close()}
});

test('HTTP an in-flight node resume excludes settings and previews as well as approval',linux,async()=>{
 const f=await fixture({pauses:true});try{
  const item=(await f.items()).items[0],gate=f.hold('/api/v2/get-nodes'),pending=f.items();await deadline(gate.entered,'node resume');
  for(const [route,body] of f.allMutations(item))assert.equal((await f.post(route,body)).status,409,route);
  gate.release();assert.equal((await pending).restorePending,1);assert.deepEqual(await f.journals(),[]);await f.preserved();
 }finally{await f.close()}
});

test('HTTP settings and recheck cannot mutate while a fresh scan is running',linux,async()=>{
 const f=await fixture();try{
  const gate=f.hold('/fixture/probe'),pending=f.items();await deadline(gate.entered,'fresh scan probe');
  for(const route of ['/api/settings','/api/settings/test','/api/radarr/settings','/api/radarr/settings/test','/api/preview-settings',`/api/items/${'a'.repeat(24)}/recheck`])assert.equal((await f.post(route,{})).status,409,route);
  // Reject deliberately joins the scan, then its stale-snapshot preflight fails.
  const id=hash('PROD-Movies/A/A.mkv').slice(0,24),first=f.post(`/api/items/${id}/reject`,{snapshot:'stale',reason:'Synthetic reason'});
  gate.release();await pending;assert.equal((await first).status,409);
  assert.deepEqual(await f.journals(),[]);await f.preserved();
  const item=(await f.items()).items.find(value=>value.id===id);await f.confirm(item);const approval=f.hold('/api/v2/update-node',body=>body.data.nodeUpdates.nodePaused);assert.equal((await f.approve(item)).status,202);await deadline(approval.entered,'approval after preflight conflict');approval.release();assert.equal((await f.settled(1)).history[0].status,'success');
 }finally{await f.close()}
});

test('HTTP approval owns an asynchronous scan preflight before a transaction starts',linux,async()=>{
 const f=await fixture();try{
  const list=(await f.items()).items,a=list.find(item=>item.title==='A'),b=list.find(item=>item.title==='B');await f.confirm(a);const session=await f.confirm(b);
  // Introduce a new synthetic film so the approval's forced scan must probe
  // metadata. Existing A/B approval evidence remains bound to unchanged files.
  await f.addFilm('D');
  const scanGate=f.hold('/fixture/probe',input=>input.file.endsWith('/D.mkv')),pauseGate=f.hold('/api/v2/update-node',body=>body.data.nodeUpdates.nodePaused),pending=f.approve(a);
  await deadline(scanGate.entered,'approval scan preflight');
  for(const [route,body] of f.allMutations(b,session))assert.equal((await f.post(route,body)).status,409,route);
  assert.deepEqual(await f.journals(),[]);scanGate.release();assert.equal((await pending).status,202);await deadline(pauseGate.entered,'approval after scan');pauseGate.release();assert.equal((await f.settled(1)).history[0].status,'success');assert.equal((await f.journals()).length,1);
 }finally{await f.close()}
});

test('HTTP a node kept paused during an approval is not resumed afterwards',linux,async()=>{
 const f=await fixture();try{
  const a=(await f.items()).items.find(item=>item.title==='A');await f.confirm(a);
  const gate=f.hold('/api/v2/rescan-file');assert.equal((await f.approve(a)).status,202);await deadline(gate.entered,'post-exchange rescan');
  const during=await f.items();assert.equal(during.restorePending,1);assert.deepEqual(during.pendingRestores.map(n=>[n.name,n.title]),[['fixture-node','A']]);assert.ok(Number.isFinite(Date.parse(during.pendingRestores[0].pausedAt)));
  const kept=await f.post('/api/node-restores/keep',{name:'fixture-node',confirm:true});assert.equal(kept.status,200,await kept.clone().text());assert.deepEqual((await kept.json()).pendingRestores,[]);
  gate.release();const finished=await f.settled(1);assert.equal(finished.history[0].status,'success',JSON.stringify(finished.history));
  assert.deepEqual(f.changes,[true],'Review paused the node and never resumed it');assert.equal(finished.restorePending,0);assert.deepEqual(finished.pendingRestores,[]);
 }finally{await f.close()}
});

test('HTTP a pending node restore can be kept paused only with confirmation and only for a recorded node',linux,async()=>{
 const f=await fixture({pauses:true});try{
  const before=await f.items();assert.equal(before.restorePending,1);assert.deepEqual(before.pendingRestores,[{name:'unavailable-node',pausedAt:null,title:null}]);
  const unconfirmed=await f.post('/api/node-restores/keep',{name:'unavailable-node'});assert.equal(unconfirmed.status,400);assert.equal((await unconfirmed.json()).code,'node_keep_confirm_required');
  const unknown=await f.post('/api/node-restores/keep',{name:'other-node',confirm:true});assert.equal(unknown.status,409);assert.equal((await unknown.json()).code,'node_restore_unknown');
  const kept=await f.post('/api/node-restores/keep',{name:'unavailable-node',confirm:true});assert.equal(kept.status,200,await kept.clone().text());
  const after=await f.items();assert.equal(after.restorePending,0);assert.deepEqual(after.pendingRestores,[]);
  assert.ok(!f.calls.some(call=>call.route==='/api/v2/update-node'),'keeping a node paused never contacts Tdarr');
 }finally{await f.close()}
});
