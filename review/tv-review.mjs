const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const HDR=new Set(['smpte2084','arib-std-b67']);
const SDR=new Set(['bt709','smpte170m','smpte240m','gamma22','gamma28','iec61966-2-1']);
const TV_BLOCK_CODES=Object.freeze({
 binding_not_verified:'tv_binding_not_verified',multi_episode_file:'tv_multi_episode_file',unsupported_format:'tv_unsupported_format',
 strict_flow_evidence_missing:'tv_strict_flow_evidence_missing',flow_evidence_invalid:'tv_flow_evidence_invalid',
 technical_facts_unavailable:'tv_technical_facts_unavailable',unsupported_video_stream_count:'tv_unsupported_video_stream_count',
 unsupported_container_or_scan:'tv_unsupported_container_or_scan',unsupported_bit_depth:'tv_unsupported_bit_depth',
 hdr_or_unknown_color:'tv_hdr_or_unknown_color',unsupported_result_codec:'tv_unsupported_result_codec',duration_mismatch:'tv_duration_mismatch'
});
const videoOf=probe=>Array.isArray(probe?.streams)?probe.streams.filter(stream=>stream?.codec_type==='video'&&!stream.disposition?.attached_pic):[];
const depth=stream=>stream.pix_fmt==='yuv420p'?8:stream.pix_fmt==='yuv420p10le'?10:null;

/** Strict first-slice technical gate; it never turns a probe into Tdarr health evidence. */
export function inspectTvReviewPair(source,result){
 if(!plain(source)||!plain(result))return {ok:false,reason:'technical_facts_unavailable'};
 for(const [label,probe]of [['source',source],['result',result]]){
  const videos=videoOf(probe);
  if(videos.length!==1)return {ok:false,reason:'unsupported_video_stream_count'};
  const stream=videos[0],format=String(probe.format?.format_name||'').split(',');
  if(!format.includes('matroska')||stream.field_order!=='progressive')return {ok:false,reason:'unsupported_container_or_scan'};
  if(depth(stream)!==8)return {ok:false,reason:'unsupported_bit_depth'};
  if(HDR.has(stream.color_transfer)||!SDR.has(stream.color_transfer)||!SDR.has(stream.color_primaries)||!SDR.has(stream.color_space)||stream.side_data_list?.length)return {ok:false,reason:'hdr_or_unknown_color'};
  if(!Number.isSafeInteger(stream.width)||!Number.isSafeInteger(stream.height)||stream.width<1||stream.height<1)return {ok:false,reason:'technical_facts_unavailable'};
  if(label==='result'&&stream.codec_name!=='hevc')return {ok:false,reason:'unsupported_result_codec'};
 }
 const a=videoOf(source)[0],b=videoOf(result)[0],durationA=Number(source.format?.duration),durationB=Number(result.format?.duration);
 if(!Number.isFinite(durationA)||!Number.isFinite(durationB)||durationA<=0||durationB<=0||Math.abs(durationA-durationB)>Math.max(.5,durationA*.005))return {ok:false,reason:'duration_mismatch'};
 return {ok:true,reason:null,durationA,durationB,videoSummary:`${a.codec_name} → ${b.codec_name}, ${b.width}×${b.height}, 8-bit SDR Matroska`};
}

export function supportedTvReviewItem(item){
 if(item?.state!=='bound')return {ok:false,reason:'binding_not_verified'};
 if(!Array.isArray(item.episodes)||item.episodes.length!==1||item.binding?.episodeIds?.length!==1)return {ok:false,reason:'multi_episode_file'};
 if(!String(item.reviewRelative||'').toLowerCase().endsWith('.mkv')||!String(item.relative||'').toLowerCase().endsWith('.mkv'))return {ok:false,reason:'unsupported_format'};
 if(item.strictEvidence!=='passed')return {ok:false,reason:item.strictEvidence==='legacy'?'strict_flow_evidence_missing':'flow_evidence_invalid'};
 return {ok:true,reason:null};
}

// Only fixed reasons from the TV technical and eligibility gates can become API codes.
export function tvReviewBlockCode(reason){return TV_BLOCK_CODES[reason]||'tv_review_unavailable'}
