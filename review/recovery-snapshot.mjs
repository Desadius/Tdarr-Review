// @ts-check
import fs from 'node:fs/promises';
import path from 'node:path';

// Review's one read-only view of Recovery's files. Each reader gives one verdict for a file: absent,
// valid (with its content) or invalid (with a value-free reason), and every Review consumer (health,
// the replacement overview and handoff, the runtime route) projects from it. Review never writes them.

/** The shared status file Recovery publishes beside the media root. */
export const recoveryStatusFile=mediaRoot=>path.join(path.dirname(mediaRoot),'.tdarr-recovery-status.json');
const STATUS_LIMIT=2000000,STATE_LIMIT=64*1024*1024;
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);

// A regular file (not a symlink) within the size limit, parsed as JSON; or absent, or why it is neither.
async function readJson(file,limit,label){
 let st;
 try{st=await fs.lstat(file);}catch(e){if(e.code==='ENOENT')return {present:false};return {present:true,error:label+' file '+(e.code||'error')};}
 if(!st.isFile()||st.isSymbolicLink()||st.size>limit)return {present:true,error:'invalid '+label+' file'};
 try{return {present:true,value:JSON.parse(await fs.readFile(file,'utf8'))};}
 catch(e){return {present:true,error:e instanceof SyntaxError?'unreadable '+label+' file':label+' file '+(e.code||'error')};}
}

/**
 * The shared status file: valid only as a JSON object with version 1, a cases list and a readable update time.
 * @returns {Promise<{present:false}|{present:true,status:any}|{present:true,error:string}>}
 */
export async function readRecoveryStatus(file){
 const read=await readJson(file,STATUS_LIMIT,'status');
 if(!read.present)return {present:false};
 if(read.error)return {present:true,error:read.error};
 const v=read.value;
 if(!object(v)||v.version!==1||!Array.isArray(v.cases))return {present:true,error:'unsupported status file'};
 if(!Number.isFinite(Date.parse(v.updated)))return {present:true,error:'missing update time'};
 return {present:true,status:v};
}

/**
 * Recovery's private case state, read-only: valid only as a JSON object with a cases object.
 * @returns {Promise<{present:false}|{present:true,cases:Record<string,any>}|{present:true,error:string}>}
 */
export async function readRecoveryCaseState(file){
 const read=await readJson(file,STATE_LIMIT,'state');
 if(!read.present)return {present:false};
 if(read.error)return {present:true,error:read.error};
 return object(read.value)&&object(read.value.cases)?{present:true,cases:read.value.cases}:{present:true,error:'unsupported state file'};
}

const MODES=new Set(['off','verify','repair','invalid']);
const STATES=new Set(['off','running','restarting','refused','stopped']);
const FIELDS=['version','mode','state','restarts','lastExitCode','lastExitSignal','lastStartedAt','lastExitedAt','reason','updated'];
const time=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));
const unreadable=()=>({present:true,state:'unreadable',reason:null});

// The same bounded, allowlisted snapshot feeds the health log and authenticated UI.
// State changes drive this snapshot, not a heartbeat: a long-running worker is not stale.
export async function readRecoveryRuntime(file){
 try{
  const st=await fs.lstat(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size>16384)return unreadable();
  const v=JSON.parse(await fs.readFile(file,'utf8'));
  if(!v||v.version!==1||!MODES.has(v.mode)||!STATES.has(v.state)||!Number.isSafeInteger(v.restarts)||v.restarts<0||
   !(v.lastExitCode===null||Number.isInteger(v.lastExitCode)&&v.lastExitCode>=0&&v.lastExitCode<=255)||
   !(v.lastExitSignal===null||typeof v.lastExitSignal==='string'&&/^SIG[A-Z0-9]{1,16}$/.test(v.lastExitSignal))||
   !(v.lastStartedAt===null||time(v.lastStartedAt))||!(v.lastExitedAt===null||time(v.lastExitedAt))||!time(v.updated)||
   !(v.reason===null||typeof v.reason==='string'&&/^[a-z0-9-]{1,64}$/.test(v.reason)))return unreadable();
  return {present:true,...Object.fromEntries(FIELDS.map(key=>[key,v[key]]))};
 }catch(e){
  if(e.code==='ENOENT')return {present:false,mode:'off',state:'off',reason:null};
  return unreadable();
 }
}
