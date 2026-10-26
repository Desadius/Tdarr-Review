import path from 'node:path';
import {classifyRecovery,RECOVERY_STALE_MS} from './public/review-model.js';
import {readRecoveryCaseState} from './recovery-snapshot.mjs';
import {currentAttentionRecord,supersedingFollowup} from './attention-record.mjs';
import {hasMatchingReviewRetentionError} from './recovery-retention-diagnosis.mjs';

// Diagnostic export (#237): an explicitly downloaded, redacted report of one Needs attention or Deferred case.
// The report is a point-in-time description built from current local observations only. It never contacts
// Tdarr or Radarr, never writes anything and never copies a value from a case object: every field is a fixed
// token chosen by an allowlist, a validated timestamp or the case identifier the request already carried.
// Unknown values become `unrecognized`, never free text. Nothing in it is a health or approval verdict.

const ID=/^[a-f0-9]{24}$/;
const SOURCES=new Set(['recovery','radarr']);
const REASONS=new Set(['binding-failure','manual','fault-not-confirmed','verify-mode','awaiting-review','transcode-error','transcode-skipped','tdarr-hold','follow-up-complete','tdarr-missing','original-outside-library','search-failed','queue-failed','import-blocked','case-error','retention-error','unverified']);
const PHASES=new Set(['candidate','confirmed','waiting','waiting_replacement','waiting_source_kept','deferred_limit','deferred_cooldown','replacement_imported','imported','manual','no_action','dry_run','restored','preparing','verifying']);
const TDARR_STATES=new Set(['transcode success','transcode error','not required','hold','queued','transcoding']);
// Administrator or later steps per attention reason; kept in step with BLOCKERS in recovery-attention.mjs (tested).
// A failed or skipped transcode has none here: whether a retry or an assessment is possible needs the Tdarr job report
// and Review's retry journal (#232), which the export does not read, so it lists that as unknown instead.
export const DIAGNOSTIC_BLOCKERS={
 'binding-failure':['source-not-confirmed'],manual:['inspect-case'],'fault-not-confirmed':['diagnosis-needed'],'verify-mode':['verify-mode'],'awaiting-review':[],
 'transcode-error':[],'transcode-skipped':[],'tdarr-hold':['hold-not-released'],'follow-up-complete':[],'tdarr-missing':[],
 'original-outside-library':['radarr-download-stuck'],'search-failed':[],'queue-failed':[],'import-blocked':['manual-import-in-radarr'],'case-error':['inspect-case'],'retention-error':['retention-evidence'],unverified:['status-unverified'],
};
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const stamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&value.length<=64?new Date(Date.parse(value)).toISOString():null;
const token=(value,allowed)=>{const text=typeof value==='string'?value.toLowerCase():'';return allowed.has(text)?text:'unrecognized';};
const normalize=value=>String(value??'').toLowerCase();

/** Safe response metadata for the attachment; the identifier is validated hex. */
export function diagnosticExportHeaders(source,id){
 return {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-disposition':`attachment; filename="tdarr-review-diagnostic-${source}-${id}.json"`};
}

/**
 * @param {object} deps
 * @param {string} deps.data Review data directory (the Recovery case file is only read).
 * @param {()=>Promise<{requests?:any[]}>} deps.getOverview Local overview of Review and Recovery cases.
 * @param {{view:(source:string,id:string)=>Promise<any>}|null} [deps.deferrals] Read-only view of the saved deferral (called without a fingerprint).
 * @param {()=>string} deps.version Review version.
 * @param {()=>any} [deps.getConfig] Review configuration, for the local Review retention-binding check.
 * @param {()=>Promise<any>} [deps.getConnection] Saved Radarr settings (read locally, never contacted).
 * @param {()=>number} [deps.now]
 */
export function createDiagnosticExport({data,getOverview,deferrals=null,version,getConfig=()=>({}),getConnection=async()=>null,now=Date.now}){
 const sourceOf=record=>record?.source==='recovery'?'recovery':'radarr';
 const find=(overview,source,id)=>(Array.isArray(overview?.requests)?overview.requests:[]).find(r=>object(r)&&sourceOf(r)===source&&r.id===id)||null;
 const material=record=>JSON.stringify([record.phase,record.statusUpdated,record.updated,record.tdarrStatus,Array.isArray(record.queue)?record.queue.length:null,record.search?.status]);
 const age=time=>{
  const t=Date.parse(time);if(!Number.isFinite(t)||t>now()+120000)return 'unknown';
  return now()-t<=RECOVERY_STALE_MS?'fresh':'stale';
 };
 function radarrState(record){
  const queue=(Array.isArray(record.queue)?record.queue:[]).filter(object);
  if(queue.some(q=>normalize(q.trackedDownloadState)==='importblocked'))return 'import-blocked';
  if(queue.some(q=>['failed','error','warning','downloadclientunavailable'].includes(normalize(q.status))))return 'queue-failed';
  if(queue.length)return 'queue-present';
  if(['failed','aborted','cancelled'].includes(normalize(record.search?.status)))return 'search-failed';
  return 'none-reported';
 }
 const unknownReport=(source,id,why)=>({
  format:'tdarr-review-diagnostic-export',formatVersion:1,scope:'single-case',generatedAt:new Date(now()).toISOString(),reviewVersion:version(),
  case:{source,id},completeness:'minimal',verification:'not-verified',
  state:{category:'unknown',reason:'unknown',phase:'unknown'},deferral:{recorded:'unknown',bindingVerified:false,fingerprintChecked:false},caseRecord:why,
  observations:{record:{observedAt:null,age:'unknown'},tdarr:{state:'unknown',observedAt:null,age:'unknown'},radarr:{state:'unknown',observedAt:null,age:'unknown'}},
  blockers:[],unknown:['case-state','file-locations','service-state-now','case-binding'],
 });
 /**
  * The redacted report for one exact source and case identifier, `null` for a malformed identifier or a case that is not
  * in attention (nothing is read for it), or a minimal unknown report when the local overview cannot be read.
  */
 async function report(source,id){
  if(!SOURCES.has(source)||typeof id!=='string'||!ID.test(id))return null;
  let first;try{first=await getOverview();}catch{return unknownReport(source,id,'unreadable');}
  const record=find(first,source,id);if(!record)return null;
  // The same record the attention projection classifies, from local facts only (no Tdarr or Radarr read).
  let c=null,caseRecord='not-applicable';
  if(source==='recovery'){
   try{const read=await readRecoveryCaseState(path.join(data,'recovery','state.json'));c=read.present&&!read.error?read.cases?.[id]:null;
    caseRecord=!read.present||read.error?'unreadable':!object(c)?'missing':c.id===id&&c.status===record.phase?'consistent':'inconsistent';}
   catch{caseRecord='unreadable';}
  }
  const hasCurrentRetentionError=source==='recovery'&&object(c)&&c.id===id&&c.status===record.phase&&!!c.retentionError;
  let hasCurrentReviewRetentionError=false;
  if(source!=='recovery'&&(record.error||record.retentionError||record.retentionErrorPresent===true)){
   try{const reviewConfig=getConfig(),radarr=await getConnection().catch(()=>null);
    hasCurrentReviewRetentionError=await hasMatchingReviewRetentionError({data,record,reviewConfig:{...reviewConfig,radarrUrl:radarr?.url,radarrRoot:radarr?.mediaRoot,radarr:{quarantineRoot:radarr?.quarantineRoot}}});}catch{}
  }
  // Whether Tdarr lacks the row is a remote read the export never makes; the case is classified as the overview does when it is possible.
  const tdarrRowUnverified=source==='recovery'&&record.phase==='replacement_imported'&&!record.tdarrStatus&&object(c)&&c.status==='replacement_imported'&&!!c.replacementRelative&&!!c.replacementSourceFP&&!c.cleanup&&typeof c.file==='string'&&typeof c.relative==='string'&&c.file.endsWith('/'+c.relative);
  const requests=Array.isArray(first?.requests)?first.requests:[];
  const superseded=supersedingFollowup(record,requests,now());
  const candidate={...record,...(superseded?{supersededBy:superseded}:{}),...(tdarrRowUnverified?{tdarrMissing:true}:{})};
  const {currentRecord}=currentAttentionRecord(candidate,{hasCurrentRetentionError,hasCurrentReviewRetentionError});
  const classification=classifyRecovery(currentRecord,now());if(classification.category!=='attention')return null;
  let recorded='unknown';
  if(deferrals){try{const saved=await deferrals.view(source,id);recorded=saved?.invalid?'unknown':saved?.state==='deferred'?'deferred':'not-deferred';}catch{recorded='unknown';}}
  // A material change while the report was read is reported as such, never as a verified state.
  let second=null;try{second=find(await getOverview(),source,id);}catch{}
  const changed=!second||material(second)!==material(record);
  if(changed)caseRecord='changed-during-read';
  const observedAt=stamp(source==='recovery'?record.statusUpdated:(record.statusUpdated||record.updated)),reported=changed?'unknown':age(observedAt);
  const by=source==='recovery'?'recovery':'review';
  const reason=token(classification.reason,REASONS);
  const tdarrStatus=normalize(record.tdarrStatus);
  const observation=(state,present)=>({state:changed?'unknown':present?state:'not-reported',observedAt:present&&!changed?observedAt:null,age:present&&!changed?reported:'unknown',...(present&&!changed?{reportedBy:by}:{})});
  return {
   format:'tdarr-review-diagnostic-export',formatVersion:1,scope:'single-case',generatedAt:new Date(now()).toISOString(),reviewVersion:version(),
   case:{source,id},completeness:changed||caseRecord==='unreadable'||caseRecord==='missing'||caseRecord==='inconsistent'?'partial':'standard',verification:'not-verified',
   state:{category:'attention',reason,phase:token(record.phase,PHASES)},deferral:{recorded,bindingVerified:false,fingerprintChecked:false},caseRecord,
   observations:{record:{observedAt:changed?null:observedAt,age:reported},tdarr:observation(token(tdarrStatus,TDARR_STATES),!!tdarrStatus),radarr:observation(radarrState(record),!!record.queue?.length||!!record.search?.status)},
   blockers:[...(DIAGNOSTIC_BLOCKERS[reason]||[])],unknown:['file-locations','service-state-now','case-binding',...(tdarrRowUnverified?['tdarr-row']:[]),...(reason==='transcode-error'||reason==='transcode-skipped'?['transcode-follow-up']:[])],
  };
 }
 return {report};
}
