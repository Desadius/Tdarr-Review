// Generated media only. Rebuild EBML lengths and omit indexes whose offsets move.
import fs from 'node:fs/promises';
import path from 'node:path';
import {crc32} from 'node:zlib';
import {command} from '../review/core.mjs';
function read(b,p){
 const start=p;let n=1;while(!(b[p]&(128>>(n-1))))n++;
 const id=b.subarray(p,p+n);p+=n;let width=1;while(!(b[p]&(128>>(width-1))))width++;
 let size=BigInt(b[p]&((128>>(width-1))-1));for(let i=1;i<width;i++)size=(size<<8n)|BigInt(b[p+i]);
 const body=p+width,end=size===(1n<<BigInt(width*7))-1n?b.length:body+Number(size);return {start,id,body,end};
}
function pack(id,data){let width=1;while(data.length>=2**(width*7)-1)width++;const size=Buffer.alloc(width);let value=data.length;for(let i=width-1;i>=0;i--){size[i]=value%256;value=Math.floor(value/256);}size[0]|=128>>(width-1);return Buffer.concat([id,size,data]);}
function rewrite(b,start,end,mutate,checksummed=false){
 const out=[];for(let p=start;p<end;){const e=read(b,p),id=e.id.toString('hex');p=e.end;
  if(['114d9b74','1c53bb6b','bf'].includes(id))continue;
  let data=b.subarray(e.body,e.end);
  if(['18538067','1654ae6b','ae'].includes(id))data=rewrite(b,e.body,e.end,mutate,['1654ae6b','ae'].includes(id));
  if(id==='63a2')data=mutate(data);
  out.push(pack(e.id,data));
 }
 const payload=Buffer.concat(out);
 if(checksummed){const crc=Buffer.alloc(4);crc.writeUInt32LE(crc32(payload));return Buffer.concat([pack(Buffer.from('bf','hex'),crc),payload]);}
 return payload;
}
export async function mpeg2Fixture(root,exe){
 const generated=path.join(root,'generated.mkv');
 await command(exe,['-v','error','-f','lavfi','-i','testsrc2=size=32x32:rate=25','-f','lavfi','-i',"aevalsrc='if(lt(mod(t,1),0.13),sin(2*PI*440*t),0)':s=48000",'-f','lavfi','-i','sine=frequency=880:sample_rate=48000','-map','0:v','-map','1:a','-map','2:a','-t','15','-output_ts_offset','5','-c:v','mpeg2video','-flags:v','+global_header','-g','12','-bf','0','-threads','1','-c:a','pcm_s16le',generated]);
 const remuxed=path.join(root,'remuxed.mkv');
 await command(exe,['-v','error','-copyts','-i',generated,'-map','0','-c','copy',remuxed]);
 const bytes=await fs.readFile(remuxed);let privateData;
 const control=rewrite(bytes,0,bytes.length,data=>{privateData=data;return data;});
 if(privateData?.length!==22)throw Error('Unexpected generated CodecPrivate: '+privateData?.length);
 const extension=Buffer.from('000001b58ffff34180','hex');
 const variant=rewrite(bytes,0,bytes.length,data=>Buffer.concat([data,extension]));
 const a=path.join(root,'control.mkv'),b=path.join(root,'variant.mkv');await fs.writeFile(a,control);await fs.writeFile(b,variant);
 const unsupported=path.join(root,'unsupported.mkv');await fs.writeFile(unsupported,rewrite(bytes,0,bytes.length,()=>extension));
 return {control:a,variant:b,unsupported,bytes:variant};
}
