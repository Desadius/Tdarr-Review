import fs from 'node:fs/promises';
export function classifyHeader(bytes){
 if(bytes.length<4)return 'short';
 if(bytes.subarray(0,4).equals(Buffer.from('1a45dfa3','hex')))return 'ebml';
 // Narrow signature observed in damaged originals; a renamed MP4 is not corruption.
 if(/^\x1b\[[0-9;]*[A-Za-z]/.test(bytes.toString('latin1')))return 'terminal_overwrite';
 return 'unknown';
}
export async function readHeader(file){const h=await fs.open(file,'r');try{const b=Buffer.alloc(64),r=await h.read(b,0,b.length,0);return classifyHeader(b.subarray(0,r.bytesRead));}finally{await h.close();}}
