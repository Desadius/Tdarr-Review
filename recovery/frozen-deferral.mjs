import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {classify,confirmed} from './policy.mjs';
import {createTdarrFileState,HOLD_FOREVER,isHeld} from './tdarr-file-state.mjs';

// Frozen deferral: a confirmed faulty edition stays in the library under a permanent, acknowledged
// Tdarr Hold while Recovery may not act on it yet. Two kinds share the steps below:
// - COOLDOWN: a confirmed bad replacement during the movie cooldown. It never authorizes another
//   download or consumes an older quarantine.
// - DAILY_LIMIT: a confirmed faulty source while the daily mutation quota is full. The decoder
//   evidence authorizes no mutation by itself.
// The kind supplies its gate, its journal, its validation and its messages. A later pass resumes the
// existing repair with the frozen evidence instead of decoding again; an unknown Hold write is never
// replayed.
const day=86400000;
const eligibleStates=new Set(['Transcode error','Queued','Not required','Hold']);
const mappingKeys=['libraryId','sourceRoot','mediaRoot','radarrRoot','quarantineRoot'];
const timestamp=value=>Number.isFinite(Date.parse(value));
const isoTimestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

// Cooldown kind.
function cooldownContext(cfg,c){
 if(!Number.isInteger(c.movieId)||c.movieId<=0||!c.binding||!Number.isInteger(c.binding.movieFileId)||c.binding.movieFileId<=0)throw Error('Missing current replacement binding');
 if(typeof c.relative!=='string'||c.relative.startsWith('/')||c.relative.includes('\\')||c.relative.split('/').some(p=>!p||p==='.'||p==='..')||c.file!==cfg.sourceRoot+'/'+c.relative||!cfg.libraryId)throw Error('Replacement mapping changed');
 if(!c.fp||!c.source||!Number.isSafeInteger(c.size)||c.size<=0||c.mutationStarted||c.quarantine)throw Error('Replacement source is not eligible for deferral');
}

function cooldownEvidence(c,now){
 const e=c.evidence;
 if(!e||e.sourceFP!==c.fp||!hash(e.sampleSHA256)||!timestamp(e.confirmed)||Date.parse(e.confirmed)>now||classify({code:0,stderr:e.signature}).kind!=='corrupt'||e.checks?.length!==2||!confirmed(...e.checks)||classify(e.checks[0]).signature!==e.signature)throw Error('Missing confirmed unchanged-source evidence');
}

export function cooldownFor({cfg,state,c,now=Date.now()}){
 if(!Number.isFinite(now)||!Number.isFinite(cfg.movieCooldownDays)||cfg.movieCooldownDays<0)throw Error('Invalid movie cooldown');
 const blockers=Object.values(state.cases||{}).filter(x=>x.id!==c.id&&x.movieId===c.movieId&&Number.isFinite(x.mutationStarted)&&x.mutationStarted>0&&x.mutationStarted+cfg.movieCooldownDays*day>now);
 if(!blockers.length)return null;
 const until=Math.max(...blockers.map(x=>x.mutationStarted+cfg.movieCooldownDays*day));
 if(!Number.isFinite(until)||until>HOLD_FOREVER)throw Error('Invalid movie cooldown deadline');
 return {retryAt:new Date(until).toISOString(),caseIds:blockers.map(x=>x.id).sort(),
  parentCaseIds:blockers.filter(x=>x.replacement?.movieFileId===c.binding?.movieFileId&&x.replacementRelative===c.relative&&x.replacementSourceFP===c.fp).map(x=>x.id).sort()};
}

function cooldownJournal({cfg,c,now,statuses}){
 cooldownContext(cfg,c);cooldownEvidence(c,now);
 const d=c.deferredCooldown;
 if(!statuses.includes(c.status)||d?.version!==1||d.file!==c.file||d.source!==c.source||d.size!==c.size||d.libraryId!==cfg.libraryId||d.sourceRoot!==cfg.sourceRoot||d.sourceFP!==c.fp||d.sampleSHA256!==c.evidence.sampleSHA256||d.signature!==c.evidence.signature||!isDeepStrictEqual(d.binding,c.binding)||!timestamp(d.retryAt))throw Error('Invalid deferred replacement journal');
 return d;
}

export const COOLDOWN=Object.freeze({
 deferred:'deferred_cooldown',intent:'defer_cooldown_intent',journal:'deferredCooldown',
 check:({cfg,c,now})=>{cooldownContext(cfg,c);cooldownEvidence(c,now);},
 gate:cooldownFor,
 // The movie's earlier repair must be a different edition than the one being deferred.
 beforeDefer:({state,c,gate})=>{if(gate.caseIds.map(id=>state.cases[id]).some(x=>x.binding?.movieFileId===c.binding.movieFileId||x.binding?.sourceTitle===c.binding.sourceTitle))throw Error('Cooldown source is not a distinct replacement edition');},
 record:({cfg,c,gate})=>({version:1,file:c.file,source:c.source,size:c.size,libraryId:cfg.libraryId,sourceRoot:cfg.sourceRoot,sourceFP:c.fp,sampleSHA256:c.evidence.sampleSHA256,binding:structuredClone(c.binding),signature:c.evidence.signature,...gate}),
 validate:cooldownJournal,
 revalidateAroundHold:false,
 writeEvenIfHeld:true,
 waiting:({cfg,state,c,now})=>{
  const cooldown=cooldownFor({cfg,state,c,now});
  if(cooldown)return {status:'waiting_cooldown',...cooldown};
  if(!Number.isInteger(cfg.maxRepairsPerDay)||cfg.maxRepairsPerDay<=0)throw Error('Invalid daily recovery limit');
  const recent=Object.values(state.cases||{}).filter(x=>Number.isFinite(x.mutationStarted)&&x.mutationStarted>0&&x.mutationStarted+day>now);
  if(recent.length>=cfg.maxRepairsPerDay)return {status:'waiting_limit',retryAt:new Date(Math.min(...recent.map(x=>x.mutationStarted+day))).toISOString()};
  return null;
 },
 messages:{
  sourceChanged:'Confirmed replacement source changed',bindingChanged:'Confirmed replacement Radarr binding changed',readsChanged:'Confirmed replacement reads changed',
  mismatch:'Replacement Tdarr entry does not match configured library',
  notEligible:'Replacement Tdarr state is not eligible for deferral',changedBeforeHold:'Replacement Tdarr state changed before Hold',
  intent:'Confirmed bad replacement; preserving source and preventing another transcode during movie cooldown',
  holdUncertain:'Replacement Hold result uncertain; inspect before retry',
  deferred:'Confirmed decoding error in replacement; film remains in the library while recovery waits for movie cooldown',
  notHeld:'Deferred replacement is no longer held',
  notAcknowledged:'Deferred Hold was not acknowledged; manual inspection required',
  reconciled:'Confirmed decoding error in replacement; acknowledged Hold reconciled without replaying the write',
 },
});

// Daily-limit kind.
function configuration(cfg,now){
 if(!Number.isFinite(now)||now<=0||now>HOLD_FOREVER||typeof cfg.enabled!=='boolean'||!Number.isInteger(cfg.maxRepairsPerDay)||cfg.maxRepairsPerDay<=0)throw Error('Invalid daily recovery limit configuration');
 if(typeof cfg.libraryId!=='string'||!cfg.libraryId)throw Error('Invalid deferred source library');
 for(const key of mappingKeys.slice(1)){
  const root=cfg[key];
  if(typeof root!=='string'||!root.startsWith('/')||root.includes('\\')||root.split('/').some(p=>p==='.'||p==='..')||path.posix.resolve(root)!==root.replace(/\/$/,''))throw Error('Invalid deferred source mapping '+key);
 }
}

function limitContext(cfg,c,now){
 configuration(cfg,now);
 if(c.approval!=null)throw Error('Frozen approved cases use their separate recovery path');
 if(!Number.isInteger(c.movieId)||c.movieId<=0||!c.binding||!Number.isInteger(c.binding.movieFileId)||c.binding.movieFileId<=0||typeof c.binding.sourceTitle!=='string'||!c.binding.sourceTitle)throw Error('Missing confirmed source binding');
 if(typeof c.relative!=='string'||c.relative.startsWith('/')||c.relative.includes('\\')||c.relative.split('/').some(p=>!p||p==='.'||p==='..')||c.file!==cfg.sourceRoot.replace(/\/$/,'')+'/'+c.relative||c.source!==path.posix.join(cfg.mediaRoot,c.relative))throw Error('Confirmed source mapping changed');
 if(typeof c.fp!=='string'||!c.fp||!Number.isSafeInteger(c.size)||c.size<=0||(c.mutationStarted!=null&&c.mutationStarted!==0)||c.quarantine||c.profileId)throw Error('Confirmed source is not eligible for quota deferral');
 const e=c.evidence;
 if(!e||e.sourceFP!==c.fp||typeof e.sampleSHA256!=='string'||!/^[a-f0-9]{64}$/.test(e.sampleSHA256)||!isoTimestamp(e.confirmed)||Date.parse(e.confirmed)>now||e.checks?.length!==2||e.checks.some(check=>!Number.isInteger(check?.code)||check.code<0||typeof check.stderr!=='string')||!confirmed(...e.checks)||classify(e.checks[0]).signature!==e.signature)throw Error('Missing actual repeated unchanged-source evidence');
}

// Capacity becomes available after enough entries expire to leave fewer than
// maxRepairsPerDay active mutations. With five entries and a limit of three,
// the third expiry releases capacity; the first expiry does not.
export function quotaFor({cfg,state,now=Date.now()}){
 configuration(cfg,now);
 const active=[];
 for(const [key,c] of Object.entries(state.cases||{})){
  const started=c.mutationStarted;
  if(started==null||started===0)continue;
  if(!Number.isFinite(started)||started<=0||!Number.isFinite(started+day)||started+day>HOLD_FOREVER)throw Error('Invalid recovery mutation timestamp');
  if(started+day>now)active.push({id:c.id||key,expires:started+day});
 }
 if(active.length<cfg.maxRepairsPerDay)return null;
 active.sort((a,b)=>a.expires-b.expires||String(a.id).localeCompare(String(b.id)));
 return {retryAt:new Date(active[active.length-cfg.maxRepairsPerDay].expires).toISOString(),caseIds:active.map(c=>c.id).sort()};
}

export function validateDeferredLimit({cfg,c,now=Date.now(),statuses=['deferred_limit','defer_limit_intent']}){
 limitContext(cfg,c,now);
 const d=c.deferredLimit;
 if(!statuses.includes(c.status)||d?.version!==1||d.file!==c.file||d.source!==c.source||d.size!==c.size||d.sourceFP!==c.fp||d.sampleSHA256!==c.evidence.sampleSHA256||d.signature!==c.evidence.signature||!isDeepStrictEqual(d.binding,c.binding)||!isoTimestamp(d.retryAt)||Date.parse(d.retryAt)>HOLD_FOREVER||!Array.isArray(d.caseIds)||!d.caseIds.length||d.caseIds.some(id=>typeof id!=='string'||!id)||new Set(d.caseIds).size!==d.caseIds.length||mappingKeys.some(key=>d[key]!==cfg[key]))throw Error('Invalid deferred daily-limit journal');
 return d;
}

export const DAILY_LIMIT=Object.freeze({
 deferred:'deferred_limit',intent:'defer_limit_intent',journal:'deferredLimit',
 check:({cfg,c,now})=>limitContext(cfg,c,now),
 gate:quotaFor,
 beforeDefer:()=>{},
 record:({cfg,c,gate})=>({version:1,file:c.file,source:c.source,size:c.size,sourceFP:c.fp,sampleSHA256:c.evidence.sampleSHA256,signature:c.evidence.signature,binding:structuredClone(c.binding),...Object.fromEntries(mappingKeys.map(key=>[key,cfg[key]])),...gate}),
 validate:validateDeferredLimit,
 // The journal is checked again after the intent and after the Hold.
 revalidateAroundHold:true,
 // An acknowledged earlier write is not repeated; either way the Hold is read back.
 writeEvenIfHeld:false,
 waiting:({cfg,state,now})=>{const quota=quotaFor({cfg,state,now});return quota?{status:'waiting_limit',...quota}:null;},
 messages:{
  sourceChanged:'Confirmed source changed during daily-limit wait',bindingChanged:'Confirmed Radarr binding changed during daily-limit wait',readsChanged:'Confirmed source reads changed during daily-limit wait',
  mismatch:'Deferred Tdarr entry does not match configured source and library',
  notEligible:'Confirmed Tdarr source is not eligible for quota deferral',changedBeforeHold:'Confirmed Tdarr source changed before quota Hold',
  intent:'Confirmed source error; preserving the film and preventing another transcode while the daily recovery quota is full',
  holdUncertain:'Daily-limit Hold result uncertain; inspect before retry',
  deferred:'Confirmed decoding error; film remains in the library until daily recovery capacity is available',
  notHeld:'Deferred daily-limit source is no longer held',
  notAcknowledged:'Daily-limit Hold was not acknowledged; manual inspection required',
  reconciled:'Confirmed source error; acknowledged daily-limit Hold reconciled without replaying the write',
 },
});

// Shared steps.
async function unchanged(kind,c,{safeSource,sample,readBinding}){
 const source=await safeSource(c.relative);
 if(source.fp!==c.fp||source.size!==c.size||source.p!==c.source)throw Error(kind.messages.sourceChanged);
 if(!isDeepStrictEqual(await readBinding(c),c.binding))throw Error(kind.messages.bindingChanged);
 if(await sample(c.source)!==c.evidence.sampleSHA256)throw Error(kind.messages.readsChanged);
}

const bindingError=kind=>error=>{throw error?.code==='TDARR_FILE_BINDING'?Error(kind.messages.mismatch):error};

async function rowFor(kind,cfg,c,td){
 const row=await createTdarrFileState(td,{libraryId:cfg.libraryId}).read(c.file).catch(bindingError(kind));
 if(!row)throw Error(kind.messages.mismatch);
 return row;
}

/** Journals the deferral, then writes and confirms the permanent Hold. False when the kind's gate is closed or in Verify. */
export async function deferConfirmed(kind,{cfg,state,c,td,phase,idle,safeSource,sample,readBinding,now=Date.now()}){
 const deps={safeSource,sample,readBinding};
 kind.check({cfg,c,now});
 const gate=kind.gate({cfg,state,c,now});
 if(!gate||!cfg.enabled)return false;
 kind.beforeDefer({state,c,gate});
 await idle(c);await unchanged(kind,c,deps);
 if(!eligibleStates.has((await rowFor(kind,cfg,c,td)).TranscodeDecisionMaker))throw Error(kind.messages.notEligible);
 c[kind.journal]=kind.record({cfg,c,gate});
 c.nextRetryAt=gate.retryAt;
 await phase(c,kind.intent,kind.messages.intent);
 if(kind.revalidateAroundHold)kind.validate({cfg,c,now,statuses:[kind.intent]});
 await idle(c);await unchanged(kind,c,deps);
 const before=await rowFor(kind,cfg,c,td);
 if(!eligibleStates.has(before.TranscodeDecisionMaker))throw Error(kind.messages.changedBeforeHold);
 if(kind.writeEvenIfHeld||!isHeld(before,HOLD_FOREVER))await createTdarrFileState(td,{libraryId:cfg.libraryId}).hold(c.file,HOLD_FOREVER,kind.messages.holdUncertain).catch(bindingError(kind));
 else if(!isHeld(await rowFor(kind,cfg,c,td),HOLD_FOREVER))throw Error(kind.messages.holdUncertain);
 if(kind.revalidateAroundHold)kind.validate({cfg,c,now,statuses:[kind.intent]});
 await unchanged(kind,c,deps);
 c.skipCurrentEdition=true;c.preservedSourceFP=c.fp;
 await phase(c,kind.deferred,kind.messages.deferred);
 return true;
}

// Reads only: never clear a Hold or replay a Radarr or Tdarr mutation here. After "ready" the caller
// may resume its existing repair journal with the frozen evidence instead of decoding again.
export async function inspectDeferred(kind,{cfg,state,c,td,safeSource,sample,readBinding,now=Date.now()}){
 kind.validate({cfg,c,now,statuses:[kind.deferred]});
 await unchanged(kind,c,{safeSource,sample,readBinding});
 if(!isHeld(await rowFor(kind,cfg,c,td),HOLD_FOREVER))throw Error(kind.messages.notHeld);
 if(!cfg.enabled)return {status:'disabled'};
 return kind.waiting({cfg,state,c,now})||{status:'ready'};
}

// An accepted Hold with a lost response is acknowledged by reads only. An unknown or unaccepted
// write requires inspection rather than a blind replay.
export async function reconcileDeferredIntent(kind,{cfg,c,td,phase,idle,safeSource,sample,readBinding,now=Date.now()}){
 const d=kind.validate({cfg,c,now,statuses:[kind.intent]});
 await idle(c);await unchanged(kind,c,{safeSource,sample,readBinding});
 if(!isHeld(await rowFor(kind,cfg,c,td),HOLD_FOREVER))throw Error(kind.messages.notAcknowledged);
 c.skipCurrentEdition=true;c.preservedSourceFP=c.fp;c.nextRetryAt=d.retryAt;
 await phase(c,kind.deferred,kind.messages.reconciled);
 return true;
}
