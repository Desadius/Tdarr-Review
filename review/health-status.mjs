import fs from 'node:fs/promises';
import {RECOVERY_STALE_MS,originalOutsideTooLong} from './public/review-model.js';

// Loopback-only operational summary for the container health check. It reports
// conditions that need an operator; it never fails the check because of them,
// so a restart policy cannot interrupt a pending transaction or node restore.
const LOOPBACK=new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);
export const isLoopback=address=>LOOPBACK.has(address);

export async function recoveryStatusHealth(file,now=Date.now()){
 try{
  const st=await fs.lstat(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size>2000000)return {present:true,stale:true,error:'invalid status file'};
  const status=JSON.parse(await fs.readFile(file,'utf8')),updated=Date.parse(status?.updated);
  if(!Number.isFinite(updated))return {present:true,stale:true,error:'missing update time'};
  const stale=now-updated>RECOVERY_STALE_MS;
  // Only a fresh status is evidence; a stale one is covered by recovery-status-stale. A count, never titles.
  const originalsOutsideLibrary=stale||!Array.isArray(status.cases)?0:status.cases.filter(c=>originalOutsideTooLong(c,now)).length;
  return {present:true,updated:new Date(updated).toISOString(),stale,originalsOutsideLibrary};
 }catch(e){
  if(e.code==='ENOENT')return {present:false,stale:false};
  return {present:true,stale:true,error:e instanceof SyntaxError?'unreadable status file':'status file '+(e.code||'error')};
 }
}

export function healthSummary({pendingTransactions,restorePending,recoveryStatus,recoveryRuntime}){
 const attention=[];
 if(pendingTransactions)attention.push('pending-transaction');
 if(restorePending)attention.push('node-restore-pending');
 if(recoveryStatus.present&&recoveryStatus.stale)attention.push('recovery-status-stale');
 if(recoveryStatus.present&&!recoveryStatus.stale&&recoveryStatus.originalsOutsideLibrary>0)attention.push('recovery-original-outside-library');
 if(recoveryRuntime?.state==='refused')attention.push('recovery-refused');
 if(recoveryRuntime?.reason==='crash-loop')attention.push('recovery-crash-loop');
 if(recoveryRuntime?.state==='unreadable')attention.push('recovery-runtime-unreadable');
 return {ok:true,attention,pendingTransactions,restorePending,recoveryStatus,...(recoveryRuntime?{recoveryRuntime}: {})};
}
