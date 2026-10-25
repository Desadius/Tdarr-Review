import {recoveryFollowup,classifyRecovery} from './public/review-model.js';

// The record Review classifies for Needs attention (#229), derived from local facts only: the saved retention
// signal is kept only when the current case binding confirms it. The attention projection and the Diagnostic
// export (#237) both use this, so the offered action and the exported category cannot disagree.
export function currentAttentionRecord(r,{hasCurrentRetentionError,hasCurrentReviewRetentionError}){
 const retentionSignal=r.retentionErrorPresent===true||!!r.retentionError;
 const unboundRetentionSignal=retentionSignal&&(r.source==='recovery'?!hasCurrentRetentionError:!hasCurrentReviewRetentionError);
 const currentRecord=r.source==='recovery'?{...r,retentionErrorPresent:hasCurrentRetentionError}:{...r,retentionErrorPresent:hasCurrentReviewRetentionError};
 if(unboundRetentionSignal){currentRecord.error='Vazbu případu nelze ověřit.';delete currentRecord.retentionError;}
 else if(r.source!=='recovery'&&!hasCurrentReviewRetentionError)delete currentRecord.retentionError;
 return {currentRecord,unboundRetentionSignal};
}

const UNRESOLVED=new Set(['running','waiting','attention','unverified']);
/** The follow-up that supersedes a parent whose follow-up still carries unresolved work (read-only). */
export function supersedingFollowup(r,requests,now){
 const child=recoveryFollowup(r,requests);
 if(!child||r.error)return null;
 const record=requests.find(x=>x?.source==='recovery'&&x.id===child.id);
 return record&&UNRESOLVED.has(classifyRecovery(record,now).category)?child.id:null;
}
