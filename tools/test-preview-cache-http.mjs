import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {command,sha256} from '../review/core.mjs';
import {defaults} from '../review/config.mjs';

// Real decoders, disposable media/database, loopback mock only. No production
// service, library replacement, or manual confirmation is used by this test.
const root=await fs.mkdtemp(path.join(os.tmpdir(),'preview-cache-http-'));
const ffmpeg=process.env.FFMPEG||'/usr/bin/ffmpeg',ffprobe=process.env.FFPROBE||'/usr/bin/ffprobe';
const directory=path.join(root,'data/preview-cache'),statefile=path.join(root,'data/state.json');
let child,stderr='',cookie='';
const mutations=[];
const mock=http.createServer(async(req,res)=>{
 if(req.url==='/api/v2/get-nodes'){res.setHeader('content-type','application/json');res.end(JSON.stringify({fixture:{_id:'fixture',nodeName:'cache-fixture',nodePaused:false,workers:{}}}));return}
 mutations.push(req.url);res.writeHead(404);res.end('{}');
});
await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
const reserve=http.createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));
const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
const base='http://127.0.0.1:'+port;
const entry=process.env.REVIEW_SERVER||fileURLToPath(new URL('../review/server.mjs',import.meta.url));
const delay=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
async function stop(){
 if(!child)return;
 const process=child;child=null;
 if(process.exitCode!==null||process.signalCode!==null)return;
 const closed=new Promise(resolve=>process.once('close',resolve));process.kill('SIGTERM');await closed;
}
async function start(){
 stderr='';child=spawn(process.execPath,[entry],{env:{...process.env,DATA_ROOT:path.join(root,'data'),PORT:String(port)},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',()=>{});child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-32000)});
 for(let attempt=0;attempt<150;attempt++){
  assert.equal(child.exitCode,null,'Review fixture exited: '+stderr);
  try{if((await fetch(base)).ok)return}catch{}
  await delay(100);
 }
 assert.fail('Review fixture did not start: '+stderr);
}
const post=(route,body)=>fetch(base+route,{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify(body)});
async function read(route){const response=await fetch(base+route,{headers:{cookie}});assert.equal(response.status,200,route+': '+await response.clone().text()+' '+stderr);return response.json()}
async function posted(route,body,status=200){const response=await post(route,body);assert.equal(response.status,status,route+': '+await response.clone().text()+' '+stderr);return response.json()}
async function settings(config){
 for(let attempt=0;attempt<100;attempt++){
  const current=await read('/api/preview-settings'),response=await post('/api/preview-settings',{revision:current.revision,config});
  if(response.status===409){await delay(100);continue}
  assert.equal(response.status,200,await response.clone().text());return response.json();
 }
 assert.fail('Preview settings did not become writable: '+stderr);
}
async function artifacts(){
 const names=(await fs.readdir(directory)).sort(),result=[];
 for(const name of names){assert.match(name,/^[a-f0-9]{64}\.json$/,'cache must contain only complete owned artifacts');const stat=await fs.lstat(path.join(directory,name));assert(stat.isFile()&&!stat.isSymbolicLink());if(process.platform!=='win32')assert.equal(stat.mode&0o777,0o600);result.push({name,size:stat.size,mtime:stat.mtimeMs})}
 return result;
}
function unchecked(record){assert.equal(record.complete,false);assert(Object.values(record.session.checks).every(value=>value===false),'previews must not confirm checks');assert.deepEqual(record.observations,{})}

try{
 for(const relative of ['media/Film','review/PROD-Movies/Film','data'])await fs.mkdir(path.join(root,relative),{recursive:true});
 const original=path.join(root,'media/Film/Film.mkv'),review=path.join(root,'review/PROD-Movies/Film/Film.mkv');
 await command(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i','sine=frequency=440','-t','14','-c:v','libx264','-threads','1','-crf','0','-bf','0','-c:a','pcm_s16le','-metadata:s:a:0','language=eng',original]);
 await command(ffmpeg,['-v','error','-i',original,'-c:v','libx265','-x265-params','pools=1:frame-threads=1:bframes=0','-pix_fmt','yuv420p10le','-crf','30','-c:a','copy',review]);
 await fs.utimes(review,new Date(Date.now()-300000),new Date(Date.now()-300000));
 const originalHash=await sha256(original),reviewHash=await sha256(review);
 const dbpath=path.join(root,'tdarr.db'),db=new DatabaseSync(dbpath);
 db.exec('CREATE TABLE jobsjsondb (json_data TEXT); CREATE TABLE librarysettingsjsondb (json_data TEXT)');
 db.prepare('INSERT INTO librarysettingsjsondb VALUES (?)').run(JSON.stringify({_id:'fixture-library',folder:'/media/movies'}));
 db.prepare('INSERT INTO jobsjsondb VALUES (?)').run(JSON.stringify({_id:'fixture-job',DB:'fixture-library',file:'/media/movies/Film/Film.mkv',status:'Transcode success',end:Date.now(),fileSizeStartGB:(await fs.stat(original)).size/2**30,fileSizeEndGB:(await fs.stat(review)).size/2**30}));db.close();
 await fs.writeFile(path.join(root,'data/settings.json'),JSON.stringify({...defaults({MEDIA_ROOT:path.join(root,'media'),REVIEW_ROOT:path.join(root,'review'),TDARR_DB:dbpath,TDARR_URL:'http://127.0.0.1:'+mock.address().port,PUBLIC_ORIGIN:base,FFMPEG:ffmpeg,FFPROBE:ffprobe}),sourceRoots:['/media/movies'],reviewPrefixes:['PROD-Movies'],libraryId:'fixture-library'}));
 await start();assert.equal((await fetch(base+'/api/preview-settings')).status,401);
 const key=await fs.readFile(path.join(root,'data/access-key'),'utf8'),login=await post('/api/login',{key});assert.equal(login.status,200,await login.clone().text());cookie=login.headers.get('set-cookie').split(';')[0];
 const initial=await read('/api/preview-settings');
 assert.deepEqual(initial.config,{enabled:true,maxMiB:4096,maxFilms:5,retentionDays:7,preferredAudioLanguages:['ces'],fallbackAudioLanguages:['eng','slk'],allowOtherAudioLanguages:true});assert.match(initial.revision,/^[a-f0-9]{64}$/);
 let preferences=await settings({...initial.config,enabled:false});
 assert.equal(preferences.config.enabled,false);
 await posted('/api/preview-settings',{revision:initial.revision,config:initial.config},409);
 await posted('/api/preview-settings',{revision:preferences.revision,config:{...preferences.config,maxMiB:31}},400);
 const list=await read('/api/items'),film=list.items.find(item=>item.title==='Film');assert(film&&film.status==='ready',JSON.stringify(list));unchecked(list.reviewSessions[film.id]);assert(list.previews[film.id]);
 const audioRoute=`/api/items/${film.id}/audio-compare`,framesRoute=`/api/items/${film.id}/frames`,statusRoute=`/api/items/${film.id}/preview-status?snapshot=${film.snapshot}`;
 const tracks=()=>posted(audioRoute,{snapshot:film.snapshot,mode:'tracks'});
 const initialTracks=await tracks();assert.equal(initialTracks.defaultScope.originalIndex,1);assert.equal(initialTracks.defaultScope.reviewIndex,1);assert.equal(initialTracks.preparation.chosenAudioLanguage,'eng','English must be selected through the configured fallback');
 assert.equal(initialTracks.original.length,1);assert.match(initialTracks.original[0].label,/eng/);

 // cachedOnly is a read: missing arbitrary times do not enqueue or run FFmpeg.
 const beforeMissing=(await read('/api/preview-settings')).stats;
 await posted(framesRoute,{snapshot:film.snapshot,seconds:0.5,cachedOnly:true},202);
 const arbitrary={snapshot:film.snapshot,seconds:0.5,originalIndex:1,reviewIndex:1,mode:'av',previewProfile:'compact'};
 await posted(audioRoute,{...arbitrary,cachedOnly:true},202);
 const afterMissing=(await read('/api/preview-settings')).stats;
 assert.equal(afterMissing.renders,beforeMissing.renders);assert.equal(afterMissing.queue,beforeMissing.queue);assert.equal(afterMissing.entries,0);assert.deepEqual(await artifacts(),[]);

 // Canonical language aliases and an unavailable automatic choice are settings,
 // not a manual track selection or a confirmation of image/audio quality.
 preferences=await settings({...preferences.config,preferredAudioLanguages:['cs','cze'],fallbackAudioLanguages:['en','English','sk']});
 assert.deepEqual(preferences.config.preferredAudioLanguages,['ces']);assert.deepEqual(preferences.config.fallbackAudioLanguages,['eng','slk']);
 preferences=await settings({...preferences.config,fallbackAudioLanguages:[],allowOtherAudioLanguages:false});
 let currentTracks=await tracks();assert.equal(currentTracks.defaultScope.originalIndex,null);assert.equal(currentTracks.defaultScope.reviewIndex,null);
 preferences=await settings({...preferences.config,fallbackAudioLanguages:['en','sk']});currentTracks=await tracks();assert.equal(currentTracks.defaultScope.originalIndex,1);assert.equal(currentTracks.defaultScope.reviewIndex,1);
 const draft=await posted(`/api/items/${film.id}/review-session`,{snapshot:film.snapshot,revision:0,session:{method:'review',device:'',step:0,checks:{preparation:false,image:false,audio:false,syncStart:false,syncMiddle:false,syncEnd:false,hdr:false},scope:{originalIndex:1,reviewIndex:1,seconds:null},note:'',deferred:false}});unchecked(draft);
 preferences=await settings({...preferences.config,preferredAudioLanguages:['ja'],fallbackAudioLanguages:[],allowOtherAudioLanguages:false});
 currentTracks=await tracks();assert.equal(currentTracks.defaultScope.originalIndex,1,'valid saved manual pair must survive preference changes');assert.equal(currentTracks.defaultScope.reviewIndex,1);unchecked((await read('/api/items')).reviewSessions[film.id]);
 preferences=await settings({...preferences.config,enabled:true,preferredAudioLanguages:['cs'],fallbackAudioLanguages:['en','sk'],allowOtherAudioLanguages:true});
 const evidence=async()=>{const state=JSON.parse(await fs.readFile(statefile,'utf8'));return {sessions:state.reviewSessions,history:state.history,info:state.items[film.id].info,audioSamples:state.items[film.id].audioSamples}};
 const beforePreparation=await evidence();assert.deepEqual(beforePreparation.audioSamples,[]);
 let preparation;
 const deadline=Date.now()+180000;
 do{
  preparation=(await read(statusRoute)).preparation;
  assert.notEqual(preparation.state,'error',JSON.stringify(preparation)+' '+stderr);
  if(preparation.total>0&&preparation.ready===preparation.total)break;
  assert(Date.now()<deadline,'background preparation timed out: '+JSON.stringify(preparation)+' '+stderr);await delay(200);
 }while(true);
 assert.deepEqual(await evidence(),beforePreparation,'background previews cannot mutate review evidence');
 for(const mode of ['frames','wave','listen','av'])assert(preparation.jobs.some(job=>job.mode===mode),'missing prepared mode '+mode);
 assert(preparation.jobs.some(job=>job.mode==='av'&&job.previewProfile==='detail'));assert.equal(preparation.chosenAudioLanguage,'eng');
 assert(!JSON.stringify(preparation).includes(root),'public preparation metadata must not disclose private paths');
 const preparedFiles=await artifacts();assert(preparedFiles.length>=preparation.total);if(process.platform!=='win32')assert.equal((await fs.stat(directory)).mode&0o777,0o700);
 const beforeHits=(await read('/api/preview-settings')).stats;
 const imageJob=preparation.jobs.find(job=>job.mode==='frames'),avJob=preparation.jobs.find(job=>job.mode==='av'&&job.previewProfile==='detail');
 const cachedImage=await posted(framesRoute,{snapshot:film.snapshot,seconds:imageJob.seconds,cachedOnly:true});assert.equal(cachedImage.cached,true);assert(cachedImage.original&&cachedImage.review);
 const cachedAV=await posted(audioRoute,{snapshot:film.snapshot,seconds:avJob.seconds,originalIndex:avJob.originalIndex,reviewIndex:avJob.reviewIndex,mode:'av',previewProfile:'detail',cachedOnly:true});assert.equal(cachedAV.cached,true);assert.equal(Buffer.from(cachedAV.original,'base64').toString('ascii',4,8),'ftyp');
 assert.equal((await read('/api/preview-settings')).stats.renders,beforeHits.renders);assert.deepEqual(await artifacts(),preparedFiles);

 // Arbitrary non-preset time is still available on demand and then cached.
 const framesFirst=await posted(framesRoute,{snapshot:film.snapshot,seconds:0.5});assert.equal(framesFirst.cached,false);
 const framesSecond=await posted(framesRoute,{snapshot:film.snapshot,seconds:0.5});assert.equal(framesSecond.cached,true);
 const avFirst=await posted(audioRoute,arbitrary);assert.equal(avFirst.cached,false);assert.equal(avFirst.seconds,0.5);
 const filesAfterDemand=await artifacts(),countAfterDemand=(await read('/api/preview-settings')).stats.renders;
 const avSecond=await posted(audioRoute,arbitrary);assert.equal(avSecond.cached,true);assert.equal((await read('/api/preview-settings')).stats.renders,countAfterDemand);assert.deepEqual(await artifacts(),filesAfterDemand);
 assert.deepEqual(await evidence(),beforePreparation,'image/AV preview responses cannot preconfirm review');
 assert.equal(await sha256(original),originalHash);assert.equal(await sha256(review),reviewHash);assert.deepEqual(mutations,[]);

 // Restart retains cache artifacts and authenticated session but starts render
 // counters at zero; a cachedOnly hit must not run a decoder or rewrite a file.
 await stop();await start();await read('/api/items');
 const restartHit=await posted(audioRoute,{...arbitrary,cachedOnly:true});assert.equal(restartHit.cached,true);assert.equal((await read('/api/preview-settings')).stats.renders,0);assert.deepEqual(await artifacts(),filesAfterDemand);
 assert.deepEqual(await evidence(),beforePreparation);unchecked((await read('/api/items')).reviewSessions[film.id]);

 // Deliberate fixture-only mutation makes even an already cached request stale.
 await fs.appendFile(review,Buffer.from('fixture source identity changed'));
 const beforeStale=(await read('/api/preview-settings')).stats.renders;
 await posted(audioRoute,{...arbitrary,cachedOnly:true},409);
 await posted(framesRoute,{snapshot:film.snapshot,seconds:imageJob.seconds,cachedOnly:true},409);
 const staleStatus=await fetch(base+statusRoute,{headers:{cookie}});assert.equal(staleStatus.status,409,await staleStatus.clone().text());
 assert.equal((await read('/api/preview-settings')).stats.renders,beforeStale);assert.equal(await sha256(original),originalHash);assert.notEqual(await sha256(review),reviewHash);assert.deepEqual(mutations,[]);
 console.log('Preview cache HTTP: private background persistence, unchanged manual evidence, cache-only reads, demand cache, language preferences/manual scope, restart reuse and stale-source guards passed.');
}finally{await stop();await new Promise(resolve=>mock.close(resolve));await fs.rm(root,{recursive:true,force:true})}
