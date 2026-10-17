import {downloadQueue} from './download-queue.mjs';
import {quotaFor} from './deferred-limit.mjs';
import {relative as safeRelative} from './policy.mjs';
import {replacementFollowup} from './replacement-followup.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
const FOREVER=253402300799000;
export const samePreserved=(a,b)=>a.split(':').slice(0,4).join(':')===b.split(':').slice(0,4).join(':');
export const fp=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
export function eligibleRelease(r,profile,badTitles,current){
 if(!r.downloadAllowed||badTitles.has(r.title))return false;
 const q=r.quality?.quality?.id;
 if(current){const rank=id=>profile.items.findIndex(i=>i.quality?.id===id||i.items?.some(w=>w.quality?.id===id));if(rank(current.id)<0||rank(q)<rank(current.id)||r.quality.quality.resolution<current.resolution)return false;}
 if(!profile.items.some(i=>i.allowed&&(i.quality?.id===q||i.items?.some(w=>w.allowed!==false&&w.quality?.id===q))))return false;
 return (r.rejections||[]).every(x=>/^(Existing file on disk|Existing file meets)/i.test(x));
}
export async function maintainWaitingSources({cfg,state,rad,td,phase,save,command,idle,safeSource,sample,canStart=()=>true}){
 for(const c of Object.values(state.cases).filter(c=>['waiting_replacement','waiting_source_kept'].includes(c.status))){
  if(!canStart())return;
  try{
   const m=await rad('/movie/'+c.movieId),queue=(await rad('/queue?pageSize=1000')).records.filter(q=>q.movieId===c.movieId);
   c.tmdbId=m.tmdbId;c.titleSlug=m.titleSlug;c.latestQueue=queue.map(downloadQueue);
   if(c.status==='waiting_replacement'){
    if(m.movieFileId&&m.movieFileId!==(c.keptMovieFileId||c.binding.movieFileId)||queue.length||!c.quarantine)continue;
    if(c.searchCommand){const cmd=await rad('/command/'+c.searchCommand);if(!['completed','failed','aborted','cancelled'].includes(cmd.status))continue;}
    if(m.movieFileId)continue;
    await idle(c);
    const q=await fs.lstat(c.quarantine);if(!q.isFile()||q.isSymbolicLink()||!samePreserved(fp(q),c.fp)||q.nlink!==1||await fs.realpath(c.quarantine)!==c.quarantine)throw Error('Quarantine identity changed; cannot restore source');
    if(await fs.realpath(path.dirname(c.source))!==path.dirname(c.source))throw Error('Unsafe source parent');
    try{await fs.lstat(c.source);throw Error('Source already exists')}catch(e){if(e.code!=='ENOENT')throw e;}
    await td('/api/v2/bulk-update-files',{fileIds:[c.file],updatedObj:{TranscodeDecisionMaker:'Hold',holdUntil:FOREVER}});
    await phase(c,'restore_source_intent','Náhrada nenalezena; vracím vydání do knihovny a ponechávám zálohu v karanténě.');
    try{await fs.link(c.quarantine,c.source);c.keptLink=true;}catch(e){if(!['EXDEV','ENOTSUP','EOPNOTSUPP'].includes(e.code))throw e;await fs.copyFile(c.quarantine,c.source,fs.constants.COPYFILE_EXCL|fs.constants.COPYFILE_FICLONE);c.keptLink=false;}
    c.originalRestoredAt=new Date().toISOString();delete c.originalOutsideSince;
    c.preservedSourceFP=fp(await fs.lstat(c.source));c.skipCurrentEdition=true;c.lastSearchAt=new Date().toISOString();c.nextSearchAt=new Date(Date.now()+6*3600000).toISOString();
    await phase(c,'waiting_source_kept','Vydání vyřazeno z převodů — náhrada zatím nenalezena. Film zůstává v knihovně; automatika hledá dál.');
    await command({name:'RescanMovie',movieId:c.movieId});const fresh=await rad('/movie/'+c.movieId);if(fresh.movieFile?.path!==cfg.radarrRoot+'/'+c.relative||fresh.movieFile?.size!==c.size)throw Error('Restored source not confirmed in Radarr');const current=fp(await fs.lstat(c.source));if(!samePreserved(current,c.preservedSourceFP))throw Error('Restored source changed during rescan');c.preservedSourceFP=current;c.keptMovieFileId=fresh.movieFileId;await save();
    continue;
   }
   // Radarr can import a different filename after removing the preserved link.
   // Confirm the new import before looking up that obsolete source path.
   if(m.movieFileId&&m.movieFileId!==c.keptMovieFileId){
    const f=m.movieFile,root=cfg.radarrRoot.replace(/\/$/,'')+'/';
    if(!f?.path?.startsWith(root)||!f.sceneName||f.sceneName===c.binding.sourceTitle)throw Error('Replacement import identity not confirmed');
    const rel=f.path.slice(root.length);if(rel.split('/').some(x=>!x||x==='.'||x==='..')||rel.includes('\\'))throw Error('Unsafe replacement path');
    const replacement=await safeSource(rel);if(replacement.size!==f.size)throw Error('Replacement size does not match Radarr');
    const q=await fs.lstat(c.quarantine);if(!q.isFile()||q.isSymbolicLink()||!samePreserved(fp(q),c.fp)||await fs.realpath(c.quarantine)!==c.quarantine)throw Error('Quarantine identity changed');
    c.skipCurrentEdition=false;delete c.observationError;c.nextSearchAt=null;
    await phase(c,'waiting_replacement','Importována nová kopie; původní vydání je zachované v karanténě.');continue;
   }
   const source=await safeSource(c.relative);
   if(source.fp!==c.preservedSourceFP){
    if(m.movieFileId&&m.movieFileId!==c.keptMovieFileId&&m.movieFile?.size===source.size){c.skipCurrentEdition=false;await phase(c,'waiting_replacement','Importována nová kopie; původní vydání je zachované v karanténě.');continue;}
    throw Error('Kept source changed without confirmed replacement');
   }
   if(queue.length||Date.now()<Date.parse(c.nextSearchAt||0))continue;
   if(cfg.enabled===false)continue; // In Verify, observation and protective restoration continue; download work waits.
   const profile=await rad('/qualityprofile/'+m.qualityProfileId),blocklist=await rad('/blocklist/movie?movieId='+c.movieId),badTitles=new Set([c.binding.sourceTitle,...blocklist.map(b=>b.sourceTitle)]);
   c.lastSearchAt=new Date().toISOString();c.nextSearchAt=new Date(Date.now()+6*3600000).toISOString();await save();
   const current=c.originalQuality||m.movieFile?.quality?.quality;if(!current?.id)throw Error('Original quality unknown; automated download refused');
   const releases=await rad('/release?movieId='+c.movieId),release=releases.find(r=>eligibleRelease(r,profile,badTitles,current));
   if(!release){c.message='Vydání vyřazeno z převodů — náhrada zatím nenalezena. Film zůstává v knihovně; další automatické hledání za 6 hodin.';await save();continue;}
   await idle(c);const q=await fs.lstat(c.quarantine);if(!samePreserved(fp(q),c.fp)||source.fp!==(await safeSource(c.relative)).fp)throw Error('Original changed before replacement request');
   if(c.keptLink){const kept=await fs.lstat(c.source);if(kept.ino!==q.ino||kept.dev!==q.dev||q.nlink!==2)throw Error('Preserved source link changed');}else if(await sample(c.source)!==await sample(c.quarantine))throw Error('Restored copy does not match quarantine');
   await td('/api/v2/bulk-update-files',{fileIds:[c.file],updatedObj:{TranscodeDecisionMaker:'Hold',holdUntil:FOREVER}});
   await phase(c,'remove_kept_source_intent','Nalezena vhodná náhrada; originál zůstává v karanténě.');await fs.unlink(c.source);c.originalOutsideSince=new Date().toISOString();await save();
   await command({name:'RescanMovie',movieId:c.movieId});if((await rad('/movie/'+c.movieId)).movieFileId)throw Error('Radarr still sees kept source');
   await phase(c,'replacement_download_intent','Předávám vhodnou náhradu ke stažení.');await rad('/release',{guid:release.guid,indexerId:release.indexerId,movieId:c.movieId});c.skipCurrentEdition=false;c.selectedRelease=release.title;
   await phase(c,'waiting_replacement','Radarr stahuje jinou kopii; původní vydání zůstává v karanténě.');
  }catch(e){c.observationError=e.message;await save();}
 }
}
// Historical journals lacked replacementRelative/FP. Recover only a display
// path; never manufacture fingerprints, approval evidence or cleanup authority.
export function replacementDisplayPath(c,cfg){
 if(typeof c.replacementRelative==='string'&&c.replacementRelative){
  try{return {relative:safeRelative(cfg.sourceRoot+'/'+c.replacementRelative,cfg.sourceRoot),legacy:false};}catch{return null;}
 }
 if(c.status!=='replacement_imported'||!Number.isInteger(c.movieId)||c.movieId<=0||!Number.isInteger(c.replacement?.movieFileId)||c.replacement.movieFileId<=0||typeof c.replacement?.path!=='string'||typeof cfg.radarrRoot!=='string')return null;
 try{return {relative:safeRelative(c.replacement.path,cfg.radarrRoot),legacy:true};}catch{return null;}
}
export async function publishRecoveryStatus({cfg,state,atomic,tdarrFiles=[],registryAllowedModes=null}){
 const labels={deferred_limit:'Čeká na uvolnění denního limitu obnov',candidate:'Ověřuje se originál',verifying:'Kontrola originálu',confirmed:'Chyba originálu potvrzena',profile_intent:'Nastavuje se kvalita náhrady',holding:'Pozastavuje se vadné vydání',quarantine_intent:'Přesun originálu do karantény',quarantined:'Originál uložen v karanténě',blocklist_intent:'Vyřazuje se vadné vydání',blocked:'Vadné vydání vyřazeno',search_intent:'Spouští se hledání náhrady',waiting_source_kept:'Náhrada zatím nenalezena; film zůstává v knihovně',waiting_replacement:'Hledání nebo stahování náhrady',replacement_queue_intent:'Nová kopie se předává Tdarru',replacement_imported:'Náhrada předána Tdarru',manual:'Obnova vyžaduje kontrolu',restore_source_intent:'Vrací se zachovaná kopie do knihovny',remove_kept_source_intent:'Připravuje se stažení náhrady',replacement_download_intent:'Předává se náhrada ke stažení'};
 Object.assign(labels,{defer_limit_intent:'Pozastavuje se vadné vydání během denního limitu',defer_cooldown_intent:'Pozastavuje se potvrzené vadné vydání',deferred_cooldown:'Vadné vydání pozastavené; čeká na limit obnov',no_action:'Kontrola originálu dokončena',dry_run:'Chyba potvrzena; automatické změny vypnuté'});
 const frozenLimit=Object.values(state.cases).some(c=>c.status==='deferred_limit'&&c.approval&&!c.deferredLimit)?quotaFor({cfg,state}):null;
 const cases=await Promise.all(Object.values(state.cases).filter(c=>labels[c.status]).map(async c=>{
  const display=replacementDisplayPath(c,cfg);
  const file=display?cfg.sourceRoot+'/'+display.relative:null;
  const matches=file?tdarrFiles.filter(f=>f._id===file&&f.DB===cfg.libraryId):[];
  const row=matches.length===1?matches[0]:null;
  const tdarrStatus=row?.TranscodeDecisionMaker||null;
  let pipelineLabel=labels[c.status];
  if(c.status==='replacement_imported')pipelineLabel=c.cleanup?.complete?'Náhrada schválena; karanténa uklizena':c.cleanup?.approvedAt?'Náhrada schválena; čeká na úklid karantény':tdarrStatus==='Queued'?'Náhrada čeká ve frontě Tdarru':tdarrStatus==='Transcoding'?'Tdarr převádí náhradu':tdarrStatus==='Transcode error'?'Převod náhrady skončil chybou':tdarrStatus==='Transcode success'?'Převod dokončen; ověř výsledek v Review':tdarrStatus==='Not required'?'Tdarr náhradu vynechal; vyžaduje posouzení':'Náhrada předána Tdarru';
  if(c.status==='replacement_imported'&&tdarrStatus==='Hold'&&!c.cleanup?.approvedAt)pipelineLabel='Náhrada je pozastavená v Tdarru; zkontroluj důvod';
  if(c.status==='no_action')pipelineLabel=c.originalCheckKind==='healthy'?'Úplná kontrola originálu bez chyby':'Kontrola originálu nepotvrdila poškození';
  const followup=replacementFollowup(c,{cfg,state});
  return {...await verifyPause(c,cfg),replacementFollowupId:followup?.id||null,replacementFollowupBinding:followup?.binding||null,id:c.id,title:c.relative?.split('/')[0]||'Film',phase:c.status,pipelineLabel,source:'recovery',message:c.message,reason:c.evidence?.signature||c.approval?.signature||c.message,created:c.created,updated:c.updated,lastSearchAt:c.lastSearchAt||null,nextSearchAt:c.nextSearchAt||null,nextRetryAt:(c.status==='deferred_limit'&&c.approval&&!c.deferredLimit?frozenLimit?.retryAt:c.nextRetryAt)||null,sourceRetained:c.status==='waiting_source_kept'||c.status==='deferred_cooldown'||c.status==='deferred_limit'&&!!(c.deferredLimit||c.approval),originalCheckKind:c.originalCheckKind||null,tmdbId:c.tmdbId||null,titleSlug:c.titleSlug||null,edition:c.binding?.sourceTitle||c.approval?.sourceTitle||null,queue:['waiting_replacement','waiting_source_kept','manual'].includes(c.status)?c.latestQueue||[]:[],error:c.observationError||c.retentionError||null,tdarrStatus,legacyReplacementBinding:display?.legacy===true,replacementTitle:display?.relative.split('/').pop()||null,quarantineRetained:!!c.quarantine&&!c.cleanup?.complete,cleanupComplete:!!c.cleanup?.complete,deleteAfter:c.cleanup?.deleteAfter||null,fullHash:c.fullHash?{stage:c.fullHash.stage,done:c.fullHash.done,total:c.fullHash.total,started:c.fullHash.started,updated:c.fullHash.updated||null}:null,canRestore:false};
 }));
 await atomic(path.join(path.dirname(cfg.mediaRoot),'.tdarr-recovery-status.json'),{version:1,updated:new Date().toISOString(),configChange:state.configChange?{detectedAt:state.configChange.detectedAt,restartRequired:true,valid:state.configChange.valid,error:state.configChange.error}:null,registryAllowedModes,cases},0o644);
}

// A pause describes pending work; it never authorizes or caches a future mutation.
async function verifyPause(c,cfg){
 if(!['waiting_replacement','waiting_source_kept','replacement_queue_intent','replacement_imported'].includes(c.status)||c.cleanup?.complete)return {};
 let outside=c.status!=='waiting_source_kept';
 // A new import may use a different filename while the protected original still exists.
 // Location is display evidence only and must never be used to authorize a later step.
 if(c.source&&(c.preservedSourceFP||c.fp)){
  try{const st=await fs.lstat(c.source);outside=!(st.isFile()&&!st.isSymbolicLink()&&samePreserved(fp(st),c.preservedSourceFP||c.fp)&&await fs.realpath(c.source)===c.source);}
  catch(e){outside=e.code==='ENOENT'?true:null;}
 }
 if(outside===true){
  try{const q=await fs.lstat(c.quarantine);if(!q.isFile()||q.isSymbolicLink()||!c.fp||!samePreserved(fp(q),c.fp)||await fs.realpath(c.quarantine)!==c.quarantine)outside=null;}
  catch{outside=null;}
 }
 const timestamp=value=>{if(value===null||value===undefined)return null;const date=new Date(value);return Number.isFinite(date.getTime())?date.toISOString():null;};
 const since=c.originalOutsideSince||(!c.preservedSourceFP&&!c.originalRestoredAt&&Number.isFinite(c.mutationStarted)?timestamp(c.mutationStarted):null);
 const step=c.status==='replacement_imported'?'quarantine_purge':c.status==='replacement_queue_intent'||c.status==='waiting_replacement'&&c.replacementRelative?'tdarr_handoff':'replacement_request';
 return {verifyPausedStep:cfg.enabled===false?step:null,originalOutsideLibrary:outside,originalOutsideSince:outside===true?timestamp(since):null,originalRestoredAt:outside===false?timestamp(c.originalRestoredAt):null};
}
