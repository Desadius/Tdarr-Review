// Generated decoder-state fixture, derived only from a pinned public-domain
// dcadec test vector. No film audio or encoded media is stored in this source.
// The upstream second frame is silent, non-residual XLL with a valid DTS core.
// Its zero allocation permits changing 24-bit storage/resolution to 16 bits;
// the channel-set CRC is recomputed rather than bypassing error detection.
//
// Very short regions replace the XLL sync word with padding. A decoder started
// before them retains its XLL context; one initialized inside them falls back
// to the valid core (s32p), then returns to XLL (s16p). This deliberately models
// decoder initialization state, NOT a standards-conformant PBR encoder or proof
// of the exact bitstream condition in issue #183's private source.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {SAMPLE_SHA256} from './fetch-dts-seek-sample.mjs';

function putBits(data,start,width,value){
 for(let i=0;i<width;i++){
  const bit=start+i,mask=1<<(7-bit%8);
  data[bit>>3]=(data[bit>>3]&~mask)|(((value>>(width-i-1))&1)*mask);
 }
}
function crc16(data){
 let crc=0xffff;
 for(const byte of data){
  crc^=byte<<8;
  for(let bit=0;bit<8;bit++)crc=((crc<<1)^((crc&0x8000)?0x1021:0))&0xffff;
 }
 return crc;
}
export function buildDtsSeekAudio(sample){
 assert.equal(crypto.createHash('sha256').update(sample).digest('hex'),SAMPLE_SHA256,'Only the pinned public-domain sample is supported');
 // The DTS-HD container has a 140-byte prefix. Its first two 1112-byte
 // elementary frames are silent; select the independently decodable second.
 const frame=Buffer.from(sample.subarray(140+1112,140+2224));
 assert.equal(frame.readUInt32BE(0),0x7ffe8001);
 assert.equal(frame.readUInt32BE(1056),0x41a29547);
 putBits(frame,8572,5,15); // PCM resolution minus one.
 putBits(frame,8577,5,15); // Storage resolution minus one.
 frame.writeUInt16BE(crc16(frame.subarray(1069,1103)),1103);
 const warming=Buffer.from(frame);warming.fill(0,1056,1060);
 const result=Buffer.alloc(frame.length*8000);
 for(let i=0;i<8000;i++){
  const seconds=i*512/48000;
  const missingSync=(seconds>=37.99&&seconds<38.02)||(seconds>=65.99&&seconds<66.02);
  (missingSync?warming:frame).copy(result,i*frame.length);
 }
 return result;
}
