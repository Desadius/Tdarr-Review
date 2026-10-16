import fs from 'node:fs/promises';
import path from 'node:path';
import {constants} from 'node:fs';
export function rejectionReason(value){
  if(typeof value!=='string'||!value.trim())throw new Error('Uveď důvod zamítnutí.');
  const reason=value.trim();
  if(reason.length>1000)throw new Error('Důvod zamítnutí může mít nejvýše 1000 znaků.');
  if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(reason))throw new Error('Důvod obsahuje nepovolené řídicí znaky.');
  return reason;
}
const NOT_REGULAR='Archiv zamítnutí není běžný soubor.';
// Like the decision audit, the archive is only ever a regular file: the open itself refuses a
// symlink (O_NOFOLLOW), so no check-then-open window exists, and a named pipe without a reader fails at once
// instead of blocking the rejection (O_NONBLOCK; it has no effect on a regular file).
export async function recordRejection(data,record){
  let file;
  try{file=await fs.open(path.join(data,'rejection-decisions.jsonl'),constants.O_WRONLY|constants.O_APPEND|constants.O_CREAT|(constants.O_NOFOLLOW||0)|(constants.O_NONBLOCK||0),0o600);}
  catch(e){if(['ELOOP','EISDIR','ENXIO'].includes(e.code))throw Error(NOT_REGULAR);throw e;}
  try{
    // A pipe with a reader or a device node opens without error; only a regular file is written.
    if(!(await file.stat()).isFile())throw Error(NOT_REGULAR);
    await file.writeFile(JSON.stringify({...record,time:record.time||new Date().toISOString()})+'\n');await file.sync();
  }finally{await file.close();}
}
