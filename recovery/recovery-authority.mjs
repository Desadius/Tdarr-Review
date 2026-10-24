import fs from 'node:fs/promises';
import path from 'node:path';
import {resolveMode,applyMode,readRecoveryConfig,resolveRecoveryConfig,resolveRecoveryRestoreBinding,RecoveryRefusal} from './recovery-mode.mjs';
import {loadApprovalRegistry} from './approval-registry.mjs';
import {frozenConfigDifference} from './frozen-config.mjs';

// Recovery authority: the one answer to "with which configuration and approvals may Recovery run, or
// why not". Every reader of Recovery's configuration and approval registry asks here (docs/ARCHITECTURE.md,
// "Readers of config.json and the approval registry"), so none accepts what another refuses.
// Refusals are RecoveryRefusal reasons and never contain configuration values.

// The documented pre-update check reads a config.json text on its own, without a data directory.
export {resolveRecoveryConfig};

/** Review-owned durable admission fence. Any present or unreadable fence keeps a child out. */
export async function readRecoveryRestoreFence({data}={}){
 const file=path.join(data,'recovery-restore-fence.json');
 try{
  const stat=await fs.lstat(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>16384)return {present:true,valid:false};
  const value=JSON.parse(await fs.readFile(file,'utf8'));
  if(!value||value.version!==1||value.kind!=='recovery-original-restore'||typeof value.operationId!=='string'||!/^[-a-f0-9]{36}$/.test(value.operationId)||typeof value.caseId!=='string'||!/^[a-f0-9]{24}$/.test(value.caseId)||value.blocking!==true||value.restartAuthorized!==undefined&&typeof value.restartAuthorized!=='boolean')return {present:true,valid:false};
  return {present:true,valid:true,operationId:value.operationId,caseId:value.caseId,restartAuthorized:value.restartAuthorized===true};
 }catch(error){return error?.code==='ENOENT'?{present:false}:{present:true,valid:false};}
}

// Review's managed-settings modules. "#review/*" is mapped by the nearest package.json: the repository's
// to review/, the image's to /review-app/. Loaded only for a managed read, so a check of a lone
// config.json needs nothing but this directory.
const reviewModule=name=>import('#review/'+name);

/** The configuration Recovery runs with: the active managed generation when there is one, otherwise config.json. */
export async function readRecoveryConfiguration({data,mode,checkActivation=true,activationId=process.env.RECOVERY_ACTIVATION_ID,restoreOperationId=process.env.RECOVERY_RESTORE_OPERATION_ID}){
 mode=resolveMode(mode);
 const root=path.dirname(data);
 const restoreFence=await readRecoveryRestoreFence({data:root});
 if(restoreFence.present&&!(restoreFence.valid&&restoreFence.restartAuthorized&&restoreOperationId===restoreFence.operationId))throw new RecoveryRefusal(restoreFence.valid?'recovery-restore-pending':'recovery-restore-fence-invalid','Review is restoring a preserved original');
 if(checkActivation){const {readSettingsActivation}=await reviewModule('settings-activation.mjs');const marker=await readSettingsActivation(root);if(marker?.blocking&&!(marker.id===activationId&&marker.state==='starting'))throw new RecoveryRefusal('invalid-config','settings activation requires explicit Apply');}
 let active;
 try{const {readActiveSettings}=await reviewModule('shared-settings.mjs');active=await readActiveSettings(root,{mode});}catch{throw new RecoveryRefusal('invalid-config','managed settings or private authority is invalid');}
 if(active){const cfg=applyMode(active.recovery,mode);return {mode,cfg,managed:true,generation:active.generation,text:JSON.stringify({generation:active.generation,cfg})};}
 return {...await readRecoveryConfig({file:path.join(data,'config.json'),mode}),managed:false};
}

/**
 * Read only the effective path/instance binding needed to assess an explicit restore of a
 * recorded original. Unlike the worker configuration, this projection is available in Off
 * mode, validates enabled:false and never grants Recovery runtime or approval authority.
 */
export async function readRecoveryRestoreBinding({data,mode=process.env.RECOVERY_MODE||'off',checkActivation=true}={}){
 if(!['off','verify','repair'].includes(mode))throw new RecoveryRefusal('invalid-mode');
 const root=path.dirname(data);
 if(checkActivation){
  const {readSettingsActivation}=await reviewModule('settings-activation.mjs');
  const marker=await readSettingsActivation(root);
  if(marker?.blocking)throw new RecoveryRefusal('invalid-config','settings activation requires explicit Apply');
 }
 let active;
 try{const {readActiveSettings}=await reviewModule('shared-settings.mjs');active=await readActiveSettings(root,{mode});}
 catch{throw new RecoveryRefusal('invalid-config','managed settings or private authority is invalid');}
 if(active){
  const cfg=active.recovery;
  return {mode,managed:true,generation:active.generation,binding:Object.fromEntries(['tdarrUrl','radarrUrl','radarrApiKey','libraryId','sourceRoot','radarrRoot','mediaRoot','reviewRoot','reviewPrefixes','quarantineRoot','database'].map(key=>[key,cfg[key]]))};
 }
 const file=path.join(data,'config.json');let stat,text;
 try{
  stat=await fs.lstat(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>2*1024*1024)throw new Error();
  text=await fs.readFile(file,'utf8');
 }catch(e){throw new RecoveryRefusal(e?.code==='ENOENT'?'missing-config':'unreadable-config');}
 try{return {mode,managed:false,generation:null,binding:resolveRecoveryRestoreBinding({mode,text})};}
 catch(e){if(e instanceof RecoveryRefusal)throw e;throw new RecoveryRefusal('invalid-config');}
}

/** The approval registry for this configuration and state, or the registry's own error (code RECOVERY_APPROVAL_REGISTRY). */
export function readRecoveryApprovals({data,cfg,state}){return loadApprovalRegistry({data,cfg,state});}

/** As readRecoveryApprovals, with a registry error as the registry-refused refusal the worker exits with. */
export async function authorizeRecoveryApprovals({data,cfg,state}){
 try{return await readRecoveryApprovals({data,cfg,state});}
 catch(e){if(e?.code==='RECOVERY_APPROVAL_REGISTRY')throw new RecoveryRefusal('registry-refused',e.message);throw e;}
}

/** Why an edited config.json would not pass the start-up checks (mode, then registry against a copy of the state), or null. */
export async function editedConfigProblem({data,mode,value,state}){
 try{await readRecoveryApprovals({data,cfg:applyMode(value,mode),state:structuredClone(state)});return null;}
 catch(e){return e instanceof RecoveryRefusal||e?.code==='RECOVERY_APPROVAL_REGISTRY'?e.message:'config.json would not pass the start-up checks';}
}

/**
 * For Review's settings Apply: whether a candidate configuration would be refused by the approval registry,
 * as {code:'frozen', field} (the first frozen key it does not satisfy), {code:'invalid'} or null. `registry` is
 * the registry file as Review read it (null when absent) and `state` Recovery's state (null when absent).
 * Without a registry the state alone can still refuse: a historical approval with no registry behind it.
 */
export async function recoveryApprovalProblem({data,cfg,registry,state}){
 if(registry){
  if(registry.version!==1||!registry.config||typeof registry.config!=='object'||Array.isArray(registry.config)||!Array.isArray(registry.cases))return {code:'invalid'};
  const field=frozenConfigDifference(registry.config,cfg);if(field)return {code:'frozen',field};
 }else if(!state)return null;
 try{await readRecoveryApprovals({data,cfg,state:state||{cases:{}}});return null;}catch{return {code:'invalid'};}
}
