import {createHash} from 'node:crypto';

const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const stable=value=>JSON.stringify(value);
const digest=value=>createHash('sha256').update(stable(value)).digest('hex');
const text=value=>typeof value==='string'&&value.length<=120&&/^[\p{L}\p{N} ._+()\[\]-]+$/u.test(value.trim())?value.trim().normalize('NFKC').toLowerCase():null;
const number=value=>Number.isFinite(value)&&value>0&&value<=240?Math.round(value*1000)/1000:null;
const languages=tracks=>tracks.map(track=>({codec:track.codec,language:track.language,channels:track.channels??null,channelLayout:track.channelLayout??null,default:track.default,forced:track.forced,roles:track.roles??null})).sort((a,b)=>stable(a).localeCompare(stable(b)));
const normalizedVideo=value=>({codec:value.codec,encoderTag:value.declaredEncoderTag?{state:'declared',value:text(value.declaredEncoderTag)}:{state:'not_reported'},dimensions:value.dimensions,frameRateFps:number(value.frameRateFps),fieldOrder:value.fieldOrder,pixelFormat:value.pixelFormat,bitDepth:value.bitDepth,color:value.color,hdrMetadata:value.hdrMetadata});

function signature(pair){
 const source=pair.facts?.source,result=pair.facts?.result;
 if(!plain(source)||!plain(result)||!source.video?.length||!result.video?.length||source.video.length!==1||result.video.length!==1)return null;
 const sv=source.video[0],rv=result.video[0];
 const releaseGroup=text(pair.releaseGroup);
 if(!releaseGroup)return null;
 const required=[pair.releaseGroup,source.container,result.container,sv.codec,rv.codec,sv.dimensions?.width,sv.dimensions?.height,rv.dimensions?.width,rv.dimensions?.height,sv.frameRateFps,rv.frameRateFps,sv.fieldOrder,rv.fieldOrder,sv.pixelFormat,rv.pixelFormat,sv.bitDepth,rv.bitDepth,sv.color,rv.color,sv.hdrMetadata,rv.hdrMetadata,source.audio,result.audio,source.subtitles,result.subtitles,pair.profile?.id,pair.profile?.version];
 if(required.some(value=>value===null||value===undefined||value==='unknown'))return null;
 return {version:1,declaredReleaseGroup:releaseGroup,source:{container:source.container,video:normalizedVideo(sv),audio:languages(source.audio),subtitles:languages(source.subtitles)},result:{container:result.container,video:normalizedVideo(rv),audio:languages(result.audio),subtitles:languages(result.subtitles)},profile:{id:pair.profile.id,version:pair.profile.version},flowVersion:2};
}

function sampleIndices(count){
 if(count<3)return Array.from({length:count},(_,i)=>i);
 const size=Math.min(count,Math.max(3,Math.ceil(count*.1))),chosen=new Set([0,Math.floor((count-1)/2),count-1]);
 for(let i=0;chosen.size<size&&i<size*2;i++)chosen.add(Math.round(i*(count-1)/(size*2-1)));
 for(let i=0;chosen.size<size&&i<count;i++)chosen.add(i);
 return [...chosen].sort((a,b)=>a-b).slice(0,size);
}

/** Build finite, deterministic technical cohorts; this is a plan only, never an approval. */
export function buildTvSeasonSamplePlan({seriesId,seasonNumber,revision,generation,pairs,exceptions,complete=true,observedAt=new Date().toISOString()}){
 const ordered=[...pairs].sort((a,b)=>a.order-b.order||a.episodeFileId-b.episodeFileId);
 const groups=new Map(),unknown=[];
 for(const pair of ordered){
  const signatureValue=signature(pair);
  if(!signatureValue){unknown.push({episodeFileId:pair.episodeFileId,reason:'essential_evidence_unknown'});continue;}
  const signatureHash=digest(signatureValue),entry=groups.get(signatureHash)||{signature:signatureValue,signatureHash,members:[]};entry.members.push(pair);groups.set(signatureHash,entry);
 }
 const cohorts=[...groups.values()].map((group,index)=>{
  const members=group.members,samples=sampleIndices(members.length);
  return {id:'cohort-'+String(index+1).padStart(2,'0'),signatureVersion:1,signatureHash:group.signatureHash,signature:group.signature,declaredReleaseGroup:members[0].releaseGroup,sourceFamilyVerified:false,count:members.length,estimatedSourceBytes:members.reduce((sum,value)=>sum+value.sourceBytes,0),estimatedResultBytes:members.reduce((sum,value)=>sum+value.resultBytes,0),sampleEpisodeFileIds:samples.map(index=>members[index].episodeFileId),members:members.map((value,memberIndex)=>({episodeFileId:value.episodeFileId,episodeIds:[...value.episodeIds],episodes:value.episodes.map(item=>({...item})),label:value.label,sourceBytes:value.sourceBytes,resultBytes:value.resultBytes,sampled:samples.includes(memberIndex)}))};
 });
 return {version:1,algorithmVersion:1,seriesId,seasonNumber,settingsRevision:revision,settingsGeneration:generation,observedAt,complete:complete===true,status:complete===true?(unknown.length||exceptions.length?'complete_with_exclusions':'complete'):'incomplete',authorization:'none',batchReady:false,cohorts,unknown,exceptions:exceptions.slice(0,256),limits:{physicalPairs:50,publicRows:256,responseBytes:1024*1024},policy:{sampleCount:'min(N, max(3, ceil(0.10 * N)))',selection:'early-middle-late-evenly-distributed',smallCohort:'review-all-when-N-below-3'}};
}

export function tvSampleSignature(pair){return signature(pair)}
