import fs from 'node:fs/promises';
import crypto from 'node:crypto';

// The worker applies config.json only at start-up. This detects a later edit so the
// status file and log can say a restart is required; it never applies the new values.
export const configDigest=text=>crypto.createHash('sha256').update(text).digest('hex');

export function checkConfigText(text){
 try{const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))return 'config.json must contain a JSON object';return null;}
 catch{return 'config.json is not valid JSON';}
}

// Returns the configChange record for the current file: null while it matches the loaded
// configuration, otherwise when the change was first seen and whether it parses.
export async function detectConfigChange({file,loadedDigest,previous=null,now=new Date()}){
 let text;
 try{text=await fs.readFile(file,'utf8');}
 catch(e){return describe(previous,'missing:'+e.code,'config.json cannot be read: '+e.code,now);}
 const digest=configDigest(text);
 if(digest===loadedDigest)return null;
 return describe(previous,digest,checkConfigText(text),now);
}
function describe(previous,digest,error,now){
 if(previous?.digest===digest)return previous;
 return {digest,detectedAt:now.toISOString(),restartRequired:true,valid:!error,error:error||null};
}
