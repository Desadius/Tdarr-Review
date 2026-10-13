import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createPreviewCache,previewCacheKey,PreviewCacheError} from './preview-cache.mjs';

const base={itemId:'a'.repeat(24),snapshot:'b'.repeat(64),mode:'av',originalIndex:1,reviewIndex:2,seconds:5,profile:'compact'};
const gate=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const aborted=error=>error instanceof PreviewCacheError&&error.code==='CANCELLED';
async function until(condition){const end=Date.now()+5000;while(!condition()){assert(Date.now()<end,'condition timed out');await new Promise(resolve=>setTimeout(resolve,5))}}
async function fixture(t,options={}){
 const root=await fs.mkdtemp(path.join(process.env.PREVIEW_CACHE_TEST_ROOT||os.tmpdir(),'review-preview-cache-')),directory=path.join(root,'cache'),calls=[],verifications=[];
 let time=Date.parse('2026-10-13T00:00:00Z');
 const settings={directory,rendererVersion:'renderer-v1',now:()=>time,backgroundDelayMs:0,render:async(request,context)=>{calls.push({request,context});return {seconds:request.seconds,content:'preview'}},verify:async request=>{verifications.push(request);return true},...options};
 const cache=await createPreviewCache(settings);
 t.after(async()=>{await cache.close();await fs.rm(root,{recursive:true,force:true})});
 return {root,directory,cache,calls,verifications,settings,setTime:value=>{time=value},advance:value=>{time+=value}};
}

test('key changes with every rendering dimension and never accepts paths or unknown modes',()=>{
 const first=previewCacheKey(base,'v1');assert.match(first,/^[a-f0-9]{64}$/);
 for(const patch of [{itemId:'c'.repeat(24)},{snapshot:'c'.repeat(64)},{mode:'wave'},{originalIndex:3},{reviewIndex:4},{seconds:6},{profile:'detail'},{rendererVersion:'v2'}])assert.notEqual(previewCacheKey({...base,...patch},'v1'),first);
 for(const patch of [{itemId:'../outside'},{snapshot:'bad'},{mode:'video'},{seconds:-1},{seconds:NaN},{originalIndex:0.5},{reviewIndex:null},{profile:'__proto__'},{rendererVersion:'x'.repeat(129)}])assert.throws(()=>previewCacheKey({...base,...patch},'v1'),PreviewCacheError);
 const frames={...base,mode:'frames',profile:null};assert.equal(previewCacheKey(frames,'v1'),previewCacheKey({...frames,originalIndex:null,reviewIndex:null},'v1'));
});

test('first request persists privately; subsequent hit verifies twice and survives restart',async t=>{
 const f=await fixture(t);const first=await f.cache.request(base);assert.equal(f.calls.length,1);assert.equal(f.verifications.length,2);assert.equal(f.cache.status(base),'ready');
 const files=await fs.readdir(f.directory);assert.equal(files.length,1);assert.match(files[0],/^[a-f0-9]{64}\.json$/);
 const metadata=f.cache.entryInfo(base);assert.deepEqual(Object.keys(metadata).sort(),['bytes','created']);assert.equal(metadata.bytes,(await fs.stat(path.join(f.directory,files[0]))).size);assert.equal(metadata.created,Date.parse('2026-10-13T00:00:00Z'));assert.equal(f.cache.entryInfo({...base,rendererVersion:'renderer-v2'}),null);assert.equal(f.verifications.length,2,'metadata lookup must not read/verify preview payload');
 if(process.platform!=='win32')assert.equal((await fs.stat(path.join(f.directory,files[0]))).mode&0o777,0o600);
 first.content='caller mutation';const cached=await f.cache.request(base);assert.equal(cached.content,'preview');assert.equal(f.calls.length,1);assert.equal(f.verifications.length,4);
 await f.cache.close();let verified=0;
 const restart=await createPreviewCache({...f.settings,render:()=>{throw Error('must reuse disk cache')},verify:()=>{verified++;return true}});t.after(()=>restart.close());
 assert.deepEqual(await restart.request(base),{seconds:5,content:'preview'});assert.equal(verified,2);assert.equal(restart.stats().hits,1);
});

test('same queued or running request coalesces and promotes background to interactive',async t=>{
 const started=gate(),finish=gate();let renders=0;
 const f=await fixture(t,{render:async()=>{renders++;started.resolve();return finish.promise},backgroundDelayMs:100});
 const warm=f.cache.request(base,{priority:'background'});await until(()=>f.cache.status(base)==='queued');
 const foreground=f.cache.request(base);await started.promise;assert.equal(f.cache.stats().priority,'interactive');
 const repeated=f.cache.request(base);finish.resolve({content:'shared'});
 const results=await Promise.all([warm,foreground,repeated]);assert.equal(renders,1);assert.deepEqual(results,[{content:'shared'},{content:'shared'},{content:'shared'}]);results[0].content='changed';assert.equal(results[1].content,'shared');
});

test('renderer upgrade retires only obsolete owned artifacts and new renderer survives another restart',async t=>{
 const f=await fixture(t);await f.cache.request(base);const oldFiles=await fs.readdir(f.directory);assert.equal(oldFiles.length,1);
 await fs.writeFile(path.join(f.directory,'external.txt'),'keep foreign content');await f.cache.close();
 let renders=0;const settings={...f.settings,rendererVersion:'renderer-v2',render:async()=>{renders++;return {renderer:'v2'}}};
 const upgraded=await createPreviewCache(settings);t.after(()=>upgraded.close());
 assert.equal(upgraded.stats().entries,0);assert.equal(upgraded.stats().bytes,0);assert.deepEqual(await fs.readdir(f.directory),['external.txt']);assert.equal(await fs.readFile(path.join(f.directory,'external.txt'),'utf8'),'keep foreign content');
 await assert.rejects(fs.stat(path.join(f.directory,oldFiles[0])),error=>error.code==='ENOENT');
 assert.deepEqual(await upgraded.request(base),{renderer:'v2'});assert.deepEqual(await upgraded.request(base),{renderer:'v2'});assert.equal(renders,1);
 const newFiles=(await fs.readdir(f.directory)).filter(name=>name.endsWith('.json'));assert.equal(newFiles.length,1);assert.notEqual(newFiles[0],oldFiles[0]);
 await upgraded.close();const reused=await createPreviewCache({...settings,render:request=>{if(request.rendererVersion==='renderer-v3')return {renderer:'v3'};throw Error('new renderer cache must survive restart')}});t.after(()=>reused.close());
 assert.deepEqual(await reused.request(base),{renderer:'v2'});assert.equal(reused.stats().entries,1);assert.equal(reused.stats().renders,0);assert.equal(await fs.readFile(path.join(f.directory,'external.txt'),'utf8'),'keep foreign content');
 // A running server may use a new rendererVersion after a config change; only
 // the next startup retires versions, never live requests or their ready hits.
 assert.deepEqual(await reused.request({...base,rendererVersion:'renderer-v3'}),{renderer:'v3'});assert.deepEqual(await reused.request({...base,rendererVersion:'renderer-v3'}),{renderer:'v3'});assert.equal(reused.stats().renders,1);assert.equal(reused.status(base),'ready');
});

test('interactive queue precedes background and only one renderer ever runs',async t=>{
 const trace=[];let running=0,maxRunning=0;
 const f=await fixture(t,{backgroundDelayMs:50,render:async(request,{priority})=>{trace.push([request.seconds,priority]);running++;maxRunning=Math.max(maxRunning,running);await new Promise(resolve=>setTimeout(resolve,5));running--;return {seconds:request.seconds}}});
 const warm1=f.cache.request({...base,seconds:1},{priority:'background'}),warm2=f.cache.request({...base,seconds:2},{priority:'background'});
 const foreground=f.cache.request({...base,seconds:3});await Promise.all([warm1,warm2,foreground]);
 assert.deepEqual(trace[0],[3,'interactive']);assert.equal(maxRunning,1);assert.equal(f.cache.stats().queue,0);assert.equal(f.cache.stats().busy,false);
});

test('interactive request aborts running background, which is requeued after foreground',async t=>{
 const started=gate(),trace=[];let attempts=0;
 const f=await fixture(t,{render:async(request,{signal,priority})=>{
  trace.push([request.seconds,priority]);
  if(request.seconds===1&&attempts++===0){started.resolve();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))}
  return {seconds:request.seconds};
 }});
 const background=f.cache.request({...base,seconds:1},{priority:'background'});await started.promise;
 const foreground=f.cache.request({...base,seconds:2});assert.deepEqual(await foreground,{seconds:2});assert.deepEqual(await background,{seconds:1});
 assert.deepEqual(trace,[[1,'background'],[2,'interactive'],[1,'background']]);assert.equal(f.cache.stats().entries,2);
});

test('async allowBackground gate blocks warming but leaves foreground usable',async t=>{
 let allowed=false;const f=await fixture(t,{allowBackground:async()=>allowed});
 const warm=f.cache.request({...base,seconds:1},{priority:'background'});await until(()=>f.cache.status({...base,seconds:1})==='queued');
 assert.deepEqual(await f.cache.request({...base,seconds:2}),{seconds:2,content:'preview'});assert.equal(f.calls.length,1);
 allowed=true;f.cache.resumeBackground();await warm;assert.equal(f.calls.length,2);
});

test('pause waits for background abort and resume reruns it without publishing the interrupted result',async t=>{
 const started=gate();let attempts=0;
 const f=await fixture(t,{render:async(request,{signal})=>{
  if(attempts++===0){started.resolve();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))}
  return {content:'resumed'};
 }});
 const warm=f.cache.request(base,{priority:'background'});await started.promise;await f.cache.pauseBackground({wait:true});
 assert.equal(f.cache.status(base),'queued');assert.equal(f.cache.stats().busy,false);assert.equal(f.cache.stats().paused,true);assert.deepEqual(await fs.readdir(f.directory),[]);
 f.cache.resumeBackground();assert.deepEqual(await warm,{content:'resumed'});assert.equal(f.cache.status(base),'ready');
});

test('explicit background cancellation waits for worker and leaves no ready result',async t=>{
 const started=gate();const f=await fixture(t,{render:async(request,{signal})=>{started.resolve();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))}});
 const warm=f.cache.request(base,{priority:'background'}),rejected=assert.rejects(warm,aborted);await started.promise;
 await f.cache.cancelActiveBackground({wait:true});await rejected;assert.equal(f.cache.stats().busy,false);assert.equal(f.cache.status(base),'missing');assert.deepEqual(await fs.readdir(f.directory),[]);
});

test('invalidate aborts queued/running jobs and a renderer ignoring AbortSignal cannot commit stale data',async t=>{
 const started=gate(),finish=gate();const f=await fixture(t,{render:async()=>{started.resolve();return finish.promise}});
 const running=f.cache.request(base),rejected=assert.rejects(running,aborted);await started.promise;
 await f.cache.invalidate({itemId:base.itemId,snapshot:base.snapshot});await rejected;finish.resolve({content:'stale'});await until(()=>!f.cache.stats().busy);
 assert.equal(f.cache.status(base),'missing');assert.deepEqual(await fs.readdir(f.directory),[]);
 await f.cache.pauseBackground();const queued=f.cache.request({...base,seconds:9},{priority:'background'}),queuedRejected=assert.rejects(queued,aborted);await until(()=>f.cache.status({...base,seconds:9})==='queued');
 await f.cache.invalidate({snapshot:base.snapshot});await queuedRejected;assert.equal(f.cache.stats().queue,0);
});

test('source verification before and after render/hit rejects changes without returning evidence',async t=>{
 let checks=0;const f=await fixture(t,{verify:()=>++checks!==2});
 await assert.rejects(f.cache.request(base),error=>error.code==='STALE');assert.equal(f.cache.status(base),'error');assert.deepEqual(await fs.readdir(f.directory),[]);
 checks=2;await f.cache.request(base);assert.equal(f.cache.status(base),'ready');
 checks=0;await assert.rejects(f.cache.peek(base),error=>error.code==='STALE');
});

test('invalidate during a cache hit revokes read authority before awaited verification returns',async t=>{
 let delayed=false;const wait=gate();const f=await fixture(t,{verify:async()=>{if(delayed)await wait.promise;return true}});await f.cache.request(base);
 delayed=true;const reading=f.cache.peek(base),rejected=assert.rejects(reading,aborted);await new Promise(resolve=>setTimeout(resolve,0));await f.cache.invalidate({itemId:base.itemId});wait.resolve();await rejected;
 assert.equal(f.cache.status(base),'missing');assert.deepEqual(await fs.readdir(f.directory),[]);
});

test('count/byte limits evict least-recently-used entries and updateLimits prunes atomically',async t=>{
 const f=await fixture(t,{limits:{maxBytes:10000,maxEntries:2,ttlMs:10000,maxEntryBytes:5000}});
 await f.cache.request({...base,seconds:1});f.advance(1);await f.cache.request({...base,seconds:2});f.advance(1);await f.cache.peek({...base,seconds:1});f.advance(1);await f.cache.request({...base,seconds:3});
 assert.equal(f.cache.status({...base,seconds:1}),'ready');assert.equal(f.cache.status({...base,seconds:2}),'missing');assert.equal(f.cache.status({...base,seconds:3}),'ready');assert.equal(f.cache.stats().entries,2);
 const updated=await f.cache.updateLimits({maxEntries:1});assert.equal(updated.entries,1);assert.equal(f.cache.status({...base,seconds:1}),'missing');assert.equal(f.cache.status({...base,seconds:3}),'ready');assert.equal((await fs.readdir(f.directory)).length,1);
 await assert.rejects(async()=>f.cache.updateLimits({maxBytes:NaN}),error=>error.code==='INVALID_LIMITS');assert.equal(f.cache.stats().limits.maxBytes,10000);
});

test('TTL stops reuse and prune expires only owned files; oversized previews remain interactive',async t=>{
 const f=await fixture(t,{limits:{maxBytes:2000,maxEntries:5,ttlMs:100,maxEntryBytes:1500},render:async request=>({content:'x'.repeat(request.seconds===9?2500:700)})});
 await fs.writeFile(path.join(f.directory,'leave-me.txt'),'foreign');await f.cache.request(base);assert(f.cache.entryInfo(base));f.advance(100);assert.equal(f.cache.entryInfo(base),null);assert.equal(f.cache.status(base),'missing');assert.equal(await f.cache.peek(base),null);await f.cache.prune();assert.equal(f.cache.stats().entries,0);assert.equal(await fs.readFile(path.join(f.directory,'leave-me.txt'),'utf8'),'foreign');
 const large=await f.cache.request({...base,seconds:9});assert.equal(large.content.length,2500);assert.equal(f.cache.stats().uncached,1);assert.equal(f.cache.status({...base,seconds:9}),'error');assert(f.cache.stats().bytes<=2000);assert.deepEqual(await fs.readdir(f.directory),['leave-me.txt']);
 await f.cache.invalidate({all:true});assert.equal(f.cache.status({...base,seconds:9}),'missing');
});

test('background budget never churns ready entries while interactive demand can evict them',async t=>{
 const f=await fixture(t,{limits:{maxBytes:2000,maxEntries:1,ttlMs:10000,maxEntryBytes:1500},render:async request=>({seconds:request.seconds,content:'x'.repeat(600)})});
 await f.cache.request({...base,seconds:1});const initialFiles=await fs.readdir(f.directory);
 assert.equal((await f.cache.request({...base,seconds:2},{priority:'background'})).seconds,2);
 assert.equal(f.cache.status({...base,seconds:1}),'ready');assert.equal(f.cache.status({...base,seconds:2}),'error');assert.equal(f.cache.stats().uncached,1);assert.deepEqual(await fs.readdir(f.directory),initialFiles);
 await f.cache.request({...base,seconds:3});assert.equal(f.cache.status({...base,seconds:1}),'missing');assert.equal(f.cache.status({...base,seconds:3}),'ready');assert.equal(f.cache.stats().entries,1);assert(f.cache.stats().bytes<=2000);
});

test('budget exhaustion blocks more background decodes until capacity actually changes',async t=>{
 const f=await fixture(t,{limits:{maxEntries:1}});await f.cache.request({...base,seconds:1});await f.cache.request({...base,seconds:2},{priority:'background'});
 assert.equal(f.cache.stats().backgroundBudgetBlocked,true);const count=f.calls.length;
 const queued=f.cache.request({...base,seconds:3},{priority:'background'});await until(()=>f.cache.status({...base,seconds:3})==='queued');await f.cache.prune();
 assert.equal(f.cache.stats().backgroundBudgetBlocked,true);assert.equal(f.calls.length,count);
 await f.cache.updateLimits({maxEntries:2});await queued;assert.equal(f.calls.length,count+1);assert.equal(f.cache.status({...base,seconds:1}),'ready');assert.equal(f.cache.status({...base,seconds:3}),'ready');assert.equal(f.cache.stats().backgroundBudgetBlocked,false);
 await f.cache.pauseBackground();const cancelledRequest=f.cache.request({...base,seconds:4},{priority:'background'}),rejected=assert.rejects(cancelledRequest,aborted);await until(()=>f.cache.status({...base,seconds:4})==='queued');
 await f.cache.cancelBackground({itemId:base.itemId,wait:true});await rejected;assert.equal(f.cache.stats().queue,0);assert.equal(f.cache.status({...base,seconds:1}),'ready');
});

test('restart removes exact abandoned temporary/corrupt artifacts and preserves foreign names',async t=>{
 const f=await fixture(t);await f.cache.close();
 const temporary='d'.repeat(64)+'.'+'e'.repeat(32)+'.tmp',corrupt='f'.repeat(64)+'.json';
 await fs.writeFile(path.join(f.directory,temporary),'partial');await fs.writeFile(path.join(f.directory,corrupt),'broken');await fs.writeFile(path.join(f.directory,'external.tmp'),'preserve');
 const restart=await createPreviewCache(f.settings);t.after(()=>restart.close());assert.deepEqual(await fs.readdir(f.directory),['external.tmp']);
});

test('full cache disk returns a freshly reverified interactive result without publishing a partial entry',async t=>{
 const f=await fixture(t),rename=fs.rename;
 try{
  fs.rename=async()=>{const error=Error('simulated full disk');error.code='ENOSPC';throw error};
  assert.deepEqual(await f.cache.request(base),{seconds:5,content:'preview'});
 }finally{fs.rename=rename}
 assert.equal(f.verifications.length,3);assert.equal(f.cache.status(base),'error');assert.equal(f.cache.stats().uncached,1);assert.deepEqual(await fs.readdir(f.directory),[]);
 await f.cache.request(base);assert.equal(f.cache.status(base),'ready');
});

test('cache roots through symlinks and linked owned artifacts are rejected without touching targets',async t=>{
 const f=await fixture(t);await f.cache.close();const target=path.join(f.root,'outside');await fs.mkdir(target);await fs.writeFile(path.join(target,'sentinel'),'keep');
 const linked=path.join(f.root,'linked');try{await fs.symlink(target,linked,process.platform==='win32'?'junction':'dir')}catch(error){if(['EPERM','EACCES'].includes(error.code)){t.skip('link creation unavailable');return}throw error}
 await assert.rejects(createPreviewCache({...f.settings,directory:path.join(linked,'cache')}),error=>error.code==='UNSAFE_CACHE');assert.equal(await fs.readFile(path.join(target,'sentinel'),'utf8'),'keep');
 const outside=path.join(target,'payload'),owned=path.join(f.directory,'a'.repeat(64)+'.json');await fs.writeFile(outside,'private outside');await fs.link(outside,owned);
 await assert.rejects(createPreviewCache(f.settings),error=>error.code==='UNSAFE_CACHE');assert.equal(await fs.readFile(outside,'utf8'),'private outside');assert.equal((await fs.stat(outside)).nlink,2);
});

test('close cancels every pending/running job and cannot publish a late result',async t=>{
 const started=gate(),finish=gate();const f=await fixture(t,{render:async()=>{started.resolve();return finish.promise}});
 const running=f.cache.request(base),runningRejected=assert.rejects(running,aborted);await started.promise;
 const queued=f.cache.request({...base,seconds:7}),queuedRejected=assert.rejects(queued,aborted);await until(()=>f.cache.stats().queue===1);
 const closing=f.cache.close();finish.resolve({late:true});await Promise.all([closing,runningRejected,queuedRejected]);
 assert.equal(f.cache.stats().closed,true);assert.equal(f.cache.stats().busy,false);assert.equal(f.cache.stats().queue,0);assert.deepEqual(await fs.readdir(f.directory),[]);
 await assert.rejects(f.cache.request(base),error=>error.code==='CLOSED');
});
