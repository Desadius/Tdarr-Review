import test from 'node:test';
import assert from 'node:assert/strict';
import {serverHarness,linuxServer} from './test-helpers/server.mjs';
import {reviewFixture} from './test-helpers/review-fixture.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

// Apply carries what its Test showed (#204). These tests are about other parts of Apply, so they send the
// broadest level, which a recomputed level can never exceed.
const SHOWN={level:'all',reviews:0,approvals:0};

test('HTTP library path diagnostics read only the saved revision without API calls or filesystem changes',linuxServer,async t=>{
 const f=await reviewFixture({clock:true});t.after(()=>f.close());await f.items();
 const current=await f.get('/api/shared-settings');
 const saved=await f.post('/api/shared-settings/draft',{revision:current.revision,patch:{libraries:{tv:{enabled:false,mediaRoot:path.join(f.root,'offline-tv'),reviewRoot:path.join(f.root,'offline-results')}}}});
 assert.equal(saved.status,200,await saved.clone().text());const draft=await saved.json();
 const settings=path.join(f.data,'shared-settings.json'),before=await fs.readFile(settings),calls=structuredClone(f.calls),names=await fs.readdir(f.root);
 const value=await f.get('/api/shared-settings/paths?revision='+draft.revision);
 assert.equal(value.paths.readOnly,true);assert.equal(value.paths.processingEnabled,false);
 const tv=value.paths.libraries.find(library=>library.id==='tv');assert.equal(tv.enabled,false);assert.equal(tv.paths.find(entry=>entry.role==='source').status,'missing_or_unmounted');
 assert.deepEqual(f.calls,calls,'filesystem diagnostics must not call Tdarr, Radarr, scanners or renderers');assert.deepEqual(await fs.readFile(settings),before);assert.deepEqual(await fs.readdir(f.root),names);await f.preserved();
 const wrongMethod=await f.post('/api/shared-settings/paths?revision='+draft.revision,{});assert.equal(wrongMethod.status,404,'the diagnostic route is GET-only');
});

test('HTTP library path diagnostics require authentication and the exact saved revision',linuxServer,async t=>{
 const f=await serverHarness();t.after(()=>f.close());await f.start();const route='/api/shared-settings/paths';assert.equal((await f.request(route)).status,401);
 const cookie=await f.login(),headers={cookie},current=await (await f.request('/api/shared-settings',{headers})).json();
 const data=await fs.readFile(path.join(f.root,'data','shared-settings.json'));
 for(const query of ['', '?revision=stale']){const response=await f.request(route+query,{headers});assert.equal(response.status,409,await response.clone().text());assert.equal((await response.json()).code,'settings_conflict');}
 const response=await f.request(route+'?revision='+current.revision,{headers});assert.equal(response.status,200);assert.equal((await response.json()).paths.readOnly,true);
 assert.deepEqual(await fs.readFile(path.join(f.root,'data','shared-settings.json')),data);
});

test('HTTP Off mode rejects an unavailable manual quarantine before Test or Apply changes any generation',linuxServer,async t=>{
 const f=await reviewFixture();t.after(()=>f.close());const current=await f.get('/api/shared-settings'),target=path.join(f.root,'missing-parent','manual-quarantine');
 const save=await f.post('/api/shared-settings/draft',{revision:current.revision,patch:{radarr:{url:f.mockBase,apiKey:'synthetic-manual-key',mediaRoot:'/fixture-library',quarantineRoot:target}}});assert.equal(save.status,200);const revision=(await save.json()).revision;
 const checked=await f.post('/api/shared-settings/test',{revision});assert.equal(checked.status,409,await checked.clone().text());assert.equal((await checked.json()).code,'settings_manual_quarantine_unavailable');
 const apply=await f.post('/api/shared-settings/apply',{invalidation:SHOWN,revision});assert.equal(apply.status,202);const failed=await settled(f,(await apply.json()).id);assert.equal(failed.state,'failed');assert.equal(failed.error.code,'settings_manual_quarantine_unavailable');assert.equal((await f.get('/api/shared-settings')).generation,0);
 await assert.rejects(fs.stat(path.dirname(target)),{code:'ENOENT'});assert.deepEqual(await f.journals(),[]);await f.preserved();
});

for(const kind of ['symlink-parent','symlink-target','file-target','unwritable-parent','different-filesystem'])test(`HTTP manual quarantine diagnostics refuse ${kind} in Off mode`,linuxServer,async t=>{
 const f=await reviewFixture();t.after(()=>f.close());let target=path.join(f.root,'manual-quarantine');
 if(kind==='symlink-parent'){const alias=path.join(f.root,'alias');await fs.symlink(f.root,alias);target=path.join(alias,'manual');}
 if(kind==='symlink-target')await fs.symlink(f.root,target);
 if(kind==='file-target')await fs.writeFile(target,'preserved synthetic file');
 if(kind==='unwritable-parent')target='/sys/tdarr-review-synthetic-quarantine';
 if(kind==='different-filesystem'){assert.notEqual((await fs.stat('/dev/shm')).dev,(await fs.stat(f.root)).dev);target='/dev/shm/tdarr-review-synthetic-quarantine';}
 const current=await f.get('/api/shared-settings'),save=await f.post('/api/shared-settings/draft',{revision:current.revision,patch:{radarr:{url:f.mockBase,apiKey:'synthetic-preflight-key',mediaRoot:'/fixture-library',quarantineRoot:target}}});assert.equal(save.status,200,await save.clone().text());const revision=(await save.json()).revision;
 const response=await f.post('/api/shared-settings/test',{revision});assert.equal(response.status,409,await response.clone().text());assert.equal((await response.json()).code,'settings_manual_quarantine_unavailable');assert.equal((await f.get('/api/shared-settings')).generation,0);if(kind==='file-target')assert.equal(await fs.readFile(target,'utf8'),'preserved synthetic file');await f.preserved();
});

for(const kind of ['parent','target'])test(`HTTP manual quarantine diagnostics require ${kind}-directory traversal permission`,linuxServer,async t=>{
 const f=await reviewFixture(),restricted=path.join(f.root,'manual-no-search'),target=kind==='parent'?path.join(restricted,'manual'):restricted;t.after(async()=>{await fs.chmod(restricted,0o700);await f.close();});await fs.mkdir(restricted,{mode:0o666});
 const current=await f.get('/api/shared-settings'),save=await f.post('/api/shared-settings/draft',{revision:current.revision,patch:{radarr:{url:f.mockBase,apiKey:'synthetic-search-permission-key',mediaRoot:'/fixture-library',quarantineRoot:target}}});assert.equal(save.status,200);
 const response=await f.post('/api/shared-settings/test',{revision:(await save.json()).revision});assert.equal(response.status,409,'directories without search permission must fail diagnostics');assert.equal((await f.get('/api/shared-settings')).generation,0);
});

test('HTTP manual quarantine diagnostics permit a missing target without creating it in Test or Off Apply',linuxServer,async t=>{
 const f=await reviewFixture();t.after(()=>f.close());const target=path.join(f.root,'manual-later'),current=await f.get('/api/shared-settings');const save=await f.post('/api/shared-settings/draft',{revision:current.revision,patch:{radarr:{url:f.mockBase,apiKey:'synthetic-read-only-key',mediaRoot:'/fixture-library',quarantineRoot:target}}});assert.equal(save.status,200);const revision=(await save.json()).revision;
 assert.equal((await f.post('/api/shared-settings/test',{revision})).status,200);await assert.rejects(fs.stat(target),{code:'ENOENT'});
 const response=await f.post('/api/shared-settings/apply',{invalidation:SHOWN,revision});assert.equal(response.status,202);assert.equal((await settled(f,(await response.json()).id)).state,'succeeded');await assert.rejects(fs.stat(target),{code:'ENOENT'});await f.preserved();
});

test('HTTP shared drafts save offline, reject stale writers and keep active settings and secrets private',linuxServer,async t=>{
 const f=await serverHarness();t.after(()=>f.close());await f.start();
 assert.equal((await f.request('/api/shared-settings')).status,401);
 assert.equal((await f.request('/api/shared-settings',{headers:{host:'forbidden.invalid'}})).status,403);
 assert.equal((await f.request('/api/shared-settings/draft',{method:'POST',headers:{'content-type':'text/plain'},body:{}})).status,415);
 const cookie=await f.login(),headers={cookie};
 const get=async()=>{const r=await f.request('/api/shared-settings',{headers});assert.equal(r.status,200);return r.json()};
 const initial=await get();
 const response=await f.request('/api/shared-settings/draft',{method:'POST',headers,body:{revision:initial.revision,patch:{review:{label:'Offline draft'},radarr:{apiKey:'synthetic-private-key'}}}});
 assert.equal(response.status,200,await response.clone().text());
 const draft=await get();assert.equal(draft.draft.review.label,'Offline draft');assert.equal(draft.draft.radarr.hasApiKey,true);assert.equal(JSON.stringify(draft).includes('synthetic-private-key'),false);
 assert.equal((await f.request('/api/settings',{headers})).status,200);
 assert.equal((await (await f.request('/api/settings',{headers})).json()).config.label,'Tdarr Review');
 assert.equal((await f.request('/api/shared-settings/draft',{method:'POST',headers,body:{revision:initial.revision,patch:{review:{label:'Stale'}}}})).status,409);
 assert.equal((await f.request('/api/shared-settings/draft',{method:'POST',headers:{...headers,origin:'http://wrong.invalid'},body:{}})).status,403);
});

test('HTTP failed draft saves record a value-free result and return the revision needed for correction',linuxServer,async t=>{
 const f=await serverHarness();t.after(()=>f.close());await f.start();const cookie=await f.login(),headers={cookie};
 const current=await (await f.request('/api/shared-settings',{headers})).json();
 const response=await f.request('/api/shared-settings/draft',{method:'POST',headers,body:{revision:current.revision,patch:{recovery:{pollSeconds:'synthetic-sensitive-invalid-value'}}}});assert.equal(response.status,400);const failed=await response.json();assert.equal(typeof failed.revision,'string');
 const view=await (await f.request('/api/shared-settings',{headers})).json();assert.ok(view.history.some(entry=>entry.action==='save'&&entry.result==='failure'));assert.equal(JSON.stringify(view).includes('synthetic-sensitive-invalid-value'),false);
 const corrected=await f.request('/api/shared-settings/draft',{method:'POST',headers,body:{revision:failed.revision,patch:{recovery:{pollSeconds:301}}}});assert.equal(corrected.status,200,await corrected.clone().text());assert.equal((await corrected.json()).draft.recovery.pollSeconds,301);
});

test('HTTP invalid imported endpoint credentials never appear in draft or migration choices',linuxServer,async t=>{
 const f=await serverHarness();t.after(()=>f.close());await fs.mkdir(path.join(f.data,'recovery'));await fs.writeFile(path.join(f.data,'recovery/config.json'),JSON.stringify({tdarrUrl:'http://user:synthetic-url-password@127.0.0.1:9',radarrUrl:'http://127.0.0.1:9/?token=synthetic-query-secret',radarrApiKey:'private-import-key'}));
 await fs.writeFile(path.join(f.data,'settings-activation.json'),JSON.stringify({version:1,id:'old-safe-test',state:'succeeded',blocking:false,publicOrigin:'http://user:synthetic-marker-password@127.0.0.1:9'}));await f.start();
 const cookie=await f.login(),response=await f.request('/api/shared-settings',{headers:{cookie}});assert.equal(response.status,200);const text=await response.text();assert.equal(text.includes('synthetic-url-password'),false);assert.equal(text.includes('synthetic-query-secret'),false);assert.equal(text.includes('private-import-key'),false);assert.equal(text.includes('synthetic-marker-password'),false);
});

async function settled(f,id){
 const deadline=Date.now()+20000;
 while(Date.now()<deadline){const value=await f.get('/api/shared-settings/status');if(value.id===id&&['succeeded','failed','cancelled'].includes(value.state))return value;await new Promise(r=>setTimeout(r,20));}
 assert.fail('Settings apply did not settle');
}
test('HTTP explicit Apply commits one generation and changes the running Review without restarting it',linuxServer,async t=>{
 const f=await reviewFixture();t.after(()=>f.close());const current=await f.get('/api/shared-settings');
 const saved=await f.post('/api/shared-settings/draft',{revision:current.revision,patch:{review:{label:'Applied live'}}});assert.equal(saved.status,200,await saved.clone().text());
 const draft=await saved.json();
 const result=await f.post('/api/shared-settings/apply',{invalidation:SHOWN,revision:draft.revision});assert.equal(result.status,202,await result.clone().text());
 const finished=await settled(f,(await result.json()).id);assert.equal(finished.state,'succeeded',JSON.stringify(finished));
 assert.equal((await f.get('/api/settings')).config.label,'Applied live');
 const shared=await f.get('/api/shared-settings');assert.equal(shared.generation,1);assert.equal(shared.active.review.label,'Applied live');assert.equal(shared.active.radarr.hasApiKey,false);
 assert.ok(shared.history.some(event=>event.action==='startup'&&event.result==='success'));
 await f.restart();const restarted=await f.get('/api/shared-settings');assert.equal(restarted.generation,1);assert.equal(restarted.active.review.label,'Applied live');assert.equal((await f.get('/api/settings')).config.label,'Applied live');
});

test('HTTP a waiting Apply stays cancellable without activating its draft',linuxServer,async t=>{
 const f=await reviewFixture({pauses:true});t.after(()=>f.close());const current=await f.get('/api/shared-settings');
 const response=await f.post('/api/shared-settings/apply',{invalidation:SHOWN,revision:current.revision});assert.equal(response.status,202);const {id}=await response.json();
 const deadline=Date.now()+10000;while(Date.now()<deadline){const value=await f.get('/api/shared-settings/status');if(value.state==='waiting'&&value.updated!==current.updated)break;await new Promise(r=>setTimeout(r,20));}
 assert.equal((await f.post('/api/shared-settings/cancel',{id})).status,200);assert.equal((await settled(f,id)).state,'cancelled');assert.equal((await f.get('/api/shared-settings')).generation,0);
});

test('HTTP supervised Apply drains the actual worker, starts the committed generation and keeps Review session alive',linuxServer,async t=>{
 const f=await reviewFixture({supervisor:true,env:{RECOVERY_MODE:'verify'},beforeStart:async({data,root})=>{
  const review=JSON.parse(await fs.readFile(path.join(data,'settings.json'),'utf8'));await fs.mkdir(path.join(data,'recovery'));await fs.mkdir(path.join(root,'reports'));
  const config={...review,sourceRoot:'/fixture-library',radarrRoot:'/fixture-library',radarrUrl:review.tdarrUrl,radarrApiKey:'synthetic-supervised-key',quarantineRoot:path.join(root,'quarantine'),reports:path.join(root,'reports'),stableMinutes:0,decodeTimeoutHours:1,confirmDelaySeconds:0,maxRepairsPerDay:3,movieCooldownDays:30,pollSeconds:300,detectTerminalHeaders:false,since:0};
  await fs.writeFile(path.join(data,'recovery/config.json'),JSON.stringify(config));
 }});t.after(()=>f.close());
 const current=await f.get('/api/shared-settings');assert.deepEqual(current.conflicts,[]);
 const save=await f.post('/api/shared-settings/draft',{revision:current.revision,patch:{review:{label:'Supervisor generation'},radarr:{apiKey:'synthetic-new-shared-key'}}});assert.equal(save.status,200,await save.clone().text());
 const revision=(await save.json()).revision;assert.equal((await f.post('/api/shared-settings/test',{revision})).status,200);await assert.rejects(fs.stat(path.join(f.root,'quarantine')),{code:'ENOENT'});
 const result=await f.post('/api/shared-settings/apply',{invalidation:SHOWN,revision});assert.equal(result.status,202);const finished=await settled(f,(await result.json()).id);assert.equal(finished.state,'succeeded',JSON.stringify(finished));
 assert.equal((await fs.lstat(path.join(f.root,'quarantine'))).isDirectory(),true);
 assert.equal((await f.get('/api/settings')).config.label,'Supervisor generation');assert.equal((await f.get('/api/recovery/runtime')).state,'running');assert.equal((await f.get('/api/shared-settings')).generation,1);
 const deadline=Date.now()+5000;while(!f.calls.some(c=>c.route==='/api/v3/movie'&&c.apiKey==='synthetic-new-shared-key')){assert.ok(Date.now()<deadline,'new worker did not use committed connection');await new Promise(r=>setTimeout(r,20));}
 const item=(await f.items()).items[0],before=f.calls.length;assert.equal((await f.post(`/api/items/${item.id}/replace`,{snapshot:item.snapshot,reason:'Synthetic connection proof'})).status,202);await f.settled(1);
 assert.ok(f.calls.slice(before).some(c=>c.route==='/api/v3/movie'&&c.apiKey==='synthetic-new-shared-key'),'Review and Recovery resolve the same committed credential');await f.preserved();
});

test('HTTP frozen settings and unfinished-case mappings reject all shared editor bypasses',linuxServer,async t=>{
 const f=await reviewFixture({beforeStart:async({data})=>{await fs.mkdir(path.join(data,'recovery'));await fs.writeFile(path.join(data,'recovery/pending-approvals.json'),JSON.stringify({version:1,config:{maxRepairsPerDay:3},cases:[]}));await fs.writeFile(path.join(data,'recovery/state.json'),JSON.stringify({version:1,cases:{unfinished:{status:'manual'}}}));}});t.after(()=>f.close());
 const current=await f.get('/api/shared-settings');const frozen=await f.post('/api/shared-settings/draft',{revision:current.revision,patch:{recovery:{maxRepairsPerDay:4}}});assert.equal(frozen.status,409);assert.equal((await frozen.json()).code,'settings_frozen');
 const refreshed=await f.get('/api/shared-settings');const staged=await f.post('/api/shared-settings/draft',{revision:refreshed.revision,patch:{review:{sourceRoots:['/fixture-library','/alternate']},recovery:{sourceRoot:'/alternate'}}});assert.equal(staged.status,200,await staged.clone().text());
 const draft=await staged.json();const apply=await f.post('/api/shared-settings/apply',{invalidation:SHOWN,revision:draft.revision});assert.equal(apply.status,202);const failed=await settled(f,(await apply.json()).id);assert.equal(failed.state,'failed');assert.equal(failed.error.code,'settings_pending_cases');assert.equal((await f.get('/api/shared-settings')).generation,0);
});

test('HTTP interrupted activation remains visible and never replays an old request',linuxServer,async t=>{
 const f=await serverHarness();t.after(()=>f.close());await fs.writeFile(path.join(f.data,'settings-activation.json'),JSON.stringify({version:1,id:'old-apply',state:'committing',blocking:true,generation:2}));await f.start();const cookie=await f.login();
 const response=await f.request('/api/shared-settings/status',{headers:{cookie}});assert.equal(response.status,200);const state=await response.json();assert.equal(state.state,'interrupted');assert.equal(state.blocking,true);assert.equal(state.error.code,'settings_apply_interrupted');
 const shared=await (await f.request('/api/shared-settings',{headers:{cookie}})).json();assert.equal(shared.generation,0);assert.equal(shared.apply.id,'old-apply');assert.ok(shared.history.some(e=>e.result==='interrupted'));
});

test('HTTP automatic library selection refuses ambiguous matches without changing active settings',linuxServer,async t=>{
 const f=await reviewFixture({beforeStart:async({data})=>{const review=JSON.parse(await fs.readFile(path.join(data,'settings.json'),'utf8')),db=new DatabaseSync(review.database);try{db.prepare('INSERT INTO librarysettingsjsondb VALUES (?)').run(JSON.stringify({_id:'other-library',folder:'/fixture-library'}));}finally{db.close();}}});t.after(()=>f.close());
 const current=await f.get('/api/shared-settings'),save=await f.post('/api/shared-settings/draft',{revision:current.revision,patch:{review:{libraryId:''}}});assert.equal(save.status,200);
 const response=await f.post('/api/shared-settings/test',{revision:(await save.json()).revision});assert.equal(response.status,409);assert.equal((await response.json()).code,'settings_library_unavailable');assert.equal((await f.get('/api/shared-settings')).generation,0);
});

test('HTTP ambiguous directory sync after commit adopts the complete generation and keeps activation fenced',linuxServer,async t=>{
 const f=await reviewFixture({beforeStart:async({data,root})=>{
  await fs.appendFile(path.join(root,'preload.cjs'),`\nconst fsp=require('node:fs/promises'),fs=require('node:fs'),open=fsp.open;fsp.open=async function(file,...args){const h=await open(file,...args);if(file===${JSON.stringify(data)}){const sync=h.sync.bind(h);h.sync=async()=>{if(fs.existsSync(${JSON.stringify(path.join(root,'fail-generation-sync'))})&&fs.existsSync(${JSON.stringify(path.join(data,'shared-settings.json'))})&&JSON.parse(fs.readFileSync(${JSON.stringify(path.join(data,'shared-settings.json'))},'utf8')).active){fs.unlinkSync(${JSON.stringify(path.join(root,'fail-generation-sync'))});throw Error('synthetic directory sync failure');}return sync();};}return h;};require('node:module').syncBuiltinESMExports();\n`);
 }});t.after(()=>f.close());const current=await f.get('/api/shared-settings'),saved=await f.post('/api/shared-settings/draft',{revision:current.revision,patch:{review:{label:'Complete ambiguous generation'}}});assert.equal(saved.status,200);await fs.writeFile(path.join(f.root,'fail-generation-sync'),'1');
 const result=await f.post('/api/shared-settings/apply',{invalidation:SHOWN,revision:(await saved.json()).revision});assert.equal(result.status,202);const failed=await settled(f,(await result.json()).id);assert.equal(failed.state,'failed');assert.equal(failed.error.code,'settings_commit_ambiguous');assert.equal(failed.blocking,true);
 assert.equal((await f.get('/api/settings')).config.label,'Complete ambiguous generation');assert.equal((await f.get('/api/shared-settings')).generation,1);
 await f.restart();assert.equal((await f.get('/api/settings')).config.label,'Complete ambiguous generation');assert.equal((await f.get('/api/shared-settings/status')).blocking,true);
});

test('HTTP failed new worker startup keeps the committed generation, stops Recovery and allows explicit recovery',linuxServer,async t=>{
 const f=await reviewFixture({supervisor:true,env:{RECOVERY_MODE:'verify'},beforeStart:async({data,root})=>{
  const review=JSON.parse(await fs.readFile(path.join(data,'settings.json'),'utf8'));await fs.mkdir(path.join(data,'recovery'));await fs.mkdir(path.join(root,'reports'));
  const config={...review,sourceRoot:'/fixture-library',radarrRoot:'/fixture-library',radarrUrl:review.tdarrUrl,radarrApiKey:'synthetic-startup-key',quarantineRoot:path.join(root,'quarantine'),reports:path.join(root,'reports'),stableMinutes:0,decodeTimeoutHours:1,confirmDelaySeconds:0,maxRepairsPerDay:3,movieCooldownDays:30,pollSeconds:300,detectTerminalHeaders:false,since:0};
  await fs.writeFile(path.join(data,'recovery/config.json'),JSON.stringify(config));
  // Filesystem fault seam: an external private-authority edit immediately after a complete commit.
  // This must fail the strict new worker startup, never fall back to the previous generation.
  await fs.appendFile(path.join(root,'preload.cjs'),`\nconst fsp=require('node:fs/promises'),fs=require('node:fs'),rename=fsp.rename;fsp.rename=async function(from,to){const result=await rename(from,to);if(to===${JSON.stringify(path.join(data,'shared-settings.json'))}&&fs.existsSync(${JSON.stringify(path.join(root,'revoke-at-commit'))})&&JSON.parse(fs.readFileSync(to,'utf8')).active){fs.unlinkSync(${JSON.stringify(path.join(root,'revoke-at-commit'))});const p=${JSON.stringify(path.join(data,'recovery/config.json'))},v=JSON.parse(fs.readFileSync(p,'utf8'));v.approvedCaseIds=['revoked-private-authority'];fs.writeFileSync(p,JSON.stringify(v));}return result;};require('node:module').syncBuiltinESMExports();\n`);
 }});t.after(()=>f.close());
 const current=await f.get('/api/shared-settings');const save=await f.post('/api/shared-settings/draft',{revision:current.revision,patch:{review:{label:'Committed despite refusal'}}});assert.equal(save.status,200);await fs.writeFile(path.join(f.root,'revoke-at-commit'),'1');
 const response=await f.post('/api/shared-settings/apply',{invalidation:SHOWN,revision:(await save.json()).revision});assert.equal(response.status,202);const failed=await settled(f,(await response.json()).id);assert.equal(failed.state,'failed');assert.equal(failed.blocking,true);assert.equal(failed.error.code,'settings_start_failed');
 const shared=await f.get('/api/shared-settings');assert.equal(shared.generation,1);assert.equal(shared.active.review.label,'Committed despite refusal');assert.equal((await f.get('/api/settings')).config.label,'Committed despite refusal');assert.equal((await f.get('/api/recovery/runtime')).state,'refused');
 assert.equal(JSON.stringify(shared).includes('revoked-private-authority'),false);
 const resolved=await f.post('/api/shared-settings/draft',{revision:shared.revision,patch:{},resolutions:['legacyFiles']});assert.equal(resolved.status,200,await resolved.clone().text());
 const retry=await f.post('/api/shared-settings/apply',{invalidation:SHOWN,revision:(await resolved.json()).revision});assert.equal(retry.status,202);assert.equal((await settled(f,(await retry.json()).id)).state,'succeeded');assert.equal((await f.get('/api/recovery/runtime')).state,'running');
});

test('HTTP failed legacy Review and Radarr saves are audited and return the correction revision; failed tests are not saves',linuxServer,async t=>{
 const f=await serverHarness();t.after(()=>f.close());await f.start();const cookie=await f.login(),headers={cookie};
 const failures=async()=>(await (await f.request('/api/shared-settings',{headers})).json()).history.filter(entry=>entry.action==='save'&&entry.result==='failure').length;
 for(const [route,payload] of [['/api/settings',{config:{label:'x'.repeat(5000)}}],['/api/radarr/settings',{url:'synthetic-not-a-url',apiKey:'synthetic-failed-key',mediaRoot:'/radarr'}]]){
  const before=await failures(),stale=await f.request(route,{method:'POST',headers,body:{revision:'stale-revision',...payload}});
  assert.equal(stale.status,409,route);const failed=await stale.json();assert.equal(failed.code,'settings_conflict',route);assert.equal(typeof failed.revision,'string',route);assert.equal(await failures(),before+1,route);
  const test=await f.request(route+'/test',{method:'POST',headers,body:{revision:'stale-revision'}});assert.equal(test.status,409,route);const refused=await test.json();assert.match(refused.code,/^settings_/,route);assert.equal(refused.revision,undefined,route);assert.equal(await failures(),before+1,route);
  assert.equal(JSON.stringify(await (await f.request('/api/shared-settings',{headers})).json()).includes('synthetic-failed-key'),false);
 }
});

test('HTTP legacy Review and Radarr saves stage the same draft without activating a connection',linuxServer,async t=>{
 const f=await serverHarness();t.after(()=>f.close());await f.start();const cookie=await f.login(),headers={cookie};
 const old=await (await f.request('/api/settings',{headers})).json();
 const saved=await f.request('/api/settings',{method:'POST',headers,body:{revision:old.revision,config:{...old.config,label:'Staged legacy'}}});assert.equal(saved.status,200,await saved.clone().text());
 const active=await (await f.request('/api/settings',{headers})).json();assert.equal(active.config.label,'Tdarr Review');assert.equal(active.draft.review.label,'Staged legacy');
 const radarr=await (await f.request('/api/radarr/settings',{headers})).json();
 const staged=await f.request('/api/radarr/settings',{method:'POST',headers,body:{revision:radarr.revision,url:'http://127.0.0.1:1',apiKey:'private-legacy-test',mediaRoot:'/radarr',preferCzechEnglish:false}});assert.equal(staged.status,200,await staged.clone().text());
 const shared=await (await f.request('/api/shared-settings',{headers})).json();assert.equal(shared.draft.radarr.url,'http://127.0.0.1:1');assert.equal(JSON.stringify(shared).includes('private-legacy-test'),false);
 assert.equal((await f.request('/api/radarr/settings',{method:'POST',headers,body:{url:'http://127.0.0.1:2',apiKey:'another',mediaRoot:'/radarr',preferCzechEnglish:true}})).status,409);
});

test('HTTP quarantine setup failure keeps the committed generation and Recovery stopped',linuxServer,async t=>{
 const f=await reviewFixture({supervisor:true,env:{RECOVERY_MODE:'verify'},beforeStart:async({data,root})=>{
  const review=JSON.parse(await fs.readFile(path.join(data,'settings.json'),'utf8'));await fs.mkdir(path.join(data,'recovery'));await fs.mkdir(path.join(root,'reports'));
  const config={...review,sourceRoot:'/fixture-library',radarrRoot:'/fixture-library',radarrUrl:review.tdarrUrl,radarrApiKey:'synthetic-quarantine-key',quarantineRoot:path.join(root,'quarantine'),reports:path.join(root,'reports'),stableMinutes:0,decodeTimeoutHours:1,confirmDelaySeconds:0,maxRepairsPerDay:3,movieCooldownDays:30,pollSeconds:300,detectTerminalHeaders:false,since:0};await fs.writeFile(path.join(data,'recovery/config.json'),JSON.stringify(config));
  await fs.appendFile(path.join(root,'preload.cjs'),`\nconst fsp=require('node:fs/promises'),mkdir=fsp.mkdir;fsp.mkdir=async function(target,...args){if(target===${JSON.stringify(path.join(root,'quarantine'))})throw Object.assign(Error('synthetic creation denied'),{code:'EACCES'});return mkdir(target,...args);};require('node:module').syncBuiltinESMExports();\n`);
 }});t.after(()=>f.close());const current=await f.get('/api/shared-settings'),save=await f.post('/api/shared-settings/draft',{revision:current.revision,patch:{review:{label:'Quarantine setup failed'}}});assert.equal(save.status,200);
 const response=await f.post('/api/shared-settings/apply',{invalidation:SHOWN,revision:(await save.json()).revision});assert.equal(response.status,202);const failed=await settled(f,(await response.json()).id);assert.equal(failed.state,'failed');assert.equal(failed.error.code,'settings_quarantine_setup_failed');assert.equal(failed.blocking,true);assert.equal((await f.get('/api/settings')).config.label,'Quarantine setup failed');assert.equal((await f.get('/api/recovery/runtime')).state,'stopped');
});
