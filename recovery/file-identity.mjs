// File identity (GLOSSARY.md): device, inode, size and modification times of a plain
// fs.Stats. The bytes are frozen: journals, Recovery state, approval evidence and the
// frozen registry store them, and Recovery case IDs are hashed from them.

/** @param {{dev:number,ino:number,size:number,mtimeMs:number,ctimeMs:number}} stat */
export const identityOf=stat=>[stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');

// Each field must be exactly the text String() writes for a finite number, so equal
// text means equal numbers and nothing malformed can look like a match.
/** @param {unknown} value */
function fields(value){
 if(typeof value!=='string')return null;
 const parts=value.split(':');
 return parts.length===5&&parts.every(x=>Number.isFinite(Number(x))&&String(Number(x))===x)?parts:null;
}

/**
 * Names how a recorded identity differs from a current one. Only a lone ctime or device
 * change is named, and a remount (ADR 0002): Unraid's user share gives every file a new
 * inode (and device) number after a reboot while its size and modification time stay, so a
 * changed inode or device with the same size and modification time is 'remounted', or
 * 'remounted-ctime-changed' when the ctime changed too. Any other difference is 'different'.
 * An unreadable identity on either side is 'invalid' and never a match. Callers decide which
 * named change they accept; a caller that accepts a remount confirms the content first where
 * a content sample was recorded (recovery/content-sample.mjs).
 * @param {unknown} stored
 * @param {unknown} current
 * @returns {'same'|'ctime-changed'|'device-changed'|'remounted'|'remounted-ctime-changed'|'different'|'invalid'}
 */
export function compareIdentity(stored,current){
 const a=fields(stored),b=fields(current);
 if(!a||!b)return 'invalid';
 const changed=a.flatMap((x,i)=>x===b[i]?[]:[i]);
 if(!changed.length)return 'same';
 if(changed.length===1&&changed[0]===4)return 'ctime-changed';
 if(changed.length===1&&changed[0]===0)return 'device-changed';
 if(!changed.includes(2)&&!changed.includes(3)&&(changed.includes(0)||changed.includes(1)))return changed.includes(4)?'remounted-ctime-changed':'remounted';
 return 'different';
}
/** Changes that keep size and modification time and differ only in where the file system numbers it (ADR 0002). */
export const REMOUNT_CHANGES=Object.freeze(['device-changed','remounted']);
