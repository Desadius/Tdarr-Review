import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {createRecoveryAttention} from './recovery-attention.mjs';
import {classifyRecovery} from './public/review-model.js';
import {identityOf} from '../recovery/file-identity.mjs';
import {ATTENTION_PATHS,now} from './test-helpers/attention-paths.mjs';

// The server-computed attention model (#229) over synthetic files, a fake Tdarr and a loopback Radarr.
const REASONS={
 'binding failure, original confirmed':'binding-failure','binding failure, original not confirmed':'binding-failure','binding failure with another copy offered':'binding-failure',
 'manual recovery case':'manual','manual Radarr request':'manual','original check did not confirm a fault':'fault-not-confirmed','fault confirmed in Verify':'verify-mode',
 'replacement transcoded, awaiting review':'awaiting-review','replacement transcode error':'transcode-error','replacement skipped as not required':'transcode-skipped','replacement on hold in Tdarr':'tdarr-hold',
 'follow-up case completed under a parent':'follow-up-complete','original outside the library for over 24 hours':'original-outside-library',
 'search failed':'search-failed','download queue failed':'queue-failed','import blocked':'import-blocked','case error':'case-error','retention error':'retention-error',
};

async function fixture(t,{radarr=async()=>({records:[]}),tdarrRow=null}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'recovery-attention-')),data=path.join(root,'data'),media=path.join(root,'media','movies');
 await fs.mkdir(path.join(data,'recovery'),{recursive:true});await fs.mkdir(path.join(media,'Film'),{recursive:true});await fs.mkdir(path.join(root,'quarantine'),{recursive:true});
 const original=path.join(media,'Film','old.mkv'),replacement=path.join(media,'Film','new.mkv'),quarantined=path.join(root,'quarantine','old.mkv');
 await fs.writeFile(replacement,'SYNTHETIC REPLACEMENT');await fs.writeFile(quarantined,'SYNTHETIC ORIGINAL');
 const replacementFP=identityOf(await fs.stat(replacement)),quarantineFP=identityOf(await fs.stat(quarantined));
 const items={},calls={tdarr:[],radarr:[]};
 const server=http.createServer(async(req,res)=>{calls.radarr.push(req.method+' '+req.url);try{const body=JSON.stringify(await radarr(req.url));res.setHeader('content-type','application/json');res.end(body);}catch{res.writeHead(500);res.end('{}');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});});
 const writeCases=cases=>fs.writeFile(path.join(data,'recovery','state.json'),JSON.stringify({version:1,jobs:{},cases}));
 const attention=createRecoveryAttention({data,getConfig:()=>({libraryId:'library'}),getItems:()=>items,now:()=>now,
  tdarr:async(route,body)=>{calls.tdarr.push(route+' '+JSON.stringify(body));if(route!=='/api/v2/cruddb')throw Error('read only');return tdarrRow;},
  getConnection:async()=>({url:'http://127.0.0.1:'+server.address().port,apiKey:'synthetic'})});
 return {root,data,media,original,replacement,replacementFP,quarantined,quarantineFP,items,calls,writeCases,attention};
}
// A Recovery case whose replacement is installed and transcoded, with the faulty original in quarantine.
const caseFor=f=>({id:'a'.repeat(24),file:'/tdarr/movies/Film/new.mkv',source:f.original,relative:'Film/old.mkv',fp:f.quarantineFP,replacementRelative:'Film/new.mkv',replacementSourceFP:f.replacementFP,quarantine:f.quarantined,movieId:7});

test('every path into Needs attention gets its reason, a recommended action among its actions, and blockers when no action resolves it',async t=>{
 const f=await fixture(t);
 const overview={requests:Object.values(ATTENTION_PATHS).map(r=>structuredClone(r))};
 await f.attention.attach(overview);
 Object.keys(ATTENTION_PATHS).forEach((name,i)=>{
  const r=overview.requests[i],c=classifyRecovery(r,now);
  if(c.category!=='attention'){assert.equal(r.attention,undefined,name);return;}
  assert.equal(r.attention.reason,REASONS[name],name);
  assert.ok(r.attention.actions.some(a=>a.id===r.attention.recommended),name+': recommended is offered');
  assert.equal(r.attention.actions[0].id,'refresh',name+': refresh is always offered');
  if(r.attention.actions.length===1)assert.ok(r.attention.blockers.length>0,name+': a case with only refresh names its blocker');
 });
 const offered=overview.requests[Object.keys(ATTENTION_PATHS).indexOf('binding failure with another copy offered')];
 assert.equal(offered.attention.recommended,'replaceSource');assert.deepEqual(offered.attention.blockers,[]);
});

test('location is verified from the case files: the installed replacement, the quarantined original and the waiting Review result',async t=>{
 const f=await fixture(t);await f.writeCases({['a'.repeat(24)]:caseFor(f)});
 f.items['c'.repeat(24)]={relative:'Film/new.mkv',originalFP:f.replacementFP};
 const overview={requests:[{...ATTENTION_PATHS['replacement transcoded, awaiting review']}]};
 await f.attention.attach(overview);const a=overview.requests[0].attention;
 assert.deepEqual(a.location.library,{status:'verified',detail:'present'});
 assert.deepEqual(a.location.quarantine,{status:'verified',detail:'present'});
 assert.deepEqual(a.location.review,{status:'verified',detail:'pending'});
 assert.equal(a.location.tdarr.status,'verified');assert.equal(a.location.tdarr.detail,'transcode success');assert.equal(a.location.tdarr.by,'recovery');
 assert.equal(a.recommended,'openReview');assert.deepEqual(a.actions.find(x=>x.id==='openReview'),{id:'openReview',changes:'nothing',itemId:'c'.repeat(24)});
 assert.ok(!JSON.stringify(a).includes(f.root),'no path leaves the server');
});

test('a changed or missing file and an unmatched Review result are reported as such, never as present',async t=>{
 const f=await fixture(t);await f.writeCases({['a'.repeat(24)]:caseFor(f)});
 await fs.appendFile(f.replacement,'changed');await fs.rm(f.quarantined);
 f.items['c'.repeat(24)]={relative:'Film/new.mkv',originalFP:f.replacementFP};
 const overview={requests:[{...ATTENTION_PATHS['replacement transcoded, awaiting review']}]};
 await f.attention.attach(overview);const a=overview.requests[0].attention;
 assert.deepEqual(a.location.library,{status:'verified',detail:'changed'});
 assert.deepEqual(a.location.quarantine,{status:'verified',detail:'missing'});
 assert.deepEqual(a.location.review,{status:'not-used'});
 assert.equal(a.recommended,'refresh');assert.ok(a.blockers.includes('review-result-missing'));
});

test('a stale Recovery status leaves Tdarr and Radarr unverified',async t=>{
 const f=await fixture(t);
 const overview={requests:[{...ATTENTION_PATHS['replacement transcode error'],statusUpdated:new Date(now-3600000).toISOString()}]};
 await f.attention.attach(overview);
 assert.equal(overview.requests[0].attention.location.tdarr.status,'unverified');
});

test('a parent is shown once as its unresolved follow-up and returns to attention when the follow-up binding goes',async t=>{
 const f=await fixture(t),parent='a'.repeat(24),child='b'.repeat(24);
 const childRecord={source:'recovery',id:child,title:'Synthetic film',phase:'replacement_imported',tdarrStatus:'Transcode error',statusUpdated:new Date(now-60000).toISOString()};
 const parentRecord={source:'recovery',id:parent,title:'Synthetic film',phase:'replacement_imported',statusUpdated:new Date(now-60000).toISOString(),replacementFollowupId:child,replacementFollowup:{id:child,source:'recovery',phase:'replacement_imported',tdarrStatus:'Transcode error',statusUpdated:new Date(now-60000).toISOString()}};
 const overview={requests:[structuredClone(parentRecord),structuredClone(childRecord)]};
 await f.attention.attach(overview);
 assert.equal(overview.requests[0].supersededBy,child);assert.equal(classifyRecovery(overview.requests[0],now).category,'done');assert.equal(overview.requests[0].attention,undefined);
 assert.equal(overview.requests[1].attention.reason,'transcode-error');
 const unbound={requests:[{...structuredClone(parentRecord),replacementFollowupId:null,tdarrStatus:'Transcode success'},structuredClone(childRecord)]};
 await f.attention.attach(unbound);
 assert.equal(unbound.requests[0].supersededBy,undefined);assert.equal(classifyRecovery(unbound.requests[0],now).category,'attention');
 const resolved={requests:[structuredClone(parentRecord),{...structuredClone(childRecord),phase:'no_action',originalCheckKind:'healthy',tdarrStatus:null}]};
 resolved.requests[0].replacementFollowup={...resolved.requests[0].replacementFollowup,phase:'no_action',originalCheckKind:'healthy'};
 await f.attention.attach(resolved);
 assert.equal(resolved.requests[0].supersededBy,undefined,'a completed follow-up leaves the remaining work on the parent');assert.equal(resolved.requests[0].attention.reason,'follow-up-complete');
});

test('refresh only reads: a Tdarr row and the Radarr queue, then the location is verified by Review; files stay untouched',async t=>{
 const f=await fixture(t,{tdarrRow:{_id:'/tdarr/movies/Film/new.mkv',DB:'library',TranscodeDecisionMaker:'Queued'},radarr:async()=>({records:[{status:'completed',trackedDownloadState:'importBlocked'}]})});
 await f.writeCases({['a'.repeat(24)]:caseFor(f)});
 const before=await Promise.all([f.replacement,f.quarantined].map(p=>fs.stat(p).then(identityOf))),state=await fs.readFile(path.join(f.data,'recovery','state.json'),'utf8');
 const overview={requests:[{...ATTENTION_PATHS['replacement transcode error']}]};
 await f.attention.refresh(overview);const a=overview.requests[0].attention;
 assert.equal(a.location.tdarr.detail,'queued');assert.equal(a.location.tdarr.by,'review');
 assert.equal(a.location.radarr.detail,'import-blocked');assert.equal(a.location.radarr.by,'review');
 assert.deepEqual(f.calls.tdarr.map(c=>c.split(' ')[0]),['/api/v2/cruddb']);assert.ok(f.calls.tdarr[0].includes('"mode":"getById"'));
 assert.ok(f.calls.radarr.every(c=>c.startsWith('GET ')));
 assert.deepEqual(await Promise.all([f.replacement,f.quarantined].map(p=>fs.stat(p).then(identityOf))),before);
 assert.equal(await fs.readFile(path.join(f.data,'recovery','state.json'),'utf8'),state);
});

test('a failed refresh read is unverified, not evidence',async t=>{
 const f=await fixture(t,{radarr:async()=>{throw Error('down')}});
 await f.writeCases({['a'.repeat(24)]:caseFor(f)});
 const overview={requests:[{...ATTENTION_PATHS['replacement transcode error']}]};
 await f.attention.refresh(overview);const a=overview.requests[0].attention;
 assert.equal(a.location.radarr.status,'unverified');
 assert.equal(a.location.tdarr.detail,'missing','no Tdarr row is reported as missing, not as a transcode state');
});
