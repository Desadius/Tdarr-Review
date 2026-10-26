import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {serverHarness,linuxServer} from './test-helpers/server.mjs';
import {emptyTvLibrary} from './library-paths.mjs';
import {createSonarrResultInspection} from './sonarr-result-inspection.mjs';

const apiKey='synthetic-sonarr-result-key';
const relative='Synthetic Show/Season 00/S00E01.mkv';
const records={
 series:[{id:7,title:'Synthetic Show',path:'/private/sonarr/root'}],
 files:[{id:31,seriesId:7,path:'Z:\\Sonarr\\TV\\Synthetic Show\\Season 00\\S00E01.mkv',relativePath:relative,seasonNumber:0}],
 episodes:[
  {id:41,seriesId:7,episodeFileId:31,hasFile:true,seasonNumber:0,episodeNumber:1},
  {id:42,seriesId:7,episodeFileId:31,hasFile:true,seasonNumber:0,episodeNumber:2},
 ],
};
let currentRecords=records,fileReads=0,changeFileOnRead=0,episodeReads=0,replaceSourceOnEpisodeRead=0,replaceSource=null;
function sample(bytes){
 const length=Math.min(bytes.length,1024*1024),hash=crypto.createHash('sha256');
 hash.update(bytes.subarray(0,length));hash.update(bytes.subarray(Math.max(0,bytes.length-length)));
 return hash.digest('hex');
}

test('manual TV result inspection binds one exact multi-episode file to its supported Tdarr receipt and job',linuxServer,async t=>{
 const calls=[];
 const sonarr=http.createServer(async(req,res)=>{
  calls.push({method:req.method,url:req.url,key:req.headers['x-api-key']});
  const route=new URL(req.url,'http://localhost').pathname;
  if(route.endsWith('/episodefile')){fileReads++;if(changeFileOnRead&&fileReads===changeFileOnRead){currentRecords={...currentRecords,files:currentRecords.files.map(file=>({...file,path:file.path.replace('S00E01.mkv','renamed.mkv')}))};changeFileOnRead=0;}}
  if(route.endsWith('/episode')){episodeReads++;if(replaceSourceOnEpisodeRead===episodeReads){replaceSourceOnEpisodeRead=0;const action=replaceSource;replaceSource=null;await action?.();}}
  const value=route.endsWith('/series')?currentRecords.series:route.endsWith('/episodefile')?currentRecords.files:route.endsWith('/episode')?currentRecords.episodes:null;
  if(!value){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));
 });
 await new Promise(resolve=>sonarr.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>sonarr.close(resolve)));
 const f=await serverHarness();t.after(()=>f.close());
 const realFfprobe=process.env.TDARR_FACTS_FFPROBE||'',realFfmpeg=process.env.TDARR_FACTS_FFMPEG||'';
 assert.equal(!!realFfprobe,!!realFfmpeg,'real-media test mode needs both FFprobe and FFmpeg paths');
 const probeCount=path.join(f.root,'probe-count.txt'),probeMode=path.join(f.root,'probe-mode.txt'),probePid=path.join(f.root,'probe-pid.txt'),probeStarted=path.join(f.root,'probe-started.txt'),probeRelease=path.join(f.root,'probe-release.txt'),probeMutation=path.join(f.root,'probe-mutation.json'),fakeProbe=path.join(f.root,'synthetic-ffprobe.mjs');
 const realProbeCode=realFfprobe?`import {spawnSync} from "node:child_process";const child=spawnSync(${JSON.stringify(realFfprobe)},process.argv.slice(2),{stdio:["ignore","inherit","inherit",3]});process.exitCode=child.status??1;`:'';
 const fakeProbeCode=realFfprobe?'':`let mode='';try{mode=(await fs.readFile(${JSON.stringify(probeMode)},'utf8')).trim();await fs.rm(${JSON.stringify(probeMode)});}catch{}if(mode==='malformed'){process.stdout.write('{');process.exit(0)}if(mode==='oversized'){process.stdout.write('x'.repeat(140000));process.exit(0)}if(mode==='hang'){await fs.writeFile(${JSON.stringify(probePid)},String(process.pid));await new Promise(resolve=>setInterval(resolve,1000))}if(mode==='ignore-term'){process.on('SIGTERM',()=>{});await fs.writeFile(${JSON.stringify(probePid)},String(process.pid));await new Promise(resolve=>setInterval(resolve,1000))}if(mode==='gate'){await fs.writeFile(${JSON.stringify(probeStarted)},String(process.pid));const stop=Date.now()+5000;while(Date.now()<stop){try{await fs.access(${JSON.stringify(probeRelease)});await fs.rm(${JSON.stringify(probeRelease)});break}catch{await new Promise(resolve=>setTimeout(resolve,10))}}}const input=await fs.readFile('/proc/self/fd/3');try{const action=JSON.parse(await fs.readFile(${JSON.stringify(probeMutation)},'utf8'));await fs.rm(${JSON.stringify(probeMutation)});await fs.writeFile(action.path,action.content)}catch{}const source=input.includes('synthetic TV source bytes'),data={format:{duration:'1.25',tags:{title:'PRIVATE SYNTHETIC TITLE'}},streams:[{index:0,codec_type:'video',codec_name:source?'h264':'hevc',width:64,height:48,avg_frame_rate:'24000/1001',color_primaries:'bt709',color_transfer:'bt709',color_space:'bt709',color_range:'tv',side_data_list:[]},{index:1,codec_type:'audio',codec_name:'aac',channels:2,tags:{language:'eng',title:'PRIVATE AUDIO TITLE'},disposition:{default:1,forced:0}},{index:2,codec_type:'subtitle',codec_name:'subrip',tags:{language:'spa',title:'PRIVATE SUBTITLE TITLE'},disposition:{default:0,forced:1}}]};process.stdout.write(JSON.stringify(data));`;
 await fs.writeFile(fakeProbe,`#!/usr/bin/env node\nimport fs from "node:fs/promises";await fs.appendFile(${JSON.stringify(probeCount)},"probe\\n");${realProbeCode}${fakeProbeCode}\n`,{mode:0o700});
 const database=path.join(f.root,'tdarr.db'),db=new DatabaseSync(database);
 db.exec('CREATE TABLE jobsjsondb (json_data TEXT); CREATE TABLE librarysettingsjsondb (json_data TEXT); CREATE TABLE statisticsjsondb (json_data TEXT)');db.close();
 await f.start({settings:{database,ffprobe:fakeProbe}});
 const headers={cookie:await f.login()},initial=await (await f.request('/api/shared-settings',{headers})).json();
 const tv={...emptyTvLibrary(),mediaRoot:f.media,reviewRoot:f.review,libraryId:'tv-library',sourceRoots:['Z:\\Tdarr\\TV'],tdarrReviewRoot:'/tdarr/review',reviewPrefixes:['TV'],sonarrRoot:'Z:\\Sonarr\\TV'};
 const saved=await f.request('/api/shared-settings/draft',{method:'POST',headers,body:{revision:initial.revision,patch:{sonarr:{url:'http://127.0.0.1:'+sonarr.address().port+'/sonarr',apiKey},libraries:{tv}}}});
 assert.equal(saved.status,200,await saved.clone().text());const settings=await saved.json();
 assert.equal(settings.draft.libraries.tv.enabled,false);assert.deepEqual(settings.draft.review,initial.draft.review,'adding TV inspection settings preserves the existing Movie configuration');
 const sourcePath=path.join(f.media,...relative.split('/')),resultRelative='TV/'+relative,resultPath=path.join(f.review,...resultRelative.split('/'));
 await fs.mkdir(path.dirname(sourcePath),{recursive:true});await fs.mkdir(path.dirname(resultPath),{recursive:true});
 let sourceBytes=Buffer.from('synthetic TV source bytes'),resultBytes=Buffer.from('synthetic Tdarr result bytes');
 if(realFfmpeg){
  const subtitle=path.join(f.root,'synthetic.srt');await fs.writeFile(subtitle,'1\n00:00:00,000 --> 00:00:00,900\nSynthetic subtitle\n');
  const generate=file=>{const generated=spawnSync(realFfmpeg,['-y','-v','error','-f','lavfi','-i','color=c=blue:s=64x48:r=24:d=1','-f','lavfi','-i','sine=frequency=1000:sample_rate=48000:duration=1','-i',subtitle,'-metadata:s:a:0','language=eng','-metadata:s:s:0','language=spa','-disposition:a:0','default','-disposition:s:0','forced','-c:v','libx264','-q:v','5','-c:a','aac','-c:s','srt','-f','matroska',file],{encoding:'utf8',timeout:30000});assert.equal(generated.status,0,generated.stderr)};
  generate(sourcePath);generate(resultPath);[sourceBytes,resultBytes]=await Promise.all([fs.readFile(sourcePath),fs.readFile(resultPath)]);
 }else{await fs.writeFile(sourcePath,sourceBytes);await fs.writeFile(resultPath,resultBytes);}
 const [sourceStat,resultStat]=await Promise.all([fs.stat(sourcePath),fs.stat(resultPath)]),jobId='synthetic-tv-job-31';
 const receipt={version:1,relative,outputRelative:relative,source:{size:sourceStat.size,mtime:Math.round(sourceStat.mtimeMs),sample:sample(sourceBytes)},output:{size:resultStat.size,mtime:Math.round(resultStat.mtimeMs),sample:sample(resultBytes)},jobId,createdAt:Date.now()},receiptPath=resultPath+'.tdarr-receipt.json';
 await fs.writeFile(receiptPath,JSON.stringify(receipt));
 const refreshSourceReceipt=async()=>{const stat=await fs.stat(sourcePath);receipt.source={size:stat.size,mtime:Math.round(stat.mtimeMs),sample:sample(await fs.readFile(sourcePath))};await fs.writeFile(receiptPath,JSON.stringify(receipt));};
 const tdarrRelative=relative.replaceAll('/','\\');
 const jobs=new DatabaseSync(database);
 jobs.prepare('INSERT INTO jobsjsondb VALUES (?)').run(JSON.stringify({_id:jobId,DB:'tv-library',file:'Z:\\Tdarr\\TV\\'+tdarrRelative,status:'Transcode success',fileSizeStartGB:sourceStat.size/2**30,fileSizeEndGB:resultStat.size/2**30,start:1000,end:2000}));jobs.close();

 const databaseBefore=await fs.readFile(database),response=await f.request('/api/sonarr/result?revision='+encodeURIComponent(settings.revision)+'&seriesId=7&episodeFileId=31',{headers});
 assert.equal(response.status,200,await response.clone().text()+' '+JSON.stringify(calls));
 const result=await response.json();
 assert.equal(result.status,'matched',JSON.stringify(result));assert.deepEqual(result.binding.episodeIds,[41,42]);
 assert.equal(result.source.size,sourceStat.size);assert.equal(result.result.size,resultStat.size);
 assert.equal(result.evidence.job,'successful');assert.equal(result.evidence.receipt,'matched');
 assert.deepEqual(await fs.readFile(database),databaseBefore,'inspection reads the local Tdarr database without changing it');
 const validJobForFacts={_id:jobId,DB:'tv-library',file:'Z:\\Tdarr\\TV\\'+relative.replaceAll('/','\\'),status:'Transcode success',fileSizeStartGB:sourceStat.size/2**30,fileSizeEndGB:resultStat.size/2**30,start:1000,end:2000};
 const setJob=async value=>{const db=new DatabaseSync(database);db.prepare('UPDATE jobsjsondb SET json_data=?').run(JSON.stringify(value));db.close();};
 const probeCountNow=async()=>{try{return (await fs.readFile(probeCount,'utf8')).trim().split('\n').filter(Boolean).length}catch{return 0}};
 const probesBeforeRefusals=await probeCountNow();
 assert.equal((await f.request('/api/sonarr/technical-facts',{method:'POST',body:{revision:settings.revision,seriesId:7,episodeFileId:31}})).status,401,'the action requires the Review session');
 assert.equal((await f.request('/api/sonarr/technical-facts',{method:'POST',headers:{...headers,origin:'https://untrusted.invalid'},body:{revision:settings.revision,seriesId:7,episodeFileId:31}})).status,403,'the action keeps the same-origin guard');
 await setJob({...validJobForFacts,DB:'another-library'});let refused=await f.request('/api/sonarr/technical-facts',{method:'POST',headers,body:{revision:settings.revision,seriesId:7,episodeFileId:31}});assert.equal((await refused.json()).reason,'wrong-library');
 await setJob({...validJobForFacts,status:'Transcode failed'});refused=await f.request('/api/sonarr/technical-facts',{method:'POST',headers,body:{revision:settings.revision,seriesId:7,episodeFileId:31}});assert.equal((await refused.json()).reason,'job-not-successful');
 await setJob(validJobForFacts);await fs.writeFile(receiptPath,JSON.stringify({...receipt,jobId:'unknown-job'}));refused=await f.request('/api/sonarr/technical-facts',{method:'POST',headers,body:{revision:settings.revision,seriesId:7,episodeFileId:31}});assert.equal((await refused.json()).reason,'job-missing');
 assert.equal(await probeCountNow(),probesBeforeRefusals,'an unavailable association must be rejected before FFprobe starts');await fs.writeFile(receiptPath,JSON.stringify(receipt));const technicalDbBefore=await fs.readFile(database);
 const technicalResponse=await f.request('/api/sonarr/technical-facts',{method:'POST',headers,body:{revision:settings.revision,seriesId:7,episodeFileId:31}});
 assert.equal(technicalResponse.status,200,await technicalResponse.clone().text());
 const technical=await technicalResponse.json();
 assert.equal(technical.status,'available');assert.deepEqual(technical.binding.episodeIds,[41,42]);
 assert.ok(technical.facts.source.durationSeconds>0);
 assert.ok(await probeCountNow()>probesBeforeRefusals,'a matched association probes the opened source and result');
 assert.equal(technical.facts.source.video[0].codec,'h264');assert.equal(technical.facts.source.video[0].dimensions.width,64);assert.equal(technical.facts.source.video[0].dimensions.height,48);
 assert.equal(technical.facts.source.audio[0].codec,'aac');assert.equal(technical.facts.source.audio[0].language,'eng');
 assert.equal(technical.facts.source.subtitles[0].codec,'subrip');assert.equal(technical.facts.source.subtitles[0].language,'spa');assert.equal(technical.facts.source.subtitles[0].forced,true);
 const technicalJson=JSON.stringify(technical);for(const privateValue of [apiKey,f.media,f.review,'Z:\\Sonarr\\TV','Z:\\Tdarr\\TV','PRIVATE SYNTHETIC TITLE','PRIVATE AUDIO TITLE','PRIVATE SUBTITLE TITLE'])assert.equal(technicalJson.includes(privateValue),false);
 assert.deepEqual(await fs.readFile(database),technicalDbBefore,'technical inspection does not change the Tdarr database');
 const readTechnical=async()=>{const response=await f.request('/api/sonarr/technical-facts',{method:'POST',headers,body:{revision:settings.revision,seriesId:7,episodeFileId:31}});return {status:response.status,body:await response.json()};};
 if(!realFfprobe){
  await fs.writeFile(probeMode,'malformed');let unavailable=await readTechnical();assert.equal(unavailable.status,200);assert.equal(unavailable.body.reason,'technical-facts-unavailable','malformed FFprobe JSON remains a safe refusal');
  await fs.writeFile(probeMode,'oversized');unavailable=await readTechnical();assert.equal(unavailable.body.reason,'technical-facts-unavailable','oversized FFprobe output remains bounded and unverified');
  await fs.writeFile(probeMutation,JSON.stringify({path:sourcePath,content:'changed while FFprobe is reading'}));unavailable=await readTechnical();assert.equal(unavailable.body.reason,'file-changed','source replacement during probing invalidates its private identity');await fs.writeFile(sourcePath,sourceBytes);await refreshSourceReceipt();
  replaceSource=async()=>{const before=await fs.stat(sourcePath),replacement=sourcePath+'.during-sonarr-fetch';await fs.writeFile(replacement,sourceBytes);await fs.utimes(replacement,before.atime,before.mtime);await fs.rename(replacement,sourcePath);};
  replaceSourceOnEpisodeRead=episodeReads+3;unavailable=await readTechnical();assert.equal(unavailable.body.reason,'file-changed','source replacement during the final Sonarr read invalidates probed facts');
  await fs.writeFile(probeMode,'hang');const hanging=f.request('/api/sonarr/technical-facts',{method:'POST',headers,body:{revision:settings.revision,seriesId:7,episodeFileId:31}});await new Promise(resolve=>setTimeout(resolve,150));const startedAt=Date.now(),movie=await f.request('/api/items',{headers});assert.equal(movie.status,200,await movie.clone().text());assert.ok(Date.now()-startedAt<500,'Movie HTTP remains responsive while the isolated probe is stuck');
  unavailable=await hanging;const hungBody=await unavailable.json();assert.equal(hungBody.reason,'technical-facts-unavailable','a probe timeout is unverified');const pid=Number(await fs.readFile(probePid,'utf8'));assert.ok(Number.isSafeInteger(pid)&&pid>0);await new Promise(resolve=>setTimeout(resolve,20));assert.throws(()=>process.kill(pid,0),{code:'ESRCH'},'the timed-out probe process is reaped before the request completes');await fs.writeFile(sourcePath,sourceBytes);await refreshSourceReceipt();
 }
 const output=JSON.stringify(result);for(const privateValue of [apiKey,f.media,f.review,'Z:\\Sonarr\\TV','Z:\\Tdarr\\TV','/private/sonarr/root'])assert.equal(output.includes(privateValue),false);
 assert.ok(calls.length>=6);assert.ok(calls.every(call=>call.method==='GET'&&call.key===apiKey));
 const readResult=async(revision=settings.revision)=>{const response=await f.request('/api/sonarr/result?revision='+encodeURIComponent(revision)+'&seriesId=7&episodeFileId=31',{headers});return {status:response.status,body:await response.json()};};
 const originalJob={_id:jobId,DB:'tv-library',file:'Z:\\Tdarr\\TV\\'+tdarrRelative,status:'Transcode success',fileSizeStartGB:sourceStat.size/2**30,fileSizeEndGB:resultStat.size/2**30,start:1000,end:2000};
 let refusal;
 currentRecords={...records,files:records.files.map(file=>({...file,path:file.path.replace('Z:\\Sonarr\\TV','Z:\\Sonarr\\TV-old')}))};
 refusal=await readResult();assert.equal(refusal.body.reason,'unsupported-layout','a Windows namespace prefix lookalike is not an exact Sonarr root match');currentRecords=records;
 replaceSource=async()=>{const before=await fs.stat(sourcePath),replacement=sourcePath+'.same-bytes-new-inode';await fs.writeFile(replacement,sourceBytes);await fs.utimes(replacement,before.atime,before.mtime);await fs.rename(replacement,sourcePath);const after=await fs.stat(sourcePath);assert.equal(after.size,before.size);assert.equal(Math.round(after.mtimeMs),Math.round(before.mtimeMs));assert.notEqual(after.ino,before.ino);};
 replaceSourceOnEpisodeRead=episodeReads+2;const freshness=await readResult();assert.equal(freshness.body.reason,'file-changed','a source replaced with identical bytes and preserved mtime during the final Sonarr read must invalidate the match');
 const wrongLibrary={...originalJob,DB:'another-library'};let mutate=new DatabaseSync(database);mutate.prepare('UPDATE jobsjsondb SET json_data=?').run(JSON.stringify(wrongLibrary));mutate.close();
 refusal=await readResult();assert.equal(refusal.status,200);assert.equal(refusal.body.status,'unverified');assert.equal(refusal.body.reason,'wrong-library');
 mutate=new DatabaseSync(database);mutate.prepare('UPDATE jobsjsondb SET json_data=?').run(JSON.stringify({...originalJob,file:'Z:\\Tdarr\\TV-old\\'+tdarrRelative}));mutate.close();
 refusal=await readResult();assert.equal(refusal.body.reason,'job-path-mismatch');
 mutate=new DatabaseSync(database);mutate.exec('DELETE FROM jobsjsondb');mutate.prepare('INSERT INTO jobsjsondb VALUES (?)').run(JSON.stringify(originalJob));mutate.prepare('INSERT INTO jobsjsondb VALUES (?)').run(JSON.stringify(originalJob));mutate.close();
 refusal=await readResult();assert.equal(refusal.body.reason,'ambiguous-job');
 mutate=new DatabaseSync(database);mutate.exec('DELETE FROM jobsjsondb');mutate.prepare('INSERT INTO jobsjsondb VALUES (?)').run(JSON.stringify(originalJob));mutate.close();
 await fs.writeFile(receiptPath,JSON.stringify({...receipt,jobId:'missing-job'}));refusal=await readResult();assert.equal(refusal.body.reason,'job-missing');
 const unsupportedReceipt={...receipt};delete unsupportedReceipt.jobId;await fs.writeFile(receiptPath,JSON.stringify(unsupportedReceipt));refusal=await readResult();assert.equal(refusal.body.reason,'unsupported-evidence');
 await fs.rm(receiptPath);refusal=await readResult();assert.equal(refusal.body.reason,'receipt-missing');
 await fs.writeFile(receiptPath,JSON.stringify(receipt));await fs.writeFile(sourcePath,'changed synthetic source');refusal=await readResult();assert.equal(refusal.body.reason,'file-changed');
 await fs.writeFile(sourcePath,sourceBytes);const sourceAgain=await fs.stat(sourcePath);receipt.source={size:sourceAgain.size,mtime:Math.round(sourceAgain.mtimeMs),sample:sample(sourceBytes)};
 const differentResult=Buffer.from('a changed Tdarr result'),differentResultPath=resultPath;await fs.writeFile(differentResultPath,differentResult);const differentStat=await fs.stat(differentResultPath);receipt.output={size:differentStat.size,mtime:Math.round(differentStat.mtimeMs),sample:sample(differentResult)};await fs.writeFile(receiptPath,JSON.stringify(receipt));
 await fs.writeFile(resultPath,'changed after receipt');refusal=await readResult();assert.equal(refusal.body.reason,'file-changed');
 await fs.writeFile(resultPath,resultBytes);const outputAgain=await fs.stat(resultPath);receipt.output={size:outputAgain.size,mtime:Math.round(outputAgain.mtimeMs),sample:sample(resultBytes)};receipt.createdAt=Date.now();await fs.writeFile(receiptPath,JSON.stringify(receipt));
 changeFileOnRead=fileReads+2;refusal=await readResult();assert.equal(refusal.body.reason,'file-changed');currentRecords=records;
 const stale=await readResult('b'.repeat(64));assert.equal(stale.status,409);assert.equal(stale.body.code,'settings_conflict');
 const duplicateRelative='TV-Other/'+relative,duplicatePath=path.join(f.review,...duplicateRelative.split('/'));await fs.mkdir(path.dirname(duplicatePath),{recursive:true});await fs.copyFile(resultPath,duplicatePath);await fs.copyFile(receiptPath,duplicatePath+'.tdarr-receipt.json');
 const changedSettings=await f.request('/api/shared-settings/draft',{method:'POST',headers,body:{revision:settings.revision,patch:{libraries:{tv:{...tv,reviewPrefixes:['TV','TV-Other']}}}}});assert.equal(changedSettings.status,200,await changedSettings.clone().text());const newer=await changedSettings.json();
 refusal=await readResult(newer.revision);assert.equal(refusal.body.reason,'ambiguous-result');
 await fs.rm(duplicatePath);await fs.rm(duplicatePath+'.tdarr-receipt.json');
 await fs.rm(resultPath);await fs.symlink(path.join(f.root,'outside'),resultPath);refusal=await readResult(newer.revision);assert.equal(refusal.body.reason,'unsafe-path');
 await fs.rm(resultPath);const fifo=spawnSync('mkfifo',[resultPath]);assert.equal(fifo.status,0,fifo.stderr.toString());refusal=await readResult(newer.revision);assert.equal(refusal.body.reason,'unsafe-path');
 assert.equal((await f.request('/api/sonarr/result?revision='+settings.revision+'&seriesId=7&episodeFileId=31')).status,401);
 assert.equal(JSON.stringify(await (await f.request('/api/shared-settings',{headers})).json()).includes(apiKey),false);
  if(!realFfprobe){
   await fs.rm(resultPath);await fs.writeFile(resultPath,resultBytes);const restoredResult=await fs.stat(resultPath);receipt.output={size:restoredResult.size,mtime:Math.round(restoredResult.mtimeMs),sample:sample(resultBytes)};receipt.createdAt=Date.now();await fs.writeFile(receiptPath,JSON.stringify(receipt));
   await fs.rm(probePid,{force:true});await fs.writeFile(probeMode,'ignore-term');const shutdownRequest=f.request('/api/sonarr/technical-facts',{method:'POST',headers,body:{revision:newer.revision,seriesId:7,episodeFileId:31}});
   const probeDeadline=Date.now()+3000;while(Date.now()<probeDeadline){try{await fs.access(probePid);break}catch{await new Promise(resolve=>setTimeout(resolve,10))}}assert.ok(await fs.stat(probePid),'the nested synthetic probe started before shutdown');const nestedPid=Number(await fs.readFile(probePid,'utf8'));assert.ok(Number.isSafeInteger(nestedPid)&&nestedPid>0);
   await f.stop();await shutdownRequest.catch(()=>null);assert.throws(()=>process.kill(nestedPid,0),{code:'ESRCH'},'server shutdown drains a nested probe that ignores SIGTERM');
  }
});

test('technical result worker drains a nested FFprobe process when its own deadline expires',linuxServer,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'tv-facts-drain-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const media=path.join(root,'media'),reviewRoot=path.join(root,'review'),database=path.join(root,'tdarr.db'),relativeFile=relative,outputRelative='TV/'+relativeFile;
 await fs.mkdir(path.dirname(path.join(media,...relativeFile.split('/'))),{recursive:true});await fs.mkdir(path.dirname(path.join(reviewRoot,...outputRelative.split('/'))),{recursive:true});
 const sourcePath=path.join(media,...relativeFile.split('/')),resultPath=path.join(reviewRoot,...outputRelative.split('/')),sourceBytes=Buffer.from('synthetic TV source bytes'),resultBytes=Buffer.from('synthetic Tdarr result bytes');
 await fs.writeFile(sourcePath,sourceBytes);await fs.writeFile(resultPath,resultBytes);
 const [sourceStat,resultStat]=await Promise.all([fs.stat(sourcePath),fs.stat(resultPath)]),jobId='synthetic-drain-job';
 const receipt={version:1,relative:relativeFile,outputRelative:relativeFile,source:{size:sourceStat.size,mtime:Math.round(sourceStat.mtimeMs),sample:sample(sourceBytes)},output:{size:resultStat.size,mtime:Math.round(resultStat.mtimeMs),sample:sample(resultBytes)},jobId,createdAt:Date.now()};
 await fs.writeFile(resultPath+'.tdarr-receipt.json',JSON.stringify(receipt));const db=new DatabaseSync(database);db.exec('CREATE TABLE jobsjsondb (json_data TEXT); CREATE TABLE librarysettingsjsondb (json_data TEXT); CREATE TABLE statisticsjsondb (json_data TEXT)');db.prepare('INSERT INTO jobsjsondb VALUES (?)').run(JSON.stringify({_id:jobId,DB:'tv-library',file:'Z:\\Tdarr\\TV\\'+relativeFile.replaceAll('/','\\'),status:'Transcode success',fileSizeStartGB:sourceStat.size/2**30,fileSizeEndGB:resultStat.size/2**30}));db.close();
 const probePid=path.join(root,'probe.pid'),ffprobe=path.join(root,'ignore-term-probe.mjs');await fs.writeFile(ffprobe,`#!/usr/bin/env node\nimport fs from 'node:fs/promises';process.on('SIGTERM',()=>{});await fs.writeFile(${JSON.stringify(probePid)},String(process.pid));await new Promise(resolve=>setInterval(resolve,1000));\n`,{mode:0o700});
 const tv={...emptyTvLibrary(),mediaRoot:media,reviewRoot,libraryId:'tv-library',sourceRoots:['Z:\\Tdarr\\TV'],reviewPrefixes:['TV'],sonarrRoot:'Z:\\Sonarr\\TV'},revision='c'.repeat(64);
 const sonarr={series:[{id:7,title:'Synthetic Show'}],files:[{id:31,seriesId:7,path:'Z:\\Sonarr\\TV\\'+relativeFile.replaceAll('/','\\'),relativePath:relativeFile,seasonNumber:0}],episodes:[{id:41,seriesId:7,episodeFileId:31,hasFile:true,seasonNumber:0,episodeNumber:1}]};
 const inspection=createSonarrResultInspection({getSnapshot:async value=>({revision:value,tv,review:{database,ffprobe},sonarr:{url:'http://127.0.0.1:8989/sonarr',apiKey:'synthetic'}}),fetchFn:async input=>{
  const route=new URL(input).pathname,data=route.endsWith('/series')?sonarr.series:route.endsWith('/episodefile')?sonarr.files:route.endsWith('/episode')?sonarr.episodes:null;
  return new Response(JSON.stringify(data),{status:data?200:404,headers:{'content-type':'application/json'}});
 },workerTimeoutMs:5000,technicalWorkerTimeoutMs:1200});t.after(()=>inspection.close());
 const result=await inspection.inspectTechnical(revision,7,31);assert.equal(result.status,'unverified');assert.equal(result.reason,'technical-facts-unavailable');
 const pid=Number(await fs.readFile(probePid,'utf8'));assert.ok(Number.isSafeInteger(pid)&&pid>0);const end=Date.now()+2000;let survived=false;
 while(Date.now()<end){try{process.kill(pid,0);survived=true;await new Promise(resolve=>setTimeout(resolve,20));}catch(error){if(error.code==='ESRCH'){survived=false;break;}throw error;}}
 try{assert.equal(survived,false,'the timed-out worker reaps an FFprobe child that ignores SIGTERM');}finally{if(survived)try{process.kill(pid,'SIGKILL')}catch{}}
 await inspection.close();
});
