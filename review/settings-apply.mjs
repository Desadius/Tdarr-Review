import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {checkPaths} from './config.mjs';
import {readActiveSettings} from './shared-settings.mjs';
import {readSettingsActivation,writeSettingsActivation,settingsPublicOrigin} from './settings-activation.mjs';
import {settingsError} from './settings-errors.mjs';
import {checkManualQuarantine} from './quarantine-path.mjs';

const error=code=>Object.assign(Error(code),{code,status:409});
const pause=()=>new Promise(resolve=>setTimeout(resolve,25));
async function quarantineDirectory(candidate,{create=false}={}){
 const target=candidate.recovery.quarantineRoot,parent=path.dirname(target),source=await fs.stat(candidate.review.mediaRoot);
 if(await fs.realpath(parent)!==parent||(await fs.lstat(parent)).isSymbolicLink()||!(await fs.stat(parent)).isDirectory()||(await fs.stat(parent)).dev!==source.dev)throw Error();
 await fs.access(parent,fs.constants.W_OK);
 let found;try{found=await fs.lstat(target);}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!found&&create){try{await fs.mkdir(target,{recursive:false,mode:0o770});}catch(e){if(e.code!=='EEXIST')throw e;}found=await fs.lstat(target);}
 if(found){if(!found.isDirectory()||found.isSymbolicLink()||await fs.realpath(target)!==target||found.dev!==source.dev||await fs.realpath(parent)!==parent)throw Error();await fs.access(target,fs.constants.R_OK|fs.constants.W_OK);}
}
// Read-only diagnostics: local metadata/access and remote GET/read-only collection queries only.
export async function diagnoseSettings(candidate,{readRows,mode}){
 try{await checkPaths(candidate.review);}catch{throw error('settings_paths_unavailable');}
 try{
  const response=await fetch(candidate.review.tdarrUrl+'/api/v2/get-nodes',{redirect:'error',signal:AbortSignal.timeout(12000)});
  const nodes=response.ok?await response.json():null;if(!nodes||typeof nodes!=='object'||Array.isArray(nodes))throw Error();
  const libraries=await readRows('librarysettingsjsondb',candidate.review);await readRows('jobsjsondb',candidate.review);
  const matches=libraries.filter(l=>(!candidate.review.libraryId||l._id===candidate.review.libraryId)&&candidate.review.sourceRoots.includes(String(l.folder).replace(/\/$/,'')));if(matches.length!==1)throw error('settings_library_unavailable');
 }catch(e){throw e.code==='settings_library_unavailable'?e:error('settings_tdarr_unavailable');}
 if(candidate.radarr.url){
  try{
   const get=async route=>{const r=await fetch(candidate.radarr.url+'/api/v3'+route,{redirect:'error',headers:{'X-Api-Key':candidate.radarr.apiKey},signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error();return r.json();};
   await get('/system/status');const movies=await get('/movie');
   if(!Array.isArray(movies)||!movies.some(m=>m.path===candidate.radarr.mediaRoot||m.path?.startsWith(candidate.radarr.mediaRoot+'/')))throw Error();
  }catch{throw error('settings_radarr_unavailable');}
  try{await checkManualQuarantine({mediaRoot:candidate.review.mediaRoot,quarantineRoot:candidate.radarr.quarantineRoot});}catch{throw error('settings_manual_quarantine_unavailable');}
 }
 if(['verify','repair'].includes(mode)){
  try{
   if(!(await fs.stat(candidate.recovery.reports)).isDirectory())throw Error();await fs.access(candidate.recovery.reports,fs.constants.R_OK);
   await quarantineDirectory(candidate);
  }catch{throw error('settings_recovery_paths_unavailable');}
 }
 return {ok:true};
}

export async function createSettingsApply({data,store,control,mode='off',safe,barrier,activate,readRows}){
 let state=await readSettingsActivation(data),cancelled=false,running=false;
 if(state&&['waiting','draining','validating','stopping','committing','starting'].includes(state.state)){
  state={...state,state:'interrupted',stage:'interrupted',error:{code:'settings_apply_interrupted'},updated:new Date().toISOString()};await writeSettingsActivation(data,state);
  await store.recordOutcome({action:'apply',result:'interrupted'});
 }
 const status=()=>state?{...state,...(running&&['succeeded','failed','cancelled'].includes(state.state)?{state:'finalizing',stage:'finalizing'}:{})}:{state:'idle'};
 const set=async(stage,extra={})=>{state={...state,...extra,state:stage,stage,updated:new Date().toISOString()};await writeSettingsActivation(data,state);};
 const assertLive=()=>{if(cancelled)throw error('settings_apply_cancelled');};
 async function test(input){if(typeof input.revision!=='string')throw error('settings_conflict');const candidate=await store.validate({...input,forApply:true});return diagnoseSettings(candidate,{readRows,mode});}
 async function execute(input){
  let stopped=false,committed=false,held=false,drained=false,workerStarted=false;
  try{
   let candidate=await store.validate({...input,forApply:true});await diagnoseSettings(candidate,{readRows,mode});assertLive();
   await set('draining');const drain=await control.requestDrain(state.id);drained=true;
   if(!['ready','off','draining'].includes(drain.state))throw error('settings_drain_failed');
   while(true){assertLive();const value=await control.status(state.id);if(['ready','off'].includes(value.state))break;if(value.state!=='draining')throw error('settings_drain_failed');await pause();}
   await set('waiting');while(!safe()){assertLive();await pause();}
   barrier(true);held=true;await set('validating');
   candidate=await store.validate({...input,forApply:true});await diagnoseSettings(candidate,{readRows,mode});assertLive();
   // Fence is durable before stopping. A process crash from this point cannot restart Recovery implicitly.
   await set('stopping',{blocking:true});await control.stopAfterDrain(state.id);stopped=true;
   await set('committing');const saved=await store.applyGeneration(input);committed=true;
   activate(saved.active);await set('committing',{generation:saved.generation,publicOrigin:saved.active.review.publicOrigin});
   await activate.flush();
   if(['verify','repair'].includes(mode)){try{await quarantineDirectory(saved.active,{create:true});}catch{throw error('settings_quarantine_setup_failed');}}
   await set('starting');await control.restart(state.id);
   const started=await control.wait(state.id);if(!['running','off'].includes(started.state))throw error('settings_start_failed');
   workerStarted=started.state==='running';
   await set('succeeded',{blocking:false});
   try{await store.recordOutcome({action:'startup',result:'success'});}catch{state={...state,auditError:'settings_audit_failed'};}
  }catch(e){
   if(workerStarted){
    // A failure clearing the durable fence must not report a running worker as stopped.
    // Drain the newly started worker through the same acknowledged protocol, without force-kill.
    try{const halt=randomUUID();await control.requestDrain(halt);const ready=await control.wait(halt);if(['ready','off'].includes(ready.state))await control.stopAfterDrain(halt);else throw Error();}
    catch{state={...state,workerState:'unknown'};}
   }
   if(e.code==='settings_commit_ambiguous'){
    // The rename may be authoritative despite a failed directory sync. Adopt exactly that generation;
    // leave the durable fence and worker stopped until another explicit Apply.
    try{const active=await readActiveSettings(data,{mode,checkPrivate:false});if(active){activate(active);await activate.flush();committed=true;}}catch{}
   }
   if(!stopped&&drained){try{if(state.blocking){await control.stopAfterDrain(state.id);stopped=true;}else await control.cancel(state.id);}catch{}}
   const failure=settingsError(e);await set(cancelled&&!stopped?'cancelled':'failed',{blocking:stopped||committed||state.blocking,error:{code:failure.code,...(failure.field?{field:failure.field}:{})}});
   await store.recordOutcome({action:cancelled?'cancel':'apply',result:cancelled&&!stopped?'cancelled':'failure'});
  }finally{if(held)barrier(false);running=false;}
 }
 async function start(input){
  if(running)throw error('settings_apply_pending');
  running=true;cancelled=false;
  let value;try{value=await store.current();if(input.revision!==value.revision)throw error('settings_conflict');}catch(e){running=false;throw e;}
  state={version:1,id:randomUUID(),state:'validating',stage:'validating',blocking:!!state?.blocking,generation:value.generation,publicOrigin:settingsPublicOrigin(value.draft.review.publicOrigin),updated:new Date().toISOString()};
  try{await writeSettingsActivation(data,state);}catch(e){running=false;throw e;}
  void execute(input).catch(async()=>{running=false;barrier(false);state={...state,state:'failed',stage:'failed',blocking:true,error:{code:'settings_operation_failed'}};try{await writeSettingsActivation(data,state);}catch{}});
  return status();
 }
 async function cancel(id){if(!running||id!==state.id||!['waiting','draining','validating'].includes(state.state))throw error('settings_cancel_unavailable');cancelled=true;return {...status(),cancelling:true};}
 return {status,start,cancel,test,get busy(){return running}};
}
