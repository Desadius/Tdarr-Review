import {isDeepStrictEqual} from 'node:util';
import {classify,confirmed} from './policy.mjs';

// A confirmed bad replacement may be diagnosed during a movie cooldown, but
// that must never authorize another download or consume an older quarantine.
export const DEFERRED_HOLD_UNTIL=253402300799000;
const day=86400000;
const phases=new Set(['Transcode error','Queued','Not required','Hold']);
const timestamp=value=>Number.isFinite(Date.parse(value));
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

function context(cfg,c){
 if(!Number.isInteger(c.movieId)||c.movieId<=0||!c.binding||!Number.isInteger(c.binding.movieFileId)||c.binding.movieFileId<=0)throw Error('Missing current replacement binding');
 if(typeof c.relative!=='string'||c.relative.startsWith('/')||c.relative.includes('\\')||c.relative.split('/').some(p=>!p||p==='.'||p==='..')||c.file!==cfg.sourceRoot+'/'+c.relative||!cfg.libraryId)throw Error('Replacement mapping changed');
 if(!c.fp||!c.source||!Number.isSafeInteger(c.size)||c.size<=0||c.mutationStarted||c.quarantine)throw Error('Replacement source is not eligible for deferral');
}

function evidence(c,now){
 const e=c.evidence;
 if(!e||e.sourceFP!==c.fp||!hash(e.sampleSHA256)||!timestamp(e.confirmed)||Date.parse(e.confirmed)>now||classify({code:0,stderr:e.signature}).kind!=='corrupt'||e.checks?.length!==2||!confirmed(...e.checks)||classify(e.checks[0]).signature!==e.signature)throw Error('Missing confirmed unchanged-source evidence');
}

export function cooldownFor({cfg,state,c,now=Date.now()}){
 if(!Number.isFinite(now)||!Number.isFinite(cfg.movieCooldownDays)||cfg.movieCooldownDays<0)throw Error('Invalid movie cooldown');
 const blockers=Object.values(state.cases||{}).filter(x=>x.id!==c.id&&x.movieId===c.movieId&&Number.isFinite(x.mutationStarted)&&x.mutationStarted>0&&x.mutationStarted+cfg.movieCooldownDays*day>now);
 if(!blockers.length)return null;
 const until=Math.max(...blockers.map(x=>x.mutationStarted+cfg.movieCooldownDays*day));
 if(!Number.isFinite(until)||until>DEFERRED_HOLD_UNTIL)throw Error('Invalid movie cooldown deadline');
 return {retryAt:new Date(until).toISOString(),caseIds:blockers.map(x=>x.id).sort(),
  parentCaseIds:blockers.filter(x=>x.replacement?.movieFileId===c.binding?.movieFileId&&x.replacementRelative===c.relative&&x.replacementSourceFP===c.fp).map(x=>x.id).sort()};
}

async function unchanged(c,{safeSource,sample,readBinding}){
 const current=await safeSource(c.relative);
 if(current.fp!==c.fp||current.size!==c.size||current.p!==c.source)throw Error('Confirmed replacement source changed');
 if(!isDeepStrictEqual(await readBinding(c),c.binding))throw Error('Confirmed replacement Radarr binding changed');
 if(await sample(c.source)!==c.evidence.sampleSHA256)throw Error('Confirmed replacement reads changed');
 return current;
}

async function rowFor(cfg,c,td){
 const row=await td('/api/v2/cruddb',{collection:'FileJSONDB',mode:'getById',docID:c.file});
 if(!row||Array.isArray(row)||row._id!==c.file||row.DB!==cfg.libraryId)throw Error('Replacement Tdarr entry does not match configured library');
 return row;
}

export async function deferConfirmedReplacement({cfg,state,c,td,phase,idle,safeSource,sample,readBinding,now=Date.now()}){
 context(cfg,c);evidence(c,now);
 const cooldown=cooldownFor({cfg,state,c,now});
 if(!cooldown)return false;
 if(!cfg.enabled)return false;
 const blockers=cooldown.caseIds.map(id=>state.cases[id]);
 if(blockers.some(x=>x.binding?.movieFileId===c.binding.movieFileId||x.binding?.sourceTitle===c.binding.sourceTitle))throw Error('Cooldown source is not a distinct replacement edition');
 await idle(c);
 await unchanged(c,{safeSource,sample,readBinding});
 if(!phases.has((await rowFor(cfg,c,td)).TranscodeDecisionMaker))throw Error('Replacement Tdarr state is not eligible for deferral');
 c.deferredCooldown={version:1,file:c.file,source:c.source,size:c.size,libraryId:cfg.libraryId,sourceRoot:cfg.sourceRoot,sourceFP:c.fp,sampleSHA256:c.evidence.sampleSHA256,binding:structuredClone(c.binding),signature:c.evidence.signature,...cooldown};
 c.nextRetryAt=cooldown.retryAt;
 await phase(c,'defer_cooldown_intent','Confirmed bad replacement; preserving source and preventing another transcode during movie cooldown');
 await idle(c);
 await unchanged(c,{safeSource,sample,readBinding});
 if(!phases.has((await rowFor(cfg,c,td)).TranscodeDecisionMaker))throw Error('Replacement Tdarr state changed before Hold');
 await td('/api/v2/bulk-update-files',{fileIds:[c.file],updatedObj:{TranscodeDecisionMaker:'Hold',holdUntil:DEFERRED_HOLD_UNTIL}});
 const row=await rowFor(cfg,c,td);
 if(row.TranscodeDecisionMaker!=='Hold'||Number(row.holdUntil)!==DEFERRED_HOLD_UNTIL)throw Error('Replacement Hold result uncertain; inspect before retry');
 await unchanged(c,{safeSource,sample,readBinding});
 c.skipCurrentEdition=true;c.preservedSourceFP=c.fp;
 await phase(c,'deferred_cooldown','Confirmed decoding error in replacement; film remains in the library while recovery waits for movie cooldown');
 return true;
}

// This function performs reads only. The caller may resume its existing repair
// journal after "ready", preserving the original evidence instead of decoding
// again. No Hold is cleared and no Radarr command is issued here.
export async function inspectDeferredReplacement({cfg,state,c,td,safeSource,sample,readBinding,now=Date.now()}){
 context(cfg,c);evidence(c,now);
 const d=c.deferredCooldown;
 if(c.status!=='deferred_cooldown'||d?.version!==1||d.file!==c.file||d.source!==c.source||d.size!==c.size||d.libraryId!==cfg.libraryId||d.sourceRoot!==cfg.sourceRoot||d.sourceFP!==c.fp||d.sampleSHA256!==c.evidence.sampleSHA256||d.signature!==c.evidence.signature||!isDeepStrictEqual(d.binding,c.binding)||!timestamp(d.retryAt))throw Error('Invalid deferred replacement journal');
 await unchanged(c,{safeSource,sample,readBinding});
 const row=await rowFor(cfg,c,td);
 if(row.TranscodeDecisionMaker!=='Hold'||Number(row.holdUntil)!==DEFERRED_HOLD_UNTIL)throw Error('Deferred replacement is no longer held');
 if(!cfg.enabled)return {status:'disabled'};
 const cooldown=cooldownFor({cfg,state,c,now});
 if(cooldown)return {status:'waiting_cooldown',...cooldown};
 if(!Number.isInteger(cfg.maxRepairsPerDay)||cfg.maxRepairsPerDay<=0)throw Error('Invalid daily recovery limit');
 const recent=Object.values(state.cases||{}).filter(x=>Number.isFinite(x.mutationStarted)&&x.mutationStarted>0&&x.mutationStarted+day>now);
 if(recent.length>=cfg.maxRepairsPerDay)return {status:'waiting_limit',retryAt:new Date(Math.min(...recent.map(x=>x.mutationStarted+day))).toISOString()};
 return {status:'ready'};
}

// Reconcile only an already acknowledged Hold after an interrupted response.
// An unaccepted/unknown write remains manual; never replay it on restart.
export async function reconcileDeferredIntent({cfg,c,td,phase,idle,safeSource,sample,readBinding,now=Date.now()}){
 context(cfg,c);evidence(c,now);
 const d=c.deferredCooldown;
 if(c.status!=='defer_cooldown_intent'||d?.version!==1||d.file!==c.file||d.source!==c.source||d.size!==c.size||d.libraryId!==cfg.libraryId||d.sourceRoot!==cfg.sourceRoot||d.sourceFP!==c.fp||d.sampleSHA256!==c.evidence.sampleSHA256||d.signature!==c.evidence.signature||!isDeepStrictEqual(d.binding,c.binding)||!timestamp(d.retryAt))throw Error('Invalid deferred replacement journal');
 await idle(c);await unchanged(c,{safeSource,sample,readBinding});
 const row=await rowFor(cfg,c,td);
 if(row.TranscodeDecisionMaker!=='Hold'||Number(row.holdUntil)!==DEFERRED_HOLD_UNTIL)throw Error('Deferred Hold was not acknowledged; manual inspection required');
 c.skipCurrentEdition=true;c.preservedSourceFP=c.fp;c.nextRetryAt=d.retryAt;
 await phase(c,'deferred_cooldown','Confirmed decoding error in replacement; acknowledged Hold reconciled without replaying the write');
 return true;
}
