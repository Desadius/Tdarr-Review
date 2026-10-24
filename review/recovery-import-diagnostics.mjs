const QUEUE_PAGE_SIZE=100,RESPONSE_BYTES=512*1024,TIMEOUT_MS=12000;
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const positive=value=>Number.isSafeInteger(value)&&value>0;

function radarrBase(connection){
 if(!connection||typeof connection.url!=='string'||connection.url.length>2048||typeof connection.apiKey!=='string'||!connection.apiKey.trim()||/[\0\r\n]/.test(connection.apiKey))return null;
 try{
  const url=new URL(connection.url);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname.split('/').some(part=>part==='.'||part==='..'))return null;
  url.pathname=url.pathname.replace(/\/+$/,'');
  return url;
 }catch{return null;}
}

function appUrl(base,route){
 const url=new URL(base.href.endsWith('/')?base.href:base.href+'/');
 return new URL(route,url).href;
}

export function radarrQueueUrl(connection){
 const base=radarrBase(connection);if(!base)return null;
 try{return appUrl(base,'activity/queue')}catch{return null;}
}

async function readJson(response,limit){
 const declared=Number(response.headers.get('content-length'));
 if(Number.isFinite(declared)&&declared>limit){await response.body?.cancel();throw new Error();}
 if(!response.body)throw new Error();
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new Error();}chunks.push(Buffer.from(value));}
 }finally{reader.releaseLock();}
 return JSON.parse(Buffer.concat(chunks,size).toString('utf8'));
}

async function getJson(fetchImpl,url,apiKey,signal){
 const response=await fetchImpl(url,{method:'GET',headers:{'X-Api-Key':apiKey,'Accept':'application/json'},redirect:'error',signal});
 if(response.status!==200){await response.body?.cancel();throw new Error();}
 return readJson(response,RESPONSE_BYTES);
}

function exactMovieUrl(base,movie){
 const slug=movie?.titleSlug;
 if(!/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(slug||''))return null;
 return appUrl(base,'movie/'+encodeURIComponent(slug));
}

function messageList(record){
 if(!Array.isArray(record.statusMessages))return [];
 const output=[];
 for(const entry of record.statusMessages.slice(0,12)){
  if(!object(entry)||!Array.isArray(entry.messages))continue;
  for(const value of entry.messages.slice(0,8))if(typeof value==='string'&&value.length<=1000)output.push(value);
 }
 return output;
}

function mismatchMessage(value){
 return /\b(?:language|languages|quality)\b/i.test(value)&&
  /\b(?:mismatch|not allowed|does not allow|doesn't allow|not acceptable|not accepted|does not meet|doesn't meet|does not match|doesn't match|not permitted|below cutoff|cutoff not met)\b/i.test(value);
}

function explicitImportFailure(value){
 return /\bimport\b/i.test(value)&&/\b(?:blocked|failed|error|cannot|could not|unable|denied|requires|rejected)\b/i.test(value);
}

function recordCategory(record){
 const messages=messageList(record);
 if(messages.some(mismatchMessage))return 'language-quality-mismatch';
 const state=typeof record.trackedDownloadState==='string'?record.trackedDownloadState.toLowerCase():'';
 const status=typeof record.status==='string'?record.status.toLowerCase():'';
 const tracked=typeof record.trackedDownloadStatus==='string'?record.trackedDownloadStatus.toLowerCase():'';
 if(state==='importblocked'||messages.some(explicitImportFailure))return 'import-problem';
 if(['failed','error','warning','downloadclientunavailable'].includes(status)||['error','warning'].includes(tracked))return 'unrecognized';
 if(['downloading','queued','waiting','delay','importpending','importing'].includes(state)||['downloading','queued','paused','pending'].includes(status))return 'download-pending';
 return 'unrecognized';
}

function validQueue(payload,movieId){
 if(!object(payload)||payload.page!==1||payload.pageSize!==QUEUE_PAGE_SIZE||!Number.isSafeInteger(payload.totalRecords)||payload.totalRecords<0||payload.totalRecords>QUEUE_PAGE_SIZE||!Array.isArray(payload.records)||payload.records.length!==payload.totalRecords)return null;
 const ids=new Set();
 for(const record of payload.records){
  if(!object(record)||!positive(record.id)||ids.has(record.id)||record.movieId!==movieId||typeof record.status!=='string'||record.status.length>100||
   !(record.trackedDownloadState===undefined||record.trackedDownloadState===null||typeof record.trackedDownloadState==='string'&&record.trackedDownloadState.length<=100)||
   !(record.trackedDownloadStatus===undefined||record.trackedDownloadStatus===null||typeof record.trackedDownloadStatus==='string'&&record.trackedDownloadStatus.length<=100))return null;
  ids.add(record.id);
 }
 return payload.records;
}

/** Fresh read-only Radarr lookup for one server-bound Recovery case. Only allowlisted codes and URLs leave this module. */
export async function inspectRadarrImport({connection,movieId,tmdbId,fetchImpl=fetch,now=Date.now}){
 const base=radarrBase(connection),queueUrl=base?appUrl(base,'activity/queue'):null,checkedAt=new Date(now()).toISOString();
 const result=(status,category=null,movieUrl=null)=>({status,category,movieUrl,queueUrl,checkedAt});
 if(!base||!positive(movieId)||!positive(tmdbId))return result('unavailable');
 let movieUrl=null;
 try{
  const signal=AbortSignal.timeout(TIMEOUT_MS),apiKey=connection.apiKey.trim();
  const movie=await getJson(fetchImpl,appUrl(base,'api/v3/movie/'+movieId),apiKey,signal);
  if(!object(movie)||movie.id!==movieId||movie.tmdbId!==tmdbId)return result('unavailable');
  movieUrl=exactMovieUrl(base,movie);
  const queueUrlApi=new URL(appUrl(base,'api/v3/queue'));
  queueUrlApi.searchParams.set('movieId',String(movieId));queueUrlApi.searchParams.set('page','1');queueUrlApi.searchParams.set('pageSize',String(QUEUE_PAGE_SIZE));
  const queue=validQueue(await getJson(fetchImpl,queueUrlApi.href,apiKey,signal),movieId);
  if(!queue)return result('unavailable',null,movieUrl);
  const categories=new Set(queue.map(recordCategory));
  const category=categories.size===1?[...categories][0]:'unrecognized';
  return result('verified',category,movieUrl);
 }catch{return result('unavailable',null,movieUrl);}
}
