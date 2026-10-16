import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {defaults,validate as validateReview} from './config.mjs';
import {configValueProblem} from '../recovery/config-values.mjs';
import {frozenConfigDifference,sameValue} from '../recovery/frozen-config.mjs';
import {loadApprovalRegistry} from '../recovery/approval-registry.mjs';

const FILE='shared-settings.json',MAX_BYTES=4*1024*1024,AUDIT_LIMIT=200;
const recoveryKeys=['sourceRoot','quarantineRoot','reports','stableMinutes','decodeTimeoutHours','fullSourceHash','confirmDelaySeconds','maxRepairsPerDay','movieCooldownDays','pollSeconds','detectTerminalHeaders','since'];
const radarrKeys=['url','apiKey','mediaRoot','quarantineRoot','preferCzechEnglish'];
const shared=['tdarrUrl','libraryId','mediaRoot','reviewRoot','reviewPrefixes','database','ffmpeg','ffprobe'];
const mappingKeys=['tdarrUrl','radarrUrl','libraryId','sourceRoot','mediaRoot','radarrRoot','quarantineRoot','reviewRoot','reviewPrefixes'];
const clone=structuredClone;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
function fail(code,field){throw Object.assign(Error(field?code+': '+field:code),{code,field,status:code==='settings_invalid'?400:409});}
function absolute(v){return typeof v==='string'&&v.length<=2048&&v.startsWith('/')&&v!=='/'&&!v.includes('\\')&&!v.includes('\0')&&path.posix.normalize(v)===v&&!v.endsWith('/');}
function endpoint(v,field,{empty=false}={}){
 if(empty&&v==='')return;
 if(typeof v!=='string'||v.length>2048)fail('settings_invalid',field);
 let u;try{u=new URL(v);}catch{fail('settings_invalid',field);}
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)fail('settings_invalid',field);
}
async function read(file){
 try{const s=await fs.lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>MAX_BYTES)fail('settings_file_unsafe');
  const text=await fs.readFile(file,'utf8');if(Buffer.byteLength(text)>MAX_BYTES)fail('settings_file_unsafe');
  let value;try{value=JSON.parse(text);}catch{fail('settings_file_invalid');}
  if(!object(value))fail('settings_file_invalid');return {value,digest:hash(text)};
 }catch(e){if(e.code==='ENOENT')return {value:null,digest:null};throw e;}
}
async function syncDirectory(directory){if(process.platform==='win32')return;const h=await fs.open(directory,'r');try{await h.sync();}finally{await h.close();}}
async function durable(file,value){
 const temporary=file+'.'+crypto.randomUUID()+'.tmp';let handle,renamed=false;
 try{handle=await fs.open(temporary,'wx',0o600);await handle.writeFile(JSON.stringify(value)+'\n');await handle.sync();await handle.close();handle=null;await fs.rename(temporary,file);renamed=true;await syncDirectory(path.dirname(file));}
 catch(e){if(renamed)fail('settings_commit_ambiguous');throw e;}
 finally{await handle?.close();await fs.rm(temporary,{force:true});}
}
function validateDocument(doc){
 if(!object(doc)||doc.version!==1||!object(doc.draft)||!Array.isArray(doc.audit)||!Array.isArray(doc.conflicts)||!object(doc.legacy)||typeof doc.historyExplicit!=='boolean'||!Number.isSafeInteger(doc.generation)||doc.generation<0||doc.active!==null&&!object(doc.active))fail('settings_file_invalid');
 if(doc.audit.length>AUDIT_LIMIT||doc.conflicts.some(k=>typeof k!=='string'))fail('settings_file_invalid');
}
function recoveryDefaults(review,now){return {sourceRoot:review.sourceRoots[0],quarantineRoot:path.posix.join(path.posix.dirname(review.mediaRoot),'.tdarr-corrupt'),reports:'/tdarr/JobReports',stableMinutes:10,decodeTimeoutHours:12,fullSourceHash:false,confirmDelaySeconds:30,maxRepairsPerDay:3,movieCooldownDays:30,pollSeconds:300,detectTerminalHeaders:true,since:now};}
function entries(value,keys){return Object.fromEntries(keys.filter(k=>Object.hasOwn(value,k)).map(k=>[k,clone(value[k])]));}
function privateFields(value){return Object.fromEntries(Object.entries(value||{}).filter(([k])=>!['enabled','radarrUrl','radarrApiKey','radarrRoot',...shared,...recoveryKeys].includes(k)));}
function initial(inputs,env,now){
 const previous=inputs.recovery.value||{},review=inputs.review.value||{...defaults(env),...entries(previous,shared),...(previous.sourceRoot?{sourceRoots:[previous.sourceRoot]}:{})};
 const radarr=inputs.radarr.value||{url:previous.radarrUrl||'',apiKey:previous.radarrApiKey||'',mediaRoot:previous.radarrRoot||review.mediaRoot,preferCzechEnglish:true};
 const recovery={...recoveryDefaults(review,now),...entries(previous,recoveryKeys)};
 const conflicts=[];
 if(inputs.review.value&&inputs.recovery.value){for(const k of shared)if(Object.hasOwn(previous,k)&&!sameValue(review[k],previous[k]))conflicts.push('review.'+k);
  if(previous.sourceRoot&&!review.sourceRoots.includes(previous.sourceRoot))conflicts.push('recovery.sourceRoot');}
 if(inputs.radarr.value&&inputs.recovery.value)for(const [k,r] of [['url','radarrUrl'],['apiKey','radarrApiKey'],['mediaRoot','radarrRoot']])if(Object.hasOwn(previous,r)&&!sameValue(radarr[k],previous[r]))conflicts.push('radarr.'+k);
 return {version:1,generation:0,active:null,draft:{review:clone(review),radarr:clone(radarr),recovery},conflicts,legacy:Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,v.digest])),historyExplicit:!!inputs.recovery.value,fileOnly:privateFields(previous),audit:[]};
}
// Resolved snapshots contain credentials and file-only exceptions; RECOVERY_MODE alone sets enabled.
export function resolveSharedSettings(draft,{mode='off',fileOnly={}}={}){
 return {review:clone(draft.review),radarr:clone(draft.radarr),recovery:{...clone(fileOnly),...entries(draft.review,shared),...clone(draft.recovery),radarrUrl:draft.radarr.url,radarrApiKey:draft.radarr.apiKey,radarrRoot:draft.radarr.mediaRoot,enabled:mode==='repair'}};
}
export function validateSharedSettings(draft,{complete=false,mode='off',fileOnly={},requireRecovery=false}={}){
 if(!object(draft)||Object.keys(draft).some(k=>!['review','radarr','recovery'].includes(k))||!['review','radarr','recovery'].every(k=>object(draft[k])))fail('settings_invalid');
 const review=clone(draft.review);try{validateReview(review);}catch{fail('settings_invalid','review');}
 for(const [section,keys] of [['radarr',radarrKeys],['recovery',recoveryKeys]])if(Object.keys(draft[section]).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(draft[section],k)))fail('settings_invalid',section);
 const {radarr,recovery}=draft;
 const required=complete&&(requireRecovery||['verify','repair'].includes(mode)),radarrConfigured=!!(radarr.url||radarr.apiKey);
 endpoint(radarr.url,'radarr.url',{empty:!complete||!required&&!radarrConfigured});
 if(typeof radarr.apiKey!=='string'||radarr.apiKey.length>2048||radarr.apiKey.includes('\0')||complete&&(required||radarrConfigured)&&!radarr.apiKey.trim())fail('settings_invalid','radarr.apiKey');
 if(typeof radarr.preferCzechEnglish!=='boolean')fail('settings_invalid','radarr.preferCzechEnglish');
 for(const [k,v] of [['radarr.mediaRoot',radarr.mediaRoot],['radarr.quarantineRoot',radarr.quarantineRoot],['recovery.sourceRoot',recovery.sourceRoot],['recovery.quarantineRoot',recovery.quarantineRoot],['recovery.reports',recovery.reports]])if(!absolute(v))fail('settings_invalid',k);
 if(!review.sourceRoots.includes(recovery.sourceRoot))fail('settings_invalid','recovery.sourceRoot');
 const root=review.mediaRoot;for(const q of [recovery.quarantineRoot,radarr.quarantineRoot])if(q===root||q.startsWith(root+'/')||root.startsWith(q+'/'))fail('settings_invalid','quarantineRoot');
 const resolved=resolveSharedSettings({...draft,review},{mode,fileOnly});
 const problem=configValueProblem({...resolved.recovery,libraryId:review.libraryId||(!required?'setup':review.libraryId),radarrUrl:radarr.url||(!required?'http://setup':radarr.url),radarrApiKey:radarr.apiKey||(!required?'setup':radarr.apiKey)});
 if(problem)fail('settings_invalid','recovery.'+problem.split(' ')[0]);
 for(const k of ['stableMinutes','movieCooldownDays','since'])if(resolved.recovery[k]>Number.MAX_SAFE_INTEGER)fail('settings_invalid','recovery.'+k);
 return resolved;
}
function visibleDraft(draft){const result={review:entries(draft.review,Object.keys(defaults({}))),radarr:entries(draft.radarr,radarrKeys),recovery:entries(draft.recovery,recoveryKeys)};delete result.radarr.apiKey;result.radarr.hasApiKey=!!draft.radarr.apiKey;return result;}
function changed(before,after){const fields=[];for(const section of ['review','radarr','recovery'])for(const key of new Set([...Object.keys(before?.[section]||{}),...Object.keys(after?.[section]||{})]))if(!sameValue(before?.[section]?.[key],after?.[section]?.[key]))fields.push(section+'.'+key);return fields;}
function auditEntry(doc,{action,result,fields=[],now}){doc.audit.push({at:new Date(now).toISOString(),action,result,fields,generation:doc.generation,revision:hash(JSON.stringify(doc.draft))});doc.audit=doc.audit.slice(-AUDIT_LIMIT);}

export function createSharedSettingsStore({data,env=process.env,now=Date.now}){
 const file=path.join(data,FILE),recoveryData=path.join(data,'recovery');
 async function inputs(){const [review,radarr,recovery]=await Promise.all([read(path.join(data,'settings.json')),read(path.join(data,'radarr.json')),read(path.join(recoveryData,'config.json'))]);return {review,radarr,recovery};}
 async function snapshot(){
  const [saved,legacy,registry]=await Promise.all([read(file),inputs(),read(path.join(recoveryData,'pending-approvals.json'))]);
  const doc=saved.value||initial(legacy,env,now());validateDocument(doc);
  doc.draft.radarr.quarantineRoot??=path.posix.join(path.posix.dirname(doc.draft.review.mediaRoot),'.tdarr-review-quarantine');
  const external=Object.keys(legacy).filter(k=>legacy[k].digest!==doc.legacy[k]);
  const revision=hash(JSON.stringify([saved.digest||doc,Object.fromEntries(Object.entries(legacy).map(([k,v])=>[k,v.digest])),registry.digest]));
  return {doc,revision,legacy,registry:registry.value,external};
 }
 async function lock(fn){
  await fs.mkdir(data,{recursive:true});const target=file+'.lock',prepared=target+'.'+crypto.randomUUID();
  // Install a complete owner record exclusively. A process crash cannot leave an ownerless lock.
  await fs.writeFile(prepared,JSON.stringify({pid:process.pid}),{flag:'wx',mode:0o600});
  try{for(let attempt=0;;attempt++){try{await fs.link(prepared,target);break;}catch(e){
    if(e.code!=='EEXIST')throw e;if(attempt)fail('settings_busy');
    let owner;try{owner=JSON.parse(await fs.readFile(target,'utf8'));}catch{fail('settings_lock_invalid');}
    if(!Number.isSafeInteger(owner.pid)||owner.pid<=0)fail('settings_lock_invalid');
    try{process.kill(owner.pid,0);fail('settings_busy');}catch(error){if(error.code!=='ESRCH')throw error;}
    await fs.unlink(target);
   }}
   try{return await fn();}finally{await fs.unlink(target);}
  }finally{await fs.rm(prepared,{force:true});}
 }
 async function guards(s,resolved,{pending=false}={}){
  if(s.registry){if(s.registry.version!==1||!object(s.registry.config)||!Array.isArray(s.registry.cases))fail('settings_registry_invalid');const field=frozenConfigDifference(s.registry.config,resolved.recovery);if(field)fail('settings_frozen',field);
   try{await loadApprovalRegistry({data:recoveryData,cfg:resolved.recovery,state:(await read(path.join(recoveryData,'state.json'))).value||{cases:{}}});}catch{fail('settings_registry_invalid');}}
  if(!pending)return;
  const old=s.doc.active?.recovery||s.legacy.recovery.value||resolveSharedSettings(initial(s.legacy,env,now()).draft).recovery;
  const recoveryChanged=mappingKeys.some(k=>!sameValue(old[k],resolved.recovery[k]));
  const state=recoveryChanged?(await read(path.join(recoveryData,'state.json'))).value:null;
  if(state&&(!object(state.cases)||Object.values(state.cases).some(c=>!object(c)||!['no_action','dry_run','replacement_imported'].includes(c.status)||c.status==='replacement_imported'&&c.cleanup?.complete!==true)))fail('settings_pending_cases');
  const before=s.doc.active||resolveSharedSettings(initial(s.legacy,env,now()).draft);
  const reviewChanged=['tdarrUrl','libraryId','sourceRoots','tdarrReviewRoot','mediaRoot','reviewRoot','reviewPrefixes'].some(k=>!sameValue(before.review[k],resolved.review[k]))||['url','mediaRoot','quarantineRoot'].some(k=>!sameValue(before.radarr[k],resolved.radarr[k]));
  if(!reviewChanged)return;
  let files;try{files=await fs.readdir(path.join(data,'radarr-replacements'));}catch(e){if(e.code!=='ENOENT')throw e;files=[];}
  for(const name of files.filter(n=>/^[a-f0-9]{24}\.json$/.test(n))){const c=(await read(path.join(data,'radarr-replacements',name))).value;if(!c||!['restored','imported'].includes(c.phase)||c.phase==='imported'&&c.cleanup?.complete!==true)fail('settings_pending_cases');}
 }
 function outward(s){return {revision:s.revision,managed:!!s.doc.active,generation:s.doc.generation,active:clone(s.doc.active),draft:clone(s.doc.draft),conflicts:[...s.doc.conflicts,...(s.external.length?['legacyFiles']:[])],historyUsesSetupTime:!s.doc.historyExplicit,requiresHistoryAcknowledgement:!!s.doc.historyExplicit&&s.doc.draft.recovery.since<(s.doc.active?.recovery.since??s.legacy.recovery.value?.since??s.doc.draft.recovery.since)};}
 async function current(){if(!(await read(file)).value)await lock(async()=>{if(!(await read(file)).value){const doc=initial(await inputs(),env,now());doc.draft.radarr.quarantineRoot??=path.posix.join(path.posix.dirname(doc.draft.review.mediaRoot),'.tdarr-review-quarantine');auditEntry(doc,{action:'create',result:'success',now:now()});await durable(file,doc);}});return outward(await snapshot());}
 async function publicSettings(){const value=await current(),s=await snapshot(),previous=s.legacy.recovery.value||{},migrationChoices=value.conflicts.map(field=>{const [section,key]=field.split('.'),legacyKey=section==='radarr'?({url:'radarrUrl',apiKey:'radarrApiKey',mediaRoot:'radarrRoot'}[key]):key;
  if(field==='legacyFiles')return {field};if(key==='apiKey')return {field,secret:true,hasSharedValue:!!value.draft.radarr.apiKey,hasRecoveryValue:!!previous.radarrApiKey};
  return {field,sharedValue:value.draft[section]?.[key],recoveryValue:previous[legacyKey]};});
  return {...value,migrationChoices,active:value.active?{review:clone(value.active.review),radarr:{...visibleDraft(value.active).radarr},recovery:entries(value.active.recovery,recoveryKeys)}:null,draft:visibleDraft(value.draft)};}
 function requireRecovery(s){return !!s.legacy.recovery.value||!!(s.doc.active?.review.libraryId&&s.doc.active?.radarr.url&&s.doc.active?.radarr.apiKey);}
 async function validate({revision,forApply=false,acknowledgeHistory=false}={}){const s=await snapshot();if(revision!==undefined&&revision!==s.revision)fail('settings_conflict');const c=outward(s);if(forApply&&c.conflicts.length)fail('settings_migration_conflict');if(forApply&&c.requiresHistoryAcknowledgement&&!acknowledgeHistory)fail('settings_history_acknowledgement');const result=validateSharedSettings(s.doc.draft,{complete:forApply,mode:env.RECOVERY_MODE,fileOnly:s.doc.fileOnly,requireRecovery:requireRecovery(s)});await guards(s,result,{pending:forApply});return result;}
 async function saveDraft({revision,patch,resolutions=[],acknowledgeHistory=false}){return lock(async()=>{
  const s=await snapshot();if(revision!==s.revision)fail('settings_conflict');if(!object(patch)||Object.keys(patch).some(k=>!['review','radarr','recovery'].includes(k))||Object.values(patch).some(v=>!object(v)))fail('settings_invalid');
  const before=clone(s.doc.draft),draft=clone(before);
  if(!Array.isArray(resolutions))fail('settings_invalid','resolutions');
  const resolvedFields=resolutions.map(decision=>typeof decision==='string'?decision:decision?.field);
  if(resolvedFields.some(k=>!outward(s).conflicts.includes(k)))fail('settings_invalid','resolutions');
  for(const decision of resolutions.filter(v=>typeof v!=='string')){
   if(!object(decision)||!['shared','recovery'].includes(decision.source)||Object.keys(decision).some(k=>!['field','source'].includes(k)))fail('settings_invalid','resolutions');
   if(decision.source==='recovery'){const [section,key]=decision.field.split('.'),legacyKey=section==='radarr'?({url:'radarrUrl',apiKey:'radarrApiKey',mediaRoot:'radarrRoot'}[key]):key;
    if(!Object.hasOwn(s.legacy.recovery.value||{},legacyKey)||!object(draft[section]))fail('settings_invalid','resolutions');draft[section][key]=clone(s.legacy.recovery.value[legacyKey]);}
  }
  if(resolvedFields.includes('legacyFiles'))s.doc.fileOnly=initial(s.legacy,env,now()).fileOnly;
  for(const section of Object.keys(patch))for(const [key,value] of Object.entries(patch[section])){if(section==='radarr'&&key==='apiKey'&&value==='')continue;draft[section][key]=clone(value);}
  const result=validateSharedSettings(draft,{mode:env.RECOVERY_MODE,fileOnly:s.doc.fileOnly});await guards(s,result);
  if(Object.hasOwn(patch.recovery||{},'since')&&patch.recovery.since!==before.recovery.since){const boundary=s.doc.active?.recovery.since??s.legacy.recovery.value?.since??now();if(draft.recovery.since<boundary&&!acknowledgeHistory)fail('settings_history_acknowledgement');s.doc.historyExplicit=true;}
  s.doc.draft=draft;s.doc.conflicts=s.doc.conflicts.filter(k=>!resolvedFields.includes(k));if(resolvedFields.includes('legacyFiles'))s.doc.legacy=Object.fromEntries(Object.entries(s.legacy).map(([k,v])=>[k,v.digest]));
  auditEntry(s.doc,{action:'save',result:'success',fields:changed(before,draft),now:now()});if((await snapshot()).revision!==revision)fail('settings_conflict');await durable(file,s.doc);return current();
 });}
 async function applyGeneration({revision,acknowledgeHistory=false}){return lock(async()=>{
  const s=await snapshot();if(revision!==s.revision)fail('settings_conflict');await validate({revision,forApply:true,acknowledgeHistory});
  const draft=clone(s.doc.draft);if(!s.doc.historyExplicit)draft.recovery.since=now();
  const resolved=validateSharedSettings(draft,{complete:true,mode:env.RECOVERY_MODE,fileOnly:s.doc.fileOnly,requireRecovery:requireRecovery(s)});await guards(s,resolved,{pending:true});
  s.doc.generation++;auditEntry(s.doc,{action:'apply',result:'success',fields:changed(s.doc.active,resolved),now:now()});s.doc.active=resolved;s.doc.draft=draft;s.doc.historyExplicit=true;s.doc.legacy=Object.fromEntries(Object.entries(s.legacy).map(([k,v])=>[k,v.digest]));if((await snapshot()).revision!==revision)fail('settings_conflict');await durable(file,s.doc);return current();
 });}
 async function audit(){return clone((await snapshot()).doc.audit);}
 async function recordOutcome({action,result}){if(!['apply','startup','cancel','save'].includes(action)||!['success','failure','interrupted','cancelled'].includes(result))fail('settings_invalid','audit');return lock(async()=>{const s=await snapshot();auditEntry(s.doc,{action,result,now:now()});await durable(file,s.doc);});}
 return {current,public:publicSettings,saveDraft,validate,applyGeneration,audit,recordOutcome};
}
// Recovery uses the strict default. Review/health use checkPrivate:false so the authenticated
// settings UI remains available to repair a revoked exception or newly incomplete integration.
// Neither reader falls back from corrupt authority to unrelated legacy configuration.
export async function readActiveSettings(data,{mode=process.env.RECOVERY_MODE,checkPrivate=true}={}){
 const saved=(await read(path.join(data,FILE))).value;if(!saved)return null;validateDocument(saved);if(!saved.active)return null;
 const active=clone(saved.active);active.recovery.enabled=mode==='repair';
 const fileOnly=privateFields(active.recovery),legacy=checkPrivate?(await read(path.join(data,'recovery','config.json'))).value:null;
 if(checkPrivate&&!sameValue(fileOnly,privateFields(legacy)))fail('settings_private_changed');
 const resolved=validateSharedSettings({review:active.review,radarr:active.radarr,recovery:entries(active.recovery,recoveryKeys)},{complete:checkPrivate,mode,fileOnly});
 if(!sameValue(active,resolved)||saved.generation<1)fail('settings_file_invalid');
 return {...active,generation:saved.generation};
}
