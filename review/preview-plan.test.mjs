import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultPreviewPlan,normalizePreviewLanguage,previewCandidateOrder} from './preview-plan.mjs';
const ID='a'.repeat(24),SNAPSHOT='b'.repeat(64);
const audio=(index,language='eng',extra={})=>({index,codec_type:'audio',codec_name:'dts',channels:6,tags:{language},disposition:{},...extra});
const input=(extra={})=>({itemId:ID,snapshot:SNAPSHOT,durationA:1000,durationB:1010,originalTracks:[audio(1)],reviewTracks:[audio(2)],rendererVersion:'renderer-test',...extra});
const times=(plan,mode,profile=null)=>plan.requests.filter(request=>request.mode===mode&&request.profile===profile).map(request=>request.seconds).sort((a,b)=>a-b);

test('static mode also prepares the shared default clip time for shorter media',()=>{
 const plan=defaultPreviewPlan(input({durationA:30,durationB:30}));assert.equal(plan.defaultScope.seconds,9);assert(times(plan,'frames').includes(9));assert(times(plan,'frames').includes(14));
});

test('default plan covers exact current frame and 12-second presets for both AV profiles and audio modes',()=>{
 const plan=defaultPreviewPlan(input());
 assert.deepEqual(plan.defaultScope,{originalIndex:1,reviewIndex:2,seconds:300});assert.equal(plan.unavailableReason,null);
 assert.deepEqual(times(plan,'frames'),[99,299,300,499,699,899]);
 for(const [mode,profile]of [['av','detail'],['av','compact'],['wave',null],['listen',null]])assert.deepEqual(times(plan,mode,profile),[19,300,494,938]);
 assert.equal(plan.requests.length,22);
 for(const request of plan.requests){assert.equal(request.itemId,ID);assert.equal(request.snapshot,SNAPSHOT);assert.equal(request.rendererVersion,'renderer-test');assert(request.seconds>=0);assert(request.mode==='frames'?request.seconds<1000:request.seconds+12<=1000);assert.equal(request.originalIndex,request.mode==='frames'?null:1)}
 assert.deepEqual(Object.keys(plan.defaultScope).sort(),['originalIndex','reviewIndex','seconds']);assert(!JSON.stringify(plan).includes('checks'));assert(!JSON.stringify(plan).includes('audioSamples'));
});

test('matching copied signatures and alias languages is deterministic across input order and shifted indexes',()=>{
 for(const [before,after]of [['cze','ces'],['slo','slk'],['ENG','en'],['jpn','ja'],['ara','ara']]){
  const options=input({originalTracks:[audio(7,'fra'),audio(3,before,{disposition:{default:1}})],reviewTracks:[audio(9,after,{disposition:{default:1}}),audio(4,'fra')]});
  const plan=defaultPreviewPlan(options);assert.equal(plan.defaultScope.originalIndex,3);assert.equal(plan.defaultScope.reviewIndex,9);
  assert.deepEqual(defaultPreviewPlan({...options,originalTracks:[...options.originalTracks].reverse(),reviewTracks:[...options.reviewTracks].reverse()}),plan);
 }
});

test('automatic pairing excludes commentary and descriptive audio, and does not guess duplicated signatures',()=>{
 const commentary=audio(0,'eng',{tags:{language:'eng',title:'Director commentary'},disposition:{default:1}}),main=audio(1,'eng');
 assert.equal(defaultPreviewPlan(input({originalTracks:[commentary,main],reviewTracks:[{...commentary,index:3},{...main,index:4}]})).defaultScope.reviewIndex,4);
 for(const extra of [{tags:{language:'eng',title:'Český komentář režiséra'}},{tags:{language:'eng',title:'Deutscher Kommentar'}},{disposition:{comment:1}},{disposition:{visual_impaired:1}}]){
  const plan=defaultPreviewPlan(input({originalTracks:[audio(1,'eng',extra)],reviewTracks:[audio(2,'eng',extra)]}));assert(plan.unavailableReason);assert(plan.requests.every(request=>request.mode==='frames'));
 }
 const ambiguous=defaultPreviewPlan(input({originalTracks:[audio(1),audio(3)],reviewTracks:[audio(2),audio(4)]}));assert.equal(ambiguous.defaultScope.originalIndex,null);assert(ambiguous.unavailableReason);assert(ambiguous.requests.every(request=>request.mode==='frames'));
});

test('unknown languages, changed codec/channels and conflicting titles leave audio unavailable but preserve frame requests',()=>{
 for(const options of [
  {originalTracks:[audio(1,'und')],reviewTracks:[audio(2,'und')]},
  {originalTracks:[audio(1,'constructor')],reviewTracks:[audio(2,'constructor')]},
  {originalTracks:[audio(1,'foo')],reviewTracks:[audio(2,'foo')]},
  {reviewTracks:[audio(2,'eng',{codec_name:'ac3'})]},
  {reviewTracks:[audio(2,'eng',{channels:2})]},
  {originalTracks:[audio(1,'eng',{tags:{language:'eng',title:'Main version A'}})],reviewTracks:[audio(2,'eng',{tags:{language:'eng',title:'Main version B'}})]},
  {originalTracks:[],reviewTracks:[]},
 ]){const plan=defaultPreviewPlan(input(options));assert(plan.unavailableReason);assert.equal(plan.requests.length,6);assert(plan.requests.every(request=>request.mode==='frames'))}
});

test('valid saved selections resolve ambiguity without changing the user-selected pair or timestamps',()=>{
 const scope={originalIndex:3,reviewIndex:4,seconds:123.45},options=input({originalTracks:[audio(1),audio(3)],reviewTracks:[audio(2),audio(4)],scope});
 const before=JSON.stringify(options),plan=defaultPreviewPlan(options);assert.equal(JSON.stringify(options),before);assert.deepEqual(plan.defaultScope,scope);assert.equal(plan.unavailableReason,null);
 assert(times(plan,'frames').includes(123.45));for(const [mode,profile]of [['av','detail'],['av','compact'],['wave',null],['listen',null]])assert(times(plan,mode,profile).includes(123.45));
 const selectedCommentary=input({originalTracks:[audio(1,'und',{disposition:{comment:1}})],reviewTracks:[audio(2,'und',{disposition:{comment:1}})],scope:{originalIndex:1,reviewIndex:2}});assert.equal(defaultPreviewPlan(selectedCommentary).unavailableReason,null);
 const stale=defaultPreviewPlan(input({scope:{originalIndex:99,reviewIndex:2,seconds:-1}}));assert.deepEqual(stale.defaultScope,{originalIndex:1,reviewIndex:2,seconds:300});
});

test('short files deduplicate exact requests and skip all 12-second assets when no full window exists',()=>{
 const plan=defaultPreviewPlan(input({durationA:12,durationB:12}));assert.equal(plan.requests.length,10);assert(times(plan,'frames').includes(0));assert.equal(plan.requests.length,new Set(plan.requests.map(request=>JSON.stringify(request))).size);
 for(const [mode,profile]of [['av','detail'],['av','compact'],['wave',null],['listen',null]])assert.deepEqual(times(plan,mode,profile),[0]);
 for(const duration of [0.2,1,5,11.99]){const short=defaultPreviewPlan(input({durationA:duration,durationB:duration}));assert(short.unavailableReason);assert(short.requests.every(request=>request.mode==='frames'&&request.seconds>=0&&request.seconds<duration));assert.equal(short.defaultScope.seconds,null)}
});

test('invalid durations and out-of-range saved times cannot create invalid or extra preview requests',()=>{
 for(const duration of [0,-1,NaN,Infinity,'100'])assert.equal(defaultPreviewPlan(input({durationA:duration})).requests.length,0);
 for(const seconds of [-1,NaN,Infinity,1000])assert.deepEqual(defaultPreviewPlan(input({scope:{originalIndex:1,reviewIndex:2,seconds}})),defaultPreviewPlan(input()));
 const ending=defaultPreviewPlan(input({scope:{originalIndex:1,reviewIndex:2,seconds:995}}));assert(times(ending,'frames').includes(995));assert.equal(ending.defaultScope.seconds,300);assert(times(ending,'av','detail').every(seconds=>seconds+12<=1000));
});

test('ordered preferred and fallback languages precede other default audio while manual pairs override all preferences',()=>{
 const original=[audio(1,'eng',{disposition:{default:1}}),audio(3,'ces'),audio(5,'slk'),audio(7,'jpn')],review=original.map(track=>({...track,index:track.index+1}));
 const options=input({originalTracks:original,reviewTracks:review});
 let plan=defaultPreviewPlan(options);assert.equal(plan.chosenAudioLanguage,'ces');assert.equal(plan.defaultScope.originalIndex,3);
 assert.deepEqual(plan.requests.slice(0,5).map(request=>[request.mode,request.profile]),[['av','detail'],['wave',null],['listen',null],['av','compact'],['frames',null]]);
 plan=defaultPreviewPlan({...options,preferredAudioLanguages:['jpn','cz']});assert.equal(plan.chosenAudioLanguage,'jpn');
 plan=defaultPreviewPlan({...options,originalTracks:original.filter(track=>track.tags.language!=='ces')});assert.equal(plan.chosenAudioLanguage,'eng');
 plan=defaultPreviewPlan({...options,preferredAudioLanguages:[],fallbackAudioLanguages:['sk','en']});assert.equal(plan.chosenAudioLanguage,'slk');
 plan=defaultPreviewPlan({...options,preferredAudioLanguages:['ces'],fallbackAudioLanguages:[],allowOtherAudioLanguages:false,scope:{originalIndex:7,reviewIndex:8,seconds:10}});assert.equal(plan.chosenAudioLanguage,'jpn');assert.equal(plan.defaultScope.originalIndex,7);
});

test('other languages are opt-in after ordered choices; ambiguous present preferred audio requires manual selection',()=>{
 const other=input({originalTracks:[audio(1,'jpn')],reviewTracks:[audio(2,'jpn')]});assert.equal(defaultPreviewPlan(other).chosenAudioLanguage,'jpn');
 const excluded=defaultPreviewPlan({...other,allowOtherAudioLanguages:false});assert(excluded.unavailableReason);assert(excluded.requests.every(request=>request.mode==='frames'));
 const options=input({originalTracks:[audio(1,'ces'),audio(3,'ces'),audio(5,'eng')],reviewTracks:[audio(2,'ces'),audio(4,'ces'),audio(6,'eng')]});
 const ambiguous=defaultPreviewPlan(options);assert.equal(ambiguous.chosenAudioLanguage,null);assert(ambiguous.unavailableReason.includes('ces'));assert(ambiguous.requests.every(request=>request.mode==='frames'));
 const manual=defaultPreviewPlan({...options,scope:{originalIndex:5,reviewIndex:6}});assert.equal(manual.chosenAudioLanguage,'eng');assert.equal(manual.unavailableReason,null);
});

test('shared language normalization accepts preference aliases and rejects unknown or malformed language labels',()=>{
 for(const [values,expected]of [[['cs','cz','cze','ces','CS-CZ'],'ces'],[['en','eng','EN-us'],'eng'],[['sk','slo','slk'],'slk'],[['jpn','ja'],'jpn'],[['ara'],'ara']])for(const value of values)assert.equal(normalizePreviewLanguage(value),expected);
 for(const value of [null,42,'','und','unknown','foo','__proto__','constructor','qaa'])assert.equal(normalizePreviewLanguage(value),null);
});

test('background preparation starts with the film under review and continues with the films after it',()=>{
 const items=['a','b','c','d'].map(id=>({id}));
 assert.deepEqual(previewCandidateOrder(items,'c').map(item=>item.id),['c','d','a','b']);
 assert.deepEqual(previewCandidateOrder(items,null).map(item=>item.id),['a','b','c','d']);
 assert.deepEqual(previewCandidateOrder(items,'gone').map(item=>item.id),['a','b','c','d']);
});
