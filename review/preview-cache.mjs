import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const MODES=new Set(['frames','av','wave','listen']);
const ARTIFACT=/^[a-f0-9]{64}\.json$/;
const TEMP=/^[a-f0-9]{64}\.[a-f0-9]{32}\.tmp$/;
const DEFAULT_LIMITS={maxBytes:2*1024**3,maxEntries:200,ttlMs:7*86400000,maxEntryBytes:128*1024**2};
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const canonical=file=>process.platform==='win32'?path.resolve(file).toLowerCase():path.resolve(file);
const identity=stat=>`${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};

export class PreviewCacheError extends Error {
 constructor(message,code='CACHE_ERROR'){super(message);this.name='PreviewCacheError';this.code=code}
}
const fail=(message,code)=>{throw new PreviewCacheError(message,code)};
function normalizeLimits(next){
 const value={...DEFAULT_LIMITS,...next};
 for(const [key,max] of [['maxBytes',20*1024**3],['maxEntries',10000],['ttlMs',365*86400000],['maxEntryBytes',128*1024**2]])if(!Number.isSafeInteger(value[key])||value[key]<1||value[key]>max)fail('Neplatné limity cache ukázek.','INVALID_LIMITS');
 return value;
}
function normalizeRequest(input,rendererVersion){
 if(!object(input)||!/^[a-f0-9]{24}$/.test(input.itemId||'')||!/^[a-f0-9]{64}$/.test(input.snapshot||'')||!MODES.has(input.mode))fail('Neplatný požadavek ukázky.','INVALID_REQUEST');
 if(input.library!==undefined&&input.library!==null&&input.library!=='tv')fail('Neplatný kontext ukázky.','INVALID_REQUEST');
 const value={itemId:input.itemId,snapshot:input.snapshot,mode:input.mode,originalIndex:input.originalIndex??null,reviewIndex:input.reviewIndex??null,seconds:input.seconds,profile:input.profile??null,rendererVersion:input.rendererVersion??rendererVersion,library:input.library==='tv'?'tv':null};
 if(!['compact','detail',null].includes(value.profile)||typeof value.rendererVersion!=='string'||!value.rendererVersion.trim()||value.rendererVersion.length>128)fail('Neplatný profil nebo verze ukázky.','INVALID_REQUEST');
 if(typeof value.seconds!=='number'||!Number.isFinite(value.seconds)||value.seconds<0||value.seconds>604800)fail('Neplatný čas ukázky.','INVALID_REQUEST');
 for(const name of ['originalIndex','reviewIndex'])if(value[name]!==null&&(!Number.isInteger(value[name])||value[name]<0||value[name]>65535))fail('Neplatná zvuková stopa ukázky.','INVALID_REQUEST');
 if(value.mode==='frames'){value.originalIndex=null;value.reviewIndex=null}
 else if(value.originalIndex===null||value.reviewIndex===null)fail('Vyber obě zvukové stopy ukázky.','INVALID_REQUEST');
 return value;
}
function keyFor(request){return digest(JSON.stringify([request.library==='tv'?2:1,...(request.library==='tv'?['tv']:[]),request.itemId,request.snapshot,request.mode,request.originalIndex,request.reviewIndex,request.seconds,request.profile,request.rendererVersion]))}
export function previewCacheKey(request,rendererVersion){return keyFor(normalizeRequest(request,rendererVersion))}

// A single owner controls this directory. Only hash.json and hash.nonce.tmp
// artifacts are ever opened or removed; links and foreign filenames are untouched.
export async function createPreviewCache({directory,render,verify,rendererVersion,limits:initialLimits,now=Date.now,allowBackground=()=>true,backgroundDelayMs=100,onError=()=>{}}={}){
 if(typeof directory!=='string'||!path.isAbsolute(directory)||typeof render!=='function'||typeof verify!=='function'||typeof now!=='function'||typeof allowBackground!=='function')fail('Neplatné nastavení cache ukázek.','INVALID_CONFIG');
 if(typeof rendererVersion!=='string'||!rendererVersion.trim()||rendererVersion.length>128)fail('Vyžadována verze rendereru ukázek.','INVALID_CONFIG');
 if(!Number.isInteger(backgroundDelayMs)||backgroundDelayMs<0||backgroundDelayMs>60000)fail('Neplatné plánování cache ukázek.','INVALID_CONFIG');
 const root=path.resolve(directory),entries=new Map(),jobs=new Map(),reads=new Set(),errors=new Map(),queue=[];
 let limits=normalizeLimits(initialLimits),io=Promise.resolve(),active=null,selecting=false,selectionDone=null,timer=null,maintenance=null,paused=false,closed=false,rootIdentity,backgroundBudgetBlocked=false,blockedBudget=null;
 const counters={hits:0,misses:0,renders:0,errors:0,uncached:0};
 const report=error=>{try{onError(error)}catch{}};
 const clock=()=>{const value=now();if(typeof value!=='number'||!Number.isFinite(value)||value<0)fail('Neplatný čas cache ukázek.','INVALID_CLOCK');return value};
 const serial=operation=>{const result=io.catch(()=>{}).then(operation);io=result.catch(()=>{});return result};
 const cancelled=()=>new PreviewCacheError('Příprava ukázky byla zrušená.','CANCELLED');
 const expired=entry=>clock()-entry.created>=limits.ttlMs;
 const fileFor=key=>path.join(root,key+'.json');
 const errorStatus=(key,error,request)=>{errors.delete(key);errors.set(key,{code:error.code||'RENDER_ERROR',request});while(errors.size>Math.max(200,limits.maxEntries))errors.delete(errors.keys().next().value)};
 const usedBytes=()=>[...entries.values()].reduce((sum,entry)=>sum+entry.bytes,0);
 function refreshBudget(){
  if(backgroundBudgetBlocked&&(entries.size<blockedBudget.entries||usedBytes()<blockedBudget.bytes||limits.maxEntries>blockedBudget.maxEntries||limits.maxBytes>blockedBudget.maxBytes)){
   backgroundBudgetBlocked=false;blockedBudget=null;schedule(backgroundDelayMs);
  }
 }

 async function assertRoot(){
  const stat=await fs.lstat(root);
  if(!stat.isDirectory()||stat.isSymbolicLink()||`${stat.dev}:${stat.ino}`!==rootIdentity||canonical(await fs.realpath(root))!==canonical(root))fail('Cache ukázek není bezpečná složka.','UNSAFE_CACHE');
 }
 async function artifact(name,{optional=false}={}){
  if(!ARTIFACT.test(name)&&!TEMP.test(name))fail('Neplatný soubor cache.','UNSAFE_CACHE');
  await assertRoot();
  let stat;try{stat=await fs.lstat(path.join(root,name))}catch(error){if(optional&&error.code==='ENOENT')return null;throw error}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)fail('Cache ukázek obsahuje nebezpečný soubor.','UNSAFE_CACHE');
  return stat;
 }
 async function remove(name,expected){
  const stat=await artifact(name,{optional:true});
  if(!stat||expected&&identity(stat)!==expected)return false;
  await fs.unlink(path.join(root,name));return true;
 }
 async function readEnvelope(key){
  const name=key+'.json',stat=await artifact(name,{optional:true});if(!stat)return null;
  if(stat.size>limits.maxEntryBytes)return {oversize:true,stat};
  const handle=await fs.open(fileFor(key),constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  let encoded;
   try{
    const opened=await handle.stat();if(!opened.isFile()||opened.nlink!==1||identity(opened)!==identity(stat))fail('Soubor cache se během čtení změnil.','UNSAFE_CACHE');
    const chunks=[];let total=0;
    for await(const chunk of handle.createReadStream({autoClose:false,highWaterMark:65536})){total+=chunk.length;if(total>limits.maxEntryBytes)fail('Soubor cache překročil limit během čtení.','UNSAFE_CACHE');chunks.push(chunk)}
    if(identity(await handle.stat())!==identity(stat))fail('Soubor cache se během čtení změnil.','UNSAFE_CACHE');encoded=Buffer.concat(chunks).toString('utf8');
   }finally{await handle.close()}
  let value;
  try{
   value=JSON.parse(encoded);
   const request=normalizeRequest(value.request,rendererVersion),payload=JSON.stringify(value.payload);
   if(value.version!==1||value.key!==key||keyFor(request)!==key||typeof value.created!=='number'||!Number.isFinite(value.created)||value.created<0||value.created>clock()+300000||payload===undefined||digest(payload)!==value.payloadHash)throw Error('invalid envelope');
   return {value:{...value,request},stat};
  }catch{return {corrupt:true,stat}}
 }
 async function pruneOwned({evict=true}={}){
  await assertRoot();
  for(const [key,entry] of entries)if(expired(entry)||entry.bytes>limits.maxEntryBytes){await remove(key+'.json',entry.identity);entries.delete(key)}
  let bytes=[...entries.values()].reduce((sum,entry)=>sum+entry.bytes,0);
  if(!evict){refreshBudget();return}
  const oldest=[...entries.values()].sort((a,b)=>a.lastUsed-b.lastUsed||a.created-b.created||a.key.localeCompare(b.key));
  for(const entry of oldest){if(entries.size<=limits.maxEntries&&bytes<=limits.maxBytes)break;await remove(entry.key+'.json',entry.identity);entries.delete(entry.key);bytes-=entry.bytes}
  refreshBudget();
 }
 async function initialize(){
  const ancestors=[];let parent=root;
  while(true){ancestors.push(parent);const next=path.dirname(parent);if(next===parent)break;parent=next}
  for(const dir of ancestors.reverse()){
   let stat;try{stat=await fs.lstat(dir)}catch(error){if(error.code!=='ENOENT')throw error;await fs.mkdir(dir,{mode:0o700});stat=await fs.lstat(dir)}
   if(!stat.isDirectory()||stat.isSymbolicLink())fail('Složka cache nesmí vést přes symbolické odkazy.','UNSAFE_CACHE');
  }
  const stat=await fs.lstat(root);rootIdentity=`${stat.dev}:${stat.ino}`;
  await assertRoot();await fs.chmod(root,0o700);
  for(const item of await fs.readdir(root,{withFileTypes:true})){
   if(TEMP.test(item.name)){await remove(item.name);continue}
   if(!ARTIFACT.test(item.name))continue;
   const key=item.name.slice(0,64),loaded=await readEnvelope(key);
   if(!loaded)continue;
   if(loaded.corrupt||loaded.oversize){await remove(item.name,identity(loaded.stat));continue}
   const {value,stat:fileStat}=loaded;
   if(value.request.rendererVersion!==rendererVersion){await remove(item.name,identity(fileStat));continue}
   entries.set(key,{key,request:value.request,created:value.created,lastUsed:value.created,bytes:fileStat.size,identity:identity(fileStat)});
  }
  await pruneOwned();
 }
 await serial(initialize);

 async function verified(request){if(await verify(structuredClone(request))===false)fail('Soubory ukázky se změnily.','STALE')}
 const alive=job=>!closed&&!job.cancelled&&!job.interrupted&&!job.controller.signal.aborted;
 async function persist(job,payload){
  return serial(async()=>{
   if(!alive(job))throw cancelled();
   await assertRoot();
   const payloadJSON=JSON.stringify(payload);
   if(payloadJSON===undefined)fail('Renderer nevrátil platná data ukázky.','INVALID_RESULT');
   const created=clock(),value={version:1,key:job.key,request:job.request,created,payloadHash:digest(payloadJSON),payload};
   const encoded=JSON.stringify(value),bytes=Buffer.byteLength(encoded);
   if(bytes>limits.maxEntryBytes||bytes>limits.maxBytes){counters.uncached++;errorStatus(job.key,new PreviewCacheError('Ukázka je větší než limit cache.','TOO_LARGE'),job.request);return false}
   if(job.priority==='background'){
    await pruneOwned({evict:false});
    const prior=entries.get(job.key),used=[...entries.values()].reduce((sum,entry)=>sum+entry.bytes,0);
    if(entries.size+(prior?0:1)>limits.maxEntries||used-(prior?.bytes||0)+bytes>limits.maxBytes){backgroundBudgetBlocked=true;blockedBudget={entries:entries.size,bytes:used,maxEntries:limits.maxEntries,maxBytes:limits.maxBytes};counters.uncached++;errorStatus(job.key,new PreviewCacheError('Rozpočet cache je vyčerpaný; hotové ukázky zůstávají uložené.','BUDGET_LIMIT'),job.request);return false}
   }
   const name=job.key+'.'+crypto.randomBytes(16).toString('hex')+'.tmp',temporary=path.join(root,name);
   let createdTemp=false;
   try{
    const handle=await fs.open(temporary,'wx',0o600);createdTemp=true;
    try{await handle.writeFile(encoded);await handle.sync();const stat=await handle.stat();if(!stat.isFile()||stat.nlink!==1)fail('Dočasný soubor cache není bezpečný.','UNSAFE_CACHE')}finally{await handle.close()}
    if(!alive(job))throw cancelled();
    await artifact(job.key+'.json',{optional:true});
    if(!alive(job))throw cancelled();
    await fs.rename(temporary,fileFor(job.key));createdTemp=false;
    const stat=await artifact(job.key+'.json');
    if(!alive(job)){await remove(job.key+'.json',identity(stat));throw cancelled()}
    entries.set(job.key,{key:job.key,request:job.request,created,lastUsed:created,bytes:stat.size,identity:identity(stat)});errors.delete(job.key);
    if(process.platform!=='win32'){const dir=await fs.open(root,'r');try{await dir.sync()}finally{await dir.close()}}
    await pruneOwned();return entries.has(job.key);
   }finally{if(createdTemp)await remove(name).catch(report)}
  });
 }
 async function peek(input){
  if(closed)fail('Cache ukázek je zavřená.','CLOSED');
  const request=normalizeRequest(input,rendererVersion),key=keyFor(request),entry=entries.get(key);
  if(!entry||expired(entry))return null;
  const token={request,key,invalid:false};reads.add(token);
  try{
   await verified(request);if(token.invalid||closed)throw cancelled();
   const loaded=await serial(async()=>{
    const current=entries.get(key);if(!current||expired(current))return null;
    const result=await readEnvelope(key);
    if(!result||result.corrupt||result.oversize){if(result)await remove(key+'.json',identity(result.stat));entries.delete(key);return null}
    if(identity(result.stat)!==current.identity){entries.delete(key);return null}
    return result.value.payload;
   });
   if(loaded===null)return null;
   await verified(request);if(token.invalid||closed)throw cancelled();
   const current=entries.get(key);if(!current||expired(current))return null;
   current.lastUsed=clock();counters.hits++;return structuredClone(loaded);
  }finally{reads.delete(token)}
 }

 function rejectJob(job,error){
  job.cancelled=true;job.controller.abort(error);if(jobs.get(job.key)===job)jobs.delete(job.key);job.result.reject(error);
 }
 function interruptBackground({requeue=false}={}){
  if(!active||active.priority!=='background')return null;
  const job=active;
  if(requeue&&!job.cancelled){job.interrupted=true;job.controller.abort(cancelled())}
  else rejectJob(job,cancelled());
  return job.done.promise;
 }
 function schedule(delay=0){
  if(closed||active||selecting||!queue.length)return;
  const interactive=queue.some(job=>!job.cancelled&&job.priority==='interactive');
  if(timer!==null){if(!interactive)return;clearTimeout(timer);timer=null}
  timer=setTimeout(()=>{timer=null;void pump().catch(report)},interactive?0:delay);
  if(!interactive&&paused)timer.unref?.();
 }
 async function pump(){
  if(closed||active||selecting)return;
  selecting=true;selectionDone=deferred();
  let job;
  try{
   let index=queue.findIndex(value=>!value.cancelled&&value.priority==='interactive');
   if(index<0){
    if(backgroundBudgetBlocked)return;
    if(paused){scheduleRetry();return}
    let allowed=false;try{allowed=await allowBackground()}catch(error){report(error)}
    index=queue.findIndex(value=>!value.cancelled&&value.priority==='interactive');
    if(index<0){if(!allowed||paused||closed){scheduleRetry();return}index=queue.findIndex(value=>!value.cancelled)}
   }
   if(index<0)return;
   job=queue.splice(index,1)[0];active=job;job.state='running';job.done=deferred();
  }finally{selecting=false;selectionDone.resolve()}
  if(!job)return;
  try{
   if(!alive(job))throw cancelled();
   await verified(job.request);if(!alive(job))throw cancelled();
   counters.renders++;
   const payload=await render(structuredClone(job.request),{signal:job.controller.signal,priority:job.priority});
   if(!alive(job))throw cancelled();
   await verified(job.request);if(!alive(job))throw cancelled();
   try{await persist(job,payload)}catch(error){
    if(!['ENOSPC','EDQUOT','EIO'].includes(error.code)||!alive(job))throw error;
    // Storage failures do not invalidate a freshly verified preview. Remove an
    // uncertain committed artifact before returning the in-memory result.
    await verified(job.request);if(!alive(job))throw cancelled();
    await serial(async()=>{const entry=entries.get(job.key);entries.delete(job.key);try{await remove(job.key+'.json',entry?.identity)}catch(cleanupError){if(cleanupError.code==='UNSAFE_CACHE')throw cleanupError;report(cleanupError)}});
    counters.uncached++;counters.errors++;errorStatus(job.key,error,job.request);report(error);
   }
   if(!alive(job))throw cancelled();
   if(jobs.get(job.key)===job)jobs.delete(job.key);job.result.resolve(structuredClone(payload));
  }catch(error){
   if(job.interrupted&&!job.cancelled&&!closed){job.interrupted=false;job.controller=new AbortController();job.state='queued';queue.push(job)}
   else if(!job.cancelled){jobs.delete(job.key);counters.errors++;errorStatus(job.key,error,job.request);job.result.reject(error);report(error)}
  }finally{active=null;job.done.resolve();schedule(backgroundDelayMs)}
 }
 function scheduleRetry(){
  if(closed||timer!==null||!queue.some(job=>!job.cancelled))return;
  timer=setTimeout(()=>{timer=null;void pump().catch(report)},Math.max(backgroundDelayMs,100));timer.unref?.();
 }
 function promote(job,priority){
  if(priority==='interactive'&&job.priority==='background'){
   job.priority='interactive';
   if(active&&active!==job&&active.priority==='background')interruptBackground({requeue:true});
   schedule();
  }
  return job.result.promise.then(structuredClone);
 }
 async function request(input,{priority='interactive'}={}){
  if(closed)fail('Cache ukázek je zavřená.','CLOSED');
  if(!['interactive','background'].includes(priority))fail('Neplatná priorita ukázky.','INVALID_REQUEST');
  const value=normalizeRequest(input,rendererVersion),key=keyFor(value);
  const prior=jobs.get(key);if(prior)return promote(prior,priority);
  const hit=await peek(value);if(hit!==null)return hit;
  if(closed)fail('Cache ukázek je zavřená.','CLOSED');
  const simultaneous=jobs.get(key);if(simultaneous)return promote(simultaneous,priority);
  counters.misses++;errors.delete(key);
  const job={key,request:value,priority,state:'queued',cancelled:false,interrupted:false,controller:new AbortController(),result:deferred(),done:null};
  // A cancelled warm-up may have no consumer yet; preserve rejection for callers
  // while preventing an orphaned internal promise from becoming unhandled.
  job.result.promise.catch(()=>{});jobs.set(key,job);queue.push(job);
  if(priority==='interactive'&&active?.priority==='background')interruptBackground({requeue:true});
  schedule(priority==='interactive'?0:backgroundDelayMs);
  return job.result.promise.then(structuredClone);
 }
 function matcher(selector){
  if(!object(selector)||selector.all!==true&&!selector.itemId&&!selector.snapshot)fail('Vyber položku cache ke zneplatnění.','INVALID_REQUEST');
  if(selector.itemId!==undefined&&!/^[a-f0-9]{24}$/.test(selector.itemId)||selector.snapshot!==undefined&&!/^[a-f0-9]{64}$/.test(selector.snapshot))fail('Neplatná identita cache.','INVALID_REQUEST');
  return request=>selector.all===true||(!selector.itemId||request.itemId===selector.itemId)&&(!selector.snapshot||request.snapshot===selector.snapshot);
 }
 function invalidate(selector){
  const matches=matcher(selector);
  // Revoke authority before the first await, including reads already in progress.
  for(const token of reads)if(matches(token.request))token.invalid=true;
  for(const job of jobs.values())if(matches(job.request))rejectJob(job,cancelled());
  for(const [key,value] of errors)if(selector.all===true||value.request&&matches(value.request))errors.delete(key);
  for(let index=queue.length-1;index>=0;index--)if(queue[index].cancelled)queue.splice(index,1);
  return serial(async()=>{let removed=0;for(const [key,entry] of entries)if(matches(entry.request)){await remove(key+'.json',entry.identity);entries.delete(key);errors.delete(key);removed++}refreshBudget();return {removed}});
 }
 function status(input){
  const request=normalizeRequest(input,rendererVersion),key=keyFor(request),job=jobs.get(key);
  if(job)return job.state;
  const entry=entries.get(key);if(entry&&!expired(entry))return 'ready';
  return errors.has(key)?'error':'missing';
 }
 function entryInfo(input){
  const request=normalizeRequest(input,rendererVersion),entry=entries.get(keyFor(request));
  return entry&&!expired(entry)?{created:entry.created,bytes:entry.bytes}:null;
 }
 function stats(){
  const pending=queue.filter(job=>!job.cancelled);
  return {busy:!!active,priority:active?.priority||null,queue:pending.length,queuedInteractive:pending.filter(job=>job.priority==='interactive').length,queuedBackground:pending.filter(job=>job.priority==='background').length,entries:entries.size,bytes:usedBytes(),paused,closed,backgroundBudgetBlocked,limits:{...limits},...counters};
 }
 function maintain(){
  if(maintenance!==null)clearTimeout(maintenance);
  if(closed)return;
  maintenance=setTimeout(()=>{maintenance=null;void serial(pruneOwned).catch(report).finally(maintain)},Math.min(60000,Math.max(1000,limits.ttlMs)));maintenance.unref?.();
 }
 maintain();
 return {
  request,peek,status,stats,entryInfo,invalidate,
  prune:()=>serial(pruneOwned),
  updateLimits(next){const candidate=normalizeLimits({...limits,...next});return serial(async()=>{limits=candidate;await pruneOwned();maintain();return stats()})},
  async cancelActiveBackground({wait=false,requeue=false}={}){const done=interruptBackground({requeue});if(wait&&done)await done},
  async cancelBackground({itemId,all=itemId===undefined,wait=false}={}){
   const matches=matcher({itemId,all}),done=active?.priority==='background'&&matches(active.request)?active.done.promise:null;
   for(const job of jobs.values())if(job.priority==='background'&&matches(job.request))rejectJob(job,cancelled());
   for(let index=queue.length-1;index>=0;index--)if(queue[index].cancelled)queue.splice(index,1);
   if(wait&&done)await done;
  },
  async pauseBackground({wait=false}={}){paused=true;const done=interruptBackground({requeue:true});if(wait){if(selectionDone&&selecting)await selectionDone.promise;if(done)await done}},
  resumeBackground(){paused=false;schedule(backgroundDelayMs)},
  async close(){if(closed)return;closed=true;paused=true;if(timer!==null){clearTimeout(timer);timer=null}if(maintenance!==null){clearTimeout(maintenance);maintenance=null}for(const token of reads)token.invalid=true;for(const job of jobs.values())rejectJob(job,cancelled());queue.length=0;const done=active?.done?.promise;if(selectionDone&&selecting)await selectionDone.promise;if(done)await done;await io},
 };
}
