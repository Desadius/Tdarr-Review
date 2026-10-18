import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import os from 'node:os';
import {crc32} from 'node:zlib';
import path from 'node:path';
import {identityOf} from '../recovery/file-identity.mjs';

const LIMIT=256*1024;
// Read bounded EBML headers, never scan packet payloads for a byte signature.
function element(b,p,end){
 const start=p,first=b[p];if(!first)return null;
 let idBytes=1;while(idBytes<=4&&!(first&(128>>(idBytes-1))))idBytes++;
 if(idBytes>4||p+idBytes>=end)return null;
 const id=b.subarray(p,p+idBytes).toString('hex');p+=idBytes;
 let sizeBytes=1;while(sizeBytes<=8&&!(b[p]&(128>>(sizeBytes-1))))sizeBytes++;
 if(sizeBytes>8||p+sizeBytes>end)return null;
 let size=BigInt(b[p]&((128>>(sizeBytes-1))-1));
 for(let i=1;i<sizeBytes;i++)size=(size<<8n)|BigInt(b[p+i]);
 const unknown=size===(1n<<BigInt(7*sizeBytes))-1n,body=p+sizeBytes;
 if(!unknown&&size>BigInt(Number.MAX_SAFE_INTEGER))return null;
 return {id,start,sizeAt:p,sizeBytes,body,end:unknown?end:body+Number(size),unknown};
}
function children(b,start,end){
 const out=[];for(let p=start;p<end;){if(out.length>=4096)return null;const e=element(b,p,end);if(!e||e.unknown||e.end>end)return null;out.push(e);p=e.end;}return out;
}
function fixCRC(original,copy,entries,start,end){
 const crcs=entries.filter(e=>e.id==='bf');if(crcs.length>1)return false;
 if(!crcs.length)return true;
 const c=crcs[0];if(c.end-c.body!==4)return false;
 const excluding=b=>Buffer.concat([b.subarray(start,c.start),b.subarray(c.end,end)]);
 if(original.readUInt32LE(c.body)!==crc32(excluding(original)))return false;
 copy.writeUInt32LE(crc32(excluding(copy)),c.body);return true;
}

// Replace only the extraneous nine-byte picture extension with an EBML Void.
// All offsets and packet bytes remain unchanged. Unknown/ambiguous layouts refuse.
export function correctedMpeg2Header(b){
 const ebml=element(b,0,b.length);if(ebml?.id!=='1a45dfa3'||ebml.end>b.length)return null;
 const segment=element(b,ebml.end,b.length);if(segment?.id!=='18538067')return null;
 let tracks;
 for(let p=segment.body;p<Math.min(segment.end,b.length);){
  const e=element(b,p,b.length);if(!e||e.id==='bf'||e.id==='1f43b675')return null;
  if(e.unknown||e.end>b.length||e.end>segment.end)return null;
  if(e.id==='1654ae6b'){tracks=e;break;}p=e.end;
 }
 if(!tracks)return null;
 const entries=children(b,tracks.body,tracks.end);if(!entries)return null;
 const copy=Buffer.from(b);let patched=0;
 for(const track of entries.filter(e=>e.id==='ae')){
  const fields=children(b,track.body,track.end);if(!fields)return null;
  const codecs=fields.filter(e=>e.id==='86'),privates=fields.filter(e=>e.id==='63a2');
  if(codecs.length!==1)return null;
  if(b.subarray(codecs[0].body,codecs[0].end).toString()!=='V_MPEG2')continue;
  if(privates.length!==1)return null;
  const e=privates[0],data=b.subarray(e.body,e.end);
  if(data.length!==31||!data.subarray(0,4).equals(Buffer.from('000001b3','hex'))||!data.subarray(12,16).equals(Buffer.from('000001b5','hex'))||(data[16]>>4)!==1||!data.subarray(22,26).equals(Buffer.from('000001b5','hex'))||(data[26]>>4)!==8)return null;
  // No additional start code may hide inside an unexpected extension layout.
  if(data.subarray(26).includes(Buffer.from('000001','hex')))return null;
  let size=22;for(let i=e.sizeBytes-1;i>=0;i--){copy[e.sizeAt+i]=size&255;size=Math.floor(size/256);}copy[e.sizeAt]|=128>>(e.sizeBytes-1);
  copy.fill(0,e.body+22,e.end);copy[e.body+22]=0xec;copy[e.body+23]=0x87;
  if(!fixCRC(b,copy,fields,track.body,track.end))return null;patched++;
 }
 if(!patched||!fixCRC(b,copy,entries,tracks.body,tracks.end))return null;
 return copy;
}
function eligible(error){
 if(error?.previewExitCode!==0)return false;
 if(String(error?.previewDiagnostics??'').length>=16384)return false;
 const text=String(error?.previewDiagnostics??error?.message??'').replace(/^(?:Nelze připravit náhled: |Nelze připravit zvuk: |Poslech nelze připravit: )/,'').trim();
 return text&&text.split(/\r?\n/).every(line=>/^\[mpeg2video @ (?:0x)?[0-9a-f]+\] ignoring pic cod ext after 0\s*$/i.test(line));
}
export async function withMpeg2Initialization(file,run,{signal,budgetMs=90000}={}){
 const deadline=Date.now()+budgetMs,remaining=()=>Math.max(1,deadline-Date.now());
 signal?.throwIfAborted();
 try{return await run(file,remaining());}catch(error){
  signal?.throwIfAborted();if(!eligible(error)||Date.now()>=deadline)throw error;
  const source=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);let directory;
  try{
   const before=await source.stat();if(!before.isFile()||before.nlink!==1)throw error;
   const buffer=Buffer.alloc(Math.min(LIMIT,before.size)),read=await source.read(buffer,0,buffer.length,0);
   if(read.bytesRead!==buffer.length)throw error;
   const header=correctedMpeg2Header(buffer);if(!header)throw error;
   directory=await fs.mkdtemp(path.join(os.tmpdir(),'mpeg2-preview-'));
   if(/[|,\r\n]/.test(directory))throw error;
   const prefix=path.join(directory,'header'),tail=path.join(directory,'source');
   await fs.writeFile(prefix,header,{mode:0o600});await fs.symlink(path.resolve(file),tail);
   const unchanged=async()=>{if(identityOf(await source.stat())!==identityOf(before)||identityOf(await fs.lstat(file))!==identityOf(before))throw Error('Soubory se změnily. Obnov přehled.');};
   await unchanged();signal?.throwIfAborted();if(Date.now()>=deadline)throw error;
   const result=await run('concat:'+prefix+'|subfile,,start,'+header.length+',,:'+tail,remaining());
   await unchanged();return result;
  }finally{await source.close();if(directory)await fs.rm(directory,{recursive:true,force:true});}
 }
}
