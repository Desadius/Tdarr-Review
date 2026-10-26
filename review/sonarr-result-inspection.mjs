import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createSonarrInspection} from './sonarr-inspection.mjs';
import {mapSonarrSourcePath} from './sonarr-source-path.mjs';
import {compareIdentity} from '../recovery/file-identity.mjs';
import {validTechnicalFacts} from './sonarr-technical-facts.mjs';

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
function sameWorkerProof(left,right){
 const keys=['source','result','receipt','database'];
 return keys.every(key=>compareIdentity(left?.fileProofs?.[key],right?.fileProofs?.[key])==='same')&&
  JSON.stringify(left?.receipt)===JSON.stringify(right?.receipt)&&JSON.stringify(left?.jobs)===JSON.stringify(right?.jobs)&&left?.outputRelative===right?.outputRelative&&
  sameIdentity(left?.source,right?.source)&&sameIdentity(left?.result,right?.result);
}

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
function associationFailure(verified,{tv,mapped}){
 if(verified?.status!=='present')return reasonCodes.has(verified?.reason)?verified.reason:'evidence-unavailable';
 const receiptOutput=tv.reviewPrefixes.map(prefix=>prefix+'/').find(prefix=>verified.outputRelative?.startsWith(prefix));
 const outputRelative=receiptOutput?verified.outputRelative.slice(receiptOutput.length):null;
 if(!candidates(mapped.relative).includes(outputRelative)||!validReceipt(verified.receipt,mapped.relative,outputRelative))return 'unsupported-evidence';
 if(!sameIdentity(verified.receipt.source,verified.source)||!sameIdentity(verified.receipt.output,verified.result))return 'file-changed';
 if(!Array.isArray(verified.jobs)||verified.jobs.length!==1)return verified.jobs?.length>1?'ambiguous-job':'job-missing';
 const job=verified.jobs[0];
 if(!plain(job)||job._id!==verified.receipt.jobId)return 'job-missing';
 if(job.DB!==tv.libraryId)return 'wrong-library';
 if(job.status!=='Transcode success')return 'job-not-successful';
 const allowedPaths=new Set(tv.sourceRoots.map(root=>normalized(root).replace(/\/+$/,'')+'/'+mapped.relative));
 if(!allowedPaths.has(normalized(job.file)))return 'job-path-mismatch';
 if(bytesFromGiB(job.fileSizeStartGB)!==verified.source.size||bytesFromGiB(job.fileSizeEndGB)!==verified.result.size)return 'evidence-mismatch';
 return null;
}

/** Explicit, bounded association check for one fresh Sonarr EpisodeFile binding. */
export function createSonarrResultInspection({getSnapshot,fetchFn=globalThis.fetch,requestTimeoutMs=7000,workerTimeoutMs=15000,technicalWorkerTimeoutMs=35000,killGraceMs=250,spawnChild=spawn,workerPath=workerFile}){
 let active=null,closing=false,inspectionBusy=false;
 const signalWorker=(record,signal)=>{if(record.killGroup&&process.platform==='linux'&&record.child.pid){try{process.kill(-record.child.pid,signal);return;}catch{}}try{record.child.kill(signal)}catch{}};
 function runWorker(input,{timeoutMs=workerTimeoutMs,killGroup=false}={}){
  if(closing||active)return Promise.resolve({status:'unverified',reason:'busy'});
  const payload=JSON.stringify(input);if(Buffer.byteLength(payload)>inputLimit)return Promise.resolve({status:'unverified',reason:'unsupported-layout'});
  let child;try{child=spawnChild(process.execPath,[workerPath],{shell:false,windowsHide:true,...(killGroup&&process.platform==='linux'?{detached:true}:{}),stdio:['pipe','pipe','ignore'],env:{PATH:process.env.PATH||'',...(process.platform==='win32'&&process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{})}})}catch{return Promise.resolve({status:'unverified',reason:'evidence-unavailable'});}
  let outputBytes=0,settled=false,resolveResult;const chunks=[];const result=new Promise(resolve=>{resolveResult=resolve});
  const record={child,closed:false,killTimer:null,killGroup};active=record;
  const terminate=()=>{signalWorker(record,'SIGTERM');if(record.killTimer)return;record.killTimer=setTimeout(()=>{if(!record.closed)signalWorker(record,'SIGKILL')},killGroup?Math.max(killGraceMs,1000):killGraceMs);record.killTimer.unref?.();};
  const finish=value=>{if(settled)return;settled=true;clearTimeout(deadline);resolveResult(value);};
  const deadline=setTimeout(()=>{finish({status:'unverified',reason:'evidence-unavailable'});terminate();},timeoutMs);deadline.unref?.();
  child.once('error',()=>finish({status:'unverified',reason:'evidence-unavailable'}));
  child.stdin.once('error',()=>{finish({status:'unverified',reason:'evidence-unavailable'});terminate()});
  child.stdout.on('data',chunk=>{if(settled)return;const data=Buffer.from(chunk);outputBytes+=data.length;if(outputBytes>outputLimit){finish({status:'unverified',reason:'evidence-unavailable'});terminate();return;}chunks.push(data);});
  child.once('close',code=>{record.closed=true;clearTimeout(record.killTimer);if(active===record)active=null;if(!settled){try{const value=JSON.parse(Buffer.concat(chunks,outputBytes).toString('utf8'));if(code!==0||!plain(value)||!['present','unverified'].includes(value.status))throw Error();finish(value);}catch{finish({status:'unverified',reason:'evidence-unavailable'});}}});
  try{child.stdin.end(payload)}catch{finish({status:'unverified',reason:'evidence-unavailable'});terminate()}
  return result;
 }
 async function inspectOnce(revision,seriesId,episodeFileId,technical=false){
  if(closing)return fail('evidence-unavailable');
  if(!/^[a-f0-9]{64}$/.test(revision||'')||!Number.isSafeInteger(seriesId)||seriesId<=0||!Number.isSafeInteger(episodeFileId)||episodeFileId<=0)return fail('unsupported-layout');
  let first;
  try{first=await getSnapshot(revision);}catch(error){if(error?.code==='settings_conflict')throw error;return fail('evidence-unavailable');}
  const tv=first?.tv,review=first?.review;
  if(first?.revision!==revision||!plain(tv)||tv.enabled!==false||![tv.mediaRoot,tv.reviewRoot].every(value=>typeof value==='string'&&value.startsWith('/'))||!validNamespace(tv.sonarrRoot)||!Array.isArray(tv.sourceRoots)||!tv.sourceRoots.length||tv.sourceRoots.some(root=>!validNamespace(root))||!Array.isArray(tv.reviewPrefixes)||!tv.reviewPrefixes.length||typeof tv.libraryId!=='string'||!tv.libraryId.trim()||!plain(review)||typeof review.database!=='string'||!review.database.startsWith('/')||technical&&(typeof review.ffprobe!=='string'||!review.ffprobe.startsWith('/')))return fail('unsupported-layout');
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
  const inspected=await runWorker(workerInput);
  const safeBinding={seriesId,episodeFileId,episodeIds:[...binding.binding.episodeIds]};
  let technicalInspection=null;
  const initialFailure=associationFailure(inspected,{tv,mapped});
  if(initialFailure)return fail(initialFailure,safeBinding);
  if(technical){
   const preProbeSettings=await getSnapshot(revision);if(!sameSettings(preProbeSettings))throw Object.assign(Error('settings_conflict'),{code:'settings_conflict'});
   let preProbeBinding;
   try{preProbeBinding=await sonarr.inspectEpisodeFile(revision,seriesId,episodeFileId);}catch(error){if(error?.code==='settings_conflict')throw error;return fail('evidence-unavailable',safeBinding);}
   if(preProbeBinding.status!=='mapped'||preProbeBinding.sonarrPath!==binding.sonarrPath||preProbeBinding.binding.seriesId!==binding.binding.seriesId||preProbeBinding.binding.episodeFileId!==binding.binding.episodeFileId||JSON.stringify(preProbeBinding.binding.episodeIds)!==JSON.stringify(binding.binding.episodeIds))return fail('file-changed',safeBinding);
   const preProbe=await runWorker(workerInput);
   const preProbeFailure=associationFailure(preProbe,{tv,mapped});
   if(preProbeFailure)return fail(preProbeFailure,safeBinding);
   if(!sameWorkerProof(inspected,preProbe))return fail('file-changed',safeBinding);
   // Only probe after both the exact Sonarr binding and its complete private association are revalidated.
   technicalInspection=await runWorker({...workerInput,probeFacts:true,ffprobe:review.ffprobe},{timeoutMs:technicalWorkerTimeoutMs,killGroup:true});
   if(technicalInspection.status!=='present'){
    const reason=['unsupported-evidence','evidence-unavailable'].includes(technicalInspection.reason)?'technical-facts-unavailable':reasonCodes.has(technicalInspection.reason)?technicalInspection.reason:'technical-facts-unavailable';
    return fail(reason,safeBinding);
   }
  }
  const afterRead=await getSnapshot(revision);if(!sameSettings(afterRead))throw Object.assign(Error('settings_conflict'),{code:'settings_conflict'});
  let current;
  try{current=await sonarr.inspectEpisodeFile(revision,seriesId,episodeFileId);}catch(error){if(error?.code==='settings_conflict')throw error;return fail('evidence-unavailable');}
  if(current.status!=='mapped'||current.sonarrPath!==binding.sonarrPath||current.binding.seriesId!==binding.binding.seriesId||current.binding.episodeFileId!==binding.binding.episodeFileId||JSON.stringify(current.binding.episodeIds)!==JSON.stringify(binding.binding.episodeIds))return fail('file-changed');
  if(inspected.status!=='present')return fail(reasonCodes.has(inspected.reason)?inspected.reason:'evidence-unavailable',safeBinding);
  const finalInspection=await runWorker(workerInput);
  if(finalInspection.status!=='present')return fail(reasonCodes.has(finalInspection.reason)?finalInspection.reason:'evidence-unavailable',safeBinding);
  if(!sameWorkerProof(inspected,finalInspection)||technical&&!sameWorkerProof(technicalInspection,finalInspection))return fail('file-changed',safeBinding);
  let latest;
  try{latest=await getSnapshot(revision);}catch(error){if(error?.code==='settings_conflict')throw error;return fail('evidence-unavailable',safeBinding);}
  if(!sameSettings(latest))throw Object.assign(Error('settings_conflict'),{code:'settings_conflict'});
  const verified=finalInspection;
  const finalFailure=associationFailure(verified,{tv,mapped});if(finalFailure)return fail(finalFailure,safeBinding);
  if(technical){
   if(!plain(technicalInspection?.technicalFacts)||Object.keys(technicalInspection.technicalFacts).length!==2||!validTechnicalFacts(technicalInspection.technicalFacts.source)||!validTechnicalFacts(technicalInspection.technicalFacts.result))return fail('technical-facts-unavailable',safeBinding);
   return {status:'available',reason:null,binding:safeBinding,association:{receipt:'matched',job:'successful'},facts:{source:technicalInspection.technicalFacts.source,result:technicalInspection.technicalFacts.result}};
  }
  const job=verified.jobs[0];
  return {status:'matched',reason:null,source:'unverified',binding:safeBinding,source:{size:verified.source.size,modifiedAt:verified.source.mtime},result:{size:verified.result.size,modifiedAt:verified.result.mtime},evidence:{receipt:'matched',job:'successful',startedAt:Number.isSafeInteger(job.start)?job.start:null,endedAt:Number.isSafeInteger(job.end)?job.end:null}};
 }
 async function inspect(revision,seriesId,episodeFileId){
  if(inspectionBusy)return fail('busy');inspectionBusy=true;
  try{return await inspectOnce(revision,seriesId,episodeFileId);}finally{inspectionBusy=false;}
 }
 async function inspectTechnical(revision,seriesId,episodeFileId){
  if(inspectionBusy)return fail('busy');inspectionBusy=true;
  try{return await inspectOnce(revision,seriesId,episodeFileId,true);}finally{inspectionBusy=false;}
 }
 async function close(){closing=true;const record=active;if(!record)return;signalWorker(record,'SIGTERM');await new Promise(resolve=>{if(record.closed){resolve();return;}const timer=setTimeout(()=>{if(!record.closed)signalWorker(record,'SIGKILL');resolve();},1000);record.child.once('close',()=>{clearTimeout(timer);resolve()});});}
 return {inspect,inspectTechnical,close};
}
