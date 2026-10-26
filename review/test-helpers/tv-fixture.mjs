import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

// Synthetic TV results, Tdarr jobs and a loopback Sonarr mock. Only temporary files and a loopback port.
export const sampleOf=bytes=>{
 const length=Math.min(bytes.length,1024*1024),hash=crypto.createHash('sha256');
 hash.update(bytes.subarray(0,length));hash.update(bytes.subarray(Math.max(0,bytes.length-length)));
 return hash.digest('hex');
};
export const LIBRARY='tv-library',SOURCE_ROOT='Z:\\Tdarr\\TV',SONARR_ROOT='Z:\\Sonarr\\TV',API_KEY='synthetic-tv-discovery-key';

/** Writes one source, one result and its receipt; returns the matching Tdarr job. */
export async function addTvResult({mediaRoot,reviewRoot,prefix='TV',relative,jobId,libraryId=LIBRARY,sourceRoot=SOURCE_ROOT,receipt:receiptOverrides={},job:jobOverrides={},ageMs=300000,withReceipt=true,sourceBytes,resultBytes}){
 const sourcePath=path.join(mediaRoot,...relative.split('/')),resultPath=path.join(reviewRoot,prefix,...relative.split('/'));
 await fs.mkdir(path.dirname(sourcePath),{recursive:true});await fs.mkdir(path.dirname(resultPath),{recursive:true});
 sourceBytes??=Buffer.from('synthetic source '+relative+' '.repeat(40));resultBytes??=Buffer.from('synthetic result '+relative);
 await fs.writeFile(sourcePath,sourceBytes);await fs.writeFile(resultPath,resultBytes);
 const old=new Date(Date.now()-ageMs);await fs.utimes(resultPath,old,old);await fs.utimes(sourcePath,old,old);
 const [a,b]=await Promise.all([fs.stat(sourcePath),fs.stat(resultPath)]);
 const receipt={version:1,relative,outputRelative:relative,source:{size:a.size,mtime:Math.round(a.mtimeMs),sample:sampleOf(sourceBytes)},output:{size:b.size,mtime:Math.round(b.mtimeMs),sample:sampleOf(resultBytes)},jobId,createdAt:Date.now(),...receiptOverrides};
 const receiptPath=resultPath+'.tdarr-receipt.json';
 if(withReceipt)await fs.writeFile(receiptPath,typeof receipt==='string'?receipt:JSON.stringify(receipt));
 const job={_id:jobId,DB:libraryId,file:sourceRoot+'\\'+relative.replaceAll('/','\\'),status:'Transcode success',fileSizeStartGB:a.size/2**30,fileSizeEndGB:b.size/2**30,start:1000,end:2000,...jobOverrides};
 return {job,receipt,receiptPath,sourcePath,resultPath,sourceBytes,resultBytes};
}

export const episodeRecord=(id,seriesId,fileId,numbers)=>({id,seriesId,episodeFileId:fileId,hasFile:fileId>0,...numbers});
export const fileRecord=(id,seriesId,relative,extra={})=>({id,seriesId,path:SONARR_ROOT+'\\'+relative.replaceAll('/','\\'),relativePath:relative.split('/').slice(1).join('/'),seasonNumber:0,...extra});

/** A loopback Sonarr v3 mock that records every request. `data` and the behaviour switches can change between calls. */
export async function sonarrMock(data={series:[],files:{},episodes:{}}){
 const calls=[],mock={data,calls,delayMs:0,status:200,mixSeries:false};
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');calls.push({method:req.method,path:url.pathname,query:url.search,key:req.headers['x-api-key']});
  if(mock.delayMs)await new Promise(resolve=>setTimeout(resolve,mock.delayMs));
  if(mock.status!==200){res.writeHead(mock.status);res.end('{}');return;}
  const seriesId=Number(url.searchParams.get('seriesId'));
  const value=url.pathname==='/api/v3/series'?mock.data.series:url.pathname==='/api/v3/episodefile'?(mock.mixSeries?[{id:999,seriesId:seriesId+1000,path:'/x'}]:mock.data.files[seriesId]):url.pathname==='/api/v3/episode'?mock.data.episodes[seriesId]:null;
  if(!value){res.writeHead(404);res.end('{}');return;}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 mock.url='http://127.0.0.1:'+server.address().port;
 mock.close=()=>new Promise(resolve=>{server.closeAllConnections?.();server.close(resolve)});
 mock.paths=()=>calls.map(call=>call.path+call.query);
 return mock;
}

export const tempRoot=()=>fs.mkdtemp(path.join(os.tmpdir(),'review-tv-'));
