import {approvedBind,validatePending,processPending} from './pending-approved.mjs';
import {maintainWaitingSources,publishRecoveryStatus} from './waiting-source.mjs';
import {refreshOriginalLanguages} from './original-language-cache.mjs';
import {retainCase} from './quarantine-retention.mjs';
import {createLiveStatusPublisher,createDecodeProgressParser} from './live-status.mjs';
import {probeDuration,runOriginalDecode} from './original-decode.mjs';
import {ensureHandoff,preservesHold} from './replacement-handoff.mjs';
import {COOLDOWN,DAILY_LIMIT,cooldownFor,quotaFor,deferConfirmed,inspectDeferred,reconcileDeferredIntent} from './frozen-deferral.mjs';
import {loadApprovalRegistry,registryHasApproval} from './approval-registry.mjs';
import {registryAllowedModes} from './frozen-config.mjs';
import {configDigest,detectConfigChange,startupValidator} from './config-watch.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {classify,confirmed,originalFailureReport,fatalMpeg2Input,PREMATURE_EOF,relative,bindHistory,bindApprovedImport,bindingDiagnosis,blocked,caseId,within} from './policy.mjs';
import {readHeader} from './container-header.mjs';
import {lowPriorityHash} from './full-hash.mjs';
import {createTdarrFileState} from './tdarr-file-state.mjs';
import {DatabaseSync} from 'node:sqlite';
import {readRuntimeRecoveryConfig} from './managed-config.mjs';
import {atomicJson as atomic} from './atomic-json.mjs';
import {hasFiniteTruncation} from './matroska-bounds.mjs';
import {identityOf} from './file-identity.mjs';

// The Recovery worker without its process: configuration, state and the approval registry are
// loaded and checked by the caller (recovery/worker.mjs), which also owns signals, the control
// channel and the poll loop. The adapters (Tdarr, Radarr, phase journal, source checks) are built
// once here and shared by every step, so one poll can be driven from a test.
export function createWorker({data,mode,cfg,configText,managed,state,pendingApprovals,canStart}){
 const configFile=path.join(data,'config.json'),stateFile=path.join(data,'state.json'),loadedConfigDigest=configDigest(configText);
 const isApprovedCase=c=>registryHasApproval(pendingApprovals,c);
 const delay=ms=>new Promise(r=>setTimeout(r,ms));
 async function save(){state.updated=new Date().toISOString();await atomic(stateFile,state);}
 async function publishNow(run){try{await run();delete state.statusPublicationError;}catch(e){state.statusPublicationError=e.message;console.error('Recovery status publication: '+e.message);}}
 async function phase(c,status,message){Object.assign(c,{status,message,updated:new Date().toISOString()});await save();await publishNow(()=>liveStatus.phaseChanged(c));console.log(JSON.stringify({time:c.updated,id:c.id,title:c.relative?.split('/')[0],status,message}));}
 async function api(base,route,body,key){const r=await fetch(base.replace(/\/$/,'')+route,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(key?{'X-Api-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('API '+route.split('?')[0]+' HTTP '+r.status);const t=await r.text();try{return JSON.parse(t)}catch{return t}}
 const rad=(p,b)=>api(cfg.radarrUrl+'/api/v3',p,b,cfg.radarrApiKey);
 const td=(p,b)=>api(cfg.tdarrUrl,p,b===undefined?undefined:{data:b});
 function rows(table){const db=new DatabaseSync(cfg.database,{readOnly:true});try{return db.prepare('SELECT json_data FROM '+table).all().map(r=>JSON.parse(r.json_data));}finally{db.close();}}
 const liveStatus=createLiveStatusPublisher({getState:()=>state,readTdarrFiles:()=>rows('filejsondb'),publish:({state,tdarrFiles,decorate})=>publishRecoveryStatus({cfg,state,tdarrFiles,registryAllowedModes:registryAllowedModes(pendingApprovals.config),atomic:(p,v,mode)=>atomic(p,decorate(v),mode)}),onError:e=>{state.statusPublicationError=e.message;console.error('Recovery status publication: '+e.message);}});
 async function safeSource(rel){const p=within(cfg.mediaRoot,rel);const real=await fs.realpath(p);if(real!==p)throw Error('Symlink source is not eligible');const s=await fs.stat(p);if(!s.isFile()||s.size===0||Date.now()-s.mtimeMs<cfg.stableMinutes*60000)throw Error('Source is not a stable regular file');return {p,size:s.size,fp:identityOf(s)};}
 async function sample(file){const h=await fs.open(file,'r');try{const s=await h.stat();const sum=crypto.createHash('sha256');for(const position of [0,Math.max(0,Math.floor(s.size/2)-524288),Math.max(0,s.size-1048576)]){const b=Buffer.alloc(Math.min(s.size,1048576));const n=await h.read(b,0,b.length,position);if(n.bytesRead!==b.length)throw Error('Short source read');sum.update(b);}return sum.digest('hex');}finally{await h.close();}}
 // Optional (cfg.fullSourceHash) full SHA-256 of the original, published as c.fullHash while it runs.
 async function fullSourceHash(c,stage){
   c.fullHash={stage,done:0,total:c.size??null,started:new Date().toISOString()};await save();await publishNow(()=>liveStatus.refresh());
   let published=Date.now();
   try{
     const sha=await lowPriorityHash(c.source,{onProgress:p=>{c.fullHash={...c.fullHash,done:p.done,total:p.total,updated:new Date().toISOString()};if(Date.now()-published>=15000){published=Date.now();void publishNow(()=>liveStatus.refresh())}}});
     if((await safeSource(c.relative)).fp!==c.fp)throw Error('Source changed during full hash');
     console.log(JSON.stringify({time:new Date().toISOString(),id:c.id,title:c.relative?.split('/')[0],fullHash:stage,sha256:sha}));
     return sha;
   }finally{delete c.fullHash;await save();await publishNow(()=>liveStatus.refresh())}
 }
 async function decode(c,pass){
   await phase(c,'verifying','Independent original decode '+pass+'/2');
   if(c.headerDamage&&await readHeader(c.source)!=='terminal_overwrite')throw Error('Header signature changed');
   const durationSeconds=await probeDuration({ffmpeg:cfg.ffmpeg,ffprobe:cfg.ffprobe,file:c.source});
   await publishNow(()=>liveStatus.startDecode(c,{pass,durationSeconds}));
   let result;
   try{result=await runOriginalDecode({ffmpeg:cfg.ffmpeg,file:c.source,headerDamage:c.headerDamage,timeoutMs:cfg.decodeTimeoutHours*3600000,onProgressData:createDecodeProgressParser(measurement=>liveStatus.updateDecode(c,measurement,pass))});}
   finally{await publishNow(()=>liveStatus.finishDecode(c));}
   if(classify(result).signature===PREMATURE_EOF)result.finiteContainerTruncation=await hasFiniteTruncation(c.source);
   await atomic(path.join(data,c.id+'-decode-'+pass+'.json'),result);return result;
 }
 async function idle(c){
   const nodes=await td('/api/v2/get-nodes');
   if(!nodes||typeof nodes!=='object')throw Error('Cannot verify Tdarr workers');
   for(const n of Object.values(nodes))for(const w of Object.values(n.workers||{})){
     if(w.idle||!w.file)continue;
     let p=String(w.file).replaceAll('\\','/');
     for(const t of n.config?.pathTranslators||[]){const a=t.node.replaceAll('\\','/').replace(/\/$/,'');if(p.startsWith(a+'/')){p=t.server+p.slice(a.length);break;}}
     if(p===c.file)throw Error('Tdarr is still processing source');
   }
   // Never take a source away from an existing review result.
   for(const prefix of cfg.reviewPrefixes){const p=within(cfg.reviewRoot,prefix+'/'+c.relative);try{await fs.stat(p);throw Error('A review result exists; manual review required');}catch(e){if(e.code!=='ENOENT')throw e;}}
 }
 async function command(body){const x=await rad('/command',body);if(!x?.id)throw Error('Command receipt missing');for(let i=0;i<60;i++){const s=await rad('/command/'+x.id);if(s.status==='completed')return x.id;if(['failed','aborted','cancelled'].includes(s.status))throw Error('Radarr command failed');await delay(2000);}throw Error('Radarr command result uncertain');}
 async function movieFor(c){const movies=await rad('/movie');const target=cfg.radarrRoot.replace(/\/$/,'')+'/'+c.relative;const matches=movies.filter(m=>m.movieFile?.path===target);if(matches.length!==1)throw Error('Source does not map to exactly one Radarr movie');return {movie:matches[0],target};}
 function bind(c,m,h,target){if(isApprovedCase(c))return approvedBind(m,h,target,c.size,c.approval);const approval=cfg.approvedImportRepairs?.[c.id];return approval?bindApprovedImport(m,h,target,c.size,approval):bindHistory(m,h,target,c.size);}
 async function verifyExclusion(c){
  const b=c.binding,m=await rad('/movie/'+c.movieId),p=await rad('/qualityprofile/'+m.qualityProfileId),f=await rad('/customformat/'+b.customFormatId);
  const score=p.formatItems.find(x=>x.format===f.id)?.score;
  const otherPositive=p.formatItems.filter(x=>x.format!==f.id).reduce((sum,x)=>sum+Math.max(0,x.score),0);
  const specs=f.specifications||[];
  if(specs.length!==1||specs[0].implementation!=='ReleaseTitleSpecification'||specs[0].negate||!specs[0].required||specs[0].fields?.find(x=>x.name==='value')?.value!==b.regex||!new RegExp(b.regex,'i').test(b.sourceTitle)||!Number.isFinite(score)||score+otherPositive>=p.minFormatScore)throw Error('Exact bad release exclusion is not enforced by the current profile');
 }
 async function readBinding(c){const {movie,target}=await movieFor(c);if(movie.id!==c.movieId)throw Error('Radarr movie binding changed');return bind(c,movie,await rad('/history/movie?movieId='+movie.id),target);}
 const adapters={cfg,state,td,rad,phase,save,command,idle,safeSource,sample,readBinding,canStart};
 async function repair(c,{reuseConfirmedEvidence=false}={}){
   await idle(c);const before=await safeSource(c.relative);if(before.fp!==c.fp)throw Error('Source changed before verification');
   const {movie,target}=await movieFor(c);
   c.movieId=movie.id;const history=await rad('/history/movie?movieId='+movie.id);
   // A missing or ambiguous release binding still allows the two diagnostic decodes of a structural
   // discovery (no mutation), so an operator gets confirmed evidence and the exact binding reason.
   let bindingFailure=null;
   try{c.binding=bind(c,movie,history,target);delete c.bindingFailure;}
   catch(e){
    const structural=!c.discoveryKind||c.discoveryKind==='structural';
    const code=structural&&!reuseConfirmedEvidence&&!isApprovedCase(c)&&!cfg.approvedImportRepairs?.[c.id]?bindingDiagnosis(movie,history,target,c.size):null;
    if(!code){if(!structural)e.message+=' Zachovej originál a otevři podrobnosti Recovery; chybějící historii nenahrazuj odhadem. Náhrada vyžaduje nové výslovné oprávnění.';throw e;}
    bindingFailure={code,message:e.message};delete c.binding;
   }
   await save();
   const frozen= c.status==='deferred_limit'?c.deferredLimit:c.deferredCooldown;
   if(reuseConfirmedEvidence&&JSON.stringify(c.binding)!==JSON.stringify(frozen?.binding))throw Error('Deferred source Radarr binding changed');
   if(c.binding?.mode==='exact_title_exclusion')await verifyExclusion(c);
   let hash;if(reuseConfirmedEvidence){
    if(c.evidence?.sourceFP!==c.fp||c.evidence.checks?.length!==2||!confirmed(...c.evidence.checks)||classify(c.evidence.checks[0]).signature!==c.evidence.signature)throw Error('Deferred source evidence no longer confirmed');
    hash=await sample(c.source);if(hash!==c.evidence.sampleSHA256||(await safeSource(c.relative)).fp!==c.fp)throw Error('Deferred source changed');
   }else if(isApprovedCase(c)){validatePending(c.approval);hash=await sample(c.source);if((await safeSource(c.relative)).fp!==c.fp)throw Error('Source changed');c.evidence={signature:c.approval.signature,independentChecks:c.approval.checks,sampleSHA256:hash,confirmed:new Date().toISOString()};}else{
   hash=await sample(c.source);const a=await decode(c,1);
   if(fatalMpeg2Input(a)){
    await delay(cfg.confirmDelaySeconds*1000);const b=await decode(c,2);
    if((await safeSource(c.relative)).fp!==c.fp||await sample(c.source)!==hash)throw Error('Source changed or repeated reads differ');
    c.originalCheckKind=fatalMpeg2Input(b)?'compatibility':'unconfirmed';
    c.compatibilityChecks={sourceFP:c.fp,checks:[a,b],sampleSHA256:hash};
    await phase(c,'manual',fatalMpeg2Input(b)?'MPEG-2 se dvakrát nepodařilo dekódovat od začátku. Ověř kompatibilitu dekodéru nebo vyžádej výslovně povolenou náhradu; originál zůstává zachovaný.':'Opakované kontroly nepotvrdily stejnou chybu MPEG-2; originál zůstává zachovaný.');return;
   }
   if(classify(a).kind!=='corrupt'){
    if(classify(a).kind==='healthy'&&(await sample(c.source)!==hash||(await safeSource(c.relative)).fp!==c.fp))throw Error('Source changed during original decode; clean result does not apply to current source');
    c.originalCheckKind=classify(a).kind;await phase(c,'no_action','Original check: '+classify(a).kind+'; no Radarr action');return;
   }
   await delay(cfg.confirmDelaySeconds*1000);
   const b=await decode(c,2);
   if(!confirmed(a,b)){await phase(c,'manual','Repeated checks did not confirm the same structural corruption');return;}
   if((await safeSource(c.relative)).fp!==c.fp||await sample(c.source)!==hash)throw Error('Source changed or repeated reads differ');
   c.evidence={signature:classify(a).signature,sourceFP:c.fp,checks:[a,b],sampleSHA256:hash,confirmed:new Date().toISOString()};
 }
   if(bindingFailure){c.bindingFailure=bindingFailure;await phase(c,'manual','Confirmed faulty original; the Radarr release history cannot be bound ('+bindingFailure.code+'): '+bindingFailure.message);return;}
   if(cfg.fullSourceHash===true&&!c.evidence.fullSHA256){c.evidence.fullSHA256=await fullSourceHash(c,'confirmation');await save();}
   await phase(c,'confirmed','Same structural decoding error reproduced twice in unchanged original');
   if(!cfg.enabled){await phase(c,'dry_run','Confirmed; verify mode makes no external changes');return;}
   if(cooldownFor({cfg,state,c})){
    if(await deferConfirmed(COOLDOWN,{...adapters,c}))return;
    throw Error('Movie repair cooldown; confirmed source preserved for manual review');
   }
   // Rebind immediately before any mutation; never rely on stale import history.
   const fresh=await rad('/movie/'+c.movieId);
   const binding=bind(c,fresh,await rad('/history/movie?movieId='+c.movieId),target);
   if(JSON.stringify(binding)!==JSON.stringify(c.binding))throw Error('Radarr history changed');
   const quota=quotaFor({cfg,state});
   if(quota&&!(cfg.approvedCaseIds||[]).includes(c.id)){
    if(isApprovedCase(c)){c.nextRetryAt=quota.retryAt;await phase(c,'deferred_limit','Daily circuit breaker reached; frozen approval waits for capacity');return;}
    if(await deferConfirmed(DAILY_LIMIT,{...adapters,c}))return;
    throw Error('Daily recovery limit changed before deferral; source preserved for inspection');
   }
   // The long optional full hash runs before the first Radarr/Tdarr mutation, so stopping the
   // worker during it never leaves a Hold behind; fingerprint and samples are still rechecked
   // immediately before the rename.
   if(cfg.fullSourceHash===true){
    if(!/^[a-f0-9]{64}$/.test(c.evidence?.fullSHA256||''))throw Error('Full source hash missing from confirmation evidence');
    if(await fullSourceHash(c,'before_quarantine')!==c.evidence.fullSHA256)throw Error('Full source hash changed before quarantine');
   }
   await idle(c);
   if(isApprovedCase(c))await ensureApprovedFloor(c,movie);
   c.skipCurrentEdition=false;delete c.nextRetryAt;c.mutationStarted=Date.now();await phase(c,'holding','Preventing another Tdarr dispatch');
   // A confirmed Hold before quarantine; an unacknowledged write leaves the source in place.
   await createTdarrFileState(td,{libraryId:cfg.libraryId}).hold(c.file,Date.now()+30*86400000,'Tdarr Hold was not confirmed; source not quarantined');
   await delay(3000);await idle(c);
   if((await safeSource(c.relative)).fp!==c.fp||await sample(c.source)!==hash)throw Error('Source changed before quarantine');
   // Same-mounted-volume rename only. No copy/delete fallback and no overwrites.
   const qdir=within(cfg.quarantineRoot,c.id);await fs.mkdir(qdir,{recursive:false,mode:0o770});
   c.quarantine=path.join(qdir,path.basename(c.relative));
   await phase(c,'quarantine_intent','Preserving original outside the media library');
   await fs.rename(c.source,c.quarantine);
   c.originalOutsideSince=new Date().toISOString();
   if((await fs.stat(c.quarantine)).size!==c.size)throw Error('Quarantine size mismatch');
   await phase(c,'quarantined','Original preserved in quarantine');
   await command({name:'RescanMovie',movieId:c.movieId});
   if((await rad('/movie/'+c.movieId)).movieFileId)throw Error('Radarr still sees a current movie file');
   if(c.binding.mode==='exact_title_exclusion')await verifyExclusion(c);
   else if(!blocked(await rad('/blocklist/movie?movieId='+c.movieId),c.binding)){
     await phase(c,'blocklist_intent','Marking the exact historical download as failed');
     await rad('/history/failed/'+c.binding.historyId,{});
   }
   if(c.binding.mode!=='exact_title_exclusion'&&!blocked(await rad('/blocklist/movie?movieId='+c.movieId),c.binding))throw Error('Exact release blocklist was not confirmed');
   await phase(c,'blocked',c.binding.mode==='exact_title_exclusion'?'Exact original release excluded by Radarr custom format':'Exact original release confirmed in Radarr blocklist');
   // MarkAsFailed can trigger Radarr's own search. Avoid duplicating it.
   await delay(3000);
   const commands=await rad('/command');
   const existing=commands.find(x=>x.name==='MoviesSearch'&&(x.body?.movieIds||[]).includes(c.movieId)&&Date.parse(x.queued||x.started||0)>=c.mutationStarted-1000);
   if(existing)c.searchCommand=existing.id;
   else {await phase(c,'search_intent','Requesting replacement search');const r=await rad('/command',{name:'MoviesSearch',movieIds:[c.movieId]});if(!r?.id)throw Error('Search result uncertain');c.searchCommand=r.id;}
   await phase(c,'waiting_replacement','Release blocked; replacement search requested; original retained in quarantine');
 }
 async function observe(){
  for(const c of Object.values(state.cases).filter(x=>['waiting_replacement','replacement_queue_intent'].includes(x.status))){
   if(!canStart())return;
   try {
   const m=await rad('/movie/'+c.movieId);
   if(c.status==='replacement_queue_intent'&&(!m.movieFileId||m.movieFileId!==(c.replacement?.movieFileId)||!m.movieFile))throw Object.assign(Error('Replacement Radarr identity disappeared after handoff intent'),{code:'TDARR_HANDOFF_BINDING'});
   if(m.movieFileId&&m.movieFileId!==(c.keptMovieFileId||c.binding.movieFileId)){
    const rel=relative(m.movieFile.path,cfg.radarrRoot),s=await safeSource(rel);
    if(s.size!==m.movieFile.size)throw Error('Replacement file size does not match Radarr');
    if(c.status==='replacement_queue_intent'&&(rel!==c.replacementRelative||s.fp!==c.replacementSourceFP||m.movieFileId!==c.replacement?.movieFileId))throw Object.assign(Error('Replacement identity changed after handoff intent'),{code:'TDARR_HANDOFF_BINDING'});
    c.replacement={movieFileId:m.movieFileId,path:m.movieFile.path,size:m.movieFile.size};
    c.replacementRelative=rel;c.replacementSourceFP=s.fp;
    if(cfg.enabled===false){delete c.observationError;continue;} // Observe the import, but preserve the paused phase.
    const file=cfg.sourceRoot+'/'+rel;
    await phase(c,'replacement_queue_intent','Replacement imported; refreshing Tdarr entry');
    // A newer case may already have held this exact imported source after its
    // own confirmed failure. An older handoff must not release that protection.
    const preserveHold=preservesHold(state.cases,{id:c.id,file,sourceFP:s.fp,libraryId:cfg.libraryId});
    c.handoffStatus=await ensureHandoff({tdarr:td,file,libraryId:cfg.libraryId,preserveHold});
    await phase(c,'replacement_imported','Replacement submitted to Tdarr; quarantine retained until quality is verified');
   }
   delete c.observationError;
   } catch(e) {
    c.observationError=e.message;
    if(cfg.enabled!==false&&c.status==='replacement_queue_intent'&&['TDARR_HANDOFF_BINDING','TDARR_HANDOFF_STATE'].includes(e.code))await phase(c,'manual',e.message);
    // A temporarily unavailable replacement must not stop checks for other films.
   }
  }
 }
 // Resume frozen deferrals of one kind: reconcile an interrupted intent by reads, then continue the
 // existing repair with its frozen evidence once the kind's gate opens. One repair per poll.
 async function resumeDeferred(kind,eligible=()=>true){
  for(const c of Object.values(state.cases).filter(c=>[kind.deferred,kind.intent].includes(c.status)&&eligible(c))){
   if(!canStart())return;
   try{
    const deps={...adapters,c};
    if(c.status===kind.intent)await reconcileDeferredIntent(kind,deps);
    const result=await inspectDeferred(kind,deps);
    if(result.retryAt)c.nextRetryAt=result.retryAt;
    if(result.status==='ready'){await repair(c,{reuseConfirmedEvidence:true});return;}
    delete c.observationError;
   }catch(e){await phase(c,'manual',e.message);}
  }
 }
 async function ensureApprovedFloor(c,movie){
  if(c.profileId)throw Error('Previous profile mutation requires manual check');
  const original=await rad('/qualityprofile/'+movie.qualityProfileId),p=structuredClone(original);delete p.id;
  const quality=movie.movieFile.quality.quality,index=p.items.findIndex(v=>v.quality?.id===quality.id||v.items?.some(w=>w.quality?.id===quality.id));
  if(index<0||!p.items[index].allowed)throw Error('Current quality is not allowed in profile');
  for(let i=0;i<p.items.length;i++){const v=p.items[i];v.allowed=v.allowed&&i>=index;if(v.items?.length){for(const w of v.items)w.allowed=v.allowed&&w.allowed!==false&&w.quality.resolution>=quality.resolution;v.allowed=v.allowed&&v.items.some(w=>w.allowed);}else if(v.quality.resolution<quality.resolution)v.allowed=false;}
  if(!p.items.some(v=>v.allowed))throw Error('No equal or higher quality allowed');
  const formats=await rad('/customformat');for(const f of formats)if(!p.formatItems.some(v=>v.format===f.id))p.formatItems.push({format:f.id,name:f.name,score:0});
  const dual=formats.find(f=>f.name==='Review: Czech + English'&&f.specifications.length===2&&[1,25].every(id=>f.specifications.some(s=>s.implementation==='LanguageSpecification'&&s.required&&!s.negate&&s.fields.some(v=>v.name==='value'&&v.value===id))));
  if(dual){if(p.formatItems.reduce((sum,v)=>sum+Math.max(0,v.score),0)+100>=9000)throw Error('Language score could weaken exclusions');p.formatItems.find(v=>v.format===dual.id).score=100;}
  if(!p.items.some(v=>v.allowed&&(v.id===p.cutoff||v.quality?.id===p.cutoff)))p.cutoff=p.items[index].id||p.items[index].quality.id;
  p.name='Recovery same-or-higher '+movie.id+' '+Date.now();c.originalProfile=original;c.originalProfileId=original.id;await phase(c,'profile_intent','Restricting replacement to current quality or higher');const profile=await rad('/qualityprofile',p);if(!Number.isInteger(profile.id))throw Error('Profile creation uncertain');c.profileId=profile.id;await save();
  const fresh=await rad('/movie/'+movie.id);if(fresh.movieFileId!==c.approval.movieFileId||fresh.movieFile.size!==c.size)throw Error('Movie changed before profile update');fresh.qualityProfileId=profile.id;
  const r=await fetch(cfg.radarrUrl+'/api/v3/movie/'+movie.id,{method:'PUT',headers:{'Content-Type':'application/json','X-Api-Key':cfg.radarrApiKey},body:JSON.stringify(fresh),signal:AbortSignal.timeout(30000)});if(!r.ok||(await rad('/movie/'+movie.id)).qualityProfileId!==profile.id)throw Error('Profile update uncertain');
 }
 async function tick(){
  await publishNow(()=>liveStatus.refresh());
  if(!canStart())return;
  try{await refreshOriginalLanguages({cfg,rad,atomic});delete state.languageMetadataError;}catch(e){state.languageMetadataError=e.message;}
  if(!canStart())return;
  await maintainWaitingSources(adapters);
  if(!canStart())return;
  await observe();
  if(!canStart())return;
  await resumeDeferred(COOLDOWN);
  if(!canStart())return;
  // Historical frozen approvals wait in processPending instead.
  await resumeDeferred(DAILY_LIMIT,c=>c.approval==null);
  if(!canStart())return;
  await processPending({...adapters,approvals:pendingApprovals,caseId,repair});
  if(!canStart())return;
  await publishNow(()=>liveStatus.refresh());
  for(const c of Object.values(state.cases).filter(c=>c.status==='replacement_imported'&&cfg.enabled!==false)){if(!canStart())return;try{await retainCase(c,{mediaRoot:cfg.mediaRoot,quarantineRoot:cfg.quarantineRoot,atomicCase:save});delete c.retentionError;}catch(e){c.retentionError=e.message;}}
  // Catch these files even when Tdarr has silently classified them Not required.
  if(cfg.detectTerminalHeaders){
   for(const f of rows('filejsondb').filter(f=>f.DB===cfg.libraryId&&['Queued','Not required','Transcode error','Hold'].includes(f.TranscodeDecisionMaker)&&String(f._id).toLowerCase().endsWith('.mkv'))){
    if(!canStart())return;
    let c;
    try{
     const rel=relative(f._id,cfg.sourceRoot),s=await safeSource(rel),id=caseId(f._id,s.fp);
    if(Object.values(state.cases).some(c=>c.skipCurrentEdition&&c.file===f._id&&c.preservedSourceFP===s.fp))continue;
     if(state.cases[id])continue;
     if(await readHeader(s.p)!=='terminal_overwrite')continue;
     c=state.cases[id]||{id,file:f._id,relative:rel,source:s.p,size:s.size,fp:s.fp,headerDamage:true,created:new Date().toISOString()};state.cases[id]=c;
     await phase(c,'candidate','Terminal control bytes overwrite original MKV header');await repair(c);
    }catch(e){if(c)await phase(c,'manual',e.message);}
    if(c){await save();return;}
   }
  }
  const jobs=rows('jobsjsondb').filter(j=>j.DB===cfg.libraryId&&j.end&&/error/i.test(j.status)&&j.end>=cfg.since).sort((a,b)=>b.end-a.end);
  const all=rows('jobsjsondb');let inspected=0;
  // Persist rotation even for unreadable reports: retention must not starve older jobs.
  const previous=jobs.findIndex(j=>j._id===state.reportScanCursor),scanJobs=[...jobs.slice(previous+1),...jobs.slice(0,previous+1)];
  for(const j of scanJobs){
   if(!canStart())return;
   // Reconsider previously unrecognized reports once after extending the
   // decoder allowlist. Never reopen an existing case or a manual decision.
   if(state.jobs[j._id]&&!['not_structural_decode_error','not_confirmed_decode_error_v2','not_confirmed_decode_error_v3','not_confirmed_decode_error_v4'].includes(state.jobs[j._id]))continue;
   if(all.some(k=>k.file===j.file&&k.start>j.start)){state.jobs[j._id]='superseded';continue;}
   if(inspected++>=100)break;
   state.reportScanCursor=j._id;
   let report;
   try{report=await fs.readFile(within(cfg.reports,j.job.footprintId+'/'+j.job.fileId),'utf8');}catch{continue;}
   const discoveryKind=originalFailureReport(report);
   if(!discoveryKind){state.jobs[j._id]='not_confirmed_decode_error_v5';continue;}
   let c;
   try{
    const rel=relative(j.file,cfg.sourceRoot),s=await safeSource(rel),id=caseId(j.file,s.fp);
    if(Object.values(state.cases).some(c=>c.skipCurrentEdition&&c.file===j.file&&c.preservedSourceFP===s.fp))continue;
    state.jobs[j._id]=id;
    if(state.cases[id])continue;
    c=state.cases[id]={id,discoveryKind,jobId:j._id,file:j.file,relative:rel,source:s.p,size:s.size,fp:s.fp,created:new Date().toISOString()};
    await phase(c,'candidate','Tdarr decoder error candidate');await repair(c);
   }catch(e){if(c)await phase(c,'manual',e.message);else state.jobs[j._id]='manual: '+e.message;}
   await save();return; // One heavy original check at a time.
  }
  await save();
 }
 // Never replay uncertain API mutations after restart. The journal stays reviewable.
 async function markInterrupted(){
  for(const c of Object.values(state.cases))if(!['manual','no_action','dry_run','waiting_replacement','waiting_source_kept','replacement_imported','replacement_queue_intent','deferred_limit','defer_limit_intent','deferred_cooldown','defer_cooldown_intent'].includes(c.status))await phase(c,'manual','Interrupted '+c.status+'; inspect journal before any retry');
 }
 // Edits to config.json apply only after a restart; report them instead of applying them mid-case.
 // The same gate as start-up: an edit that the mode or the approval registry would refuse is reported invalid.
 const validateEditedConfig=startupValidator({data,mode,getState:()=>state});
 async function noteConfigChange(){
   if(managed){
    let change=null;
    try{const current=await readRuntimeRecoveryConfig({data,mode,checkActivation:false});if(configDigest(current.text)!==loadedConfigDigest){await loadApprovalRegistry({data,cfg:current.cfg,state:structuredClone(state)});change={detectedAt:state.configChange?.detectedAt||new Date().toISOString(),restartRequired:true,valid:true,error:null};}}
    catch{change={detectedAt:state.configChange?.detectedAt||new Date().toISOString(),restartRequired:true,valid:false,error:'Managed settings would not pass startup checks'};}
    if(change)state.configChange=change;else delete state.configChange;return;
   }
   const change=await detectConfigChange({file:configFile,loadedDigest:loadedConfigDigest,previous:state.configChange,validate:validateEditedConfig});
   if(change&&change!==state.configChange)console.error('Recovery: config.json changed since start-up; restart the worker to apply it'+(change.valid?'':' after fixing it ('+change.error+')'));
   if(change)state.configChange=change;else delete state.configChange;
 }
 const refresh=()=>publishNow(()=>liveStatus.refresh()),close=()=>publishNow(()=>liveStatus.close());
 return {state,tick,markInterrupted,noteConfigChange,save,refresh,close};
}
