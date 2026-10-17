import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createSharedSettingsStore,readActiveSettings} from './shared-settings.mjs';

async function fixture(t){const data=await fs.mkdtemp(path.join(os.tmpdir(),'shared-settings-'));t.after(()=>fs.rm(data,{recursive:true,force:true}));return data;}
test('new setup keeps its discovery boundary and shared draft across process instances',async t=>{
 const data=await fixture(t),store=createSharedSettingsStore({data,env:{},now:()=>1700000000000});
 const first=await store.current();
 assert.equal(first.draft.recovery.since,1700000000000);
 const saved=await store.saveDraft({revision:first.revision,patch:{review:{label:'Living room'}}});
 const restarted=await createSharedSettingsStore({data,env:{},now:()=>1800000000000}).current();
 assert.equal(restarted.draft.review.label,'Living room');
 assert.equal(restarted.draft.recovery.since,1700000000000);
 assert.equal(restarted.revision,saved.revision);
 assert.equal(restarted.active,null);
});

async function configured(t,{env={RECOVERY_MODE:'verify'},now=()=>1700000000000}={}){
 const data=await fixture(t),store=createSharedSettingsStore({data,env,now}),first=await store.current();
 const saved=await store.saveDraft({revision:first.revision,patch:{review:{libraryId:'movies'},radarr:{url:'http://127.0.0.1:7878/radarr',apiKey:'private-key'}}});
 return {data,store,saved};
}
test('blank API key preserves the credential while explicit replacement stays private',async t=>{
 const {data,store,saved}=await configured(t);
 const blank=await store.saveDraft({revision:saved.revision,patch:{radarr:{apiKey:''}}});
 assert.equal((await store.validate()).radarr.apiKey,'private-key');
 const replaced=await store.saveDraft({revision:blank.revision,patch:{radarr:{apiKey:'replacement-key'}}});
 assert.equal((await store.validate()).recovery.radarrApiKey,'replacement-key');
 await store.applyGeneration({revision:replaced.revision});
 const visible=await store.public(),history=await store.audit();
 assert.equal(visible.draft.radarr.hasApiKey,true);
 assert.equal(JSON.stringify(visible).includes('replacement-key'),false);
 assert.equal(JSON.stringify(history).includes('replacement-key'),false);
 assert.equal((await readActiveSettings(data,{mode:'verify'})).radarr.apiKey,'replacement-key');
});
test('public legacy projections allowlist every section even before an invalid import is corrected',async t=>{
 const {data,saved}=await configured(t);
 await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({...saved.draft.review,unknownSecret:'hidden-value'}));
 await fs.rm(path.join(data,'shared-settings.json'));
 const store=createSharedSettingsStore({data,env:{}});
 assert.equal(JSON.stringify(await store.public()).includes('hidden-value'),false);
});
test('stale draft writers and external legacy edits require a reload and explicit resolution',async t=>{
 const {data,store,saved}=await configured(t),other=createSharedSettingsStore({data,env:{}});
 await store.saveDraft({revision:saved.revision,patch:{review:{label:'New label'}}});
 await assert.rejects(other.saveDraft({revision:saved.revision,patch:{review:{label:'Lost update'}}}),{code:'settings_conflict'});
 const fresh=await store.current();
 await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({...fresh.draft.review,label:'External'}));
 await assert.rejects(store.applyGeneration({revision:fresh.revision}),{code:'settings_conflict'});
 const external=await store.current();assert.deepEqual(external.conflicts,['legacyFiles']);
 await assert.rejects(store.validate({forApply:true}),{code:'settings_migration_conflict'});
 const resolved=await store.saveDraft({revision:external.revision,patch:{},resolutions:['legacyFiles']});
 const applied=await store.applyGeneration({revision:resolved.revision});
 assert.equal(applied.active.review.label,'New label');
});
test('activation publishes one complete generation and failed rename preserves the old generation',async t=>{
 let time=1700000000000;const {data,store,saved}=await configured(t,{now:()=>time});
 assert.equal(await readActiveSettings(data),null);
 time+=60000;const first=await store.applyGeneration({revision:saved.revision});
 assert.ok(first.active,'activation must publish a complete active generation');
 assert.equal(first.active.recovery.since,1700000060000);
 const next=await store.saveDraft({revision:first.revision,patch:{review:{tdarrUrl:'http://127.0.0.1:9999'},radarr:{url:'http://127.0.0.1:9998'}}});
 const rename=fs.rename;try{fs.rename=async()=>{throw Object.assign(Error('Injected disk failure'),{code:'EIO'});};await assert.rejects(store.applyGeneration({revision:next.revision}),{code:'EIO'});}finally{fs.rename=rename;}
 const restart=await readActiveSettings(data,{mode:'repair'});
 assert.equal(restart.generation,1);assert.equal(restart.review.tdarrUrl,'http://tdarr:8266');assert.equal(restart.recovery.tdarrUrl,'http://tdarr:8266');assert.equal(restart.radarr.url,'http://127.0.0.1:7878/radarr');assert.equal(restart.recovery.enabled,true);
 const activated=await store.applyGeneration({revision:next.revision});
 assert.equal(activated.active.recovery.tdarrUrl,'http://127.0.0.1:9999');assert.equal(activated.active.recovery.radarrUrl,'http://127.0.0.1:9998');assert.equal(activated.active.recovery.since,1700000060000);
});

async function writeRecovery(data,value,name='config.json'){await fs.mkdir(path.join(data,'recovery'),{recursive:true});await fs.writeFile(path.join(data,'recovery',name),JSON.stringify(value),{mode:0o600});}
async function legacyFixture(t){
 const {data,store,saved}=await configured(t),resolved=await store.validate();
 await fs.writeFile(path.join(data,'settings.json'),JSON.stringify(saved.draft.review));
 await fs.writeFile(path.join(data,'radarr.json'),JSON.stringify(resolved.radarr));
 await writeRecovery(data,{...resolved.recovery,since:0,approvedCaseIds:['private-case'],approvedImportRepairs:{'private-case':{evidence:'private-evidence'}}});
 await fs.rm(path.join(data,'shared-settings.json'));
 return {data,store:createSharedSettingsStore({data,env:{RECOVERY_MODE:'verify'},now:()=>1700000000000})};
}
test('legacy conflicts require explicit field decisions and preserve file-only exceptions',async t=>{
 const {data,store}=await legacyFixture(t);
 const previous=JSON.parse(await fs.readFile(path.join(data,'recovery','config.json'),'utf8'));previous.radarrApiKey='legacy-key';previous.radarrRoot='/radarr-movies';await writeRecovery(data,previous);
 const imported=await store.current();assert.deepEqual(imported.conflicts,['radarr.apiKey','radarr.mediaRoot']);assert.equal(imported.draft.recovery.since,0);
 const choices=(await store.public()).migrationChoices;assert.equal(choices[0].secret,true);assert.equal(choices[1].recoveryValue,'/radarr-movies');assert.equal(JSON.stringify(choices).includes('legacy-key'),false);
 const saved=await store.saveDraft({revision:imported.revision,patch:{review:{label:'Migrated'}}});
 await assert.rejects(store.applyGeneration({revision:saved.revision}),{code:'settings_migration_conflict'});
 const decision=await store.saveDraft({revision:saved.revision,patch:{},resolutions:[{field:'radarr.apiKey',source:'recovery'},{field:'radarr.mediaRoot',source:'recovery'}]});
 await store.applyGeneration({revision:decision.revision});
 assert.deepEqual((await readActiveSettings(data,{checkPrivate:false})).recovery.approvedCaseIds,['private-case']);
 assert.equal((await readActiveSettings(data)).recovery.radarrRoot,'/radarr-movies');
 assert.equal((await readActiveSettings(data)).radarr.apiKey,'legacy-key');
 const projection=JSON.stringify(await store.public());assert.equal(projection.includes('private-evidence'),false);assert.equal(projection.includes('private-case'),false);assert.equal(projection.includes('legacy-key'),false);
 await assert.rejects(store.saveDraft({revision:(await store.current()).revision,patch:{recovery:{approvedCaseIds:[]}}}),{code:'settings_invalid'});
});
test('actual registry frozen fields block edits including arbitrary file-only keys',async t=>{
 const {data,store}=await legacyFixture(t);
 await writeRecovery(data,{version:1,config:{maxRepairsPerDay:3,approvedCaseIds:['private-case']},cases:[]},'pending-approvals.json');
 const imported=await store.current();
 await assert.rejects(store.saveDraft({revision:imported.revision,patch:{recovery:{maxRepairsPerDay:4}}}),{code:'settings_frozen',field:'maxRepairsPerDay'});
 await store.saveDraft({revision:imported.revision,patch:{review:{label:'Allowed'}}});
 await writeRecovery(data,{version:1,config:{approvedCaseIds:['different-case']},cases:[]},'pending-approvals.json');
 await assert.rejects(store.validate({forApply:true}),{code:'settings_frozen',field:'approvedCaseIds'});
 await writeRecovery(data,{version:1,config:{},cases:[{id:'invalid'}]},'pending-approvals.json');
 await assert.rejects(store.validate(),{code:'settings_registry_invalid'});
});
test('typed allowlist rejects invalid limits, credentials, traversal, modes and source aliases',async t=>{
 const {store,saved}=await configured(t);
 for(const patch of [{recovery:{pollSeconds:2147484}},{recovery:{stableMinutes:'10'}},{recovery:{maxRepairsPerDay:1.5}},{recovery:{decodeTimeoutHours:0}},{recovery:{fullSourceHash:1}},{recovery:{since:-1}},{recovery:{enabled:true}},{recovery:{sourceRoot:'/unknown'}},{radarr:{url:'http://user:secret@localhost'}},{recovery:{reports:'/tdarr/../reports'}}])await assert.rejects(store.saveDraft({revision:saved.revision,patch}),{code:'settings_invalid'});
});
test('first legacy activation protects unfinished Recovery cases and Review-only mappings',async t=>{
 const {data,store}=await legacyFixture(t);const imported=await store.current();
 await writeRecovery(data,{cases:{one:{status:'waiting_replacement'}}},'state.json');
 const saved=await store.saveDraft({revision:imported.revision,patch:{review:{libraryId:'different'}}});
 await assert.rejects(store.applyGeneration({revision:saved.revision}),{code:'settings_pending_cases'});
 const reverted=await store.saveDraft({revision:saved.revision,patch:{review:{libraryId:'movies',tdarrReviewRoot:'/new-review'}}});
 await fs.mkdir(path.join(data,'radarr-replacements'));
 await fs.writeFile(path.join(data,'radarr-replacements','a'.repeat(24)+'.json'),JSON.stringify({phase:'waiting'}));
 await assert.rejects(store.applyGeneration({revision:reverted.revision}),{code:'settings_pending_cases'});
});
test('earlier discovery needs explicit acknowledgement and cutoff is retained on migration',async t=>{
 const {store,saved}=await configured(t);
 await assert.rejects(store.saveDraft({revision:saved.revision,patch:{recovery:{since:0}}}),{code:'settings_history_acknowledgement'});
 const earlier=await store.saveDraft({revision:saved.revision,patch:{recovery:{since:0}},acknowledgeHistory:true});
 const applied=await store.applyGeneration({revision:earlier.revision});assert.equal(applied.active.recovery.since,0);
 const legacy=await legacyFixture(t);const imported=await legacy.store.current();const migrated=await legacy.store.applyGeneration({revision:imported.revision});assert.equal(migrated.active.recovery.since,0);
});
test('restart reclaims dead process locks and history remains bounded and value-free',async t=>{
 const {data,store,saved}=await configured(t);
 await fs.writeFile(path.join(data,'shared-settings.json.lock'),JSON.stringify({pid:2147483647}));
 await assert.doesNotReject(store.saveDraft({revision:saved.revision,patch:{review:{label:'After crash'}}}));
 for(let i=0;i<201;i++)await assert.doesNotReject(store.recordOutcome({action:'startup',result:'failure'}));
 const history=await createSharedSettingsStore({data,env:{}}).audit();assert.equal(history.length,200);assert.equal(history.at(-1).result,'failure');assert.equal(JSON.stringify(history).includes('private-key'),false);
 assert.ok(history.every(entry=>/^[a-f0-9]{64}$/.test(entry.revision)));
});
test('a stale settings lock with a reused current PID does not block a new process lifetime',async t=>{
 const {data,store,saved}=await configured(t);
 const bootId=process.platform==='linux'?(await fs.readFile('/proc/sys/kernel/random/boot_id','utf8')).trim():'00000000-0000-0000-0000-000000000000';
 const stale=JSON.stringify({version:1,pid:process.pid,bootId,startTime:'0',nonce:'previous-process-lifetime'}),candidate=path.join(data,'shared-settings.json.lock.owner-00000000-0000-0000-0000-000000000001');
 await fs.writeFile(path.join(data,'shared-settings.json.lock'),stale);await fs.writeFile(candidate,stale);
 await assert.doesNotReject(store.saveDraft({revision:saved.revision,patch:{review:{label:'After PID reuse'}}}));
 assert.equal((await store.current()).draft.review.label,'After PID reuse');
 await assert.rejects(fs.access(candidate),{code:'ENOENT'});
});
test('a previous boot cannot own a live PID with the same process start ticks',{skip:process.platform!=='linux'?'Requires Linux boot and process identity':false},async t=>{
 const {data,store,saved}=await configured(t),stat=await fs.readFile('/proc/self/stat','utf8'),startTime=stat.slice(stat.lastIndexOf(')')+1).trim().split(/\s+/)[19];
 await fs.writeFile(path.join(data,'shared-settings.json.lock'),JSON.stringify({version:1,pid:process.pid,bootId:'00000000-0000-0000-0000-000000000000',startTime}));
 await assert.doesNotReject(store.saveDraft({revision:saved.revision,patch:{review:{label:'After reboot'}}}));
});
test('two store instances in the same live process cannot write through an owned lock',{timeout:10000},async t=>{
 const {data,store,saved}=await configured(t),other=createSharedSettingsStore({data,env:{RECOVERY_MODE:'verify'}}),rename=fs.rename;
 let entered,release;const holding=new Promise(resolve=>entered=resolve),released=new Promise(resolve=>release=resolve);let writing,paused=false;
 try{
  fs.rename=async function(source,target){if(!paused&&target===path.join(data,'shared-settings.json')){paused=true;entered();await released;}return rename(source,target);};
  writing=store.saveDraft({revision:saved.revision,patch:{review:{label:'Owned operation'}}});await holding;
  await assert.rejects(other.saveDraft({revision:saved.revision,patch:{review:{label:'Concurrent overwrite'}}}),{code:'settings_busy'});
 }finally{release();await writing;fs.rename=rename;}
 assert.equal((await store.current()).draft.review.label,'Owned operation');
 assert.equal((await fs.readdir(data)).filter(name=>name.includes('.lock.owner-')).length,0);
});
test('a live subprocess excludes other writers and its crashed lifetime is reclaimable',{timeout:30000},async t=>{
 const {data,store,saved}=await configured(t);
 const program=`import fs from 'node:fs/promises';const {createSharedSettingsStore}=await import(process.argv[1]);const rename=fs.rename;fs.rename=async(a,b)=>{if(b.endsWith('shared-settings.json')){process.send({holding:true});await new Promise(resolve=>process.once('message',resolve));}return rename(a,b)};await createSharedSettingsStore({data:process.argv[2],env:{RECOVERY_MODE:'verify'}}).saveDraft({revision:process.argv[3],patch:{review:{label:'Subprocess'}}});process.disconnect();`;
 const child=spawn(process.execPath,['--input-type=module','--eval',program,new URL('./shared-settings.mjs',import.meta.url).href,data,saved.revision],{stdio:['ignore','ignore','pipe','ipc']});
 let diagnostics='';child.stderr.on('data',chunk=>diagnostics+=chunk);const exited=once(child,'exit');
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}});
 const [message]=await Promise.race([once(child,'message'),exited.then(()=>{throw Error('Subprocess exited before holding: '+diagnostics);})]);assert.equal(message.holding,true);
 await assert.rejects(store.saveDraft({revision:saved.revision,patch:{review:{label:'Concurrent parent'}}}),{code:'settings_busy'});
 child.kill('SIGKILL');await exited;
 await assert.doesNotReject(store.saveDraft({revision:saved.revision,patch:{review:{label:'After subprocess crash'}}}));
 assert.equal((await store.current()).draft.review.label,'After subprocess crash');
 assert.equal((await fs.readdir(data)).filter(name=>name.includes('.lock.owner-')).length,0);
});
test('advancing clock permits first-run saves and completed diagnostic cases do not block mappings',async t=>{
 let time=1700000000000;const data=await fixture(t),store=createSharedSettingsStore({data,env:{},now:()=>time});
 const first=await store.current();time+=100;
 const saved=await store.saveDraft({revision:first.revision,patch:{review:{libraryId:'movies'},radarr:{url:'http://127.0.0.1:7878',apiKey:'private'}}});
 const active=await store.applyGeneration({revision:saved.revision});
 await writeRecovery(data,{cases:{one:{status:'dry_run'},two:{status:'no_action'}}},'state.json');
 const changed=await store.saveDraft({revision:active.revision,patch:{review:{libraryId:'another'}}});
 await assert.doesNotReject(store.applyGeneration({revision:changed.revision}));
});
test('submitting an unchanged discovery cutoff keeps setup-time history selection',async t=>{
 let time=1700000000000;const {store,saved}=await configured(t,{now:()=>time});
 const unchanged=await store.saveDraft({revision:saved.revision,patch:{recovery:{...saved.draft.recovery}}});
 time+=60000;const applied=await store.applyGeneration({revision:unchanged.revision});
 assert.equal(applied.active.recovery.since,1700000060000);
});
test('external file-only exceptions enter active authority only through explicit resolution and apply',async t=>{
 const {data,store}=await legacyFixture(t);const imported=await store.current();await store.applyGeneration({revision:imported.revision});
 const legacy=JSON.parse(await fs.readFile(path.join(data,'recovery','config.json'),'utf8'));legacy.approvedCaseIds=['updated-case'];await writeRecovery(data,legacy);
 await assert.rejects(readActiveSettings(data),{code:'settings_private_changed'});
 assert.equal((await readActiveSettings(data,{checkPrivate:false})).review.libraryId,'movies');
 const resolved=await store.saveDraft({revision:(await store.current()).revision,patch:{},resolutions:['legacyFiles']});
 await store.applyGeneration({revision:resolved.revision});assert.deepEqual((await readActiveSettings(data)).recovery.approvedCaseIds,['updated-case']);
});
test('directory sync failure after rename reports ambiguity with a complete readable generation',{skip:process.platform==='win32'?'Directory fsync requires Linux':false},async t=>{
 const {data,store,saved}=await configured(t),open=fs.open;
 try{fs.open=async function(file,...args){const handle=await open.call(this,file,...args);if(file===data)handle.sync=async()=>{throw Object.assign(Error('Injected sync failure'),{code:'EIO'});};return handle;};await assert.rejects(store.applyGeneration({revision:saved.revision}),{code:'settings_commit_ambiguous'});}finally{fs.open=open;}
 assert.equal((await readActiveSettings(data)).generation,1);
});
test('off mode can activate a Review-only installation while incomplete configured connections refuse',async t=>{
 const data=await fixture(t),store=createSharedSettingsStore({data,env:{RECOVERY_MODE:'off'}}),first=await store.current();
 const saved=await store.saveDraft({revision:first.revision,patch:{review:{label:'Review only'}}});
 const applied=await store.applyGeneration({revision:saved.revision});assert.equal(applied.active.review.libraryId,'');assert.equal(applied.active.recovery.enabled,false);
 assert.equal((await readActiveSettings(data,{mode:'off'})).review.label,'Review only');
 await assert.rejects(readActiveSettings(data,{mode:'verify'}),{code:'settings_invalid'});
 assert.equal((await readActiveSettings(data,{mode:'verify',checkPrivate:false})).review.label,'Review only');
 const partial=await store.saveDraft({revision:applied.revision,patch:{radarr:{url:'http://127.0.0.1:7878'}}});
 await assert.rejects(store.applyGeneration({revision:partial.revision}),{code:'settings_invalid'});
});
test('managed startup refuses malformed or internally mixed authority',async t=>{
 const {data,store,saved}=await configured(t);await store.applyGeneration({revision:saved.revision});
 const file=path.join(data,'shared-settings.json'),doc=JSON.parse(await fs.readFile(file,'utf8'));doc.active.recovery.tdarrUrl='http://different:8266';await fs.writeFile(file,JSON.stringify(doc));
 await assert.rejects(readActiveSettings(data),{code:'settings_file_invalid'});
 await fs.writeFile(file,'{');await assert.rejects(readActiveSettings(data),{code:'settings_file_invalid'});
});
