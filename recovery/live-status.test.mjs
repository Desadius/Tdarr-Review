import test from 'node:test';
import assert from 'node:assert/strict';
import {createDecodeProgressParser,createLiveStatusPublisher} from './live-status.mjs';
import {publishRecoveryStatus} from './waiting-source.mjs';

const NOW=Date.parse('2026-10-11T12:00:00Z');
function fixture(){
 let now=NOW,reads=0,timer=null,clears=0;
 const c={id:'case',relative:'Movie/file.mkv',status:'verifying',updated:new Date(now).toISOString()},imported={id:'imported',relative:'Other/old.mkv',replacementRelative:'Other/new.mkv',status:'replacement_imported',updated:new Date(now-60000).toISOString()};
 const state={cases:{case:c,imported}},snapshots=[],errors=[];
 const deps={getState:()=>state,clock:()=>now,readTdarrFiles:async()=>{reads++;return [{_id:'/media/movies/Other/new.mkv',DB:'library',TranscodeDecisionMaker:'Queued',private:'secret'}]},
  publish:({state,tdarrFiles,decorate})=>publishRecoveryStatus({cfg:{mediaRoot:'/storage/movies',sourceRoot:'/media/movies',libraryId:'library'},state,tdarrFiles,atomic:async(_,v)=>snapshots.push(decorate(v))}),
  onError:e=>errors.push(e.message),setIntervalFn:fn=>{assert.equal(timer,null);timer=fn;return 1;},clearIntervalFn:()=>{timer=null;clears++;}};
 const live=createLiveStatusPublisher(deps);
 return {c,imported,state,snapshots,errors,deps,live,get now(){return now;},set now(v){now=v;},get reads(){return reads;},get clears(){return clears;},heartbeat:()=>{assert.ok(timer);timer();},last:id=>snapshots.at(-1).cases.find(c=>c.id===id)};
}

test('fragmented FFmpeg progress uses microseconds, bounded monotonic time and no arbitrary fields',()=>{
 const values=[],parse=createDecodeProgressParser(v=>values.push(v),()=>NOW);
 parse('private=/secret\nout_time_us=1200');parse('0000\nspeed=2.5x\nfps=30\nframe=120\nprogress=continue\n');
 parse('out_time_ms=10000000\nspeed=N/A\nfps=NaN\nframe=-1\nprogress=continue\n');
 parse('out_time=00:00:14.250\nspeed=Infinity\nprogress=end\n');
 assert.equal(values.length,3);assert.equal(values[0].seconds,12);assert.equal(values[0].speed,2.5);assert.equal(values[0].frame,120);
 assert.equal(values[1].seconds,12);assert.equal(values[1].speed,null);assert.equal(values[1].fps,null);assert.equal(values[1].frame,null);
 assert.equal(values[2].seconds,14.25);assert.equal(values[2].ended,true);assert(!JSON.stringify(values).includes('private'));
});

test('malformed progress cannot invent a position, health result or completion',()=>{
 const values=[],parse=createDecodeProgressParser(v=>values.push(v));
 parse('out_time_us=NaN\nout_time=bad\nprogress=invalid\n');
 parse('out_time_ms=Infinity\nprogress=continue\n');
 assert.equal(values.length,1);assert.equal(values[0].seconds,null);assert.equal(values[0].ended,false);
});

test('decode heartbeats remain fresh while cached imported Tdarr observations age',async()=>{
 const f=fixture();await f.live.refresh();await f.live.startDecode(f.c,{pass:1,durationSeconds:100});
 const observed=f.last('imported').tdarrStatusUpdated;
 f.now+=20*60000;f.heartbeat();await f.live.flush();
 assert.equal(f.reads,1,'heartbeat must not refresh cached DB timestamps');
 assert.equal(f.last('imported').tdarrStatusUpdated,observed);assert.equal(f.last('imported').statusUpdated,observed);
 assert.equal(f.last('case').heartbeatAt,new Date(f.now).toISOString());assert.equal(f.last('case').statusUpdated,new Date(f.now).toISOString());
 await f.live.refresh();assert.equal(f.reads,2);assert.equal(f.last('imported').tdarrStatusUpdated,new Date(f.now).toISOString());await f.live.close();
});

test('progress estimates belong to each pass and never imply approval or 100 percent',async()=>{
 const f=fixture();await f.live.startDecode(f.c,{pass:1,durationSeconds:100});f.now+=10000;
 f.live.updateDecode(f.c,{seconds:20,speed:2,fps:24,frame:480,ended:false},1);await f.live.flush();
 let p=f.last('case').progress;assert.equal(p.percent,20);assert.equal(p.etaSeconds,40);assert.equal(p.pass,1);
 f.now+=15000;f.live.updateDecode(f.c,{seconds:1000,speed:2,ended:true},1);await f.live.flush();
 p=f.last('case').progress;assert.equal(p.percent,99.9);assert.equal(p.running,true);assert.equal(p.ended,true);assert.equal(f.c.status,'verifying');assert.equal(f.last('case').cleanupComplete,false);
 await f.live.finishDecode(f.c);assert.equal(f.last('case').progress.running,false);assert.equal(f.last('case').progress.etaSeconds,null);
 await f.live.startDecode(f.c,{pass:2});p=f.last('case').progress;assert.equal(p.pass,2);assert.equal(p.seconds,null);assert.equal(p.percent,null);assert.equal(p.etaSeconds,null);
 f.live.updateDecode(f.c,{seconds:55,speed:2},1);await f.live.flush();assert.equal(f.last('case').progress.seconds,null,'late data from pass 1 must not enter pass 2');await f.live.close();assert.equal(f.c.status,'verifying');
});

test('bounded progress writes coalesce and finish/phase transitions clean up timers',async()=>{
 const f=fixture();await f.live.startDecode(f.c,{pass:1});
 for(let i=0;i<100;i++)f.live.updateDecode(f.c,{seconds:i},1);
 await f.live.flush();assert.equal(f.snapshots.length,2);
 f.now+=15000;f.live.updateDecode(f.c,{seconds:100},1);await f.live.flush();assert.equal(f.snapshots.length,3);
 f.c.status='confirmed';await f.live.phaseChanged(f.c);assert.equal(f.clears,1);assert.equal(f.last('case').progress,null);await f.live.close();
});

test('serialized publication never overlaps atomic writes during heartbeat and refresh',async()=>{
 let release,active=0,maxActive=0,writes=0,reads=0;
 const state={cases:{}},live=createLiveStatusPublisher({getState:()=>state,clock:()=>NOW,readTdarrFiles:async()=>{reads++;return []},publish:async()=>{active++;maxActive=Math.max(maxActive,active);writes++;if(writes===1)await new Promise(r=>release=r);active--}});
 const first=live.refresh();await new Promise(r=>setImmediate(r));const second=live.refresh();live.refresh();release();await Promise.all([first,second]);
 assert.equal(maxActive,1);assert.equal(writes,2);assert.equal(reads,2);await live.close();
});

test('status write failures recover on the next publication without deciding film health',async()=>{
 const f=fixture(),publish=f.deps.publish;let fail=true;
 const live=createLiveStatusPublisher({...f.deps,publish:async args=>{if(fail)throw Error('status unavailable');return publish(args)}});
 await assert.rejects(live.startDecode(f.c,{pass:1}),/unavailable/);fail=false;f.now+=1000;
 live.updateDecode(f.c,{seconds:3},1);await live.flush();assert.equal(f.c.status,'verifying');assert.equal(f.last('case').progress.seconds,3);await live.close();await f.live.close();
});

test('public snapshots expose useful deferred/diagnostic state while excluding private evidence and paths',async()=>{
 const f=fixture();Object.assign(f.c,{status:'deferred_cooldown',message:'Error /storage/movies/Movie/file.mkv',source:'/storage/movies/private.mkv',binding:{sourceTitle:'Movie.Release',apiKey:'secret'},deferredCooldown:{sampleSHA256:'secret'},evidence:{checks:[{stderr:'secret'}]},nextRetryAt:'2026-11-11T12:00:00Z'});
 await f.live.refresh();const record=f.last('case');assert.equal(record.sourceRetained,true);assert.equal(record.nextRetryAt,f.c.nextRetryAt);assert.equal(record.edition,'Movie.Release');
 const serialized=JSON.stringify(record);assert(!serialized.includes('/storage'));assert(!serialized.includes('secret'));assert(!serialized.includes('deferredCooldown'));assert.equal(record.canRestore,false);
 f.c.status='no_action';f.c.originalCheckKind='healthy';await f.live.phaseChanged(f.c);assert.equal(f.last('case').originalCheckKind,'healthy');await f.live.close();
});
