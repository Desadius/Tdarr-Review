import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {reviewFixture} from './test-helpers/review-fixture.mjs';
import {linuxServer as linux} from './test-helpers/server.mjs';
import {identityOf} from '../recovery/file-identity.mjs';

// The Diagnostic export (#237) through the real server: an authenticated, read-only, redacted single-case download.
const SECRETS=['SENTINEL-TITLE-RECOVERY','SENTINEL-TITLE-REVIEW','SENTINEL-ERROR','SENTINEL-RELEASE','SENTINEL-NOTE','SENTINEL-KEY','SENTINEL-URL','SENTINEL-TOKEN','9876543','/fixture-library','SENTINEL-PATH'];
const ALLOWED_TOP=['format','formatVersion','scope','generatedAt','reviewVersion','case','completeness','verification','state','deferral','caseRecord','observations','blockers','unknown'];
const recoveryId='a'.repeat(24),staleId='b'.repeat(24),otherId='c'.repeat(24),absentId='d'.repeat(24),missingRowId='1'.repeat(24),unboundId='2'.repeat(24);
const snapshot=async roots=>{
 const out=[];
 const walk=async dir=>{for(const entry of await fs.readdir(dir,{withFileTypes:true}).catch(()=>[])){const file=path.join(dir,entry.name);
  if(entry.isDirectory()){out.push(['dir',file]);await walk(file);}else{const st=await fs.lstat(file);out.push(['file',file,st.size,st.mtimeMs,crypto.createHash('sha256').update(await fs.readFile(file).catch(()=>'')).digest('hex')]);}}};
 for(const root of roots)await walk(root);return JSON.stringify(out.sort());
};

async function seeded(t){
 const now=new Date().toISOString(),old=new Date(Date.now()-3600000).toISOString();let roots;
 const f=await reviewFixture({beforeStart:async({data,media,root,mockBase})=>{
  const file=path.join(media,'A','A.mkv'),identity=identityOf(await fs.stat(file));
  const base={source:file,relative:'A/A.mkv',fp:identity,created:now,updated:now,movieId:9876543,tmdbId:9876543,error:'SENTINEL-ERROR /fixture-library/x'};
  await fs.mkdir(path.join(data,'recovery'),{recursive:true});
  await fs.writeFile(path.join(data,'recovery','state.json'),JSON.stringify({version:1,cases:{[recoveryId]:{...base,id:recoveryId,status:'manual',note:'SENTINEL-NOTE',url:'SENTINEL-URL'},[staleId]:{...base,id:staleId,status:'no_action'},[otherId]:{...base,id:otherId,status:'manual'},
   // Scenario A: imported replacement whose Tdarr row is missing (the mock Tdarr has no rows).
   [missingRowId]:{...base,id:missingRowId,status:'replacement_imported',file:'/fixture-library/A/A.mkv',replacementRelative:'A/A.mkv',replacementSourceFP:identity},
   // Scenario B: the status file carries a retention error the case record does not confirm.
   [unboundId]:{...base,id:unboundId,status:'replacement_imported'}}}));
  await fs.writeFile(path.join(data,'recovery','config.json'),JSON.stringify({enabled:false,tdarrUrl:mockBase,radarrUrl:mockBase,radarrApiKey:'SENTINEL-KEY',libraryId:'fixture-library',sourceRoot:'/fixture-library',radarrRoot:'/fixture-library',mediaRoot:media,reviewRoot:path.join(data,'review'),quarantineRoot:path.join(data,'quarantine'),reports:path.join(data,'reports'),database:path.join(data,'tdarr.db'),ffmpeg:'/usr/bin/ffmpeg',ffprobe:'/usr/bin/ffprobe',stableMinutes:0,decodeTimeoutHours:1,confirmDelaySeconds:30,maxRepairsPerDay:3,movieCooldownDays:30,pollSeconds:300,since:0,reviewPrefixes:['PROD-Movies']}));
  await fs.writeFile(path.join(data,'radarr.json'),JSON.stringify({url:mockBase,apiKey:'SENTINEL-KEY',mediaRoot:'/fixture-library',preferCzechEnglish:true}));
  // The same local ID belongs to a Review-owned case too: sources must never mix.
  await fs.mkdir(path.join(data,'radarr-replacements'),{recursive:true});
  await fs.writeFile(path.join(data,'radarr-replacements',recoveryId+'.json'),JSON.stringify({id:recoveryId,phase:'manual',title:'SENTINEL-TITLE-REVIEW',created:now,updated:now,message:'SENTINEL-URL http://secret.invalid/?token=SENTINEL-TOKEN',reason:'SENTINEL-NOTE'}));
  const cases=[
   {id:recoveryId,phase:'manual',title:'SENTINEL-TITLE-RECOVERY',statusUpdated:now,source:'recovery',canRestore:false,error:'SENTINEL-ERROR',queue:[{title:'SENTINEL-RELEASE',status:'failed',error:'SENTINEL-ERROR'}],titleSlug:'SENTINEL-URL',tmdbId:9876543,apiKey:'SENTINEL-KEY',cookie:'SENTINEL-TOKEN',stack:'at SENTINEL-PATH'},
   {id:staleId,phase:'no_action',originalCheckKind:'unconfirmed',title:'SENTINEL-TITLE-RECOVERY',statusUpdated:old,source:'recovery',canRestore:false},
   {id:otherId,phase:'manual',title:'SENTINEL-TITLE-RECOVERY',statusUpdated:now,source:'recovery',canRestore:false},
   {id:missingRowId,phase:'replacement_imported',title:'SENTINEL-TITLE-RECOVERY',statusUpdated:now,source:'recovery',canRestore:false},
   {id:unboundId,phase:'replacement_imported',tdarrStatus:'Queued',title:'SENTINEL-TITLE-RECOVERY',statusUpdated:now,source:'recovery',canRestore:false,retentionError:'SENTINEL-ERROR'},
  ];
  await fs.writeFile(path.join(path.dirname(media),'.tdarr-recovery-status.json'),JSON.stringify({version:1,updated:now,cases}));
  roots=[data,media,path.dirname(media)];
 }});t.after(()=>f.close());
 return {f,snap:()=>snapshot([f.data,f.root+'/media',f.root+'/review'])};
}
const route=(source,id)=>`/api/cases/${source}/${id}/diagnostic-export`;
const walk=(value,visit)=>{visit(value);if(value&&typeof value==='object')for(const v of Object.values(value))walk(v,visit);};

test('the export is an authenticated, no-store JSON attachment of one redacted case and writes nothing',linux,async t=>{
 const {f,snap}=await seeded(t);
 assert.equal((await f.request(route('recovery',recoveryId),{headers:{cookie:''}})).status,401,'login required');
 assert.equal((await f.request(route('recovery',recoveryId),{headers:{host:'forbidden.invalid'}})).status,403,'Host policy applies');
 const before=await snap(),calls=f.calls.length;
 const response=await f.request(route('recovery',recoveryId));assert.equal(response.status,200,await response.clone().text());
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.match(response.headers.get('content-type'),/^application\/json/);
 assert.equal(response.headers.get('content-disposition'),`attachment; filename="tdarr-review-diagnostic-recovery-${recoveryId}.json"`);
 const text=await response.text(),report=JSON.parse(text);
 assert.deepEqual(Object.keys(report).sort(),[...ALLOWED_TOP].sort(),'only allowlisted top-level fields');
 for(const secret of SECRETS)assert.equal(text.includes(secret),false,'sentinel leaked: '+secret);
 assert.deepEqual(report.case,{source:'recovery',id:recoveryId});
 assert.equal(report.state.reason,'queue-failed');assert.equal(report.state.phase,'manual');assert.deepEqual(report.blockers,[]);
 assert.equal(report.verification,'not-verified');assert.equal(report.caseRecord,'consistent');
 assert.equal(report.observations.radarr.state,'queue-failed');assert.equal(report.observations.radarr.reportedBy,'recovery');
 assert.equal(report.observations.record.age,'fresh');assert.ok(Number.isFinite(Date.parse(report.generatedAt)));
 walk(report,v=>{if(typeof v==='string'&&!/^[a-z0-9:._ -]+$/i.test(v))assert.fail('free text in report: '+v);});
 assert.equal(f.calls.length,calls,'no Tdarr or Radarr request');
 assert.equal(await snap(),before,'no file, journal, deferral, approval, quarantine or retention change');
});

test('equal IDs from different sources never mix, and unknown or malformed identifiers are refused without reading',linux,async t=>{
 const {f,snap}=await seeded(t);
 const review=await (await f.request(route('radarr',recoveryId))).json();
 assert.equal(review.case.source,'radarr');assert.equal(review.caseRecord,'not-applicable');assert.equal(review.observations.radarr.state,'not-reported');
 const recovery=await (await f.request(route('recovery',recoveryId))).json();assert.equal(recovery.case.source,'recovery');assert.equal(recovery.observations.radarr.state,'queue-failed','the Review case does not inherit or leak the Recovery queue');
 const before=await snap(),calls=f.calls.length;
 for(const raw of [route('recovery',absentId),route('radarr',absentId),'/api/cases/recovery/'+'A'.repeat(24)+'/diagnostic-export','/api/cases/recovery/..%2f..%2fetc%2fpasswd/diagnostic-export','/api/cases/sonarr/'+recoveryId+'/diagnostic-export','/api/cases/recovery/'+'a'.repeat(23)+'/diagnostic-export']){
  const answer=await f.request(raw);assert.equal(answer.status,404,raw);const body=await answer.text();assert.doesNotMatch(body,/passwd|etc|aaaa/,'the identifier is not echoed');
 }
 assert.equal((await f.request(route('recovery',recoveryId),{method:'POST',body:{}})).status,404,'only GET exists');
 assert.equal(f.calls.length,calls);assert.equal(await snap(),before);
});

test('stale, inconsistent and missing evidence is reported as unknown or unverified, never as healthy or approved',linux,async t=>{
 const {f,snap}=await seeded(t);
 const stale=await (await f.request(route('recovery',staleId))).json();
 assert.equal(stale.state.reason,'fault-not-confirmed');assert.equal(stale.observations.record.age,'stale');assert.equal(stale.verification,'not-verified');
 assert.doesNotMatch(JSON.stringify(stale),/healthy|approved|corrupt|"verification":"verified/);
 // The case record now disagrees with the reported phase, then disappears.
 const stateFile=path.join(f.data,'recovery','state.json'),cases=JSON.parse(await fs.readFile(stateFile,'utf8'));
 await fs.writeFile(stateFile,JSON.stringify({version:1,cases:{...cases.cases,[otherId]:{...cases.cases[otherId],status:'waiting'}}}));
 const inconsistent=await (await f.request(route('recovery',otherId))).json();assert.equal(inconsistent.caseRecord,'inconsistent');assert.equal(inconsistent.completeness,'partial');
 await fs.writeFile(stateFile,JSON.stringify({version:1,cases:{}}));
 const missing=await (await f.request(route('recovery',otherId))).json();assert.equal(missing.caseRecord,'missing');assert.equal(missing.completeness,'partial');
 await fs.writeFile(stateFile,'{broken');
 const unreadable=await (await f.request(route('recovery',otherId))).json();assert.equal(unreadable.caseRecord,'unreadable');assert.equal(unreadable.unknown.includes('case-binding'),true);
 await fs.writeFile(stateFile,JSON.stringify(cases));
});

test('a deferred case exports its state without the note and deferral and approval records stay unchanged',linux,async t=>{
 const {f,snap}=await seeded(t);
 const overview=await f.get('/api/radarr/requests'),record=overview.requests.find(r=>r.id===recoveryId&&r.source==='recovery'),defer=record.attention.actions.find(a=>a.id==='defer');
 assert.ok(record.attention.actions.some(a=>a.id==='exportDiagnostic'&&a.changes==='nothing'),'the server lists the export action');
 assert.deepEqual(record.attention.actions.find(a=>a.id==='exportDiagnostic'),{id:'exportDiagnostic',changes:'nothing'});
 assert.ok(overview.requests.find(r=>r.id===recoveryId&&!r.source),'Review-owned case present');
 const saved=await f.post('/api/recovery/cases/'+recoveryId+'/defer',{confirm:true,revision:defer.revision,note:'SENTINEL-NOTE keep'});
 if(saved.status!==200){const failed=await saved.text();assert.fail(failed);}
 const before=await snap(),calls=f.calls.length;
 const text=await (await f.request(route('recovery',recoveryId))).text(),report=JSON.parse(text);
 assert.equal(report.deferral.recorded,'deferred');assert.equal(report.deferral.bindingVerified,false);assert.equal(report.deferral.fingerprintChecked,false);assert.equal(text.includes('SENTINEL-NOTE'),false);
 assert.equal(JSON.parse(await (await f.request(route('radarr',recoveryId))).text()).deferral.recorded,'not-deferred','the other source has no deferral');
 assert.equal(f.calls.length,calls);assert.equal(await snap(),before,'deferral record and revision are untouched');
 const after=(await f.get('/api/radarr/requests')).requests.find(r=>r.id===recoveryId&&r.source==='recovery');assert.equal(after.deferral.state,'deferred');assert.equal(after.deferral.note,'SENTINEL-NOTE keep');
});

test('the export classifies exactly what the attention overview shows, including a missing Tdarr row and an unbound retention error',linux,async t=>{
 const {f,snap}=await seeded(t);
 const overview=await f.get('/api/radarr/requests'),before=await snap();
 const A=overview.requests.find(r=>r.id===missingRowId&&r.source==='recovery'),B=overview.requests.find(r=>r.id===unboundId&&r.source==='recovery');
 assert.equal(A.attention.reason,'tdarr-missing','scenario A as the UI shows it');assert.equal(B.attention.reason,'case-error','scenario B as the UI shows it');
 let compared=0;
 for(const record of overview.requests){
  const source=record.source==='recovery'?'recovery':'radarr',answer=await f.request(route(source,record.id));
  if(record.attention){
   assert.equal(answer.status,200,source+' '+record.id);const report=await answer.json();
   assert.equal(report.state.category,'attention');assert.equal(report.state.reason,record.attention.reason,source+' '+record.id);compared++;
   assert.ok(record.attention.actions.some(a=>a.id==='exportDiagnostic'),'the action is offered exactly where the export exists');
  }else assert.equal(answer.status,404,'no action and no export outside attention: '+source+' '+record.id);
 }
 assert.ok(compared>=5);
 const reportA=await (await f.request(route('recovery',missingRowId))).json();assert.equal(reportA.state.reason,'tdarr-missing');assert.equal(reportA.unknown.includes('tdarr-row'),true);assert.equal(reportA.verification,'not-verified');
 const reportB=await (await f.request(route('recovery',unboundId))).text();assert.equal(JSON.parse(reportB).state.reason,'case-error');assert.equal(reportB.includes('SENTINEL'),false);
 assert.equal(await snap(),before,'exports write nothing');
});
