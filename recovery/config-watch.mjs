import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {editedConfigProblem} from './recovery-authority.mjs';

// The worker applies config.json only at start-up. This detects a later edit so the
// status file and log can say a restart is required; it never applies the new values.
export const configDigest=text=>crypto.createHash('sha256').update(text).digest('hex');

export function checkConfigText(text){
 try{const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))return 'config.json must contain a JSON object';return null;}
 catch{return 'config.json is not valid JSON';}
}

// Returns the configChange record for the current file: null while it matches the loaded
// configuration, otherwise when the change was first seen and whether the next start would
// accept it. validate(config) runs the worker's own start-up checks and resolves to an error
// text (never containing config values) or null; it runs once per distinct edit.
export async function detectConfigChange({file,loadedDigest,previous=null,now=new Date(),validate=null}){
 let text;
 try{text=await fs.readFile(file,'utf8');}
 catch(e){return describe(previous,'missing:'+e.code,'config.json cannot be read: '+e.code,now);}
 const digest=configDigest(text);
 if(digest===loadedDigest)return null;
 if(previous?.digest===digest)return previous;
 let error=checkConfigText(text);
 if(!error&&validate){try{error=await validate(JSON.parse(text))}catch{error='config.json cannot be checked against the start-up rules'}}
 return describe(previous,digest,error,now);
}
function describe(previous,digest,error,now){
 if(previous?.digest===digest)return previous;
 return {digest,detectedAt:now.toISOString(),restartRequired:true,valid:!error,error:error||null};
}

// The validate function for detectConfigChange: the same gate as start-up, first the Recovery mode
// (a conflicting enabled), then the approval registry against a copy of the live state.
export function startupValidator({data,mode,getState}){
 return value=>editedConfigProblem({data,mode,value,state:getState()});
}
