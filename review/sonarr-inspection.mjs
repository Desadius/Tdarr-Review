import {randomUUID} from 'node:crypto';
import {createEpisodeBindingResolver} from './episode-binding.mjs';

const timeoutMs=7000,seriesLimit=4*1024*1024,snapshotLimit=16*1024*1024;
const maxSeries=5000,maxFiles=20000,maxEpisodes=50000;
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

function safeConnection(value){
 if(!record(value)||typeof value.url!=='string'||typeof value.apiKey!=='string'||!value.apiKey.trim())throw Error('sonarr_unavailable');
 let base;try{base=new URL(value.url);}catch{throw Error('sonarr_unavailable');}
 if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash||base.href.length>2048)throw Error('sonarr_unavailable');
 base.pathname=base.pathname.replace(/\/+$/,'');
 return {base,apiKey:value.apiKey.trim()};
}
async function responseJson(fetchFn,url,apiKey,limit,requestTimeout=timeoutMs){
 const response=await fetchFn(url,{method:'GET',redirect:'error',headers:{'X-Api-Key':apiKey,accept:'application/json'},signal:AbortSignal.timeout(requestTimeout)});
 if(response.status!==200||response.redirected){await response.body?.cancel();throw Error('sonarr_unavailable');}
 const mime=response.headers.get('content-type')||'';
 if(!/^application\/json(?:\s*;|$)/i.test(mime)){await response.body?.cancel();throw Error('sonarr_unavailable');}
 const declared=Number(response.headers.get('content-length'));
 if(Number.isFinite(declared)&&declared>limit){await response.body?.cancel();throw Error('sonarr_too_large');}
 if(!response.body)throw Error('sonarr_unavailable');
 const chunks=[];let size=0;
 try{for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw Error('sonarr_too_large');chunks.push(Buffer.from(chunk));}}
 catch(error){try{await response.body.cancel();}catch{}throw error;}
 let parsed;try{parsed=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));}catch{throw Error('sonarr_unavailable');}
 const total=response.headers.get('x-total-count');
 if(total!==null&&(!/^\d+$/.test(total)||!Array.isArray(parsed)||Number(total)!==parsed.length))throw Error('sonarr_unavailable');
 return parsed;
}
// A root URL (http://host:8989) has the pathname '/', which must not be doubled in front of the route.
const routeUrl=(base,route)=>new URL((base.pathname==='/'?'':base.pathname)+route,base.origin);
function array(value,limit){if(!Array.isArray(value))throw Error('sonarr_unavailable');if(value.length>limit)throw Error('sonarr_too_large');return value;}
function positive(value){return Number.isSafeInteger(value)&&value>0;}
function safeRelative(value){
 if(typeof value!=='string'||!value||value.length>2048||value.startsWith('/')||/^[a-z]:/i.test(value)||value.includes('\\')||value.includes('\0')||value.split('/').some(part=>!part||part==='.'||part==='..'))return null;
 return value;
}

/** Manual, request-scoped Sonarr metadata inspection. No cache, filesystem or mutation path. */
export function createSonarrInspection({getConnection,fetchFn=globalThis.fetch,requestTimeoutMs=timeoutMs}){
 async function connection(revision){const value=await getConnection(revision);return safeConnection(value);}
 async function get(base,apiKey,route,limit){const url=routeUrl(base,route);return responseJson(fetchFn,url,apiKey,limit,requestTimeoutMs);}
 async function series(revision){
  const {base,apiKey}=await connection(revision),items=array(await get(base,apiKey,'/api/v3/series',seriesLimit),maxSeries);
  if(items.some(item=>!record(item)||!positive(item.id)||typeof item.title!=='string'||item.title.length>500))throw Error('sonarr_unavailable');
  await connection(revision);
  return {series:items.map(({id,title})=>({id,title}))};
 }
 async function inspect(revision,seriesId){
  if(!positive(seriesId))throw Error('sonarr_unavailable');
  const {base,apiKey}=await connection(revision);
  const seriesList=array(await get(base,apiKey,'/api/v3/series',seriesLimit),maxSeries);
  const selected=seriesList.filter(item=>record(item)&&item.id===seriesId);
  if(selected.length!==1||typeof selected[0].title!=='string')throw Error('sonarr_unavailable');
  const query='?seriesId='+encodeURIComponent(String(seriesId));
  const [files,episodes]=await Promise.all([
   get(base,apiKey,'/api/v3/episodefile'+query,snapshotLimit).then(value=>array(value,maxFiles)),
   get(base,apiKey,'/api/v3/episode'+query,snapshotLimit).then(value=>array(value,maxEpisodes)),
  ]);
  // Sonarr's series-scoped endpoints must return complete records for this series; any other
  // record makes the snapshot ambiguous rather than silently shrinking its membership.
  if(files.some(item=>!record(item)||item.seriesId!==seriesId)||episodes.some(item=>!record(item)||item.seriesId!==seriesId))throw Error('sonarr_unavailable');
  const namespace='sonarr-inspection:'+randomUUID();
  const resolveBinding=createEpisodeBindingResolver({instanceKey:namespace,seriesId,episodeFiles:files,episodes});
  const bindings=files.map(file=>{
   const result=resolveBinding.resolve(file.path);
   const label=safeRelative(file.relativePath);
   const sceneName=typeof file.sceneName==='string'&&!/^(?:[a-z]:[\\/]|\/|\\\\)/i.test(file.sceneName)?file.sceneName:null;
   if(result.status==='mapped')return {status:'mapped',reason:null,binding:{instanceKey:result.binding.instanceKey,seriesId:result.binding.seriesId,episodeFileId:result.binding.episodeFileId,episodeIds:[...result.binding.episodeIds]},file:{id:result.binding.episodeFileId,label,seasonNumber:result.file.seasonNumber,sceneName},episodes:result.episodes.map(({id,...numbers})=>({id,...numbers}))};
   return {status:result.status,reason:result.reason,file:{id:file.id,label,seasonNumber:Number.isSafeInteger(file.seasonNumber)&&file.seasonNumber>=0?file.seasonNumber:null,sceneName},episodes:[]};
  });
  await connection(revision);
  const unacquiredEpisodes=episodes.filter(episode=>episode.seriesId===seriesId&&(episode.episodeFileId===0||episode.episodeFileId===null)).map(episode=>({
   id:episode.id,seasonNumber:episode.seasonNumber??null,episodeNumber:episode.episodeNumber??null,
   absoluteEpisodeNumber:episode.absoluteEpisodeNumber??null,sceneAbsoluteEpisodeNumber:episode.sceneAbsoluteEpisodeNumber??null,
   sceneSeasonNumber:episode.sceneSeasonNumber??null,sceneEpisodeNumber:episode.sceneEpisodeNumber??null,
   unverifiedSceneNumbering:episode.unverifiedSceneNumbering??null,airDate:episode.airDate??null,airDateUtc:episode.airDateUtc??null,
  }));
  return {series:{id:seriesId,title:selected[0].title},complete:true,source:'unverified',bindings,unacquiredEpisodes};
 }
 // Internal source-check seam. `sonarrPath` is request-local backend data and must
 // never be copied into an HTTP response or persisted by a caller.
 async function inspectEpisodeFile(revision,seriesId,episodeFileId){
  if(!positive(seriesId)||!positive(episodeFileId))throw Error('sonarr_unavailable');
  const {base,apiKey}=await connection(revision);
  const seriesList=array(await get(base,apiKey,'/api/v3/series',seriesLimit),maxSeries);
  const selected=seriesList.filter(item=>record(item)&&item.id===seriesId);
  if(selected.length!==1||typeof selected[0].title!=='string')throw Error('sonarr_unavailable');
  const query='?seriesId='+encodeURIComponent(String(seriesId));
  const [files,episodes]=await Promise.all([
   get(base,apiKey,'/api/v3/episodefile'+query,snapshotLimit).then(value=>array(value,maxFiles)),
   get(base,apiKey,'/api/v3/episode'+query,snapshotLimit).then(value=>array(value,maxEpisodes)),
  ]);
  if(files.some(item=>!record(item)||item.seriesId!==seriesId)||episodes.some(item=>!record(item)||item.seriesId!==seriesId))throw Error('sonarr_unavailable');
  const matches=files.filter(item=>item.id===episodeFileId);
  if(matches.length!==1)throw Error('sonarr_unavailable');
  const namespace='sonarr-source-check:'+randomUUID();
  const resolveBinding=createEpisodeBindingResolver({instanceKey:namespace,seriesId,episodeFiles:files,episodes});
  const file=matches[0],result=resolveBinding.resolve(file.path);
  await connection(revision);
  if(result.status!=='mapped'||result.binding.episodeFileId!==episodeFileId)return {status:result.status,reason:result.reason};
  return {
   status:'mapped',reason:null,sonarrPath:file.path,
   binding:{instanceKey:result.binding.instanceKey,seriesId:result.binding.seriesId,episodeFileId:result.binding.episodeFileId,episodeIds:[...result.binding.episodeIds]},
   file:{id:episodeFileId,label:safeRelative(file.relativePath),seasonNumber:Number.isSafeInteger(file.seasonNumber)&&file.seasonNumber>=0?file.seasonNumber:null},
   episodes:result.episodes.map(({id,...numbers})=>({id,...numbers})),
  };
 }
 return {series,inspect,inspectEpisodeFile};
}

/**
 * Read-only Sonarr reads for TV discovery (#271): the series list, and the complete EpisodeFile and Episode
 * snapshot of one series. Only GET requests, each bounded by `requestTimeoutMs`. Nothing is cached or stored here;
 * a snapshot that contradicts the requested series throws `sonarr_inconsistent`, every other failure `sonarr_unavailable`.
 */
export function createSonarrDiscoveryReader({connection,fetchFn=globalThis.fetch,requestTimeoutMs=timeoutMs}){
 const {base,apiKey}=safeConnection(connection);
 const get=(route,limit)=>responseJson(fetchFn,routeUrl(base,route),apiKey,limit,requestTimeoutMs);
 async function seriesList(){
  const items=array(await get('/api/v3/series',seriesLimit),maxSeries);
  if(items.some(item=>!record(item)||!positive(item.id)||typeof item.title!=='string'||item.title.length>500||typeof item.path!=='string'||!item.path))throw Error('sonarr_unavailable');
  if(new Set(items.map(item=>item.id)).size!==items.length)throw Error('sonarr_inconsistent');
  return items.map(({id,title,path,seriesType})=>({id,title,path,seriesType:['standard','daily','anime'].includes(seriesType)?seriesType:null}));
 }
 async function seriesSnapshot(seriesId){
  if(!positive(seriesId))throw Error('sonarr_unavailable');
  const query='?seriesId='+encodeURIComponent(String(seriesId));
  const [episodeFiles,episodes]=await Promise.all([
   get('/api/v3/episodefile'+query,snapshotLimit).then(value=>array(value,maxFiles)),
   get('/api/v3/episode'+query,snapshotLimit).then(value=>array(value,maxEpisodes)),
  ]);
  if(episodeFiles.some(item=>!record(item)||item.seriesId!==seriesId)||episodes.some(item=>!record(item)||item.seriesId!==seriesId))throw Error('sonarr_inconsistent');
  return {episodeFiles,episodes};
 }
 return {seriesList,seriesSnapshot};
}
