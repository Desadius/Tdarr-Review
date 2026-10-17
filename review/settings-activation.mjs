import fs from 'node:fs/promises';
import path from 'node:path';
import {atomicJSON} from './core.mjs';

const STATES=['waiting','draining','validating','stopping','committing','starting','succeeded','failed','cancelled','interrupted'];
export const ACTIVATION_FILE='settings-activation.json';
export function settingsPublicOrigin(value){try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'?u.origin:undefined;}catch{return undefined;}}
// This is an interruption fence, never a persistent command. Unknown/corrupt fences refuse startup.
export async function readSettingsActivation(data){
 try{
  const file=path.join(data,ACTIVATION_FILE),st=await fs.lstat(file);
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size>16384)throw Error();
  const value=JSON.parse(await fs.readFile(file,'utf8'));
  if(value.version!==1||!STATES.includes(value.state)||typeof value.blocking!=='boolean'||typeof value.id!=='string'||!/^[a-zA-Z0-9-]{1,64}$/.test(value.id))throw Error();
  const failure=typeof value.error==='string'?{code:value.error}:value.error;
  return {version:1,id:value.id,state:value.state,stage:value.state,blocking:value.blocking,generation:Number.isSafeInteger(value.generation)?value.generation:null,updated:typeof value.updated==='string'?value.updated:null,...(failure&&/^[a-z_]+$/.test(failure.code)?{error:{code:failure.code,...(typeof failure.field==='string'&&/^[A-Za-z.]+$/.test(failure.field)?{field:failure.field}:{})}}:{}),...(settingsPublicOrigin(value.publicOrigin)?{publicOrigin:settingsPublicOrigin(value.publicOrigin)}:{})};
 }catch(e){if(e.code==='ENOENT')return null;return {version:1,id:'invalid',state:'interrupted',stage:'interrupted',blocking:true,generation:null,error:{code:'settings_activation_invalid'},updated:null};}
}
export async function writeSettingsActivation(data,value){await fs.mkdir(data,{recursive:true});await atomicJSON(path.join(data,ACTIVATION_FILE),{version:1,...value});}
