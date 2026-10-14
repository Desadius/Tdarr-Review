import fs from 'node:fs/promises';

// RECOVERY_MODE is the only source of truth for the Recovery mode. The worker runs only in
// verify (confirm corrupted originals, change nothing outside Recovery) or repair (may act on
// a confirmed corruption). Anything else refuses start before any API contact (fail closed).
export const REFUSED_EXIT=78; // EX_CONFIG: a refusal, not a crash; see the supervisor contract.
export const MODES=['verify','repair'];

const REASONS={
 'invalid-mode':'RECOVERY_MODE must be verify or repair',
 'mode-off':'RECOVERY_MODE is off; Recovery does not run',
 'mode-conflict':'enabled in config.json disagrees with RECOVERY_MODE; remove it or make it match',
 'missing-config':'config.json does not exist',
 'invalid-config':'config.json must be a JSON object, and enabled, if present, true or false',
};

// The message and reason never contain configuration values or keys from config.json.
export class RecoveryRefusal extends Error{
 constructor(reason){super('Recovery refused to start: '+REASONS[reason]);this.name='RecoveryRefusal';this.reason=reason;}
}

export function resolveMode(mode){
 if(MODES.includes(mode))return mode;
 throw new RecoveryRefusal(mode==='off'?'mode-off':'invalid-mode');
}

// Returns the configuration the worker runs with. enabled is derived from the mode, so the
// modules that read cfg.enabled keep their meaning; a deprecated enabled key must match it.
export function applyMode(value,mode){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new RecoveryRefusal('invalid-config');
 const enabled=resolveMode(mode)==='repair';
 if(Object.hasOwn(value,'enabled')){
  if(typeof value.enabled!=='boolean')throw new RecoveryRefusal('invalid-config');
  if(value.enabled!==enabled)throw new RecoveryRefusal('mode-conflict');
 }
 return {...value,enabled};
}

export function resolveRecoveryConfig({mode,text}){
 mode=resolveMode(mode);
 let value;try{value=JSON.parse(text);}catch{throw new RecoveryRefusal('invalid-config');}
 return {mode,cfg:applyMode(value,mode)};
}

export async function readRecoveryConfig({file,mode}){
 resolveMode(mode);
 let text;
 try{text=await fs.readFile(file,'utf8');}
 catch(e){if(e.code==='ENOENT')throw new RecoveryRefusal('missing-config');throw e;}
 return {...resolveRecoveryConfig({mode,text}),text};
}

// Ends the process with the refusal contract: exit 78 and a last stderr line that names only the reason.
export function exitRefused(refusal){
 console.error(refusal.message);
 console.error('RECOVERY_REFUSED '+refusal.reason);
 process.exit(REFUSED_EXIT);
}
