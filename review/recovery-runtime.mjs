// @ts-check
import fs from 'node:fs/promises';

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
