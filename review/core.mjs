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

/**
 * Durable exchange journal written by replaceChecked() and read by recoverTransactions().
 * @typedef {object} TransactionJournal
 * @property {string} id
 * @property {string} original Absolute path of the original film.
 * @property {string} review Absolute path of the reviewed result.
 * @property {string} destination Installed path (the original path, or .mkv for a .ts/.m2ts original).
 * @property {string} tmp Verified copy next to the original.
 * @property {string} backup Original kept until the exchange completes.
 * @property {string} originalFP fingerprint() of the original when reviewed.
 * @property {string} reviewFP fingerprint() of the result when reviewed.
 * @property {'preparing'|'syncing-copy'|'verifying-copy'|'ready'|'original-backed-up'|'installed'|'original-removed'|'complete'|'aborted'} phase
 * @property {string} created ISO time.
 * @property {string} [error] Why the exchange stopped.
 * @property {string} [rollbackError] Why restoring the original failed, if it did.
 */
/** @typedef {{path:string,stat:import('node:fs').Stats,fp:string}} SafeFile */
/** @typedef {{done:number,total:number,unit?:string,phase?:string,speed?:number|null}} TransferProgress */

/** @param {string|Buffer} s */
export const hash = s => crypto.createHash('sha256').update(s).digest('hex');
/** @param {{dev:number,ino:number,size:number,mtimeMs:number,ctimeMs:number}} s */
export const fingerprint = s => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
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
  return {path:resolved,stat,fp:fingerprint(stat)};
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
const statOrMissing=async file=>{try{return await fs.lstat(file)}catch(e){if(e.code==='ENOENT')return null;throw e}};
// Renaming changes ctime. Device, inode, size and mtime still identify the saved original.
const originalIdentity=(stat,fp)=>stat?.isFile()&&!stat.isSymbolicLink()&&fingerprint(stat).split(':').slice(0,-1).join(':')===String(fp).split(':').slice(0,-1).join(':');
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
    &&typeof t.review==='string'&&path.isAbsolute(t.review)&&typeof t.originalFP==='string'
    &&t.tmp===path.join(path.dirname(t.original),`.tdarr-review-${t.id}.tmp`)
    &&t.backup===path.join(path.dirname(t.original),`.tdarr-review-${t.id}.old`)
    &&(!t.destination||validDestination(t.original,t.destination));
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
  if(a.length!==1||b.length!==1||!['h264','hevc','vc1','mpeg2video'].includes(a[0].codec_name)||b[0].codec_name!=='hevc'||b[0].pix_fmt!=='yuv420p10le'||a[0].width!==b[0].width||a[0].height!==b[0].height) throw new Error('Obrazové parametry neodpovídají schvalovanému převodu.');
  if(['vc1','mpeg2video'].includes(a[0].codec_name))legacySDR.compare(original,review);
  if(a[0].codec_name==='hevc'&&review.format?.tags?.TDARR_SDR_PROFILE===hevcSDR.MARKER)hevcSDR.compare(original,review);
  else if(a[0].codec_name==='hevc'){
    if(original.format?.tags?.TDARR_HDR_PROFILE)throw new Error('Originál již má značku dokončeného HDR převodu.');
    if(review.format?.tags?.TDARR_HDR_PROFILE===dualHDR.MARKER)dualHDR.compare(original.hdr10,review.hdr10);
    else if(review.format?.tags?.TDARR_HDR_PROFILE===dv81.MARKER)dv81.compare(original.hdr10,review.hdr10);
    else if(review.format?.tags?.TDARR_HDR_PROFILE===hdrExtra.PLUS)hdrExtra.compare(original.hdr10,review.hdr10,'plus');
    else if(review.format?.tags?.TDARR_HDR_PROFILE===hdrExtra.P7)hdrExtra.compare(original.hdr10,review.hdr10,'p7');
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
 * @param {(phase:TransactionJournal['phase'])=>void} [options.onStage]
 * @param {(progress:TransferProgress)=>void} [options.onProgress]
 * @param {()=>Promise<void>} [options.beforeCommit]
 */
export async function replaceChecked({original,review,destination=original,originalFP,reviewFP,journal,onStage=()=>{},onProgress=()=>{},beforeCommit=async()=>{}}) {
  if(!validDestination(original,destination))throw Error('Nepovolená cílová cesta převodu.');
  const check=async()=>{
    if(fingerprint(await fs.stat(original))!==originalFP||fingerprint(await fs.stat(review))!==reviewFP) throw new Error('Soubor se od kontroly změnil. Obnov přehled.');
    if(destination!==original&&await statOrMissing(destination))throw Error('Cílový MKV již existuje; nebude přepsán.');
  };
  await check();
  const id=crypto.randomUUID(),tmp=path.join(path.dirname(original),`.tdarr-review-${id}.tmp`),backup=path.join(path.dirname(original),`.tdarr-review-${id}.old`);
  /** @type {TransactionJournal} */
  const record={id,original,review,destination,tmp,backup,originalFP,reviewFP,phase:'preparing',created:new Date().toISOString()};
  const save=async phase=>{record.phase=phase;await atomicJSON(journal,record);onStage(phase);};
  await save('preparing');
  let movedOriginal=false;
  try {
    const size=(await fs.stat(review)).size;
    onProgress({phase:'preparing',done:0,total:size,unit:'bytes'});
    let copying=true;
    const poll=setInterval(()=>{fs.stat(tmp).then(s=>{if(copying)onProgress({phase:'preparing',done:Math.min(size,s.size),total:size,unit:'bytes'})}).catch(()=>{});},1000);
    try{await fs.copyFile(review,tmp,fs.constants.COPYFILE_EXCL)}finally{copying=false;clearInterval(poll)}
    onProgress({phase:'preparing',done:size,total:size,unit:'bytes'});
    await save('syncing-copy');
    const fh=await fs.open(tmp,'r+');try{await fh.sync()}finally{await fh.close()}
    const originalStat=await fs.stat(original);
    await fs.chmod(tmp,originalStat.mode & 0o777);
    if(typeof process.getuid==='function'&&process.getuid()===0)await fs.chown(tmp,originalStat.uid,originalStat.gid);
    await save('verifying-copy');
    const counts=[0,0];
    const counted=i=>done=>{counts[i]=done;onProgress({phase:'verifying-copy',done:counts[0]+counts[1],total:size*2,unit:'bytes'})};
    const [a,b]=await Promise.all([sha256(review,counted(0)),sha256(tmp,counted(1))]);
    if(a!==b)throw new Error('Kontrolní součet kopie nesouhlasí.');
    await beforeCommit();await check();
    await save('ready');
    await fs.rename(original,backup);
    movedOriginal=true;
    await syncDirectory(path.dirname(original));
    await save('original-backed-up');
    if(destination===original)await fs.rename(tmp,original);
    else {await fs.link(tmp,destination);await fs.unlink(tmp);}
    await syncDirectory(path.dirname(original));
    await save('installed');
    await fs.unlink(backup);
    await syncDirectory(path.dirname(original));
    await save('original-removed');
    // A replaced review file is never deleted if another process changed it.
    if(fingerprint(await fs.stat(review))!==reviewFP)throw new Error('Originál nahrazen; review se změnilo a nebylo odstraněno.');
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
        if(untouched||await restoreBackup(record)){
          await fs.unlink(tmp).catch(err=>{if(err.code!=='ENOENT')throw err});
          await syncDirectory(path.dirname(original));
          record.phase='aborted';
        }
      }catch(rollbackError){record.rollbackError=rollbackError.message}
    }
    await atomicJSON(journal,record);throw e;
  }
}
