import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createTvSeasonSampleService} from './tv-season-sample-service.mjs';
import {projectSeasonTechnicalFacts} from './sonarr-technical-facts.mjs';

const settingsRevision='settings-r1',discoveryRevision='a'.repeat(64),seriesId=7,episodeFileId=31,jobId='job-31';
const sourceRelative='Show/Season 01/S01E01.mkv',sourceBytes=2**30,resultBytes=2**29;
const episodeFile={id:episodeFileId,seriesId,path:'/sonarr/tv/'+sourceRelative,relativePath:sourceRelative,seasonNumber:1,releaseGroup:'Declared Group'};
const episode={id:310,seriesId,episodeFileId,hasFile:true,seasonNumber:1,episodeNumber:1,absoluteEpisodeNumber:null,sceneAbsoluteEpisodeNumber:null,sceneSeasonNumber:null,sceneEpisodeNumber:null,airDate:null,airDateUtc:null,unverifiedSceneNumbering:null};
const receipt={version:2,relative:sourceRelative,jobId,strictProof:{profile:{id:'tv-review-staging-v1-template',version:1},jobId,sourceIdentity:{dev:1,ino:101,ctime:10},outputIdentity:{dev:1,ino:102,ctime:11},preservation:'passed',decode:'complete',stagedCopy:'verified'}};
const identity={source:{dev:1,ino:101,mode:33188,nlink:1,size:sourceBytes,mtimeMs:1,ctimeMs:10,directories:[{dev:1,ino:11,mode:16877,nlink:1,mtimeMs:1,ctimeMs:1}]},result:{dev:1,ino:102,mode:33188,nlink:1,size:resultBytes,mtimeMs:1,ctimeMs:11,directories:[{dev:1,ino:12,mode:16877,nlink:1,mtimeMs:1,ctimeMs:1}]},receipt:{dev:1,ino:103,mode:33188,nlink:1,size:200,mtimeMs:1,ctimeMs:12,directories:[]}};
const roles={comment:false,original:false,dub:false,hearing_impaired:false,visual_impaired:false,clean_effects:false,attached_pic:false,timed_thumbnails:false,captions:false,descriptions:false,metadata:false,dependent:false,still_image:false,non_diegetic:false,multilayer:false};
function facts(codec,encoderTag=null){const video={codec,declaredEncoderTag:encoderTag,dimensions:{width:1920,height:1080},frameRateFps:23.976,fieldOrder:'progressive',pixelFormat:'yuv420p',bitDepth:8,color:{primaries:'bt709',transfer:'bt709',space:'bt709',range:'tv'},hdrMetadata:{dolbyVision:false,hdr10Plus:false,masteringDisplay:false,contentLightLevel:false}};return {container:'matroska',durationSeconds:42,video:[video],audio:[],subtitles:[]}}
const probeFacts={source:facts('h264'),result:facts('hevc')};
function baseSettings(url){const tv={mediaRoot:'/synthetic/media',reviewRoot:'/synthetic/review',sonarrRoot:'/sonarr/tv',libraryId:'tv-library',mode:'strict-review',sourceRoots:['/media/tv'],reviewPrefixes:['TV']};const sonarr={url,apiKey:'mock-key'};const active={generation:3,sonarr,libraries:{tv},review:{ffprobe:'/unused/ffprobe',database:'/unused/jobs.db'}};const current={revision:settingsRevision,generation:3,draft:{sonarr:structuredClone(sonarr),libraries:{tv:structuredClone(tv)}}};const pin={generation:3,settingsRevision,discoveryRevision,overview:{series:[{id:seriesId,seasons:[{seasonNumber:1,results:[{file:{episodeFileId},episodes:[{id:episode.id,seasonNumber:1,episodeNumber:1}]}]}]}]}};return {active,current,pin}}
async function mockSonarr({files=[episodeFile],episodes=[episode],seriesType='standard',onCall=()=>{}}={}){
 const calls=[];const server=createServer((req,res)=>{calls.push(req.url);onCall(req.url,calls.length);res.setHeader('content-type','application/json');let data;if(req.url==='/api/v3/series')data=[{id:seriesId,title:'Synthetic Show',path:'/sonarr/tv/Show',seriesType}];else if(req.url===`/api/v3/episodefile?seriesId=${seriesId}`)data=files;else if(req.url===`/api/v3/episode?seriesId=${seriesId}`)data=episodes;else{res.writeHead(404);res.end('{}');return}res.end(JSON.stringify(data))});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {url:`http://127.0.0.1:${server.address().port}`,calls,close:()=>new Promise(resolve=>server.close(resolve))};
}
function fakeProbe({identityValue=identity,receiptValue=receipt,changeOnFinal=false,factsValue=probeFacts}={}){let calls=0;const batches=[];const fn=async({verifyOnly,pairs})=>{calls++;batches.push(pairs.length);const final=verifyOnly&&calls>1;return pairs.map(input=>({episodeFileId:input.episodeFileId,status:'observed',receipt:receiptValue,identity:structuredClone(changeOnFinal&&final?{...identityValue,source:{...identityValue.source,ino:999}}:identityValue),...(verifyOnly?{}:{facts:factsValue})}))};fn.calls=()=>calls;fn.batches=()=>batches;return fn}
function fakeJobs(records=[{_id:jobId,DB:'tv-library',status:'Transcode success',file:'/media/tv/'+sourceRelative,fileSizeStartGB:1,fileSizeEndGB:.5}],onCall=()=>{}){let calls=0;const fn=async({jobIds})=>{calls++;onCall(calls,jobIds);return jobIds.map(id=>({jobId:id,records:records.filter(record=>record._id===id)}))};fn.calls=()=>calls;return fn}
async function runWith({context,files,episodes,probe,readJobs}={}){const sonarr=await mockSonarr({files,episodes});try{const actualContext=context||baseSettings(sonarr.url),service=createTvSeasonSampleService({getContext:async()=>actualContext,probe:probe||fakeProbe(),readJobs:readJobs||fakeJobs()});return {plan:await service.create({settingsRevision,discoveryRevision,seriesId,seasonNumber:1}),calls:sonarr.calls}}finally{await sonarr.close()}}

test('manual service proposes one exact v2-bound current physical file without encoder-build or release-family claims',async()=>{
 const probe=fakeProbe(),jobs=fakeJobs(),{plan,calls}=await runWith({probe,readJobs:jobs});
 assert.equal(plan.complete,true);assert.equal(plan.authorization,'none');assert.equal(plan.batchReady,false);assert.equal(plan.cohorts.length,1);assert.equal(plan.cohorts[0].count,1);assert.deepEqual(plan.cohorts[0].sampleEpisodeFileIds,[episodeFileId]);assert.deepEqual(plan.cohorts[0].members[0].episodeIds,[episode.id]);assert.deepEqual(plan.cohorts[0].members[0].episodes.map(value=>value.episodeNumber),[1]);assert.equal(plan.cohorts[0].sourceFamilyVerified,false);assert.equal(plan.cohorts[0].signature.source.video.encoderTag.state,'not_reported');
 assert.ok(calls.length>=6,'series and complete episode/file snapshots are read twice');assert.equal(probe.calls(),3,'the worker observes, probes and revalidates without writing files');assert.equal(jobs.calls(),3,'only exact selected job evidence is read and rechecked after the Sonarr snapshot');
});

test('real unmodified FFprobe SDR projection with omitted HDR side data remains unreported in a bounded plan',async()=>{
 const rawSource=JSON.parse(await readFile(new URL('./test-fixtures/season-sample-normal-source-ffprobe.json',import.meta.url),'utf8'));
 const rawResult=JSON.parse(await readFile(new URL('./test-fixtures/season-sample-normal-result-ffprobe.json',import.meta.url),'utf8'));
 const factsValue={source:projectSeasonTechnicalFacts(rawSource),result:projectSeasonTechnicalFacts(rawResult)};
 assert.equal(Object.hasOwn(rawSource.streams[0],'side_data_list'),false,'the checked-in raw probe is the real producer output with no HDR side-data field');assert.equal(Object.hasOwn(rawResult.streams[0],'side_data_list'),false);
 const {plan}=await runWith({probe:fakeProbe({factsValue})});
 assert.equal(plan.complete,true);assert.equal(plan.cohorts.length,1,'the verified current SDR v2 evidence permits a technical proposal');
 const hdr=plan.cohorts[0].signature.source.video.hdrMetadata;
 assert.deepEqual(hdr,{dolbyVision:null,hdr10Plus:null,masteringDisplay:null,contentLightLevel:null},'unreported HDR side-data remains null; it is not asserted absent');
 assert.deepEqual(plan.cohorts[0].signature.source.video.color,{primaries:'bt709',transfer:'bt709',space:'bt709',range:'tv'});
});

test('unknown color, affirmative HDR side-data, or HDR color without side-data stay excluded',async()=>{
 const rawSource=JSON.parse(await readFile(new URL('./test-fixtures/season-sample-normal-source-ffprobe.json',import.meta.url),'utf8'));
 const rawResult=JSON.parse(await readFile(new URL('./test-fixtures/season-sample-normal-result-ffprobe.json',import.meta.url),'utf8'));
 const runFacts=async source=>runWith({probe:fakeProbe({factsValue:{source:projectSeasonTechnicalFacts(source),result:projectSeasonTechnicalFacts(rawResult)}})});
 const missingColor=structuredClone(rawSource);delete missingColor.streams[0].color_primaries;
 const noColor=await runFacts(missingColor);assert.equal(noColor.plan.cohorts.length,0);assert.ok(noColor.plan.exceptions.some(value=>value.reason==='unknown_or_hdr_color'));
 for(const sideData of ['DOVI configuration record','HDR10+ dynamic metadata','Mastering display metadata','Content light level metadata']){
  const positiveHdr=structuredClone(rawSource);positiveHdr.streams[0].side_data_list=[{side_data_type:sideData}];
  const flagged=await runFacts(positiveHdr);assert.equal(flagged.plan.cohorts.length,0,sideData);assert.ok(flagged.plan.exceptions.some(value=>value.reason==='unknown_or_hdr_color'),sideData);
 }
 const contradictory=structuredClone(rawSource);contradictory.streams[0].side_data_list=[];contradictory.streams[0].color_transfer='smpte2084';
 const conflict=await runFacts(contradictory);assert.equal(conflict.plan.cohorts.length,0);assert.ok(conflict.plan.exceptions.some(value=>value.reason==='unknown_or_hdr_color'));
 const hdrTransfer=structuredClone(rawSource);hdrTransfer.streams[0].color_transfer='smpte2084';
 const transfer=await runFacts(hdrTransfer);assert.equal(transfer.plan.cohorts.length,0);assert.ok(transfer.plan.exceptions.some(value=>value.reason==='unknown_or_hdr_color'));
});

test('unknown or multiple language declarations are excluded but known and no-language declarations remain explicit',async()=>{
 const rawSource=JSON.parse(await readFile(new URL('./test-fixtures/season-sample-normal-source-ffprobe.json',import.meta.url),'utf8'));
 const rawResult=JSON.parse(await readFile(new URL('./test-fixtures/season-sample-normal-result-ffprobe.json',import.meta.url),'utf8'));
 const runLanguage=async language=>{const source=structuredClone(rawSource);source.streams.find(value=>value.codec_type==='audio').tags.language=language;return runWith({probe:fakeProbe({factsValue:{source:projectSeasonTechnicalFacts(source),result:projectSeasonTechnicalFacts(rawResult)}})})};
 for(const language of ['und','mul','mis','unknown','']){const {plan}=await runLanguage(language);assert.equal(plan.cohorts.length,0,language);assert.ok(plan.exceptions.some(value=>value.reason==='essential_track_fact_unknown'),language)}
 for(const language of ['eng','zxx']){const {plan}=await runLanguage(language);assert.equal(plan.cohorts.length,1,language);assert.equal(plan.cohorts[0].signature.source.audio[0].language,language)}
});

test('missing projected audio channels or channel layout cannot join a cohort',async()=>{
 const rawSource=JSON.parse(await readFile(new URL('./test-fixtures/season-sample-normal-source-ffprobe.json',import.meta.url),'utf8'));
 const rawResult=JSON.parse(await readFile(new URL('./test-fixtures/season-sample-normal-result-ffprobe.json',import.meta.url),'utf8'));
 for(const field of ['channels','channel_layout']){
  const source=structuredClone(rawSource);delete source.streams.find(value=>value.codec_type==='audio')[field];
  const factsValue={source:projectSeasonTechnicalFacts(source),result:projectSeasonTechnicalFacts(rawResult)}, {plan}=await runWith({probe:fakeProbe({factsValue})});
  assert.equal(plan.cohorts.length,0,field);assert.ok(plan.exceptions.some(value=>value.reason==='essential_track_fact_unknown'),field);
 }
});

test('unknown Sonarr season membership suppresses the whole sample denominator',async()=>{
 const unlinked={...episode,id:311,episodeFileId:0,hasFile:false,seasonNumber:null,episodeNumber:null};
 const linked={...episode,id:312,episodeFileId,hasFile:true,seasonNumber:null,episodeNumber:null};
 const {plan}=await runWith({episodes:[episode,unlinked,linked]});
 assert.equal(plan.complete,false);assert.equal(plan.status,'incomplete');assert.equal(plan.cohorts.length,0,'no observed subset is presented as a representative cohort');
 assert.equal(plan.exceptions.filter(value=>value.reason==='season_membership_unknown').length,2);
 const orphanFile={...episodeFile,id:32,path:'/sonarr/tv/Show/Season 01/unmapped.mkv',relativePath:'Season 01/unmapped.mkv',seasonNumber:null};
 const orphan=await runWith({files:[episodeFile,orphanFile],episodes:[episode]});
 assert.equal(orphan.plan.complete,false);assert.equal(orphan.plan.cohorts.length,0);assert.ok(orphan.plan.exceptions.some(value=>value.kind==='episodeFile'&&value.id===32&&value.reason==='season_membership_unknown'));
});

test('an episode with an explicit different season does not invalidate the selected season',async()=>{
 const outside={...episode,id:313,episodeFileId:0,hasFile:false,seasonNumber:2,episodeNumber:1};
 const {plan}=await runWith({episodes:[episode,outside]});
 assert.equal(plan.complete,true);assert.equal(plan.cohorts.length,1);assert.deepEqual(plan.cohorts[0].sampleEpisodeFileIds,[episodeFileId]);
 assert.equal(plan.exceptions.some(value=>value.reason==='season_membership_unknown'),false);
});

test('settings mismatch refuses before any Sonarr or file-worker reads',async()=>{
 const probe=fakeProbe(),sonarr=await mockSonarr();try{const context=baseSettings(sonarr.url);context.current.draft.sonarr.url='http://127.0.0.1:1';const service=createTvSeasonSampleService({getContext:async()=>context,probe,readJobs:fakeJobs()});await assert.rejects(service.create({settingsRevision,discoveryRevision,seriesId,seasonNumber:1}),error=>error.code==='settings_not_applied');assert.equal(sonarr.calls.length,0);assert.equal(probe.calls(),0)}finally{await sonarr.close()}
});

test('only one selected-season plan holds the worker slot at a time',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve}),service=createTvSeasonSampleService({getContext:async()=>{await gate;throw Error('synthetic stop')}}),request={settingsRevision,discoveryRevision,seriesId,seasonNumber:1},first=service.create(request);
 await assert.rejects(service.create(request),error=>error.code==='tv_plan_busy');release();await assert.rejects(first,/synthetic stop/);
});

test('stale v1 proof is excluded and a final file identity change aborts publication',async()=>{
 const v1={...receipt,version:1,strictProof:undefined};const first=await runWith({probe:fakeProbe({receiptValue:v1})});assert.equal(first.plan.status,'complete_with_exclusions');assert.equal(first.plan.cohorts.length,0);assert.equal(first.plan.exceptions.some(value=>value.reason==='strict_flow_unverified'),true);
 const sonarr=await mockSonarr(),probe=fakeProbe({changeOnFinal:true});try{const settings=baseSettings(sonarr.url),service=createTvSeasonSampleService({getContext:async()=>settings,probe,readJobs:fakeJobs()});await assert.rejects(service.create({settingsRevision,discoveryRevision,seriesId,seasonNumber:1}),error=>error.code==='tv_plan_files_changed');assert.equal(probe.calls(),3)}finally{await sonarr.close()}
});

test('missing Sonarr releaseGroup remains explicit and cannot masquerade as verified source family',async()=>{
 const file={...episodeFile};delete file.releaseGroup;const {plan}=await runWith({files:[file]});assert.equal(plan.cohorts.length,0);assert.equal(plan.cohorts.length===0,true);assert.equal(plan.exceptions.some(value=>value.reason==='release_group_unknown'),true);assert.equal(plan.complete,true);
});

test('a final applied settings change prevents plan publication',async()=>{
 const sonarr=await mockSonarr();
 try{const settings=baseSettings(sonarr.url);let contexts=0;const service=createTvSeasonSampleService({getContext:async()=>++contexts===2?{...settings,current:{...settings.current,revision:'settings-r2'}}:settings,probe:fakeProbe(),readJobs:fakeJobs()});await assert.rejects(service.create({settingsRevision,discoveryRevision,seriesId,seasonNumber:1}),error=>error.code==='settings_not_applied');assert.equal(contexts,2)}finally{await sonarr.close()}
});
test('a final Sonarr snapshot change prevents plan publication',async()=>{
 let seriesReads=0;const file={...episodeFile},changing=await mockSonarr({files:[file],onCall:(route)=>{if(route==='/api/v3/series'&&++seriesReads===2)file.releaseGroup='Changed Group'}});
 try{const settings=baseSettings(changing.url),service=createTvSeasonSampleService({getContext:async()=>settings,probe:fakeProbe(),readJobs:fakeJobs()});await assert.rejects(service.create({settingsRevision,discoveryRevision,seriesId,seasonNumber:1}),error=>error.code==='tv_plan_sonarr_changed')}finally{await changing.close()}
});

test('duplicate exact Tdarr rows and changed final job evidence are excluded or abort publication',async()=>{
 const duplicated=fakeJobs([{_id:jobId,DB:'tv-library',status:'Transcode success',file:'/media/tv/'+sourceRelative,fileSizeStartGB:1,fileSizeEndGB:.5},{_id:jobId,DB:'tv-library',status:'Transcode success',file:'/media/tv/'+sourceRelative,fileSizeStartGB:1,fileSizeEndGB:.5}]);
 const duplicatePlan=await runWith({readJobs:duplicated});assert.equal(duplicatePlan.plan.cohorts.length,0);assert.equal(duplicatePlan.plan.exceptions.some(value=>value.reason==='job_unverified'),true);
 let reads=0;const matching=fakeJobs(),sonarr=await mockSonarr();
 try{const settings=baseSettings(sonarr.url),readJobs=async(request,options)=>{reads++;return reads===3?request.jobIds.map(id=>({jobId:id,records:[]})):matching(request,options)},service=createTvSeasonSampleService({getContext:async()=>settings,probe:fakeProbe(),readJobs});await assert.rejects(service.create({settingsRevision,discoveryRevision,seriesId,seasonNumber:1}),error=>error.code==='tv_plan_job_changed');assert.equal(reads,3)}finally{await sonarr.close()}
});

function seasonRows(count){return {files:Array.from({length:count},(_,index)=>({id:episodeFileId+index,seriesId,path:'/sonarr/tv/'+(index===0?sourceRelative:`Show/Season 01/S01E${String(index+1).padStart(2,'0')}.mkv`),relativePath:index===0?sourceRelative:`Season 01/S01E${String(index+1).padStart(2,'0')}.mkv`,seasonNumber:1,releaseGroup:'Declared Group'})),episodes:Array.from({length:count},(_,index)=>({id:episode.id+index,seriesId,episodeFileId:episodeFileId+index,hasFile:true,seasonNumber:1,episodeNumber:index+1}))}}
async function runSeasonLimit(count){const {files,episodes}=seasonRows(count),sonarr=await mockSonarr({files,episodes});try{const context=baseSettings(sonarr.url);context.pin.overview.series[0].seasons[0].results=files.map(file=>({file:{episodeFileId:file.id}}));const probe=fakeProbe(),readJobs=fakeJobs(),service=createTvSeasonSampleService({getContext:async()=>context,probe,readJobs});return {result:service.create({settingsRevision,discoveryRevision,seriesId,seasonNumber:1}),probe,readJobs,sonarr}}catch(error){await sonarr.close();throw error}}
test('the physical-pair cap accepts exactly 50 and refuses 51 without truncation',async()=>{
 const fifty=await runSeasonLimit(50);try{const plan=await fifty.result;assert.equal(plan.cohorts[0].count,1);assert.equal(plan.exceptions.length,49);assert.deepEqual(fifty.probe.batches(),[50,1,50]);assert.equal(fifty.readJobs.calls(),3)}finally{await fifty.sonarr.close()}
 const fiftyOne=await runSeasonLimit(51);try{await assert.rejects(fiftyOne.result,error=>error.code==='tv_plan_pair_limit');assert.deepEqual(fiftyOne.probe.batches(),[50,1]);assert.equal(fiftyOne.readJobs.calls(),0,'over-limit inventory is refused before querying Tdarr jobs or probing media')}finally{await fiftyOne.sonarr.close()}
});
test('multiple result-prefix candidates for one EpisodeFile count as one physical staged pair',async()=>{
 const sonarr=await mockSonarr();try{const context=baseSettings(sonarr.url);context.active.libraries.tv.reviewPrefixes=['TV','ALT'];context.current.draft.libraries.tv.reviewPrefixes=['TV','ALT'];const plan=await createTvSeasonSampleService({getContext:async()=>context,probe:fakeProbe(),readJobs:fakeJobs()}).create({settingsRevision,discoveryRevision,seriesId,seasonNumber:1});assert.equal(plan.complete,true);assert.equal(plan.cohorts.length,0);assert.equal(plan.exceptions.some(value=>value.reason==='multiple_staged_results'),true)}finally{await sonarr.close()}
});

test('daily Sonarr order uses validated air dates and refuses ambiguous chronology',async()=>{
 const rows=[{id:31,path:'/sonarr/tv/Show/Season 01/Episode A.mkv',relativePath:'Season 01/Episode A.mkv',seasonNumber:1,seriesId,releaseGroup:'Declared Group'},{id:32,path:'/sonarr/tv/Show/Season 01/Episode B.mkv',relativePath:'Season 01/Episode B.mkv',seasonNumber:1,seriesId,releaseGroup:'Declared Group'}];
 const episodes=[{id:310,seriesId,episodeFileId:31,hasFile:true,seasonNumber:1,episodeNumber:1,airDate:'2025-02-01',airDateUtc:'2025-02-01T00:00:00Z'},{id:320,seriesId,episodeFileId:32,hasFile:true,seasonNumber:1,episodeNumber:1,airDate:'2025-01-01',airDateUtc:'2025-01-01T00:00:00Z'}].map(value=>({...value,absoluteEpisodeNumber:null,sceneAbsoluteEpisodeNumber:null,sceneSeasonNumber:null,sceneEpisodeNumber:null,unverifiedSceneNumbering:null}));
 const proofs=new Map();for(let index=0;index<rows.length;index++){const file=rows[index],source={dev:1,ino:201+index,mode:33188,nlink:1,size:sourceBytes,mtimeMs:1,ctimeMs:20+index,directories:[{dev:1,ino:21+index,mode:16877,nlink:1,mtimeMs:1,ctimeMs:1}]},result={dev:1,ino:301+index,mode:33188,nlink:1,size:resultBytes,mtimeMs:1,ctimeMs:30+index,directories:[{dev:1,ino:31+index,mode:16877,nlink:1,mtimeMs:1,ctimeMs:1}]},receiptId='daily-job-'+file.id,receiptValue={version:2,relative:`Show/Season 01/Episode ${file.id===31?'A':'B'}.mkv`,jobId:receiptId,strictProof:{profile:{id:'tv-review-staging-v1-template',version:1},jobId:receiptId,sourceIdentity:{dev:source.dev,ino:source.ino,ctime:source.ctimeMs},outputIdentity:{dev:result.dev,ino:result.ino,ctime:result.ctimeMs},preservation:'passed',decode:'complete',stagedCopy:'verified'}};proofs.set(file.id,{receipt:receiptValue,identity:{source,result,receipt:null},job:{_id:receiptId,DB:'tv-library',status:'Transcode success',file:'/media/tv/'+receiptValue.relative,fileSizeStartGB:1,fileSizeEndGB:.5}})}
 const probe=async({verifyOnly,pairs})=>pairs.map(input=>({episodeFileId:input.episodeFileId,status:'observed',...proofs.get(input.episodeFileId),...(verifyOnly?{}:{facts:probeFacts})}));
 const run=async(episodeRows)=>{const sonarr=await mockSonarr({files:rows,episodes:episodeRows,seriesType:'daily'});try{const settings=baseSettings(sonarr.url);settings.pin.overview.series[0].seasons[0].results=rows.map(file=>({file:{episodeFileId:file.id}}));const service=createTvSeasonSampleService({getContext:async()=>settings,probe,readJobs:async({jobIds})=>jobIds.map(jobId=>({jobId,records:[...proofs.values()].map(value=>value.job).filter(value=>value._id===jobId)}))});return await service.create({settingsRevision,discoveryRevision,seriesId,seasonNumber:1})}finally{await sonarr.close()}};
 const plan=await run(episodes);assert.deepEqual(plan.cohorts[0].sampleEpisodeFileIds,[32,31],'the January Sonarr air date precedes February regardless of file ID or filename');assert.deepEqual(plan.cohorts[0].members.map(value=>value.episodes[0].airDate),['2025-01-01','2025-02-01']);
 const ambiguous=episodes.map(value=>({...value,airDate:'2025-01-01',airDateUtc:'2025-01-01T00:00:00Z'})),unknown=await run(ambiguous);assert.equal(unknown.cohorts.length,0);assert.equal(unknown.exceptions.filter(value=>value.reason==='sonarr_order_ambiguous').length,2);
});
