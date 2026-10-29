// @ts-check
import hevcSDR from './hevc-sdr.cjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import hdr10 from './hdr10.cjs';
import dv81 from './dv81.cjs';
import dualHDR from './dual-hdr.cjs';
import legacySDR from './legacy-sdr.cjs';
import hdrExtra from './hdr-extra.cjs';
import dv7to81 from './dv7to81.cjs';
import {identityOf,compareIdentity} from '../recovery/file-identity.mjs';

/**
 * Durable exchange journal written by replaceChecked() and read by recoverTransactions().
 * @typedef {object} TransactionJournal
 * @property {string} id
 * @property {string} original Absolute path of the original film.
 * @property {string} review Absolute path of the reviewed result.
 * @property {string} destination Installed path (the original path, or .mkv for a .ts/.m2ts original).
 * @property {string} tmp Verified copy next to the original.
 * @property {string} backup Original kept until the exchange completes.
 * @property {string} originalFP identityOf() of the original when reviewed.
 * @property {string} reviewFP identityOf() of the result when reviewed.
 * @property {'preparing'|'syncing-copy'|'verifying-copy'|'ready'|'original-backed-up'|'installed'|'original-removed'|'complete'|'aborted'} phase
 * @property {string} created ISO time.
 * @property {string} [error] Why the exchange stopped.
 * @property {string} [rollbackError] Why restoring the original failed, if it did.
 * @property {string} [retainedOriginal] TV original retained under its separate quarantine root.
 * @property {string} [retainedRoot] Canonical TV quarantine directory pinned during installation.
 * @property {string} [retainedLeaf] Quarantine entry name for the retained TV original.
 * @property {string} [retainedTemp] Pending quarantine entry path.
 * @property {string} [retainedTempLeaf] Pending quarantine entry name.
 * @property {'intent'|'verified'} [retainedPhase] Durable retained-original journal phase.
 * @property {string} [retainedFP] Identity of the retained original copy.
 * @property {string} [retainedHash] SHA-256 of the retained original copy.
 */
/** @typedef {{path:string,stat:import('node:fs').Stats,fp:string}} SafeFile */
/** @typedef {{done:number,total:number,unit?:string,phase?:string,speed?:number|null}} TransferProgress */

/** @param {string|Buffer} s */
export const hash = s => crypto.createHash('sha256').update(s).digest('hex');
/**
 * Resolves a regular, single-link file strictly inside root.
 * @param {string} root
 * @param {string} relative
 * @returns {Promise<SafeFile>}
 */
export async function safeFile(root, relative) {
  if (!relative || relative.includes('\\') || path.isAbsolute(relative) || relative.split('/').some(x=>!x||x==='.'||x==='..')) throw new Error('Neplatná cesta souboru.');
  const base=await fs.realpath(root), full=path.join(base,relative);
  let walk=base;
  for(const part of relative.split('/')) {walk=path.join(walk,part);if((await fs.lstat(walk)).isSymbolicLink()) throw new Error('Symbolické odkazy nejsou povolené.');}
  const resolved=await fs.realpath(full);
  if(!resolved.startsWith(base+path.sep)) throw new Error('Soubor je mimo povolenou složku.');
  const stat=await fs.stat(resolved);
  if(!stat.isFile() || stat.nlink!==1) throw new Error('Soubor není běžný soubor nebo má více pevných odkazů.');
  return {path:resolved,stat,fp:identityOf(stat)};
}
export async function atomicJSON(file,data) {
  const tmp=file+'.new';
  const h=await fs.open(tmp,'w',0o600);
  try {await h.writeFile(JSON.stringify(data,null,2));await h.sync();} finally {await h.close();}
  await fs.rename(tmp,file);
  const dir=await fs.open(path.dirname(file),'r');try{await dir.sync();}finally{await dir.close();}
}
async function syncDirectory(dir) {
  const h=await fs.open(dir,'r');try{await h.sync()}finally{await h.close()}
}
const procPath=(directory,name)=>`/proc/self/fd/${directory.handle.fd}/${name}`;
async function openDirectoryPathNoFollow(root){
 const flags=fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW;let parent=await fs.open(path.parse(root).root,flags);
 try{
  for(const part of root.slice(path.parse(root).root.length).split(path.sep).filter(Boolean)){
   const via=`/proc/self/fd/${parent.fd}/${part}`,before=await fs.lstat(via);if(before.isSymbolicLink()||!before.isDirectory())throw Error('Kořen trvalé karantény není bezpečný adresář.');
   const next=await fs.open(via,flags);const opened=await next.stat(),named=await fs.lstat(via);
   if(!opened.isDirectory()||named.isSymbolicLink()||opened.dev!==before.dev||opened.ino!==before.ino||named.dev!==opened.dev||named.ino!==opened.ino){await next.close();throw Error('Kořen trvalé karantény se změnil.');}
   await parent.close();parent=next;
  }
  const result=parent;parent=null;return result;
 }finally{await parent?.close().catch(()=>{})}
}
async function openRetainedDirectory(root,target){
  if(process.platform!=='linux')throw Error('Trvalá karanténa vyžaduje Linux.');
  const resolved=await fs.realpath(root),relative=path.relative(resolved,target);
  if(resolved!==root||path.isAbsolute(relative)||!relative||relative.includes(path.sep)||relative==='.'||relative==='..')throw Error('Cesta trvalé karantény je mimo bezpečný kořen.');
 const handle=await openDirectoryPathNoFollow(root),after=await handle.stat();
 if(!after.isDirectory()){await handle.close();throw Error('Kořen trvalé karantény není bezpečný adresář.');}
  return {handle,root:resolved,leaf:relative,stat:after};
}
async function sha256Handle(handle){
  const digest=crypto.createHash('sha256'),buffer=Buffer.alloc(4*1024*1024);let position=0;
  while(true){const {bytesRead}=await handle.read(buffer,0,buffer.length,position);if(!bytesRead)break;digest.update(buffer.subarray(0,bytesRead));position+=bytesRead;}
  return digest.digest('hex');
}
async function verifyRetainedDirectory(directory){
  const named=await openDirectoryPathNoFollow(directory.root);try{const actual=await named.stat(),opened=await directory.handle.stat();if(actual.dev!==directory.stat.dev||actual.ino!==directory.stat.ino||opened.dev!==actual.dev||opened.ino!==actual.ino)throw Error('Kořen trvalé karantény se změnil.');}finally{await named.close()}
}
async function validateRetainedCopy(record,directory){
  if(!directory||record.retainedPhase!=='verified')throw Error('Trvalý originál není ověřený.');
  if(record.retainedRoot!==directory.root)throw Error('Kořen trvalé karantény se změnil.');
  await verifyRetainedDirectory(directory);
  const handle=await fs.open(procPath(directory,record.retainedLeaf),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    const stat=await handle.stat(),named=await fs.lstat(procPath(directory,record.retainedLeaf));
    if(!stat.isFile()||named.isSymbolicLink()||stat.nlink!==1||compareIdentity(record.retainedFP,identityOf(stat))!=='same'||identityOf(named)!==identityOf(stat)||stat.dev!==directory.stat.dev)throw Error('Identita trvalého originálu se změnila.');
    if(await sha256Handle(handle)!==record.retainedHash)throw Error('Kontrolní součet trvalého originálu se změnil.');
  }finally{await handle.close()}
}
async function makeRetainedCopy(original,originalFP,record,directory){
  const source=await fs.open(original,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW),sourceStat=await source.stat();
    const target=await fs.open(procPath(directory,record.retainedTempLeaf),fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{
    if(!sourceStat.isFile()||sourceStat.nlink!==1||identityOf(sourceStat)!==originalFP||sourceStat.dev!==directory.stat.dev)throw Error('Originál nebo karanténa se změnily před zkopírováním.');
    const buffer=Buffer.alloc(4*1024*1024);let position=0;
    while(position<sourceStat.size){const amount=Math.min(buffer.length,sourceStat.size-position),read=await source.read(buffer,0,amount,position);if(read.bytesRead!==amount)throw Error('Originál se změnil při kopírování do karantény.');let written=0;while(written<amount){const result=await target.write(buffer,written,amount-written,position+written);if(!result.bytesWritten)throw Error('Zápis trvalého originálu selhal.');written+=result.bytesWritten;}position+=amount;}
    // chown can clear set-id bits, so set ownership before restoring the exact mode.
    // If the caller cannot preserve the original owner and group, fail before install.
    await target.chown(sourceStat.uid,sourceStat.gid);
    await target.chmod(sourceStat.mode&0o7777);
    await target.sync();
    const sourceAfter=await source.stat(),targetStat=await target.stat();
    if(identityOf(sourceAfter)!==originalFP||targetStat.size!==sourceStat.size||targetStat.dev!==sourceStat.dev||targetStat.nlink!==1||targetStat.uid!==sourceStat.uid||targetStat.gid!==sourceStat.gid||(targetStat.mode&0o7777)!==(sourceStat.mode&0o7777))throw Error('Originál nebo jeho karanténní kopie se změnily.');
    const originalHash=await sha256Handle(source),retainedHash=await sha256Handle(target);
    if(originalHash!==retainedHash||identityOf(await source.stat())!==originalFP)throw Error('Kontrolní součet trvalé kopie nesouhlasí.');
    record.retainedHash=retainedHash;
  }finally{await Promise.all([source.close(),target.close()]);}
  await fs.link(procPath(directory,record.retainedTempLeaf),procPath(directory,record.retainedLeaf));
  await fs.unlink(procPath(directory,record.retainedTempLeaf));await directory.handle.sync();
  const retainedStat=await fs.stat(procPath(directory,record.retainedLeaf));record.retainedFP=identityOf(retainedStat);
  record.retainedPhase='verified';await validateRetainedCopy(record,directory);
}
const statOrMissing=async file=>{try{return await fs.lstat(file)}catch(e){if(e.code==='ENOENT')return null;throw e}};
// Renaming changes ctime. Device, inode, size and mtime still identify the saved original.
// A recorded identity that cannot be read never matches; its journal stays for inspection.
const readableIdentity=fp=>compareIdentity(fp,fp)!=='invalid';
const originalIdentity=(stat,fp)=>stat?.isFile()&&!stat.isSymbolicLink()&&['same','ctime-changed'].includes(compareIdentity(fp,identityOf(stat)));
/** @param {TransactionJournal} record */
async function restoreBackup(record) {
  if(record.destination&&record.destination!==record.original&&await statOrMissing(record.destination))return false;
  let original=await statOrMissing(record.original),backup=await statOrMissing(record.backup);
  if(!backup)return originalIdentity(original,record.originalFP);
  if(!originalIdentity(backup,record.originalFP))return false;
  if(!original){
    // link() cannot overwrite a file that appears concurrently at the original path.
    await fs.link(record.backup,record.original);
    await syncDirectory(path.dirname(record.original));
    original=await fs.lstat(record.original);
  }
  if(!originalIdentity(original,record.originalFP)||original.dev!==backup.dev||original.ino!==backup.ino)return false;
  // Both paths now name the original inode; removing this extra name loses no data.
  await fs.unlink(record.backup);await syncDirectory(path.dirname(record.original));
  return true;
}
/** @param {TransactionJournal} t */
function validJournalPaths(t) {
  return typeof t.id==='string'&&/^[A-Za-z0-9_-]+$/.test(t.id)&&typeof t.original==='string'&&path.isAbsolute(t.original)
    &&typeof t.review==='string'&&path.isAbsolute(t.review)
    &&t.tmp===path.join(path.dirname(t.original),`.tdarr-review-${t.id}.tmp`)
    &&t.backup===path.join(path.dirname(t.original),`.tdarr-review-${t.id}.old`)
    &&(!t.destination||validDestination(t.original,t.destination))
    &&(!t.retainedOriginal||typeof t.retainedRoot==='string'&&path.isAbsolute(t.retainedRoot)&&path.dirname(t.retainedOriginal)===t.retainedRoot&&path.basename(t.retainedOriginal)===t.retainedLeaf&&t.retainedTempLeaf===t.retainedLeaf+'.'+t.id+'.pending'&&t.retainedTemp===path.join(t.retainedRoot,t.retainedTempLeaf)&&['intent','verified'].includes(t.retainedPhase)&&(!t.retainedFP||readableIdentity(t.retainedFP))&&(!t.retainedHash||/^[a-f0-9]{64}$/.test(t.retainedHash)));
}
function validDestination(original,destination){return destination===original||(/\.(m2ts|ts)$/i.test(original)&&destination===original.replace(/\.(m2ts|ts)$/i,'.mkv'))}
// Recovery only rolls back a provably untouched original. Installed/uncertain files
// remain in place for inspection, and callers must keep owned Tdarr pauses held.
export async function recoverTransactions(directory) {
  const pending=[];
  for(const name of await fs.readdir(directory)){
    if(!name.endsWith('.json'))continue;
    const journal=path.join(directory,name);let t;
    try{
      t=JSON.parse(await fs.readFile(journal,'utf8'));
      if(['complete','aborted'].includes(t.phase))continue;
      if(!validJournalPaths(t))throw new Error('Neplatné cesty v záznamu výměny.');
      if(!readableIdentity(t.originalFP)||t.reviewFP!==undefined&&!readableIdentity(t.reviewFP))throw new Error('Neplatná identita souboru v záznamu výměny.');
      if(t.retainedOriginal){
        const retainedDirectory=await openRetainedDirectory(t.retainedRoot,t.retainedOriginal);
        try{await validateRetainedCopy(t,retainedDirectory)}finally{await retainedDirectory.handle.close()}
      }
      if(['preparing','syncing-copy','verifying-copy','ready','original-backed-up'].includes(t.phase)&&await restoreBackup(t)){
        // Keep any unfinished replacement copy. Recovery does not delete new content.
        t.phase='aborted';t.recoveredAt=new Date().toISOString();
        t.recoveryNote='Originál je zachovaný; nedokončená výměna nebyla opakována.';
        await atomicJSON(journal,t);continue;
      }
      pending.push({...t,journal});
    }catch(e){pending.push({...t,id:t?.id||name,phase:t?.phase||'unknown',journal,error:e.message})}
  }
  return pending;
}
/**
 * @param {string} file
 * @param {(done:number)=>void} [onProgress]
 */
export async function sha256(file,onProgress=()=>{}) {
  const h=await fs.open(file,'r'), digest=crypto.createHash('sha256');
  let done=0,last=0;
  try {for await(const chunk of h.createReadStream({autoClose:false})) {digest.update(chunk);done+=chunk.length;if(Date.now()-last>=1000){last=Date.now();onProgress(done)}}onProgress(done);}finally{await h.close();}
  return digest.digest('hex');
}
/**
 * @param {string} exe
 * @param {string[]} args
 * @param {{timeout?:number,onLine?:(line:string)=>void,onStdout?:(chunk:string)=>void}} [options]
 * @returns {Promise<string>}
 */
export function command(exe,args,{timeout=120000,onLine,onStdout}={}) {
  return new Promise((resolve,reject)=>{
    const p=spawn(exe,args,{stdio:['ignore','pipe','pipe']});let out='',err='';
    const timer=setTimeout(()=>{p.kill('SIGKILL');reject(new Error('Kontrola překročila časový limit.'));},timeout);
    p.stdout.on('data',x=>{if(onStdout){onStdout(String(x));return}out+=x;if(out.length>2000000){p.kill();reject(new Error('Příliš velký výstup kontroly.'));}});
    p.stderr.on('data',x=>{err=(err+x).slice(-5000);onLine?.(String(x));});
    p.on('error',e=>{clearTimeout(timer);reject(e)});
    p.on('close',code=>{clearTimeout(timer);code===0?resolve(out):reject(new Error('Kontrola souboru selhala: '+err.slice(-1000)))});
  });
}
export async function probe(exe,file) {
  const p=JSON.parse(await command(exe,['-v','error','-show_streams','-show_format','-show_chapters','-of','json',file]));
  if(p.streams.some(s=>s.codec_type==='video'&&s.codec_name==='hevc'&&(s.color_transfer==='smpte2084'||s.side_data_list?.some(d=>d.side_data_type==='DOVI configuration record'))))p.hdr10=await hdr10.probeHDR(exe,file);
  return p;
}
export function inspect(original,review) {
  const a=original.streams.filter(s=>s.codec_type==='video'&&!s.disposition?.attached_pic);
  const b=review.streams.filter(s=>s.codec_type==='video'&&!s.disposition?.attached_pic);
  // Each failed rule names itself so a blocked film says which check it did not pass (docs/USER-GUIDE.md).
  if(a.length!==1)throw new Error('Originál nemá právě jednu video stopu. Počet video stop: '+a.length);
  if(b.length!==1)throw new Error('Výsledek nemá právě jednu video stopu. Počet video stop: '+b.length);
  if(!['h264','hevc','vc1','mpeg2video'].includes(a[0].codec_name))throw new Error('Kodek originálu není podporovaný (povolené jsou h264, hevc, vc1 a mpeg2video): '+(a[0].codec_name||'?'));
  if(b[0].codec_name!=='hevc')throw new Error('Výsledek není HEVC: '+(b[0].codec_name||'?'));
  if(b[0].pix_fmt!=='yuv420p10le')throw new Error('Výsledek nemá 10bitový formát pixelů yuv420p10le: '+(b[0].pix_fmt||'?'));
  if(a[0].width!==b[0].width||a[0].height!==b[0].height)throw new Error('Rozlišení výsledku se liší od originálu (výsledek / originál): '+`${b[0].width}×${b[0].height} / ${a[0].width}×${a[0].height}`);
  if(['vc1','mpeg2video'].includes(a[0].codec_name))legacySDR.compare(original,review);
  if(a[0].codec_name==='hevc'&&review.format?.tags?.TDARR_SDR_PROFILE===hevcSDR.MARKER)hevcSDR.compare(original,review);
  else if(a[0].codec_name==='hevc'){
    if(original.format?.tags?.TDARR_HDR_PROFILE)throw new Error('Originál již má značku dokončeného HDR převodu.');
    if(review.format?.tags?.TDARR_HDR_PROFILE===dualHDR.MARKER)dualHDR.compare(original.hdr10,review.hdr10);
    else if(review.format?.tags?.TDARR_HDR_PROFILE===dv81.MARKER)dv81.compare(original.hdr10,review.hdr10);
    else if(review.format?.tags?.TDARR_HDR_PROFILE===hdrExtra.PLUS)hdrExtra.compare(original.hdr10,review.hdr10,'plus');
    else if(review.format?.tags?.TDARR_HDR_PROFILE===hdrExtra.P7)hdrExtra.compare(original.hdr10,review.hdr10,'p7');
    else if(review.format?.tags?.TDARR_HDR_PROFILE===dv7to81.MARKER)dv7to81.compare(original.hdr10,review.hdr10);
    else {
      if(review.format?.tags?.TDARR_HDR_PROFILE!==hdr10.MARKER)throw new Error('HEVC výsledek nepochází z povoleného HDR profilu.');
      hdr10.compareHDR(original.hdr10,review.hdr10);
    }
  }
  if(!review.streams.some(s=>s.codec_type==='audio')) throw new Error('Výsledek neobsahuje zvuk.');
  const durationA=Number(original.format.duration),durationB=Number(review.format.duration);
  if(!Number.isFinite(durationA)||!Number.isFinite(durationB)||durationA<=0||durationB<=0) throw new Error('Nelze ověřit délku filmu.');
  const ratio=durationB/durationA*100;
  const sig=s=>[s.codec_type,s.codec_name,s.channels||0,s.tags?.language||'und'].join('|');
  const originalTracks=original.streams.filter(s=>['audio','subtitle'].includes(s.codec_type)).map(sig);
  for(const s of review.streams.filter(s=>['audio','subtitle'].includes(s.codec_type))) {
    const i=originalTracks.indexOf(sig(s));if(i<0) throw new Error('Zvuk nebo titulky neodpovídají originálu.');originalTracks.splice(i,1);
  }
  if((original.chapters||[]).length!==(review.chapters||[]).length) throw new Error('Nesouhlasí počet kapitol.');
  return {evidenceVersion:1,videoSummary:`${a[0].codec_name} → ${b[0].codec_name}, ${b[0].width}×${b[0].height}, ${b[0].pix_fmt}`,audioBefore:original.streams.filter(s=>s.codec_type==='audio').length,subtitlesBefore:original.streams.filter(s=>s.codec_type==='subtitle').length,removedTracks:originalTracks,chapterCount:(review.chapters||[]).length,durationA,durationB,durationRatio:ratio,durationMismatch:ratio<99.99||ratio>100.01,
    audio:review.streams.filter(s=>s.codec_type==='audio').map(s=>s.tags?.language||'neoznačeno'),
    subtitles:review.streams.filter(s=>s.codec_type==='subtitle').map(s=>s.tags?.language||'neoznačeno')};
}

// Caller holds the application mutex and pauses Tdarr dispatch before invoking.
// Only exact, unchanged files can reach the rename. A durable journal tracks every stage.
/**
 * @param {object} options
 * @param {string} options.original
 * @param {string} options.review
 * @param {string} [options.destination]
 * @param {string} options.originalFP
 * @param {string} options.reviewFP
 * @param {string} options.journal Path of the TransactionJournal file.
 * @param {{root:string,path:string}} [options.retainOriginal] Optional retained-original copy (TV only).
 * @param {(phase:TransactionJournal['phase'])=>void} [options.onStage]
 * @param {(progress:TransferProgress)=>void} [options.onProgress]
 * @param {()=>Promise<void>} [options.beforeCommit]
 */
export async function replaceChecked({original,review,destination=original,originalFP,reviewFP,journal,retainOriginal,onStage=()=>{},onProgress=()=>{},beforeCommit=async()=>{}}) {
  if(!validDestination(original,destination))throw Error('Nepovolená cílová cesta převodu.');
  const check=async()=>{
    const [originalStat,reviewStat]=await Promise.all([fs.stat(original),fs.stat(review)]);
    if(identityOf(originalStat)!==originalFP||identityOf(reviewStat)!==reviewFP||retainOriginal&&(originalStat.nlink!==1||reviewStat.nlink!==1)) throw new Error('Soubor se od kontroly změnil nebo má pevný odkaz. Obnov přehled.');
    if(destination!==original&&await statOrMissing(destination))throw Error('Cílový MKV již existuje; nebude přepsán.');
  };
  await check();
  const id=crypto.randomUUID(),tmp=path.join(path.dirname(original),`.tdarr-review-${id}.tmp`),backup=path.join(path.dirname(original),`.tdarr-review-${id}.old`);
  let retainedDirectory=null,retainedTemp,retainedTempLeaf,retainedLeaf;
  if(retainOriginal){
    try{
      retainedDirectory=await openRetainedDirectory(retainOriginal.root,retainOriginal.path);retainedLeaf=retainedDirectory.leaf;retainedTempLeaf=retainedLeaf+'.'+id+'.pending';retainedTemp=path.join(retainedDirectory.root,retainedTempLeaf);
      const [sourceStat,existing,sourceSpace,targetSpace,reviewStat]=await Promise.all([fs.stat(original),statOrMissing(procPath(retainedDirectory,retainedLeaf)),fs.statfs(path.dirname(original)).catch(()=>null),fs.statfs(`/proc/self/fd/${retainedDirectory.handle.fd}`).catch(()=>null),fs.stat(review)]);
      if(existing)throw Error('Cíl trvalé karantény již existuje.');
      if(sourceStat.nlink!==1||sourceStat.dev!==retainedDirectory.stat.dev)throw Error('Trvalá karanténa musí být na stejném souborovém systému jako originál.');
      if(!sourceSpace||!targetSpace||sourceSpace.bavail*sourceSpace.bsize<reviewStat.size+sourceStat.size||targetSpace.bavail*targetSpace.bsize<sourceStat.size)throw Error('Nedostatek ověřitelného místa pro trvalou karanténu nebo výměnu.');
    }catch(error){await retainedDirectory?.handle.close().catch(()=>{});throw error}
  }
  /** @type {TransactionJournal} */
  const record={id,original,review,destination,tmp,backup,originalFP,reviewFP,phase:'preparing',created:new Date().toISOString(),...(retainOriginal?{retainedOriginal:retainOriginal.path,retainedRoot:retainedDirectory.root,retainedTemp,retainedTempLeaf,retainedLeaf,retainedPhase:'intent'}:{})};
  const save=async phase=>{record.phase=phase;await atomicJSON(journal,record);onStage(phase);};
  let movedOriginal=false;
  try {
    await save('preparing');
    const size=(await fs.stat(review)).size;
    onProgress({phase:'preparing',done:0,total:size,unit:'bytes'});
    let copying=true;
    const poll=setInterval(()=>{fs.stat(tmp).then(s=>{if(copying)onProgress({phase:'preparing',done:Math.min(size,s.size),total:size,unit:'bytes'})}).catch(()=>{});},1000);
    try{await fs.copyFile(review,tmp,fs.constants.COPYFILE_EXCL)}finally{copying=false;clearInterval(poll)}
    onProgress({phase:'preparing',done:size,total:size,unit:'bytes'});
    await save('syncing-copy');
    const fh=await fs.open(tmp,'r+');try{await fh.sync()}finally{await fh.close()}
    const originalStat=await fs.stat(original);
    await fs.chmod(tmp,originalStat.mode & (retainOriginal?0o7777:0o777));
    if(retainOriginal||typeof process.getuid==='function'&&process.getuid()===0)await fs.chown(tmp,originalStat.uid,originalStat.gid);
    if(retainOriginal){const installedStat=await fs.stat(tmp);if(installedStat.uid!==originalStat.uid||installedStat.gid!==originalStat.gid||(installedStat.mode&0o7777)!==(originalStat.mode&0o7777))throw Error('Vlastníka, skupinu nebo režim originálu nelze zachovat.');}
    await save('verifying-copy');
    const counts=[0,0];
    const counted=i=>done=>{counts[i]=done;onProgress({phase:'verifying-copy',done:counts[0]+counts[1],total:size*2,unit:'bytes'})};
    const [a,b]=await Promise.all([sha256(review,counted(0)),sha256(tmp,counted(1))]);
    if(a!==b)throw new Error('Kontrolní součet kopie nesouhlasí.');
    if(retainOriginal){
      await makeRetainedCopy(original,originalFP,record,retainedDirectory);
      await atomicJSON(journal,record);
    }
    await beforeCommit();await check();if(retainOriginal)await validateRetainedCopy(record,retainedDirectory);
    await save('ready');
    await fs.rename(original,backup);
    movedOriginal=true;
    await syncDirectory(path.dirname(original));
    await save('original-backed-up');
    if(destination===original)await fs.rename(tmp,original);
    else {await fs.link(tmp,destination);await fs.unlink(tmp);}
    await syncDirectory(path.dirname(original));
    await save('installed');
    if(retainOriginal){
      await validateRetainedCopy(record,retainedDirectory);
      const [backupStat,reviewStat]=await Promise.all([fs.stat(backup),fs.stat(review)]);
      if(!originalIdentity(backupStat,originalFP)||backupStat.nlink!==1||identityOf(reviewStat)!==reviewFP||reviewStat.nlink!==1)throw Error('Záloha originálu nebo výsledek se změnily; záloha zůstává zachována.');
    }
    await fs.unlink(backup);
    await syncDirectory(path.dirname(original));
    await save('original-removed');
    // A replaced review file is never deleted if another process changed it.
    if(identityOf(await fs.stat(review))!==reviewFP)throw new Error('Originál nahrazen; review se změnilo a nebylo odstraněno.');
    await fs.unlink(review);
    await syncDirectory(path.dirname(review));
    await save('complete');
    return record;
  } catch(e) {
    record.error=e.message;
    if(['preparing','syncing-copy','verifying-copy','ready','original-backed-up'].includes(record.phase)) {
      try {
        // A completed rollback is terminal; it must not block approvals after restart.
        const untouched=!movedOriginal&&!(await statOrMissing(backup));
        let retainedSafe=true;
        if(retainOriginal){try{await validateRetainedCopy(record,retainedDirectory)}catch{retainedSafe=false}}
        if(retainedSafe&&(untouched||await restoreBackup(record))){
          await fs.unlink(tmp).catch(err=>{if(err.code!=='ENOENT')throw err});
          await syncDirectory(path.dirname(original));
          record.phase='aborted';
        }
      }catch(rollbackError){record.rollbackError=rollbackError.message}
    }
    await atomicJSON(journal,record);throw e;
  }finally{await retainedDirectory?.handle.close().catch(()=>{})}
}
