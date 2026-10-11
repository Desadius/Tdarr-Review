import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {classify,confirmed} from './policy.mjs';

// Keep a confirmed faulty edition in the library while the daily mutation
// quota is full. The decoder evidence authorizes no mutation by itself.
export const LIMIT_HOLD_UNTIL=253402300799000;
const day=86400000;
const eligibleStates=new Set(['Queued','Not required','Transcode error','Hold']);
const mappingKeys=['libraryId','sourceRoot','mediaRoot','radarrRoot','quarantineRoot'];
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));

function configuration(cfg,now){
 if(!Number.isFinite(now)||now<=0||now>LIMIT_HOLD_UNTIL||typeof cfg.enabled!=='boolean'||!Number.isInteger(cfg.maxRepairsPerDay)||cfg.maxRepairsPerDay<=0)throw Error('Invalid daily recovery limit configuration');
 if(typeof cfg.libraryId!=='string'||!cfg.libraryId)throw Error('Invalid deferred source library');
 for(const key of mappingKeys.slice(1)){
  const root=cfg[key];
  if(typeof root!=='string'||!root.startsWith('/')||root.includes('\\')||root.split('/').some(p=>p==='.'||p==='..')||path.posix.resolve(root)!==root.replace(/\/$/,''))throw Error('Invalid deferred source mapping '+key);
 }
}

function context(cfg,c,now){
 configuration(cfg,now);
 if(c.approval!=null)throw Error('Frozen approved cases use their separate recovery path');
 if(!Number.isInteger(c.movieId)||c.movieId<=0||!c.binding||!Number.isInteger(c.binding.movieFileId)||c.binding.movieFileId<=0||typeof c.binding.sourceTitle!=='string'||!c.binding.sourceTitle)throw Error('Missing confirmed source binding');
 if(typeof c.relative!=='string'||c.relative.startsWith('/')||c.relative.includes('\\')||c.relative.split('/').some(p=>!p||p==='.'||p==='..')||c.file!==cfg.sourceRoot.replace(/\/$/,'')+'/'+c.relative||c.source!==path.posix.join(cfg.mediaRoot,c.relative))throw Error('Confirmed source mapping changed');
 if(typeof c.fp!=='string'||!c.fp||!Number.isSafeInteger(c.size)||c.size<=0||(c.mutationStarted!=null&&c.mutationStarted!==0)||c.quarantine||c.profileId)throw Error('Confirmed source is not eligible for quota deferral');
 const e=c.evidence;
 if(!e||e.sourceFP!==c.fp||typeof e.sampleSHA256!=='string'||!/^[a-f0-9]{64}$/.test(e.sampleSHA256)||!timestamp(e.confirmed)||Date.parse(e.confirmed)>now||e.checks?.length!==2||e.checks.some(check=>!Number.isInteger(check?.code)||check.code<0||typeof check.stderr!=='string')||!confirmed(...e.checks)||classify(e.checks[0]).signature!==e.signature)throw Error('Missing actual repeated unchanged-source evidence');
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
  if(!Number.isFinite(started)||started<=0||!Number.isFinite(started+day)||started+day>LIMIT_HOLD_UNTIL)throw Error('Invalid recovery mutation timestamp');
  if(started+day>now)active.push({id:c.id||key,expires:started+day});
 }
 if(active.length<cfg.maxRepairsPerDay)return null;
 active.sort((a,b)=>a.expires-b.expires||String(a.id).localeCompare(String(b.id)));
 return {retryAt:new Date(active[active.length-cfg.maxRepairsPerDay].expires).toISOString(),caseIds:active.map(c=>c.id).sort()};
}

export function validateDeferredLimit({cfg,c,now=Date.now(),statuses=['deferred_limit','defer_limit_intent']}){
 context(cfg,c,now);
 const d=c.deferredLimit;
 if(!statuses.includes(c.status)||d?.version!==1||d.file!==c.file||d.source!==c.source||d.size!==c.size||d.sourceFP!==c.fp||d.sampleSHA256!==c.evidence.sampleSHA256||d.signature!==c.evidence.signature||!isDeepStrictEqual(d.binding,c.binding)||!timestamp(d.retryAt)||Date.parse(d.retryAt)>LIMIT_HOLD_UNTIL||!Array.isArray(d.caseIds)||!d.caseIds.length||d.caseIds.some(id=>typeof id!=='string'||!id)||new Set(d.caseIds).size!==d.caseIds.length||mappingKeys.some(key=>d[key]!==cfg[key]))throw Error('Invalid deferred daily-limit journal');
 return d;
}

async function unchanged(c,{safeSource,sample,readBinding}){
 const source=await safeSource(c.relative);
 if(source.p!==c.source||source.fp!==c.fp||source.size!==c.size)throw Error('Confirmed source changed during daily-limit wait');
 if(!isDeepStrictEqual(await readBinding(c),c.binding))throw Error('Confirmed Radarr binding changed during daily-limit wait');
 if(await sample(c.source)!==c.evidence.sampleSHA256)throw Error('Confirmed source reads changed during daily-limit wait');
}

async function rowFor(cfg,c,td){
 const row=await td('/api/v2/cruddb',{collection:'FileJSONDB',mode:'getById',docID:c.file});
 if(!row||Array.isArray(row)||row._id!==c.file||row.DB!==cfg.libraryId)throw Error('Deferred Tdarr entry does not match configured source and library');
 return row;
}

export async function deferConfirmedLimit({cfg,state,c,phase,idle,safeSource,sample,readBinding,td,now=Date.now()}){
 context(cfg,c,now);
 const quota=quotaFor({cfg,state,now});
 if(!quota||!cfg.enabled)return false;
 await idle(c);await unchanged(c,{safeSource,sample,readBinding});
 if(!eligibleStates.has((await rowFor(cfg,c,td)).TranscodeDecisionMaker))throw Error('Confirmed Tdarr source is not eligible for quota deferral');
 c.deferredLimit={version:1,file:c.file,source:c.source,size:c.size,sourceFP:c.fp,sampleSHA256:c.evidence.sampleSHA256,signature:c.evidence.signature,binding:structuredClone(c.binding),...Object.fromEntries(mappingKeys.map(key=>[key,cfg[key]])),...quota};
 c.nextRetryAt=quota.retryAt;
 await phase(c,'defer_limit_intent','Confirmed source error; preserving the film and preventing another transcode while the daily recovery quota is full');
 validateDeferredLimit({cfg,c,now,statuses:['defer_limit_intent']});
 await idle(c);await unchanged(c,{safeSource,sample,readBinding});
 const before=await rowFor(cfg,c,td);
 if(!eligibleStates.has(before.TranscodeDecisionMaker))throw Error('Confirmed Tdarr source changed before quota Hold');
 if(before.TranscodeDecisionMaker!=='Hold'||Number(before.holdUntil)!==LIMIT_HOLD_UNTIL)await td('/api/v2/bulk-update-files',{fileIds:[c.file],updatedObj:{TranscodeDecisionMaker:'Hold',holdUntil:LIMIT_HOLD_UNTIL}});
 const row=await rowFor(cfg,c,td);
 if(row.TranscodeDecisionMaker!=='Hold'||Number(row.holdUntil)!==LIMIT_HOLD_UNTIL)throw Error('Daily-limit Hold result uncertain; inspect before retry');
 validateDeferredLimit({cfg,c,now,statuses:['defer_limit_intent']});
 await unchanged(c,{safeSource,sample,readBinding});
 c.skipCurrentEdition=true;c.preservedSourceFP=c.fp;
 await phase(c,'deferred_limit','Confirmed decoding error; film remains in the library until daily recovery capacity is available');
 return true;
}

// Reads only: never clear a Hold or replay a Radarr or Tdarr mutation here.
export async function inspectDeferredLimit({cfg,state,c,safeSource,sample,readBinding,td,now=Date.now()}){
 validateDeferredLimit({cfg,c,now,statuses:['deferred_limit']});
 await unchanged(c,{safeSource,sample,readBinding});
 const row=await rowFor(cfg,c,td);
 if(row.TranscodeDecisionMaker!=='Hold'||Number(row.holdUntil)!==LIMIT_HOLD_UNTIL)throw Error('Deferred daily-limit source is no longer held');
 if(!cfg.enabled)return {status:'disabled'};
 const quota=quotaFor({cfg,state,now});
 return quota?{status:'waiting_limit',...quota}:{status:'ready'};
}

// An accepted Hold with a lost response is safe to acknowledge by reads. An
// unknown or unaccepted write requires inspection rather than blind replay.
export async function reconcileDeferredLimitIntent({cfg,c,phase,idle,safeSource,sample,readBinding,td,now=Date.now()}){
 const d=validateDeferredLimit({cfg,c,now,statuses:['defer_limit_intent']});
 await idle(c);await unchanged(c,{safeSource,sample,readBinding});
 const row=await rowFor(cfg,c,td);
 if(row.TranscodeDecisionMaker!=='Hold'||Number(row.holdUntil)!==LIMIT_HOLD_UNTIL)throw Error('Daily-limit Hold was not acknowledged; manual inspection required');
 c.skipCurrentEdition=true;c.preservedSourceFP=c.fp;c.nextRetryAt=d.retryAt;
 await phase(c,'deferred_limit','Confirmed source error; acknowledged daily-limit Hold reconciled without replaying the write');
 return true;
}
