import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {command,sha256} from './core.mjs';
import {defaults} from './config.mjs';

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
  await command(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i','sine=frequency=440','-t','2','-c:v','libx264','-threads','1','-crf','0','-bf','0','-c:a','pcm_s16le','-metadata:s:a:0','language=eng',original]);
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
  await fs.writeFile(path.join(root,'data/settings.json'),JSON.stringify({...defaults({MEDIA_ROOT:path.join(root,'media'),REVIEW_ROOT:path.join(root,'review'),TDARR_DB:dbpath,TDARR_URL:'http://127.0.0.1:'+mock.address().port,PUBLIC_ORIGIN:base,FFMPEG:'/review-decoder-must-not-be-executed',FFPROBE:process.env.FFPROBE||'/usr/bin/ffprobe'}),sourceRoots:['/media/movies'],reviewPrefixes:['PROD-Movies'],libraryId:'fixture-lib'}));
  child=spawn(process.execPath,['server.mjs'],{env:{...process.env,FFMPEG:'/review-decoder-must-not-be-executed',MEDIA_ROOT:path.join(root,'media'),REVIEW_ROOT:path.join(root,'review'),DATA_ROOT:path.join(root,'data'),TDARR_DB:dbpath,TDARR_URL:'http://127.0.0.1:'+mock.address().port,PORT:'18270',PUBLIC_HOST:'127.0.0.1:18270',PUBLIC_ORIGIN:'http://127.0.0.1:18270',FFPROBE:process.env.FFPROBE||'/usr/bin/ffprobe'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',()=>{});child.stderr.on('data',x=>errors+=x);
  for(let i=0;i<60;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
  assert.equal((await fetch(base+'/api/items')).status,401,errors);
  const key=await fs.readFile(path.join(root,'data/access-key'),'utf8');
  assert.equal((await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json',origin:'http://attacker.invalid'},body:JSON.stringify({key})})).status,403);
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({key})});assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const get=async()=>{const r=await fetch(base+'/api/items',{headers:{cookie}});assert.equal(r.status,200,await r.clone().text());return r.json()};
  const postJSON=(route,body)=>fetch(base+route,{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify(body)});
  const single=(item,action='approve',snapshot=item.snapshot)=>postJSON(`/api/items/${item.id}/${action}`,{snapshot,reason:action==='reject'?'Synthetic rejection reason':undefined});
  const batch=items=>postJSON('/api/approve-batch',{items:items.map(({id,snapshot})=>({id,snapshot}))});
  const waitFor=async predicate=>{
    let state;for(let i=0;i<240;i++){state=await get();if(predicate(state))return state;await new Promise(r=>setTimeout(r,100))}
    assert.fail('Operation did not finish: '+JSON.stringify(state)+' '+errors);
  };
  const list=await get();assert.equal(list.items.length,6);
  const byTitle=title=>{const item=list.items.find(x=>x.title===title);assert.ok(item,title);return item};
  const film=byTitle('Film'),a=byTitle('Batch A'),b=byTitle('Batch B'),blocked=byTitle('Blocked'),guardA=byTitle('Guard A'),guardB=byTitle('Guard B');
  for(const item of [film,a,b,guardA,guardB])assert.equal(item.status,'ready',JSON.stringify(item));
  assert.equal(blocked.status,'blocked');assert.equal(blocked.durationMismatch,true);

  // Whole-batch preflight: a stale or blocked selection cannot start earlier films.
  for(const selected of [[a,{...b,snapshot:'stale'}],[a,blocked]])assert.equal((await batch(selected)).status,409);
  assert.equal((await batch([a,a])).status,400);assert.equal((await batch([])).status,400);
  const untouched=await get();assert.equal(untouched.active,null);assert.equal(untouched.batchRunning,false);assert.equal(untouched.history.length,0);assert.deepEqual(changes,[]);
  for(const title of ['Batch A','Batch B'])assert.equal(await sha256(fixtures.get(title).original),originalHash);

  // Plain-text Tdarr responses must permit approval and restore node dispatch.
  assert.equal((await single(film,'approve','bad-snapshot')).status,409);
  const singles=await Promise.all([single(film),single(film)]);assert.deepEqual(singles.map(r=>r.status).sort(),[202,409]);
  let done=await waitFor(s=>!s.active&&!s.batchRunning&&s.history.length===1);
  assert.equal(done.history[0].status,'success',JSON.stringify(done));assert.equal(done.history[0].action,'approve');assert.equal(done.history[0].warning,undefined);
  await assert.rejects(fs.stat(review),{code:'ENOENT'});assert.equal(await sha256(original),reviewHash);assert.deepEqual(changes,[true,false]);

  // Exactly one batch wins; unrelated approve/reject calls stay excluded.
  const batches=await Promise.all([batch([a,b]),batch([a,b])]);assert.deepEqual(batches.map(r=>r.status).sort(),[202,409]);
  assert.equal((await single(guardA)).status,409);assert.equal((await single(blocked,'reject')).status,409);
  done=await waitFor(s=>!s.active&&!s.batchRunning&&s.batch?.status==='complete'&&s.history.length===3);
  assert.equal(done.batch.total,2);assert.equal(done.batch.finished,2);assert.equal(done.batch.failed,0);assert.deepEqual(done.batch.remaining,[]);
  assert.deepEqual(done.batch.results.map(r=>[r.title,r.status]),[['Batch A','success'],['Batch B','success']]);
  for(const title of ['Batch A','Batch B']){
    const f=fixtures.get(title);assert.equal(await sha256(f.original),reviewHash);await assert.rejects(fs.stat(f.review),{code:'ENOENT'});
  }
  assert.deepEqual(changes,[true,false,true,false,true,false]);assert.equal(mockNodes.test.nodePaused,false);
  assert.deepEqual(rescans.map(x=>x._id),['/media/movies/Film/Film.mkv','/media/movies/Batch A/Batch A.mkv','/media/movies/Batch B/Batch B.mkv']);assert.ok(rescans.every(x=>x.DB==='fixture-lib'));

  // After preflight, change the second source as the first starts its commit.
  // The changed file and its review must both survive; first approval succeeds.
  let changedHash;
  onPause=async()=>{await fs.appendFile(fixtures.get('Guard B').original,Buffer.from('changed during batch'));changedHash=await sha256(fixtures.get('Guard B').original)};
  assert.equal((await batch([guardA,guardB])).status,202);
  done=await waitFor(s=>!s.active&&!s.batchRunning&&s.batch?.status==='complete'&&s.history.length===5);
  assert.equal(done.batch.total,2);assert.equal(done.batch.finished,2);assert.equal(done.batch.failed,1);
  assert.deepEqual(done.batch.results.map(r=>[r.title,r.status]),[['Guard A','success'],['Guard B','error']]);
  assert.ok(changedHash);assert.equal(await sha256(fixtures.get('Guard B').original),changedHash);assert.equal(await sha256(fixtures.get('Guard B').review),reviewHash);
  assert.equal(await sha256(fixtures.get('Guard A').original),reviewHash);await assert.rejects(fs.stat(fixtures.get('Guard A').review),{code:'ENOENT'});
  assert.equal(mockNodes.test.nodePaused,false);assert.equal(done.restorePending,0);assert.deepEqual(done.recovery,[]);

  // A duration-blocked review can be rejected without touching its original.
  const latestBlocked=done.items.find(x=>x.id===blocked.id);assert.ok(latestBlocked);
  assert.equal((await single(latestBlocked,'reject')).status,202);
  done=await waitFor(s=>!s.active&&!s.batchRunning&&s.history.length===6);
  assert.equal(done.history[0].action,'reject');assert.equal(done.history[0].status,'success');
  assert.equal(await sha256(fixtures.get('Blocked').original),originalHash);await assert.rejects(fs.stat(fixtures.get('Blocked').review),{code:'ENOENT'});
  assert.equal(done.history.filter(x=>x.status==='success'&&x.action==='approve').length,4);assert.equal(done.history.filter(x=>x.status==='error').length,1);assert.ok(done.history.every(x=>x.warning===undefined));
  assert.deepEqual(changes,[true,false,true,false,true,false,true,false]);assert.equal(rescans.length,4);
  console.log('PASS HTTP integration: auth/CSRF, plain-text Tdarr OK regression, single/double approval, all-or-nothing batch preflight, sequential bulk approval, competing-action exclusion, changed-source preservation, reject-only-review, history and node restoration.');
  if(errors.trim())console.log('Server diagnostic:',errors.trim());
}finally{
  if(child&&child.exitCode===null){const closed=new Promise(r=>child.once('close',r));child.kill('SIGTERM');await closed}
  await new Promise(r=>mock.close(r));await fs.rm(root,{recursive:true,force:true});
}
