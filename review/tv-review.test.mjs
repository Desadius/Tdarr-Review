import test from 'node:test';
import assert from 'node:assert/strict';
import {tvReviewBlockCode} from './tv-review.mjs';
import {ERROR_MESSAGES} from './public/error-messages.js';

test('TV eligibility and technical failures map only to fixed localized public codes',()=>{
 const reasons=['binding_not_verified','multi_episode_file','unsupported_format','strict_flow_evidence_missing','flow_evidence_invalid','technical_facts_unavailable','unsupported_video_stream_count','unsupported_container_or_scan','unsupported_bit_depth','hdr_or_unknown_color','unsupported_result_codec','duration_mismatch'];
 for(const reason of reasons){
  const code=tvReviewBlockCode(reason);
  assert.ok(Object.hasOwn(ERROR_MESSAGES,code),reason);
 }
 assert.equal(tvReviewBlockCode('attacker-controlled-message'),'tv_review_unavailable');
});
