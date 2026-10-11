import fs from 'node:fs/promises';
import path from 'node:path';
export function rejectionReason(value){
  if(typeof value!=='string'||!value.trim())throw new Error('Uveď důvod zamítnutí.');
  const reason=value.trim();
  if(reason.length>1000)throw new Error('Důvod zamítnutí může mít nejvýše 1000 znaků.');
  if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(reason))throw new Error('Důvod obsahuje nepovolené řídicí znaky.');
  return reason;
}
export async function recordRejection(data,record){
  const file=await fs.open(path.join(data,'rejection-decisions.jsonl'),'a',0o600);
  try{await file.writeFile(JSON.stringify({...record,time:record.time||new Date().toISOString()})+'\n');await file.sync();}
  finally{await file.close();}
}
