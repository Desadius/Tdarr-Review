import {downloadQueue} from './download-queue.mjs';
import {ensureHandoff} from './replacement-handoff.mjs';
import {retainCase,fp as retentionFP,quarantineRetention} from './quarantine-retention.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const runProbe=promisify(execFile);
export const hasNorwegianAudio=streams=>streams.some(s=>s.codec_type==='audio'&&['nor','no','nob','nb','nno','nn'].includes(String(s.tags?.language||'').toLowerCase())&&!/commentary|komentar|commentaire/i.test(s.tags?.title||''));

const clone=x=>structuredClone(x);
export function validateConnection(c){
 if(!c||typeof c.url!=='string'||typeof c.apiKey!=='string'||!c.apiKey.trim()||!c.mediaRoot?.startsWith('/')||c.mediaRoot==='/'||c.mediaRoot.includes('\\')||c.mediaRoot.split('/').some(v=>v==='..'||v==='.')||typeof c.preferCzechEnglish!=='boolean')throw Error('Vyplň adresu Radarru, API klíč a cestu knihovny v Radarru.');
 const u=new URL(c.url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error('Neplatná adresa Radarru.');
 if(c.quarantineRoot!==undefined&&(typeof c.quarantineRoot!=='string'||!c.quarantineRoot.startsWith('/')||c.quarantineRoot==='/'||c.quarantineRoot.includes('\\')||c.quarantineRoot.split('/').some(v=>v==='.'||v==='..')))throw Error('Karanténa musí být absolutní cesta v kontejneru Review.');
 return {url:u.toString().replace(/\/$/,''),apiKey:c.apiKey.trim(),mediaRoot:c.mediaRoot.replace(/\/+$/,''),preferCzechEnglish:c.preferCzechEnglish,...(c.quarantineRoot?{quarantineRoot:c.quarantineRoot.replace(/\/+$/,'')}: {})};
}
export function matchMovie(movies,root,relative,size){
 if(!relative||relative.includes('\\')||relative.startsWith('/')||relative.split('/').some(v=>!v||v==='.'||v==='..'))throw Error('Neplatná cesta originálu.');
 const target=root+'/'+relative,m=movies.filter(m=>m.movieFile?.path===target);
 if(m.length!==1||!m[0].monitored||m[0].movieFile.id!==m[0].movieFileId||m[0].movieFile.size!==size)throw Error('Originál nelze jednoznačně spojit se sledovaným filmem v Radarru.');
 if(!m[0].movieFile.sceneName?.trim())throw Error('Radarr nezná název původního vydání; nelze ho bezpečně zakázat.');
 return m[0];
}
export function titleRegex(title){
 if(typeof title!=='string'||!title.trim()||title.length>1000)throw Error('Neplatný název vydání.');
 return '^(?:'+title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')(?:[- .](?:Obfuscated|Scrambled))?(?:\\.mkv)?$';
}
export function replacementProfile(profile,current,badId,dualId){
 const p=clone(profile);delete p.id;
 const index=p.items.findIndex(v=>v.quality?.id===current.id||v.items?.some(w=>w.quality?.id===current.id));
 if(index<0||!p.items[index].allowed)throw Error('Současná kvalita není povolena v profilu. Náhradu nelze bezpečně omezit.');
 for(let i=0;i<p.items.length;i++){
  const v=p.items[i];v.allowed=v.allowed&&i>=index;
  if(v.items?.length){for(const w of v.items)w.allowed=v.allowed&&w.allowed!==false&&(!current.resolution||w.quality.resolution>=current.resolution);v.allowed=v.allowed&&v.items.some(w=>w.allowed);}
  else if(current.resolution&&v.quality.resolution<current.resolution)v.allowed=false;
 }
 if(!p.items.some(v=>v.allowed))throw Error('Profil nepovoluje stejnou nebo vyšší kvalitu.');
 // Preserve existing prohibitions: a new language preference must not outweigh -10000 exclusions.
 const positive=p.formatItems.reduce((s,v)=>s+Math.max(0,v.score),0),dualScore=100;
 if(positive+dualScore>=9000)throw Error('Skóre profilu nelze bezpečně doplnit bez oslabení zákazů.');
 const setFormat=(id,name,score)=>{const existing=p.formatItems.find(v=>v.format===id);if(existing)existing.score=score;else p.formatItems.push({format:id,name,score});};
 setFormat(badId,'Review: původní vydání zakázáno',-10000);
 if(dualId)setFormat(dualId,'Review: Czech + English',dualScore);
 if(p.cutoff!==undefined&&!p.items.some(v=>v.allowed&&(v.id===p.cutoff||v.quality?.id===p.cutoff)))p.cutoff=p.items[index].id||p.items[index].quality.id;
 p.name='Review replacement '+current.movieId+' '+Date.now();
 return p;
}
export function canResume(c){return ['waiting','imported','restored','manual'].includes(c.phase)||(c.phase==='queue_intent'&&!!c.replacementRelative&&!!c.replacementSourceFP);}
export function createReplacement({data,getConfig,safeFile,hash,atomicJSON,tdarr,pauseDispatch,verifyPaused=async()=>{},isWorkerBusy=async()=>false,resume,onProgress}){
 const connectionFile=path.join(data,'radarr.json'),directory=path.join(data,'radarr-replacements');let observing=false,mutating=false;
 async function connection(){return validateConnection(JSON.parse(await fs.readFile(connectionFile,'utf8')));}
 async function api(c,route,method='GET',body){
  let r;try{r=await fetch(c.url+'/api/v3'+route,{method,redirect:'error',headers:{'X-Api-Key':c.apiKey,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)})}catch{throw Error('Radarr neodpovídá. Stav operace ověř před opakováním.');}
  if(!r.ok)throw Error('Radarr '+route.split('?')[0]+': HTTP '+r.status);
  const text=await r.text();if(!text)return null;try{return JSON.parse(text)}catch{throw Error('Radarr vrátil neplatnou odpověď.');}
 }
 async function persist(c,phase,message){if(phase){c.phase=phase;c.message=message;}c.updated=new Date().toISOString();await atomicJSON(path.join(directory,c.id+'.json'),c);}
 async function list(){await fs.mkdir(directory,{recursive:true});const result=[];for(const name of await fs.readdir(directory)){if(!/^[a-f0-9]{24}\.json$/.test(name))continue;result.push(JSON.parse(await fs.readFile(path.join(directory,name),'utf8')));}return result.sort((a,b)=>b.created.localeCompare(a.created));}
 // Keep private journal paths, fingerprints and nested API data out of the UI.
 function publicText(value){
  if(typeof value!=='string')return null;
  return value.slice(0,2000).replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s'"<>]+|\/(?:[^\s/'"<>]+\/)+[^\s'"<>]*/g,'[soukromá cesta]');
 }
 const importedLabels={'Queued':'Náhrada čeká ve frontě Tdarru','Transcoding':'Tdarr převádí náhradu','Transcode success':'Převod dokončen; ověř výsledek v Review','Transcode error':'Převod náhrady skončil chybou','Not required':'Tdarr náhradu vynechal; vyžaduje posouzení','Hold':'Náhrada je pozastavená v Tdarru'};
 function visible(c){
  const cleanup=c.cleanup,complete=cleanup?.complete===true;
  const pipelineLabel=c.observationError||c.retentionError?'Obnova vyžaduje kontrolu':complete?'Náhrada schválena; karanténa uklizena':cleanup?.approvedAt?'Náhrada schválena; čeká na úklid karantény':c.phase==='imported'?(importedLabels[c.tdarrStatus]||'Náhrada předána; stav Tdarru není doložen'):publicText(c.message);
  return {id:c.id,itemId:c.itemId,title:c.title,phase:c.phase,message:publicText(c.message),pipelineLabel,reason:publicText(c.reason),created:c.created,updated:c.updated,statusUpdated:c.statusUpdated||c.updated,
   queue:(Array.isArray(c.queue)?c.queue:[]).map(q=>({title:q.title,status:q.status,trackedDownloadState:q.trackedDownloadState,trackedDownloadStatus:q.trackedDownloadStatus,percent:q.percent,timeleft:q.timeleft,error:publicText(q.error)})),
   search:c.phase!=='imported'&&c.search?{id:c.search.id,status:c.search.status,message:publicText(c.search.message)}:null,
   replacement:c.replacement?{title:c.replacement.title,quality:c.replacement.quality,languages:Array.isArray(c.replacement.languages)?c.replacement.languages:[],bytes:c.replacement.bytes}:null,
   originalQuality:c.originalQuality,profileId:c.profileId,tdarrStatus:c.tdarrStatus||null,replacementTitle:c.replacement?.title||null,
   observationError:publicText(c.observationError),retentionError:publicText(c.retentionError),error:publicText(c.observationError||c.retentionError),
   approvedAt:cleanup?.approvedAt||null,deleteAfter:cleanup?.deleteAfter||null,cleanupComplete:complete,
   quarantineRetained:c.phase!=='restored'&&!complete&&(c.originalQuarantineRetained===true||!!c.originalQuarantine&&['quarantined','rescan_intent','search_intent','waiting','queue_intent','imported'].includes(c.phase)),
   canRestore:['waiting','manual'].includes(c.phase)&&!!c.originalQuarantine};
 }
 function observed(c){delete c.observationError;c.statusUpdated=new Date().toISOString();}
 async function observeImported(c,cfg){
  const root=cfg.sourceRoots?.[0],relative=c.replacementRelative;
  if(!root||!cfg.libraryId||c.libraryId!==cfg.libraryId||c.tdarrSource!==root+'/'+c.relative||typeof relative!=='string'||relative.includes('\\')||relative.startsWith('/')||relative.split('/').some(v=>!v||v==='.'||v==='..'))throw Error('Nelze ověřit přesnou vazbu náhrady na knihovnu Tdarr.');
  const file=root+'/'+relative,row=await tdarr('/api/v2/cruddb',{collection:'FileJSONDB',mode:'getById',docID:file});
  if(!row||typeof row!=='object'||Array.isArray(row)||row._id!==file||row.DB!==c.libraryId)throw Error('Tdarr nepotvrdil přesný soubor náhrady ve správné knihovně.');
  if(!['Queued','Transcoding','Transcode success','Transcode error','Not required','Hold'].includes(row.TranscodeDecisionMaker))throw Error('Tdarr vrátil neznámý stav náhrady.');
  c.tdarrStatus=row.TranscodeDecisionMaker;c.message=importedLabels[c.tdarrStatus];c.queue=[];observed(c);
 }
 async function publicSettings(){try{const c=await connection();return {configured:true,url:c.url,mediaRoot:c.mediaRoot,quarantineRoot:c.quarantineRoot||path.join(path.dirname(getConfig().mediaRoot),'.tdarr-review-quarantine'),preferCzechEnglish:c.preferCzechEnglish,hasApiKey:true,retentionDays:quarantineRetention.retentionDays}}catch(e){if(e.code!=='ENOENT')return {configured:false,error:'Nastavení Radarru je neplatné.'};return {configured:false,url:'',mediaRoot:'/media',quarantineRoot:path.join(path.dirname(getConfig().mediaRoot),'.tdarr-review-quarantine'),preferCzechEnglish:true,hasApiKey:false,retentionDays:quarantineRetention.retentionDays}}}
 async function settings(input,testOnly=false){if(observing||mutating)throw Error('Probíhá kontrola náhrad, zkus to za chvíli.');if(!testOnly&&(await list()).some(c=>!['restored','imported'].includes(c.phase)))throw Error('Nejprve dokonči nebo obnov otevřené žádosti o náhradu.');let previous;try{previous=await connection()}catch{}const c=validateConnection({...input,apiKey:input.apiKey?.trim()||previous?.apiKey});await api(c,'/system/status');const movies=await api(c,'/movie');if(!Array.isArray(movies)||!movies.some(m=>m.path===c.mediaRoot||m.path.startsWith(c.mediaRoot+'/')))throw Error('Cesta knihovny neodpovídá filmům Radarru.');if(!testOnly)await atomicJSON(connectionFile,c);return {ok:true,message:'Spojení s Radarrem a cesta knihovny ověřeny.'};}
 async function prepare(item,reason){
  if(typeof reason!=='string'||!reason.trim()||reason.length>1000)throw Error('Uveď důvod žádosti o jinou kopii (nejvýše 1000 znaků).');
  const cfg=getConfig(),a=await safeFile(cfg.mediaRoot,item.relative),b=await safeFile(cfg.reviewRoot,item.reviewRelative);
  if(hash(a.fp+'|'+b.fp)!==item.snapshot)throw Error('Soubory se změnily. Obnov přehled.');
  const con=await connection(),m=matchMovie(await api(con,'/movie'),con.mediaRoot,item.relative,a.stat.size),all=await list();
  const sourceRoot=await fs.realpath(cfg.mediaRoot),quarantine=con.quarantineRoot||path.join(path.dirname(sourceRoot),'.tdarr-review-quarantine');
  if(quarantine===sourceRoot||quarantine.startsWith(sourceRoot+path.sep)||sourceRoot.startsWith(quarantine+path.sep))throw Error('Karanténa originálů musí ležet mimo filmovou knihovnu.');
  const parent=path.dirname(quarantine);if(await fs.realpath(parent)!==parent)throw Error('Rodič karantény nesmí být symlink.');await fs.access(parent,fs.constants.W_OK);
  if((await fs.stat(parent)).dev!==a.stat.dev)throw Error('Karanténa musí ležet na stejném souborovém systému jako originál.');
  if(process.platform==='linux'){
   const mounts=(await fs.readFile('/proc/self/mountinfo','utf8')).trim().split('\n').map(line=>{const fields=line.split(' ');return {id:fields[0],point:fields[4].replace(/\\([0-7]{3})/g,(_,v)=>String.fromCharCode(parseInt(v,8)))}});
   const mount=p=>mounts.filter(m=>p===m.point||p.startsWith(m.point==='/'?'/':m.point+'/')).sort((a,b)=>b.point.length-a.point.length)[0]?.id;
   if(mount(a.path)!==mount(parent))throw Error('Originál a karanténu připoj jedním společným Docker mountem. Přesun mezi mounty není bezpečně možný.');
  }
  if(all.some(c=>c.movieId===m.id&&!['restored','imported'].includes(c.phase)))throw Error('Pro tento film už existuje neuzavřená žádost o náhradu.');
  if((await api(con,'/queue?pageSize=1000')).records.some(q=>q.movieId===m.id))throw Error('Radarr už má pro tento film stažení ve frontě.');
  const profile=await api(con,'/qualityprofile/'+m.qualityProfileId);
  replacementProfile(profile,{...m.movieFile.quality.quality,movieId:m.id},999999,null);
  return {con,m,profile,a,b,reason:reason.trim()};
 }
 async function run(item,reason){
  if(observing||mutating)throw Error('Probíhá kontrola náhrad, zkus to za chvíli.');mutating=true;
  let c;
  try{
   onProgress('Ověřuji vazbu filmu na Radarr');const {con,m,profile,a,b,reason:why}=await prepare(item,reason),cfg=clone(getConfig());
   c={id:crypto.randomBytes(12).toString('hex'),itemId:item.id,title:item.title,reason:why,created:new Date().toISOString(),movieId:m.id,oldFileId:m.movieFileId,sourceTitle:m.movieFile.sceneName,originalQuality:m.movieFile.quality.quality.name,relative:item.relative,reviewRelative:item.reviewRelative,sourcePath:a.path,reviewPath:b.path,originalFP:a.fp,reviewFP:b.fp,sourceSize:a.stat.size,reviewSize:b.stat.size,originalProfile:profile,originalProfileId:profile.id,radarrRoot:con.mediaRoot,radarrUrl:con.url,libraryId:cfg.libraryId,tdarrSource:cfg.sourceRoots[0]+'/'+item.relative,mediaRoot:cfg.mediaRoot,reviewRoot:cfg.reviewRoot};
   await fs.mkdir(directory,{recursive:true});await persist(c,'preparing','Připravuji profil náhrady a zákaz původního vydání.');
   await pauseDispatch(item);
   const fresh=await api(con,'/movie/'+m.id);if(fresh.movieFileId!==c.oldFileId||fresh.movieFile?.path!==con.mediaRoot+'/'+c.relative||fresh.movieFile.size!==c.sourceSize||fresh.movieFile.sceneName!==c.sourceTitle)throw Error('Radarr mezitím změnil originál.');
   const exclusion={name:'Review exclude '+m.id+' '+c.id,includeCustomFormatWhenRenaming:false,specifications:[{name:'Exact original release',implementation:'ReleaseTitleSpecification',negate:false,required:true,fields:[{name:'value',value:titleRegex(c.sourceTitle)}]}]};
   const bad=await api(con,'/customformat','POST',exclusion);if(!Number.isInteger(bad?.id))throw Error('Chybí potvrzení vytvoření zákazu.');c.badFormatId=bad.id;await persist(c);
   let dual;
   if(con.preferCzechEnglish){
    const formats=await api(con,'/customformat');dual=formats.find(f=>f.name==='Review: Czech + English'&&f.specifications.every(s=>!s.fields.find(v=>v.name==='exceptLanguage')?.value)&&JSON.stringify(f.specifications.map(s=>[s.implementation,s.required,s.negate,s.fields.find(v=>v.name==='value')?.value]).sort())===JSON.stringify([['LanguageSpecification',true,false,1],['LanguageSpecification',true,false,25]].sort()));
    if(!dual)dual=await api(con,'/customformat','POST',{name:'Review: Czech + English',includeCustomFormatWhenRenaming:false,specifications:[1,25].map(v=>({name:v===1?'English':'Czech',implementation:'LanguageSpecification',negate:false,required:true,fields:[{name:'value',value:v}]}))});
    if(!Number.isInteger(dual?.id))throw Error('Chybí potvrzení preference CZ/EN.');
   }
   // Radarr requires every current custom format to occur exactly once in a profile.
   const completeProfile=await api(con,'/qualityprofile/'+profile.id),allFormats=await api(con,'/customformat');
   for(const f of allFormats)if(!completeProfile.formatItems.some(v=>v.format===f.id))completeProfile.formatItems.push({format:f.id,name:f.name,score:0});
   const p=await api(con,'/qualityprofile','POST',replacementProfile(completeProfile,{...m.movieFile.quality.quality,movieId:m.id},bad.id,dual?.id));if(!Number.isInteger(p?.id))throw Error('Chybí potvrzení profilu náhrady.');c.profileId=p.id;await persist(c);
   fresh.qualityProfileId=p.id;await api(con,'/movie/'+m.id,'PUT',fresh);
   if((await api(con,'/movie/'+m.id)).qualityProfileId!==p.id)throw Error('Profil náhrady nebyl potvrzen.');
   // Preserve both files. Same-volume renames only; never overwrite or copy/delete on EXDEV.
   await verifyPaused(item);
   if((await safeFile(cfg.mediaRoot,item.relative)).fp!==a.fp||(await safeFile(cfg.reviewRoot,item.reviewRelative)).fp!==b.fp)throw Error('Soubory se během přípravy změnily.');
   const oq=con.quarantineRoot||path.join(path.dirname(await fs.realpath(cfg.mediaRoot)),'.tdarr-review-quarantine'),rq=path.join(await fs.realpath(cfg.reviewRoot),'.radarr-quarantine');
   for(const root of [oq,rq]){await fs.mkdir(root,{recursive:true,mode:0o770});if((await fs.lstat(root)).isSymbolicLink()||await fs.realpath(root)!==root)throw Error('Karanténa nesmí být symlink.');await fs.mkdir(path.join(root,c.id),{mode:0o770});}
   c.originalQuarantine=path.join(oq,c.id,path.basename(a.path));c.reviewQuarantine=path.join(rq,c.id,path.basename(b.path));await persist(c,'quarantine_intent','Zachovávám originál i převod v karanténě.');
   await tdarr('/api/v2/bulk-update-files',{fileIds:[c.tdarrSource],updatedObj:{TranscodeDecisionMaker:'Hold',holdUntil:Date.now()+30*86400000}});
   await verifyPaused(item);
   await fs.rename(b.path,c.reviewQuarantine);await persist(c,'review_quarantined','Výsledek je zachovaný v karanténě.');
   await fs.rename(a.path,c.originalQuarantine);c.originalQuarantineRetained=true;await persist(c,'quarantined','Originál i výsledek jsou zachované v karanténě.');
   await persist(c,'rescan_intent','Obnovuji evidenci filmu v Radarru.');const rescan=await api(con,'/command','POST',{name:'RescanMovie',movieId:m.id});c.rescanId=rescan?.id;await persist(c);
   if(!Number.isInteger(c.rescanId))throw Error('Výsledek obnovení evidence je nejistý.');
   for(let i=0;i<60;i++){const s=await api(con,'/command/'+c.rescanId);if(s.status==='completed')break;if(['failed','aborted','cancelled'].includes(s.status))throw Error('Radarr nedokončil obnovu evidence.');await new Promise(r=>setTimeout(r,1000));}
   if((await api(con,'/movie/'+m.id)).movieFileId)throw Error('Radarr stále eviduje původní soubor.');
   await persist(c,'search_intent','Žádám Radarr o stejné nebo vyšší vydání.');const search=await api(con,'/command','POST',{name:'MoviesSearch',movieIds:[m.id]});if(!Number.isInteger(search?.id))throw Error('Výsledek hledání je nejistý.');c.searchId=search.id;
   await persist(c,'waiting','Hledání bylo předáno Radarru. Originál i převod zůstávají v karanténě.');return visible(c);
  }catch(e){if(c)await persist(c,'manual',e.message);throw e}finally{try{await resume()}finally{mutating=false;}}
 }
 async function observe(){
  if(observing||mutating)return;observing=true;
  try{const all=await list(),pending=all.filter(c=>['waiting','queue_intent','imported'].includes(c.phase)&&!c.cleanup?.complete);if(!pending.length)return;const con=await connection(),cfg=getConfig();
   for(const c of pending){try{
    if(c.radarrUrl!==con.url||c.radarrRoot!==con.mediaRoot||c.mediaRoot!==cfg.mediaRoot||c.reviewRoot!==cfg.reviewRoot||c.libraryId!==cfg.libraryId||c.tdarrSource!==cfg.sourceRoots?.[0]+'/'+c.relative)throw Error('Změnilo se mapování. Náhrada vyžaduje ruční kontrolu.');
    // An imported case is only observed. Never rescan/requeue it, including
    // after a missing entry, a timeout or an unsupported Tdarr state.
    if(c.phase==='imported'){await observeImported(c,cfg);await persist(c);continue;}
    const m=await api(con,'/movie/'+c.movieId),queue=(await api(con,'/queue?pageSize=1000')).records.filter(q=>q.movieId===c.movieId);
    c.queue=queue.map(downloadQueue);
    if(c.searchId){const s=await api(con,'/command/'+c.searchId);c.search={id:s.id,status:s.status,message:s.message};}
    if(m.movieFileId&&m.movieFileId!==c.oldFileId){
     const root=con.mediaRoot+'/',f=m.movieFile;if(!f?.path?.startsWith(root)||f.sceneName&&new RegExp(titleRegex(c.sourceTitle),'i').test(f.sceneName))throw Error('Importovaná kopie je původní vydání nebo má neplatnou cestu.');
     const relative=f.path.slice(root.length),s=await safeFile(cfg.mediaRoot,relative);if(s.stat.size!==f.size)throw Error('Velikost importu se neshoduje.');if(c.phase==='queue_intent'&&(relative!==c.replacementRelative||retentionFP(s.stat).split(':').slice(0,4).join(':')!==c.replacementSourceFP.split(':').slice(0,4).join(':')))throw Error('Identita náhrady se po přerušeném předání změnila.');
     c.replacement={title:f.sceneName,quality:f.quality?.quality?.name,languages:(f.languages||[]).map(v=>v.name),bytes:f.size};
     c.replacementRelative=relative;c.replacementSourceFP=retentionFP(s.stat);
     if(Date.now()-s.stat.mtimeMs<600000){c.message='Nová kopie je importovaná; čekám 10 minut na stabilní soubor.';observed(c);await persist(c);continue;}
     if(c.nativeAudioRepair){const probe=JSON.parse((await runProbe(cfg.ffprobe,['-v','error','-show_streams','-of','json',s.path],{timeout:60000,maxBuffer:4000000})).stdout);if(!hasNorwegianAudio(probe.streams||[]))throw Error('Náhrada nemá označený norský dialog; karanténa zůstává zachovaná.');if((await safeFile(cfg.mediaRoot,relative)).fp!==s.fp)throw Error('Import se během kontroly zvuku změnil.');c.nativeAudioVerifiedAt=new Date().toISOString();}
     if(!cfg.libraryId)throw Error('Pro automatické předání vyplň ID knihovny Tdarr.');
     if(await isWorkerBusy({relative,reviewRelative:'',outputRelative:relative})){await observeImported(c,cfg);await persist(c,'imported','Novou kopii už zpracovává Tdarr. Karanténa je zachovaná.');continue;}
     await persist(c,'queue_intent','Předávám novou kopii Tdarru.');const file=cfg.sourceRoots[0]+'/'+relative;
     c.handoffStatus=await ensureHandoff({tdarr,file,libraryId:cfg.libraryId});
     c.tdarrStatus=c.handoffStatus;observed(c);
     await persist(c,'imported','Náhrada je předaná Tdarru. Obě původní kopie zůstávají v karanténě; kvalitu náhrady ještě ověř.');
    }else{c.message=queue.length?'Radarr stahuje náhradu podle profilu.':['failed','aborted','cancelled'].includes(c.search?.status)?'Hledání v Radarru selhalo nebo bylo zrušené. Obě kopie jsou zachované v karanténě.':c.search?.status==='completed'?'Hledání dokončeno; ve frontě není náhrada. Žádné vhodné vydání nemusí být dostupné.':'Radarr hledá náhradu.';observed(c);await persist(c);}
   }catch(e){c.observationError=e.message;c.statusUpdated=new Date().toISOString();delete c.tdarrStatus;c.message='Kontrola stavu: '+e.message;await persist(c);}}
  }finally{observing=false;}
 }
 async function restore(id){
  if(observing||mutating)throw Error('Probíhá kontrola náhrad, zkus to za chvíli.');
  const c=(await list()).find(v=>v.id===id);if(!c||!['waiting','manual'].includes(c.phase)||!c.originalQuarantine)throw Error('Tuto žádost nelze obnovit.');
  const con=await connection(),cfg=getConfig();if(c.radarrUrl!==con.url||c.mediaRoot!==cfg.mediaRoot||c.reviewRoot!==cfg.reviewRoot)throw Error('Mapování se změnilo.');
  const current=await api(con,'/movie/'+c.movieId);
  if(current.movieFileId&&(current.movieFileId!==c.oldFileId||current.movieFile?.path!==c.radarrRoot+'/'+c.relative||current.movieFile.size!==c.sourceSize||current.movieFile.sceneName!==c.sourceTitle)||(await api(con,'/queue?pageSize=1000')).records.some(q=>q.movieId===c.movieId))throw Error('Radarr již eviduje novou kopii nebo stahování. Nejprve ho vyřeš v Radarru.');
  const item={relative:c.relative,reviewRelative:c.reviewRelative};mutating=true;
  try{
   await pauseDispatch(item);
   const moves=[];
   for(const [source,dest,fp]of [[c.originalQuarantine,c.sourcePath,c.originalFP],[c.reviewQuarantine,c.reviewPath,c.reviewFP]].filter(([source,dest,fp])=>source&&dest&&fp)){
    let s;try{s=await fs.lstat(source)}catch(e){if(e.code!=='ENOENT')throw e;const original=await fs.lstat(dest);if(!original.isFile()||original.isSymbolicLink()||original.nlink!==1||[original.dev,original.ino,original.size,original.mtimeMs,original.ctimeMs].join(':')!==fp)throw Error('Původní soubor se změnil.');continue;}
    if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||[s.dev,s.ino,s.size,s.mtimeMs].join(':')!==fp.split(':').slice(0,-1).join(':'))throw Error('Karanténa se změnila.');
    try{await fs.lstat(dest);throw Error('Cílový soubor už existuje.');}catch(e){if(e.code!=='ENOENT')throw e;}
    const root=source===c.originalQuarantine?cfg.mediaRoot:cfg.reviewRoot;if((await fs.realpath(path.dirname(dest)))!==path.dirname(dest)||!dest.startsWith(await fs.realpath(root)+path.sep))throw Error('Cílová cesta se změnila.');
    moves.push([source,dest]);
   }
   await verifyPaused(item);await persist(c,'restore_intent','Obnovuji obě zachované kopie.');for(const [source,dest]of moves)await fs.rename(source,dest);
   const m=await api(con,'/movie/'+c.movieId);m.qualityProfileId=c.originalProfileId;await api(con,'/movie/'+m.id,'PUT',m);await api(con,'/command','POST',{name:'RescanMovie',movieId:m.id});await persist(c,'restored','Originál i převod byly vráceny. Před schválením znovu ověř položku Review.');return visible(c);
  }catch(e){await persist(c,'manual',e.message);throw e}finally{try{await resume()}finally{mutating=false;}}
 }
 async function cleanupLanguageRepairs(){
  const directory=path.join(data,'language-repairs'),cfg=getConfig();await fs.mkdir(directory,{recursive:true});
  for(const name of await fs.readdir(directory)){if(!name.endsWith('.json'))continue;const file=path.join(directory,name),st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink())continue;const c=JSON.parse(await fs.readFile(file,'utf8'));
   try{await retainCase(c,{mediaRoot:cfg.mediaRoot,reviewRoot:cfg.reviewRoot,reviewQuarantineRoot:path.join(cfg.reviewRoot,'.language-repair-backups'),atomicCase:record=>atomicJSON(file,record)});delete c.retentionError;}catch(e){c.retentionError=e.message;}
   await atomicJSON(file,c);
  }
 }
 async function cleanup(){await cleanupLanguageRepairs();const cfg=getConfig(),con=await connection();for(const c of (await list()).filter(c=>c.phase==='imported')){try{await retainCase(c,{mediaRoot:cfg.mediaRoot,reviewRoot:cfg.reviewRoot,quarantineRoot:con.quarantineRoot||path.join(path.dirname(cfg.mediaRoot),'.tdarr-review-quarantine'),reviewQuarantineRoot:path.join(cfg.reviewRoot,'.radarr-quarantine'),atomicCase:persist});if(c.retentionError){delete c.retentionError;await persist(c);}}catch(e){c.retentionError=e.message;await persist(c);}}}
 // The shared Recovery status file, or null when Recovery is not installed.
 async function readRecoveryStatus(){
  try{const cfg=getConfig(),file=path.join(path.dirname(cfg.mediaRoot),'.tdarr-recovery-status.json'),s=await fs.lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.size>2000000)throw Error('Invalid recovery status');const v=JSON.parse(await fs.readFile(file,'utf8'));if(v.version!==1||!Array.isArray(v.cases))throw Error('Invalid recovery schema');return v;}catch(e){if(e.code==='ENOENT')return null;throw e;}
 }
 // Recovery's config.json edited after start-up (#22); only these fields leave the server.
 function configNotice(status){
  const change=status?.configChange;
  if(!change||change.restartRequired!==true)return null;
  return {detectedAt:typeof change.detectedAt==='string'&&Number.isFinite(Date.parse(change.detectedAt))?change.detectedAt:null,restartRequired:true,valid:change.valid!==false,error:typeof change.error==='string'?change.error.slice(0,300):null};
 }
 async function recoveryPublic(v){
  if(!v)return [];
  try{const con=await connection();return v.cases.map(c=>({...c,source:'recovery',canRestore:false,queue:Array.isArray(c.queue)?c.queue:[],radarrMovieUrl:c.titleSlug?new URL('/movie/'+encodeURIComponent(c.titleSlug),con.url).href:con.url,statusUpdated:Object.hasOwn(c,'statusUpdated')?c.statusUpdated:v.updated}));}catch(e){if(e.code==='ENOENT')return [];throw e;}
 }
 // One status-file read per call: the request list and the restart notice come from the same snapshot.
 async function overview(){
  let status=null,statusError=null;try{status=await readRecoveryStatus()}catch(e){statusError=e}
  const own=(await list()).map(visible);if(statusError)throw statusError;
  return {requests:[...own,...await recoveryPublic(status)],recoveryConfig:configNotice(status)};
 }
 return {cleanup,settings,publicSettings,prepare,run,restore,observe,overview,recoveryConfig:async()=>configNotice(await readRecoveryStatus().catch(()=>null)),list:async()=>(await overview()).requests,recover:async()=>{for(const c of await list())if(!canResume(c))await persist(c,'manual','Operace byla přerušená ve fázi '+c.phase+'. Neopakuj ji bez kontroly; zachované kopie nebyly smazané.');}};
}
