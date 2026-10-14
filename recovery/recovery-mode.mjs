import fs from 'node:fs/promises';

// RECOVERY_MODE is the only source of truth for the Recovery mode. The worker runs only in
// verify (confirm corrupted originals, change nothing outside Recovery) or repair (may act on
// a confirmed corruption). Anything else refuses start before any API contact (fail closed).
export const REFUSED_EXIT=78; // EX_CONFIG: a refusal, not a crash (docs/CONFIGURATION.md, Recovery mode).
const MODES=['verify','repair'];

const REASONS={
 'invalid-mode':'RECOVERY_MODE must be off, verify or repair, and the worker runs only in verify or repair',
 'mode-off':'RECOVERY_MODE is off; Recovery does not run',
 'mode-conflict':'enabled in config.json disagrees with RECOVERY_MODE; remove it or make it match',
 'missing-config':'config.json does not exist',
 'unreadable-config':'config.json exists but cannot be read; check its type and permissions',
 'invalid-config':'config.json must be a JSON object, and enabled, if present, true or false',
 'registry-refused':'the private approval registry does not match this configuration or state',
};

// The message and reason never contain configuration values or keys from config.json; a detail
// is only ever a rule text that is itself free of values (such as an approval registry error).
export class RecoveryRefusal extends Error{
 constructor(reason,detail){super('Recovery refused to start: '+REASONS[reason]+(detail?' ('+detail+')':''));this.name='RecoveryRefusal';this.reason=reason;}
}

export function resolveMode(mode){
 if(MODES.includes(mode))return mode;
 throw new RecoveryRefusal(mode==='off'?'mode-off':'invalid-mode');
}

// Returns the configuration the worker runs with. enabled is derived from the mode, so the
// modules that read cfg.enabled keep their meaning; a deprecated enabled key must match it.
export function applyMode(value,mode){return withMode(value,resolveMode(mode));}
function withMode(value,mode){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new RecoveryRefusal('invalid-config');
 const enabled=mode==='repair';
 if(Object.hasOwn(value,'enabled')){
  if(typeof value.enabled!=='boolean')throw new RecoveryRefusal('invalid-config');
  if(value.enabled!==enabled)throw new RecoveryRefusal('mode-conflict');
 }
 return {...value,enabled};
}
function parse(text){try{return JSON.parse(text);}catch{throw new RecoveryRefusal('invalid-config');}}

// The mode is always checked before the configuration.
export function resolveRecoveryConfig({mode,text}){
 mode=resolveMode(mode);
 return {mode,cfg:withMode(parse(text),mode)};
}

export async function readRecoveryConfig({file,mode}){
 mode=resolveMode(mode);
 let text;
 try{text=await fs.readFile(file,'utf8');}
 catch(e){throw new RecoveryRefusal(e?.code==='ENOENT'?'missing-config':'unreadable-config');}
 return {mode,cfg:withMode(parse(text),mode),text};
}

// Ends the process with the refusal contract: exit 78 and a last stderr line that names only the reason.
export function exitRefused(refusal){
 console.error(refusal.message);
 console.error('RECOVERY_REFUSED '+refusal.reason);
 process.exit(REFUSED_EXIT);
}
