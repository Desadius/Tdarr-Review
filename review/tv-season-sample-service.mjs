import {createEpisodeBindingResolver} from './episode-binding.mjs';
import {createSonarrDiscoveryReader} from './sonarr-inspection.mjs';
import {mapSonarrSourcePath} from './sonarr-source-path.mjs';
import {mapReview} from './config.mjs';
import {matchReviewJob} from './job-matching.mjs';
import {validTvStrictProof,tvStrictProofMatchesFiles} from './tv-flow-proof.mjs';
import {buildTvSeasonSamplePlan} from './tv-season-sample-plan.mjs';
import {runTvSeasonProbe,runTvSeasonJobs} from './tv-season-probe.mjs';

const DEADLINE_MS=60000,PAIR_LIMIT=50,ROW_LIMIT=256,OUTPUT_LIMIT=1024*1024,AGGREGATE_LIMIT=4*1024*1024;
const fail=code=>Object.assign(Error(code),{code});
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const positive=value=>Number.isSafeInteger(value)&&value>0;
const validSeason=value=>Number.isSafeInteger(value)&&value>=0;
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const cleanRelease=value=>typeof value==='string'&&value.length<=120&&/^[\p{L}\p{N} ._+()\[\]-]+$/u.test(value.trim())?value.trim().normalize('NFKC'):null;
const safeJobId=value=>typeof value==='string'&&value===value.trim()&&Buffer.byteLength(value)<=512&&!/[\u0000-\u001f\u007f]/.test(value);
const safeLabel=value=>{if(typeof value!=='string'||value.length===0||value.length>2048||value.includes('\\')||/[\u0000-\u001f\u007f]/.test(value)||value.startsWith('/'))return 'Episode file';const label=value.split('/').at(-1);return label&&!/^[a-z][a-z0-9+.-]*:\/\//i.test(label)?label:'Episode file'};
function compareOrder(a,b){for(let index=0;index<Math.min(a.length,b.length);index++){const x=a[index],y=b[index];if(x===y)continue;if(typeof x==='number'&&typeof y==='number')return x-y;return String(x??'').localeCompare(String(y??''));}return a.length-b.length;}
const safeAirDate=value=>typeof value==='string'&&value.length<=40&&/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)&&Number.isFinite(Date.parse(value))?value:null;
const resultRelative=value=>/\.(?:m2ts|ts)$/i.test(value)?value.replace(/\.(?:m2ts|ts)$/i,'.mkv'):value;

function publicEpisode(value){return {id:value.id,seasonNumber:Number.isSafeInteger(value.seasonNumber)?value.seasonNumber:null,episodeNumber:Number.isSafeInteger(value.episodeNumber)?value.episodeNumber:null,absoluteEpisodeNumber:Number.isSafeInteger(value.absoluteEpisodeNumber)?value.absoluteEpisodeNumber:null,sceneAbsoluteEpisodeNumber:Number.isSafeInteger(value.sceneAbsoluteEpisodeNumber)?value.sceneAbsoluteEpisodeNumber:null,sceneSeasonNumber:Number.isSafeInteger(value.sceneSeasonNumber)?value.sceneSeasonNumber:null,sceneEpisodeNumber:Number.isSafeInteger(value.sceneEpisodeNumber)?value.sceneEpisodeNumber:null,airDate:safeAirDate(value.airDate),airDateUtc:safeAirDate(value.airDateUtc),unverifiedSceneNumbering:typeof value.unverifiedSceneNumbering==='boolean'?value.unverifiedSceneNumbering:null}}
function seasonMembers(snapshot,resolver,seasonNumber){
 const exceptions=[],members=[];let membershipUnknown=false;
 for(const episode of snapshot.episodes){
  if(episode.seasonNumber===null||episode.seasonNumber===undefined){exceptions.push({kind:'episode',id:positive(episode.id)?episode.id:null,reason:'season_membership_unknown'});membershipUnknown=true;continue;}
  if(episode.seasonNumber===seasonNumber&&(episode.episodeFileId===0||episode.episodeFileId===null))exceptions.push({kind:'episode',id:episode.id,episodeNumber:episode.episodeNumber??null,reason:'not_acquired'});
 }
 for(const file of snapshot.episodeFiles){
  const binding=resolver.resolve(file.path);
  if(binding.status!=='mapped'){
   if(file.seasonNumber===seasonNumber||file.seasonNumber===null||file.seasonNumber===undefined){exceptions.push({kind:'episodeFile',id:file.id,reason:file.seasonNumber===seasonNumber?'episode_binding_unknown':'season_membership_unknown'});membershipUnknown=true;}
   continue;
  }
  const selected=binding.episodes.filter(episode=>episode.seasonNumber===seasonNumber);
  if(selected.length)members.push({file,episodes:binding.episodes,seasonEpisodes:selected});
 }
 return {exceptions,members,membershipUnknown};
}
function sonarrOrder(episodes,type){
 const ordered=[...episodes];
 if(type==='daily'){
  const date=value=>value.airDateUtc||value.airDate;
  if(ordered.some(value=>!safeAirDate(date(value))||!Number.isSafeInteger(value.episodeNumber)))return null;
  ordered.sort((a,b)=>Date.parse(date(a))-Date.parse(date(b))||((a.episodeNumber??Infinity)-(b.episodeNumber??Infinity))||a.id-b.id);
  return [Date.parse(date(ordered[0])),ordered[0].episodeNumber??null,ordered[0].id];
 }
 if(type==='anime'&&ordered.some(value=>!Number.isSafeInteger(value.absoluteEpisodeNumber)))return null;
 if(type!=='anime'&&ordered.some(value=>!Number.isSafeInteger(value.episodeNumber)))return null;
 ordered.sort((a,b)=>type==='anime'?((a.absoluteEpisodeNumber??Infinity)-(b.absoluteEpisodeNumber??Infinity))||a.id-b.id:((a.seasonNumber??Infinity)-(b.seasonNumber??Infinity))||((a.episodeNumber??Infinity)-(b.episodeNumber??Infinity))||a.id-b.id);
 const episode=ordered[0],number=type==='anime'?episode?.absoluteEpisodeNumber:episode?.episodeNumber;
 return episode&&Number.isSafeInteger(number)&&number>=0?[episode.seasonNumber??null,number,episode.id]:null;
}
function supportedFacts(facts,profile){
 if(!facts?.source||!facts?.result)return 'metadata_unavailable';
 const currentSdrProfile=profile?.id==='tv-review-staging-v1-template'&&profile?.version===1;
 const hdrKeys=['dolbyVision','hdr10Plus','masteringDisplay','contentLightLevel'];
 for(const side of [facts.source,facts.result]){
  if(side.container!=='matroska'||side.video.length!==1)return 'unsupported_streams';
  const video=side.video[0];
  if(video.fieldOrder!=='progressive'||video.pixelFormat!=='yuv420p'||video.bitDepth!==8)return 'unsupported_video';
  const sdr=['bt709','smpte170m','smpte240m','gamma22','gamma28','iec61966-2-1'];
  const hdr=video.hdrMetadata,hdrValid=plain(hdr)&&Object.keys(hdr).length===hdrKeys.length&&hdrKeys.every(key=>Object.hasOwn(hdr,key)&&(hdr[key]===null||typeof hdr[key]==='boolean'));
  const hdrUnreported=hdrValid&&hdrKeys.some(key=>hdr[key]===null),hdrPresent=hdrValid&&hdrKeys.some(key=>hdr[key]===true);
  if(!video.color||!sdr.includes(video.color.primaries)||!sdr.includes(video.color.transfer)||!['bt709','smpte170m','smpte240m'].includes(video.color.space)||!['tv','pc'].includes(video.color.range)||!hdrValid||hdrPresent||hdrUnreported&&!currentSdrProfile)return 'unknown_or_hdr_color';
  if(!Number.isSafeInteger(video.dimensions.width)||!Number.isSafeInteger(video.dimensions.height)||!video.frameRateFps)return 'essential_video_fact_unknown';
  for(const track of [...side.audio,...side.subtitles])if(track.codec==='unknown'||!track.language||['und','mul','mis','unknown','unspecified'].includes(track.language.toLowerCase())||track.default===null||track.forced===null||!plain(track.roles)||Object.values(track.roles).some(value=>value===null)||(Object.hasOwn(track,'channels')&&(!track.channels||!track.channelLayout)))return 'essential_track_fact_unknown';
 }
 if(facts.result.video[0].codec!=='hevc')return 'unsupported_result_codec';
 const sourceDuration=facts.source.durationSeconds,resultDuration=facts.result.durationSeconds;
 if(!sourceDuration||!resultDuration||Math.abs(sourceDuration-resultDuration)>Math.max(.5,sourceDuration*.005))return 'duration_mismatch';
 return null;
}
function currentDraftMatches(active,current){
 const draft=current?.draft,activeTv=active?.libraries?.tv,draftTv=draft?.libraries?.tv;if(!draft||!activeTv||!draftTv)return false;
 const fields=['mediaRoot','reviewRoot','sonarrRoot','libraryId','mode','sourceRoots','reviewPrefixes'];
 return equal(active.sonarr||null,draft.sonarr||null)&&fields.every(key=>equal(activeTv[key]??null,draftTv[key]??null));
}

/** Read-only bounded selected-season planning; it has no write/approval adapter. */
export function createTvSeasonSampleService({getContext,probe=runTvSeasonProbe,readJobs=runTvSeasonJobs,now=Date.now}){
 let running=false;
 async function create(request,{signal}={}){
  if(running)throw fail('tv_plan_busy');running=true;
  const started=now(),remaining=()=>DEADLINE_MS-(now()-started);let aggregateBytes=0;
  const check=()=>{if(signal?.aborted)throw fail('tv_plan_cancelled');if(remaining()<=0)throw fail('tv_plan_deadline')};
  const account=value=>{aggregateBytes+=Buffer.byteLength(JSON.stringify(value));if(aggregateBytes>AGGREGATE_LIMIT)throw fail('tv_plan_row_limit')};
  try{
   if(!plain(request)||Object.keys(request).some(key=>!['settingsRevision','discoveryRevision','seriesId','seasonNumber'].includes(key))||typeof request.settingsRevision!=='string'||request.settingsRevision.length>128||!/^[a-zA-Z0-9._:-]+$/.test(request.settingsRevision)||typeof request.discoveryRevision!=='string'||!/^[a-f0-9]{64}$/.test(request.discoveryRevision)||!positive(request.seriesId)||!validSeason(request.seasonNumber))throw fail('tv_invalid_request');
   const context=await getContext(request.settingsRevision,request.discoveryRevision),{active,current,pin}=context;check();
   if(request.settingsRevision!==current.revision)throw fail('settings_conflict');
   if(!active||active.generation!==current.generation||!currentDraftMatches(active,current)||active.libraries?.tv?.mode!=='strict-review')throw fail('settings_not_applied');
   if(!pin||pin.generation!==active.generation||pin.settingsRevision!==current.revision||pin.discoveryRevision!==request.discoveryRevision||!pin.overview?.series?.some(series=>series.id===request.seriesId&&series.seasons?.some(season=>season.seasonNumber===request.seasonNumber)))throw fail('tv_plan_stale_discovery');
   const tv=active.libraries.tv,sonarr=active.sonarr,review=active.review;
   if(!sonarr?.url||!sonarr.apiKey||!tv.mediaRoot||!tv.reviewRoot||!Array.isArray(tv.sourceRoots)||!tv.sourceRoots.length||!review?.ffprobe||!review?.database)throw fail('tv_plan_unavailable');
   const reader=createSonarrDiscoveryReader({connection:sonarr,requestTimeoutMs:7000,remainingMs:remaining,signal});
   const seriesList=await reader.seriesList();check();const selectedSeries=seriesList.filter(value=>value.id===request.seriesId);
   if(selectedSeries.length!==1)throw fail('tv_plan_sonarr_unavailable');
   const series=selectedSeries[0],anchor=mapSonarrSourcePath({sonarrRoot:tv.sonarrRoot,filePath:series.path});
   if(anchor.status!=='mapped')throw fail('tv_plan_series_root_unsafe');
   const snapshot=await reader.seriesSnapshot(series.id);check();
   const resolver=createEpisodeBindingResolver({instanceKey:'tv-season-plan:'+request.discoveryRevision,seriesId:series.id,episodeFiles:snapshot.episodeFiles,episodes:snapshot.episodes});
   if(resolver.integrity().status!=='valid')throw fail('tv_plan_sonarr_inconsistent');
   const {exceptions,members,membershipUnknown}=seasonMembers(snapshot,resolver,request.seasonNumber);
   let complete=!membershipUnknown;
   const pinnedSeason=pin.overview.series.find(value=>value.id===series.id)?.seasons?.find(value=>value.seasonNumber===request.seasonNumber),currentFileIds=new Set(members.map(value=>value.file.id));
   for(const result of pinnedSeason?.results||[])if(Number.isSafeInteger(result.file?.episodeFileId)&&!currentFileIds.has(result.file.episodeFileId)){exceptions.push({kind:'episodeFile',id:result.file.episodeFileId,reason:'stale_discovery_result',episodes:Array.isArray(result.episodes)?result.episodes.map(publicEpisode):[]});complete=false;}
   if(members.length+exceptions.length>ROW_LIMIT)throw fail('tv_plan_row_limit');
   const inputs=[],records=[];
   for(const member of members){
    check();const file=member.file,source=mapSonarrSourcePath({sonarrRoot:tv.sonarrRoot,filePath:file.path});
    if(source.status!=='mapped'){exceptions.push({kind:'episodeFile',id:file.id,reason:'source_path_unmapped',episodes:member.episodes.map(publicEpisode)});continue;}
    if(!source.relative.startsWith(anchor.relative+'/')){exceptions.push({kind:'episodeFile',id:file.id,reason:'outside_series_root',episodes:member.episodes.map(publicEpisode)});complete=false;continue;}
    const output=resultRelative(source.relative),mapped=mapReview(output,tv.reviewPrefixes);
    if(!mapped||mapped!==output){exceptions.push({kind:'episodeFile',id:file.id,reason:'result_path_unmapped',episodes:member.episodes.map(publicEpisode)});continue;}
    const orderKey=sonarrOrder(member.seasonEpisodes,series.seriesType),eligible=member.episodes.length===1&&source.relative.toLowerCase().endsWith('.mkv'),prefixes=tv.reviewPrefixes.length?tv.reviewPrefixes:[''];
    for(const prefix of prefixes){const resultPath=prefix?prefix+'/'+output:output;inputs.push({episodeFileId:file.id,mediaRoot:tv.mediaRoot,reviewRoot:tv.reviewRoot,sourceRelative:source.relative,resultRelative:resultPath,probe:eligible&&!!orderKey});records.push({file,episodes:member.episodes,seasonEpisodes:member.seasonEpisodes,label:safeLabel(file.relativePath),sourceRelative:source.relative,resultRelative:resultPath,orderKey,eligible:eligible&&!!orderKey,releaseGroup:cleanRelease(file.releaseGroup)});}
    if(!orderKey)exceptions.push({kind:'episodeFile',id:file.id,reason:'sonarr_order_unknown',episodes:member.episodes.map(publicEpisode)});
    if(!eligible)exceptions.push({kind:'episodeFile',id:file.id,reason:member.episodes.length>1?'multi_episode_file':'unsupported_format',episodes:member.episodes.map(publicEpisode)});
   }
   if(inputs.length>ROW_LIMIT||exceptions.length>ROW_LIMIT)throw fail('tv_plan_row_limit');
   if(membershipUnknown){inputs.length=0;records.length=0;}
   async function fileBatches(values,options){const out=[];for(let i=0;i<values.length;i+=PAIR_LIMIT){check();const result=await probe({...options,pairs:values.slice(i,i+PAIR_LIMIT)},{timeoutMs:remaining(),signal});account(result);out.push(...result);}return out;}
   const first=inputs.length?await fileBatches(inputs,{verifyOnly:true}):[];check();if(first.length!==inputs.length)throw fail('tv_plan_evidence_unavailable');
   const byFile=new Map(),stagedIds=new Set();
   for(let index=0;index<first.length;index++){
    const row={input:inputs[index],record:records[index],value:first[index]},key=String(row.record.file.id),list=byFile.get(key)||[];list.push(row);byFile.set(key,list);
    if(row.value.status==='missing_result')continue;
    if(row.value.status==='observed')stagedIds.add(key);else{complete=false;exceptions.push({kind:'episodeFile',id:row.record.file.id,reason:row.value.reason==='unsafe_result'?'staged_result_unsafe':'staged_result_unverified',episodes:row.record.episodes.map(publicEpisode)});row.input.probe=false;}
   }
   if(stagedIds.size>PAIR_LIMIT)throw fail('tv_plan_pair_limit');
   for(const [id,list] of byFile){const found=list.filter(value=>value.value.status==='observed'),uncertain=list.some(value=>value.value.status!=='observed'&&value.value.status!=='missing_result');if(found.length>1){exceptions.push({kind:'episodeFile',id:Number(id),reason:'multiple_staged_results',episodes:found[0].record.episodes.map(publicEpisode)});for(const row of found)row.input.probe=false;}else if(found.length===1&&uncertain){exceptions.push({kind:'episodeFile',id:Number(id),reason:'staged_result_unverified',episodes:found[0].record.episodes.map(publicEpisode)});complete=false;for(const row of list)row.input.probe=false;}else if(found.length===0&&!uncertain)exceptions.push({kind:'episodeFile',id:Number(id),reason:'no_staged_result',episodes:list[0].record.episodes.map(publicEpisode)});}
   if(exceptions.length>ROW_LIMIT)throw fail('tv_plan_row_limit');
   const ids=[...new Set(first.filter(value=>value.status==='observed'&&safeJobId(value.receipt?.jobId)).map(value=>value.receipt.jobId))];
   const jobGroups=ids.length?await readJobs({database:review.database,jobIds:ids},{timeoutMs:remaining(),signal}):[];check();account(jobGroups);
   if(jobGroups.length!==ids.length)throw fail('tv_plan_evidence_unavailable');
   const jobs=new Map(jobGroups.map(value=>[value.jobId,value.records])),probeInputs=[],probeRecords=[];
   for(let index=0;index<first.length;index++){
    const row=first[index],record=records[index],input=inputs[index];if(row.status!=='observed'||!row.receipt)continue;
    const receipt=row.receipt,source=row.identity?.source,result=row.identity?.result;let reason=null,job=null;
    if(!source||!result||!validTvStrictProof(receipt)||receipt.relative!==input.sourceRelative||!tvStrictProofMatchesFiles(receipt,{dev:source.dev,ino:source.ino,ctimeMs:source.ctimeMs},{dev:result.dev,ino:result.ino,ctimeMs:result.ctimeMs}))reason='strict_flow_unverified';
    if(!reason){const exact=jobs.get(receipt.jobId)||[];if(exact.length!==1)reason='job_unverified';else try{job=matchReviewJob(exact,{receipt,receiptVersions:[2],libraryId:tv.libraryId,sourceRoots:tv.sourceRoots,relative:input.sourceRelative,sourceBytes:source.size,outputBytes:result.size})}catch{reason='job_unverified';}}
    if(!reason&&!record.releaseGroup)reason='release_group_unknown';
    if(reason){exceptions.push({kind:'episodeFile',id:record.file.id,reason,episodes:record.episodes.map(publicEpisode)});input.probe=false;continue;}
    record.job=job;record.profile=receipt.strictProof.profile;record.sourceBytes=source.size;record.resultBytes=result.size;record.identity=row.identity;record.receipt=receipt;
    if(record.eligible&&input.probe){probeInputs.push(input);probeRecords.push(record)}else input.probe=false;
   }
   const probed=probeInputs.length?await fileBatches(probeInputs,{verifyOnly:false,ffprobe:review.ffprobe}):[];check();if(probed.length!==probeInputs.length)throw fail('tv_plan_probe_incomplete');
   const probeById=new Map(probed.map(value=>[value.episodeFileId,value])),pairs=[];
   for(const record of probeRecords){
    const value=probeById.get(record.file.id);
    if(!value||value.status!=='observed'||!equal(value.identity,record.identity)||!equal(value.receipt,record.receipt)){exceptions.push({kind:'episodeFile',id:record.file.id,reason:'metadata_changed',episodes:record.episodes.map(publicEpisode)});complete=false;continue;}
    const reason=supportedFacts(value.facts,record.profile);if(reason){exceptions.push({kind:'episodeFile',id:record.file.id,reason,episodes:record.episodes.map(publicEpisode)});continue;}
    pairs.push({episodeFileId:record.file.id,episodeIds:record.seasonEpisodes.map(value=>value.id),episodes:record.seasonEpisodes.map(publicEpisode),label:record.label,sourceBytes:record.sourceBytes,resultBytes:record.resultBytes,orderKey:record.orderKey,facts:value.facts,releaseGroup:record.releaseGroup,profile:record.profile});
   }
   const orderGroups=new Map();for(const pair of pairs){const key=JSON.stringify(pair.orderKey.slice(0,2)),list=orderGroups.get(key)||[];list.push(pair);orderGroups.set(key,list);}
   const ambiguous=new Set();for(const group of orderGroups.values())if(group.length>1)for(const pair of group)ambiguous.add(pair.episodeFileId);
   const ordered=pairs.filter(pair=>!ambiguous.has(pair.episodeFileId));for(const pair of pairs)if(ambiguous.has(pair.episodeFileId))exceptions.push({kind:'episodeFile',id:pair.episodeFileId,reason:'sonarr_order_ambiguous',episodes:pair.episodes});
   ordered.sort((a,b)=>compareOrder(a.orderKey,b.orderKey)||a.episodeFileId-b.episodeFileId);for(let i=0;i<ordered.length;i++)ordered[i].order=i;
   const finalSeries=await reader.seriesList(),finalSnapshot=await reader.seriesSnapshot(series.id);check();if(!equal(seriesList,finalSeries)||!equal(snapshot,finalSnapshot))throw fail('tv_plan_sonarr_changed');
   const finalJobs=ids.length?await readJobs({database:review.database,jobIds:ids},{timeoutMs:remaining(),signal}):[];check();account(finalJobs);if(!equal(jobGroups,finalJobs))throw fail('tv_plan_job_changed');
   const lastJobs=ids.length?await readJobs({database:review.database,jobIds:ids},{timeoutMs:remaining(),signal}):[];check();account(lastJobs);if(!equal(jobGroups,lastJobs))throw fail('tv_plan_job_changed');
   const last=inputs.length?await fileBatches(inputs,{verifyOnly:true}):[];check();
   if(last.length!==first.length||last.some((value,index)=>value.status!==first[index].status||value.reason!==first[index].reason||!equal(value.identity,first[index].identity)||!equal(value.receipt,first[index].receipt)))throw fail('tv_plan_files_changed');
   const latest=await getContext(request.settingsRevision,request.discoveryRevision);check();
   if(latest.current.revision!==current.revision||latest.active?.generation!==active.generation||latest.pin?.discoveryRevision!==pin.discoveryRevision||!currentDraftMatches(latest.active,latest.current))throw fail('settings_not_applied');
   if(exceptions.length>ROW_LIMIT||pairs.length+exceptions.length>ROW_LIMIT)throw fail('tv_plan_row_limit');
   const plan=buildTvSeasonSamplePlan({seriesId:series.id,seasonNumber:request.seasonNumber,revision:current.revision,generation:active.generation,pairs:ordered,exceptions,complete,observedAt:new Date(now()).toISOString()});
   if(Buffer.byteLength(JSON.stringify(plan))>OUTPUT_LIMIT)throw fail('tv_plan_row_limit');
   return plan;
  }catch(error){if(signal?.aborted)throw fail('tv_plan_cancelled');throw error}
  finally{running=false;}
 }
 return {create};
}
