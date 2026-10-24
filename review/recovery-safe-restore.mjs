import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {atomicJSON} from './core.mjs';
import {constants as fsConstants,createReadStream} from 'node:fs';
import {compareIdentity,identityOf} from '../recovery/file-identity.mjs';
import {createTdarrFileState} from '../recovery/tdarr-file-state.mjs';
import {readRecoveryCaseState,readRecoveryStatus,recoveryStatusFile} from './recovery-snapshot.mjs';
import {readRecoveryRestoreBinding,readRecoveryRestoreFence} from '../recovery/recovery-authority.mjs';
import {writeRecoveryRestoreEvidence,recoveryRestoreBindingDigest} from '../recovery/restore-evidence.mjs';

const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const positive=value=>Number.isSafeInteger(value)&&value>0;
const SAME=new Set(['same','ctime-changed']);
const RESTORE_OPERATION_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const JOURNAL_STATES=new Set(['running','blocked','resuming','completed','cancelled']);
const JOURNAL_PHASES=new Set(['claiming','draining','installing','destination-installed','resuming','completed','unchanged']);
const caseId=value=>typeof value==='string'&&/^[a-f0-9]{24}$/.test(value);
const failure=code=>{const publicCode=code.replaceAll('-','_');return Object.assign(Error(publicCode),{code:publicCode});};
const QUEUE_PAGE_SIZE=100,RESPONSE_BYTES=512*1024;
const snapshotHash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rowRevision=row=>row?{file:row._id,library:row.DB,decision:row.TranscodeDecisionMaker??null,holdUntil:row.holdUntil??null}:null;
const movieRevision=movie=>({id:movie.id,tmdbId:movie.tmdbId,path:movie.path.replaceAll('\\','/').replace(/\/+$/,''),movieFileId:movie.movieFileId??null,hasMovieFile:object(movie.movieFile)});
const searchRevision=search=>({id:search.id,name:search.name,status:search.status,movieIds:search.body.movieIds,queued:search.queued??null,started:search.started??null,ended:search.ended??null});
const caseRevision=c=>({id:c.id,status:c.status,updated:c.updated,file:c.file,relative:c.relative,source:c.source,fp:c.fp,preservedSourceFP:c.preservedSourceFP,quarantine:c.quarantine,movieId:c.movieId,tmdbId:c.tmdbId,mutationStarted:c.mutationStarted,originalOutsideSince:c.originalOutsideSince,searchCommand:c.searchCommand,binding:c.binding});
const missing=async file=>{try{return await fs.lstat(file)}catch(error){if(error.code==='ENOENT')return null;throw error;}};

async function jsonResponse(response){
 const declared=Number(response.headers.get('content-length'));
 if(Number.isFinite(declared)&&declared>RESPONSE_BYTES){await response.body?.cancel();throw failure('response-too-large');}
 const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>RESPONSE_BYTES)throw failure('response-too-large');
 return JSON.parse(bytes.toString('utf8'));
}

async function radarrJson(cfg,route,signal){
 const base=new URL(cfg.radarrUrl);base.pathname=base.pathname.replace(/\/+$/,'')+'/';
 const response=await fetch(new URL('api/v3/'+route,base),{method:'GET',headers:{'X-Api-Key':cfg.radarrApiKey,'Accept':'application/json'},redirect:'error',signal});
 if(response.status!==200){await response.body?.cancel();throw failure('radarr-unavailable');}
 return jsonResponse(response);
}

function tdarrWorkerIsBusy(nodes,file,relative,sourceRoot){
 for(const node of Object.values(nodes))for(const worker of Object.values(node?.workers||{})){
  if(!object(worker)||worker.idle||typeof worker.file!=='string')continue;
  let current=worker.file.replaceAll('\\','/');
  for(const translator of node.config?.pathTranslators||[]){
   const from=typeof translator?.node==='string'?translator.node.replaceAll('\\','/').replace(/\/$/,''):'';
   if(from&&(current===from||current.startsWith(from+'/'))){current=(translator.server||'')+current.slice(from.length);break;}
  }
  if(current===file||current===sourceRoot+'/'+relative)return true;
 }
 return false;
}

function safeRelative(value){
 return typeof value==='string'&&value.length>0&&value.length<=2048&&!value.includes('\\')&&!value.includes('\0')&&!path.posix.isAbsolute(value)&&
  !value.split('/').some(part=>!part||part==='.'||part==='..')&&path.posix.normalize(value)===value;
}

function radarrMovieContainsOriginal(root,moviePath,relative){
 if(typeof root!=='string'||typeof moviePath!=='string'||!safeRelative(relative))return false;
 const normalize=value=>value.replaceAll('\\','/').replace(/\/+$/,'');
 const normalizedRoot=normalize(root),normalizedMovie=normalize(moviePath);
 if(!path.posix.isAbsolute(normalizedRoot)||!path.posix.isAbsolute(normalizedMovie)||
   path.posix.normalize(normalizedRoot)!==normalizedRoot||path.posix.normalize(normalizedMovie)!==normalizedMovie)return false;
 const original=path.posix.join(normalizedRoot,relative);
 const movieUnderRoot=normalizedMovie===normalizedRoot||normalizedMovie.startsWith(normalizedRoot+'/');
 return movieUnderRoot&&original.startsWith(normalizedMovie+'/');
}

async function realDirectory(directory){
 const stat=await fs.lstat(directory);
 if(!stat.isDirectory()||stat.isSymbolicLink()||await fs.realpath(directory)!==directory)throw failure('unsafe-root');
 return directory;
}

async function safeParents(root,relative){
 let current=root;
 const parts=relative.split('/');
 for(const part of parts.slice(0,-1)){
  current=path.join(current,part);const stat=await fs.lstat(current);
  if(!stat.isDirectory()||stat.isSymbolicLink()||await fs.realpath(current)!==current)throw failure('unsafe-path');
 }
 return path.join(current,parts.at(-1));
}

async function digest(file){const hash=crypto.createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
async function syncDirectory(directory){const handle=await fs.open(directory,'r');try{await handle.sync();}finally{await handle.close();}}

export function createRecoverySafeRestore({data,mode=process.env.RECOVERY_MODE||'off',tdarr,control,readBinding=readRecoveryRestoreBinding}={}){
 const fenceFile=path.join(data,'recovery-restore-fence.json'),journalDir=path.join(data,'recovery-restores');
 let running=null,fenceBlocked=false;
 async function inspect(caseKey,{busy=false,details=false,operationId=null}={}){
  const response={eligible:false,mode,caseId:caseKey,title:null,bytes:null,blockers:[]};
  if(!caseId(caseKey)){response.blockers.push('invalid-case');return response;}
  const prior=await readJournal(caseKey);
  if(prior?.state==='unreadable'){response.blockers.push('restore-reconcile-required');return response;}
  response.attempt=snapshotHash({caseId:caseKey,operationId:prior?.operationId||null,revision:prior?snapshotHash(prior):null});
  if(prior&&prior.operationId!==operationId&&!(prior.state==='cancelled'&&prior.phase==='unchanged'&&prior.filesystemState==='unchanged')){response.blockers.push('restore-reconcile-required');return response;}
  const admissionFence=await readRecoveryRestoreFence({data});
  if(admissionFence.present&&!(admissionFence.valid&&admissionFence.operationId===operationId)){response.blockers.push('restore-reconcile-required');return response;}
  if(busy){response.blockers.push('busy');return response;}
  let authority;
  try{authority=await readBinding({data:path.join(data,'recovery'),mode});}
  catch{response.blockers.push('recovery-binding-unavailable');return response;}
  const cfg=authority.binding;
  const state=await readRecoveryCaseState(path.join(data,'recovery','state.json'));
  const status=await readRecoveryStatus(recoveryStatusFile(cfg.mediaRoot));
  if(!state.present||state.error||!status.present||status.error){response.blockers.push('recovery-case-unavailable');return response;}
  const c=state.cases[caseKey],published=status.status.cases.filter(value=>object(value)&&value.id===caseKey);
  const outsideSince=typeof c?.originalOutsideSince==='string'?Date.parse(c.originalOutsideSince):NaN;
  if(!object(c)||c.id!==caseKey||c.status!=='manual'||!positive(c.movieId)||!positive(c.tmdbId)||
    !positive(c.binding?.movieFileId)||!Number.isFinite(outsideSince)||!positive(c.searchCommand)||
    published.length!==1||published[0].phase!=='manual'||published[0].source!=='recovery'||published[0].tmdbId!==c.tmdbId||
    published[0].title!==c.relative?.split('/')[0]||published[0].updated!==c.updated){
   response.blockers.push('case-not-restorable');return response;
  }
  if(!safeRelative(c.relative)||typeof cfg.mediaRoot!=='string'||typeof cfg.quarantineRoot!=='string'){
   response.blockers.push('path-unavailable');return response;
  }
  try{
   const mediaRoot=await realDirectory(path.resolve(cfg.mediaRoot));
   const quarantineRoot=await realDirectory(path.resolve(cfg.quarantineRoot));
   const destination=await safeParents(mediaRoot,c.relative);
   const expectedSource=destination;
   const expectedQuarantine=path.join(quarantineRoot,caseKey,path.basename(destination));
   if(c.source!==expectedSource||c.quarantine!==expectedQuarantine){response.blockers.push('case-binding-changed');return response;}
   if(c.file!==cfg.sourceRoot+'/'+c.relative){response.blockers.push('case-binding-changed');return response;}
   const quarantine=await fs.lstat(c.quarantine);
   if(!quarantine.isFile()||quarantine.isSymbolicLink()||quarantine.nlink!==1){response.blockers.push('quarantine-unsafe');return response;}
   const current=identityOf(quarantine);
   if(!SAME.has(compareIdentity(c.fp,current))||c.preservedSourceFP!==undefined&&!SAME.has(compareIdentity(c.preservedSourceFP,current))){response.blockers.push('quarantine-changed');return response;}
   if(await missing(destination)){response.blockers.push('destination-occupied');return response;}
   const signal=AbortSignal.timeout(12000);
   let movie,queue,search,row,nodes;
   try{
    search=await radarrJson(cfg,'command/'+c.searchCommand,signal);
    const searchAt=Date.parse(search?.queued||search?.started||search?.ended||'');
    if(!object(search)||search.id!==c.searchCommand||search.name!=='MoviesSearch'||!Array.isArray(search.body?.movieIds)||!search.body.movieIds.includes(c.movieId)||search.status!=='completed'||!Number.isFinite(searchAt)||searchAt<outsideSince){response.blockers.push('search-provenance-unverified');return response;}
    movie=await radarrJson(cfg,'movie/'+c.movieId,signal);
    if(!object(movie)||movie.id!==c.movieId||movie.tmdbId!==c.tmdbId||!radarrMovieContainsOriginal(cfg.radarrRoot,movie.path,c.relative)){response.blockers.push('radarr_binding_changed');return response;}
    if(positive(movie.movieFileId)||movie.movieFile&&typeof movie.movieFile==='object'){response.blockers.push('radarr-copy-present');return response;}
    const params=new URLSearchParams([['movieId',String(c.movieId)],['page','1'],['pageSize',String(QUEUE_PAGE_SIZE)]]);
    queue=await radarrJson(cfg,'queue?'+params.toString(),signal);
   }catch{response.blockers.push('radarr_unavailable');return response;}
   if(!object(queue)||queue.page!==1||queue.pageSize!==QUEUE_PAGE_SIZE||!Number.isSafeInteger(queue.totalRecords)||queue.totalRecords<0||queue.totalRecords>QUEUE_PAGE_SIZE||!Array.isArray(queue.records)||queue.records.length!==queue.totalRecords){response.blockers.push('radarr-queue-incomplete');return response;}
   if(queue.records.some(record=>!object(record)||record.movieId!==c.movieId)){response.blockers.push('radarr-queue-ambiguous');return response;}
   if(queue.records.length){response.blockers.push('radarr-queue-not-empty');return response;}
   try{
    if(typeof tdarr!=='function')throw Error();
    nodes=await tdarr('/api/v2/get-nodes');
    if(!object(nodes)||tdarrWorkerIsBusy(nodes,c.file,c.relative,cfg.sourceRoot)){response.blockers.push('tdarr-busy-or-unavailable');return response;}
    row=await createTdarrFileState(tdarr,{libraryId:cfg.libraryId}).read(c.file);
    if(row&&!['Hold','Transcode error','Not required','Transcode success'].includes(row.TranscodeDecisionMaker)){response.blockers.push('tdarr-state-uncertain');return response;}
   }catch{response.blockers.push('tdarr-busy-or-unavailable');return response;}
   const revision=caseRevision(c),snapshot=snapshotHash({case:revision,authority:{generation:authority.generation??null,binding:recoveryRestoreBindingDigest(cfg)},mode,quarantineIdentity:current,destinationAbsent:true,
    search:searchRevision(search),movie:movieRevision(movie),queue:{page:queue.page,pageSize:queue.pageSize,totalRecords:queue.totalRecords,empty:queue.records.length===0},tdarrBusy:false,row:rowRevision(row)});
   response.eligible=true;response.title=path.basename(destination);response.bytes=quarantine.size;response.bindingRevision=authority.generation??null;response.snapshot=snapshot;
   if(details)Object.defineProperty(response,'private',{value:{cfg,authority,case:c,destination,quarantine:c.quarantine,identity:current,snapshot,caseRevision:snapshotHash(revision)},enumerable:false});
  }catch(error){response.blockers.push(error?.message==='unsafe_root'||error?.message==='unsafe_path'?'path_unsafe':'file_state_unavailable');}
  return response;
 }
 async function readJournalFile(file,caseKey){
  try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>65536)return {state:'unreadable'};const value=JSON.parse(await fs.readFile(file,'utf8'));return value?.version===1&&value.caseId===caseKey&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.operationId)&&['off','verify','repair'].includes(value.mode)&&JOURNAL_STATES.has(value.state)&&JOURNAL_PHASES.has(value.phase)&&value.journal===path.join(journalDir,caseKey+'.json')?value:{state:'unreadable'};}
  catch(error){return error?.code==='ENOENT'?null:{state:'unreadable'};}
 }
 async function readJournal(caseKey){return readJournalFile(path.join(journalDir,caseKey+'.json'),caseKey);}
 async function readOperationJournal(caseKey,operationId){
  const current=await readJournal(caseKey);if(current?.operationId===operationId)return current;
  return readJournalFile(path.join(journalDir,caseKey,operationId+'.json'),caseKey);
 }
 async function archiveJournal(record){
  const archiveDir=path.join(journalDir,record.caseId);await fs.mkdir(archiveDir,{recursive:true,mode:0o700});await syncDirectory(journalDir);
  const destination=path.join(archiveDir,record.operationId+'.json');let handle;
  try{handle=await fs.open(destination,'wx',0o600);try{await handle.writeFile(JSON.stringify(record));await handle.sync();}finally{await handle.close();}await syncDirectory(archiveDir);}
  catch(error){if(error?.code!=='EEXIST'||await fs.readFile(destination,'utf8')!==JSON.stringify(record))throw error;}
 }
 async function claimFence(record){
  await fs.mkdir(journalDir,{recursive:true,mode:0o700});
  const handle=await fs.open(fenceFile,'wx',0o600);
  try{await handle.writeFile(JSON.stringify({version:1,kind:'recovery-original-restore',operationId:record.operationId,caseId:record.caseId,blocking:true,restartAuthorized:false}));await handle.sync();}finally{await handle.close();}
  await syncDirectory(data);
  fenceBlocked=true;
 }
 async function clearFence(record){
  const current=await readRecoveryRestoreFence({data});
  if(!current.present||!current.valid||current.operationId!==record.operationId)throw failure('restore-fence-owner-changed');
  const fence=path.join(data,'recovery-restore-fence.json');
  await fs.unlink(fence);await syncDirectory(data);fenceBlocked=false;
 }
 async function authorizeRestart(record){
  const current=await readRecoveryRestoreFence({data});
  if(!current.present||!current.valid||current.operationId!==record.operationId)throw failure('restore-fence-owner-changed');
  await atomicJSON(fenceFile,{version:1,kind:'recovery-original-restore',operationId:record.operationId,caseId:record.caseId,blocking:true,restartAuthorized:true});
  await syncDirectory(data);
 }
 async function installOriginal(record,privateData,sourceHash){
  const {quarantine:source,destination,identity}=privateData;
  const sourceNow=await fs.lstat(source);
  if(!sourceNow.isFile()||sourceNow.isSymbolicLink()||sourceNow.nlink!==1||!SAME.has(compareIdentity(identity,identityOf(sourceNow))))throw failure('restore-source-changed');
  if(await missing(destination))throw failure('restore-destination-occupied');
  let crossDevice=false;
  try{await fs.link(source,destination);}catch(error){if(error?.code!=='EXDEV')throw error;crossDevice=true;}
  if(!crossDevice){
   await syncDirectory(path.dirname(destination));
   const installed=await fs.lstat(destination),stillSource=await fs.lstat(source);
   if(installed.dev!==stillSource.dev||installed.ino!==stillSource.ino||!SAME.has(compareIdentity(identity,identityOf(stillSource)))||await digest(source)!==sourceHash)throw failure('restore-install-uncertain');
   record.destinationIdentity=identityOf(installed);record.phase='destination-installed';await atomicJSON(record.journal,record);
   await fs.unlink(source);await syncDirectory(path.dirname(source));await syncDirectory(path.dirname(destination));
  }else{
   const temporary=path.join(path.dirname(destination),`.tdarr-review-restore-${record.operationId}.tmp`);
   await fs.copyFile(source,temporary,fsConstants.COPYFILE_EXCL);
   const handle=await fs.open(temporary,'r+');try{await handle.sync();}finally{await handle.close();}
   const copied=await fs.lstat(temporary);
   if(!copied.isFile()||copied.isSymbolicLink()||copied.size!==sourceNow.size||await digest(temporary)!==sourceHash)throw failure('restore-copy-unverified');
   record.temporaryIdentity=identityOf(copied);record.crossDevice=true;await atomicJSON(record.journal,record);
   await fs.link(temporary,destination);await fs.unlink(temporary);await syncDirectory(path.dirname(destination));
   const installed=await fs.lstat(destination),stillSource=await fs.lstat(source);
   if(installed.dev!==copied.dev||installed.ino!==copied.ino||installed.size!==sourceNow.size||await digest(destination)!==sourceHash||!SAME.has(compareIdentity(identity,identityOf(stillSource)))||await digest(source)!==sourceHash)throw failure('restore-copy-install-uncertain');
   record.destinationIdentity=identityOf(installed);record.phase='destination-installed';await atomicJSON(record.journal,record);
   await fs.unlink(source);await syncDirectory(path.dirname(source));await syncDirectory(path.dirname(destination));
  }
  const installed=await fs.lstat(destination);
  if(!installed.isFile()||installed.isSymbolicLink()||installed.nlink!==1)throw failure('restore-destination-uncertain');
  return identityOf(installed);
 }
 async function start(caseKey,{confirm,snapshot,attempt,owner,claimBusy=()=>{},releaseBusy=()=>{}}={}){
  if(confirm!==true)throw Object.assign(Error('restore_confirm_required'),{code:'restore_confirm_required'});
  if(running)throw Object.assign(Error('restore_busy'),{code:'restore_busy'});
  if(!caseId(caseKey))throw Object.assign(Error('restore_case_invalid'),{code:'restore_case_invalid'});
  const record={version:1,operationId:crypto.randomUUID(),caseId:caseKey,state:'running',phase:'claiming',mode,createdAt:new Date().toISOString(),journal:path.join(journalDir,caseKey+'.json')};
  running={record,owner};claimBusy(owner);
  try{
   const existing=await readJournal(caseKey);
   const expectedAttempt=snapshotHash({caseId:caseKey,operationId:existing?.operationId||null,revision:existing?snapshotHash(existing):null});
   if(typeof attempt!=='string'||attempt!==expectedAttempt)throw failure('restore-attempt-changed');
   if(existing&&!(existing.state==='cancelled'&&existing.phase==='unchanged'&&existing.filesystemState==='unchanged'))throw Object.assign(Error('restore_reconcile_required'),{code:'restore_reconcile_required',status:publicJournal(existing)});
   if(existing){const fence=await readRecoveryRestoreFence({data});if(fence.present)throw failure('restore-reconcile-required');}
   if(typeof snapshot!=='string'||!/^[a-f0-9]{64}$/.test(snapshot))throw Object.assign(Error('restore_snapshot_changed'),{code:'restore_snapshot_changed'});
   const preflight=await inspect(caseKey,{details:true});
   if(!preflight.eligible)throw Object.assign(Error('restore_not_eligible'),{code:'restore_not_eligible',blockers:preflight.blockers});
   if(preflight.snapshot!==snapshot)throw Object.assign(Error('restore_snapshot_changed'),{code:'restore_snapshot_changed'});
   record.confirmedSnapshot=snapshot;
   if(existing)await archiveJournal(existing);
   await claimFence(record);
   await atomicJSON(record.journal,record);
  }catch(error){running=null;releaseBusy(owner);throw error;}
  const work=execute(record,control).finally(()=>{if(running?.record.operationId===record.operationId){running=null;releaseBusy(owner);}});
  running.promise=work;void work.catch(()=>{});
  return {accepted:true,...publicJournal(record)};
 }
 function publicJournal(record){return {operationId:record.operationId,caseId:record.caseId,state:record.state,phase:record.phase,revision:snapshotHash(record),filesystemState:record.filesystemState||'unchanged',workerState:record.workerState||'unknown',crossDevice:record.crossDevice===true,updatedAt:record.updatedAt||record.createdAt,error:record.error||null,blockers:Array.isArray(record.blockers)?record.blockers:[]};}
 async function status(caseKey){const record=await readJournal(caseKey);return record?publicJournal(record):{state:'idle',caseId:caseKey,revision:null};}
 async function execute(record,ctl){
  let stopped=false,controlClaimed=false,initial=null;
  const save=async(phase,extra={})=>{Object.assign(record,extra,{phase,updatedAt:new Date().toISOString()});await atomicJSON(record.journal,record);};
  try{
   await save('draining');
   if(!ctl)throw failure('recovery-control-unavailable');
   controlClaimed=true;
   const drain=await ctl.requestDrain(record.operationId);
   if(!['ready','off','draining'].includes(drain.state))throw failure('recovery-drain-failed');
   const ready=['ready','off'].includes(drain.state)?drain:await ctl.wait(record.operationId);
   if(!['ready','off'].includes(ready.state))throw failure('recovery-drain-failed');
   const stop=await ctl.stopAfterDrain(record.operationId);stopped=stop.state==='stopped';
   if(!stopped&&mode!=='off')throw failure('recovery-stop-unconfirmed');
   record.workerStopped=stopped&&mode!=='off';record.workerState=mode==='off'?'off':'stopped';await atomicJSON(record.journal,record);
   initial=await inspect(record.caseId,{details:true,operationId:record.operationId});
   if(!initial.eligible)throw Object.assign(failure('restore-not-eligible'),{blockers:initial.blockers});
   if(initial.snapshot!==record.confirmedSnapshot)throw Object.assign(Error('restore_snapshot_changed'),{code:'restore_snapshot_changed'});
   const evidence=initial.private;
   Object.assign(record,{sourceIdentity:evidence.identity,bindingRevision:evidence.authority.generation??null,bindingHash:recoveryRestoreBindingDigest(evidence.cfg),caseRevision:evidence.caseRevision,sourcePath:evidence.quarantine,destinationPath:evidence.destination,movieId:evidence.case.movieId,tmdbId:evidence.case.tmdbId});
   record.sourceHash=await digest(evidence.quarantine);await save('installing');
   const destinationIdentity=await installOriginal(record,evidence,record.sourceHash);
   await writeRecoveryRestoreEvidence({data,operationId:record.operationId,caseId:record.caseId,movieId:evidence.case.movieId,tmdbId:evidence.case.tmdbId,file:evidence.case.file,identity:destinationIdentity,cfg:evidence.cfg,restoredAt:new Date().toISOString()});
   Object.assign(record,{state:'resuming',phase:'resuming',filesystemState:'restored',destinationIdentity,filesystemCompletedAt:new Date().toISOString()});
   await atomicJSON(record.journal,record);
   if(stopped&&mode!=='off'){
    await authorizeRestart(record);record.restartAuthorized=true;await atomicJSON(record.journal,record);
    await ctl.restart(record.operationId);
    const started=await ctl.wait(record.operationId);
    if(!['running','off'].includes(started.state))throw failure('recovery-restart-unconfirmed');
    record.workerState=started.state;
   }
   record.state='completed';record.phase='completed';record.completedAt=new Date().toISOString();await atomicJSON(record.journal,record);
   await clearFence(record);
  }catch(error){
   record.state='blocked';record.error=error?.code||'restore_operation_uncertain';record.blockers=error?.blockers||undefined;
   await atomicJSON(record.journal,record).catch(()=>{});
   // The fence stays while any worker stop or file outcome is uncertain.
   if(!controlClaimed&&!stopped){try{await clearFence(record);}catch{}}
  }
 }
 async function reconcile(caseKey,{confirm,operationId,revision,owner,claimBusy=()=>{},releaseBusy=()=>{}}={}){
  if(confirm!==true)throw Object.assign(Error('restore_reconcile_confirm_required'),{code:'restore_reconcile_confirm_required'});
  if(!caseId(caseKey))throw Object.assign(Error('restore_case_invalid'),{code:'restore_case_invalid'});
  if(typeof operationId!=='string'||!RESTORE_OPERATION_ID.test(operationId)||typeof revision!=='string')throw failure('restore-reconcile-confirmation-changed');
  const record=await readOperationJournal(caseKey,operationId);
  if(!record||record.state==='unreadable')throw Object.assign(Error('restore_reconcile_unavailable'),{code:'restore_reconcile_unavailable'});
  if(snapshotHash(record)!==revision)throw failure('restore-reconcile-confirmation-changed');
  const current=await readJournal(caseKey);
  if(current?.operationId!==record.operationId){if(['completed','cancelled'].includes(record.state))return publicJournal(record);throw failure('restore-reconcile-confirmation-changed');}
  if(['completed','cancelled'].includes(record.state)){
   const terminalFence=await readRecoveryRestoreFence({data});if(terminalFence.present)throw failure('restore-reconcile-confirmation-changed');
   return publicJournal(record);
  }
  if(running)throw Object.assign(Error('restore_busy'),{code:'restore_busy'});
  running={record,owner};claimBusy(owner);
  try{
   const fence=await readRecoveryRestoreFence({data});
   if(!fence.present||!fence.valid||fence.operationId!==record.operationId)throw failure('restore-fence-owner-changed');
   const state=await readRecoveryCaseState(path.join(data,'recovery','state.json'));
   if(!state.present||state.error||!object(state.cases[caseKey]))throw failure('restore-case-unavailable');
   const c=state.cases[caseKey];let authority;
   try{authority=await readBinding({data:path.join(data,'recovery'),mode});}catch{throw failure('restore-binding-unavailable');}
   if(record.bindingHash&&record.bindingHash!==recoveryRestoreBindingDigest(authority.binding)||record.bindingRevision!==null&&record.bindingRevision!==undefined&&record.bindingRevision!==authority.generation)throw failure('restore-binding-changed');
   if(record.caseRevision&&record.caseRevision!==snapshotHash(caseRevision(c)))throw failure('restore-case-snapshot-changed');
   const fileEffect=record.filesystemState==='restored'||['installing','destination-installed','resuming','completed'].includes(record.phase);
   if(fileEffect){
    const binding=authority.binding;
    if(record.mode!==mode||typeof record.bindingHash!=='string'||record.bindingHash!==recoveryRestoreBindingDigest(binding)||record.bindingRevision!==authority.generation||
     typeof record.caseRevision!=='string'||record.caseRevision!==snapshotHash(caseRevision(c))||!caseId(record.caseId)||
     !positive(record.movieId)||record.movieId!==c.movieId||!positive(record.tmdbId)||record.tmdbId!==c.tmdbId||
     typeof record.confirmedSnapshot!=='string'||!/^[a-f0-9]{64}$/.test(record.confirmedSnapshot)||
     typeof record.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(record.sourceHash)||typeof record.sourceIdentity!=='string'||
     compareIdentity(record.sourceIdentity,record.sourceIdentity)!=='same'||typeof record.sourcePath!=='string'||typeof record.destinationPath!=='string')throw failure('restore-journal-unproven');
    if(!safeRelative(c.relative)||typeof binding.mediaRoot!=='string'||typeof binding.quarantineRoot!=='string')throw failure('restore-case-binding-changed');
    const mediaRoot=await realDirectory(path.resolve(binding.mediaRoot)),quarantineRoot=await realDirectory(path.resolve(binding.quarantineRoot));
    const expectedDestination=await safeParents(mediaRoot,c.relative),expectedSource=await safeParents(quarantineRoot,caseKey+'/'+path.basename(expectedDestination));
    if(c.source!==expectedDestination||c.quarantine!==expectedSource||c.file!==binding.sourceRoot+'/'+c.relative||
      record.destinationPath!==expectedDestination||record.sourcePath!==expectedSource)throw failure('restore-case-binding-changed');
   }
   const destinationExists=Boolean(record.destinationPath&&await missing(record.destinationPath));
   if(record.filesystemState==='restored'||record.phase==='destination-installed'||record.phase==='installing'&&destinationExists){
    const destination=record.destinationPath,source=record.sourcePath,installed=await fs.lstat(destination);
    if(!installed.isFile()||installed.isSymbolicLink()||await digest(destination)!==record.sourceHash)throw failure('restore-destination-unproven');
    let sourceNow=null;try{sourceNow=await fs.lstat(source);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(record.destinationIdentity){if(!SAME.has(compareIdentity(record.destinationIdentity,identityOf(installed))))throw failure('restore-destination-unproven');}
    else if(record.crossDevice&&record.temporaryIdentity){if(!SAME.has(compareIdentity(record.temporaryIdentity,identityOf(installed))))throw failure('restore-destination-unproven');}
    else if(!sourceNow||sourceNow.dev!==installed.dev||sourceNow.ino!==installed.ino)throw failure('restore-destination-unproven');
    if(sourceNow){
     if(!sourceNow.isFile()||sourceNow.isSymbolicLink()||!SAME.has(compareIdentity(record.sourceIdentity,identityOf(sourceNow)))||await digest(source)!==record.sourceHash)throw failure('restore-source-unproven');
     if(record.crossDevice){if(sourceNow.nlink!==1||installed.nlink!==1)throw failure('restore-link-unproven');}
     else if(sourceNow.dev!==installed.dev||sourceNow.ino!==installed.ino||sourceNow.nlink!==2||installed.nlink!==2)throw failure('restore-link-unproven');
    }else if(installed.nlink!==1)throw failure('restore-link-unproven');
    if(c.status!=='manual'||c.file!==authority.binding.sourceRoot+'/'+c.relative||c.movieId!==record.movieId&&record.movieId!==undefined)throw failure('restore-case-binding-changed');
    if(sourceNow){await fs.unlink(source);await syncDirectory(path.dirname(source));await syncDirectory(path.dirname(destination));}
    const verified=await fs.lstat(destination);if(!verified.isFile()||verified.isSymbolicLink()||verified.nlink!==1||await digest(destination)!==record.sourceHash)throw failure('restore-destination-unproven');
    await writeRecoveryRestoreEvidence({data,operationId:record.operationId,caseId:caseKey,movieId:c.movieId,tmdbId:c.tmdbId,file:c.file,identity:identityOf(verified),cfg:authority.binding,restoredAt:record.filesystemCompletedAt||new Date().toISOString()});
    record.destinationIdentity=identityOf(verified);record.filesystemState='restored';
   }else{
    const current=await inspect(caseKey,{details:true,operationId:record.operationId});
    if(!current.eligible||record.sourceIdentity&&!SAME.has(compareIdentity(record.sourceIdentity,current.private.identity)))throw failure('restore-unchanged-state-unproven');
    if(await missing(current.private.destination)!==null)throw failure('restore-destination-occupied');
    const controlState=mode==='off'?{state:'off'}:await control?.restoreStatus(record.operationId);
    if(!controlState)throw failure('recovery-control-unavailable');
    if(controlState.state==='stopped'){
     await authorizeRestart(record);await control.restart(record.operationId);const started=await control.wait(record.operationId);
     if(!['running','off'].includes(started.state))throw failure('recovery-restart-unconfirmed');record.workerState=started.state;
    }else if(['draining','ready'].includes(controlState.state)){
     await control.cancel(record.operationId);const cancelled=await control.restoreStatus(record.operationId);
     if(!['cancelled','off'].includes(cancelled.state))throw failure('recovery-cancel-unconfirmed');
    }else if(!['off','running','cancelled','failed'].includes(controlState.state))throw failure('recovery-control-outcome-unknown');
    record.filesystemState='unchanged';record.state='cancelled';record.phase='unchanged';record.cancelledAt=new Date().toISOString();await atomicJSON(record.journal,record);await clearFence(record);return publicJournal(record);
   }
   if(record.workerStopped&&mode!=='off'){
    const controlState=await control?.restoreStatus(record.operationId);
    if(controlState?.state==='stopped'){
     await authorizeRestart(record);await control.restart(record.operationId);const started=await control.wait(record.operationId);
     if(!['running','off'].includes(started.state))throw failure('recovery-restart-unconfirmed');record.workerState=started.state;
    }else if(controlState?.state==='running')record.workerState='running';
    else throw failure('recovery-worker-resume-unverified');
   }else if(mode==='off')record.workerState='off';
   record.state='completed';record.phase='completed';record.completedAt=record.completedAt||new Date().toISOString();await atomicJSON(record.journal,record);await clearFence(record);return publicJournal(record);
  }catch(error){
   record.state='blocked';record.error=error?.code||'restore-reconcile-unverified';await atomicJSON(record.journal,record).catch(()=>{});throw Object.assign(Error(record.error),{code:record.error,status:publicJournal(record)});
  }finally{running=null;releaseBusy(owner);}
 }
 async function initialize(){
  const value=await readRecoveryRestoreFence({data});fenceBlocked=value.present;
 }
 return {inspect,start,status,reconcile,initialize,get busy(){return !!running||fenceBlocked;}};
}
