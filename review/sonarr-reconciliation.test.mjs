import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import os from 'node:os';
import path from 'node:path';
import {createSonarrReconciliation} from './sonarr-reconciliation.mjs';

const linuxOnly={skip:process.platform!=='linux'?'Requires Linux descriptor-relative no-follow traversal':false};
const revision='a'.repeat(64),apiKey='synthetic-reconciliation-key';
function records(seriesPath){return {
 series:[{id:7,title:'Synthetic Show',path:seriesPath,seriesType:'anime'},{id:8,title:'Other Show',path:'/sonarr/tv/Other Show',seriesType:'standard'}],
 files:[
  {id:31,seriesId:7,path:seriesPath+'/Season 20/S20E02.mkv',relativePath:'Season 20/S20E02.mkv',seasonNumber:20},
  {id:32,seriesId:7,path:seriesPath+'/Season 20/S20E03.mkv',relativePath:'Season 20/S20E03.mkv',seasonNumber:20},
 ],
 episodes:[
  {id:42,seriesId:7,episodeFileId:31,hasFile:true,seasonNumber:20,episodeNumber:2,absoluteEpisodeNumber:202,sceneAbsoluteEpisodeNumber:202,sceneSeasonNumber:20,sceneEpisodeNumber:2,unverifiedSceneNumbering:true,airDate:'2022-01-02',airDateUtc:'2022-01-02T00:00:00Z'},
  {id:43,seriesId:7,episodeFileId:31,hasFile:true,seasonNumber:20,episodeNumber:3,absoluteEpisodeNumber:203,sceneAbsoluteEpisodeNumber:203,sceneSeasonNumber:20,sceneEpisodeNumber:3,unverifiedSceneNumbering:false,airDate:'2022-01-03',airDateUtc:'2022-01-03'},
  {id:44,seriesId:7,episodeFileId:32,hasFile:true,seasonNumber:20,episodeNumber:4},
  {id:45,seriesId:7,episodeFileId:0,hasFile:false,seasonNumber:20,episodeNumber:5,sceneSeasonNumber:20,sceneEpisodeNumber:5},
 ],
};}
async function treeSignature(root){
 const values=[];
 async function walk(dir,relative=''){
  for(const entry of await fs.readdir(dir,{withFileTypes:true})){
   const name=relative?relative+'/'+entry.name:entry.name,file=path.join(dir,entry.name),stat=await fs.lstat(file);
   values.push([name,stat.mode,stat.size,stat.mtimeMs,stat.ino,stat.nlink]);if(stat.isDirectory()&&!stat.isSymbolicLink())await walk(file,name);
  }
 }
 await walk(root);return JSON.stringify(values.sort((a,b)=>a[0].localeCompare(b[0])));
}
async function fixture(t,{draftChanged=false,changeSnapshot=false,changeDiskDuringSecondSnapshot=false,snapshotStatus=200,malformedFiles=false,countMismatch=false}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sonarr-reconcile-')),seriesPath='/sonarr/tv/Synthetic Show',seriesDir=path.join(root,'Synthetic Show');
 await fs.mkdir(path.join(seriesDir,'Season 20'),{recursive:true});
 await fs.mkdir(path.join(root,'Other Show'),{recursive:true});
 await fs.writeFile(path.join(seriesDir,'Season 20','S20E02.mkv'),'synthetic episode');
 await fs.writeFile(path.join(seriesDir,'Season 20','S20E02.sample.mkv'),'synthetic sample');
 await fs.writeFile(path.join(seriesDir,'Season 20','S20E02.srt'),'synthetic subtitle');
 await fs.writeFile(path.join(seriesDir,'Season 20','S20E02.mp4'),'synthetic alternate');
 await fs.writeFile(path.join(seriesDir,'Season 20','Bonus.mkv'),'synthetic local file');
 await fs.writeFile(path.join(root,'Other Show','outside-sentinel.mkv'),'outside selected series');
 const sonarr=records(seriesPath),currentSonarr={url:'http://127.0.0.1:1/sonarr',apiKey},activeTv={sonarrRoot:'/sonarr/tv',mediaRoot:root},draftTv={...activeTv};
 const snapshot={revision,generation:3,active:{sonarr:currentSonarr,libraries:{tv:activeTv}},draft:{sonarr:draftChanged?{...currentSonarr,url:'http://127.0.0.1:2/sonarr'}:{...currentSonarr},libraries:{tv:draftTv}}};
 let snapshots=0,seriesReads=0;const calls=[];
 const mock=http.createServer((req,res)=>{
  calls.push({method:req.method,url:req.url,key:req.headers['x-api-key']});
  const route=new URL(req.url,'http://127.0.0.1').pathname;
  let value;
  if(route.endsWith('/api/v3/series')){seriesReads++;value=sonarr.series;if(changeDiskDuringSecondSnapshot&&seriesReads===2)void fs.writeFile(path.join(seriesDir,'added-during-sonarr-read.mkv'),'changed after first disk scan');}
  else if(route.endsWith('/api/v3/episodefile')){snapshots++;value=sonarr.files;if(changeSnapshot&&snapshots>1)value=[...sonarr.files,{id:33,seriesId:7,path:seriesPath+'/new.mkv',relativePath:'new.mkv'}];}
  else if(route.endsWith('/api/v3/episode'))value=sonarr.episodes;
  if(!value){res.writeHead(404);return res.end();}
  if(route.endsWith('/api/v3/episodefile')&&malformedFiles){res.writeHead(snapshotStatus,{'content-type':'application/json'});return res.end('{');}
  res.writeHead(route.endsWith('/api/v3/episodefile')?snapshotStatus:200,{'content-type':'application/json',...(route.endsWith('/api/v3/episodefile')&&countMismatch?{'x-total-count':String(value.length+1)}:{})});res.end(JSON.stringify(value));
 });
 await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
 snapshot.active.sonarr.url='http://127.0.0.1:'+mock.address().port+'/sonarr';snapshot.draft.sonarr.url=snapshot.active.sonarr.url;
 if(draftChanged)snapshot.draft.sonarr.url='http://127.0.0.1:'+mock.address().port+'/different';
 t.after(async()=>{await new Promise(resolve=>mock.close(resolve));await fs.rm(root,{recursive:true,force:true});});
 return {root,seriesDir,sonarr,snapshot,calls,mock};
}

test('selected-series reconciliation joins exact files both ways and preserves every linked episode without reading contents',linuxOnly,async t=>{
 const f=await fixture(t);const before=await treeSignature(f.root);
 const service=createSonarrReconciliation({getSnapshot:async()=>f.snapshot});t.after(()=>service.close());
 const result=await service.inspect(revision,7);
 assert.equal(result.status,'complete');assert.equal(result.complete,true);assert.equal(result.generation,3);assert.equal(result.limits.diskEntries,10000);
 const present=result.rows.find(row=>row.episodeFileId===31);assert.equal(present.status,'present');assert.equal(present.relative,'Season 20/S20E02.mkv');assert.deepEqual(present.episodeIds,[42,43]);
 assert.deepEqual(present.episodes.map(({id})=>id),[42,43]);assert.equal(present.episodes[0].sceneAbsoluteEpisodeNumber,202);assert.equal(present.episodes[0].unverifiedSceneNumbering,true);assert.equal(present.episodes[0].airDateUtc,'2022-01-02T00:00:00Z');
 assert.equal(result.rows.find(row=>row.episodeFileId===32).status,'missing');
 const diskOnly=result.rows.find(row=>row.relative==='Season 20/Bonus.mkv');assert.equal(diskOnly.kind,'localOnly');assert.equal(diskOnly.status,'local_only');assert.equal(diskOnly.episodeIds.length,0);
 assert.equal(result.rows.find(row=>row.relative==='Season 20/S20E02.sample.mkv').category,'possible_sample');
 assert.equal(result.rows.find(row=>row.relative==='Season 20/S20E02.mp4').category,'possible_alternate');
 assert.equal(result.rows.find(row=>row.relative==='Season 20/S20E02.srt').category,'sidecar');assert.equal(result.counts.sidecars,1);assert.equal(result.counts.unlinkedEpisodes,1);
 assert.ok(result.rows.some(row=>row.kind==='directory'&&row.relative==='Season 20'));
 assert.equal(JSON.stringify(result).includes('outside-sentinel'),false);assert.equal(JSON.stringify(result).includes(f.root),false);assert.equal(JSON.stringify(result).includes(apiKey),false);
 assert.deepEqual(f.calls.map(call=>call.method),['GET','GET','GET','GET','GET','GET']);assert.ok(f.calls.every(call=>call.key===apiKey));
 assert.equal(await treeSignature(f.root),before,'the operation did not modify the selected or outside files');
});

test('draft settings mismatch stops before Sonarr requests and worker spawn',linuxOnly,async t=>{
 const f=await fixture(t,{draftChanged:true});let spawns=0;
 const service=createSonarrReconciliation({getSnapshot:async()=>f.snapshot,spawnChild:()=>{spawns++;throw Error('must not start');}});t.after(()=>service.close());
 const result=await service.inspect(revision,7);
 assert.equal(f.calls.length,0);assert.equal(spawns,0);
 assert.equal(result.status,'incomplete');assert.equal(result.reason,'settings_not_applied');assert.equal(result.rows.length,0);
});

test('a changed complete Sonarr snapshot cannot establish missing or disk-only entries',linuxOnly,async t=>{
 const f=await fixture(t,{changeSnapshot:true});const service=createSonarrReconciliation({getSnapshot:async()=>f.snapshot});t.after(()=>service.close());
 const result=await service.inspect(revision,7);
 assert.equal(result.complete,false);assert.equal(result.reason,'snapshot_changed');assert.equal(result.counts.missing,0);assert.equal(result.counts.localOnly,0);assert.equal(result.rows.length,0);
});

test('a file added while the second Sonarr snapshot is read invalidates the earlier disk inventory',linuxOnly,async t=>{
 const f=await fixture(t,{changeDiskDuringSecondSnapshot:true});const service=createSonarrReconciliation({getSnapshot:async()=>f.snapshot});t.after(()=>service.close());
 const result=await service.inspect(revision,7);
 assert.equal(result.complete,false);assert.equal(result.reason,'scan_changed');assert.equal(result.counts.missing,0);assert.equal(result.counts.localOnly,0);assert.equal(result.rows.length,0);
});

test('permission and unsupported filesystem observations keep fixed incomplete reasons',linuxOnly,async t=>{
 const f=await fixture(t);let workerStatus='inaccessible';
 const spawnChild=()=>{
  const child=new EventEmitter();child.stdout=new EventEmitter();child.stdin=new EventEmitter();child.kill=()=>true;
  child.stdin.end=()=>queueMicrotask(()=>{child.stdout.emit('data',Buffer.from(JSON.stringify({status:workerStatus,entries:[]})));child.emit('close',0);});
  return child;
 };
 const service=createSonarrReconciliation({getSnapshot:async()=>f.snapshot,spawnChild});t.after(()=>service.close());
 const inaccessible=await service.inspect(revision,7);assert.equal(inaccessible.complete,false);assert.equal(inaccessible.reason,'scan_inaccessible');assert.equal(inaccessible.counts.missing,0);assert.equal(inaccessible.counts.localOnly,0);
 workerStatus='unsupported';
 const unsupported=await service.inspect(revision,7);assert.equal(unsupported.complete,false);assert.equal(unsupported.reason,'scan_unsupported');assert.equal(unsupported.counts.missing,0);assert.equal(unsupported.counts.localOnly,0);
});

test('symlink leaves and ancestors, hardlinks, and directories at expected leaves stay unsafe',linuxOnly,async t=>{
 for(const mode of ['symlink-leaf','symlink-ancestor','hardlink','directory-leaf']){
  const f=await fixture(t),target=path.join(f.seriesDir,'Season 20','S20E02.mkv');
  await fs.rm(target,{force:true,recursive:true});
  if(mode==='symlink-leaf')await fs.symlink(path.join(f.seriesDir,'Season 20','S20E02.srt'),target);
  else if(mode==='symlink-ancestor'){
   await fs.rm(path.join(f.seriesDir,'Season 20'),{recursive:true,force:true});
   await fs.symlink(path.join(f.root,'Other Show'),path.join(f.seriesDir,'Season 20'));
  }else if(mode==='hardlink'){
   const outside=path.join(f.root,'outside-hardlink-target');await fs.writeFile(outside,'synthetic hardlink target');await fs.link(outside,target);
  }else await fs.mkdir(target);
  const service=createSonarrReconciliation({getSnapshot:async()=>f.snapshot});t.after(()=>service.close());
  const result=await service.inspect(revision,7),row=result.rows.find(value=>value.episodeFileId===31);
  assert.equal(result.complete,true,mode);assert.equal(row.status,'unsafe',mode);assert.equal(JSON.stringify(result).includes('outside-sentinel'),false,mode);
 }
});

test('a series anchor at the configured TV root or containing traversal is refused before filesystem worker start',linuxOnly,async t=>{
 for(const pathValue of ['/sonarr/tv','/sonarr/tv/Synthetic Show/../../Other Show']){
  const f=await fixture(t);f.sonarr.series[0].path=pathValue;let spawns=0;
  const service=createSonarrReconciliation({getSnapshot:async()=>f.snapshot,spawnChild:()=>{spawns++;throw Error('must not scan');}});t.after(()=>service.close());
  const result=await service.inspect(revision,7);assert.equal(result.complete,false);assert.equal(result.reason,'series_path_unmapped');assert.equal(result.counts.missing,0);assert.equal(result.counts.localOnly,0);assert.equal(spawns,0);
 }
 const f=await fixture(t);await fs.rm(f.seriesDir,{recursive:true,force:true});await fs.symlink(path.join(f.root,'Other Show'),f.seriesDir);
 const service=createSonarrReconciliation({getSnapshot:async()=>f.snapshot});t.after(()=>service.close());
 const result=await service.inspect(revision,7);assert.equal(result.complete,false);assert.equal(result.reason,'scan_unsafe');assert.equal(JSON.stringify(result).includes('outside-sentinel'),false);
});

test('duplicate or unmappable Sonarr file records prevent a definitive mismatch inventory',linuxOnly,async t=>{
 for(const variant of ['duplicate-path','duplicate-id','unmappable','duplicate-series','foreign-file']){
  const f=await fixture(t);let spawns=0;
  if(variant==='duplicate-path')f.sonarr.files.push({...f.sonarr.files[0],id:33});
  else if(variant==='duplicate-id')f.sonarr.files.push({...f.sonarr.files[0],path:'/sonarr/tv/Synthetic Show/Season 20/other.mkv',relativePath:'Season 20/other.mkv'});
  else if(variant==='unmappable')f.sonarr.files[0].path='/sonarr/tv/Other Show/Season 20/outside.mkv';
  else if(variant==='duplicate-series')f.sonarr.series.push({...f.sonarr.series[0]});
  else f.sonarr.files[0].seriesId=8;
  const service=createSonarrReconciliation({getSnapshot:async()=>f.snapshot,...(['duplicate-series','foreign-file'].includes(variant)?{spawnChild:()=>{spawns++;throw Error('unsafe snapshot must not scan');}}:{})});t.after(()=>service.close());
  const result=await service.inspect(revision,7);assert.equal(result.complete,false,variant);assert.equal(result.counts.missing,0,variant);assert.equal(result.counts.localOnly,0,variant);
  assert.ok(result.rows.every(row=>row.status!=='missing'&&row.status!=='local_only'),variant);
  if(variant==='duplicate-series'||variant==='foreign-file')assert.equal(spawns,0,variant);
 }
});

test('the selected-series episode graph is validated even when EpisodeFile is empty',linuxOnly,async t=>{
 for(const variant of ['valid-empty','empty-orphan','empty-duplicate-unacquired','empty-malformed-unacquired','nonempty-orphan']){
  const f=await fixture(t);
  if(variant!=='nonempty-orphan')f.sonarr.files=[];
  if(variant==='valid-empty')f.sonarr.episodes=[{id:45,seriesId:7,episodeFileId:0,hasFile:false,seasonNumber:20,episodeNumber:5}];
  else if(variant==='empty-orphan')f.sonarr.episodes=[{id:44,seriesId:7,episodeFileId:999,hasFile:true,seasonNumber:20,episodeNumber:9}];
  else if(variant==='empty-duplicate-unacquired')f.sonarr.episodes=[{id:45,seriesId:7,episodeFileId:0,hasFile:false},{id:45,seriesId:7,episodeFileId:0,hasFile:false}];
  else if(variant==='empty-malformed-unacquired')f.sonarr.episodes=[{id:45,seriesId:7,episodeFileId:0,hasFile:true}];
  else f.sonarr.episodes.push({id:44,seriesId:7,episodeFileId:999,hasFile:true,seasonNumber:20,episodeNumber:9});
  const service=createSonarrReconciliation({getSnapshot:async()=>f.snapshot});t.after(()=>service.close());
  const result=await service.inspect(revision,7);
  if(variant==='valid-empty'){assert.equal(result.complete,true,variant);assert.equal(result.rows.find(row=>row.relative==='Season 20/Bonus.mkv').status,'local_only',variant);continue;}
  assert.equal(result.complete,false,variant);assert.equal(result.counts.localOnly,0,variant);assert.equal(result.counts.missing,0,variant);
  assert.ok(result.rows.every(row=>row.status!=='local_only'&&row.status!=='missing'),variant);
 }
});

test('partial, malformed, and count-mismatched upstream snapshots stop before disk scanning',linuxOnly,async t=>{
 for(const options of [{snapshotStatus:206},{malformedFiles:true},{countMismatch:true}]){
  const f=await fixture(t,options);let spawns=0;
  const service=createSonarrReconciliation({getSnapshot:async()=>f.snapshot,spawnChild:()=>{spawns++;throw Error('must not scan an incomplete upstream snapshot');}});t.after(()=>service.close());
  const result=await service.inspect(revision,7);assert.equal(result.complete,false);assert.equal(result.reason,'sonarr_unavailable');assert.equal(result.counts.missing,0);assert.equal(result.counts.localOnly,0);assert.equal(result.rows.length,0);assert.equal(spawns,0);
 }
});

test('actual selected-series directory and worker-output bounds return incomplete, non-mismatch observations',linuxOnly,async t=>{
 const f=await fixture(t);for(let i=0;i<256;i++)await fs.mkdir(path.join(f.seriesDir,'bounded-'+String(i).padStart(3,'0')));
 const service=createSonarrReconciliation({getSnapshot:async()=>f.snapshot});t.after(()=>service.close());
 const limited=await service.inspect(revision,7);assert.equal(limited.complete,false);assert.equal(limited.reason,'scan_limit');assert.equal(limited.counts.missing,0);assert.equal(limited.counts.localOnly,0);

 const entriesFixture=await fixture(t);for(let dirIndex=0;dirIndex<100;dirIndex++){const folder=path.join(entriesFixture.seriesDir,'bucket-'+String(dirIndex).padStart(3,'0'));await fs.mkdir(folder);for(let fileIndex=0;fileIndex<101;fileIndex++)await fs.writeFile(path.join(folder,'entry-'+String(fileIndex).padStart(3,'0')),'');}
 const entriesService=createSonarrReconciliation({getSnapshot:async()=>entriesFixture.snapshot});t.after(()=>entriesService.close());
 const entriesLimited=await entriesService.inspect(revision,7);assert.equal(entriesLimited.complete,false);assert.equal(entriesLimited.reason,'scan_limit');assert.equal(entriesLimited.counts.missing,0);assert.equal(entriesLimited.counts.localOnly,0);

 const depthFixture=await fixture(t);let deep=depthFixture.seriesDir;for(let i=0;i<17;i++){deep=path.join(deep,'level-'+i);await fs.mkdir(deep);}
 const depthService=createSonarrReconciliation({getSnapshot:async()=>depthFixture.snapshot});t.after(()=>depthService.close());
 const depthLimited=await depthService.inspect(revision,7);assert.equal(depthLimited.complete,false);assert.equal(depthLimited.reason,'scan_limit');

 const longFixture=await fixture(t);let longPath=longFixture.seriesDir;for(let i=0;i<7;i++){longPath=path.join(longPath,'d'+i+'-'.repeat(195));await fs.mkdir(longPath);}
 for(let i=0;i<2500;i++)await fs.writeFile(path.join(longPath,'f'+String(i).padStart(4,'0')+'x'.repeat(249)), '');
 const longService=createSonarrReconciliation({getSnapshot:async()=>longFixture.snapshot});t.after(()=>longService.close());
 const bytesLimited=await longService.inspect(revision,7);assert.equal(bytesLimited.complete,false);assert.equal(bytesLimited.reason,'scan_limit');assert.equal(bytesLimited.counts.missing,0);assert.equal(bytesLimited.counts.localOnly,0);

 const second=await fixture(t);let killed=0;const child=new EventEmitter();child.stdout=new EventEmitter();child.stdin=new EventEmitter();child.kill=()=>{killed++;queueMicrotask(()=>child.emit('close',1));return true;};
 child.stdin.end=()=>queueMicrotask(()=>child.stdout.emit('data',Buffer.alloc(4*1024*1024+1,32)));
 const outputService=createSonarrReconciliation({getSnapshot:async()=>second.snapshot,spawnChild:()=>child});t.after(()=>outputService.close());
 const outputLimited=await outputService.inspect(revision,7);assert.equal(outputLimited.complete,false);assert.equal(outputLimited.reason,'scan_limit');assert.equal(outputLimited.counts.missing,0);assert.equal(outputLimited.counts.localOnly,0);assert.equal(killed,1);
});

test('worker timeout is bounded and shutdown waits for the child close before releasing the slot',linuxOnly,async t=>{
 const timedFixture=await fixture(t);let timeoutClosed=false;const timeoutChild=new EventEmitter();timeoutChild.stdout=new EventEmitter();timeoutChild.stdin=new EventEmitter();timeoutChild.stdin.end=()=>{};timeoutChild.kill=()=>{setTimeout(()=>{timeoutClosed=true;timeoutChild.emit('close',1);},5);return true;};
 const timeoutService=createSonarrReconciliation({getSnapshot:async()=>timedFixture.snapshot,spawnChild:()=>timeoutChild,workerTimeoutMs:10});t.after(()=>timeoutService.close());
 const timed=await timeoutService.inspect(revision,7);assert.equal(timed.complete,false);assert.equal(timed.reason,'worker_unavailable');assert.equal(timeoutClosed,true);

 const f=await fixture(t);let spawned=0,startedResolve,closeAfterKill=false;const started=new Promise(resolve=>{startedResolve=resolve});
 const spawnChild=()=>{spawned++;const child=new EventEmitter();child.stdout=new EventEmitter();child.stdin=new EventEmitter();child.stdin.end=()=>startedResolve();child.kill=()=>{setTimeout(()=>{closeAfterKill=true;child.emit('close',1);},5);return true;};return child;};
 const service=createSonarrReconciliation({getSnapshot:async()=>f.snapshot,spawnChild,workerTimeoutMs:1000});t.after(()=>service.close());
 const first=service.inspect(revision,7);await started;const busy=await service.inspect(revision,7);assert.equal(busy.reason,'busy');assert.equal(spawned,1);assert.equal(f.calls.length,3);
 const closing=service.close();await closing;const result=await first;assert.equal(closeAfterKill,true);assert.equal(result.complete,false);assert.equal(result.reason,'cancelled');

 const fetchFixture=await fixture(t);let requestStartedResolve,aborted=false;const requestStarted=new Promise(resolve=>{requestStartedResolve=resolve;});
 const fetchService=createSonarrReconciliation({getSnapshot:async()=>fetchFixture.snapshot,fetchFn:(_url,{signal})=>new Promise((_resolve,reject)=>{requestStartedResolve();signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('Aborted','AbortError'));},{once:true});})});
 const pending=fetchService.inspect(revision,7);await requestStarted;let closeComplete=false;await fetchService.close().then(()=>{closeComplete=true;});
 const cancelled=await pending;assert.equal(closeComplete,true);assert.equal(aborted,true);assert.equal(cancelled.reason,'cancelled');
});

test('a settings revision change after the second disk walk aborts before publication',linuxOnly,async t=>{
 const f=await fixture(t);let reads=0;
 const service=createSonarrReconciliation({getSnapshot:async()=>{reads++;return reads<5?f.snapshot:{...f.snapshot,revision:'b'.repeat(64)};}});t.after(()=>service.close());
 await assert.rejects(service.inspect(revision,7),{code:'settings_conflict'});assert.equal(f.calls.length,6);assert.equal(reads,5);
});
