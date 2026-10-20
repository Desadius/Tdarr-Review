import {errorText} from './public/error-messages.js';
import {CHECKS,completedStep,deviceSatisfied,identityChanged,pairChanged,clearForIdentity,clearForPair} from './public/review-rules.js';
const ID=/^[a-f0-9]{24}$/;
const SNAPSHOT=/^[a-f0-9]{64}$/;
const OBSERVATIONS=['image','hdr','audio','syncStart','syncMiddle','syncEnd'];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

// Takes a code from public/error-messages.js; the message is its Czech text. Plain text
// is still accepted and then travels without a code.
export class ReviewSessionError extends Error {
 constructor(code,status=400,params){
  const text=errorText(code,params,'cs');
  super(text??code);this.name='ReviewSessionError';this.status=status;
  if(text!==null){this.code=code;if(params)this.params=params}
 }
}
const fail=(code,status=400)=>{throw new ReviewSessionError(code,status)};
const cleanText=(value,max,code)=>{
 if(value===undefined)return '';
 if(typeof value!=='string')fail(code);
 return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim().slice(0,max);
};

export function emptyReviewSession(){
 return {method:'review',device:'',step:0,checks:Object.fromEntries(CHECKS.map(name=>[name,false])),scope:{originalIndex:null,reviewIndex:null,seconds:null},note:'',deferred:false};
}

export function reviewRequirements(...probes){
 return {hdr:probes.some(probe=>(probe?.streams||[]).some(stream=>stream.codec_type==='video'&&!stream.disposition?.attached_pic&&(['smpte2084','arib-std-b67'].includes(stream.color_transfer)||(stream.side_data_list||[]).some(data=>/DOVI|Dolby Vision/i.test(data.side_data_type||'')))))};
}

// Only explicit booleans can record a user's confirmation. Diagnostic output,
// submitted complete flags and unknown fields never become attestations.
export function sanitizeReviewSession(input){
 if(!object(input))fail('review_not_object');
 const session=emptyReviewSession();
 if(input.method!==undefined){if(!['review','external'].includes(input.method))fail('review_method_invalid');session.method=input.method}
 session.device=cleanText(input.device,160,'review_device_not_text');
 session.note=cleanText(input.note,2000,'review_note_not_text');
 if(input.step!==undefined){if(!Number.isInteger(input.step)||input.step<0||input.step>4)fail('review_step_invalid');session.step=input.step}
 if(input.deferred!==undefined){if(typeof input.deferred!=='boolean')fail('review_defer_unconfirmed');session.deferred=input.deferred}
 if(input.checks!==undefined){
  if(!object(input.checks))fail('review_checks_not_object');
  for(const name of CHECKS)if(input.checks[name]!==undefined){if(typeof input.checks[name]!=='boolean')fail('review_check_manual');session.checks[name]=input.checks[name]}
 }
 if(input.scope!==undefined){
  if(!object(input.scope))fail('review_tracks_not_object');
  for(const name of ['originalIndex','reviewIndex'])if(input.scope[name]!==undefined&&input.scope[name]!==null){
   const value=input.scope[name];if(!Number.isInteger(value)||value<0||value>65535)fail('review_track_index_invalid');session.scope[name]=value;
  }
  if(input.scope.seconds!==undefined&&input.scope.seconds!==null){
   const value=input.scope.seconds;if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>604800)fail('review_time_invalid');session.scope.seconds=value;
  }
 }
 return session;
}

const clearAfter=(session,step)=>{
 if(step<1)session.checks.image=false;
 if(step<2){session.checks.audio=false;session.checks.hdr=false}
 if(step<3)for(const name of ['syncStart','syncMiddle','syncEnd'])session.checks[name]=false;
};

export function reviewComplete(session,requirements={hdr:false}){
 return !session.deferred&&session.step===4&&completedStep(session)===4&&deviceSatisfied(session,requirements)&&(!requirements.hdr||session.checks.hdr);
}

export function publicReviewSession(record,snapshot,requirements=record?.requirements||{hdr:false}){
 requirements={hdr:requirements?.hdr!==false};
 const empty={snapshot,revision:0,version:1,requirements,session:emptyReviewSession(),observations:{},complete:false,updated:null};
 if(!record||record.snapshot!==snapshot||record.version!==1||!Number.isSafeInteger(record.revision)||record.revision<1||typeof record.updated!=='string'||!Number.isFinite(Date.parse(record.updated)))return empty;
 try{
  const session=sanitizeReviewSession(record.session);
  if(session.step>completedStep(session))return empty;
  const observations={};
  for(const name of OBSERVATIONS){
   const observation=record.observations?.[name];
   if(!session.checks[name]||!object(observation)||typeof observation.at!=='string'||!Number.isFinite(Date.parse(observation.at)))continue;
   try{const value=sanitizeReviewSession(observation);observations[name]={method:value.method,device:value.device,scope:value.scope,at:observation.at}}catch{}
  }
  return {snapshot,revision:record.revision,version:1,requirements,session,observations,complete:reviewComplete(session,requirements),updated:record.updated};
 }catch{return empty}
}

export function updateReviewSession(previous,input,{duration,originalIndexes,reviewIndexes}={}){
 const session=sanitizeReviewSession(input),old=previous.session;
 if(session.deferred&&!session.note)fail('review_defer_reason_required');
 if(duration!==undefined&&session.scope.seconds!==null&&(!Number.isFinite(duration)||session.scope.seconds>=duration))fail('review_time_out_of_range');
 for(const [name,indexes] of [['originalIndex',originalIndexes],['reviewIndex',reviewIndexes]])if(session.scope[name]!==null&&indexes!==undefined&&!indexes.includes(session.scope[name]))fail('sample_tracks_invalid');
 // A changed method/device or track pair must be saved before any fresh
 // confirmation. Checks carried in the same change cannot describe both scopes.
 if(identityChanged(old,session))clearForIdentity(session);
 else if(pairChanged(old,session))clearForPair(session);
 const available=completedStep(session);
 if(session.step>available){
  if(session.step>old.step)fail('review_previous_checks_first');
  session.step=available;
 }
 clearAfter(session,available);
 return session;
}

// The revision comparison, validation and durable write share one queue. Two
// clients submitting the same revision cannot both succeed, even across awaits.
export function createReviewSessionStore({getState,save,verify,now=()=>new Date().toISOString()}){
 let queue=Promise.resolve(),pending=0;
 const current=(id,snapshot,requirements)=>{
  const state=getState(),item=state.items?.[id],record=state.reviewSessions?.[id];
  return publicReviewSession(record,snapshot,requirements||(record?.snapshot===snapshot?record.requirements:undefined)||(item?.snapshot===snapshot?item.info?.reviewRequirements:undefined)||{hdr:true});
 };
 const checkIdentity=(id,snapshot)=>{if(!ID.test(id)||!SNAPSHOT.test(snapshot))fail('review_identity_invalid',409)};
 return {
  get busy(){return pending>0},
  idle:()=>queue,
  get(id,snapshot,requirements){return current(id,snapshot,requirements)},
  list(items){return Object.fromEntries(items.filter(item=>ID.test(item.id)&&SNAPSHOT.test(item.snapshot)).map(item=>[item.id,current(item.id,item.snapshot)]))},
  approval(id,snapshot,revision){
   checkIdentity(id,snapshot);
   const evidence=current(id,snapshot);
   if(!evidence.complete)fail('review_incomplete',409);
   if(!Number.isSafeInteger(revision)||revision!==evidence.revision)fail('review_revision_changed',409);
   return structuredClone(evidence);
  },
  write(id,request){
   pending++;
   const operation=queue.catch(()=>{}).then(async()=>{
    if(!object(request))fail('review_request_not_object');
    checkIdentity(id,request.snapshot);
    if(!Number.isSafeInteger(request.revision)||request.revision<0)fail('review_revision_invalid',409);
    const state=getState(),item=state.items?.[id];
    if(!item||item.snapshot!==request.snapshot)fail('item_changed',409);
    const limits=await verify(item,{id,snapshot:request.snapshot,session:sanitizeReviewSession(request.session)});
    if(getState()!==state||state.items[id]!==item||item.snapshot!==request.snapshot)fail('review_item_changed_during_save',409);
    const previous=current(id,request.snapshot);
    if(request.revision!==previous.revision)fail('review_saved_elsewhere',409);
    const session=updateReviewSession(previous,request.session,limits);
    if(previous.revision===Number.MAX_SAFE_INTEGER)fail('review_revision_exhausted',409);
    const updated=now(),observations={};
    for(const name of OBSERVATIONS)if(session.checks[name]){
     observations[name]=previous.session.checks[name]&&previous.observations[name]?structuredClone(previous.observations[name]):{method:session.method,device:session.device,scope:structuredClone(session.scope),at:updated};
    }
    const record={snapshot:request.snapshot,revision:previous.revision+1,version:1,requirements:{hdr:limits?.requirements?.hdr!==false},session,observations,updated};
    state.reviewSessions ||= {};
    const prior=state.reviewSessions[id];state.reviewSessions[id]=record;
    try{await save()}catch(error){if(state.reviewSessions[id]===record){if(prior===undefined)delete state.reviewSessions[id];else state.reviewSessions[id]=prior}throw error}
    return current(id,request.snapshot,record.requirements);
   });
   queue=operation.catch(()=>{}).finally(()=>{pending--});
   return operation;
  }
 };
}
