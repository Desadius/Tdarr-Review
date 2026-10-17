import test from 'node:test';
import assert from 'node:assert/strict';
import {serverHarness,linuxServer} from './test-helpers/server.mjs';
import {reviewFixture} from './test-helpers/review-fixture.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

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
 const result=await f.post('/api/shared-settings/apply',{revision:draft.revision});assert.equal(result.status,202,await result.clone().text());
 const finished=await settled(f,(await result.json()).id);assert.equal(finished.state,'succeeded',JSON.stringify(finished));
 assert.equal((await f.get('/api/settings')).config.label,'Applied live');
 const shared=await f.get('/api/shared-settings');assert.equal(shared.generation,1);assert.equal(shared.active.review.label,'Applied live');assert.equal(shared.active.radarr.hasApiKey,false);
 assert.ok(shared.history.some(event=>event.action==='startup'&&event.result==='success'));
 await f.restart();const restarted=await f.get('/api/shared-settings');assert.equal(restarted.generation,1);assert.equal(restarted.active.review.label,'Applied live');assert.equal((await f.get('/api/settings')).config.label,'Applied live');
});

test('HTTP a waiting Apply stays cancellable without activating its draft',linuxServer,async t=>{
 const f=await reviewFixture({pauses:true});t.after(()=>f.close());const current=await f.get('/api/shared-settings');
 const response=await f.post('/api/shared-settings/apply',{revision:current.revision});assert.equal(response.status,202);const {id}=await response.json();
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
 const result=await f.post('/api/shared-settings/apply',{revision});assert.equal(result.status,202);const finished=await settled(f,(await result.json()).id);assert.equal(finished.state,'succeeded',JSON.stringify(finished));
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
 const draft=await staged.json();const apply=await f.post('/api/shared-settings/apply',{revision:draft.revision});assert.equal(apply.status,202);const failed=await settled(f,(await apply.json()).id);assert.equal(failed.state,'failed');assert.equal(failed.error.code,'settings_pending_cases');assert.equal((await f.get('/api/shared-settings')).generation,0);
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
 const result=await f.post('/api/shared-settings/apply',{revision:(await saved.json()).revision});assert.equal(result.status,202);const failed=await settled(f,(await result.json()).id);assert.equal(failed.state,'failed');assert.equal(failed.error.code,'settings_commit_ambiguous');assert.equal(failed.blocking,true);
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
 const response=await f.post('/api/shared-settings/apply',{revision:(await save.json()).revision});assert.equal(response.status,202);const failed=await settled(f,(await response.json()).id);assert.equal(failed.state,'failed');assert.equal(failed.blocking,true);assert.equal(failed.error.code,'settings_start_failed');
 const shared=await f.get('/api/shared-settings');assert.equal(shared.generation,1);assert.equal(shared.active.review.label,'Committed despite refusal');assert.equal((await f.get('/api/settings')).config.label,'Committed despite refusal');assert.equal((await f.get('/api/recovery/runtime')).state,'refused');
 assert.equal(JSON.stringify(shared).includes('revoked-private-authority'),false);
 const resolved=await f.post('/api/shared-settings/draft',{revision:shared.revision,patch:{},resolutions:['legacyFiles']});assert.equal(resolved.status,200,await resolved.clone().text());
 const retry=await f.post('/api/shared-settings/apply',{revision:(await resolved.json()).revision});assert.equal(retry.status,202);assert.equal((await settled(f,(await retry.json()).id)).state,'succeeded');assert.equal((await f.get('/api/recovery/runtime')).state,'running');
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
 const response=await f.post('/api/shared-settings/apply',{revision:(await save.json()).revision});assert.equal(response.status,202);const failed=await settled(f,(await response.json()).id);assert.equal(failed.state,'failed');assert.equal(failed.error.code,'settings_quarantine_setup_failed');assert.equal(failed.blocking,true);assert.equal((await f.get('/api/settings')).config.label,'Quarantine setup failed');assert.equal((await f.get('/api/recovery/runtime')).state,'stopped');
});
