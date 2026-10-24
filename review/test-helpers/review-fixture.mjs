import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {defaults} from '../config.mjs';
import {serverHarness} from './server.mjs';
import {hash,sha256} from '../core.mjs';

// The real Review server over synthetic films A, B and C with a loopback Tdarr/Radarr mock that
// records every call and can hold a route (hold) until the test releases it. Only temporary files.
export const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};

// pauses: a node Review could not restore is pending; nodesVisible:false hides every node from the
// mock Tdarr (as pauses does by default), so a restore leaves its pauses pending.
export async function reviewFixture({pauses=false,recovery=false,clock=false,nodesVisible=!pauses,beforeStart,supervisor=false,env={}}={}){
 const harness=await serverHarness(),{root}=harness;
 const data=path.join(root,'data'),media=path.join(root,'media'),review=path.join(root,'review');
 const gates=[],calls=[],changes=[],tdarrRows=new Map(),afterRescan=new Map(),nodes={fixture:{_id:'fixture',nodeName:'fixture-node',nodePaused:false,workers:{}}};
 let cookie,base=harness.base,addFilm,probeAdjust=null;
 let restoreRadarrMovie=movieId=>({id:Number(movieId),tmdbId:9001,path:'/fixture-library/A',movieFileId:null}),restoreRadarrQueue={page:1,pageSize:100,totalRecords:0,records:[]};
 function hold(route,predicate=()=>true){
  const entered=deferred(),released=deferred(),gate={route,predicate,entered:entered.promise,release:released.resolve};
  gate.wait=async body=>{if(predicate(body)){entered.resolve(body);await released.promise}};gates.push(gate);return gate;
 }
 const mock=http.createServer(async(req,res)=>{
  try{
   let raw='';for await(const chunk of req)raw+=chunk;
   const input=raw?JSON.parse(raw):null;calls.push({route:req.url,input,apiKey:req.headers['x-api-key']||null,method:req.method});
   for(const gate of gates)if(gate.route===req.url)await gate.wait(input);
   let output;
   if(/^\/api\/v3\/movie\/\d+$/.test(req.url))output=restoreRadarrMovie(req.url.split('/').at(-1));
   else if(req.url.startsWith('/api/v3/queue?'))output=restoreRadarrQueue;
   else if(/^\/api\/v3\/command\/\d+$/.test(req.url))output={id:84,name:'MoviesSearch',body:{movieIds:[71]},status:'completed',queued:'2026-10-24T10:01:00.000Z',ended:'2026-10-24T10:02:00.000Z'};
   else if(req.url==='/api/v2/get-nodes')output=nodesVisible?nodes:{};
   else if(req.url==='/api/v2/update-node'){const update=input.data;nodes.fixture.nodePaused=update.nodeUpdates.nodePaused;changes.push(update.nodeUpdates.nodePaused);res.end('OK');return}
   else if(req.url==='/api/v2/rescan-file'){const id=input?.data?._id;if(afterRescan.has(id))tdarrRows.set(id,afterRescan.get(id));res.end('OK');return}
   // Tdarr file rows by path, only read (getById); set by tests through tdarrRows.
   else if(req.url==='/api/v2/cruddb'&&input?.data?.mode==='getById'||req.url==='/api/v2/cruddb'&&input?.mode==='getById')output=tdarrRows.get(input?.data?.docID??input?.docID)??null;
   else if(req.url==='/api/v3/system/status')output={version:'synthetic'};
   else if(req.url==='/api/v3/movie')output=[{path:'/fixture-library/A'}];
   else if(req.url==='/fixture/probe'){
    const isReview=input.file.startsWith(review+'/');
    output={format:{duration:'60',start_time:'0'},chapters:[],streams:[{index:0,codec_type:'video',codec_name:isReview?'hevc':'h264',pix_fmt:isReview?'yuv420p10le':'yuv420p',width:320,height:180,avg_frame_rate:'24/1'},{index:1,codec_type:'audio',codec_name:'aac',channels:2,tags:{language:'eng'}}]};
    if(probeAdjust)output=probeAdjust(input.file,output);
   }else if(req.url==='/fixture/render')output={png:'89504e470d0a1a0a'};
   else{res.writeHead(404);res.end('{}');return}
   res.setHeader('content-type','application/json');res.end(JSON.stringify(output));
  }catch(error){res.writeHead(500);res.end(JSON.stringify({error:error.message}))}
 });
 const close=async()=>{
  for(const gate of gates)gate.release();
  await harness.close();
  await new Promise(resolve=>mock.close(resolve));await fs.rm(root,{recursive:true,force:true});
 };
 try{
  await new Promise(resolve=>mock.listen(0,'127.0.0.1',resolve));
  const mockBase='http://127.0.0.1:'+mock.address().port;
  for(const dir of [data,media,review,path.join(data,'transactions')])await fs.mkdir(dir,{recursive:true});
  const executable=async(name,script)=>{const file=path.join(root,name+'.mjs');await fs.writeFile(file,'#!'+process.execPath+'\n'+script,{mode:0o700});return file};
  const ffprobe=await executable('ffprobe',`const r=await fetch(${JSON.stringify(mockBase+'/fixture/probe')},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({file:process.argv.at(-1)})});if(!r.ok)process.exit(1);process.stdout.write(await r.text());`);
  const ffmpeg=await executable('ffmpeg',`const r=await fetch(${JSON.stringify(mockBase+'/fixture/render')},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({args:process.argv.slice(2)})});if(!r.ok)process.exit(1);process.stdout.write(Buffer.from((await r.json()).png,'hex'));`);
  // Only the two exact synthetic executable paths run through Node. This
  // keeps temporary scripts usable under Docker's noexec /tmp mount without
  // replacing any production decoder, file operation or server behavior.
  const preload=path.join(root,'preload.cjs');
  await fs.writeFile(preload,`const cp=require('node:child_process'),original=cp.spawn;cp.spawn=(exe,args,options)=>${JSON.stringify([ffprobe,ffmpeg])}.includes(exe)?original(process.execPath,[exe,...args],options):original(exe,args,options);require('node:module').syncBuiltinESMExports();`);
  const dbpath=path.join(root,'tdarr.db'),db=new DatabaseSync(dbpath),files=new Map();
  db.exec('CREATE TABLE jobsjsondb (json_data TEXT); CREATE TABLE librarysettingsjsondb (json_data TEXT)');
  db.prepare('INSERT INTO librarysettingsjsondb VALUES (?)').run(JSON.stringify({_id:'fixture-library',folder:'/fixture-library'}));
  // A film is an original, an older review result and a successful Tdarr job for it.
  addFilm=async title=>{
   const original=path.join(media,title,title+'.mkv'),result=path.join(review,'PROD-Movies',title,title+'.mkv');
   await fs.mkdir(path.dirname(original),{recursive:true});await fs.mkdir(path.dirname(result),{recursive:true});
   await fs.writeFile(original,Buffer.alloc(128,title.charCodeAt(0)));await fs.writeFile(result,Buffer.alloc(32,title.charCodeAt(0)+32));
   await fs.utimes(result,new Date(Date.now()-300000),new Date(Date.now()-300000));files.set(title,{original,review:result});
   const jobs=new DatabaseSync(dbpath);
   try{jobs.prepare('INSERT INTO jobsjsondb VALUES (?)').run(JSON.stringify({_id:'fixture-'+title,DB:'fixture-library',file:'/fixture-library/'+title+'/'+title+'.mkv',status:'Transcode success',end:Date.now(),fileSizeStartGB:128/2**30,fileSizeEndGB:32/2**30}))}finally{jobs.close()}
  };
  db.close();
  for(const title of ['A','B','C'])await addFilm(title);
  await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({...defaults({MEDIA_ROOT:media,REVIEW_ROOT:review,TDARR_DB:dbpath,TDARR_URL:mockBase,PUBLIC_ORIGIN:base,FFPROBE:ffprobe,FFMPEG:ffmpeg}),sourceRoots:['/fixture-library'],reviewPrefixes:['PROD-Movies'],libraryId:'fixture-library'}));
  await fs.writeFile(path.join(data,'preview-settings.json'),JSON.stringify({enabled:false}));
  if(pauses)await fs.writeFile(path.join(data,'state.json'),JSON.stringify({items:{},history:[],sessions:{},pauses:[{name:'unavailable-node'}]}));
  if(recovery)await fs.writeFile(path.join(data,'transactions/manual.json'),JSON.stringify({id:'manual',phase:'installed'}));
  await beforeStart?.({data,root,media,dbpath,mockBase});
  await harness.start({settings:JSON.parse(await fs.readFile(path.join(data,'settings.json'),'utf8')),preload,clock,supervisor,env});
  cookie=await harness.login();
  const post=(route,body={})=>fetch(base+route,{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify(body)});
  const get=async route=>{const result=await fetch(base+route,{headers:{cookie}});assert.equal(result.status,200,await result.clone().text());return result.json()};
  const items=()=>get('/api/items');
  const confirm=async item=>{
   const route=`/api/items/${item.id}/review-session`;let current=await get(route+'?snapshot='+item.snapshot);
   for(const session of [{...current.session,method:'external',device:'Synthetic player',scope:{originalIndex:1,reviewIndex:1,seconds:null}},{method:'external',device:'Synthetic player',step:4,checks:{preparation:true,image:true,audio:true,syncStart:true,syncMiddle:true,syncEnd:true,hdr:false},scope:{originalIndex:1,reviewIndex:1,seconds:null}}]){
    const result=await post(route,{snapshot:item.snapshot,revision:current.revision,session});assert.equal(result.status,200,await result.clone().text());current=await result.json();
   }
   assert.equal(current.complete,true);item.reviewRevision=current.revision;return current;
  };
  const approve=item=>post(`/api/items/${item.id}/approve`,{snapshot:item.snapshot,reviewRevision:item.reviewRevision});
  const allMutations=(item,session)=>{
   const selection={id:item.id,snapshot:item.snapshot,reviewRevision:item.reviewRevision};
   return [
    ['/api/settings',{}],['/api/settings/test',{}],['/api/radarr/settings',{}],['/api/radarr/settings/test',{}],['/api/preview-settings',{}],['/api/approve-batch',{items:[selection]}],
    ...['approve','reject','replace','recheck'].map(action=>[`/api/items/${item.id}/${action}`,{...selection,reason:'Synthetic rejection'}]),
    [`/api/items/${item.id}/review-session`,{snapshot:item.snapshot,revision:session?.revision||0,session:session?.session||{}}],
    [`/api/radarr/requests/${'f'.repeat(24)}/restore`,{confirm:true}],
    [`/api/items/${item.id}/frames`,{snapshot:item.snapshot,seconds:0}],
    [`/api/items/${item.id}/audio-compare`,{snapshot:item.snapshot,mode:'wave',seconds:0,originalIndex:1,reviewIndex:1}],
   ];
  };
  const journals=()=>fs.readdir(path.join(data,'transactions'));
  const settled=async count=>{
   // Completion is observed through HTTP, never inferred from elapsed delay.
   const stop=Date.now()+20000;
   while(Date.now()<stop){const state=await items();if(!state.active&&!state.batchRunning&&state.history.length===count)return state;await new Promise(resolve=>setTimeout(resolve,20))}
   assert.fail('Mutation did not settle: '+harness.diagnostics());
  };
  const preserved=async()=>{for(const [title,fileset] of files){assert.equal(await sha256(fileset.original),hash(Buffer.alloc(128,title.charCodeAt(0))));assert.equal(await sha256(fileset.review),hash(Buffer.alloc(32,title.charCodeAt(0)+32)))}};
  // showNodes(false) makes the mock Tdarr report no nodes, so a resume leaves its pauses pending.
  const showNodes=visible=>{nodesVisible=visible};
  // Operator log events, parsed from complete stdout lines only.
  const events=name=>harness.output().split('\n').slice(0,-1).filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).filter(entry=>entry.event===name);
  const eventually=async(name,count=1)=>{
   const stop=Date.now()+20000;
   while(events(name).length<count){if(Date.now()>stop)assert.fail(name+' event '+count+' did not arrive: '+harness.diagnostics());await new Promise(resolve=>setTimeout(resolve,20))}
   return events(name);
  };
  const restart=async()=>{await harness.stop();await harness.start({settings:JSON.parse(await fs.readFile(path.join(data,'settings.json'),'utf8')),preload,clock,supervisor,env});cookie=await harness.login();};
  return {setProbe:adjust=>{probeAdjust=adjust},setRadarrMovie:movie=>{restoreRadarrMovie=()=>movie},setRadarrQueue:queue=>{restoreRadarrQueue=queue},tdarrRows,afterRescan,root,data,files,mockBase,nodes,hold,calls,changes,post,get,items,confirm,approve,allMutations,journals,settled,preserved,close,restart,showNodes,addFilm,events,eventually,tick:harness.tick,state:harness.state,output:harness.output,diagnostics:harness.diagnostics};
 }catch(error){await close();throw error}
}

