import fs from 'node:fs/promises';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import { openDirectoryNoFollow, observeRetainedIdentity } from './core.mjs';
import { compareIdentity, identityOf } from '../recovery/file-identity.mjs';

const INDEX='tv-install-index.jsonl';
const MAX_INDEX_BYTES=64*1024*1024;
const MAX_ROW_BYTES=8192;
const MAX_PAGE_BYTES=128*1024;
const MAX_PAGE_ROWS=50;
const JOURNAL=/^tv-[0-9a-f-]{36}\.json$/;
const safeText=(value,max=180)=>typeof value==='string'&&!/^(?:[\\/]|[a-z]:|[a-z][a-z0-9+.-]*:\/\/)/i.test(value)?value.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max):'';
const PHASES=new Set(['preparing','syncing-copy','verifying-copy','ready','original-backed-up','installed','original-removed','complete','aborted']);
const REFRESH=new Set(['completed','pending','failed','unknown','not_applicable']);
const dirPath=handle=>`/proc/self/fd/${handle.fd}`;
const cursorEncode=(value,key)=>{const payload=Buffer.from(JSON.stringify(value)).toString('base64url'),mac=crypto.createHmac('sha256',key).update(payload).digest('base64url');return payload+'.'+mac};
function cursorDecode(value,key){
 if(typeof value!=='string'||value.length>512)throw Object.assign(Error('invalid_cursor'),{status:400});
 try{const [payload,mac,...extra]=value.split('.');if(!payload||!mac||extra.length||crypto.timingSafeEqual(Buffer.from(mac,'base64url'),crypto.createHmac('sha256',key).update(payload).digest())===false)throw Error();const decoded=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));if(!decoded||decoded.version!==1||![decoded.offset,decoded.end].every(Number.isSafeInteger)||decoded.offset<0||decoded.end<0||decoded.offset>decoded.end||decoded.end>MAX_INDEX_BYTES||typeof decoded.dev!=='string'||typeof decoded.ino!=='string'||!/^\d+$/.test(decoded.dev)||!/^\d+$/.test(decoded.ino)||decoded.previousRef!==undefined&&!JOURNAL.test(decoded.previousRef))throw Error();return decoded}catch{throw Object.assign(Error('invalid_cursor'),{status:400})}
}
async function openIndex(file,flags){
 return fs.open(file,flags|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0),0o600);
}
function validRow(row){return row&&row.version===1&&typeof row.transaction==='string'&&JOURNAL.test(row.transaction)&&typeof row.created==='string';}
function auditContextIssues(context){
 const issues=[];if(!context||context.version!==1)return ['version'];
 if(!/^[a-f0-9]{24}$/.test(context.itemId||''))issues.push('itemId');if(!/^[a-f0-9]{64}$/.test(context.snapshot||''))issues.push('snapshot');if(!/^[a-f0-9]{64}$/.test(context.flowProofHash||''))issues.push('flowProofHash');if(!/^[a-f0-9]{64}$/.test(context.jobEvidenceHash||''))issues.push('jobEvidenceHash');
 if(!Number.isSafeInteger(context.seriesId)||context.seriesId<=0)issues.push('seriesId');if(typeof context.seriesTitle!=='string'||context.seriesTitle.length>180)issues.push('seriesTitle');if(!['standard','anime','daily'].includes(context.seriesType))issues.push('seriesType');if(!Number.isSafeInteger(context.episodeFileId)||context.episodeFileId<=0)issues.push('episodeFileId');
 if(!Array.isArray(context.episodeIds)||context.episodeIds.length!==1||!Number.isSafeInteger(context.episodeIds[0])||context.episodeIds[0]<=0)issues.push('episodeIds');if(!Array.isArray(context.episodes)||context.episodes.length!==1||context.episodes[0]?.id!==context.episodeIds?.[0])issues.push('episodes');
 if(typeof context.jobId!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(context.jobId))issues.push('jobId');if(context.policy!=='individual')issues.push('policy');if(context.profile!=='tv-strict-review-v1')issues.push('profile');if(!Number.isSafeInteger(context.reviewRevision)||context.reviewRevision<0)issues.push('reviewRevision');if(!Number.isSafeInteger(context.settingsGeneration)||context.settingsGeneration<0)issues.push('settingsGeneration');if(!Number.isSafeInteger(context.sourceBytes)||context.sourceBytes<0)issues.push('sourceBytes');if(!Number.isSafeInteger(context.resultBytes)||context.resultBytes<0)issues.push('resultBytes');if(!Number.isFinite(Date.parse(context.approvedAt)))issues.push('approvedAt');return issues;
}
function validAuditContext(context){return auditContextIssues(context).length===0;}
async function readJournal(transactions,name){
 if(process.platform!=='linux'||!JOURNAL.test(name))return null;
 const file=path.join(dirPath(transactions),name);let handle;
 try{
  handle=await fs.open(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0)|(fs.constants.O_NONBLOCK||0));const stat=await handle.stat(),named=await fs.lstat(file);
  if(!stat.isFile()||stat.nlink!==1||named.isSymbolicLink()||stat.dev!==named.dev||stat.ino!==named.ino||stat.size>32*1024)return null;
  const data=Buffer.alloc(stat.size);let position=0;while(position<data.length){const result=await handle.read(data,position,data.length-position,position);if(!result.bytesRead)return null;position+=result.bytesRead;}
  const after=await handle.stat(),namedAfter=await fs.lstat(file);if(identityOf(after)!==identityOf(stat)||namedAfter.isSymbolicLink()||namedAfter.nlink!==1||namedAfter.dev!==stat.dev||namedAfter.ino!==stat.ino)return null;
  const value=JSON.parse(data.toString('utf8'));
  if(typeof value.id!=='string'||!/^[0-9a-f-]{36}$/.test(value.id)||value.tvAudit?.version!==1||value.tvAudit?.transaction!==name)return null;
  return value;
 }catch{return null}finally{await handle?.close().catch(()=>{})}
}
async function writeJournal(transactions,name,record){
 const target=path.join(dirPath(transactions),name),temp=path.join(dirPath(transactions),name+'.'+crypto.randomUUID()+'.new'),data=Buffer.from(JSON.stringify(record,null,2));if(data.length>32*1024)throw Error('Limit bezpečného protokolu instalace TV byl překročen.');
 const handle=await fs.open(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),0o600);
 try{await handle.writeFile(data);await handle.sync()}finally{await handle.close()}
 await fs.rename(temp,target);await transactions.sync();
}
async function validateIndexTail(handle,size){
 if(size===0)return;
 const start=Math.max(0,size-MAX_ROW_BYTES),buffer=Buffer.alloc(size-start);const {bytesRead}=await handle.read(buffer,0,buffer.length,start);
 if(bytesRead!==buffer.length||buffer.at(-1)!==10)throw Error('Index instalací TV je zkrácený.');
 const previous=buffer.lastIndexOf(10,buffer.length-2),line=buffer.subarray(previous+1,buffer.length-1).toString('utf8');
 if(Buffer.byteLength(line)+1>MAX_ROW_BYTES)throw Error('Řádek indexu instalací TV překračuje limit.');
 let row;try{row=JSON.parse(line)}catch{throw Error('Index instalací TV je poškozený.')}if(!validRow(row))throw Error('Index instalací TV je poškozený.')
}
async function projectJournal(transactions,name,quarantineRoot){
 const journal=await readJournal(transactions,name);if(!journal)return {transaction:name,verification:'unverified',reason:'journal_unavailable'};
 const audit=journal.tvAudit,context=audit.context;
 if(!validAuditContext(context))return {transaction:name,verification:'unverified',reason:'audit_context_incomplete'};
 const retained={atInstall:journal.retainedPhase==='verified'&&compareIdentity(journal.retainedFP,journal.retainedFP)!=='invalid'&&/^[a-f0-9]{64}$/.test(journal.retainedHash||'')?'verified':'unverified',current:'unknown'};
 if(retained.atInstall==='verified'){
  if(!quarantineRoot)retained.current='root_unavailable';
  else {
   try{
    const configured=await fs.realpath(quarantineRoot);
    if(configured!==journal.retainedRoot)retained.current='root_changed';
    else retained.current=await observeRetainedIdentity(configured,journal.retainedLeaf,journal.retainedFP);
   }catch(error){retained.current=error?.code==='ENOENT'?'missing_or_root_unavailable':'inaccessible'}
  }
 }
 const outcome=journal.tvInstallOutcome||{},phase=PHASES.has(journal.phase)?journal.phase:'unknown',policy=context.policy==='individual'?'individual':'unknown',seriesType=['standard','anime','daily'].includes(context.seriesType)?context.seriesType:'unknown';
 const installedVerified=['installed','original-removed','complete'].includes(phase)&&compareIdentity(journal.installedFP,journal.installedFP)!=='invalid'&&Number(journal.installedFP.split(':')[2])===context.resultBytes&&/^[a-f0-9]{64}$/.test(journal.installedHash||'');
 return {
  transaction:name,verification:'recorded',series:{id:context.seriesId,title:safeText(context.seriesTitle),type:seriesType},
  episodes:context.episodes.filter(value=>value&&Number.isSafeInteger(value.id)).map(value=>({id:value.id,seasonNumber:Number.isSafeInteger(value.seasonNumber)?value.seasonNumber:null,episodeNumber:Number.isSafeInteger(value.episodeNumber)?value.episodeNumber:null,absoluteEpisodeNumber:Number.isSafeInteger(value.absoluteEpisodeNumber)?value.absoluteEpisodeNumber:null,airDate:/^\d{4}-\d{2}-\d{2}$/.test(value.airDate||'')?value.airDate:null})),
  episodeFileId:context.episodeFileId,jobId:context.jobId,policy,reviewRevision:context.reviewRevision,
  approvedAt:Number.isFinite(Date.parse(context.approvedAt))?new Date(context.approvedAt).toISOString():null,installedAt:installedVerified&&Number.isFinite(Date.parse(journal.installedAt))?new Date(journal.installedAt).toISOString():null,created:Number.isFinite(Date.parse(journal.created))?new Date(journal.created).toISOString():null,phase,
  sourceBytes:Number.isSafeInteger(context.sourceBytes)?context.sourceBytes:null,resultBytes:Number.isSafeInteger(context.resultBytes)?context.resultBytes:null,
  installed:{identityVerified:installedVerified,hashVerified:installedVerified,bytes:installedVerified?context.resultBytes:null},
  retained:{...retained,bytes:retained.atInstall==='verified'&&Number.isSafeInteger(context.sourceBytes)?context.sourceBytes:null,identityVerified:retained.atInstall==='verified',hashVerified:retained.atInstall==='verified'},
  refresh:{tdarr:REFRESH.has(outcome.tdarr)?outcome.tdarr:'unknown',sonarr:REFRESH.has(outcome.sonarr)?outcome.sonarr:'unknown'}
 };
}

/** TV-only durable exact-reference index. Reads never create, repair or truncate files. */
export function createTvInstallLedger({data,getQuarantineRoot=()=>'',syncFile=handle=>handle.sync(),syncDirectory=handle=>handle.sync()}){
 const indexFile=path.join(data,INDEX),cursorKey=crypto.randomBytes(32);
 async function append({journal,record}){
  const transaction=path.basename(journal),invalid=[];
  if(!JOURNAL.test(transaction))invalid.push('transaction');if(typeof record?.id!=='string'||!/^[0-9a-f-]{36}$/.test(record.id))invalid.push('journal_id');if(record.tvAudit?.version!==1)invalid.push('audit_version');if(record.tvAudit?.transaction!==transaction)invalid.push('audit_transaction');if(!validAuditContext(record.tvAudit?.context))invalid.push('audit_context:'+auditContextIssues(record.tvAudit?.context).join(','));
  if(invalid.length)throw Error('Auditní odkaz instalace TV není platný.');
  const transactions=await openDirectoryNoFollow(path.join(data,'transactions'));
  try{const durable=await readJournal(transactions,transaction);if(!durable||durable.phase!=='preparing'||JSON.stringify(durable.tvAudit)!==JSON.stringify(record.tvAudit))throw Error('Přípravný protokol instalace TV nebyl trvale uložen.')}finally{await transactions.close()}
  const directory=await openDirectoryNoFollow(data),pinnedIndex=path.join(dirPath(directory),INDEX);let created=false,handle;
  try{
  handle=await openIndex(pinnedIndex,fs.constants.O_RDWR|fs.constants.O_APPEND|fs.constants.O_CREAT);
  try{
   const stat=await handle.stat(),named=await fs.lstat(pinnedIndex);
   if(!stat.isFile()||stat.nlink!==1||named.isSymbolicLink()||stat.dev!==named.dev||stat.ino!==named.ino||stat.size>MAX_INDEX_BYTES)throw Error('Index instalací TV není bezpečný nebo překračuje limit.');
   await validateIndexTail(handle,stat.size);
   created=stat.size===0;
   const row=Buffer.from(JSON.stringify({version:1,transaction,created:record.created})+'\n');
   if(row.length>MAX_ROW_BYTES||stat.size+row.length>MAX_INDEX_BYTES)throw Error('Index instalací TV dosáhl bezpečného limitu.');
   const written=await handle.write(row,0,row.length,null);
   if(written.bytesWritten!==row.length)throw Error('Zápis do indexu instalací TV nebyl úplný.');
   await syncFile(handle);
   const after=await handle.stat(),namedAfter=await fs.lstat(pinnedIndex);
   if(after.dev!==stat.dev||after.ino!==stat.ino||namedAfter.isSymbolicLink()||after.dev!==namedAfter.dev||after.ino!==namedAfter.ino||after.nlink!==1)throw Error('Index instalací TV se během zápisu změnil.');
  }finally{await handle.close()}
  if(created)await syncDirectory(directory);
  }finally{await directory.close()}
 }
 async function page({limit=20,cursor}={}){
  if(!Number.isSafeInteger(limit)||limit<1||limit>MAX_PAGE_ROWS)throw Object.assign(Error('invalid_limit'),{status:400});
  const directory=await openDirectoryNoFollow(data),pinnedIndex=path.join(dirPath(directory),INDEX);let handle;
  try{
  try{handle=await openIndex(pinnedIndex,fs.constants.O_RDONLY)}catch(error){if(error.code==='ENOENT')return {items:[],nextCursor:null,complete:true,knownRecords:0,limits:{pageRows:MAX_PAGE_ROWS,pageBytes:MAX_PAGE_BYTES,indexBytes:MAX_INDEX_BYTES}};throw error}
  try{
   const stat=await handle.stat(),named=await fs.lstat(pinnedIndex);
   if(!stat.isFile()||stat.nlink!==1||named.isSymbolicLink()||stat.dev!==named.dev||stat.ino!==named.ino||stat.size>MAX_INDEX_BYTES)return {items:[],nextCursor:null,complete:false,reason:'index_unsafe',knownRecords:null,limits:{pageRows:MAX_PAGE_ROWS,pageBytes:MAX_PAGE_BYTES,indexBytes:MAX_INDEX_BYTES}};
   const start=cursor?cursorDecode(cursor,cursorKey):{version:1,offset:stat.size,end:stat.size,dev:String(stat.dev),ino:String(stat.ino)};
   if(start.dev!==String(stat.dev)||start.ino!==String(stat.ino)||stat.size<start.end)return {items:[],nextCursor:null,complete:false,reason:'index_changed_or_truncated',knownRecords:null,limits:{pageRows:MAX_PAGE_ROWS,pageBytes:MAX_PAGE_BYTES,indexBytes:MAX_INDEX_BYTES}};
   if(start.end>stat.size||start.offset>start.end)return {items:[],nextCursor:null,complete:false,reason:'cursor_out_of_range',knownRecords:null,limits:{pageRows:MAX_PAGE_ROWS,pageBytes:MAX_PAGE_BYTES,indexBytes:MAX_INDEX_BYTES}};
   if(start.end>0){const capturedEnd=Buffer.alloc(1);await handle.read(capturedEnd,0,1,start.end-1);if(capturedEnd[0]!==10)return {items:[],nextCursor:null,complete:false,reason:'index_truncated',knownRecords:null,limits:{pageRows:MAX_PAGE_ROWS,pageBytes:MAX_PAGE_BYTES,indexBytes:MAX_INDEX_BYTES}}}
   if(start.offset===0)return {items:[],nextCursor:null,complete:true,reason:null,knownRecords:null,limits:{pageRows:MAX_PAGE_ROWS,pageBytes:MAX_PAGE_BYTES,indexBytes:MAX_INDEX_BYTES}};
   const endBoundary=Buffer.alloc(1);await handle.read(endBoundary,0,1,start.offset-1);if(endBoundary[0]!==10)return {items:[],nextCursor:null,complete:false,reason:'cursor_not_on_record_boundary',knownRecords:null,limits:{pageRows:MAX_PAGE_ROWS,pageBytes:MAX_PAGE_BYTES,indexBytes:MAX_INDEX_BYTES}};
   const budget=Math.min(MAX_PAGE_BYTES,start.offset),windowStart=start.offset-budget,buffer=Buffer.alloc(budget);const {bytesRead}=await handle.read(buffer,0,budget,windowStart);const dataBytes=buffer.subarray(0,bytesRead);
   const firstNewline=windowStart===0?-1:dataBytes.indexOf(10);if(windowStart>0&&firstNewline<0)return {items:[],nextCursor:null,complete:false,reason:'index_row_too_large',knownRecords:null,limits:{pageRows:MAX_PAGE_ROWS,pageBytes:MAX_PAGE_BYTES,indexBytes:MAX_INDEX_BYTES}};
   let startsAtBoundary=windowStart===0;if(windowStart>0){const prior=Buffer.alloc(1);await handle.read(prior,0,1,windowStart-1);startsAtBoundary=prior[0]===10;}
   const firstComplete=windowStart===0||startsAtBoundary?0:firstNewline+1,completeBytes=dataBytes.subarray(firstComplete);let lines=completeBytes.toString('utf8').split('\n');if(lines.at(-1)==='')lines.pop();
   const lineStartOffsets=[];let absolute=windowStart+firstComplete;for(const line of lines){lineStartOffsets.push(absolute);absolute+=Buffer.byteLength(line)+1;}
   if(absolute!==start.offset)return {items:[],nextCursor:null,complete:false,reason:'index_truncated',knownRecords:null,limits:{pageRows:MAX_PAGE_ROWS,pageBytes:MAX_PAGE_BYTES,indexBytes:MAX_INDEX_BYTES}};
   const rows=[],seen=new Set();let reason=null;
   for(let index=0;index<lines.length;index++){const raw=lines[index];if(Buffer.byteLength(raw)+1>MAX_ROW_BYTES){reason='index_row_too_large';break}let row;try{row=JSON.parse(raw)}catch{reason='index_corrupt';break}if(!validRow(row)){reason='index_corrupt';break}if(seen.has(row.transaction)){reason='index_duplicate';break}seen.add(row.transaction);rows.push(row)}
   if(reason)return {items:[],nextCursor:null,complete:false,reason,knownRecords:null,limits:{pageRows:MAX_PAGE_ROWS,pageBytes:MAX_PAGE_BYTES,indexBytes:MAX_INDEX_BYTES}};
   if(start.previousRef&&rows.length&&rows.at(-1).transaction===start.previousRef)return {items:[],nextCursor:null,complete:false,reason:'index_duplicate',knownRecords:null,limits:{pageRows:MAX_PAGE_ROWS,pageBytes:MAX_PAGE_BYTES,indexBytes:MAX_INDEX_BYTES}};
   const transactions=await openDirectoryNoFollow(path.join(data,'transactions'));
   try{
    const items=[];let nextOffset=windowStart+firstComplete,oldestReturned=null;
    for(let index=rows.length-1;index>=0;index--){
     if(items.length>=limit){nextOffset=lineStartOffsets[index+1]??start.offset;break;}
     items.push(await projectJournal(transactions,rows[index].transaction,getQuarantineRoot()));oldestReturned=rows[index].transaction;nextOffset=lineStartOffsets[index];
    }
    if(items.length===limit&&nextOffset===start.offset&&windowStart>0)nextOffset=windowStart+firstComplete;
    const nextCursor=nextOffset>0?cursorEncode({version:1,offset:nextOffset,end:start.end,dev:start.dev,ino:start.ino,previousRef:oldestReturned},cursorKey):null;
    return {items,nextCursor,complete:!nextCursor,reason:null,knownRecords:null,limits:{pageRows:MAX_PAGE_ROWS,pageBytes:MAX_PAGE_BYTES,indexBytes:MAX_INDEX_BYTES}};
   }finally{await transactions.close()}
  }finally{await handle.close()}
  }finally{await directory.close()}
 }
 async function updateOutcome(transaction,{tdarr='unknown',sonarr='unknown'}={}){
  if(!JOURNAL.test(transaction))throw Error('Odkaz na protokol instalace TV není platný.');
  const transactions=await openDirectoryNoFollow(path.join(data,'transactions'));let record;
  try{record=await readJournal(transactions,transaction);if(!record)throw Error('Protokol instalace TV není dostupný.');}catch(error){await transactions.close();throw error}
  const allowed=new Set(['completed','pending','failed','unknown','not_applicable']);
  try{if(!allowed.has(tdarr)||!allowed.has(sonarr))throw Error('Stav aktualizace instalace TV není platný.');record.tvInstallOutcome={version:1,tdarr,sonarr,updatedAt:new Date().toISOString()};await writeJournal(transactions,transaction,record)}finally{await transactions.close()}
 }
 async function hasIndex(){try{await fs.lstat(indexFile);return true}catch(error){if(error?.code==='ENOENT')return false;return true}}
 return {append,page,updateOutcome,hasIndex,indexFile};
}
