import test from 'node:test';
import assert from 'node:assert/strict';
import {quotaFor,validateDeferredLimit,deferConfirmedLimit,inspectDeferredLimit,reconcileDeferredLimitIntent} from './deferred-limit.mjs';
import {HOLD_FOREVER as LIMIT_HOLD_UNTIL} from './tdarr-file-state.mjs';

const day=86400000,now=Date.UTC(2026,9,12,12),signature='quant_step_size larger than huff_lsbs';
function fixture(){
 const cfg={enabled:true,maxRepairsPerDay:2,libraryId:'library',sourceRoot:'/media/movies',mediaRoot:'/storage/movies',radarrRoot:'/radarr/movies',quarantineRoot:'/storage/.tdarr-corrupt'};
 const binding={movieFileId:11,historyId:21,downloadId:'download',sourceTitle:'Movie.Release',size:42,protocol:1,indexer:'Indexer',publishedDate:'2026-10-10'};
 const check={code:0,signal:null,error:null,timeout:false,stderr:'[truehd @ 0x1] '+signature};
 const c={id:'c'.repeat(24),status:'confirmed',movieId:1,file:'/media/movies/Movie/file.mkv',relative:'Movie/file.mkv',source:'/storage/movies/Movie/file.mkv',size:42,fp:'1:2:42:10:10',binding,
  evidence:{sourceFP:'1:2:42:10:10',sampleSHA256:'f'.repeat(64),signature,confirmed:new Date(now-1000).toISOString(),checks:[check,{...check,stderr:check.stderr.replace('0x1','0x2')}]}};
 // These are unrelated movies, not a fictional movie cooldown or parent repair.
 const old={id:'a'.repeat(24),movieId:2,mutationStarted:now-3600000,quarantine:'/storage/.tdarr-corrupt/old/original.mkv',cleanup:{approvedAt:null}};
 const second={id:'b'.repeat(24),movieId:3,mutationStarted:now-1000};
 const state={cases:{[old.id]:old,[second.id]:second,[c.id]:c}},events=[];
 let row={_id:c.file,DB:cfg.libraryId,TranscodeDecisionMaker:'Transcode error'},source={p:c.source,fp:c.fp,size:c.size},currentBinding=structuredClone(binding),sample=c.evidence.sampleSHA256;
 const deps={cfg,state,c,now,
  idle:async()=>{events.push('idle');},
  safeSource:async()=>{events.push('source');return {...source};},
  sample:async()=>{events.push('sample');return sample;},
  readBinding:async()=>{events.push('binding');return structuredClone(currentBinding);},
  phase:async(c,status,message)=>{events.push(status);Object.assign(c,{status,message});},
  td:async(route,body)=>{
   if(route==='/api/v2/cruddb'){assert.deepEqual(body,{collection:'FileJSONDB',mode:'getById',docID:c.file});events.push('read-row');return structuredClone(row);}
   assert.equal(route,'/api/v2/bulk-update-files');assert.deepEqual(body,{fileIds:[c.file],updatedObj:{TranscodeDecisionMaker:'Hold',holdUntil:LIMIT_HOLD_UNTIL}});events.push('write-hold');Object.assign(row,body.updatedObj);return 'OK';
  }};
 return {deps,c,cfg,state,old,second,events,get row(){return row;},set row(v){row=v;},get source(){return source;},set source(v){source=v;},set binding(v){currentBinding=v;},set sample(v){sample=v;}};
}

test('quota counts global mutation starts and releases capacity at the correct ranked expiry',()=>{
 const f=fixture(),deadline=now-3600000+day;
 assert.deepEqual(quotaFor(f.deps),{retryAt:new Date(deadline).toISOString(),caseIds:[f.old.id,f.second.id]});
 f.state.cases.expired={id:'expired',mutationStarted:now-day};f.state.cases.zero={id:'zero',mutationStarted:0};
 assert.equal(quotaFor({...f.deps,now:deadline}),null);
 const over=fixture();over.cfg.maxRepairsPerDay=3;over.state.cases={};
 for(let i=0;i<5;i++)over.state.cases['case'+i]={id:'case'+i,mutationStarted:now-10000+i*1000};
 assert.equal(quotaFor(over.deps).retryAt,new Date(now-8000+day).toISOString());
 assert.ok(quotaFor({...over.deps,now:now-9000+day}));
 assert.equal(quotaFor({...over.deps,now:now-8000+day}),null);
});

test('invalid limits, mappings and mutation timestamps cannot authorize a retry',()=>{
 for(const limit of [0,-1,1.5,NaN,Infinity,'2']){const f=fixture();f.cfg.maxRepairsPerDay=limit;assert.throws(()=>quotaFor(f.deps),/configuration/);}
 for(const started of [-1,NaN,Infinity,'123',LIMIT_HOLD_UNTIL]){const f=fixture();f.old.mutationStarted=started;assert.throws(()=>quotaFor(f.deps),/timestamp/);}
 for(const key of ['sourceRoot','mediaRoot','radarrRoot','quarantineRoot']){const f=fixture();f.cfg[key]='/storage/../outside';assert.throws(()=>quotaFor(f.deps),/mapping/);}
 const f=fixture();f.cfg.enabled='true';assert.throws(()=>quotaFor(f.deps),/configuration/);
});

test('quota deferral journals before exact Hold and preserves source evidence and other quarantine cases',async()=>{
 const f=fixture(),parent=structuredClone(f.old),evidence=structuredClone(f.c.evidence);
 assert.equal(await deferConfirmedLimit(f.deps),true);
 assert.equal(f.c.status,'deferred_limit');assert.equal(f.c.skipCurrentEdition,true);assert.equal(f.c.preservedSourceFP,f.c.fp);
 assert.equal(f.row.TranscodeDecisionMaker,'Hold');assert.equal(f.row.holdUntil,LIMIT_HOLD_UNTIL);
 assert.equal(f.c.nextRetryAt,new Date(f.old.mutationStarted+day).toISOString());
 assert.deepEqual(f.c.evidence,evidence);assert.deepEqual(f.old,parent);assert.equal(f.c.quarantine,undefined);assert.equal(f.c.mutationStarted,undefined);
 assert(f.events.indexOf('defer_limit_intent')<f.events.indexOf('write-hold'));assert.equal(f.events.filter(x=>x==='write-hold').length,1);
 assert.deepEqual(f.c.deferredLimit.binding,f.c.binding);assert.equal(f.c.deferredLimit.mediaRoot,f.cfg.mediaRoot);
});

test('available quota and disabled automation produce no mutation or new journal',async()=>{
 for(const change of [f=>{f.cfg.maxRepairsPerDay=3;},f=>{f.cfg.enabled=false;}]){
  const f=fixture();change(f);assert.equal(await deferConfirmedLimit(f.deps),false);assert.deepEqual(f.events,[]);assert.equal(f.c.deferredLimit,undefined);
 }
});

test('historical frozen approvals never enter the automatic quota path',async()=>{
 const f=fixture();f.c.approval={signature,checks:[{},{}]};await assert.rejects(deferConfirmedLimit(f.deps),/separate/);assert.deepEqual(f.events,[]);
});

test('missing, conflicting, operational and timed-out evidence never authorizes a Hold',async()=>{
 const changes=[
  e=>{delete e.sourceFP;},e=>{e.sourceFP='other';},e=>{e.sampleSHA256='not-a-hash';},e=>{e.confirmed=new Date(now+1000).toISOString();},
  e=>{e.checks=[e.checks[0]];},e=>{e.checks[1]={code:0,stderr:''};},e=>{e.checks[1].timeout=true;},e=>{e.checks[1].signal='SIGKILL';},
  e=>{e.checks[1].stderr+='\nPermission denied';},e=>{delete e.checks[1].code;},e=>{e.signature='Conversion failed!';}
 ];
 for(const change of changes){const f=fixture();change(f.c.evidence);await assert.rejects(deferConfirmedLimit(f.deps),/evidence/);assert(!f.events.includes('write-hold'));}
});

test('source fingerprint, bytes, path and current binding must still match before Hold',async()=>{
 const changes=[f=>{f.source={...f.source,fp:'changed'};},f=>{f.source={...f.source,size:99};},f=>{f.source={...f.source,p:'/other/path'};},f=>{f.sample='0'.repeat(64);},f=>{f.binding={...f.c.binding,movieFileId:99};}];
 for(const change of changes){const f=fixture();change(f);await assert.rejects(deferConfirmedLimit(f.deps),/changed/);assert(!f.events.includes('write-hold'));}
});

test('uncertain existing mutations and unsafe mappings are not resumable',async()=>{
 const changes=[f=>{f.c.mutationStarted=now-1000;},f=>{f.c.mutationStarted=NaN;},f=>{f.c.mutationStarted='0';},f=>{f.c.quarantine='/old/quarantine';},f=>{f.c.profileId=99;},f=>{f.c.relative='../file.mkv';},f=>{f.c.file='/media/movies/Other/file.mkv';},f=>{f.c.source='/storage/movies/Other/file.mkv';}];
 for(const change of changes){const f=fixture();change(f);await assert.rejects(deferConfirmedLimit(f.deps),/eligible|mapping/);assert(!f.events.includes('write-hold'));}
});

test('exact Tdarr source and library are required and active/successful jobs are not held',async()=>{
 const changes=[f=>{f.row={...f.row,_id:'/media/movies/Other/file.mkv'};},f=>{f.row={...f.row,DB:'other-library'};},f=>{f.row={...f.row,TranscodeDecisionMaker:'Transcoding'};},f=>{f.row={...f.row,TranscodeDecisionMaker:'Transcode success'};}];
 for(const change of changes){const f=fixture();change(f);await assert.rejects(deferConfirmedLimit(f.deps),/entry|eligible/);assert(!f.events.includes('write-hold'));}
});

test('changed source, mapping or worker after journal intent prevents the Hold mutation',async()=>{
 for(const change of [f=>{f.source={...f.source,fp:'changed'};},f=>{f.cfg.radarrRoot='/different/movies';},f=>{f.c.deferredLimit.binding.movieFileId=99;}]){
  const f=fixture(),phase=f.deps.phase;f.deps.phase=async(...args)=>{await phase(...args);if(args[1]==='defer_limit_intent')change(f);};
  await assert.rejects(deferConfirmedLimit(f.deps),/changed|journal/);assert.equal(f.c.status,'defer_limit_intent');assert(!f.events.includes('write-hold'));
 }
 const f=fixture();let calls=0;f.deps.idle=async()=>{if(++calls===2)throw Error('Tdarr is still processing source');};
 await assert.rejects(deferConfirmedLimit(f.deps),/processing/);assert.equal(f.c.status,'defer_limit_intent');assert(!f.events.includes('write-hold'));
});

test('a successful API text reply is insufficient without acknowledged exact Hold and unchanged source',async()=>{
 for(const change of [f=>{f.row.holdUntil=0;},f=>{f.row.TranscodeDecisionMaker='Queued';},f=>{f.source={...f.source,fp:'changed'};}]){
  const f=fixture(),td=f.deps.td;f.deps.td=async(route,body)=>{const r=await td(route,body);if(route==='/api/v2/bulk-update-files')change(f);return r;};
  await assert.rejects(deferConfirmedLimit(f.deps),/uncertain|changed/);assert.equal(f.c.status,'defer_limit_intent');assert.equal(f.c.skipCurrentEdition,undefined);
 }
});

test('an existing permanent Hold is journaled without a redundant write',async()=>{
 const f=fixture();f.row.TranscodeDecisionMaker='Hold';f.row.holdUntil=String(LIMIT_HOLD_UNTIL);
 assert.equal(await deferConfirmedLimit(f.deps),true);assert.equal(f.c.status,'deferred_limit');assert(!f.events.includes('write-hold'));
});

test('inspection waits or becomes ready without decoding, writing, or changing evidence',async()=>{
 const f=fixture();await deferConfirmedLimit(f.deps);f.events.length=0;const before=structuredClone(f.c);
 assert.deepEqual(await inspectDeferredLimit(f.deps),{status:'waiting_limit',...quotaFor(f.deps)});
 const later=now+day;assert.deepEqual(await inspectDeferredLimit({...f.deps,now:later}),{status:'ready'});
 f.cfg.enabled=false;assert.deepEqual(await inspectDeferredLimit({...f.deps,now:later}),{status:'disabled'});
 assert.deepEqual(f.c,before);assert(!f.events.includes('write-hold'));assert.equal(f.row.TranscodeDecisionMaker,'Hold');
});

test('frozen mapping, journal, binding, evidence and permanent Hold must stay exact while waiting',async()=>{
 const changes=[f=>{f.cfg.libraryId='changed';},f=>{f.cfg.sourceRoot='/other/movies';},f=>{f.cfg.mediaRoot='/different/movies';},f=>{f.cfg.radarrRoot='/other/movies';},f=>{f.cfg.quarantineRoot='/other/quarantine';},f=>{f.c.deferredLimit.sourceFP='changed';},f=>{f.c.deferredLimit.binding.movieFileId=99;},f=>{f.c.deferredLimit.caseIds=[];},f=>{f.c.evidence.checks[1].timeout=true;},f=>{f.binding={...f.c.binding,movieFileId:99};},f=>{f.sample='0'.repeat(64);},f=>{f.row.TranscodeDecisionMaker='Queued';},f=>{f.row.holdUntil=0;}];
 for(const change of changes){const f=fixture();await deferConfirmedLimit(f.deps);change(f);await assert.rejects(inspectDeferredLimit({...f.deps,now:now+day}),/journal|mapping|evidence|changed|held/);assert.equal(f.events.filter(x=>x==='write-hold').length,1);}
});

test('accepted Hold with a lost response reconciles by reads only; unknown writes never replay',async()=>{
 const f=fixture(),td=f.deps.td;f.deps.td=async(route,body)=>{const r=await td(route,body);if(route==='/api/v2/bulk-update-files')throw Error('API timeout');return r;};
 await assert.rejects(deferConfirmedLimit(f.deps),/timeout/);assert.equal(f.c.status,'defer_limit_intent');assert.equal(f.c.skipCurrentEdition,undefined);f.events.length=0;
 assert.equal(await reconcileDeferredLimitIntent(f.deps),true);assert.equal(f.c.status,'deferred_limit');assert.equal(f.c.skipCurrentEdition,true);assert.equal(f.c.preservedSourceFP,f.c.fp);assert(!f.events.includes('write-hold'));
 f.c.status='defer_limit_intent';f.row.TranscodeDecisionMaker='Queued';await assert.rejects(reconcileDeferredLimitIntent(f.deps),/acknowledged/);assert(!f.events.includes('write-hold'));
 f.row.TranscodeDecisionMaker='Hold';f.c.deferredLimit.sourceFP='changed';await assert.rejects(reconcileDeferredLimitIntent(f.deps),/journal/);assert(!f.events.includes('write-hold'));
});

test('pure frozen validation rejects the wrong phase and returns the exact usable journal',async()=>{
 const f=fixture();await deferConfirmedLimit(f.deps);assert.equal(validateDeferredLimit(f.deps),f.c.deferredLimit);
 f.c.status='quarantine_intent';assert.throws(()=>validateDeferredLimit(f.deps),/journal/);
});
