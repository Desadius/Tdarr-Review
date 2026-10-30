import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTvSeasonSamplePlan,tvSampleSignature} from './tv-season-sample-plan.mjs';

function pair(id,{releaseGroup='Release A',codec='h264',encoderTag='Lavc61.19.100 libx265'}={}){
 const video={codec,declaredEncoderTag:encoderTag,dimensions:{width:1920,height:1080},frameRateFps:23.976,fieldOrder:'progressive',pixelFormat:'yuv420p',bitDepth:8,color:{primaries:'bt709',transfer:'bt709',space:'bt709',range:'tv'},hdrMetadata:{dolbyVision:false,hdr10Plus:false,masteringDisplay:false,contentLightLevel:false}};
 const roles={comment:false,original:false,dub:false,hearing_impaired:false,visual_impaired:false,clean_effects:false,attached_pic:false,timed_thumbnails:false,captions:false,descriptions:false,metadata:false,dependent:false,still_image:false,non_diegetic:false,multilayer:false};
 const facts={container:'matroska',durationSeconds:42.123,video:[video],audio:[{codec:'aac',language:'eng',channels:2,channelLayout:'stereo',default:true,forced:false,roles:{...roles}}],subtitles:[{codec:'subrip',language:'eng',default:false,forced:false,roles:{...roles}}]};
 return {episodeFileId:id,episodeIds:[id*10],episodes:[{id:id*10,seasonNumber:1,episodeNumber:id}],label:`Episode ${id}.mkv`,sourceBytes:1000+id,resultBytes:500+id,order:id,facts:{source:facts,result:facts},releaseGroup,profile:{id:'tv-review-staging-v1-template',version:1}};
}

test('cohort sample formula is deterministic, unique and keeps early, middle and late anchors',()=>{
 for(const [count,size] of [[1,1],[2,2],[3,3],[24,3],[30,3],[31,4],[40,4],[41,5],[50,5]]){
  const pairs=Array.from({length:count},(_,index)=>pair(index+1));
  const plan=buildTvSeasonSamplePlan({seriesId:7,seasonNumber:1,revision:'r',generation:2,pairs,exceptions:[]}),samples=plan.cohorts[0].sampleEpisodeFileIds;
  assert.equal(plan.complete,true);assert.equal(plan.cohorts.length,1);assert.equal(plan.cohorts[0].count,count);
  assert.equal(samples.length,size);assert.equal(new Set(samples).size,size);assert.equal(samples[0],1);assert.equal(samples.at(-1),count);
  if(count>=3)assert.ok(samples.includes(Math.floor((count+1)/2)),'the center Sonarr-order member is sampled');
 }
});

test('small cohorts sample every physical file and release-group differences split cohorts',()=>{
 const plan=buildTvSeasonSamplePlan({seriesId:7,seasonNumber:1,revision:'r',generation:2,pairs:[pair(1),pair(2),pair(3,{releaseGroup:'Release B'})],exceptions:[]});
 assert.deepEqual(plan.cohorts.map(value=>value.count),[2,1]);
 assert.deepEqual(plan.cohorts.map(value=>value.sampleEpisodeFileIds.length),[2,1]);
 assert.ok(plan.cohorts.every(value=>value.sourceFamilyVerified===false));
});

test('missing declared family or required stream facts cannot join a cohort',()=>{
 const noFamily=pair(1,{releaseGroup:''}),noStream=pair(2);noStream.facts.source.video[0].fieldOrder=null;
 assert.equal(tvSampleSignature(noFamily),null);assert.equal(tvSampleSignature(noStream),null);
 const plan=buildTvSeasonSamplePlan({seriesId:7,seasonNumber:1,revision:'r',generation:2,pairs:[noFamily,noStream],exceptions:[]});
 assert.equal(plan.complete,true);assert.equal(plan.status,'complete_with_exclusions');assert.equal(plan.unknown.length,2);assert.equal(plan.cohorts.length,0);
});

test('pair duration and byte sizes do not affect technical cohort signature',()=>{
 const first=pair(1),second=pair(2);second.facts.source.durationSeconds=99;second.facts.result.durationSeconds=98;second.sourceBytes=2000;second.resultBytes=999;
 assert.deepEqual(tvSampleSignature(first),tvSampleSignature(second));
});

test('language, track role and strict profile differences split signatures',()=>{
 const first=pair(1),differentLanguage=pair(2),differentRole=pair(3),differentProfile=pair(4);
 differentLanguage.facts.source.audio[0].language='ces';differentRole.facts.source.audio[0].roles.comment=true;differentProfile.profile.version=2;
 assert.notDeepEqual(tvSampleSignature(first),tvSampleSignature(differentLanguage));
 assert.notDeepEqual(tvSampleSignature(first),tvSampleSignature(differentRole));
 assert.notDeepEqual(tvSampleSignature(first),tvSampleSignature(differentProfile));
});

test('optional video stream encoder declarations split cohorts without standing in for required flow identity',()=>{
 const declared=pair(1),other=pair(2,{encoderTag:'Lavc61.19.100 libx264'}),missing=pair(3,{encoderTag:null});
 assert.notDeepEqual(tvSampleSignature(declared),tvSampleSignature(other));
 assert.notDeepEqual(tvSampleSignature(declared),tvSampleSignature(missing));
 assert.equal(tvSampleSignature(missing).source.video.encoderTag.state,'not_reported');
 assert.ok(tvSampleSignature(missing),'the validated v2 flow/profile and required technical facts still permit a proposal');
});
