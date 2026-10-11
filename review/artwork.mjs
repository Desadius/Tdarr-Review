import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';

const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const validId=value=>typeof value==='string'&&/^[a-f0-9]{24}$/.test(value);
const positive=value=>Number.isSafeInteger(value)&&value>0;
const relativePath=value=>typeof value==='string'&&value.length<=4096&&!value.startsWith('/')&&!value.includes('\\')&&!value.split('/').some(p=>!p||p==='.'||p==='..');

// Only this saved, administrator-configured Radarr endpoint can be contacted.
// Client IDs and movie.images URLs never become a network destination.
export function artworkConnection(value){
 if(!value||typeof value.url!=='string'||typeof value.apiKey!=='string'||!value.apiKey.trim())throw Error('Artwork unavailable');
 const url=new URL(value.url),host=url.hostname.replace(/^\[|\]$/g,'');
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('Artwork unavailable');
 if(host==='0.0.0.0'||host==='::'||host==='169.254.169.254'||/^169\.254\./.test(host)||/^fe[89ab][0-9a-f]:/i.test(host)||/^ff[0-9a-f]{2}:/i.test(host))throw Error('Artwork unavailable');
 if(net.isIP(host)===4&&Number(host.split('.')[0])>=224)throw Error('Artwork unavailable');
 const mapped=/^::ffff:([a-f0-9]+):([a-f0-9]+)$/i.exec(host);
 if(mapped){const high=parseInt(mapped[1],16),low=parseInt(mapped[2],16);if(high===0xa9fe||high===0&&low===0||high>>>8>=224)throw Error('Artwork unavailable');}
 if(typeof value.mediaRoot!=='string'||!value.mediaRoot.startsWith('/')||value.mediaRoot==='/'||value.mediaRoot.includes('\\')||value.mediaRoot.split('/').some(p=>p==='.'||p==='..'))throw Error('Artwork unavailable');
 return {url:url.href.replace(/\/$/,''),apiKey:value.apiKey.trim(),mediaRoot:value.mediaRoot.replace(/\/+$/,'')};
}

export function matchArtworkMovie(movies,record,kind,connection){
 if(!Array.isArray(movies))return null;
 let found;
 if(kind==='review'){
  if(!relativePath(record.relative))return null;
  found=movies.filter(m=>m?.movieFile?.path===connection.mediaRoot+'/'+record.relative);
 }else if(kind==='request'){
  if(record.radarrUrl&&record.radarrUrl!==connection.url||record.radarrRoot&&record.radarrRoot!==connection.mediaRoot)return null;
  const movieId=record.movieId,tmdbId=record.tmdbId??record.tmdbID;
  if(positive(movieId))found=movies.filter(m=>m?.id===movieId&&(!positive(tmdbId)||m.tmdbId===tmdbId));
  else if(positive(tmdbId))found=movies.filter(m=>m?.tmdbId===tmdbId);
  else return null;
 }else return null;
 return found.length===1&&positive(found[0]?.id)?found[0]:null;
}

export async function requestArtworkIdentity(data,visible){
 if(!validId(visible?.id))return null;
 if(visible.source==='recovery')return {id:visible.id,movieId:visible.movieId,tmdbId:visible.tmdbId??visible.tmdbID};
 const file=path.join(data,'radarr-replacements',visible.id+'.json');
 try{
  const st=await fs.lstat(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size>128*1024)return null;
  const stored=JSON.parse(await fs.readFile(file,'utf8'));
  if(stored.id!==visible.id)return null;
  return {id:stored.id,movieId:stored.movieId,tmdbId:stored.tmdbId??stored.tmdbID,...(stored.radarrUrl?{radarrUrl:stored.radarrUrl}:{}),...(stored.radarrRoot?{radarrRoot:stored.radarrRoot}:{})};
 }catch{return null;}
}

// Radarr thumbnails are JPEGs. Validate magic, segment bounds, dimensions and
// the end marker; reject HTML/SVG and oversized originals, even with image MIME.
export function inspectArtwork(bytes,mime,maxPixels=4000000){
 if(!Buffer.isBuffer(bytes)||bytes.length<12||mime?.split(';')[0].trim().toLowerCase()!=='image/jpeg'||bytes.readUInt16BE(0)!==0xffd8||bytes.readUInt16BE(bytes.length-2)!==0xffd9)throw Error('Invalid artwork');
 let offset=2,width,height;
 while(offset<bytes.length-2){
  if(bytes[offset++]!==0xff)throw Error('Invalid artwork');
  while(bytes[offset]===0xff)offset++;
  const marker=bytes[offset++];
  if(marker===0xd9||marker===0xda)break;
  if(marker===0xd8||marker===0||marker===0x01||marker>=0xd0&&marker<=0xd7)throw Error('Invalid artwork');
  if(offset+2>bytes.length)throw Error('Invalid artwork');
  const length=bytes.readUInt16BE(offset);
  if(length<2||offset+length>bytes.length)throw Error('Invalid artwork');
  if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
   if(length<8)throw Error('Invalid artwork');
   height=bytes.readUInt16BE(offset+3);width=bytes.readUInt16BE(offset+5);
   if(!width||!height||width>4096||height>4096||width*height>maxPixels)throw Error('Invalid artwork');
  }
  offset+=length;
 }
 if(!width||!height)throw Error('Invalid artwork');
 return {mime:'image/jpeg',width,height};
}

async function boundedBody(response,limit){
 const reported=Number(response.headers.get('content-length'));
 if(Number.isFinite(reported)&&reported>limit){await response.body?.cancel();throw Error('Artwork response too large');}
 if(!response.body)throw Error('Empty artwork response');
 const chunks=[];let size=0;
 try{for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw Error('Artwork response too large');chunks.push(Buffer.from(chunk));}}
 catch(error){try{await response.body.cancel();}catch{}throw error;}
 return Buffer.concat(chunks,size);
}

export function createArtwork({data,getConnection,fetchFn=globalThis.fetch,now=Date.now,freshMs=86400000,negativeMs=60000,maxBytes=48*1024*1024,maxFiles=512,imageLimit=2*1024*1024,timeoutMs=7000}){
 const directory=path.join(data,'artwork-cache'),flights=new Map(),negative=new Map();
 let movies=null,moviesAt=0,moviesNamespace=null,moviesTask=null,moviesFailureAt=0,pruneChain=Promise.resolve();
 let networkActive=0,setupTask=null;const networkQueue=[];
 async function network(task){
  if(networkActive>=4){if(networkQueue.length>=64)throw Error('Artwork busy');await new Promise(resolve=>networkQueue.push(resolve));}
  else networkActive++;
  try{return await task();}finally{const next=networkQueue.shift();if(next)next();else networkActive--;}
 }
 const negativeSet=key=>{if(negative.size>=512)negative.delete(negative.keys().next().value);negative.set(key,now()+negativeMs);};
 async function ensureDirectory(){
  if(!setupTask)setupTask=(async()=>{await fs.mkdir(directory,{recursive:true});const st=await fs.lstat(directory);if(!st.isDirectory()||st.isSymbolicLink())throw Error('Invalid artwork cache');await prune(true);})();
  await setupTask;
 }
 async function readCache(key,namespace){
  try{
   const metaPath=path.join(directory,key+'.json'),imagePath=path.join(directory,key+'.jpg');
   const mst=await fs.lstat(metaPath),ist=await fs.lstat(imagePath);
   if(!mst.isFile()||mst.isSymbolicLink()||mst.size>2048||!ist.isFile()||ist.isSymbolicLink()||ist.size>imageLimit)return null;
   const meta=JSON.parse(await fs.readFile(metaPath,'utf8'));
   if(meta.version!==1||meta.namespace!==namespace||!positive(meta.movieId)||!Number.isFinite(meta.at)||meta.at>now()+60000)return null;
   const body=await fs.readFile(imagePath),info=inspectArtwork(body,meta.mime);
   if(body.length!==meta.bytes||hash(body)!==meta.digest)return null;
   return {...info,body,etag:'"'+meta.digest+'"',status:now()-meta.at<freshMs?'fresh':'stale'};
  }catch{return null;}
 }
 async function atomicWrite(file,body){
  const temporary=file+'.'+crypto.randomBytes(8).toString('hex')+'.tmp';
  try{await fs.writeFile(temporary,body,{flag:'wx',mode:0o600});await fs.rename(temporary,file);}finally{await fs.unlink(temporary).catch(()=>{});}
 }
 async function prune(startup=false){
  const files=[];
  for(const name of await fs.readdir(directory)){
   if(/^[a-f0-9]{64}\.(jpg|json)\.[a-f0-9]{16}\.tmp$/.test(name)){
    const temporary=path.join(directory,name),st=await fs.lstat(temporary);
    if(st.isFile()&&!st.isSymbolicLink()&&(startup||now()-st.mtimeMs>86400000))await fs.unlink(temporary).catch(()=>{});
    continue;
   }
   if(!/^[a-f0-9]{64}\.(jpg|json)$/.test(name))continue;
   const file=path.join(directory,name),st=await fs.lstat(file);
   if(st.isFile()&&!st.isSymbolicLink())files.push({file,name,size:st.size,at:st.mtimeMs});
  }
  let bytes=files.reduce((sum,f)=>sum+f.size,0),images=files.filter(f=>f.name.endsWith('.jpg')).sort((a,b)=>a.at-b.at);
  while(images.length>maxFiles||bytes>maxBytes){
   const image=images.shift();if(!image)break;
   for(const file of files.filter(f=>f.name.startsWith(image.name.slice(0,-4)+'.'))){await fs.unlink(file.file).catch(()=>{});bytes-=file.size;}
  }
  // Remove orphaned manifests left by an interrupted write/eviction.
  const kept=new Set(images.map(f=>f.name.slice(0,-4)));
  for(const meta of files.filter(f=>f.name.endsWith('.json')&&!kept.has(f.name.slice(0,-5))))await fs.unlink(meta.file).catch(()=>{});
 }
 async function saveCache(key,namespace,movie,image){
  await ensureDirectory();
  const meta={version:1,namespace,movieId:movie.id,tmdbId:movie.tmdbId??null,at:now(),bytes:image.body.length,digest:hash(image.body),mime:image.mime};
  await atomicWrite(path.join(directory,key+'.jpg'),image.body);
  await atomicWrite(path.join(directory,key+'.json'),JSON.stringify(meta));
  pruneChain=pruneChain.catch(()=>{}).then(prune);await pruneChain;
 }
 async function getResource(connection,route,limit){
  const target=new URL(connection.url+route);
  if(target.origin!==new URL(connection.url).origin)throw Error('Invalid artwork destination');
  return network(async()=>{
   const response=await fetchFn(target,{method:'GET',redirect:'error',headers:{'X-Api-Key':connection.apiKey},signal:AbortSignal.timeout(timeoutMs)});
   if(!response.ok||response.redirected){await response.body?.cancel();return null;}
   return {mime:response.headers.get('content-type'),body:await boundedBody(response,limit)};
  });
 }
 async function movieList(connection,namespace){
  if(moviesNamespace===namespace&&movies&&now()-moviesAt<60000)return movies;
  if(moviesTask&&moviesNamespace===namespace)return moviesTask;
  if(moviesNamespace===namespace&&moviesFailureAt&&now()-moviesFailureAt<negativeMs)throw Error('Artwork unavailable');
  if(moviesNamespace!==namespace){movies=null;moviesAt=0;moviesFailureAt=0;}
  moviesNamespace=namespace;
  const task=(async()=>{
   const resource=await getResource(connection,'/api/v3/movie',24*1024*1024);
   if(!resource||!resource.mime?.toLowerCase().startsWith('application/json'))throw Error('Invalid Radarr metadata');
   const list=JSON.parse(resource.body.toString('utf8'));
   if(!Array.isArray(list)||list.length>20000)throw Error('Invalid Radarr metadata');
   if(moviesNamespace===namespace){movies=list;moviesAt=now();moviesFailureAt=0;}return list;
  })();
  moviesTask=task;
  try{return await task;}catch(error){if(moviesNamespace===namespace)moviesFailureAt=now();throw error;}finally{if(moviesTask===task)moviesTask=null;}
 }
 async function lookup(kind,record){
  if(!['review','request'].includes(kind)||!validId(record?.id))return null;
  // Alias includes identity so ID reuse cannot present an old film's artwork.
  const identity=kind==='review'?record.relative:String(record.movieId||'')+'|'+String(record.tmdbId??record.tmdbID??'')+'|'+String(record.radarrUrl||'')+'|'+String(record.radarrRoot||'');
  if(kind==='review'&&!relativePath(identity))return null;
  let connection;try{connection=artworkConnection(await getConnection());}catch{return null;}
  const namespace=hash(connection.url+'|'+connection.mediaRoot),key=hash(namespace+'|'+kind+'|'+record.id+'|'+identity);
  if(flights.has(key))return flights.get(key);
  const task=(async()=>{
   try{await ensureDirectory();}catch{return null;}
   const cached=await readCache(key,namespace);
   if(cached?.status==='fresh')return cached;
   if((negative.get(key)||0)>now())return cached;
   try{
    const movie=matchArtworkMovie(await movieList(connection,namespace),record,kind,connection);
    if(!movie){
     // A successful metadata response that no longer identifies this film is
     // different from an offline server: do not revive its old cached image.
     for(const ext of ['jpg','json'])await fs.unlink(path.join(directory,key+'.'+ext)).catch(()=>{});
     negativeSet(key);return null;
    }
    for(const filename of ['poster-250.jpg','poster.jpg']){
     const image=await getResource(connection,'/api/v3/mediacover/'+movie.id+'/'+filename,imageLimit);
     if(!image)continue;
     let info;try{info=inspectArtwork(image.body,image.mime);}catch{continue;}
     const result={...info,body:image.body,etag:'"'+hash(image.body)+'"',status:'fresh'};
     try{await saveCache(key,namespace,movie,result);}catch{/* A cache write failure must not block the UI. */}
     negative.delete(key);return result;
    }
   }catch{/* Never expose credentials, URLs or network diagnostics to clients. */}
   negativeSet(key);return cached;
  })();
  flights.set(key,task);try{return await task;}finally{flights.delete(key);}
 }
 return {lookup};
}
