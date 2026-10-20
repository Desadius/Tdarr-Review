import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {reviewFixture} from './test-helpers/review-fixture.mjs';
import {linuxServer as linux} from './test-helpers/server.mjs';
import {hash,sha256} from './core.mjs';

// Characterization of the approval and rejection transaction through the real server: for each path,
// the exact Tdarr calls in order, the files afterwards, the journal, the history entry and the operator
// log. These pin the ordering before the transaction moves into its own module (#201).
const tdarrCalls=(f,from)=>f.calls.slice(from).filter(c=>c.route.startsWith('/api/v2/')).map(c=>c.route==='/api/v2/update-node'?'update-node:'+(c.input.data.nodeUpdates.nodePaused?'pause':'resume'):c.route==='/api/v2/rescan-file'?'rescan-file:'+c.input.data._id+'|'+c.input.data.DB:c.route.slice(8));
const film=async(f,title)=>(await f.items()).items.find(item=>item.title===title);
const bytes=(title,size,offset=0)=>hash(Buffer.alloc(size,title.charCodeAt(0)+offset));
const actionEvents=f=>f.events('action.started').concat(f.events('node.paused'),f.events('nodes.resume'),f.events('action.finished'),f.events('transaction.unresolved')).sort((a,b)=>a.time<b.time?-1:a.time>b.time?1:0).map(e=>e.event);
const journalPhases=async f=>Promise.all((await f.journals()).map(async name=>JSON.parse(await fs.readFile(path.join(f.data,'transactions',name),'utf8')).phase));
const historyShape=entry=>Object.fromEntries(Object.entries(entry).map(([k,v])=>[k,['time','elapsedSeconds'].includes(k)?typeof v:k==='reviewSession'?typeof v:v]));

test('characterization: an approval pauses Tdarr, replaces the original through a journal, rescans and resumes in this order',linux,async()=>{
 const f=await reviewFixture();try{
  const a=await film(f,'A');await f.confirm(a);const from=f.calls.length;
  assert.equal((await f.approve(a)).status,202);const done=await f.settled(1);
  assert.deepEqual(tdarrCalls(f,from),['get-nodes','get-nodes','update-node:pause','get-nodes','get-nodes','rescan-file:/fixture-library/A/A.mkv|fixture-library','get-nodes','update-node:resume']);
  assert.equal(await sha256(f.files.get('A').original),bytes('A',32,32),'the original now holds the review result');
  await assert.rejects(fs.stat(f.files.get('A').review),{code:'ENOENT'});
  await assert.rejects(fs.stat(path.dirname(f.files.get('A').review)),{code:'ENOENT'},'the empty review folder is cleaned up');
  assert.deepEqual(await journalPhases(f),['complete']);
  assert.deepEqual(historyShape(done.history[0]),{id:a.id,title:'A',action:'approve',jobId:'fixture-A',reviewSession:'object',status:'success',time:'string',elapsedSeconds:'number',savedBytes:96});
  assert.deepEqual(actionEvents(f),['action.started','node.paused','nodes.resume','action.finished']);
  assert.deepEqual(f.changes,[true,false]);
 }finally{await f.close()}
});

test('characterization: a rejection checks Tdarr once, removes only the review copy and pauses nothing',linux,async()=>{
 const f=await reviewFixture();try{
  const a=await film(f,'A'),from=f.calls.length;
  assert.equal((await f.post(`/api/items/${a.id}/reject`,{snapshot:a.snapshot,reason:'Synthetic rejection'})).status,202);const done=await f.settled(1);
  assert.deepEqual(tdarrCalls(f,from),['get-nodes']);
  assert.equal(await sha256(f.files.get('A').original),bytes('A',128));
  await assert.rejects(fs.stat(f.files.get('A').review),{code:'ENOENT'});
  assert.deepEqual(await f.journals(),[]);
  assert.deepEqual(historyShape(done.history[0]),{id:a.id,title:'A',action:'reject',rejectionReason:'Synthetic rejection',jobId:'fixture-A',status:'success',time:'string',elapsedSeconds:'number',savedBytes:0});
  assert.deepEqual(actionEvents(f),['action.started','action.finished']);
  assert.deepEqual(f.changes,[]);
 }finally{await f.close()}
});

test('characterization: in a batch, files changed after the preflight stop that film before Tdarr is asked anything',linux,async()=>{
 const f=await reviewFixture();try{
  const a=await film(f,'A'),b=await film(f,'B');await f.confirm(a);await f.confirm(b);
  for(const x of [a,b])assert.equal((await f.post(`/api/items/${x.id}/approval`,{snapshot:x.snapshot,reviewRevision:x.reviewRevision})).status,200);
  // B's review copy changes while A is being replaced, after the batch preflight accepted both.
  const gate=f.hold('/api/v2/update-node',body=>body.data.nodeUpdates.nodePaused===true);const from=f.calls.length;
  assert.equal((await f.post('/api/approve-batch',{items:[a,b].map(x=>({id:x.id,snapshot:x.snapshot,reviewRevision:x.reviewRevision}))})).status,202);
  await gate.entered;const future=new Date(Date.now()+60000);await fs.utimes(f.files.get('B').review,future,future);gate.release();
  const done=await f.settled(2);
  assert.deepEqual(tdarrCalls(f,from),['get-nodes','get-nodes','update-node:pause','get-nodes','get-nodes','rescan-file:/fixture-library/A/A.mkv|fixture-library','get-nodes','update-node:resume'],'B adds no Tdarr call');
  assert.deepEqual(done.history.map(h=>[h.title,h.status,h.message??null]),[['B','error','Soubory se změnily. Obnov přehled.'],['A','success',null]]);
  assert.equal(await sha256(f.files.get('B').original),bytes('B',128));assert.equal(await sha256(f.files.get('B').review),bytes('B',32,32));
  assert.deepEqual(await journalPhases(f),['complete'],'only A has a journal');assert.deepEqual(f.changes,[true,false]);
 }finally{await f.close()}
});

test('characterization: a film Tdarr is processing is refused after one node read, before any pause',linux,async()=>{
 const f=await reviewFixture();try{
  const a=await film(f,'A');await f.confirm(a);f.nodes.fixture.workers={w:{idle:false,file:'/fixture-library/A/A.mkv'}};const from=f.calls.length;
  assert.equal((await f.approve(a)).status,202);const done=await f.settled(1);
  assert.deepEqual(tdarrCalls(f,from),['get-nodes']);
  assert.equal(done.history[0].message,'Tento film právě zpracovává Tdarr. Zkus akci po dokončení.');
  assert.equal(await sha256(f.files.get('A').original),bytes('A',128));assert.deepEqual(await f.journals(),[]);assert.deepEqual(f.changes,[]);
 }finally{await f.close()}
});

test('characterization: a duration difference is refused after probing, before any pause',linux,async()=>{
 const f=await reviewFixture();try{
  const a=await film(f,'A');await f.confirm(a);
  f.setProbe((file,output)=>file.includes('/review/')?{...output,format:{...output.format,duration:'30'}}:output);const from=f.calls.length;
  assert.equal((await f.approve(a)).status,202);const done=await f.settled(1);
  assert.deepEqual(tdarrCalls(f,from),['get-nodes']);
  assert.equal(done.history[0].message,'Rozdílnou délku nelze schválit bez zvláštní kontroly.');
  assert.equal(await sha256(f.files.get('A').original),bytes('A',128));assert.deepEqual(await f.journals(),[]);assert.deepEqual(f.changes,[]);
 }finally{await f.close()}
});

test('characterization: a node state change before the commit aborts the journal, keeps the original and still resumes',linux,async()=>{
 const f=await reviewFixture();try{
  const a=await film(f,'A');await f.confirm(a);let reads=0;
  // The fourth node read after the request is the check right before the commit.
  const gate=f.hold('/api/v2/get-nodes',()=>++reads===4);const from=f.calls.length;
  assert.equal((await f.approve(a)).status,202);await gate.entered;f.nodes.fixture.workers={w:{idle:false,file:'/fixture-library/A/A.mkv'}};gate.release();
  const done=await f.settled(1);
  assert.deepEqual(tdarrCalls(f,from),['get-nodes','get-nodes','update-node:pause','get-nodes','get-nodes','get-nodes','update-node:resume']);
  assert.equal(done.history[0].status,'error');assert.equal(done.history[0].message,'Během výměny se změnil stav nodů. Originál nebyl vyměněn.');
  assert.equal(await sha256(f.files.get('A').original),bytes('A',128));assert.equal(await sha256(f.files.get('A').review),bytes('A',32,32));
  assert.deepEqual(await journalPhases(f),['aborted']);
  assert.deepEqual(actionEvents(f),['action.started','node.paused','nodes.resume','action.finished']);
  assert.equal((await f.items()).recovery?.length??0,0,'an aborted journal leaves nothing to inspect');
 }finally{await f.close()}
});
