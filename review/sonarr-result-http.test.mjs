import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {serverHarness,linuxServer} from './test-helpers/server.mjs';
import {emptyTvLibrary} from './library-paths.mjs';

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
 const database=path.join(f.root,'tdarr.db'),db=new DatabaseSync(database);
 db.exec('CREATE TABLE jobsjsondb (json_data TEXT); CREATE TABLE librarysettingsjsondb (json_data TEXT); CREATE TABLE statisticsjsondb (json_data TEXT)');db.close();
 await f.start({settings:{database}});
 const headers={cookie:await f.login()},initial=await (await f.request('/api/shared-settings',{headers})).json();
 const tv={...emptyTvLibrary(),mediaRoot:f.media,reviewRoot:f.review,libraryId:'tv-library',sourceRoots:['Z:\\Tdarr\\TV'],tdarrReviewRoot:'/tdarr/review',reviewPrefixes:['TV'],sonarrRoot:'Z:\\Sonarr\\TV'};
 const saved=await f.request('/api/shared-settings/draft',{method:'POST',headers,body:{revision:initial.revision,patch:{sonarr:{url:'http://127.0.0.1:'+sonarr.address().port+'/sonarr',apiKey},libraries:{tv}}}});
 assert.equal(saved.status,200,await saved.clone().text());const settings=await saved.json();
 assert.equal(settings.draft.libraries.tv.enabled,false);assert.deepEqual(settings.draft.review,initial.draft.review,'adding TV inspection settings preserves the existing Movie configuration');
 const sourcePath=path.join(f.media,...relative.split('/')),resultRelative='TV/'+relative,resultPath=path.join(f.review,...resultRelative.split('/'));
 await fs.mkdir(path.dirname(sourcePath),{recursive:true});await fs.mkdir(path.dirname(resultPath),{recursive:true});
 const sourceBytes=Buffer.from('synthetic TV source bytes'),resultBytes=Buffer.from('synthetic Tdarr result bytes');
 await fs.writeFile(sourcePath,sourceBytes);await fs.writeFile(resultPath,resultBytes);
 const [sourceStat,resultStat]=await Promise.all([fs.stat(sourcePath),fs.stat(resultPath)]),jobId='synthetic-tv-job-31';
 const receipt={version:1,relative,outputRelative:relative,source:{size:sourceStat.size,mtime:Math.round(sourceStat.mtimeMs),sample:sample(sourceBytes)},output:{size:resultStat.size,mtime:Math.round(resultStat.mtimeMs),sample:sample(resultBytes)},jobId,createdAt:Date.now()},receiptPath=resultPath+'.tdarr-receipt.json';
 await fs.writeFile(receiptPath,JSON.stringify(receipt));
 const tdarrRelative=relative.replaceAll('/','\\');
 const jobs=new DatabaseSync(database);
 jobs.prepare('INSERT INTO jobsjsondb VALUES (?)').run(JSON.stringify({_id:jobId,DB:'tv-library',file:'Z:\\Tdarr\\TV\\'+tdarrRelative,status:'Transcode success',fileSizeStartGB:sourceStat.size/2**30,fileSizeEndGB:resultStat.size/2**30,start:1000,end:2000}));jobs.close();

 const databaseBefore=await fs.readFile(database),response=await f.request('/api/sonarr/result?revision='+encodeURIComponent(settings.revision)+'&seriesId=7&episodeFileId=31',{headers});
 assert.equal(response.status,200,await response.clone().text());
 const result=await response.json();
 assert.equal(result.status,'matched',JSON.stringify(result));assert.deepEqual(result.binding.episodeIds,[41,42]);
 assert.equal(result.source.size,sourceStat.size);assert.equal(result.result.size,resultStat.size);
 assert.equal(result.evidence.job,'successful');assert.equal(result.evidence.receipt,'matched');
 assert.deepEqual(await fs.readFile(database),databaseBefore,'inspection reads the local Tdarr database without changing it');
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
});
