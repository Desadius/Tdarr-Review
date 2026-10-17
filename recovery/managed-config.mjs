import fs from 'node:fs/promises';
import path from 'node:path';
import {resolveMode,applyMode,readRecoveryConfig,RecoveryRefusal} from './recovery-mode.mjs';

// Source and packaged image have different fixed Review directory names. Resolve before import;
// an import/schema failure never selects an unrelated authority.
const source=new URL('../review/shared-settings.mjs',import.meta.url);
const available=await fs.access(source).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
const moduleUrl=available?source:new URL('../review-app/shared-settings.mjs',import.meta.url);
const {readActiveSettings}=await import(moduleUrl.href);
const {readSettingsActivation}=await import(new URL('./settings-activation.mjs',moduleUrl).href);

export async function readRuntimeRecoveryConfig({data,mode,checkActivation=true,activationId=process.env.RECOVERY_ACTIVATION_ID}){
 mode=resolveMode(mode);
 const root=path.dirname(data);
 if(checkActivation){const marker=await readSettingsActivation(root);if(marker?.blocking&&!(marker.id===activationId&&marker.state==='starting'))throw new RecoveryRefusal('invalid-config','settings activation requires explicit Apply');}
 let active;
 try{active=await readActiveSettings(root,{mode});}catch{throw new RecoveryRefusal('invalid-config','managed settings or private authority is invalid');}
 if(active){const cfg=applyMode(active.recovery,mode);return {mode,cfg,managed:true,generation:active.generation,text:JSON.stringify({generation:active.generation,cfg})};}
 return {...await readRecoveryConfig({file:path.join(data,'config.json'),mode}),managed:false};
}
