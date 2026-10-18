import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {identityOf} from './file-identity.mjs';
function sizeAt(b,p){
 let width=1;while(width<=8&&!(b[p]&(128>>(width-1))))width++;
 if(width>8||p+width>b.length)return null;
 let size=BigInt(b[p]&((128>>(width-1))-1));for(let i=1;i<width;i++)size=(size<<8n)|BigInt(b[p+i]);
 if(size===(1n<<BigInt(7*width))-1n)return null;
 return {size,end:p+width};
}
export function finiteSegmentTruncated(prefix,physicalBytes){
 if(!Number.isSafeInteger(physicalBytes)||physicalBytes<=0||prefix.subarray(0,4).toString('hex')!=='1a45dfa3')return false;
 const ebml=sizeAt(prefix,4);if(!ebml||ebml.size>65536n)return false;
 const p=ebml.end+Number(ebml.size);if(prefix.subarray(p,p+4).toString('hex')!=='18538067')return false;
 const segment=sizeAt(prefix,p+4);return !!segment&&BigInt(segment.end)+segment.size>BigInt(physicalBytes);
}
export async function hasFiniteTruncation(file){
 let h;try{
  h=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);const before=await h.stat();if(!before.isFile()||before.nlink!==1)return false;
  const prefix=Buffer.alloc(Math.min(before.size,65536)),r=await h.read(prefix,0,prefix.length,0);
  if(r.bytesRead!==prefix.length||identityOf(before)!==identityOf(await h.stat())||identityOf(before)!==identityOf(await fs.lstat(file)))return false;
  return finiteSegmentTruncated(prefix,before.size);
 }catch{return false;}finally{await h?.close();}
}
