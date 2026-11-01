import fs from 'node:fs/promises';
import path from 'node:path';
import {mapReview} from './config.mjs';

// A source the flow refused to encode (#299): the flow leaves `<file>.mkv.tdarr-advisory.json` where its
// Review result would be. The marker is never a result: it cannot be approved and never touches the
// original. Review offers only a Radarr replacement request (the source-only path of #153) or Keep.
export const ADVISORY_SUFFIX='.tdarr-advisory.json';
export const ADVISORY_REASONS=Object.freeze(['container_crop','non_square_sar']);
const MAX_MARKER_BYTES=8192,MAX_MARKERS=500,MAX_KEPT=1000,MTIME_TOLERANCE_MS=1000;

export class AdvisoryError extends Error{constructor(code){super(code);this.code=code}}
const plainObject=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const finite=v=>typeof v==='number'&&Number.isFinite(v);

/** Validates one marker strictly; unknown versions, reasons or shapes are refused. */
export function parseAdvisory(text){
 if(typeof text!=='string'||Buffer.byteLength(text)>MAX_MARKER_BYTES)throw new AdvisoryError('advisory_invalid');
 let m;try{m=JSON.parse(text)}catch{throw new AdvisoryError('advisory_invalid')}
 if(!plainObject(m)||m.version!==1||m.kind!=='tdarr-review-advisory'||!ADVISORY_REASONS.includes(m.reason))throw new AdvisoryError('advisory_invalid');
 const s=m.source;
 if(!plainObject(s)||typeof s.relative!=='string'||!Number.isSafeInteger(s.size)||s.size<=0||!finite(s.mtimeMs)||s.mtimeMs<0)throw new AdvisoryError('advisory_invalid');
 const measured=plainObject(m.measured)?m.measured:{};
 const crop=plainObject(measured.crop)?Object.fromEntries(['top','bottom','left','right'].map(k=>[k,Number.isSafeInteger(measured.crop[k])&&measured.crop[k]>=0?measured.crop[k]:0])):null;
 return {
  reason:m.reason,source:{relative:s.relative,size:s.size,mtimeMs:s.mtimeMs},
  measured:{width:Number.isSafeInteger(measured.width)?measured.width:null,height:Number.isSafeInteger(measured.height)?measured.height:null,sampleAspectRatio:typeof measured.sampleAspectRatio==='string'&&/^\d{1,6}:\d{1,6}$/.test(measured.sampleAspectRatio)?measured.sampleAspectRatio:null,crop},
  jobId:typeof m.jobId==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(m.jobId)?m.jobId:null,
  createdAt:typeof m.createdAt==='string'&&!Number.isNaN(Date.parse(m.createdAt))?new Date(m.createdAt).toISOString():null,
 };
}

async function markers(dir,prefix='',out=[]){
 for(const e of await fs.readdir(dir,{withFileTypes:true}).catch(()=>[])){
  if(out.length>=MAX_MARKERS)break;
  if(e.isSymbolicLink()||e.name.startsWith('.'))continue;
  const rel=prefix?prefix+'/'+e.name:e.name;
  if(e.isDirectory()&&rel.split('/').length<12)await markers(path.join(dir,e.name),rel,out);
  else if(e.isFile()&&e.name.toLowerCase().endsWith('.mkv'+ADVISORY_SUFFIX))out.push(rel);
 }
 return out;
}

/**
 * @param {{data:string,getConfig:()=>any,safeFile:Function,hash:(s:string)=>string,atomicJSON:Function,openRequestRelatives?:()=>Promise<Set<string>>}} deps
 */
export function createAdvisories({data,getConfig,safeFile,hash,atomicJSON,openRequestRelatives=async()=>new Set()}){
 const file=path.join(data,'advisory-decisions.json');
 async function decisions(){
  const raw=await fs.readFile(file,'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e});
  if(raw===null)return {version:1,kept:{}};
  const d=JSON.parse(raw);if(d?.version!==1||!plainObject(d.kept))throw Error('Záznam rozhodnutí o doporučeních je nečitelný.');
  return d;
 }
 // One marker with the current identity of the marker and its original. A missing original hides it.
 async function read(markerRelative){
  const cfg=getConfig(),relative=mapReview(markerRelative.slice(0,-ADVISORY_SUFFIX.length),cfg.reviewPrefixes);
  if(!relative)throw new AdvisoryError('advisory_invalid');
  const marker=await safeFile(cfg.reviewRoot,markerRelative);
  if(marker.stat.size>MAX_MARKER_BYTES)throw new AdvisoryError('advisory_invalid');
  const parsed=parseAdvisory(await fs.readFile(marker.path,'utf8'));
  if(parsed.source.relative!==relative)throw new AdvisoryError('advisory_invalid');
  let source;try{source=await safeFile(cfg.mediaRoot,relative)}catch(e){if(e?.code==='ENOENT')return null;throw e}
  const unchanged=source.stat.size===parsed.source.size&&Math.abs(source.stat.mtimeMs-parsed.source.mtimeMs)<=MTIME_TOLERANCE_MS;
  return {
   id:hash('advisory|'+markerRelative).slice(0,24),title:relative.split('/')[0],relative,markerRelative,
   reason:parsed.reason,measured:parsed.measured,jobId:parsed.jobId,createdAt:parsed.createdAt,originalBytes:source.stat.size,
   status:unchanged?'ready':'changed',snapshot:hash('advisory|'+marker.fp+'|'+source.fp),
  };
 }
 async function list(){
  const cfg=getConfig(),kept=(await decisions()).kept,open=await openRequestRelatives(),items=[],invalid=[];
  for(const rel of await markers(cfg.reviewRoot)){
   try{const item=await read(rel);if(item&&!kept[item.snapshot]&&!open.has(item.relative))items.push(item)}
   catch{invalid.push(rel)}
  }
  if(invalid.length)console.error('Advisory markers refused: '+invalid.length);
  return items.sort((a,b)=>a.title.localeCompare(b.title));
 }
 async function find(id,snapshot){
  if(typeof id!=='string'||!/^[a-f0-9]{24}$/.test(id))throw new AdvisoryError('advisory_changed');
  const item=(await list()).find(x=>x.id===id);
  if(!item||typeof snapshot==='string'&&item.snapshot!==snapshot)throw new AdvisoryError('advisory_changed');
  if(item.status!=='ready')throw new AdvisoryError('advisory_source_changed');
  return item;
 }
 /** The replacement candidate: the same source-only request as #153, bound to this marker and original. */
 async function candidate(id,snapshot){
  const item=await find(id,snapshot);
  return {id:item.id,title:item.title,relative:item.relative,reviewRelative:'',outputRelative:item.relative,sourceOnly:true,advisoryId:item.id,advisoryReason:item.reason,snapshot:item.snapshot};
 }
 async function keep(id,snapshot){
  const item=await find(id,snapshot),d=await decisions();
  d.kept[item.snapshot]={relative:item.relative,reason:item.reason,time:new Date().toISOString()};
  const entries=Object.entries(d.kept).sort((a,b)=>String(a[1].time).localeCompare(String(b[1].time)));
  d.kept=Object.fromEntries(entries.slice(-MAX_KEPT));
  await atomicJSON(file,d);
  return item;
 }
 return {list,candidate,keep};
}
