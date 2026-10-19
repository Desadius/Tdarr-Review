import test from 'node:test';
import assert from 'node:assert/strict';
import {cooldownFor,deferConfirmedReplacement,inspectDeferredReplacement,reconcileDeferredIntent} from './replacement-gate.mjs';
import {HOLD_FOREVER as DEFERRED_HOLD_UNTIL} from './tdarr-file-state.mjs';

const day=86400000,now=Date.UTC(2026,9,11,12),signature='quant_step_size larger than huff_lsbs';
function fixture(){
 const cfg={enabled:true,movieCooldownDays:30,maxRepairsPerDay:3,sourceRoot:'/media/movies',libraryId:'library'};
 const binding={movieFileId:11,historyId:21,downloadId:'different-download',sourceTitle:'Movie.New.Edition',size:43,protocol:1,indexer:'Indexer',publishedDate:'2026-10-10'};
 const check={code:0,signal:null,error:null,timeout:false,stderr:'[truehd @ 0x1] '+signature};
 const c={id:'b'.repeat(24),movieId:1,file:'/media/movies/Movie/new.mkv',relative:'Movie/new.mkv',source:'/storage/movies/Movie/new.mkv',size:42,fp:'1:2:42:10:10',binding,
  evidence:{sourceFP:'1:2:42:10:10',sampleSHA256:'f'.repeat(64),signature,confirmed:new Date(now-1000).toISOString(),checks:[check,{...check,stderr:check.stderr.replace('0x1','0x2')}]}};
 const old={id:'a'.repeat(24),movieId:1,mutationStarted:now-3600000,binding:{movieFileId:10,sourceTitle:'Movie.Old.Edition'},replacement:{movieFileId:11},replacementRelative:c.relative,replacementSourceFP:c.fp,quarantine:'/storage/.tdarr-corrupt/old/original.mkv',cleanup:{approvedAt:null}};
 const state={cases:{[old.id]:old,[c.id]:c}},events=[];
 let row={_id:c.file,DB:cfg.libraryId,TranscodeDecisionMaker:'Transcode error'},source={p:c.source,fp:c.fp,size:c.size},currentBinding=structuredClone(binding);
 const deps={cfg,state,c,now,
  idle:async()=>{events.push('idle');},
  safeSource:async()=>{events.push('source');return {...source};},
  sample:async()=>{events.push('sample');return c.evidence.sampleSHA256;},
  readBinding:async()=>{events.push('binding');return structuredClone(currentBinding);},
  phase:async(c,status,message)=>{events.push(status);Object.assign(c,{status,message});},
  td:async(route,body)=>{
   if(route==='/api/v2/cruddb'){assert.equal(body.collection,'FileJSONDB');assert.equal(body.docID,c.file);events.push('read-row');return structuredClone(row);}
   assert.equal(route,'/api/v2/bulk-update-files');assert.deepEqual(body.fileIds,[c.file]);events.push('write-hold');Object.assign(row,body.updatedObj);return 'OK';
  }};
 return {deps,c,cfg,state,old,events,get row(){return row;},set row(v){row=v;},get source(){return source;},set source(v){source=v;},set binding(v){currentBinding=v;}};
}

test('cooldown is per movie, skips the current case and uses every blocker deadline',()=>{
 const f=fixture(),later={id:'c'.repeat(24),movieId:1,mutationStarted:now-1000};f.state.cases[later.id]=later;
 f.state.cases.other={id:'other',movieId:2,mutationStarted:now};f.c.mutationStarted=now;
 const gate=cooldownFor(f.deps);assert.equal(gate.retryAt,new Date(later.mutationStarted+30*day).toISOString());assert.deepEqual(gate.caseIds,[f.old.id,later.id]);assert.deepEqual(gate.parentCaseIds,[f.old.id]);
 assert.equal(cooldownFor({...f.deps,now:now+31*day}),null);
 assert.throws(()=>cooldownFor({...f.deps,cfg:{...f.cfg,movieCooldownDays:NaN}}),/Invalid/);
});

test('confirmed distinct replacement is journaled and held without touching parent quarantine',async()=>{
 const f=fixture(),parent=structuredClone(f.old);assert.equal(await deferConfirmedReplacement(f.deps),true);
 assert.equal(f.c.status,'deferred_cooldown');assert.equal(f.c.skipCurrentEdition,true);assert.equal(f.c.preservedSourceFP,f.c.fp);
 assert.equal(f.c.deferredCooldown.sourceFP,f.c.fp);assert.deepEqual(f.c.deferredCooldown.parentCaseIds,[f.old.id]);
 assert.equal(f.c.nextRetryAt,new Date(f.old.mutationStarted+30*day).toISOString());assert.equal(f.row.holdUntil,DEFERRED_HOLD_UNTIL);
 assert.deepEqual(f.old,parent);assert(!f.c.quarantine);assert(!f.c.mutationStarted);
 assert(f.events.indexOf('defer_cooldown_intent')<f.events.indexOf('write-hold'));
 assert.equal(f.events.filter(x=>x==='idle').length,2);assert.equal(f.events.filter(x=>x==='binding').length,3);
});

test('absence of cooldown and disabled external changes do not write a Hold',async()=>{
 for(const change of [f=>{f.cfg.movieCooldownDays=0;},f=>{f.cfg.enabled=false;}]){
  const f=fixture();change(f);assert.equal(await deferConfirmedReplacement(f.deps),false);assert.deepEqual(f.events,[]);
 }
});

test('only actual repeated structural source evidence can defer',async()=>{
 const changes=[
  e=>{delete e.sourceFP;},e=>{e.sourceFP='other';},e=>{e.sampleSHA256='not-a-hash';},e=>{e.confirmed=new Date(now+1000).toISOString();},
  e=>{e.checks=[e.checks[0]];},e=>{e.checks[1]={code:0,stderr:''};},e=>{e.checks[1].timeout=true;},
  e=>{e.checks[1].stderr+='\nPermission denied';},e=>{e.signature='Conversion failed!';}
 ];
 for(const change of changes){const f=fixture();change(f.c.evidence);await assert.rejects(deferConfirmedReplacement(f.deps),/evidence/);assert(!f.events.includes('write-hold'));}
});

test('same release or old movieFile ID never qualifies as a distinct replacement',async()=>{
 for(const change of [f=>{f.old.binding.sourceTitle=f.c.binding.sourceTitle;},f=>{f.old.binding.movieFileId=f.c.binding.movieFileId;}]){
  const f=fixture();change(f);await assert.rejects(deferConfirmedReplacement(f.deps),/distinct/);assert(!f.events.includes('write-hold'));
 }
});

test('source identity, hash and current binding are verified before Hold',async()=>{
 const changes=[f=>{f.source={...f.source,fp:'changed'};},f=>{f.deps.sample=async()=> '0'.repeat(64);},f=>{f.binding={...f.c.binding,movieFileId:99};}];
 for(const change of changes){const f=fixture();change(f);await assert.rejects(deferConfirmedReplacement(f.deps),/changed/);assert(!f.events.includes('write-hold'));}
});

test('exact Tdarr path, library and eligible state are required before Hold',async()=>{
 const changes=[f=>{f.row={...f.row,_id:'/media/movies/Other/file.mkv'};},f=>{f.row={...f.row,DB:'other-library'};},f=>{f.row={...f.row,TranscodeDecisionMaker:'Transcoding'};}];
 for(const change of changes){const f=fixture();change(f);await assert.rejects(deferConfirmedReplacement(f.deps),/entry|eligible/);assert(!f.events.includes('write-hold'));}
});

test('a worker appearing after intent prevents the Hold mutation',async()=>{
 const f=fixture();let checks=0;f.deps.idle=async()=>{if(++checks===2)throw Error('Tdarr is still processing source');};
 await assert.rejects(deferConfirmedReplacement(f.deps),/processing/);assert.equal(f.c.status,'defer_cooldown_intent');assert(!f.events.includes('write-hold'));
});

test('source change after intent prevents the Hold mutation',async()=>{
 const f=fixture(),phase=f.deps.phase;f.deps.phase=async(...args)=>{await phase(...args);if(args[1]==='defer_cooldown_intent')f.source={...f.source,fp:'changed'};};
 await assert.rejects(deferConfirmedReplacement(f.deps),/source changed/);assert.equal(f.c.status,'defer_cooldown_intent');assert(!f.events.includes('write-hold'));
});

test('uncertain transport preserves intent and never permits a blind retry',async()=>{
 const f=fixture(),td=f.deps.td;f.deps.td=async(route,body)=>{const result=await td(route,body);if(route==='/api/v2/bulk-update-files')throw Error('API timeout');return result;};
 await assert.rejects(deferConfirmedReplacement(f.deps),/timeout/);assert.equal(f.c.status,'defer_cooldown_intent');assert.equal(f.row.TranscodeDecisionMaker,'Hold');assert(!f.c.skipCurrentEdition);
 await assert.rejects(inspectDeferredReplacement(f.deps),/journal/);
});

test('Hold and identity are confirmed again after writing',async()=>{
 for(const change of [f=>{f.row.holdUntil=0;},f=>{f.source={...f.source,fp:'changed'};}]){
  const f=fixture(),td=f.deps.td;f.deps.td=async(route,body)=>{const result=await td(route,body);if(route==='/api/v2/bulk-update-files')change(f);return result;};
  await assert.rejects(deferConfirmedReplacement(f.deps),/uncertain|changed/);assert.equal(f.c.status,'defer_cooldown_intent');assert(!f.c.skipCurrentEdition);
 }
});

test('inspection preserves Hold and reports cooldown, quota or ready without decoding',async()=>{
 const f=fixture();await deferConfirmedReplacement(f.deps);f.events.length=0;
 assert.equal((await inspectDeferredReplacement(f.deps)).status,'waiting_cooldown');
 const later=now+31*day;assert.deepEqual(await inspectDeferredReplacement({...f.deps,now:later}),{status:'ready'});
 f.cfg.maxRepairsPerDay=1;f.state.cases.other={id:'other',movieId:2,mutationStarted:later-1000};
 const limit=await inspectDeferredReplacement({...f.deps,now:later});assert.equal(limit.status,'waiting_limit');assert.equal(limit.retryAt,new Date(later-1000+day).toISOString());
 f.cfg.enabled=false;assert.deepEqual(await inspectDeferredReplacement({...f.deps,now:later}),{status:'disabled'});
 assert(!f.events.includes('write-hold'));assert.equal(f.row.TranscodeDecisionMaker,'Hold');
});

test('deferred journal, source, binding and exact Hold cannot drift',async()=>{
 const changes=[f=>{f.c.size++;},f=>{f.c.fp='changed';},f=>{f.cfg.libraryId='changed';},f=>{f.c.deferredCooldown.binding.movieFileId++;},f=>{f.source={...f.source,fp:'changed'};},f=>{f.binding={...f.c.binding,movieFileId:99};},f=>{f.row.TranscodeDecisionMaker='Queued';},f=>{f.row.holdUntil=0;}];
 for(const change of changes){const f=fixture();await deferConfirmedReplacement(f.deps);change(f);await assert.rejects(inspectDeferredReplacement({...f.deps,now:now+31*day}),/evidence|journal|changed|held/);}
});

test('a timed-out accepted Hold is reconciled by reads only; unknown intent is never replayed',async()=>{
 const f=fixture(),td=f.deps.td;f.deps.td=async(route,body)=>{const result=await td(route,body);if(route==='/api/v2/bulk-update-files')throw Error('timeout');return result;};
 await assert.rejects(deferConfirmedReplacement(f.deps),/timeout/);f.events.length=0;
 await reconcileDeferredIntent(f.deps);assert.equal(f.c.status,'deferred_cooldown');assert(!f.events.includes('write-hold'));
 f.c.status='defer_cooldown_intent';f.row.TranscodeDecisionMaker='Queued';await assert.rejects(reconcileDeferredIntent(f.deps),/acknowledged/);assert(!f.events.includes('write-hold'));
 f.row.TranscodeDecisionMaker='Hold';f.c.deferredCooldown.sourceFP='changed';await assert.rejects(reconcileDeferredIntent(f.deps),/journal/);
});
