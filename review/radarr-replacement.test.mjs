import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {validateConnection,matchMovie,titleRegex,replacementProfile,canResume,createReplacement} from './radarr-replacement.mjs';
import {publishApproval} from './quarantine-retention.mjs';
import {classifyRecovery} from './public/review-model.js';
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
 let tdrow=null,tdfailure=null;const service=createReplacement({data,getConfig:()=>cfg,safeFile,hash,atomicJSON,tdarr:async(p,b)=>{tdcalls.push({p,b});if(p==='/api/v2/cruddb'){if(tdfailure)throw tdfailure;return tdrow;}if(p==='/api/v2/rescan-file')tdrow={_id:b._id,DB:b.DB,TranscodeDecisionMaker:'Queued'};return 'OK'},pauseDispatch:async()=>{if(pauseFail)throw Error('worker busy')},resume:async()=>{resumes++},onProgress:()=>{}});
 const a=await safeFile(media,'Film/a.mkv'),b=await safeFile(review,'PROD/Film/a.mkv');const item={id:'a'.repeat(24),title:'Film',relative:'Film/a.mkv',reviewRelative:'PROD/Film/a.mkv',snapshot:hash(a.fp+'|'+b.fp)};
 return {service,item,source,output,data,media,review,movie,cfg,calls,tdcalls,formats,profiles,atomicJSON,setTdrow:row=>tdrow=row,setTdfailure:error=>tdfailure=error,setQueue:q=>queue=q,setFailSearch:()=>failSearch=true,setPauseFail:()=>pauseFail=true,resumes:()=>resumes,cleanup:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true})}};
}
async function importedFixture(){
 const f=await fixture(),c=await f.service.run(f.item,'reason'),file=path.join(f.media,'Film/new.mkv');
 await fs.writeFile(file,'REPLACEMENT');const old=new Date(Date.now()-700000);await fs.utimes(file,old,old);
 f.movie.movieFileId=8;f.movie.movieFile={id:8,path:'/rad/movies/Film/new.mkv',size:11,sceneName:'Film.2026.1080p.REMUX-OTHER',quality:{quality:{name:'Bluray-1080p'}},languages:[{name:'English'}]};
 await f.service.observe();
 const journal=path.join(f.data,'radarr-replacements',c.id+'.json');
 return {...f,file,journal,readJournal:async()=>JSON.parse(await fs.readFile(journal,'utf8'))};
}

test('Recovery overview reads supervisor runtime from Review data independently of Radarr configuration',async()=>{
 const f=await fixture();
 try{
  await fs.rm(path.join(f.data,'radarr.json'));
  assert.deepEqual((await f.service.overview()).recoveryRuntime,{present:false,mode:'off',state:'off',reason:null});
  const runtime={version:1,mode:'invalid',state:'refused',restarts:0,lastExitCode:78,lastExitSignal:null,lastStartedAt:null,lastExitedAt:'2026-10-14T12:00:00.000Z',updated:'2026-10-14T12:00:00.000Z',reason:'invalid-mode'};
  await fs.mkdir(path.join(f.data,'recovery'));await fs.writeFile(path.join(f.data,'recovery','runtime-state.json'),JSON.stringify({...runtime,apiKey:'SECRET'}));
  const overview=await f.service.overview();
  assert.deepEqual(overview.recoveryRuntime,{present:true,...runtime});assert.deepEqual(overview.requests,[]);
  assert.doesNotMatch(JSON.stringify(overview),/SECRET|apiKey/);
  await fs.writeFile(path.join(f.data,'recovery','runtime-state.json'),'{broken');
  assert.deepEqual((await f.service.overview()).recoveryRuntime,{present:true,state:'unreadable',reason:null});
  assert.deepEqual(await f.service.list(),[],'runtime failure does not prevent loading cases');
 }finally{await f.cleanup()}
});
test('Review preserves per-case Recovery freshness instead of replacing it with another case heartbeat',async()=>{
 const f=await fixture();try{
  const now=Date.now(),old=new Date(now-20*60000).toISOString(),fresh=new Date(now).toISOString(),file=path.join(path.dirname(f.media),'.tdarr-recovery-status.json');
  await f.atomicJSON(file,{version:1,updated:fresh,cases:[{id:'b'.repeat(24),phase:'replacement_imported',tdarrStatus:'Queued',statusUpdated:old},{id:'c'.repeat(24),phase:'verifying',statusUpdated:null,heartbeatAt:fresh,progress:{stage:'original_decode',pass:1,seconds:20}}]});
  const records=await f.service.list();assert.equal(records[0].statusUpdated,old);assert.equal(classifyRecovery(records[0],now).stale,true);assert.equal(records[1].statusUpdated,null);assert.equal(records[1].progress.seconds,20);
  await f.atomicJSON(file,{version:1,updated:old,cases:[{id:'b'.repeat(24),phase:'replacement_imported',tdarrStatus:'Queued'}]});assert.equal((await f.service.list())[0].statusUpdated,old,'legacy snapshots use their own whole-file time');
 }finally{await f.cleanup();}
});
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

test('imported lifecycle follows exact Tdarr status using reads only; success is not approval',async()=>{
 const f=await importedFixture();try{
  const beforeTd=f.tdcalls.length,beforeRad=f.calls.length;
  for(const status of ['Queued','Transcoding','Transcode success','Transcode error','Not required','Hold']){
   f.setTdrow({_id:'/media/movies/Film/new.mkv',DB:'library',TranscodeDecisionMaker:status});
   await f.service.observe();const c=(await f.service.list())[0];
   assert.equal(c.phase,'imported');assert.equal(c.tdarrStatus,status);assert.equal(c.error,null);assert(Number.isFinite(Date.parse(c.statusUpdated)));
   assert(c.pipelineLabel);assert(!/schválena/.test(c.pipelineLabel));
   assert.equal(c.approvedAt,null);assert.equal(c.deleteAfter,null);assert.equal(c.cleanupComplete,false);assert.equal(c.quarantineRetained,true);
   assert.notEqual(classifyRecovery(c).category,'done');
  }
  assert.equal(f.calls.length,beforeRad,'imported observation performs no Radarr requests');
  assert.equal(f.tdcalls.length-beforeTd,6);
  for(const call of f.tdcalls.slice(beforeTd))assert.deepEqual(call,{p:'/api/v2/cruddb',b:{collection:'FileJSONDB',mode:'getById',docID:'/media/movies/Film/new.mkv'}});
 }finally{await f.cleanup()}
});

test('missing, malformed, wrong-file/library and unknown imported states stay visible without queue writes',async()=>{
 const f=await importedFixture();try{
  const before=f.tdcalls.length;
  for(const row of [null,'OK',[],{_id:'/media/movies/Film/other.mkv',DB:'library',TranscodeDecisionMaker:'Queued'},{_id:'/media/movies/Film/new.mkv',DB:'other',TranscodeDecisionMaker:'Queued'},{_id:'/media/movies/Film/new.mkv',DB:'library',TranscodeDecisionMaker:'unknown'}]){
   f.setTdrow(row);await f.service.observe();const c=(await f.service.list())[0];
   assert.equal(c.phase,'imported');assert.equal(c.tdarrStatus,null);assert(c.observationError);assert.equal(classifyRecovery(c).category,'attention');assert.equal(c.cleanupComplete,false);
  }
  assert(f.tdcalls.slice(before).every(call=>call.p==='/api/v2/cruddb'));
  const journal=await f.readJournal();assert.equal(await fs.readFile(journal.originalQuarantine,'utf8'),'ORIGINAL');
 }finally{await f.cleanup()}
});

test('changed source root/library or unsafe replacement path does not query or mutate Tdarr',async()=>{
 const f=await importedFixture();try{
  const original=await f.readJournal(),before=f.tdcalls.length;
  for(const patch of [{libraryId:'other'},{libraryId:null},{tdarrSource:null},{tdarrSource:'/different/Film/a.mkv'},{replacementRelative:null},{replacementRelative:'../Film/new.mkv'},{replacementRelative:'/Film/new.mkv'},{replacementRelative:'Film\\new.mkv'}]){
   await f.atomicJSON(f.journal,{...original,...patch});await f.service.observe();
   const c=(await f.service.list())[0];assert(c.error);assert.equal(c.tdarrStatus,null);assert.equal(c.phase,'imported');
  }
  assert.equal(f.tdcalls.length,before);
 }finally{await f.cleanup()}
});

test('temporary imported observation failure clears after a verified read, without replaying handoff',async()=>{
 const f=await importedFixture();try{
  const before=f.tdcalls.length;f.setTdfailure(Error('Tdarr timeout'));await f.service.observe();let c=(await f.service.list())[0];
  assert.match(c.observationError,/timeout/);assert.equal(c.tdarrStatus,null);assert.equal(classifyRecovery(c).category,'attention');
  f.setTdfailure(null);f.setTdrow({_id:'/media/movies/Film/new.mkv',DB:'library',TranscodeDecisionMaker:'Transcoding'});await f.service.observe();c=(await f.service.list())[0];
  assert.equal(c.observationError,null);assert.equal(c.error,null);assert.equal(c.tdarrStatus,'Transcoding');assert.equal(classifyRecovery(c).category,'running');
  assert(!c.message.includes('timeout'));assert.equal(c.pipelineLabel,'Tdarr převádí náhradu');
  assert(f.tdcalls.slice(before).every(call=>call.p==='/api/v2/cruddb'));
 }finally{await f.cleanup()}
});

test('successful imported observation clears obsolete download progress and ignores a historic failed search',async()=>{
 const f=await importedFixture();try{
  const journal=await f.readJournal();journal.queue=[{title:'old download',status:'failed',percent:10,error:'old error'}];journal.search={id:1,status:'failed',message:'old search failed'};await f.atomicJSON(f.journal,journal);
  await f.service.observe();const c=(await f.service.list())[0];assert.deepEqual(c.queue,[]);assert.equal(c.search,null);assert.equal(c.tdarrStatus,'Queued');assert.equal(classifyRecovery(c).category,'running');assert.equal((await f.readJournal()).search.status,'failed','private search evidence is retained');
 }finally{await f.cleanup()}
});

test('waiting import identity error is structured and clears after a stable valid import',async()=>{
 const f=await fixture();try{
  await f.service.run(f.item,'reason');const file=path.join(f.media,'Film/new.mkv');await fs.writeFile(file,'REPLACEMENT');const old=new Date(Date.now()-700000);await fs.utimes(file,old,old);
  f.movie.movieFileId=8;f.movie.movieFile={id:8,path:'/rad/movies/Film/new.mkv',size:11,sceneName:'Film.2026.1080p.REMUX-GROUP'};
  await f.service.observe();let c=(await f.service.list())[0];assert(c.observationError);assert.equal(classifyRecovery(c).category,'attention');
  f.movie.movieFile.sceneName='Film.2026.1080p.REMUX-OTHER';await f.service.observe();c=(await f.service.list())[0];assert.equal(c.phase,'imported');assert.equal(c.error,null);assert.equal(c.tdarrStatus,'Queued');
 }finally{await f.cleanup()}
});

test('public lifecycle allowlists nested fields and omits private paths and cleanup file journals',async()=>{
 const f=await importedFixture();try{
  const c=await f.readJournal();Object.assign(c,{apiKey:'SECRET',observationError:`ENOENT: realpath '${f.file}'`,queue:[{title:'release',status:'downloading',percent:50,timeleft:'00:01',error:`open '${f.source}'`,apiKey:'SECRET'}],search:{id:1,status:'completed',message:'done',apiKey:'SECRET'},replacement:{title:'release',quality:'HD',languages:['English'],bytes:11,path:'/PRIVATE/replacement',apiKey:'SECRET'},cleanup:{approvedAt:new Date().toISOString(),deleteAfter:new Date(Date.now()+7*86400000).toISOString(),files:[{path:'/PRIVATE/quarantine',fp:'SECRET'}]}});
  await f.atomicJSON(f.journal,c);const output=JSON.stringify((await f.service.list())[0]);
  for(const privateValue of ['SECRET','/PRIVATE/',f.file,f.source,'originalFP','replacementSourceFP','originalProfile','files'])assert(!output.includes(privateValue),privateValue);
  assert.match(output,/soukromá cesta/);assert.match(output,/approvedAt/);assert.match(output,/deleteAfter/);
 }finally{await f.cleanup()}
});

test('only actual approval evidence publishes seven-day retention; cleanup transitions to done',async()=>{
 const f=await importedFixture();try{
  await f.service.cleanup();let c=(await f.service.list())[0];assert.equal(c.approvedAt,null);assert.equal(c.deleteAfter,null);assert.notEqual(classifyRecovery(c).category,'done');
  const journal=await f.readJournal();await fs.writeFile(f.file,'APPROVED');
  const approval=await publishApproval({mediaRoot:f.media,relative:journal.replacementRelative,sourceFP:journal.replacementSourceFP,installedRelative:journal.replacementRelative,atomic:f.atomicJSON});
  await f.service.cleanup();c=(await f.service.list())[0];assert.equal(c.approvedAt,approval.approvedAt);assert.equal(Date.parse(c.deleteAfter)-Date.parse(c.approvedAt),7*86400000);assert.equal(c.cleanupComplete,false);assert.equal(c.quarantineRetained,true);assert.equal(classifyRecovery(c).category,'done');
  assert.match(c.pipelineLabel,/schválena.*čeká/);
  const expired=new Date(Date.now()-8*86400000).toISOString(),approvalDirectory=path.join(path.dirname(f.media),'.tdarr-approvals'),approvalFile=path.join(approvalDirectory,(await fs.readdir(approvalDirectory))[0]);
  await f.atomicJSON(approvalFile,{...approval,approvedAt:expired});const state=await f.readJournal();delete state.cleanup;await f.atomicJSON(f.journal,state);
  await f.service.cleanup();c=(await f.service.list())[0];assert.equal(c.cleanupComplete,true);assert.equal(c.quarantineRetained,false);assert.equal(classifyRecovery(c).category,'done');
  assert.match(c.pipelineLabel,/karanténa uklizena/);
  await assert.rejects(()=>fs.stat(journal.originalQuarantine),{code:'ENOENT'});await assert.rejects(()=>fs.stat(journal.reviewQuarantine),{code:'ENOENT'});assert.equal(await fs.readFile(f.file,'utf8'),'APPROVED');
  const before=f.tdcalls.length;await f.service.observe();assert.equal(f.tdcalls.length,before,'completed retention does not resume observation of a closed case');
 }finally{await f.cleanup()}
});

test('retention identity errors stay public and clear when exact approved identity is restored',async()=>{
 const f=await importedFixture();try{
  const journal=await f.readJournal(),approval=await publishApproval({mediaRoot:f.media,relative:journal.replacementRelative,sourceFP:journal.replacementSourceFP,installedRelative:journal.replacementRelative,atomic:f.atomicJSON});
  const approvalDirectory=path.join(path.dirname(f.media),'.tdarr-approvals'),approvalFile=path.join(approvalDirectory,(await fs.readdir(approvalDirectory))[0]);
  await f.atomicJSON(approvalFile,{...approval,installedFP:'changed'});await f.service.cleanup();let c=(await f.service.list())[0];assert.match(c.retentionError,/changed/);assert.equal(classifyRecovery(c).category,'attention');assert.equal(c.deleteAfter,null);
  await f.atomicJSON(approvalFile,approval);await f.service.cleanup();c=(await f.service.list())[0];assert.equal(c.retentionError,null);assert.equal(c.error,null);assert.equal(c.approvedAt,approval.approvedAt);assert.equal(classifyRecovery(c).category,'done');assert.equal(await fs.readFile(journal.originalQuarantine,'utf8'),'ORIGINAL');
 }finally{await f.cleanup()}
});

test('Recovery restart notice leaves the server with only its safe fields, and full-hash progress passes through',async()=>{
 const f=await fixture();try{
  const file=path.join(path.dirname(f.media),'.tdarr-recovery-status.json'),fresh=new Date().toISOString();
  assert.equal(await f.service.recoveryConfig(),null,'no status file: no notice');
  await f.atomicJSON(file,{version:1,updated:fresh,configChange:null,cases:[]});assert.equal(await f.service.recoveryConfig(),null);
  await f.atomicJSON(file,{version:1,updated:fresh,configChange:{detectedAt:'2026-10-13T10:00:00.000Z',restartRequired:true,valid:false,error:'config.json is not valid JSON'.padEnd(400,'x'),digest:'secret-digest'},cases:[{id:'d'.repeat(24),phase:'confirmed',fullHash:{stage:'confirmation',done:5,total:10,started:fresh,updated:fresh}}]});
  const notice=await f.service.recoveryConfig();
  assert.deepEqual(Object.keys(notice).sort(),['detectedAt','error','restartRequired','valid']);assert.equal(notice.valid,false);assert.equal(notice.error.length,300);assert.ok(!JSON.stringify(notice).includes('secret-digest'));
  assert.deepEqual((await f.service.list()).find(r=>r.id==='d'.repeat(24)).fullHash,{stage:'confirmation',done:5,total:10,started:fresh,updated:fresh});
  await f.atomicJSON(file,{version:1,updated:fresh,configChange:{detectedAt:'not a date',restartRequired:true,valid:true,error:null},cases:[]});
  assert.deepEqual(await f.service.recoveryConfig(),{detectedAt:null,restartRequired:true,valid:true,error:null});
  await fs.writeFile(file,'{broken');assert.equal(await f.service.recoveryConfig(),null,'an unreadable status file never breaks the request list');
 }finally{await f.cleanup();}
});

test('the request list and the restart notice come from one status-file snapshot',async()=>{
 const f=await fixture();try{
  const file=path.join(path.dirname(f.media),'.tdarr-recovery-status.json'),fresh=new Date().toISOString();
  await f.atomicJSON(file,{version:1,updated:fresh,configChange:{detectedAt:fresh,restartRequired:true,valid:true,error:null},cases:[{id:'e'.repeat(24),phase:'confirmed'}]});
  const overview=await f.service.overview();
  assert.deepEqual(overview.requests.map(r=>r.id),['e'.repeat(24)]);assert.equal(overview.recoveryConfig.restartRequired,true);
  assert.deepEqual(await f.service.list(),overview.requests);
  await fs.writeFile(file,'{broken');await assert.rejects(f.service.overview(),'a corrupt status file is still reported, as before');
  // GET /api/radarr/requests serves this overview: server-wiring-http.test.mjs.
 }finally{await f.cleanup();}
});

test('Review preserves Verify pause and original-location fields from the shared status',async()=>{
 const f=await fixture();try{
  const fields={verifyPausedStep:'tdarr_handoff',originalOutsideLibrary:true,originalOutsideSince:'2026-10-13T10:00:00.000Z',originalRestoredAt:null};
  await f.atomicJSON(path.join(path.dirname(f.media),'.tdarr-recovery-status.json'),{version:1,updated:new Date().toISOString(),cases:[{id:'b'.repeat(24),phase:'replacement_queue_intent',...fields}]});
  const record=(await f.service.overview()).requests[0];
  for(const [key,value]of Object.entries(fields))assert.equal(record[key],value,key);
 }finally{await f.cleanup();}
});
