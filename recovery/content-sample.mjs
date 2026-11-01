import fs from 'node:fs/promises';
import crypto from 'node:crypto';

// Content sample of a film file: SHA-256 over 1 MiB at the start, the middle and the end. Recovery records it as
// evidence of a confirmed original (sampleSHA256), and approval evidence records it for the installed copy (ADR 0002).
// Its bytes are frozen: a recorded sample must keep matching the same content.
export async function contentSample(file){
 const h=await fs.open(file,'r');
 try{
  const s=await h.stat();const sum=crypto.createHash('sha256');
  for(const position of [0,Math.max(0,Math.floor(s.size/2)-524288),Math.max(0,s.size-1048576)]){const b=Buffer.alloc(Math.min(s.size,1048576));const n=await h.read(b,0,b.length,position);if(n.bytesRead!==b.length)throw Error('Short source read');sum.update(b);}
  return sum.digest('hex');
 }finally{await h.close();}
}

/**
 * Whether a remounted file is the recorded one (ADR 0002): its content sample must match when one was recorded. A
 * record made before samples were kept is accepted by the unchanged size and modification time alone.
 * @param {string} file
 * @param {string|null|undefined} sample The recorded content sample, if any.
 */
export async function remountedContentMatches(file,sample){
 if(typeof sample!=='string'||!sample)return true;
 try{return await contentSample(file)===sample;}catch{return false;}
}
