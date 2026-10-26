import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createTvDiscovery,tvItemId,UNBOUND_REASONS,UNVERIFIED_REASONS} from './tv-discovery.mjs';
import {hash} from './core.mjs';
import {createSonarrInspection} from './sonarr-inspection.mjs';
import {emptyTvLibrary} from './library-paths.mjs';
import {addTvResult,sonarrMock,episodeRecord,fileRecord,tempRoot,sampleOf,LIBRARY,SOURCE_ROOT,SONARR_ROOT,API_KEY} from './test-helpers/tv-fixture.mjs';

const SERIES=7;
async function world(t,{mode='discovery',sonarr=true,requestTimeoutMs=2000,sonarrBudgetMs}={}){
 const root=await tempRoot();t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const mediaRoot=path.join(root,'tv-media'),reviewRoot=path.join(root,'review');
 await fs.mkdir(mediaRoot);await fs.mkdir(reviewRoot);
 const mock=await sonarrMock({series:[{id:SERIES,title:'Synthetic Show',path:SONARR_ROOT+'\\Synthetic Show',seriesType:'standard'}],files:{[SERIES]:[]},episodes:{[SERIES]:[]}});
 t.after(()=>mock.close());
 const tv={...emptyTvLibrary(),mode,mediaRoot,reviewRoot,libraryId:LIBRARY,sourceRoots:[SOURCE_ROOT],reviewPrefixes:['TV'],sonarrRoot:SONARR_ROOT};
 const w={root,mediaRoot,reviewRoot,tv,mock,jobs:[],dbCalls:0,state:{items:{},history:[],sessions:{},pauses:[],reviewSessions:{},approvals:{}},saves:0,settings:{tv,sonarr:sonarr?{url:mock.url,apiKey:API_KEY}:null}};
 w.discovery=createTvDiscovery({getSettings:()=>w.settings,getMovieRoots:()=>({mediaRoot:path.join(root,'movies'),reviewRoot,reviewPrefixes:['PROD-Movies']}),getState:()=>w.state,save:async()=>{w.saves++},
  dbRows:async table=>{assert.equal(table,'jobsjsondb');w.dbCalls++;return structuredClone(w.jobs)},requestTimeoutMs,...(sonarrBudgetMs?{sonarrBudgetMs}:{})});
 // Adds one result and (unless `sonarr:false`) the Sonarr records that make it bind exactly.
 w.add=async(relative,{jobId='job-'+relative,file=true,episodes=[{season:1,number:1}],fileId,episodeIds,series=SERIES,...rest}={})=>{
  const created=await addTvResult({mediaRoot,reviewRoot,relative,jobId,...rest});w.jobs.push(created.job);
  if(file){
   fileId??=100+mock.data.files[series].length+1;
   mock.data.files[series].push(fileRecord(fileId,series,relative,{seasonNumber:episodes[0]?.season??1}));
   episodes.forEach((episode,index)=>mock.data.episodes[series].push(episodeRecord(episodeIds?.[index]??fileId*10+index,series,fileId,{seasonNumber:episode.season,episodeNumber:episode.number,absoluteEpisodeNumber:episode.absolute??null,airDate:episode.airDate??null})));
  }
  return {...created,fileId};
 };
 return w;
}
const everything=value=>[...value.series.flatMap(s=>s.seasons.flatMap(x=>x.results)),...value.unbound,...value.unverified];
const reasonOf=(value,relative)=>everything(value).find(item=>item.reviewRelative==='TV/'+relative);

test('mode off (the default) scans nothing and never calls Tdarr or Sonarr',async t=>{
 for(const settings of [null,{tv:null,sonarr:null},{tv:{...emptyTvLibrary()},sonarr:null}]){
  const w=await world(t,{mode:'off'});await w.add('Synthetic Show/Season 01/S01E01.mkv');w.settings=settings??null;
  assert.deepEqual(await w.discovery.result({force:true}),{mode:'off'});
  assert.equal(w.dbCalls,0);assert.deepEqual(w.mock.calls,[]);assert.equal(w.saves,0);assert.equal(w.state.tv,undefined,'no TV state is created');assert.equal(w.discovery.mode(),'off');
  assert.equal(w.discovery.ownsResult('TV/Synthetic Show/Season 01/S01E01.mkv'),false,'off mode takes nothing from the movie scan');
 }
 const w=await world(t,{mode:'off'});w.settings={tv:{...w.tv,mode:'off'},sonarr:{url:w.mock.url,apiKey:API_KEY}};
 assert.deepEqual(await w.discovery.result(),{mode:'off'});assert.equal(w.dbCalls,0);assert.deepEqual(w.mock.calls,[]);
});

test('an exact job, source mapping and one EpisodeFile bind a result, with read-only Sonarr reads for only that series',async t=>{
 const w=await world(t);
 w.mock.data.series.push({id:8,title:'Uninvolved Show',path:SONARR_ROOT+'\\Uninvolved Show',seriesType:'standard'});w.mock.data.files[8]=[];w.mock.data.episodes[8]=[];
 await w.add('Synthetic Show/Season 01/S01E01.mkv');
 const value=await w.discovery.result({force:true});
 assert.equal(value.mode,'discovery');assert.equal(value.status,'ok');
 assert.deepEqual(value.totals,{results:1,bound:1,unbound:0,unverified:0,episodes:1,originalBytes:value.series[0].totals.originalBytes,reviewBytes:value.series[0].totals.reviewBytes});
 const item=value.series[0].seasons[0].results[0];
 assert.equal(item.state,'bound');assert.equal(item.id,tvItemId('TV/Synthetic Show/Season 01/S01E01.mkv'));assert.equal(item.series.title,'Synthetic Show');
 assert.equal(item.episodes.length,1);assert.equal(item.observedAt,w.discovery&&item.observedAt);assert.equal(value.sonarr.status,'verified');assert.ok(value.sonarr.observedAt);
 assert.ok(w.mock.calls.length>0&&w.mock.calls.every(call=>call.method==='GET'&&call.key===API_KEY),'every Sonarr request is a keyed GET');
 const paths=w.mock.paths();
 assert.ok(paths.includes('/api/v3/episodefile?seriesId=7')&&paths.includes('/api/v3/episode?seriesId=7'));
 assert.equal(paths.some(p=>p.includes('seriesId=8')),false,'a series without results is never requested');
 const text=JSON.stringify(value);for(const secret of [API_KEY,w.mediaRoot,w.reviewRoot,SONARR_ROOT,SOURCE_ROOT])assert.equal(text.includes(secret),false,'no private value in the overview');
});

test('multi-episode files, specials, anime absolute numbering and daily numbering stay separate',async t=>{
 const w=await world(t);
 w.mock.data.series[0].seriesType='standard';
 await w.add('Synthetic Show/Season 01/S01E01-E02.mkv',{episodes:[{season:1,number:1},{season:1,number:2}]});
 await w.add('Synthetic Show/Season 01/S01E03.mkv',{episodes:[{season:1,number:3}]});
 await w.add('Synthetic Show/Specials/S00E01.mkv',{episodes:[{season:0,number:1}]});
 const value=await w.discovery.result({force:true});
 const [show]=value.series;
 assert.deepEqual(show.seasons.map(s=>s.seasonNumber),[0,1],'season 0 (specials) is its own season, listed first');
 assert.equal(show.seasons[0].results.length,1);assert.equal(show.seasons[1].results.length,2);
 const multi=show.seasons[1].results[0];assert.deepEqual(multi.episodes.map(e=>e.episodeNumber),[1,2],'one file binds both of its episodes');
 assert.equal(show.totals.results,3);assert.equal(show.totals.episodes,4,'files and episodes are counted separately');
 assert.equal(show.seasons[0].results[0].episodes[0].seasonNumber,0);
 // Anime: absolute numbering is carried next to season numbering; daily: the air date is carried.
 const a=await world(t);a.mock.data.series[0]={...a.mock.data.series[0],title:'Synthetic Anime',seriesType:'anime',path:SONARR_ROOT+'\\Synthetic Anime'};
 await a.add('Synthetic Anime/Season 01/Episode 045.mkv',{episodes:[{season:1,number:1,absolute:45}]});
 let anime=await a.discovery.result({force:true});assert.equal(anime.series[0].seriesType,'anime');assert.equal(anime.series[0].seasons[0].results[0].episodes[0].absoluteEpisodeNumber,45);assert.equal(anime.series[0].seasons[0].results[0].episodes[0].episodeNumber,1);
 const d=await world(t);d.mock.data.series[0]={...d.mock.data.series[0],title:'Synthetic Daily',seriesType:'daily',path:SONARR_ROOT+'\\Synthetic Daily'};
 await d.add('Synthetic Daily/Season 2026/2026-10-26.mkv',{episodes:[{season:2026,number:300,airDate:'2026-10-26'}]});
 const daily=await d.discovery.result({force:true});assert.equal(daily.series[0].seriesType,'daily');assert.equal(daily.series[0].seasons[0].results[0].episodes[0].airDate,'2026-10-26');assert.equal(daily.series[0].seasons[0].seasonNumber,2026);
});

const REASON_CASES=[
 ['receipt_missing','receipt missing',{withReceipt:false}],
 ['receipt_invalid','receipt without a job id',{receipt:{jobId:undefined}}],
 ['receipt_invalid','receipt with an empty job id',{receipt:{jobId:' '}}],
 ['receipt_invalid','receipt with the wrong version',{receipt:{version:2}}],
 ['job_missing','job unknown to Tdarr',{dropJob:true}],
 ['job_not_successful','job not successful',{job:{status:'Transcode error'}}],
 ['job_other_library','job in another library',{job:{DB:'movie-library'}}],
 ['source_unmapped','job path outside the TV source roots',{job:{file:'Z:\\Elsewhere\\Synthetic Show\\Season 01\\S01E01.mkv'}}],
 ['job_mismatch','job sizes that do not match the files',{job:{fileSizeEndGB:1}}],
 ['files_changed','result replaced after the receipt',{afterAdd:async c=>{await fs.writeFile(c.resultPath,Buffer.from('replaced result bytes.....'));const old=new Date(Date.now()-300000);await fs.utimes(c.resultPath,old,old);}}],
 ['files_changed','same-size content with the old mtime',{afterAdd:async c=>{const st=await fs.stat(c.sourcePath),bytes=Buffer.from(c.sourceBytes);bytes[3]^=0xff;await fs.writeFile(c.sourcePath,bytes);await fs.utimes(c.sourcePath,st.atime,st.mtime);}}],
 ['files_changed','source removed so the receipt cannot match',{afterAdd:async c=>{await fs.appendFile(c.sourcePath,'more');}}],
 ['file_in_progress','result written moments ago',{ageMs:1000}],
 ['no_episode_file','no EpisodeFile for the source path',{file:false}],
];
for(const [reason,label,options] of REASON_CASES)test('unbound '+reason+': '+label,async t=>{
 const w=await world(t),relative='Synthetic Show/Season 01/S01E01.mkv';
 const {afterAdd,dropJob,...rest}=options;
 const created=await w.add(relative,{...rest});
 if(dropJob)w.jobs.length=0;
 await afterAdd?.(created);
 const value=await w.discovery.result({force:true}),item=reasonOf(value,relative);
 assert.ok(UNBOUND_REASONS.includes(reason));
 assert.equal(item.state,'unbound');assert.equal(item.reason,reason);assert.equal(value.totals.bound,0);assert.equal(value.series.length,0,'an unbound result is never listed under a series');
 assert.equal(item.series,undefined);assert.equal(item.episodes,undefined);
});

test('a source file that is gone is unmapped, never guessed from names',async t=>{
 const w=await world(t),relative='Synthetic Show/Season 01/S01E01.mkv',created=await w.add(relative);
 await fs.rm(created.sourcePath);
 // A similarly named file elsewhere must not be taken for the source.
 await fs.mkdir(path.join(w.mediaRoot,'Synthetic Show','Season 1'),{recursive:true});await fs.writeFile(path.join(w.mediaRoot,'Synthetic Show','Season 1','S01E01.mkv'),created.sourceBytes);
 const value=await w.discovery.result({force:true});
 assert.equal(reasonOf(value,relative).reason,'source_unmapped');assert.equal(value.totals.bound,0);
});

test('two results for one source file or one job both stay unbound',async t=>{
 const w=await world(t),relative='Synthetic Show/Season 01/S01E01.mkv';
 const first=await w.add(relative,{jobId:'job-dup'});
 // The same source file and receipt under a second result prefix: two results claim one source.
 w.tv.reviewPrefixes=['TV','TV2'];
 const copy=path.join(w.reviewRoot,'TV2',...relative.split('/'));await fs.mkdir(path.dirname(copy),{recursive:true});
 await fs.copyFile(first.resultPath,copy);await fs.copyFile(first.receiptPath,copy+'.tdarr-receipt.json');const st=await fs.stat(first.resultPath);await fs.utimes(copy,st.atime,st.mtime);
 const value=await w.discovery.result({force:true});
 const reasons=everything(value).map(item=>item.reason);
 assert.deepEqual(reasons,['duplicate_result','duplicate_result']);assert.equal(value.totals.bound,0);
});

test('series and EpisodeFile ambiguity make a result unbound',async t=>{
 const w=await world(t);
 await w.add('Synthetic Show/Season 01/S01E01.mkv',{file:false});
 await w.add('Unknown Show/Season 01/S01E01.mkv',{file:false});
 await w.add('Synthetic Show/Season 01/S01E02.mkv');
 // Two EpisodeFiles on the same exact path.
 const duplicate=await w.add('Synthetic Show/Season 01/S01E03.mkv');
 w.mock.data.files[SERIES].push(fileRecord(900,SERIES,'Synthetic Show/Season 01/S01E03.mkv'));
 // An EpisodeFile without linked episodes.
 await w.add('Synthetic Show/Season 01/S01E04.mkv',{episodes:[]});
 // Nested series folders that both contain the path.
 const nested=await world(t);nested.mock.data.series.push({id:9,title:'Nested',path:SONARR_ROOT+'\\Synthetic Show\\Season 01',seriesType:'standard'});nested.mock.data.files[9]=[];nested.mock.data.episodes[9]=[];
 await nested.add('Synthetic Show/Season 01/S01E01.mkv');
 const value=await w.discovery.result({force:true}),by=name=>reasonOf(value,'Synthetic Show/Season 01/'+name);
 assert.equal(by('S01E01.mkv').reason,'no_episode_file');assert.equal(reasonOf(value,'Unknown Show/Season 01/S01E01.mkv').reason,'series_not_found');
 assert.equal(by('S01E02.mkv').state,'bound');assert.equal(by('S01E03.mkv').reason,'multiple_episode_files');assert.equal(by('S01E04.mkv').reason,'no_linked_episodes');
 assert.equal(reasonOf(await nested.discovery.result({force:true}),'Synthetic Show/Season 01/S01E01.mkv').reason,'series_ambiguous');void duplicate;
});

for(const [label,prepare,reason] of [
 ['unavailable (HTTP 503)',w=>{w.mock.status=503;},'sonarr_unavailable'],
 ['slow (past the request timeout)',w=>{w.mock.delayMs=600;},'sonarr_unavailable'],
 ['inconsistent (a record of another series)',w=>{w.mock.mixSeries=true;},'sonarr_inconsistent'],
 ['not configured',w=>{w.settings={...w.settings,sonarr:null};},'sonarr_not_configured'],
]){
 test('Sonarr '+label+' shows binding not verified and stores nothing as verified',async t=>{
  const w=await world(t,{requestTimeoutMs:150});await w.add('Synthetic Show/Season 01/S01E01.mkv');await w.add('Synthetic Show/Season 01/S01E02.mkv',{file:false});
  prepare(w);
  const started=Date.now(),value=await w.discovery.result({force:true});
  assert.ok(Date.now()-started<5000,'the scan is bounded by the request timeout');
  assert.ok(UNVERIFIED_REASONS.includes(reason));
  assert.equal(value.totals.bound,0);assert.equal(value.series.length,0);assert.equal(value.unverified.length,2);
  for(const item of value.unverified){assert.equal(item.state,'unverified');assert.equal(item.reason,reason);assert.equal(item.series,undefined);assert.equal(item.episodes,undefined);}
  assert.equal(value.sonarr.observedAt,null,'no observation time for a Sonarr read that did not verify');
  assert.ok(w.mock.calls.every(call=>call.method==='GET'));
  for(const entry of Object.values(w.state.tv.items))assert.deepEqual(Object.keys(entry).sort(),['jobId','receiptIdentity','relative','reviewRelative','snapshot'],'persisted TV state holds file-side evidence only');
 });
}

test('results that fail before Sonarr never trigger a Sonarr request',async t=>{
 const w=await world(t);await w.add('Synthetic Show/Season 01/S01E01.mkv',{withReceipt:false});await w.add('Synthetic Show/Season 01/S01E02.mkv',{job:{status:'Transcode error'}});
 const value=await w.discovery.result({force:true});
 assert.equal(value.unbound.length,2);assert.deepEqual(w.mock.calls,[]);assert.equal(value.sonarr.status,'not_needed');
});

test('a TV scan leaves movie items, sessions, approvals and history byte-identical and only adds state.tv',async t=>{
 const w=await world(t);
 w.state={items:{[hash('PROD-Movies/Film/Film.mkv').slice(0,24)]:{snapshot:'s',relative:'Film/Film.mkv',reviewRelative:'PROD-Movies/Film/Film.mkv',jobId:'j'}},history:[{id:'a',action:'approve',status:'success'}],sessions:{x:1},pauses:[],reviewSessions:{a:{revision:2}},approvals:{a:{at:1}},replacementQueue:[],queueInterrupted:[],batch:{status:'complete'}};
 const before=JSON.stringify(w.state);
 await w.add('Synthetic Show/Season 01/S01E01.mkv');await w.discovery.result({force:true});
 const {tv,...rest}=w.state;assert.equal(JSON.stringify(rest),before,'every movie key is byte-identical');assert.ok(tv&&Object.keys(tv.items).length===1);
 assert.equal(w.saves,1);await w.discovery.result({force:true});assert.equal(w.saves,1,'an unchanged scan does not write state');
 for(const id of Object.keys(tv.items))assert.ok(!(id in w.state.items),'TV ids never live in the movie item map');
});

test('TV ids come from their own key and cannot equal a movie id',()=>{
 const relative='Synthetic Show/Season 01/S01E01.mkv';
 assert.match(tvItemId(relative),/^[a-f0-9]{24}$/);
 assert.notEqual(tvItemId(relative),hash(relative).slice(0,24));assert.notEqual(tvItemId('TV/'+relative),hash('TV/'+relative).slice(0,24));
 assert.equal(tvItemId(relative),hash('tv\0'+relative).slice(0,24));
});

test('switching the mode back to off stops scanning and Sonarr reads at once',async t=>{
 const w=await world(t);await w.add('Synthetic Show/Season 01/S01E01.mkv');
 assert.equal((await w.discovery.result({force:true})).totals.bound,1);const dbCalls=w.dbCalls,calls=w.mock.calls.length;
 w.settings={...w.settings,tv:{...w.tv,mode:'off'}};
 assert.deepEqual(await w.discovery.result({force:true}),{mode:'off'});assert.equal(w.dbCalls,dbCalls);assert.equal(w.mock.calls.length,calls);
});

test('the movie scan hands over only TV result prefixes, and only in discovery mode',async t=>{
 const w=await world(t);
 assert.equal(w.discovery.ownsResult('TV/Show/Season 01/S01E01.mkv'),true);assert.equal(w.discovery.ownsResult('PROD-Movies/Film/Film.mkv'),false);assert.equal(w.discovery.ownsResult('Other/Film/Film.mkv'),false);
});

test('overlapping TV and movie roots are refused rather than scanned',async t=>{
 const w=await world(t);w.tv.reviewPrefixes=[];await w.add('Synthetic Show/Season 01/S01E01.mkv');
 const value=await w.discovery.result({force:true});assert.equal(value.status,'unavailable');assert.equal(value.code,'tv_roots_overlap');assert.deepEqual(w.mock.calls,[]);
});

test('an unreadable Tdarr database makes discovery unavailable instead of binding anything',async t=>{
 const w=await world(t);await w.add('Synthetic Show/Season 01/S01E01.mkv');
 const broken=createTvDiscovery({getSettings:()=>w.settings,getMovieRoots:()=>({mediaRoot:'/x/movies',reviewRoot:'/x/review',reviewPrefixes:['PROD-Movies']}),getState:()=>w.state,save:async()=>{},dbRows:async()=>{throw Error('down')}});
 const value=await broken.result({force:true});assert.equal(value.status,'unavailable');assert.equal(value.code,'tv_tdarr_unavailable');assert.deepEqual(w.mock.calls,[]);
});

test('file-side evidence is reused for an unchanged result and re-read when a file changes',async t=>{
 const w=await world(t),relative='Synthetic Show/Season 01/S01E01.mkv',created=await w.add(relative);
 assert.equal((await w.discovery.result({force:true})).totals.bound,1);
 const id=tvItemId('TV/'+relative);assert.equal(w.state.tv.items[id].receiptIdentity,true);
 const st=await fs.stat(created.sourcePath),bytes=Buffer.from(created.sourceBytes);bytes[3]^=0xff;await fs.writeFile(created.sourcePath,bytes);await fs.utimes(created.sourcePath,st.atime,st.mtime);
 const value=await w.discovery.result({force:true});assert.equal(reasonOf(value,relative).reason,'files_changed');assert.equal(sampleOf(bytes)===created.receipt.source.sample,false);
});

test('a Sonarr address without a base path reaches /api/v3 instead of a doubled slash',async t=>{
 const mock=await sonarrMock({series:[{id:7,title:'Synthetic Show',path:SONARR_ROOT+'\\Synthetic Show'}],files:{},episodes:{}});t.after(()=>mock.close());
 assert.equal(new URL(mock.url).pathname,'/');
 const inspection=createSonarrInspection({getConnection:async()=>({url:mock.url,apiKey:API_KEY})});
 assert.deepEqual(await inspection.series('revision'),{series:[{id:7,title:'Synthetic Show'}]});
 assert.deepEqual(mock.paths(),['/api/v3/series']);
});

test('ownsResult hands over a TV prefix only inside the shared movie review root and never when misconfigured',async t=>{
 const w=await world(t);
 const make=(tvRoot,movieRoot,prefixes=['TV'])=>createTvDiscovery({getSettings:()=>({tv:{...w.tv,reviewRoot:tvRoot,reviewPrefixes:prefixes},sonarr:null}),getMovieRoots:()=>({mediaRoot:path.join(w.root,'movies'),reviewRoot:movieRoot,reviewPrefixes:['PROD-Movies']}),getState:()=>w.state,save:async()=>{},dbRows:async()=>[]});
 assert.equal(make('/x/r','/x/r').ownsResult('TV/Show/S01E01.mkv'),true);
 assert.equal(make('/x/r','/x/mvr').ownsResult('TV/Film/Film.mkv'),false,'a movie folder named like a TV prefix in a separate movie root stays a movie');
 assert.equal(make('/x/r/TV','/x/r').ownsResult('TV/Film/Film.mkv'),false,'nested roots are misconfigured');
 assert.equal(make('/x/r','/x/r',[]).ownsResult('TV/Film/Film.mkv'),false,'no prefix with a shared root is misconfigured');
 const overlapping=createTvDiscovery({getSettings:()=>({tv:{...w.tv,reviewRoot:'/x/r',mediaRoot:path.join(w.root,'movies')},sonarr:null}),getMovieRoots:()=>({mediaRoot:path.join(w.root,'movies'),reviewRoot:'/x/r',reviewPrefixes:['PROD-Movies']}),getState:()=>w.state,save:async()=>{},dbRows:async()=>[]});
 assert.equal(overlapping.ownsResult('TV/Film/Film.mkv'),false,'overlapping media roots (tv_roots_overlap) hand nothing over');
 assert.equal(make('/x/r','/x/r',['PROD-Movies']).ownsResult('PROD-Movies/Film/Film.mkv'),false,'a movie prefix is never taken');
});

test('two EpisodeFiles that differ only in path separators are multiple EpisodeFiles',async t=>{
 const w=await world(t),relative='Synthetic Show/Season 01/S01E01.mkv';
 await w.add(relative);
 w.mock.data.files[SERIES].push(fileRecord(900,SERIES,relative,{path:'Z:/Sonarr/TV/'+relative}));
 const value=await w.discovery.result({force:true});
 assert.equal(reasonOf(value,relative).reason,'multiple_episode_files');assert.equal(value.totals.bound,0);
});

test('the overall Sonarr budget bounds each request, so a hung Sonarr cannot hold the scan',async t=>{
 const w=await world(t,{requestTimeoutMs:5000,sonarrBudgetMs:300});await w.add('Synthetic Show/Season 01/S01E01.mkv');
 w.mock.delayMs=3000;
 const started=Date.now(),value=await w.discovery.result({force:true});
 assert.ok(Date.now()-started<2000,'the budget, not the request timeout, ends the wait');
 assert.equal(value.unverified[0].reason,'sonarr_unavailable');assert.equal(value.totals.bound,0);
});
