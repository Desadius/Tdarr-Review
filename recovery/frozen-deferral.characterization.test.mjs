import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {cooldownFor,deferConfirmedReplacement,inspectDeferredReplacement,reconcileDeferredIntent} from './replacement-gate.mjs';
import {quotaFor,deferConfirmedLimit,inspectDeferredLimit,reconcileDeferredLimitIntent} from './deferred-limit.mjs';

// Golden master of both frozen-deferral kinds (movie cooldown, daily limit): for every scenario the
// return value or error, the order of adapter calls, the case afterwards and the Tdarr row are
// pinned in fixtures/frozen-deferral-golden.json. UPDATE_GOLDEN=1 rewrites it from the current code.
const kinds={
 cooldown:{gate:cooldownFor,defer:deferConfirmedReplacement,inspect:inspectDeferredReplacement,reconcile:reconcileDeferredIntent,intent:'defer_cooldown_intent',journal:'deferredCooldown'},
 limit:{gate:quotaFor,defer:deferConfirmedLimit,inspect:inspectDeferredLimit,reconcile:reconcileDeferredLimitIntent,intent:'defer_limit_intent',journal:'deferredLimit'},
};
const golden=new URL('../fixtures/frozen-deferral-golden.json',import.meta.url);
const day=86400000,now=Date.UTC(2026,9,12,12),signature='quant_step_size larger than huff_lsbs';

function fixture(kind){
 const cfg={enabled:true,movieCooldownDays:30,maxRepairsPerDay:kind==='limit'?2:3,libraryId:'library',sourceRoot:'/media/movies',mediaRoot:'/storage/movies',radarrRoot:'/radarr/movies',quarantineRoot:'/storage/.tdarr-corrupt'};
 const binding={movieFileId:11,historyId:21,downloadId:'download',sourceTitle:'Movie.New.Release',size:42,protocol:1,indexer:'Indexer',publishedDate:'2026-10-10'};
 const check={code:0,signal:null,error:null,timeout:false,stderr:'[truehd @ 0x1] '+signature};
 const c={id:'c'.repeat(24),status:'confirmed',movieId:1,file:'/media/movies/Movie/file.mkv',relative:'Movie/file.mkv',source:'/storage/movies/Movie/file.mkv',size:42,fp:'1:2:42:10:10',binding,
  evidence:{sourceFP:'1:2:42:10:10',sampleSHA256:'f'.repeat(64),signature,confirmed:new Date(now-1000).toISOString(),checks:[check,{...check,stderr:check.stderr.replace('0x1','0x2')}]}};
 // Cooldown: an earlier repair of the same movie. Limit: two repairs of other movies fill the quota.
 const others=kind==='cooldown'
  ?[{id:'a'.repeat(24),movieId:1,mutationStarted:now-3600000,binding:{movieFileId:10,sourceTitle:'Movie.Old.Release'},replacement:{movieFileId:11},replacementRelative:c.relative,replacementSourceFP:c.fp,quarantine:'/storage/.tdarr-corrupt/old/original.mkv'}]
  :[{id:'a'.repeat(24),movieId:2,mutationStarted:now-3600000,quarantine:'/storage/.tdarr-corrupt/old/original.mkv'},{id:'b'.repeat(24),movieId:3,mutationStarted:now-1000}];
 const state={cases:Object.fromEntries([...others,c].map(x=>[x.id,x]))},events=[];
 const f={cfg,state,c,events,now,row:{_id:c.file,DB:cfg.libraryId,TranscodeDecisionMaker:'Transcode error'},source:{p:c.source,fp:c.fp,size:c.size},binding:structuredClone(binding),sample:c.evidence.sampleSHA256,
  idleCalls:0,idleFailsOn:0,ignoreHold:false,holdTransport:null,rowMissing:false};
 f.deps=()=>({cfg,state,c,now:f.now,
  idle:async()=>{events.push('idle');if(++f.idleCalls===f.idleFailsOn)throw Error('Tdarr is still processing source');},
  safeSource:async()=>{events.push('source');return {...f.source};},
  sample:async()=>{events.push('sample');return f.sample;},
  readBinding:async()=>{events.push('binding');return structuredClone(f.binding);},
  phase:async(x,status,message)=>{events.push('phase:'+status);Object.assign(x,{status,message});},
  td:async(route,body)=>{
   if(route==='/api/v2/cruddb'){events.push('read-row');return f.rowMissing?null:structuredClone(f.row);}
   events.push('write:'+JSON.stringify(body));if(f.holdTransport)throw Error(f.holdTransport);if(!f.ignoreHold)Object.assign(f.row,body.updatedObj);return 'OK';
  }});
 return f;
}

async function outcome(f,run){
 let result,error;try{result=await run(f.deps());}catch(e){error=e.message;}
 const journal=f.c.deferredCooldown??f.c.deferredLimit;
 return {result:result??null,error:error??null,events:f.events,case:{status:f.c.status,message:f.c.message??null,nextRetryAt:f.c.nextRetryAt??null,skipCurrentEdition:f.c.skipCurrentEdition??null,preservedSourceFP:f.c.preservedSourceFP??null,journal:journal??null},row:f.row};
}

// A case already deferred by the current code, then put into the requested phase.
async function deferred(kind,status){
 const f=fixture(kind),k=kinds[kind];assert.equal(await k.defer(f.deps()),true);
 f.events.length=0;f.idleCalls=0;f.c.status=status;return f;
}

const scenarios={
 'defer: success':async kind=>outcome(fixture(kind),kinds[kind].defer),
 'defer: no gate':async kind=>{const f=fixture(kind);if(kind==='cooldown')f.cfg.movieCooldownDays=0;else f.cfg.maxRepairsPerDay=5;return outcome(f,kinds[kind].defer);},
 'defer: Verify (enabled false)':async kind=>{const f=fixture(kind);f.cfg.enabled=false;return outcome(f,kinds[kind].defer);},
 'defer: evidence from another source':async kind=>{const f=fixture(kind);f.c.evidence.sourceFP='other';return outcome(f,kinds[kind].defer);},
 'defer: single decode':async kind=>{const f=fixture(kind);f.c.evidence.checks.pop();return outcome(f,kinds[kind].defer);},
 'defer: source identity changed':async kind=>{const f=fixture(kind);f.source.fp='9:9:42:10:10';return outcome(f,kinds[kind].defer);},
 'defer: Radarr binding changed':async kind=>{const f=fixture(kind);f.binding.historyId=99;return outcome(f,kinds[kind].defer);},
 'defer: sample changed':async kind=>{const f=fixture(kind);f.sample='e'.repeat(64);return outcome(f,kinds[kind].defer);},
 'defer: Tdarr state not eligible':async kind=>{const f=fixture(kind);f.row.TranscodeDecisionMaker='Transcoding';return outcome(f,kinds[kind].defer);},
 'defer: Tdarr row missing':async kind=>{const f=fixture(kind);f.rowMissing=true;return outcome(f,kinds[kind].defer);},
 'defer: Tdarr row of another library':async kind=>{const f=fixture(kind);f.row.DB='other';return outcome(f,kinds[kind].defer);},
 'defer: worker appears after intent':async kind=>{const f=fixture(kind);f.idleFailsOn=2;return outcome(f,kinds[kind].defer);},
 'defer: Hold not acknowledged':async kind=>{const f=fixture(kind);f.ignoreHold=true;return outcome(f,kinds[kind].defer);},
 'defer: Hold transport error':async kind=>{const f=fixture(kind);f.holdTransport='API /api/v2/bulk-update-files HTTP 502';return outcome(f,kinds[kind].defer);},
 'defer: already held':async kind=>{const f=fixture(kind);Object.assign(f.row,{TranscodeDecisionMaker:'Hold',holdUntil:253402300799000});return outcome(f,kinds[kind].defer);},
 'defer: already quarantined':async kind=>{const f=fixture(kind);f.c.quarantine='/storage/.tdarr-corrupt/x/file.mkv';return outcome(f,kinds[kind].defer);},
 'defer: cooldown parent is the same edition':async kind=>{const f=fixture(kind);for(const x of Object.values(f.state.cases))if(x!==f.c)x.binding={movieFileId:11,sourceTitle:'Movie.New.Release'};return outcome(f,kinds[kind].defer);},
 'inspect: waiting':async kind=>{const f=await deferred(kind,kinds[kind].journal==='deferredCooldown'?'deferred_cooldown':'deferred_limit');return outcome(f,kinds[kind].inspect);},
 'inspect: ready':async kind=>{const f=await deferred(kind,kinds[kind].journal==='deferredCooldown'?'deferred_cooldown':'deferred_limit');f.now=now+31*day;return outcome(f,kinds[kind].inspect);},
 'inspect: cooldown over, quota full':async kind=>{const f=await deferred(kind,kinds[kind].journal==='deferredCooldown'?'deferred_cooldown':'deferred_limit');f.now=now+31*day;for(let i=0;i<3;i++)f.state.cases['q'+i]={id:'q'+i,movieId:9,mutationStarted:f.now-1000*(i+1)};return outcome(f,kinds[kind].inspect);},
 'inspect: Verify (enabled false)':async kind=>{const f=await deferred(kind,kinds[kind].journal==='deferredCooldown'?'deferred_cooldown':'deferred_limit');f.cfg.enabled=false;return outcome(f,kinds[kind].inspect);},
 'inspect: Hold released':async kind=>{const f=await deferred(kind,kinds[kind].journal==='deferredCooldown'?'deferred_cooldown':'deferred_limit');f.row.TranscodeDecisionMaker='Queued';return outcome(f,kinds[kind].inspect);},
 'inspect: journal file drifted':async kind=>{const f=await deferred(kind,kinds[kind].journal==='deferredCooldown'?'deferred_cooldown':'deferred_limit');f.c[kinds[kind].journal].file='/media/movies/Other/file.mkv';return outcome(f,kinds[kind].inspect);},
 'inspect: library changed':async kind=>{const f=await deferred(kind,kinds[kind].journal==='deferredCooldown'?'deferred_cooldown':'deferred_limit');f.cfg.libraryId='other';f.row.DB='other';return outcome(f,kinds[kind].inspect);},
 'inspect: source changed':async kind=>{const f=await deferred(kind,kinds[kind].journal==='deferredCooldown'?'deferred_cooldown':'deferred_limit');f.source.fp='9:9:42:10:10';return outcome(f,kinds[kind].inspect);},
 'inspect: wrong phase':async kind=>{const f=await deferred(kind,kinds[kind].intent);return outcome(f,kinds[kind].inspect);},
 'reconcile: acknowledged Hold':async kind=>{const f=await deferred(kind,kinds[kind].intent);delete f.c.skipCurrentEdition;delete f.c.preservedSourceFP;delete f.c.nextRetryAt;return outcome(f,kinds[kind].reconcile);},
 'reconcile: Hold missing':async kind=>{const f=await deferred(kind,kinds[kind].intent);f.row.TranscodeDecisionMaker='Transcode error';delete f.row.holdUntil;return outcome(f,kinds[kind].reconcile);},
 'reconcile: wrong phase':async kind=>{const f=await deferred(kind,'deferred_'+kind);return outcome(f,kinds[kind].reconcile);},
 'reconcile: worker active':async kind=>{const f=await deferred(kind,kinds[kind].intent);f.idleFailsOn=1;return outcome(f,kinds[kind].reconcile);},
 'gate':async kind=>{const f=fixture(kind);return {value:kinds[kind].gate(f.deps()),later:kinds[kind].gate({...f.deps(),now:now+31*day})};},
};

async function run(){const result={};for(const kind of Object.keys(kinds))for(const [name,scenario] of Object.entries(scenarios))result[kind+' | '+name]=await scenario(kind);return JSON.parse(JSON.stringify(result));}

test('both frozen-deferral kinds keep their recorded behaviour in every scenario',async()=>{
 const actual=await run();
 if(process.env.UPDATE_GOLDEN==='1'){await fs.writeFile(golden,JSON.stringify(actual,null,1)+'\n');return;}
 const expected=JSON.parse(await fs.readFile(golden,'utf8'));
 assert.deepEqual(Object.keys(actual),Object.keys(expected));
 for(const key of Object.keys(expected))assert.deepEqual(actual[key],expected[key],key);
});
