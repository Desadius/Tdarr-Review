import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {command,sha256} from '../review/core.mjs';
import {defaults} from '../review/config.mjs';

// Only disposable media and databases; the mock never contacts real Tdarr.
const root=await fs.mkdtemp(path.join(os.tmpdir(),'review-integration-'));
const ffmpeg=process.env.FFMPEG||'/usr/bin/ffmpeg';
let child,errors='',onPause=null;
const mockNodes={test:{_id:'test',nodeName:'fixture-node',nodePaused:false,workers:{}}};
const changes=[],rescans=[];
const mock=http.createServer(async(req,res)=>{
  let body='';for await(const x of req)body+=x;
  if(req.url==='/api/v2/get-nodes'){res.setHeader('content-type','application/json');res.end(JSON.stringify(mockNodes));return}
  if(req.url==='/api/v2/update-node'){
    const d=JSON.parse(body).data;assert.equal(d.nodeID,'test');
    mockNodes.test.nodePaused=d.nodeUpdates.nodePaused;changes.push(d.nodeUpdates.nodePaused);
    if(d.nodeUpdates.nodePaused&&onPause){const run=onPause;onPause=null;await run()}
    // Regression: real Tdarr returns plain text, not JSON, for this endpoint.
    res.setHeader('content-type','text/plain');res.end('OK');return;
  }
  if(req.url==='/api/v2/rescan-file'){rescans.push(JSON.parse(body).data);res.setHeader('content-type','text/plain');res.end('OK');return}
  res.writeHead(404);res.end('{}');
});
await new Promise(r=>mock.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:18270';
try{
  for(const p of ['media/Film','review/PROD-Movies/Film','data'])await fs.mkdir(path.join(root,p),{recursive:true});
  const original=path.join(root,'media/Film/Film.mkv'),review=path.join(root,'review/PROD-Movies/Film/Film.mkv');
  await command(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i','sine=frequency=440','-t','14','-c:v','libx264','-threads','1','-crf','0','-bf','0','-c:a','pcm_s16le','-metadata:s:a:0','language=eng',original]);
  await command(ffmpeg,['-v','error','-i',original,'-c:v','libx265','-x265-params','pools=1:frame-threads=1:bframes=0','-pix_fmt','yuv420p10le','-crf','30','-c:a','copy',review]);
  const originalHash=await sha256(original),reviewHash=await sha256(review),fixtures=new Map();
  for(const title of ['Film','Batch A','Batch B','Blocked','Guard A','Guard B']){
    const a=path.join(root,'media',title,title+'.mkv'),b=path.join(root,'review/PROD-Movies',title,title+'.mkv');
    if(title!=='Film'){
      await fs.mkdir(path.dirname(a),{recursive:true});await fs.mkdir(path.dirname(b),{recursive:true});await fs.copyFile(original,a);
      if(title==='Blocked')await command(ffmpeg,['-v','error','-i',review,'-t','1','-c','copy',b]);
      else await fs.copyFile(review,b);
    }
    await fs.utimes(b,new Date(Date.now()-300000),new Date(Date.now()-300000));fixtures.set(title,{original:a,review:b});
  }
  const dbpath=path.join(root,'tdarr.db'),db=new DatabaseSync(dbpath);
  db.exec('CREATE TABLE jobsjsondb (json_data TEXT); CREATE TABLE librarysettingsjsondb (json_data TEXT)');
  db.prepare('INSERT INTO librarysettingsjsondb VALUES (?)').run(JSON.stringify({_id:'fixture-lib',folder:'/media/movies'}));
  for(const [title,f] of fixtures){
    const job={_id:'fixture-'+title,DB:'fixture-lib',file:`/media/movies/${title}/${title}.mkv`,status:'Transcode success',end:Date.now(),fileSizeStartGB:(await fs.stat(f.original)).size/2**30,fileSizeEndGB:(await fs.stat(f.review)).size/2**30};
    db.prepare('INSERT INTO jobsjsondb VALUES (?)').run(JSON.stringify(job));
  }
  db.close();
  await fs.writeFile(path.join(root,'data/settings.json'),JSON.stringify({...defaults({MEDIA_ROOT:path.join(root,'media'),REVIEW_ROOT:path.join(root,'review'),TDARR_DB:dbpath,TDARR_URL:'http://127.0.0.1:'+mock.address().port,PUBLIC_ORIGIN:base,FFMPEG:ffmpeg,FFPROBE:process.env.FFPROBE||'/usr/bin/ffprobe'}),sourceRoots:['/media/movies'],reviewPrefixes:['PROD-Movies'],libraryId:'fixture-lib'}));
  child=spawn(process.execPath,['/review-app/server.mjs'],{env:{...process.env,FFMPEG:ffmpeg,MEDIA_ROOT:path.join(root,'media'),REVIEW_ROOT:path.join(root,'review'),DATA_ROOT:path.join(root,'data'),TDARR_DB:dbpath,TDARR_URL:'http://127.0.0.1:'+mock.address().port,PORT:'18270',PUBLIC_HOST:'127.0.0.1:18270',PUBLIC_ORIGIN:'http://127.0.0.1:18270',FFPROBE:process.env.FFPROBE||'/usr/bin/ffprobe'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',()=>{});child.stderr.on('data',x=>errors+=x);
  for(let i=0;i<60;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
  assert.equal((await fetch(base+'/api/items')).status,401,errors);
  const key=await fs.readFile(path.join(root,'data/access-key'),'utf8');
  assert.equal((await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json',origin:'http://attacker.invalid'},body:JSON.stringify({key})})).status,403);
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({key})});assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const get=async()=>{const r=await fetch(base+'/api/items',{headers:{cookie}});assert.equal(r.status,200,await r.clone().text());return r.json()};
  const postJSON=(route,body)=>fetch(base+route,{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify(body)});
  const appText=await (await fetch(base+'/app.js')).text();for(const match of appText.matchAll(/from '(\/[^']+)'/g)){const imported=await fetch(base+match[1]);assert.equal(imported.status,200,'Missing UI import '+match[1]);assert.match(imported.headers.get('content-type'),/javascript/);}
  const asset=await fetch(base+'/av-player.js?v=test');assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/javascript/);assert.match(asset.headers.get('content-security-policy'),/media-src 'self' blob:/);
  const list=await get(),film=list.items.find(x=>x.title==='Film');assert(film);const route=`/api/items/${film.id}/audio-compare`;
 const request={snapshot:film.snapshot,seconds:1,originalIndex:1,reviewIndex:1,mode:'av'};
 assert.equal((await fetch(base+route,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify(request)})).status,401);
 assert.equal((await postJSON(route,{...request,snapshot:'changed'})).status,409);
 assert.equal((await postJSON(route,{...request,seconds:13})).status,400);
 assert.equal((await postJSON(route,{...request,originalIndex:0})).status,400);
 const r=await postJSON(route,request);assert.equal(r.status,200,await r.clone().text());const d=await r.json();for(const key of ['original','review'])assert.equal(Buffer.from(d[key],'base64').toString('ascii',4,8),'ftyp');assert(d.originalWave.length>1100);assert(d.reviewWave.length>1100);assert.equal(d.duration,12);
 assert.equal(await sha256(original),originalHash);assert.equal(await sha256(review),reviewHash);assert.deepEqual(changes,[]);assert.deepEqual(rescans,[]);console.log('AV HTTP: authentication, stale identity, invalid time/track, playable pair, waveforms and untouched originals passed.');
}finally{if(child){child.kill('SIGTERM');await new Promise(r=>child.once('close',r))}await new Promise(r=>mock.close(r));await fs.rm(root,{recursive:true,force:true})}
