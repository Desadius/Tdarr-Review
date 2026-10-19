// Explicit, opt-in preparation step. The reproduction itself never uses the network.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const SAMPLE_NAME='xll_51_24_48_768.dtshd';
export const SAMPLE_SHA256='c0830af121ec78a8271d008999cc54b99843f17b9b33203bb9adbcbc3271d0a9';
const commit='8665d5718888f2b9192516f86014cc3642ed653a';
const base=`https://raw.githubusercontent.com/foo86/dcadec-samples/${commit}/`;
const files=[
 {name:'README',bytes:71,sha256:'dcf952a95384b86a3453a78beef9353be98bbd05db70f720ad5864b26ea3f50c'},
 {name:SAMPLE_NAME,bytes:25692,sha256:SAMPLE_SHA256},
];
const digest=data=>crypto.createHash('sha256').update(data).digest('hex');

export async function loadDtsSample(directory){
 const data=await fs.readFile(path.join(directory,SAMPLE_NAME));
 if(data.length!==25692||digest(data)!==SAMPLE_SHA256)throw Error('Expected the pinned public-domain DTS test vector; arbitrary media is not accepted.');
 return data;
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.dirname,'fetch-dts-seek-sample.mjs')){
 const destination=process.argv[2];
 if(!destination||process.argv.length!==3)throw Error('Usage: node tools/fetch-dts-seek-sample.mjs /temporary/sample-directory');
 await fs.mkdir(destination,{recursive:true});
 for(const file of files){
  const response=await fetch(base+file.name,{signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`Download failed: ${response.status}`);
  const data=Buffer.from(await response.arrayBuffer());
  if(data.length!==file.bytes||digest(data)!==file.sha256)throw Error('Pinned sample checksum mismatch.');
  await fs.writeFile(path.join(destination,file.name),data,{flag:'wx'});
 }
 console.log(`Downloaded the pinned public-domain test vector and its copyright statement to ${path.resolve(destination)}. No application settings were read.`);
}
