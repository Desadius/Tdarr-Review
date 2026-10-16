import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {artworkConnection,matchArtworkMovie,requestArtworkIdentity,inspectArtwork,createArtwork} from './artwork.mjs';

const ID='a'.repeat(24),ID2='b'.repeat(24),ID3='c'.repeat(24);
const connection={url:'http://127.0.0.1:7878/radarr',mediaRoot:'/media',apiKey:'server-secret'};
const review={id:ID,relative:'Movie (2022)/Movie.mkv'};
const movie={id:17,tmdbId:234,movieFile:{path:'/media/'+review.relative},images:[{coverType:'poster',url:'http://169.254.169.254/latest/meta-data/'}]};
const jpeg=(width=166,height=250)=>Buffer.from([0xff,0xd8,0xff,0xc0,0,11,8,height>>8,height&255,width>>8,width&255,1,1,0x11,0,0xff,0xda,0,8,1,1,0,0,0x3f,0,1,2,3,0xff,0xd9]);
async function workspace(fn){const data=await fs.mkdtemp(path.join(os.tmpdir(),'review-artwork-'));try{await fn(data);}finally{await fs.rm(data,{recursive:true,force:true});}}
function fakeRadarr({movies=[movie],poster=jpeg(),thumbnailMissing=false,offline=false}={}){
 const calls=[];
 const fetchFn=async(url,options)=>{
  calls.push({url:String(url),options});if(offline)throw Error('network failed');
  if(String(url).endsWith('/api/v3/movie'))return new Response(JSON.stringify(movies),{headers:{'content-type':'application/json'}});
  if(thumbnailMissing&&String(url).endsWith('poster-250.jpg'))return new Response('missing',{status:404});
  return new Response(poster,{headers:{'content-type':'image/jpeg'}});
 };return {fetchFn,calls};
}

test('artwork identity uses only exact paths and stable IDs, never a title',()=>{
 assert.equal(matchArtworkMovie([movie],review,'review',connection),movie);
 assert.equal(matchArtworkMovie([movie],{...review,relative:'Movie (2022)/Other.mkv',title:'Movie (2022)'},'review',connection),null);
 assert.equal(matchArtworkMovie([movie,movie],review,'review',connection),null);
 assert.equal(matchArtworkMovie([movie],{tmdbId:234},'request',connection),movie);
 assert.equal(matchArtworkMovie([movie],{tmdbID:234},'request',connection),movie);
 assert.equal(matchArtworkMovie([movie],{movieId:17,tmdbId:999},'request',connection),null);
 assert.equal(matchArtworkMovie([movie],{movieId:17,radarrUrl:'http://different-radarr:7878'},'request',connection),null);
 assert.equal(matchArtworkMovie([movie],{relative:'../'+review.relative},'review',connection),null);
});

test('configured origin preserves UrlBase and refuses credentials, query and metadata targets',()=>{
 assert.equal(artworkConnection(connection).url,connection.url);
 for(const url of ['file:///etc/passwd','http://user:pass@radarr/','http://radarr/?apikey=x','http://radarr/#x','http://169.254.169.254/','http://169.254.1.2/','http://[::ffff:169.254.169.254]/','http://[fe80::1]/','http://0.0.0.0/','http://224.1.1.1/'])assert.throws(()=>artworkConnection({...connection,url}));
 assert.throws(()=>artworkConnection({...connection,mediaRoot:'/media/../etc'}));
});

test('JPEG validation rejects HTML, wrong MIME, malformed bounds and excessive dimensions',()=>{
 assert.deepEqual(inspectArtwork(jpeg(),'image/jpeg'),{mime:'image/jpeg',width:166,height:250});
 assert.throws(()=>inspectArtwork(Buffer.from('<html>error page</html>'),'image/jpeg'));
 assert.throws(()=>inspectArtwork(jpeg(),'image/svg+xml'));
 assert.throws(()=>inspectArtwork(jpeg(4000,4000),'image/jpeg'));
 const malformed=jpeg();malformed.writeUInt16BE(65535,4);assert.throws(()=>inspectArtwork(malformed,'image/jpeg'));
 assert.throws(()=>inspectArtwork(jpeg().subarray(0,-2),'image/jpeg'));
});

test('service contacts fixed read-only Radarr endpoints and ignores malicious image URLs',async()=>workspace(async data=>{
 const fake=fakeRadarr(),service=createArtwork({data,getConnection:()=>connection,fetchFn:fake.fetchFn});
 const result=await service.lookup('review',review);
 assert.equal(result.status,'fresh');assert.equal(result.mime,'image/jpeg');assert.deepEqual(result.body,jpeg());
 assert.equal(fake.calls.length,2);
 assert.equal(fake.calls[0].url,connection.url+'/api/v3/movie');
 assert.equal(fake.calls[1].url,connection.url+'/api/v3/mediacover/17/poster-250.jpg');
 for(const {url,options}of fake.calls){assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.headers['X-Api-Key'],'server-secret');assert(!url.includes('server-secret'));}
 assert(!JSON.stringify(result).includes('server-secret'));
}));

test('missing thumbnail falls back to the fixed original endpoint',async()=>workspace(async data=>{
 const fake=fakeRadarr({thumbnailMissing:true}),service=createArtwork({data,getConnection:()=>connection,fetchFn:fake.fetchFn});
 assert(await service.lookup('review',review));
 assert.equal(fake.calls.at(-1).url,connection.url+'/api/v3/mediacover/17/poster.jpg');
}));

test('parallel requests are coalesced; disk cache survives a restart and offline Radarr',async()=>workspace(async data=>{
 let clock=1000000;const fake=fakeRadarr();
 const service=createArtwork({data,getConnection:()=>connection,fetchFn:fake.fetchFn,now:()=>clock,freshMs:1000});
 const results=await Promise.all(Array.from({length:8},()=>service.lookup('review',review)));
 assert(results.every(r=>r?.status==='fresh'));assert.equal(fake.calls.length,2);
 const offline=fakeRadarr({offline:true});
 const restarted=createArtwork({data,getConnection:()=>connection,fetchFn:offline.fetchFn,now:()=>clock,freshMs:1000});
 assert.equal((await restarted.lookup('review',review)).status,'fresh');assert.equal(offline.calls.length,0);
 clock+=2000;
 assert.equal((await restarted.lookup('review',review)).status,'stale');assert.equal(offline.calls.length,1);
 assert.equal((await restarted.lookup('review',review)).status,'stale');assert.equal(offline.calls.length,1);
}));

test('unknown IDs, changed identity and changed Radarr connection never reuse a cached poster',async()=>workspace(async data=>{
 const fake=fakeRadarr();const service=createArtwork({data,getConnection:()=>connection,fetchFn:fake.fetchFn});
 assert(await service.lookup('review',review));
 assert.equal(await service.lookup('review',{...review,id:'../bad'}),null);
 assert.equal(await service.lookup('review',{...review,relative:'Other/Other.mkv'}),null);
 const offline=fakeRadarr({offline:true});
 const moved=createArtwork({data,getConnection:()=>({...connection,url:'http://other-radarr:7878'}),fetchFn:offline.fetchFn});
 assert.equal(await moved.lookup('review',review),null);
}));

test('offline metadata has namespace-wide backoff across different movie rows',async()=>workspace(async data=>{
 const fake=fakeRadarr({offline:true}),service=createArtwork({data,getConnection:()=>connection,fetchFn:fake.fetchFn});
 assert.equal(await service.lookup('review',review),null);
 assert.equal(await service.lookup('review',{...review,id:ID2}),null);
 assert.equal(fake.calls.length,1);
}));

test('authoritative identity loss invalidates stale cache instead of reviving it on retry',async()=>workspace(async data=>{
 let clock=1000000;const fake=fakeRadarr();
 const first=createArtwork({data,getConnection:()=>connection,fetchFn:fake.fetchFn,now:()=>clock,freshMs:1000});
 assert(await first.lookup('review',review));clock+=2000;
 const missing=fakeRadarr({movies:[]});
 const second=createArtwork({data,getConnection:()=>connection,fetchFn:missing.fetchFn,now:()=>clock,freshMs:1000});
 assert.equal(await second.lookup('review',review),null);
 assert.equal(await second.lookup('review',review),null);
 assert.deepEqual(await fs.readdir(path.join(data,'artwork-cache')),[]);
}));

test('body size, image MIME and redirects are checked; nothing invalid is cached',async()=>workspace(async data=>{
 for(const variant of ['large','html','redirect']){
  const fetchFn=async(url)=>{
   if(String(url).endsWith('/movie'))return new Response(JSON.stringify([movie]),{headers:{'content-type':'application/json'}});
   if(variant==='large')return new Response(jpeg(),{headers:{'content-type':'image/jpeg','content-length':'9000000'}});
   if(variant==='html')return new Response('<html>Login</html>',{headers:{'content-type':'image/jpeg'}});
   return new Response('',{status:302,headers:{location:'http://169.254.169.254/'}});
  };
  const service=createArtwork({data,getConnection:()=>connection,fetchFn});
  assert.equal(await service.lookup('review',review),null);
 }
 assert.deepEqual(await fs.readdir(path.join(data,'artwork-cache')),[]);
}));

test('persistent cache count and byte size are bounded',async()=>workspace(async data=>{
 const fake=fakeRadarr();const service=createArtwork({data,getConnection:()=>connection,fetchFn:fake.fetchFn,maxFiles:2,maxBytes:4000});
 for(const id of [ID,ID2,ID3])assert(await service.lookup('request',{id,movieId:17}));
 const files=await fs.readdir(path.join(data,'artwork-cache'));
 assert.equal(files.filter(f=>f.endsWith('.jpg')).length,2);
 assert.equal(files.filter(f=>f.endsWith('.json')).length,2);
 let size=0;for(const file of files)size+=(await fs.stat(path.join(data,'artwork-cache',file))).size;
 assert(size<=4000);
}));

test('request records are read privately, with strict ID and record-size checks',async()=>workspace(async data=>{
 await fs.mkdir(path.join(data,'radarr-replacements'));
 const file=path.join(data,'radarr-replacements',ID+'.json');
 await fs.writeFile(file,JSON.stringify({id:ID,movieId:17,apiKey:'must-not-escape',relative:'unused'}));
 assert.deepEqual(await requestArtworkIdentity(data,{id:ID}),{id:ID,movieId:17,tmdbId:undefined});
 assert.deepEqual(await requestArtworkIdentity(data,{id:ID,source:'recovery',tmdbId:234}),{id:ID,movieId:undefined,tmdbId:234});
 assert.equal(await requestArtworkIdentity(data,{id:'../bad'}),null);
 await fs.writeFile(file,JSON.stringify({id:ID2,movieId:17}));
 assert.equal(await requestArtworkIdentity(data,{id:ID}),null);
 await fs.writeFile(file,'x'.repeat(140000));assert.equal(await requestArtworkIdentity(data,{id:ID}),null);
}));

// The artwork routes, their login guard, caching headers and the model asset are tested over HTTP
// in server-wiring-http.test.mjs.
