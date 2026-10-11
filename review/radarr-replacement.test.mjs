import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {validateConnection,matchMovie,titleRegex,replacementProfile,canResume,createReplacement} from './radarr-replacement.mjs';
const profile={id:6,name:'HD',items:[{quality:{id:1,resolution:720},allowed:true},{quality:{id:2,resolution:1080},allowed:true},{quality:{id:3,resolution:2160},allowed:true}],formatItems:[{format:1,score:5},{format:2,score:-10000}],minFormatScore:1};
test('connection forbids embedded credentials, query, unsafe root and empty key',()=>{
 const c={url:'http://radarr:7878/base',apiKey:'secret',mediaRoot:'/media/movies',preferCzechEnglish:true};assert.equal(validateConnection(c).url,c.url);
 for(const patch of [{url:'http://user:pass@radarr'},{url:'http://radarr/?key=secret'},{mediaRoot:'/media/../movies'},{mediaRoot:'/'},{apiKey:''},{preferCzechEnglish:'yes'}])assert.throws(()=>validateConnection({...c,...patch}));
});
test('exact release matching escapes regex and catches obfuscation, never other groups',()=>{
 const title='A.Movie.2026.1080p.REMUX-GROUP',re=new RegExp(titleRegex(title),'i');
 for(const v of [title,title+'.mkv',title+'-Obfuscated',title+'-Obfuscated.mkv',title+'-Scrambled'])assert(re.test(v));
 for(const v of ['B.Movie.2026.1080p.REMUX-GROUP',title+'-OTHER','A_Movie_2026_1080p_REMUX-GROUP'])assert(!re.test(v));
});
test('profile permits same/higher, blocks lower and retains original format penalties',()=>{
 const p=replacementProfile(profile,{id:2,resolution:1080,movieId:42},10,11);assert.deepEqual(p.items.map(v=>v.allowed),[false,true,true]);assert.equal(p.formatItems.find(v=>v.format===2).score,-10000);assert.equal(p.formatItems.find(v=>v.format===10).score,-10000);assert.equal(p.formatItems.find(v=>v.format===11).score,100);assert.equal(profile.items[0].allowed,true);assert(!('id'in p));
});
test('profile rejects missing/current-disallowed qualities and excessive positive scores',()=>{
 assert.throws(()=>replacementProfile(profile,{id:999},10,11));
 assert.throws(()=>replacementProfile({...profile,items:profile.items.map(v=>({...v,allowed:false}))},{id:2},10,11));
 assert.throws(()=>replacementProfile({...profile,formatItems:[{format:1,score:10000}]},{id:2},10,11));
});
test('group members below current resolution are disabled',()=>{
 const p=replacementProfile({...profile,items:[{id:4,allowed:true,items:[{quality:{id:1,resolution:720},allowed:true},{quality:{id:2,resolution:1080},allowed:true}]}]},{id:2,resolution:1080},10,null);assert.deepEqual(p.items[0].items.map(v=>v.allowed),[false,true]);
});
test('mapping rejects ambiguity, size mismatch, path traversal, unmonitored and missing release name',()=>{
 const m={id:42,path:'/rad/movies/Film',monitored:true,movieFileId:7,movieFile:{id:7,path:'/rad/movies/Film/a.mkv',size:4,sceneName:'release'}};assert.equal(matchMovie([m],'/rad/movies','Film/a.mkv',4).id,42);
 for(const [movies,relative,size]of [[[m,m],'Film/a.mkv',4],[[m],'../Film/a.mkv',4],[[m],'Film/a.mkv',5],[[{...m,monitored:false}],'Film/a.mkv',4],[[{...m,movieFile:{...m.movieFile,sceneName:''}}],'Film/a.mkv',4]])assert.throws(()=>matchMovie(movies,'/rad/movies',relative,size));
});
test('restart permits observation only, never repeats mutating phases',()=>{
 for(const phase of ['waiting','imported','restored','manual'])assert(canResume({phase}));
 for(const phase of ['search_intent','quarantine_intent','queue_intent','restore_intent','preparing'])assert(!canResume({phase}));
});
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-radarr-test-')),data=path.join(root,'data'),media=path.join(root,'media'),review=path.join(root,'review');
 for(const p of [data,path.join(media,'Film'),path.join(review,'PROD/Film')])await fs.mkdir(p,{recursive:true});
 const source=path.join(media,'Film/a.mkv'),output=path.join(review,'PROD/Film/a.mkv');await fs.writeFile(source,'ORIGINAL');await fs.writeFile(output,'TRANSCODE');
 const hash=s=>crypto.createHash('sha256').update(s).digest('hex');const fp=s=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
 const safeFile=async(root,relative)=>{const p=path.join(root,relative),stat=await fs.stat(p);return {path:p,stat,fp:fp(stat)}};
 const atomicJSON=async(p,v)=>{await fs.writeFile(p+'.tmp',JSON.stringify(v));await fs.rename(p+'.tmp',p)};
 const movie={id:42,path:'/rad/movies/Film',monitored:true,qualityProfileId:6,movieFileId:7,movieFile:{id:7,path:'/rad/movies/Film/a.mkv',size:8,sceneName:'Film.2026.1080p.REMUX-GROUP',quality:{quality:{id:2,resolution:1080,name:'Bluray-1080p'}}}};
 let formats=[],profiles=[structuredClone(profile)],queue=[],calls=[],failSearch=false,pauseFail=false,resumes=0;const commands=new Map();
 const server=http.createServer(async(req,res)=>{let body='';for await(const b of req)body+=b;body=body?JSON.parse(body):undefined;const u=new URL(req.url,'http://localhost');calls.push({method:req.method,path:u.pathname,body});let out;
  if(req.headers['x-api-key']!=='secret'){res.writeHead(401);res.end('{}');return;}
  if(u.pathname==='/api/v3/system/status')out={version:'fixture'};
  else if(u.pathname==='/api/v3/movie')out=[movie];
  else if(u.pathname==='/api/v3/movie/42'){if(req.method==='PUT')Object.assign(movie,body);out=movie;}
  else if(u.pathname==='/api/v3/queue')out={records:queue};
  else if(u.pathname==='/api/v3/customformat'){if(req.method==='POST'){out={...body,id:100+formats.length};formats.push(out)}else out=formats;}
  else if(u.pathname==='/api/v3/qualityprofile'){out={...body,id:200+profiles.length};profiles.push(out);}
  else if(u.pathname.startsWith('/api/v3/qualityprofile/'))out=profiles.find(v=>v.id===Number(u.pathname.split('/').at(-1)));
  else if(u.pathname==='/api/v3/command'){
   if(failSearch&&body.name==='MoviesSearch'){res.writeHead(503);res.end('{}');return;}
   out={id:300+commands.size,status:'completed',message:'fixture'};commands.set(out.id,out);if(body.name==='RescanMovie'){movie.movieFileId=0;delete movie.movieFile;}
  }else if(u.pathname.startsWith('/api/v3/command/'))out=commands.get(Number(u.pathname.split('/').at(-1)));
  else {res.writeHead(404);res.end('{}');return;}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(out));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+server.address().port;await atomicJSON(path.join(data,'radarr.json'),{url,apiKey:'secret',mediaRoot:'/rad/movies',preferCzechEnglish:true});
 const cfg={mediaRoot:media,reviewRoot:review,libraryId:'library',sourceRoots:['/media/movies']},tdcalls=[];
 let tdrow=null;const service=createReplacement({data,getConfig:()=>cfg,safeFile,hash,atomicJSON,tdarr:async(p,b)=>{tdcalls.push({p,b});if(p==='/api/v2/cruddb')return tdrow;if(p==='/api/v2/rescan-file')tdrow={_id:b._id,DB:b.DB,TranscodeDecisionMaker:'Queued'};return 'OK'},pauseDispatch:async()=>{if(pauseFail)throw Error('worker busy')},resume:async()=>{resumes++},onProgress:()=>{}});
 const a=await safeFile(media,'Film/a.mkv'),b=await safeFile(review,'PROD/Film/a.mkv');const item={id:'a'.repeat(24),title:'Film',relative:'Film/a.mkv',reviewRelative:'PROD/Film/a.mkv',snapshot:hash(a.fp+'|'+b.fp)};
 return {service,item,source,output,data,media,review,movie,cfg,calls,tdcalls,formats,profiles,setQueue:q=>queue=q,setFailSearch:()=>failSearch=true,setPauseFail:()=>pauseFail=true,resumes:()=>resumes,cleanup:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true})}};
}
test('manual replacement preserves both exact files and never deletes current media through Radarr',async()=>{
 const f=await fixture();try{const result=await f.service.run(f.item,'Vadný originální zvuk');assert.equal(result.phase,'waiting');assert.equal(f.movie.movieFileId,0);assert.equal(f.resumes(),1);const journal=JSON.parse(await fs.readFile(path.join(f.data,'radarr-replacements',result.id+'.json')));assert.equal(await fs.readFile(journal.originalQuarantine,'utf8'),'ORIGINAL');assert.equal(await fs.readFile(journal.reviewQuarantine,'utf8'),'TRANSCODE');assert.equal(journal.reason,'Vadný originální zvuk');assert(!f.calls.some(v=>v.method==='DELETE'));assert(!JSON.stringify(await f.service.publicSettings()).includes('secret'));assert(!JSON.stringify(await f.service.list()).includes('secret'));assert.equal(f.formats[1].specifications.filter(v=>v.required).length,2);assert.deepEqual(f.profiles.at(-1).items.map(v=>v.allowed),[false,true,true]);}finally{await f.cleanup()}
});
test('changed source snapshot or existing Radarr download stops before any external mutation',async()=>{
 for(const mode of ['changed','download']){const f=await fixture();try{if(mode==='changed')f.item.snapshot='stale';else f.setQueue([{movieId:42}]);await assert.rejects(()=>f.service.run(f.item,'reason'));assert(!f.calls.some(v=>v.method!=='GET'));assert.equal(await fs.readFile(f.source,'utf8'),'ORIGINAL');assert.equal(await fs.readFile(f.output,'utf8'),'TRANSCODE');}finally{await f.cleanup()}}
});
test('active Tdarr worker stops before profile changes and retains both files',async()=>{
 const f=await fixture();try{f.setPauseFail();await assert.rejects(()=>f.service.run(f.item,'reason'),/worker busy/);assert(!f.calls.some(v=>v.method!=='GET'));assert.equal(await fs.readFile(f.source,'utf8'),'ORIGINAL');assert.equal((await f.service.list())[0].phase,'manual');assert.equal(f.resumes(),1);}finally{await f.cleanup()}
});
test('failed search keeps quarantine and durable manual status; restart never retries search',async()=>{
 const f=await fixture();try{f.setFailSearch();await assert.rejects(()=>f.service.run(f.item,'reason'),/503/);const c=(await f.service.list())[0];assert.equal(c.phase,'manual');const requestsBefore=f.calls.length;await f.service.recover();await f.service.observe();assert.equal(f.calls.length,requestsBefore);const j=JSON.parse(await fs.readFile(path.join(f.data,'radarr-replacements',c.id+'.json')));assert.equal(await fs.readFile(j.originalQuarantine,'utf8'),'ORIGINAL');}finally{await f.cleanup()}
});
test('restore returns both files and original profile, refuses a pending download',async()=>{
 const f=await fixture();try{const c=await f.service.run(f.item,'reason');f.setQueue([{movieId:42}]);await assert.rejects(()=>f.service.restore(c.id));f.setQueue([]);const r=await f.service.restore(c.id);assert.equal(r.phase,'restored');assert.equal(await fs.readFile(f.source,'utf8'),'ORIGINAL');assert.equal(await fs.readFile(f.output,'utf8'),'TRANSCODE');assert.equal(f.movie.qualityProfileId,6);}finally{await f.cleanup()}
});
test('import queues a stable new file once, leaves quarantine intact',async()=>{
 const f=await fixture();try{const c=await f.service.run(f.item,'reason');const file=path.join(f.media,'Film/new.mkv');await fs.writeFile(file,'REPLACEMENT');const old=new Date(Date.now()-700000);await fs.utimes(file,old,old);f.movie.movieFileId=8;f.movie.movieFile={id:8,path:'/rad/movies/Film/new.mkv',size:11,sceneName:'Film.2026.1080p.REMUX-OTHER',quality:{quality:{name:'Bluray-1080p'}},languages:[{name:'Czech'},{name:'English'}]};await f.service.observe();assert.equal((await f.service.list())[0].phase,'imported');assert.equal(f.tdcalls.filter(v=>v.p==='/api/v2/rescan-file').length,1);await f.service.observe();assert.equal(f.tdcalls.filter(v=>v.p==='/api/v2/rescan-file').length,1);const j=JSON.parse(await fs.readFile(path.join(f.data,'radarr-replacements',c.id+'.json')));assert.equal(await fs.readFile(j.originalQuarantine,'utf8'),'ORIGINAL');}finally{await f.cleanup()}
});
test('observer does not dispatch the same bad release or a fresh incomplete file',async()=>{
 for(const mode of ['same','fresh']){const f=await fixture();try{await f.service.run(f.item,'reason');const file=path.join(f.media,'Film/new.mkv');await fs.writeFile(file,'REPLACEMENT');f.movie.movieFileId=8;f.movie.movieFile={id:8,path:'/rad/movies/Film/new.mkv',size:11,sceneName:mode==='same'?'Film.2026.1080p.REMUX-GROUP':'Film.2026.1080p.REMUX-OTHER'};await f.service.observe();assert.equal((await f.service.list())[0].phase,'waiting');assert(!f.tdcalls.some(v=>v.p==='/api/v2/rescan-file'));}finally{await f.cleanup()}}
});
test('restore handles a partially failed quarantine without overwriting the unmoved original',async()=>{
 const f=await fixture(),rename=fs.rename;
 try{
  fs.rename=async(source,dest)=>{if(source===f.source)throw Object.assign(Error('EXDEV fixture'),{code:'EXDEV'});return rename(source,dest)};
  await assert.rejects(()=>f.service.run(f.item,'reason'),/EXDEV/);fs.rename=rename;
  assert.equal(await fs.readFile(f.source,'utf8'),'ORIGINAL');await assert.rejects(()=>fs.stat(f.output),{code:'ENOENT'});
  assert.equal(f.calls.filter(c=>c.body?.name==='MoviesSearch').length,0);
  const r=await f.service.restore((await f.service.list())[0].id);assert.equal(r.phase,'restored');assert.equal(await fs.readFile(f.output,'utf8'),'TRANSCODE');assert.equal(await fs.readFile(f.source,'utf8'),'ORIGINAL');
 }finally{fs.rename=rename;await f.cleanup()}
});
test('profile cutoff is moved to an allowed same quality and custom formats are not duplicated',()=>{
 const p=replacementProfile({...profile,cutoff:1,formatItems:[...profile.formatItems,{format:10,score:0},{format:11,score:0}]},{id:2,resolution:1080},10,11);assert.equal(p.cutoff,2);assert.equal(p.formatItems.filter(v=>v.format===10).length,1);assert.equal(p.formatItems.find(v=>v.format===10).score,-10000);
});
