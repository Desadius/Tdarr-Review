import {extractPreview} from './av-preview.mjs';
import {publishApproval} from './quarantine-retention.mjs';
import {extractListeningAudio} from './audio-listen.mjs';
import {assessment} from './assessment.mjs';
import {extractAudio,alignment} from './audio-compare.mjs';
import {remountOnly,durationException} from './recheck.mjs';
import {statistics} from './stats.mjs';
import {defaults,validate,checkPaths,mapReview} from './config.mjs';
import {extractFrame} from './frames.mjs';
import http from 'node:http';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {safeFile,sourceRelative,fingerprint,hash,atomicJSON,command,probe,inspect,replaceChecked,recoverTransactions} from './core.mjs';
import {measure} from './progress.mjs';
import {captureReceipt,cleanupReviewed} from './cleanup.mjs';
import {resolveReviewSource} from './source-mapping.mjs';
import {matchReviewJob} from './job-matching.mjs';
import {createArtwork,requestArtworkIdentity} from './artwork.mjs';
import {createReviewSessionStore,ReviewSessionError,reviewRequirements} from './review-session.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const DATA=process.env.DATA_ROOT||'/data',PORT=Number(process.env.PORT||8270);
const configfile=path.join(DATA,'settings.json');
let config=validate(JSON.parse(await fs.readFile(configfile,'utf8').catch(e=>{if(e.code!=='ENOENT')throw e;return JSON.stringify(defaults())})));
let MEDIA,REVIEW,TDARR,DB,FFPROBE,HOST;
function applyConfig(){({mediaRoot:MEDIA,reviewRoot:REVIEW,tdarrUrl:TDARR,database:DB,ffprobe:FFPROBE}=config);HOST=new URL(config.publicOrigin).host;}
applyConfig();
let statsCache=null,statsTask=null;
let settingsBusy=false;
await fs.mkdir(DATA,{recursive:true});await fs.mkdir(path.join(DATA,'transactions'),{recursive:true});
const keyfile=path.join(DATA,'access-key');
let KEY=await fs.readFile(keyfile,'utf8').catch(()=>null);
if(!KEY){KEY=crypto.randomBytes(24).toString('base64url');await fs.writeFile(keyfile,KEY,{mode:0o600,flag:'wx'})}
KEY=KEY.trim();
const statefile=path.join(DATA,'state.json');
import { rejectionReason, recordRejection } from './rejection-audit.mjs';
import {createReplacement} from './radarr-replacement.mjs';
let state=JSON.parse(await fs.readFile(statefile,'utf8').catch(()=>'{"items":{},"history":[],"sessions":{},"pauses":[]}'));
if(!state.reviewSessions||typeof state.reviewSessions!=='object'||Array.isArray(state.reviewSessions))state.reviewSessions={};
for(const h of state.history||[])if(h.status==='error'&&h.message?.includes('Unexpected token')&&h.message.includes('OK'))h.fixedIn='1.1.0';
let previewBusy=false;
let active=null,scanPromise=null,cache=null,cacheAt=0,batchRunning=false;
let saveChain=Promise.resolve();
const save=()=>{const snapshot=structuredClone(state);saveChain=saveChain.catch(()=>{}).then(()=>atomicJSON(statefile,snapshot));return saveChain};
const reviewSessions=createReviewSessionStore({getState:()=>state,save,verify:verifyReviewItem});
function reviewMutationBlocked(){return active||batchRunning||resumeTask||previewBusy||settingsBusy||scanPromise||recovery.length||state.pauses.length}
async function verifyReviewItem(item,{id,snapshot},guard=true){
 if(guard&&reviewMutationBlocked())throw new ReviewSessionError('Nejprve dokonči probíhající akci nebo obnovu.',409);
 if(typeof item.reviewRelative!=='string'||hash(item.reviewRelative).slice(0,24)!==id||state.items[id]!==item||item.snapshot!==snapshot)throw new ReviewSessionError('Položku nelze bezpečně přiřadit k revizi. Obnov přehled.',409);
 let a,b;
 try{a=await safeFile(MEDIA,item.relative);b=await safeFile(REVIEW,item.reviewRelative)}catch{throw new ReviewSessionError('Soubory nejsou dostupné nebo se změnily. Obnov přehled.',409)}
 if(hash(a.fp+'|'+b.fp)!==snapshot)throw new ReviewSessionError('Soubory se změnily. Obnov přehled.',409);
 const read=async file=>JSON.parse(await command(FFPROBE,['-v','error','-show_streams','-show_format','-of','json',file],{timeout:30000}));
 const [original,review]=await Promise.all([read(a.path),read(b.path)]);
 let unchanged=false;try{unchanged=(await safeFile(MEDIA,item.relative)).fp===a.fp&&(await safeFile(REVIEW,item.reviewRelative)).fp===b.fp}catch{}
 if(!unchanged)throw new ReviewSessionError('Soubory se během kontroly změnily. Obnov přehled.',409);
 if(guard&&reviewMutationBlocked())throw new ReviewSessionError('Během ukládání začala jiná akce. Zkus revizi znovu.',409);
 if(state.items[id]!==item||item.snapshot!==snapshot)throw new ReviewSessionError('Položka se během kontroly změnila. Obnov přehled.',409);
 const duration=Math.min(Number(original.format?.duration),Number(review.format?.duration));
 if(!Number.isFinite(duration)||duration<=0)throw new ReviewSessionError('Nelze ověřit délku kontrolovaných souborů.',409);
 const indexes=probe=>(probe.streams||[]).filter(stream=>stream.codec_type==='audio').map(stream=>stream.index);
 return {duration,originalIndexes:indexes(original),reviewIndexes:indexes(review),requirements:reviewRequirements(original,review)};
}
const sessions=new Map(Object.entries(state.sessions||{}));
async function readRows(table,cfg=config){
 const collections={jobsjsondb:'JobsJSONDB',librarysettingsjsondb:'LibrarySettingsJSONDB',statisticsjsondb:'StatisticsJSONDB'};
 if(!collections[table])throw Error('Unsupported Tdarr collection');
 let db;
 try{db=new DatabaseSync(cfg.database,{readOnly:true});return db.prepare(`SELECT json_data FROM ${table}`).all().map(r=>JSON.parse(r.json_data))}
 catch(e){if(!/unable to open database file/.test(e.message))throw e}
 finally{db?.close()}
 const r=await fetch(cfg.tdarrUrl+'/api/v2/cruddb',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({data:{collection:collections[table],mode:'getAll'}}),signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Error('Tdarr database API: '+r.status);
 const rows=await r.json();if(!Array.isArray(rows)||rows.some(x=>!x||typeof x!=='object'||Array.isArray(x)))throw Error('Invalid Tdarr database response');
 return rows;
}
const dbRows=table=>readRows(table);
async function tdarr(route,data){const r=await fetch(TDARR+route,{method:data?'POST':'GET',headers:{'content-type':'application/json'},body:data?JSON.stringify({data}):undefined,signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error('Tdarr neodpovídá: '+r.status);const t=await r.text();let value;try{value=t?JSON.parse(t):null}catch{value=t}if(route==='/api/v2/get-nodes'&&(!value||typeof value!=='object'||Array.isArray(value)))throw new Error('Tdarr vrátil neplatný seznam nodů.');return value}
function canonical(p,node){p=String(p||'').replaceAll('\\','/');for(const t of node.config?.pathTranslators||[]){const from=t.node.replaceAll('\\','/').replace(/\/$/,'');if(from&&(p===from||p.startsWith(from+'/')))return t.server+p.slice(from.length)}return p}
function workerBusy(nodes,item){
  for(const n of Object.values(nodes))for(const w of Object.values(n.workers||{})){
    if(w.idle||!w.file)continue;
    const p=canonical(w.file,n);
    if(config.sourceRoots.some(root=>p===root+'/'+item.relative||p===root+'/'+item.outputRelative)||p===config.tdarrReviewRoot+'/'+item.reviewRelative)return true;
  }return false;
}
let resumeTask=null;
function resume(){
 if(resumeTask)return resumeTask;
 resumeTask=(async()=>{
  const pending=[];
  for(const p of state.pauses||[]){try{const ns=await tdarr('/api/v2/get-nodes');const n=Object.values(ns).find(n=>n.nodeName===p.name);if(!n){pending.push(p);continue}if(n.nodePaused)await tdarr('/api/v2/update-node',{nodeID:n._id,nodeUpdates:{nodePaused:false}})}catch{pending.push(p)}}
  state.pauses=pending;await save();
 })().finally(()=>{resumeTask=null});
 return resumeTask;
}
async function pauseDispatch(item){
  let nodes=await tdarr('/api/v2/get-nodes');
  if(workerBusy(nodes,item))throw new Error('Tento film právě zpracovává Tdarr. Schválení počká na dokončení úlohy; zkus ho poté znovu.');
  for(const n of Object.values(nodes))if(!n.nodePaused){
    state.pauses.push({name:n.nodeName});await save();
    await tdarr('/api/v2/update-node',{nodeID:n._id,nodeUpdates:{nodePaused:true}});
  }
  await new Promise(r=>setTimeout(r,2000));
  await verifyPaused(item);
}
async function verifyPaused(item){const nodes=await tdarr('/api/v2/get-nodes');if(Object.values(nodes).some(n=>!n.nodePaused)||workerBusy(nodes,item))throw new Error('Během výměny se změnil stav nodů. Originál nebyl vyměněn.');}

const replacements=createReplacement({data:DATA,getConfig:()=>config,safeFile,hash,atomicJSON,tdarr,pauseDispatch,verifyPaused,isWorkerBusy:async item=>workerBusy(await tdarr('/api/v2/get-nodes'),item),resume,onProgress:stage=>progress(stage)});
const artwork=createArtwork({data:DATA,getConnection:async()=>JSON.parse(await fs.readFile(path.join(DATA,'radarr.json'),'utf8'))});
await replacements.recover();
async function replacementAction(item,reason){
 active={id:item.id,title:item.title,action:'replace',stage:'Připravuji žádost Radarru',started:Date.now()};
 let outcome;
 try{const request=await replacements.run(item,reason);outcome={id:item.id,title:item.title,action:'replace',status:'success',requestId:request.id,rejectionReason:reason,time:new Date().toISOString(),savedBytes:0};delete state.items[item.id];delete state.reviewSessions[item.id];}
 catch(e){outcome={id:item.id,title:item.title,action:'replace',status:'error',message:e.message,rejectionReason:reason,time:new Date().toISOString()};}
 finally{state.history.unshift(outcome);state.history=state.history.slice(0,150);await save();active=null;cache=null;}
}
const replacementTimer=setInterval(()=>{if(!active&&!batchRunning&&!previewBusy&&!settingsBusy&&!scanPromise&&!reviewSessions.busy&&!recovery.length&&!state.pauses.length)void replacements.observe().then(()=>replacements.cleanup()).catch(e=>console.error('Radarr status: '+e.message));},60000);replacementTimer.unref();

// Recover/inspect transactions before restarting dispatch; never replay approvals after restart.
const recovery=await recoverTransactions(path.join(DATA,'transactions'));
if(!recovery.length)await resume();
if(state.batch?.status==='running'){
  state.batch.status='interrupted';
  state.batch.message='Aplikace byla restartována. Zbývající filmy nebyly automaticky schválené; vyber je znovu.';
  await save();
}
async function walk(dir,prefix=''){
  const result=[];
  for(const e of await fs.readdir(dir,{withFileTypes:true}).catch(()=>[])){
    if(e.isSymbolicLink()||e.name.startsWith('.'))continue;
    const rel=prefix?prefix+'/'+e.name:e.name;
    if(e.isDirectory()&&rel.split('/').length<12)result.push(...await walk(path.join(dir,e.name),rel));
    else if(e.isFile()&&e.name.toLowerCase().endsWith('.mkv'))result.push(rel);
  }return result;
}
const healthCache=new Map();
async function jobHealth(job){
 if(healthCache.has(job._id))return healthCache.get(job._id);
 try{
  const root=path.resolve(path.dirname(DB),'..','JobReports');
  const f=await safeFile(root,job.job.footprintId+'/'+job.job.fileId);
  if(f.stat.size>12*1024*1024)return 'unknown';
  const lines=(await fs.readFile(f.path,'utf8')).split('\n');let status='unknown';
  for(const line of lines){const m=line.match(/^\S+ ([^:]+):Node\[[^\]]+\]:Worker\[[^\]]+\]:(.*)$/);if(!m||m[1]!==job._id)continue;if(/^Strict health check passed: main video and all \d+ audio streams\./.test(m[2]))status='pass';if(/^STRICT HEALTH CHECK FAILED:/.test(m[2]))status='fail'}
  if(healthCache.size>256)healthCache.clear();healthCache.set(job._id,status);return status;
 }catch{return 'unknown'}
}
async function scan(force=false,recheckId=null){
  if(reviewSessions.busy){if(cache)return cache;await reviewSessions.idle()}
  if(settingsBusy)return cache||[];
  if((active||previewBusy)&&cache)return cache;
  if(scanPromise)return scanPromise;
  if(!force&&cache&&Date.now()-cacheAt<15000)return cache;
  scanPromise=(async()=>{
    const jobs=(await dbRows('jobsjsondb')).filter(j=>j.status==='Transcode success').sort((a,b)=>b.end-a.end);
    const list=[];
    for(const rel of await walk(REVIEW)){
      let relative=mapReview(rel,config.reviewPrefixes);if(!relative)continue;const outputRelative=relative;
      const id=hash(rel).slice(0,24);
      const item={id,title:relative.split('/')[0],relative,reviewRelative:rel,status:'ready',reason:'',audio:[],subtitles:[]};
      try {
        const mapping=await resolveReviewSource(MEDIA,REVIEW,outputRelative,rel);relative=mapping.relative;Object.assign(item,{relative,outputRelative});
        const a=await safeFile(MEDIA,relative),b=await safeFile(REVIEW,rel);
        item.originalBytes=a.stat.size;item.reviewBytes=b.stat.size;item.saving=100*(1-b.stat.size/a.stat.size);
        item.snapshot=hash(a.fp+'|'+b.fp);
        const job=matchReviewJob(jobs,{
          receipt:mapping.receipt,libraryId:config.libraryId,sourceRoots:config.sourceRoots,
          relative,sourceBytes:a.stat.size,outputBytes:b.stat.size,
        });
        if(b.stat.mtimeMs>Date.now()-120000)throw new Error('Soubor je čerstvě vytvořený. Čekám na dokončení zápisu.');
        const prior=state.items[id];
        const changed=prior&&prior.snapshot!==item.snapshot;
        const refreshed=changed&&prior.originalFP===a.fp&&prior.jobId!==job._id;
        const remounted=changed&&remountOnly(prior,a.fp,b.fp);
        item.canRecheck=!!remounted;
        const rechecked=remounted&&recheckId===id;
        if(changed&&!refreshed&&!rechecked)throw new Error('Soubory se od zařazení do review změnily. Vyžadují kontrolu.');
        let info=(refreshed||rechecked)?null:prior?.info;
        if(info?.evidenceVersion!==1||typeof info.reviewRequirements?.hdr!=='boolean')info=null;
        if(!info){const pa=await probe(FFPROBE,a.path),pb=await probe(FFPROBE,b.path);info={...inspect(pa,pb),reviewRequirements:reviewRequirements(pa,pb)}}
        Object.assign(item,info);
        item.canApproveDuration=durationException(info)&&b.stat.size<a.stat.size;
        if(info.durationMismatch){item.status='blocked';item.reason='Rozdílná délka — vyžaduje zvláštní kontrolu, automatické schválení je zablokované.'}
        else if(b.stat.size>=a.stat.size){item.status='blocked';item.reason='Výsledek není menší než originál.'}
        else item.reason=`Úspora ${item.saving.toFixed(1)} %; rozdíl délky ${(info.durationB-info.durationA).toFixed(3)} s. ${item.saving>75?'Výrazné zmenšení: porovnej detaily obrazu, zrno a tmavé scény.':'Před schválením posuď obraz a zvuk při přehrávání.'}`;
        item.jobId=job._id;
        const samples=prior?.snapshot===item.snapshot?(prior.audioSamples||[]):[];
        item.assessment=assessment(item,info,{job:true,health:await jobHealth(job),samples});
        state.items[id]={snapshot:item.snapshot,info,originalFP:a.fp,reviewFP:b.fp,relative,outputRelative,reviewRelative:rel,jobId:job._id,audioSamples:samples};
      }catch(e){item.status='blocked';item.reason=e.message}
      if(!item.assessment)item.assessment=assessment(item,null);
      list.push(item);
    }
    await save();cache=list;cacheAt=Date.now();return list;
  })().finally(()=>{scanPromise=null});return scanPromise;
}
function progress(stage,step=1,phase='metadata'){
  if(active)Object.assign(active,{stage,step,phase,phaseStarted:Date.now(),updatedAt:Date.now(),percent:null,done:null,total:null,unit:null,rate:null,speed:null,fps:null,etaSeconds:null});
}
function measured(p){
  if(!active||p.phase&&p.phase!==active.phase)return;
  Object.assign(active,measure(p.done,p.total,active.phaseStarted,Date.now(),p.speed),{unit:p.unit,updatedAt:Date.now(),speed:p.speed??null,fps:p.fps??null});
}
async function perform(action,item,acceptDuration=false,reason){
  if(action==='reject')reason=rejectionReason(reason);
  const previous=state.items[item.id];
  active={id:item.id,title:item.title,action,stage:'Ověřuji soubory',started:Date.now()};
  progress('Ověřuji soubory, délku a zachované stopy');
  let journal,warning,outcome,reviewEvidence;
  try {
    if(action==='approve')reviewEvidence=reviewSessions.approval(item.id,item.snapshot,item.reviewRevision);
    if(recovery.length)throw new Error('Je nutné dokončit obnovu předchozí výměny.');
    const a=await safeFile(MEDIA,item.relative),b=await safeFile(REVIEW,item.reviewRelative);
    if(hash(a.fp+'|'+b.fp)!==item.snapshot)throw new Error('Soubory se změnily. Obnov přehled.');
    const nodes=await tdarr('/api/v2/get-nodes');if(workerBusy(nodes,item))throw new Error('Tento film právě zpracovává Tdarr. Zkus akci po dokončení.');
    const receipt=await captureReceipt(REVIEW,item.reviewRelative,item.relative,b.stat);
    if(action==='reject'){
      progress('Odstraňuji pouze review kopii');
      if((await safeFile(REVIEW,item.reviewRelative)).fp!==b.fp)throw new Error('Review soubor se změnil.');
      await recordRejection(DATA,{event:'requested',id:item.id,title:item.title,action,reason,jobId:item.jobId||previous?.jobId,relative:item.relative,reviewRelative:item.reviewRelative,snapshot:item.snapshot,originalBytes:item.originalBytes,reviewBytes:item.reviewBytes,assessment:item.assessment});
      await fs.unlink(b.path);
    } else {
      // Tdarr performs the full health check; Review only verifies metadata and safe replacement.
      const info=inspect(await probe(FFPROBE,a.path),await probe(FFPROBE,b.path));
      if(info.durationMismatch&&!(acceptDuration&&item.canApproveDuration&&durationException(info)))throw new Error('Rozdílnou délku nelze schválit bez zvláštní kontroly.');
      progress('Pozastavuji přijímání nových úloh v Tdarru',2,'pause');
      await pauseDispatch(item);
      journal=path.join(DATA,'transactions',crypto.randomUUID()+'.json');
      const labels={'preparing':['Kopíruji výsledek do složky filmu',3],'syncing-copy':['Čekám na dokončení zápisu na disk',3],'verifying-copy':['Porovnávám kontrolní součty obou kopií',4],'ready':['Připravuji výměnu',5],'original-backed-up':['Nahrazuji originál',5],'installed':['Dokončuji výměnu',5],'original-removed':['Odstraňuji hotovou review kopii',5],'complete':['Soubor je nahrazený',5]};
      await replaceChecked({original:a.path,review:b.path,destination:item.outputRelative&&item.outputRelative!==item.relative?path.join(path.dirname(a.path),path.basename(item.outputRelative)):a.path,originalFP:previous.originalFP,reviewFP:previous.reviewFP,journal,onStage:s=>progress(labels[s][0],labels[s][1],s),onProgress:measured,beforeCommit:()=>verifyPaused(item)});
      try{await publishApproval({mediaRoot:MEDIA,relative:item.relative,sourceFP:previous.originalFP,installedRelative:item.outputRelative||item.relative,atomic:atomicJSON})}catch(e){warning='Film je schválený, ale důkaz pro úklid karantény se neuložil: '+e.message}
      progress('Obnovuji údaje filmu v Tdarru',6,'rescan');
      try {
        const lib=(await dbRows('librarysettingsjsondb')).find(l=>config.libraryId?l._id===config.libraryId:config.sourceRoots.includes(String(l.folder).replace(/\/$/,'')));
        if(lib)await tdarr('/api/v2/rescan-file',{_id:String(lib.folder).replace(/\/$/,'')+'/'+(item.outputRelative||item.relative),DB:lib._id});
      }catch(e){warning='Film je nahrazený, ale aktualizace údajů v Tdarru selhala: '+e.message}
    }
    progress('Uklízím prázdné složky review',6,'cleanup');
    try{await cleanupReviewed(REVIEW,item.reviewRelative,receipt,config.reviewPrefixes)}catch(e){warning=[warning,'Film je vyřízený, ale úklid review selhal: '+e.message].filter(Boolean).join(' ')}
    outcome={id:item.id,title:item.title,action,rejectionReason:action==='reject'?reason:undefined,jobId:item.jobId||previous?.jobId,reviewSession:reviewEvidence,acceptedDurationDifference:acceptDuration?item.durationA-item.durationB:undefined,status:'success',warning,time:new Date().toISOString(),elapsedSeconds:Math.round((Date.now()-active.started)/1000),savedBytes:action==='approve'?item.originalBytes-item.reviewBytes:0};state.history.unshift(outcome);
    delete state.items[item.id];delete state.reviewSessions[item.id];statsCache=null;
  }catch(e){
    outcome={id:item.id,title:item.title,action,rejectionReason:action==='reject'?reason:undefined,jobId:item.jobId||previous?.jobId,reviewSession:reviewEvidence,status:'error',message:e.message,time:new Date().toISOString()};state.history.unshift(outcome);
    if(journal){const t=JSON.parse(await fs.readFile(journal,'utf8').catch(()=>'{"phase":"unknown"}'));if(!['aborted','complete'].includes(t.phase))recovery.push(t.id||'unknown');}
  }finally{if(action==='reject'){try{await recordRejection(DATA,{event:'completed',...outcome})}catch(e){outcome.warning=[outcome.warning,'Uložení výsledku do archivu zamítnutí selhalo: '+e.message].filter(Boolean).join(' ');}}if(!recovery.length){progress('Obnovuji původní stav nodů',6,'resume');await resume()}state.history=state.history.slice(0,150);await save();active=null;cache=null;}
  return outcome;
}
async function performBatch(items){
  batchRunning=true;
  state.batch={id:crypto.randomUUID(),status:'running',total:items.length,finished:0,failed:0,started:new Date().toISOString(),results:[],remaining:items.map(x=>({id:x.id,title:x.title}))};
  try {
    await save();
    for(const item of items){
      if(recovery.length||state.pauses.length){state.batch.status='interrupted';state.batch.message='Dávka je zastavená kvůli nedokončené výměně nebo obnovení nodů.';break}
      const result=await perform('approve',item);
      state.batch.results.push(result);state.batch.finished++;if(result.status==='error')state.batch.failed++;
      state.batch.remaining.shift();await save();
    }
    if(state.batch.status==='running')state.batch.status='complete';
  }catch(e){state.batch.status='interrupted';state.batch.message=e.message;console.error(e)}
  finally{state.batch.ended=new Date().toISOString();await save();batchRunning=false;cache=null}
}
async function body(req){let b='';for await(const chunk of req){b+=chunk;if(b.length>32768)throw new Error('Požadavek je příliš velký.')}return JSON.parse(b||'{}')}
function respond(res,status,data,headers={}){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers});res.end(JSON.stringify(data))}
const authAttempts=new Map();
const server=http.createServer(async(req,res)=>{
  try {
    if(req.headers.host!==HOST)return respond(res,403,{error:'Nepovolená adresa serveru.'});
    const url=new URL(req.url,'http://'+HOST);
    if(req.method==='POST'&&req.headers.origin!==config.publicOrigin)return respond(res,403,{error:'Nepovolený původ požadavku.'});
    if(req.method==='POST'&&req.headers['content-type']!=='application/json')return respond(res,415,{error:'Vyžadován JSON.'});
    if(url.pathname==='/api/login'&&req.method==='POST'){
      const ip=req.socket.remoteAddress,now=Date.now(),attempt=authAttempts.get(ip)||{at:now,count:0};
      if(now-attempt.at>60000){attempt.at=now;attempt.count=0}if(++attempt.count>12)return respond(res,429,{error:'Zkus přihlášení za minutu.'});authAttempts.set(ip,attempt);
      const b=await body(req);
      if(hash(String(b.key||''))!==hash(KEY))return respond(res,401,{error:'Nesprávný přístupový klíč.'});
      const token=crypto.randomBytes(32).toString('base64url');sessions.set(hash(token),Date.now()+30*86400000);state.sessions=Object.fromEntries(sessions);await save();
      return respond(res,200,{ok:true},{'set-cookie':`review_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000`});
    }
    const cookie=/review_session=([^;]+)/.exec(req.headers.cookie||'')?.[1];
    const authenticated=cookie&&(sessions.get(hash(cookie))||0)>Date.now();
    if(url.pathname.startsWith('/api/')&&!authenticated)return respond(res,401,{error:'Přihlas se přístupovým klíčem.'});
    const poster=/^\/api\/artwork\/(review|request)\/([a-f0-9]{24})$/.exec(url.pathname);
    if(poster&&req.method==='GET'){
      let record;
      if(poster[1]==='review')record=(await scan()).find(item=>item.id===poster[2]);
      else{
        const visible=(await replacements.list()).find(item=>item.id===poster[2]);
        if(visible)record=await requestArtworkIdentity(DATA,visible);
      }
      if(!record)return respond(res,404,{error:'Plakát není dostupný.'});
      const image=await artwork.lookup(poster[1],record);
      if(!image)return respond(res,404,{error:'Plakát není dostupný.'});
      const headers={'content-type':image.mime,'cache-control':'private, max-age=300','x-content-type-options':'nosniff','x-artwork-status':image.status,'etag':image.etag,'content-security-policy':"default-src 'none'; frame-ancestors 'none'"};
      if(req.headers['if-none-match']===image.etag){res.writeHead(304,headers);res.end();return;}
      res.writeHead(200,{...headers,'content-length':image.body.length});res.end(image.body);return;
    }
    if(url.pathname==='/api/statistics'&&req.method==='GET'){
      if(settingsBusy)return respond(res,409,{error:'Probíhá změna nastavení.'});
      if(!statsCache||Date.now()-statsCache.at>60000){
        if(!statsTask)statsTask=(async()=>{const result=await statistics({dbRows,config:structuredClone(config),data:DATA,items:await scan()});statsCache=result;return result})().finally(()=>{statsTask=null});
        await statsTask;
      }
      return respond(res,200,statsCache);
    }
    if(url.pathname==='/api/quarantine'&&req.method==='GET'){
      const parent=path.dirname(await fs.realpath(config.mediaRoot)),settings=await replacements.publicSettings();
      const roots=[path.join(parent,'.tdarr-corrupt'),settings.quarantineRoot||path.join(parent,'.tdarr-review-quarantine'),path.join(await fs.realpath(config.reviewRoot),'.radarr-quarantine')];
      const files=[],warnings=[];
      for(const root of [...new Set(roots)]){
        try{
          if(await fs.realpath(root)!==root)throw Error('Karanténa nesmí být symlink.');
          for(const entry of await fs.readdir(root,{withFileTypes:true})){
            if(!entry.isDirectory()||entry.isSymbolicLink())continue;
            const folder=path.join(root,entry.name);if(await fs.realpath(folder)!==folder)continue;
            for(const name of await fs.readdir(folder)){
              const file=path.join(folder,name),st=await fs.lstat(file);
              if(st.isFile()&&!st.isSymbolicLink())files.push({caseId:entry.name,name,path:file,bytes:st.size});
            }
          }
        }catch(e){if(e.code!=='ENOENT')warnings.push('Nelze načíst '+root+': '+e.message);}
      }
      return respond(res,200,{files,warnings,retentionDays:7,cleanupEnabled:true});
    }
    if(url.pathname==='/api/radarr/settings'&&req.method==='GET')return respond(res,200,await replacements.publicSettings());
    if(['/api/radarr/settings','/api/radarr/settings/test'].includes(url.pathname)&&req.method==='POST'){
      if(active||batchRunning||previewBusy||settingsBusy||reviewSessions.busy||scanPromise)return respond(res,409,{error:'Právě probíhá jiná akce.'});
      const b=await body(req);if(active||batchRunning||previewBusy||settingsBusy||reviewSessions.busy||scanPromise)return respond(res,409,{error:'Právě probíhá jiná akce.'});settingsBusy=true;try{return respond(res,200,await replacements.settings(b,url.pathname.endsWith('/test')))}finally{settingsBusy=false}
    }
    if(url.pathname==='/api/radarr/requests'&&req.method==='GET')return respond(res,200,{requests:await replacements.list()});
    const replaceRequest=/^\/api\/items\/([a-f0-9]{24})\/replace$/.exec(url.pathname);
    if(replaceRequest&&req.method==='POST'){
      if(active||batchRunning||resumeTask||previewBusy||settingsBusy||reviewSessions.busy||recovery.length||state.pauses.length)return respond(res,409,{error:'Nejprve dokonči probíhající akci nebo obnovu.'});
      const b=await body(req);let reason;try{reason=rejectionReason(b.reason)}catch(e){return respond(res,400,{error:e.message})}
      const item=(await scan(true)).find(v=>v.id===replaceRequest[1]);
      if(!item?.snapshot||item.snapshot!==b.snapshot)return respond(res,409,{error:'Položka se změnila. Obnov přehled.'});
      if(active||batchRunning||resumeTask||previewBusy||settingsBusy||reviewSessions.busy)return respond(res,409,{error:'Právě probíhá jiná akce.'});
      void replacementAction(item,reason);return respond(res,202,{ok:true});
    }
    const restoreRequest=/^\/api\/radarr\/requests\/([a-f0-9]{24})\/restore$/.exec(url.pathname);
    if(restoreRequest&&req.method==='POST'){
      const b=await body(req);if(b.confirm!==true)return respond(res,400,{error:'Potvrď obnovení zachovaných kopií.'});
      if(active||batchRunning||resumeTask||previewBusy||settingsBusy||reviewSessions.busy||recovery.length||state.pauses.length)return respond(res,409,{error:'Právě probíhá jiná akce.'});
      active={title:'Obnovení karantény',stage:'Ověřuji soubory',started:Date.now()};
      try{const result=await replacements.restore(restoreRequest[1]);delete state.items[result.itemId];delete state.reviewSessions[result.itemId];await save();return respond(res,200,result)}finally{active=null;cache=null}
    }
    if(url.pathname==='/api/settings'&&req.method==='GET')return respond(res,200,{config,revision:hash(JSON.stringify(config))});
    if(['/api/settings/test','/api/settings'].includes(url.pathname)&&req.method==='POST'){
      const b=await body(req);
      if(statsTask||settingsBusy||active||batchRunning||previewBusy||reviewSessions.busy||resumeTask||scanPromise||recovery.length||state.pauses.length)return respond(res,409,{error:'Nejprve dokonči probíhající akce, náhled nebo obnovu.'});
      if(b.revision!==hash(JSON.stringify(config)))return respond(res,409,{error:'Nastavení se mezitím změnilo. Otevři ho znovu.'});
      settingsBusy=true;
      try{
        const candidate=validate(b.config);await checkPaths(candidate);
        const r=await fetch(candidate.tdarrUrl+'/api/v2/get-nodes',{signal:AbortSignal.timeout(12000)});
        if(!r.ok)throw Error('Připojení k Tdarru selhalo: '+r.status);
        const nodes=await r.json();if(!nodes||typeof nodes!=='object'||Array.isArray(nodes))throw Error('Neplatná odpověď Tdarru.');
        const libraries=await readRows('librarysettingsjsondb',candidate);await readRows('jobsjsondb',candidate);
        const matches=libraries.filter(l=>candidate.libraryId?l._id===candidate.libraryId:candidate.sourceRoots.includes(String(l.folder).replace(/\/$/,'')));
        if(matches.length!==1||!candidate.sourceRoots.includes(String(matches[0].folder).replace(/\/$/,'')))throw Error('Vyber jednoznačnou knihovnu a její zdrojovou cestu v Tdarru.');
        if(url.pathname==='/api/settings'){
          await atomicJSON(configfile,candidate);config=candidate;applyConfig();statsCache=null;state.items={};state.reviewSessions={};cache=null;cacheAt=0;await save();
        }
        return respond(res,200,{ok:true,message:'Připojení, databáze a cesty jsou dostupné.',publicOrigin:candidate.publicOrigin,revision:hash(JSON.stringify(config))});
      }finally{settingsBusy=false}
    }
    if(url.pathname==='/api/items'&&req.method==='GET'){
      if(state.pauses.length&&!recovery.length&&!active&&!batchRunning&&!reviewSessions.busy)await resume();
      const items=await scan();
      return respond(res,200,{version:'1.10.3',label:config.label,serverTime:Date.now(),items,reviewSessions:reviewSessions.list(items),active,batch:state.batch||null,batchRunning,history:state.history,recovery,restorePending:state.pauses.length});
    }
    const reviewSession=/^\/api\/items\/([a-f0-9]{24})\/review-session$/.exec(url.pathname);
    if(reviewSession&&req.method==='GET'){
      const id=reviewSession[1],snapshot=url.searchParams.get('snapshot'),item=state.items[id];
      if(!item||item.snapshot!==snapshot)return respond(res,409,{error:'Položka se změnila. Obnov přehled.'});
      const verified=await verifyReviewItem(item,{id,snapshot},false);
      return respond(res,200,reviewSessions.get(id,snapshot,verified.requirements));
    }
    if(reviewSession&&req.method==='POST'){
      if(reviewMutationBlocked())return respond(res,409,{error:'Nejprve dokonči probíhající akci nebo obnovu.'});
      const request=await body(req);
      if(reviewMutationBlocked())return respond(res,409,{error:'Nejprve dokonči probíhající akci nebo obnovu.'});
      return respond(res,200,await reviewSessions.write(reviewSession[1],request));
    }
    if(url.pathname==='/api/approve-batch'&&req.method==='POST'){
      if(active||batchRunning||resumeTask||previewBusy||settingsBusy||reviewSessions.busy)return respond(res,409,{error:'Jiná akce nebo dávka právě probíhá.'});
      if(recovery.length||state.pauses.length)return respond(res,409,{error:'Nejprve je nutné dokončit obnovu výměny nebo nodů.'});
      const b=await body(req);
      if(!Array.isArray(b.items)||!b.items.length||b.items.length>100)return respond(res,400,{error:'Vyber 1 až 100 filmů.'});
      if(new Set(b.items.map(x=>x.id)).size!==b.items.length)return respond(res,400,{error:'Stejný film je v dávce vícekrát.'});
      const list=await scan(true),items=[];
      for(const chosen of b.items){const item=list.find(x=>x.id===chosen.id);if(!item||item.status!=='ready'||item.snapshot!==chosen.snapshot)return respond(res,409,{error:'Některý vybraný film se změnil nebo ho nelze schválit. Obnov přehled.'});reviewSessions.approval(item.id,item.snapshot,chosen.reviewRevision);items.push({...item,reviewRevision:chosen.reviewRevision})}
      if(active||batchRunning||resumeTask||previewBusy||settingsBusy||reviewSessions.busy)return respond(res,409,{error:'Jiná akce nebo dávka právě probíhá.'});
      void performBatch(items);
      return respond(res,202,{ok:true,count:items.length});
    }
    const recheck=/^\/api\/items\/([a-f0-9]{24})\/recheck$/.exec(url.pathname);
    if(recheck&&req.method==='POST'){
      if(active||batchRunning||resumeTask||previewBusy||settingsBusy||reviewSessions.busy||scanPromise||recovery.length||state.pauses.length)return respond(res,409,{error:'Nejprve dokonči probíhající akci.'});
      const b=await body(req),list=await scan(true),item=list.find(x=>x.id===recheck[1]);
      if(!item?.canRecheck||item.snapshot!==b.snapshot)return respond(res,409,{error:'Tuto změnu nelze bezpečně znovu ověřit. Obnov přehled.'});
      if(active||batchRunning||resumeTask||previewBusy||settingsBusy||reviewSessions.busy||scanPromise)return respond(res,409,{error:'Jiná akce právě probíhá.'});
      const refreshed=(await scan(true,item.id)).find(x=>x.id===item.id);
      return respond(res,200,{ok:true,item:refreshed});
    }
    const action=/^\/api\/items\/([a-f0-9]{24})\/(approve|reject)$/.exec(url.pathname);
    if(action&&req.method==='POST'){
      if(active||batchRunning||resumeTask||previewBusy||settingsBusy||reviewSessions.busy)return respond(res,409,{error:'Jiná akce nebo dávka právě probíhá. Počkej na dokončení.'});
      if(recovery.length||state.pauses.length)return respond(res,409,{error:'Před další akcí je nutné dokončit obnovu výměny nebo nodů.'});
      const b=await body(req);
      let reason;if(action[2]==='reject'){try{reason=rejectionReason(b.reason)}catch(e){return respond(res,400,{error:e.message})}}
      const list=await scan(true),item=list.find(x=>x.id===action[1]);
      if(!item||!item.snapshot||item.snapshot!==b.snapshot)return respond(res,409,{error:'Položka se změnila. Obnov přehled.'});
      const acceptDuration=action[2]==='approve'&&b.acceptDuration===true&&item.canApproveDuration===true;
      if(action[2]==='approve'&&item.status!=='ready'&&!acceptDuration)return respond(res,409,{error:item.reason});
      if(!state.items[item.id])return respond(res,409,{error:'Soubor nelze bezpečně přiřadit k originálu.'});
      if(action[2]==='approve')reviewSessions.approval(item.id,item.snapshot,b.reviewRevision);
      // Claim before yielding so two simultaneous clicks cannot start two transactions.
      if(active||batchRunning||resumeTask||previewBusy||settingsBusy||reviewSessions.busy)return respond(res,409,{error:'Jiná akce nebo dávka právě probíhá.'});
      void perform(action[2],{...item,reviewRevision:b.reviewRevision},acceptDuration,reason);
      return respond(res,202,{ok:true});
    }
    const audio=/^\/api\/items\/([a-f0-9]{24})\/audio-compare$/.exec(url.pathname);
    if(audio&&req.method==='POST'){
      const request=await body(req),item=state.items[audio[1]];
      if(!item||item.snapshot!==request.snapshot)return respond(res,409,{error:'Obnov přehled, soubory se změnily.'});
      if(active||batchRunning||previewBusy||settingsBusy||reviewSessions.busy||scanPromise)return respond(res,409,{error:'Právě probíhá jiná akce. Zkus to za chvíli.'});
      previewBusy=true;
      try{
        const a=await safeFile(MEDIA,item.relative),b=await safeFile(REVIEW,item.reviewRelative);
        if(hash(a.fp+'|'+b.fp)!==item.snapshot)throw Error('Soubory se změnily. Obnov přehled.');
        const read=async f=>JSON.parse(await command(FFPROBE,['-v','error','-show_streams','-show_format','-of','json',f],{timeout:30000}));
        const pa=await read(a.path),pb=await read(b.path);
        const tracks=p=>p.streams.filter(s=>s.codec_type==='audio').map(s=>({index:s.index,label:`${s.index}: ${s.tags?.language||'und'} · ${s.codec_name} · ${s.channels} kan. · ${s.tags?.title||''}`}));
        if(request.mode==='tracks')return respond(res,200,{original:tracks(pa),review:tracks(pb)});
        const seconds=Number(request.seconds),duration=Math.min(Number(pa.format.duration),Number(pb.format.duration));
        if(!Number.isFinite(seconds)||seconds<0||seconds+12>duration)return respond(res,400,{error:'Vyber úsek alespoň 12 sekund před koncem filmu.'});
        if(!tracks(pa).some(s=>s.index===request.originalIndex)||!tracks(pb).some(s=>s.index===request.reviewIndex))return respond(res,400,{error:'Vyber platné zvukové stopy.'});
        if(request.mode==='av'){
          const va=pa.streams.find(s=>s.codec_type==='video'&&!s.disposition?.attached_pic),vb=pb.streams.find(s=>s.codec_type==='video'&&!s.disposition?.attached_pic);
          if(!va||!vb||va.color_transfer!==vb.color_transfer)throw Error('Obrazové profily náhledu se neshodují.');
          const original=await extractPreview(config.ffmpeg,a.path,request.originalIndex,seconds,Number(pa.format.start_time||0),va);
          const review=await extractPreview(config.ffmpeg,b.path,request.reviewIndex,seconds,Number(pb.format.start_time||0),vb);
          const originalWave=await extractAudio(config.ffmpeg,a.path,request.originalIndex,seconds,Number(pa.format.start_time||0));
          const reviewWave=await extractAudio(config.ffmpeg,b.path,request.reviewIndex,seconds,Number(pb.format.start_time||0));
          if((await safeFile(MEDIA,item.relative)).fp!==a.fp||(await safeFile(REVIEW,item.reviewRelative)).fp!==b.fp)throw Error('Soubory se během přípravy změnily.');
          const rates=[va,vb].map(v=>{const [n,d]=String(v.avg_frame_rate||'0/1').split('/').map(Number);return n/d});
          return respond(res,200,{seconds,duration:12,original,review,originalWave,reviewWave,alignment:alignment(originalWave,reviewWave),frameRates:rates.map(x=>Number.isFinite(x)&&x>0?x:null),hdr:va.color_transfer==='smpte2084'});
        }
        if(request.mode==='listen'){
          const original=await extractListeningAudio(config.ffmpeg,a.path,request.originalIndex,seconds,Number(pa.format.start_time||0));
          const review=await extractListeningAudio(config.ffmpeg,b.path,request.reviewIndex,seconds,Number(pb.format.start_time||0));
          if((await safeFile(MEDIA,item.relative)).fp!==a.fp||(await safeFile(REVIEW,item.reviewRelative)).fp!==b.fp)throw Error('Soubory se během přípravy změnily.');
          return respond(res,200,{seconds,original,review,originalTrack:tracks(pa).find(s=>s.index===request.originalIndex),reviewTrack:tracks(pb).find(s=>s.index===request.reviewIndex),processing:'48 kHz PCM; FFmpeg mono downmix; časová osa kontejneru; žádná normalizace hlasitosti ani automatické dorovnání posunu.'});
        }
        const original=await extractAudio(config.ffmpeg,a.path,request.originalIndex,seconds,Number(pa.format.start_time||0));
        const review=await extractAudio(config.ffmpeg,b.path,request.reviewIndex,seconds,Number(pb.format.start_time||0));
        if((await safeFile(MEDIA,item.relative)).fp!==a.fp||(await safeFile(REVIEW,item.reviewRelative)).fp!==b.fp)throw Error('Soubory se během přípravy změnily.');
        const result=alignment(original,review);
        const sample={seconds,originalIndex:request.originalIndex,reviewIndex:request.reviewIndex,alignment:result,at:new Date().toISOString()};
        item.audioSamples=[...(item.audioSamples||[]).filter(s=>!(s.seconds===seconds&&s.originalIndex===sample.originalIndex&&s.reviewIndex===sample.reviewIndex)),sample].slice(-30);
        await save();cacheAt=0;
        return respond(res,200,{seconds,stepMs:10,original,review,alignment:result});
      }finally{previewBusy=false}
    }
    const frames=/^\/api\/items\/([a-f0-9]{24})\/frames$/.exec(url.pathname);
    if(frames&&req.method==='POST'){
      const request=await body(req),item=state.items[frames[1]];
      const seconds=Number(request.seconds);
      if(!item||item.snapshot!==request.snapshot)return respond(res,409,{error:'Obnov přehled, soubory se změnily.'});
      if(!Number.isFinite(seconds)||seconds<0||seconds>=Math.min(item.info.durationA,item.info.durationB))return respond(res,400,{error:'Čas je mimo délku filmu.'});
      if(active||batchRunning||previewBusy||settingsBusy||reviewSessions.busy)return respond(res,409,{error:'Právě probíhá jiná akce nebo příprava snímků. Zkus to za chvíli.'});
      previewBusy=true;
      try{
        const a=await safeFile(MEDIA,item.relative),b=await safeFile(REVIEW,item.reviewRelative);
        if(hash(a.fp+'|'+b.fp)!==item.snapshot)throw Error('Soubory se změnily. Obnov přehled.');
        const pa=await probe(FFPROBE,a.path),pb=await probe(FFPROBE,b.path);
        const va=pa.streams.find(x=>x.codec_type==='video'&&!x.disposition?.attached_pic),vb=pb.streams.find(x=>x.codec_type==='video'&&!x.disposition?.attached_pic);
        const hdr=va.color_transfer==='smpte2084';
        if(hdr!==(vb.color_transfer==='smpte2084')||[va,vb].some(x=>x.color_transfer==='arib-std-b67'))throw Error('Tuto kombinaci HDR nelze porovnat.');
        const exe=config.ffmpeg;
        const original=await extractFrame(exe,a.path,seconds,hdr);
        const review=await extractFrame(exe,b.path,seconds,hdr);
        if((await safeFile(MEDIA,item.relative)).fp!==a.fp||(await safeFile(REVIEW,item.reviewRelative)).fp!==b.fp)throw Error('Soubory se během přípravy změnily.');
        return respond(res,200,{seconds,hdr,original:original.toString('base64'),review:review.toString('base64')});
      }finally{previewBusy=false;}
    }
    const video=/^\/api\/items\/([a-f0-9]{24})\/video$/.exec(url.pathname);
    if(video&&req.method==='GET'){
      const item=(await scan()).find(x=>x.id===video[1]);if(!item)return respond(res,404,{error:'Soubor nenalezen.'});
      const f=await safeFile(REVIEW,item.reviewRelative);
      res.writeHead(200,{'content-type':'video/x-matroska','content-length':f.stat.size,'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(path.basename(f.path)),'cache-control':'no-store','x-content-type-options':'nosniff'});
      const stream=createReadStream(f.path);res.on('close',()=>stream.destroy());stream.on('error',()=>res.destroy());stream.pipe(res);return;
    }
    const assets={'/review-workflow.js':['review-workflow.js','text/javascript; charset=utf-8'],'/av-player.js':['av-player.js','text/javascript; charset=utf-8'],'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/review-model.js':['review-model.js','text/javascript; charset=utf-8'],'/i18n.js':['i18n.js','text/javascript; charset=utf-8'],'/messages.en.js':['messages.en.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],'/favicon.svg':['favicon.svg','image/svg+xml']};
    if(req.method==='GET'&&assets[url.pathname]){
      const [file,mime]=assets[url.pathname];res.writeHead(200,{'content-type':mime,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'referrer-policy':'no-referrer'});res.end(await fs.readFile(path.join(ROOT,'public',file)));return;
    }
    respond(res,404,{error:'Nenalezeno.'});
  }catch(e){console.error(e.message);if(!res.headersSent)respond(res,e instanceof ReviewSessionError?e.status:500,{error:e.message});else res.destroy()}
});
server.listen(PORT,'0.0.0.0',()=>console.log('Tdarr Review listening on '+PORT));
