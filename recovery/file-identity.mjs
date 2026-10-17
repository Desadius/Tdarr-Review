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
 * change is named; any other difference is 'different'. An unreadable identity on either
 * side is 'invalid' and never a match. Callers decide which named change they accept.
 * @param {unknown} stored
 * @param {unknown} current
 * @returns {'same'|'ctime-changed'|'device-changed'|'different'|'invalid'}
 */
export function compareIdentity(stored,current){
 const a=fields(stored),b=fields(current);
 if(!a||!b)return 'invalid';
 const changed=a.flatMap((x,i)=>x===b[i]?[]:[i]);
 if(!changed.length)return 'same';
 if(changed.length===1&&changed[0]===4)return 'ctime-changed';
 if(changed.length===1&&changed[0]===0)return 'device-changed';
 return 'different';
}
