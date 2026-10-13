const CLIP_SECONDS=12;
const FRAME_PRESETS=[10,30,50,70,90];
const CLIP_PRESETS=[2,50,95];
const LANGUAGE_ALIASES={
 cs:'ces',cz:'ces',ces:'ces',cze:'ces',czech:'ces',sk:'slk',slk:'slk',slo:'slk',slovak:'slk',
 en:'eng',eng:'eng',english:'eng',ja:'jpn',jpn:'jpn',japanese:'jpn',
 de:'deu',deu:'deu',ger:'deu',fr:'fra',fra:'fra',fre:'fra',es:'spa',spa:'spa',
 it:'ita',ita:'ita',pl:'pol',pol:'pol',ru:'rus',rus:'rus',pt:'por',por:'por',
 zh:'zho',zho:'zho',chi:'zho',ko:'kor',kor:'kor',nl:'nld',nld:'nld',dut:'nld',
};
const LANGUAGE_NAMES=new Intl.DisplayNames(['en'],{type:'language',fallback:'none'});
const text=value=>typeof value==='string'?value.trim().toLowerCase():'';
const flag=value=>value===true||value===1||value==='1';
const title=value=>text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ');
export function normalizePreviewLanguage(value){
 const name=text(value).split(/[-_]/)[0];
 if(Object.hasOwn(LANGUAGE_ALIASES,name))return LANGUAGE_ALIASES[name];
 return /^[a-z]{3}$/.test(name)&&!['und','unk','zxx','mis','mul'].includes(name)&&!(name>='qaa'&&name<='qtz')&&LANGUAGE_NAMES.of(name)!==undefined?name:null;
}
function tracks(values){
 const list=(Array.isArray(values)?values:[]).filter(track=>track&&Number.isInteger(track.index)&&track.index>=0&&track.index<=65535&&(!track.codec_type||track.codec_type==='audio'));
 const counts=new Map();for(const track of list)counts.set(track.index,(counts.get(track.index)||0)+1);
 return list.filter(track=>counts.get(track.index)===1).map(track=>{
  const name=title(track.tags?.title),disposition=track.disposition||{};
  return {index:track.index,language:normalizePreviewLanguage(track.tags?.language),codec:text(track.codec_name),channels:track.channels,title:name,
   default:flag(disposition.default),commentary:flag(disposition.comment)||flag(disposition.visual_impaired)||/\b(commentary|comments?|komentar\w*|kommentar\w*|comentario\w*|commentaire|audiodescription|audio description|descriptive audio|director(?:'s)? commentary)\b/.test(name)};
 }).sort((a,b)=>a.index-b.index);
}
const signature=track=>JSON.stringify([track.language,track.codec,track.channels]);
const mainTrack=track=>track.language!==null&&track.codec!==''&&Number.isInteger(track.channels)&&track.channels>0&&!track.commentary;
function matchingPairs(original,review){
 const a=original.filter(mainTrack),b=review.filter(mainTrack),pairs=[];
 for(const output of b){
  const sameOriginal=a.filter(source=>signature(source)===signature(output)),sameReview=b.filter(candidate=>signature(candidate)===signature(output));
  const exact=sameOriginal.filter(source=>source.title===output.title),peers=sameReview.filter(candidate=>candidate.title===output.title);
  if(exact.length===1&&peers.length===1)pairs.push({original:exact[0],review:output,exact:true});
  else if(sameOriginal.length===1&&sameReview.length===1&&(!sameOriginal[0].title||!output.title))pairs.push({original:sameOriginal[0],review:output,exact:false});
 }
 pairs.sort((a,b)=>Number(b.original.default)-Number(a.original.default)||Number(b.review.default)-Number(a.review.default)||Number(b.exact)-Number(a.exact)||a.original.index-b.original.index||a.review.index-b.review.index);
 return pairs;
}
const languageList=values=>unique((Array.isArray(values)?values:[]).map(normalizePreviewLanguage).filter(Boolean));
function suggestedPair(original,review,preferred,fallback,allowOther){
 const pairs=matchingPairs(original,review),ordered=unique([...languageList(preferred),...languageList(fallback)]);
 for(const language of ordered){
  const pair=pairs.find(pair=>pair.original.language===language);if(pair)return {pair,reason:null};
  // Do not disguise a present but ambiguous requested language by silently switching languages.
  if(original.some(track=>mainTrack(track)&&track.language===language)&&review.some(track=>mainTrack(track)&&track.language===language))return {pair:null,reason:`Jazyk ${language} nelze jednoznačně přiřadit k hlavním stopám. Vyber pár ručně.`};
 }
 const pair=allowOther===true?pairs.find(pair=>!ordered.includes(pair.original.language)):null;
 return {pair:pair||null,reason:pair?null:'Nelze jednoznačně navrhnout hlavní pár v požadovaných jazycích. Vyber ho ručně.'};
}
const validDuration=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const validTime=(value,duration)=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<duration;
const validClipTime=(value,duration)=>validTime(value,duration)&&value+CLIP_SECONDS<=duration;
const unique=values=>[...new Set(values)];

/** Pure cache plan. Proposed tracks and prepared assets are not manual checks or audioSamples. */
export function defaultPreviewPlan({itemId,snapshot,durationA,durationB,originalTracks,reviewTracks,scope={},rendererVersion='preview-v1',preferredAudioLanguages=['ces'],fallbackAudioLanguages=['eng','slk'],allowOtherAudioLanguages=true}={}){
 const defaultScope={originalIndex:null,reviewIndex:null,seconds:null},requests=[];
 if(!validDuration(durationA)||!validDuration(durationB))return {defaultScope,requests,chosenAudioLanguage:null,unavailableReason:'Nelze ověřit platnou délku obou souborů.'};
 const duration=Math.min(durationA,durationB),original=tracks(originalTracks),review=tracks(reviewTracks);
 const savedOriginal=original.find(track=>track.index===scope?.originalIndex),savedReview=review.find(track=>track.index===scope?.reviewIndex);
 // An existing user selection is respected, including commentary or unlabelled audio.
 const suggestion=savedOriginal&&savedReview?{pair:{original:savedOriginal,review:savedReview},reason:null}:suggestedPair(original,review,preferredAudioLanguages,fallbackAudioLanguages,allowOtherAudioLanguages);
 const pair=suggestion.pair;
 if(pair){defaultScope.originalIndex=pair.original.index;defaultScope.reviewIndex=pair.review.index}
 const frameMax=Math.max(0,duration-1),clipMax=Math.max(0,duration-CLIP_SECONDS);
 const frameDefault=validTime(scope?.seconds,duration)?scope.seconds:Math.min(300,Math.floor(frameMax/2));
 const clipDefault=validClipTime(scope?.seconds,duration)?scope.seconds:Math.min(300,Math.floor(clipMax/2));
 if(duration>=CLIP_SECONDS)defaultScope.seconds=clipDefault;
 const frameTimes=unique([frameDefault,...FRAME_PRESETS.map(percent=>Math.floor(frameMax*percent/100))]);
 const clipTimes=unique([clipDefault,...CLIP_PRESETS.map(percent=>Math.floor(clipMax*percent/100))]);
 const keys=new Set();
 const add=(mode,seconds,profile=null)=>{
  const request={itemId,snapshot,mode,seconds,originalIndex:mode==='frames'?null:defaultScope.originalIndex,reviewIndex:mode==='frames'?null:defaultScope.reviewIndex,profile,rendererVersion};
  const key=JSON.stringify(request);if(!keys.has(key)){keys.add(key);requests.push(request)}
 };
 // First make the default view/listen usable; other presets follow deterministically.
 if(pair&&duration>=CLIP_SECONDS){add('av',clipDefault,'detail');add('wave',clipDefault);add('listen',clipDefault);add('av',clipDefault,'compact')}
 add('frames',frameDefault);
 if(duration>=CLIP_SECONDS)add('frames',clipDefault);
 for(const seconds of frameTimes)add('frames',seconds);
 if(pair&&duration>=CLIP_SECONDS)for(const seconds of clipTimes){add('wave',seconds);add('listen',seconds);add('av',seconds,'compact');add('av',seconds,'detail')}
 const unavailableReason=duration<CLIP_SECONDS?'Film nemá celý 12sekundový zvukový nebo video úsek.':!pair?suggestion.reason:null;
 return {defaultScope,requests,chosenAudioLanguage:pair?.review.language||pair?.original.language||null,unavailableReason};
}
