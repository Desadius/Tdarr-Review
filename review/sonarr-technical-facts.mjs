const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const videoCodecs=new Set(['av1','h264','hevc','h263','mjpeg','mpeg1video','mpeg2video','mpeg4','prores','theora','vc1','vp6','vp8','vp9','wmv3']);
const audioCodecs=new Set(['aac','ac3','alac','ape','dts','dts_hd','eac3','flac','mp2','mp3','opus','pcm_s16le','pcm_s24le','truehd','vorbis','wavpack','wmav2']);
const subtitleCodecs=new Set(['ass','dvd_subtitle','hdmv_pgs_subtitle','mov_text','srt','ssa','subrip','text','webvtt']);
const colorValues={
 primaries:new Set(['bt709','bt470bg','bt470m','bt2020','film','smpte170m','smpte240m','smpte432','smpte431','jedec-p22']),
 transfer:new Set(['bt709','bt470bg','bt470m','bt2020-10','bt2020-12','bt1361e','gamma22','gamma28','iec61966-2-1','iec61966-2-4','linear','log','log_sqrt','smpte170m','smpte240m','smpte2084','smpte428','arib-std-b67']),
 space:new Set(['bt709','fcc','bt470bg','smpte170m','smpte240m','ycgco','bt2020nc','bt2020c','smpte2085','chroma-derived-nc','chroma-derived-c','ictcp']),
 range:new Set(['tv','pc','unknown','unspecified']),
};
const token=(value,allowed)=>typeof value==='string'&&allowed.has(value)?value:null;
function codec(value,allowed){return typeof value==='string'&&allowed.has(value)?value:'unknown';}
function positiveInteger(value,maximum){return Number.isSafeInteger(value)&&value>0&&value<=maximum?value:null;}
function duration(value){if(typeof value==='string'&&!value.trim())return null;const number=typeof value==='string'||typeof value==='number'?Number(value):NaN;return Number.isFinite(number)&&number>=0&&number<=604800?Math.round(number*1000)/1000:null;}
function frameRate(stream){
 for(const value of [stream.avg_frame_rate,stream.r_frame_rate]){
  if(typeof value!=='string'||value.length>32)continue;
  const match=/^(\d{1,12})(?:\/(\d{1,12}))?$/.exec(value);if(!match)continue;
  const numerator=Number(match[1]),denominator=match[2]===undefined?1:Number(match[2]);
  const rate=numerator/denominator;if(Number.isFinite(rate)&&rate>0&&rate<=240)return Math.round(rate*1000)/1000;
 }
 return null;
}
function language(tags){const value=tags?.language;return typeof value==='string'&&value.length<=35&&/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(value)?value.toLowerCase():null;}
function flag(disposition,key){const value=disposition?.[key];return value===0||value===1?value===1:typeof value==='boolean'?value:null;}
function metadataPresence(streams,matcher){
 const lists=streams.map(stream=>stream.side_data_list).filter(Array.isArray);
 if(!lists.length)return null;
 return lists.some(list=>list.some(value=>plain(value)&&typeof value.side_data_type==='string'&&matcher.test(value.side_data_type)));
}
function video(stream){
 const sideData=Array.isArray(stream.side_data_list);
 return {
  index:Number.isSafeInteger(stream.index)&&stream.index>=0?stream.index:null,
  codec:codec(stream.codec_name,videoCodecs),
  dimensions:{width:positiveInteger(stream.width,32768),height:positiveInteger(stream.height,32768)},
  frameRateFps:frameRate(stream),
  color:{primaries:token(stream.color_primaries,colorValues.primaries),transfer:token(stream.color_transfer,colorValues.transfer),space:token(stream.color_space,colorValues.space),range:token(stream.color_range,colorValues.range)},
  hdrMetadata:{dolbyVision:sideData?metadataPresence([stream],/^(?:DOVI configuration record|Dolby Vision Metadata)$/):null,hdr10Plus:sideData?metadataPresence([stream],/HDR10\+|SMPTE2094-40/i):null,masteringDisplay:sideData?metadataPresence([stream],/^Mastering display metadata$/):null,contentLightLevel:sideData?metadataPresence([stream],/^Content light level metadata$/):null},
 };
}
function audio(stream){return {index:Number.isSafeInteger(stream.index)&&stream.index>=0?stream.index:null,codec:codec(stream.codec_name,audioCodecs),language:language(stream.tags),channels:positiveInteger(stream.channels,256),default:flag(stream.disposition,'default'),forced:flag(stream.disposition,'forced')};}
function subtitle(stream){return {index:Number.isSafeInteger(stream.index)&&stream.index>=0?stream.index:null,codec:codec(stream.codec_name,subtitleCodecs),language:language(stream.tags),default:flag(stream.disposition,'default'),forced:flag(stream.disposition,'forced')};}

/** Return only allowlisted, bounded technical facts; missing source fields remain null. */
export function projectTechnicalFacts(probe){
 if(!plain(probe)||!Array.isArray(probe.streams)||probe.streams.length>64||probe.streams.some(stream=>!plain(stream)))return null;
 const streams=probe.streams;
 return {durationSeconds:duration(probe.format?.duration),video:streams.filter(stream=>stream.codec_type==='video').map(video),audio:streams.filter(stream=>stream.codec_type==='audio').map(audio),subtitles:streams.filter(stream=>stream.codec_type==='subtitle').map(subtitle)};
}

const exact=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const nullableNumber=(value,max)=>value===null||Number.isFinite(value)&&value>=0&&value<=max;
const nullableIndex=value=>value===null||Number.isSafeInteger(value)&&value>=0;
const nullableToken=(value,allowed)=>value===null||allowed.has(value);
const nullableFlag=value=>value===null||typeof value==='boolean';
function validVideo(value){
 return exact(value,['index','codec','dimensions','frameRateFps','color','hdrMetadata'])&&nullableIndex(value.index)&&(videoCodecs.has(value.codec)||value.codec==='unknown')&&
  exact(value.dimensions,['width','height'])&&[value.dimensions.width,value.dimensions.height].every(item=>item===null||Number.isSafeInteger(item)&&item>0&&item<=32768)&&nullableNumber(value.frameRateFps,240)&&
  exact(value.color,['primaries','transfer','space','range'])&&nullableToken(value.color.primaries,colorValues.primaries)&&nullableToken(value.color.transfer,colorValues.transfer)&&nullableToken(value.color.space,colorValues.space)&&nullableToken(value.color.range,colorValues.range)&&
  exact(value.hdrMetadata,['dolbyVision','hdr10Plus','masteringDisplay','contentLightLevel'])&&Object.values(value.hdrMetadata).every(nullableFlag);
}
function validTrack(value,kind){
 const keys=kind==='audio'?['index','codec','language','channels','default','forced']:['index','codec','language','default','forced'];
 const codecs=kind==='audio'?audioCodecs:subtitleCodecs;
 return exact(value,keys)&&nullableIndex(value.index)&&(codecs.has(value.codec)||value.codec==='unknown')&&
  (value.language===null||typeof value.language==='string'&&value.language.length<=35&&/^[a-z0-9]{2,3}(?:-[a-z0-9]{2,8})*$/.test(value.language))&&
  (kind!=='audio'||value.channels===null||Number.isSafeInteger(value.channels)&&value.channels>0&&value.channels<=256)&&nullableFlag(value.default)&&nullableFlag(value.forced);
}
/** Strict server-side response validation for the worker's technical-facts projection. */
export function validTechnicalFacts(value){
 return exact(value,['durationSeconds','video','audio','subtitles'])&&nullableNumber(value.durationSeconds,604800)&&
  ['video','audio','subtitles'].every(key=>Array.isArray(value[key])&&value[key].length<=64)&&
  value.video.every(validVideo)&&value.audio.every(item=>validTrack(item,'audio'))&&value.subtitles.every(item=>validTrack(item,'subtitle'));
}
