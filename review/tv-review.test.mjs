import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectTvReviewPair,tvReviewBlockCode} from './tv-review.mjs';
import {ERROR_MESSAGES} from './public/error-messages.js';

test('TV eligibility and technical failures map only to fixed localized public codes',()=>{
 const reasons=['binding_not_verified','multi_episode_file','unsupported_format','strict_flow_evidence_missing','flow_evidence_invalid','technical_facts_unavailable','unsupported_video_stream_count','unsupported_container_or_scan','unsupported_bit_depth','hdr_or_unknown_color','unsupported_result_codec','duration_mismatch'];
 for(const reason of reasons){
  const code=tvReviewBlockCode(reason);
  assert.ok(Object.hasOwn(ERROR_MESSAGES,code),reason);
 }
 assert.equal(tvReviewBlockCode('attacker-controlled-message'),'tv_review_unavailable');
});

test('strict TV technical gate treats an untagged 8-bit HD source as BT.709 only with an explicitly tagged result',()=>{
 const probe=(video)=>({format:{format_name:'matroska,webm',duration:'1200'},streams:[{codec_type:'video',codec_name:'h264',field_order:'progressive',pix_fmt:'yuv420p',width:1920,height:1080,...video}]});
 const tagged={color_primaries:'bt709',color_transfer:'bt709',color_space:'bt709'};
 const untagged={color_primaries:'unknown',color_transfer:undefined,color_space:'unknown'};
 assert.equal(inspectTvReviewPair(probe(untagged),probe({codec_name:'hevc',...tagged})).ok,true);
 assert.equal(inspectTvReviewPair(probe(untagged),probe({codec_name:'hevc',...untagged})).reason,'hdr_or_unknown_color','the result must carry explicit colour tags');
 assert.equal(inspectTvReviewPair(probe(untagged),probe({codec_name:'hevc',...tagged,color_primaries:'smpte170m'})).reason,'hdr_or_unknown_color','an inferred source must map to BT.709');
 assert.equal(inspectTvReviewPair(probe({...untagged,width:720,height:576}),probe({codec_name:'hevc',...tagged,width:720,height:576})).reason,'hdr_or_unknown_color','untagged SD stays unsupported');
 assert.equal(inspectTvReviewPair(probe({...untagged,color_space:'bt709'}),probe({codec_name:'hevc',...tagged})).reason,'hdr_or_unknown_color','partially tagged sources stay unsupported');
});
