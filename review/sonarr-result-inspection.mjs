import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createSonarrInspection} from './sonarr-inspection.mjs';
import {mapSonarrSourcePath} from './sonarr-source-path.mjs';
import {compareIdentity} from '../recovery/file-identity.mjs';

const workerFile=fileURLToPath(new URL('./sonarr-result-worker.mjs',import.meta.url));
const outputLimit=256*1024,inputLimit=256*1024;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const identity=value=>plain(value)&&Number.isSafeInteger(value.size)&&value.size>0&&Number.isSafeInteger(value.mtime)&&/^[a-f0-9]{64}$/.test(value.sample);
const sameIdentity=(a,b)=>identity(a)&&identity(b)&&a.size===b.size&&a.mtime===b.mtime&&a.sample===b.sample;
const safeRelative=value=>typeof value==='string'&&value.length>0&&value.length<=4096&&!value.startsWith('/')&&!value.includes('\\')&&!value.includes('\0')&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'&&part.length<=255);
const normalized=value=>typeof value==='string'?value.replaceAll('\\','/'):'';
const validNamespace=value=>typeof value==='string'&&value.length>0&&mapSonarrSourcePath({sonarrRoot:value,filePath:value.replace(/[\\/]+$/,'')+'/__inspection_probe__'}).status==='mapped';
const bytesFromGiB=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?Math.round(value*2**30):null;
const reasonCodes=new Set(['source-missing','result-missing','receipt-missing','job-missing','wrong-library','job-not-successful','job-path-mismatch','evidence-mismatch','ambiguous-result','ambiguous-job','unsafe-path','unsupported-layout','unsupported-evidence','file-changed','evidence-unavailable','busy']);

function candidates(relative){
 const values=[relative];
 if(/\.(?:m2ts|ts)$/i.test(relative))values.unshift(relative.replace(/\.(?:m2ts|ts)$/i,'.mkv'));
 return [...new Set(values)];
}
function validReceipt(receipt,relative,outputRelative){
 const exactKeys=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
 return plain(receipt)&&receipt.version===1&&receipt.relative===relative&&receipt.outputRelative===outputRelative&&
  exactKeys(receipt,['version','relative','outputRelative','source','output','jobId','createdAt'])&&exactKeys(receipt.source,['size','mtime','sample'])&&exactKeys(receipt.output,['size','mtime','sample'])&&
  Number.isSafeInteger(receipt.createdAt)&&receipt.createdAt>=0&&typeof receipt.jobId==='string'&&receipt.jobId.length>0&&receipt.jobId.length<=512&&receipt.jobId===receipt.jobId.trim()&&
  identity(receipt.source)&&identity(receipt.output);
}
function fail(reason,binding=null){return {status:'unverified',reason,source:'unverified',...(binding?{binding}:{})};}

/** Explicit, bounded association check for one fresh Sonarr EpisodeFile binding. */
export function createSonarrResultInspection({getSnapshot,fetchFn=globalThis.fetch,requestTimeoutMs=7000,workerTimeoutMs=15000,killGraceMs=250,spawnChild=spawn,workerPath=workerFile}){
 let active=null,closing=false,inspectionBusy=false;
 function runWorker(input){
  if(closing||active)return Promise.resolve({status:'unverified',reason:'busy'});
  const payload=JSON.stringify(input);if(Buffer.byteLength(payload)>inputLimit)return Promise.resolve({status:'unverified',reason:'unsupported-layout'});
  let child;try{child=spawnChild(process.execPath,[workerPath],{shell:false,windowsHide:true,stdio:['pipe','pipe','ignore'],env:{PATH:process.env.PATH||'',...(process.platform==='win32'&&process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{})}})}catch{return Promise.resolve({status:'unverified',reason:'evidence-unavailable'});}
  let outputBytes=0,settled=false,resolveResult;const chunks=[];const result=new Promise(resolve=>{resolveResult=resolve});
  const record={child,closed:false,killTimer:null};active=record;
  const finish=value=>{if(settled)return;settled=true;clearTimeout(deadline);resolveResult(value);};
  const deadline=setTimeout(()=>{finish({status:'unverified',reason:'evidence-unavailable'});try{child.kill('SIGTERM')}catch{}record.killTimer=setTimeout(()=>{if(!record.closed)try{child.kill('SIGKILL')}catch{}},killGraceMs);record.killTimer.unref?.();},workerTimeoutMs);deadline.unref?.();
  child.once('error',()=>finish({status:'unverified',reason:'evidence-unavailable'}));
  child.stdin.once('error',()=>{finish({status:'unverified',reason:'evidence-unavailable'});try{child.kill('SIGTERM')}catch{}});
  child.stdout.on('data',chunk=>{if(settled)return;const data=Buffer.from(chunk);outputBytes+=data.length;if(outputBytes>outputLimit){finish({status:'unverified',reason:'evidence-unavailable'});try{child.kill('SIGTERM')}catch{}return;}chunks.push(data);});
  child.once('close',code=>{record.closed=true;clearTimeout(record.killTimer);if(active===record)active=null;if(!settled){try{const value=JSON.parse(Buffer.concat(chunks,outputBytes).toString('utf8'));if(code!==0||!plain(value)||!['present','unverified'].includes(value.status))throw Error();finish(value);}catch{finish({status:'unverified',reason:'evidence-unavailable'});}}});
  try{child.stdin.end(payload)}catch{finish({status:'unverified',reason:'evidence-unavailable'});try{child.kill('SIGTERM')}catch{}}
  return result;
 }
 async function inspectOnce(revision,seriesId,episodeFileId){
  if(closing)return fail('evidence-unavailable');
  if(!/^[a-f0-9]{64}$/.test(revision||'')||!Number.isSafeInteger(seriesId)||seriesId<=0||!Number.isSafeInteger(episodeFileId)||episodeFileId<=0)return fail('unsupported-layout');
  let first;
  try{first=await getSnapshot(revision);}catch(error){if(error?.code==='settings_conflict')throw error;return fail('evidence-unavailable');}
  const tv=first?.tv,review=first?.review;
  if(first?.revision!==revision||!plain(tv)||tv.enabled!==false||![tv.mediaRoot,tv.reviewRoot].every(value=>typeof value==='string'&&value.startsWith('/'))||!validNamespace(tv.sonarrRoot)||!Array.isArray(tv.sourceRoots)||!tv.sourceRoots.length||tv.sourceRoots.some(root=>!validNamespace(root))||!Array.isArray(tv.reviewPrefixes)||!tv.reviewPrefixes.length||typeof tv.libraryId!=='string'||!tv.libraryId.trim()||!plain(review)||typeof review.database!=='string'||!review.database.startsWith('/'))return fail('unsupported-layout');
  const sameSettings=(value)=>value?.revision===revision&&JSON.stringify(value.tv)===JSON.stringify(tv)&&JSON.stringify(value.review)===JSON.stringify(review)&&JSON.stringify(value.sonarr)===JSON.stringify(first.sonarr);
  const sonarr=createSonarrInspection({getConnection:async requested=>{
   if(requested!==revision)throw Object.assign(Error('settings_conflict'),{code:'settings_conflict'});
   const current=await getSnapshot(revision);if(!sameSettings(current))throw Object.assign(Error('settings_conflict'),{code:'settings_conflict'});return current.sonarr;
  },fetchFn,requestTimeoutMs});
  let binding;
  try{binding=await sonarr.inspectEpisodeFile(revision,seriesId,episodeFileId);}catch(error){if(error?.code==='settings_conflict')throw error;return fail('evidence-unavailable');}
  if(binding.status!=='mapped')return fail(binding.status==='ambiguous'?'unsupported-evidence':'unsupported-layout');
  const mapped=mapSonarrSourcePath({sonarrRoot:tv.sonarrRoot,filePath:binding.sonarrPath});
  if(mapped.status!=='mapped'||!safeRelative(mapped.relative))return fail('unsupported-layout');
  if(tv.reviewPrefixes.some(prefix=>typeof prefix!=='string'||!prefix||prefix.includes('/')||prefix==='.'||prefix==='..'))return fail('unsupported-layout');
  const outputRelatives=tv.reviewPrefixes.flatMap(prefix=>candidates(mapped.relative).map(relative=>prefix+'/'+relative));
  const workerInput={mediaRoot:tv.mediaRoot,reviewRoot:tv.reviewRoot,database:review.database,relative:mapped.relative,outputRelatives};
  let inspected=await runWorker(workerInput);
  const afterRead=await getSnapshot(revision);if(!sameSettings(afterRead))throw Object.assign(Error('settings_conflict'),{code:'settings_conflict'});
  let current;
  try{current=await sonarr.inspectEpisodeFile(revision,seriesId,episodeFileId);}catch(error){if(error?.code==='settings_conflict')throw error;return fail('evidence-unavailable');}
  if(current.status!=='mapped'||current.sonarrPath!==binding.sonarrPath||current.binding.seriesId!==binding.binding.seriesId||current.binding.episodeFileId!==binding.binding.episodeFileId||JSON.stringify(current.binding.episodeIds)!==JSON.stringify(binding.binding.episodeIds))return fail('file-changed');
  const safeBinding={seriesId,episodeFileId,episodeIds:[...binding.binding.episodeIds]};
  if(inspected.status!=='present')return fail(reasonCodes.has(inspected.reason)?inspected.reason:'evidence-unavailable',safeBinding);
  const finalInspection=await runWorker(workerInput);
  if(finalInspection.status!=='present')return fail(reasonCodes.has(finalInspection.reason)?finalInspection.reason:'evidence-unavailable',safeBinding);
  const proofKeys=['source','result','receipt','database'];
  if(proofKeys.some(key=>compareIdentity(inspected.fileProofs?.[key],finalInspection.fileProofs?.[key])!=='same')||
   JSON.stringify(inspected.receipt)!==JSON.stringify(finalInspection.receipt)||JSON.stringify(inspected.jobs)!==JSON.stringify(finalInspection.jobs)||inspected.outputRelative!==finalInspection.outputRelative||
   !sameIdentity(inspected.source,finalInspection.source)||!sameIdentity(inspected.result,finalInspection.result))return fail('file-changed',safeBinding);
  let latest;
  try{latest=await getSnapshot(revision);}catch(error){if(error?.code==='settings_conflict')throw error;return fail('evidence-unavailable',safeBinding);}
  if(!sameSettings(latest))throw Object.assign(Error('settings_conflict'),{code:'settings_conflict'});
  inspected=finalInspection;
  const receipt=inspected.receipt;
  const receiptOutput=tv.reviewPrefixes.map(prefix=>prefix+'/').find(prefix=>inspected.outputRelative.startsWith(prefix));
  const outputRelative=receiptOutput?inspected.outputRelative.slice(receiptOutput.length):null;
  if(!candidates(mapped.relative).includes(outputRelative)||!validReceipt(receipt,mapped.relative,outputRelative))return fail('unsupported-evidence',safeBinding);
  if(!sameIdentity(receipt.source,inspected.source)||!sameIdentity(receipt.output,inspected.result))return fail('file-changed',safeBinding);
  if(!Array.isArray(inspected.jobs)||inspected.jobs.length!==1)return fail(inspected.jobs?.length>1?'ambiguous-job':'job-missing',safeBinding);
  const job=inspected.jobs[0];
  if(!plain(job)||job._id!==receipt.jobId)return fail('job-missing',safeBinding);
  if(job.DB!==tv.libraryId)return fail('wrong-library',safeBinding);
  if(job.status!=='Transcode success')return fail('job-not-successful',safeBinding);
  const allowedPaths=new Set(tv.sourceRoots.map(root=>normalized(root).replace(/\/+$/,'')+'/'+mapped.relative));
  if(!allowedPaths.has(normalized(job.file)))return fail('job-path-mismatch',safeBinding);
  if(bytesFromGiB(job.fileSizeStartGB)!==inspected.source.size||bytesFromGiB(job.fileSizeEndGB)!==inspected.result.size)return fail('evidence-mismatch',safeBinding);
  return {status:'matched',reason:null,source:'unverified',binding:safeBinding,source:{size:inspected.source.size,modifiedAt:inspected.source.mtime},result:{size:inspected.result.size,modifiedAt:inspected.result.mtime},evidence:{receipt:'matched',job:'successful',startedAt:Number.isSafeInteger(job.start)?job.start:null,endedAt:Number.isSafeInteger(job.end)?job.end:null}};
 }
 async function inspect(revision,seriesId,episodeFileId){
  if(inspectionBusy)return fail('busy');inspectionBusy=true;
  try{return await inspectOnce(revision,seriesId,episodeFileId);}finally{inspectionBusy=false;}
 }
 async function close(){closing=true;const record=active;if(!record)return;try{record.child.kill('SIGTERM')}catch{}await new Promise(resolve=>{if(record.closed){resolve();return;}const timer=setTimeout(()=>{if(!record.closed)try{record.child.kill('SIGKILL')}catch{}resolve();},1000);record.child.once('close',()=>{clearTimeout(timer);resolve()});});}
 return {inspect,close};
}
