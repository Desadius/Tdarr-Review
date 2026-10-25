import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {reviewFixture} from './test-helpers/review-fixture.mjs';
import {linuxServer as linux} from './test-helpers/server.mjs';
import {identityOf} from '../recovery/file-identity.mjs';
import {approvalEvidencePath} from '../recovery/quarantine-retention.mjs';

const run=promisify(execFile);

// The attention routes through the real server (#229): the overview and the read-only refresh.
test('HTTP refresh of Recovery attention reads only and validates its case keys',linux,async t=>{
 const f=await reviewFixture();t.after(()=>f.close());
 const overview=await f.get('/api/radarr/requests');assert.ok(Array.isArray(overview.requests));
 const before=f.calls.filter(c=>c.route.startsWith('/api/v2/')&&c.route!=='/api/v2/get-nodes'&&c.route!=='/api/v2/cruddb').length;
 const all=await f.post('/api/recovery/refresh',{});assert.equal(all.status,200,await all.clone().text());assert.ok(Array.isArray((await all.json()).requests));
 const named=await f.post('/api/recovery/refresh',{keys:['recovery:'+'a'.repeat(24)]});assert.equal(named.status,200);
 for(const keys of [['recovery:short'],'recovery:'+'a'.repeat(24),[42],Array.from({length:501},()=>'radarr:'+'a'.repeat(24))]){
  const refused=await f.post('/api/recovery/refresh',{keys});assert.equal(refused.status,400,JSON.stringify(keys).slice(0,40));assert.equal((await refused.json()).code,'refresh_invalid');
 }
 assert.equal(f.calls.filter(c=>c.route.startsWith('/api/v2/')&&c.route!=='/api/v2/get-nodes'&&c.route!=='/api/v2/cruddb').length,before,'no Tdarr write');
 assert.deepEqual(f.changes,[],'no node was paused');
});

test('HTTP retention diagnosis is bound to fresh Recovery and Review cases and preserves state and quarantine',linux,async t=>{
 const id='a'.repeat(24),reviewId='b'.repeat(24),staleId='c'.repeat(24),unknownId='d'.repeat(24),fifoId='e'.repeat(24),invalidId='f'.repeat(24),changedId='1'.repeat(24),metadataId='2'.repeat(24),reviewFifoId='3'.repeat(24);let expected,extra=[];
 const f=await reviewFixture({beforeStart:async({data,root,media,mockBase})=>{
  const original=path.join(media,'A','A.mkv'),quarantineRoot=path.join(root,'quarantine'),quarantine=path.join(quarantineRoot,id,'A.mkv');
  await fs.mkdir(path.dirname(quarantine),{recursive:true});await fs.copyFile(original,quarantine);
  const fp=identityOf(await fs.stat(quarantine)),replacementFP=identityOf(await fs.stat(original));
  const config={enabled:false,tdarrUrl:mockBase,radarrUrl:mockBase,radarrApiKey:'synthetic-private-key',libraryId:'fixture-library',sourceRoot:'/fixture-library',radarrRoot:'/fixture-library',mediaRoot:media,reviewRoot:path.join(root,'review'),quarantineRoot,reports:path.join(root,'reports'),database:path.join(root,'tdarr.db'),ffmpeg:'/usr/bin/ffmpeg',stableMinutes:0,decodeTimeoutHours:1,confirmDelaySeconds:1,maxRepairsPerDay:1,movieCooldownDays:0,pollSeconds:1,since:0,reviewPrefixes:['PROD-Movies']};
  await fs.mkdir(path.join(data,'recovery'),{recursive:true});await fs.writeFile(path.join(data,'recovery','config.json'),JSON.stringify(config));
  const staleQuarantine=path.join(quarantineRoot,staleId,'A.mkv');await fs.mkdir(path.dirname(staleQuarantine),{recursive:true});await fs.copyFile(original,staleQuarantine);
  const staleFP=identityOf(await fs.stat(staleQuarantine));
  const bOriginal=path.join(media,'B','B.mkv'),fifoQuarantine=path.join(quarantineRoot,fifoId,'B.mkv');await fs.mkdir(path.dirname(fifoQuarantine),{recursive:true});await fs.copyFile(bOriginal,fifoQuarantine);
  const fifoSourceFP=identityOf(await fs.stat(bOriginal)),fifoFP=identityOf(await fs.stat(fifoQuarantine));
  const fifoEvidence=await approvalEvidencePath(media,'B/B.mkv',fifoSourceFP);await fs.mkdir(path.dirname(fifoEvidence),{recursive:true});await run('mkfifo',[fifoEvidence]);
  const c={id,status:'replacement_imported',source:original,relative:'A/A.mkv',fp,replacementRelative:'A/A.mkv',replacementSourceFP:replacementFP,quarantine,retentionError:'private error sentinel'};
  const staleCase={...c,id:staleId,fp:staleFP,quarantine:staleQuarantine,retentionError:'fresh private retention reason'};
  const fifoCase={...c,id:fifoId,source:bOriginal,relative:'B/B.mkv',fp:fifoFP,replacementRelative:'B/B.mkv',replacementSourceFP:fifoSourceFP,quarantine:fifoQuarantine,retentionError:'private FIFO evidence case'};
  for(const [caseId,kind] of [[invalidId,'invalid'],[changedId,'changed'],[metadataId,'metadata'],['4'.repeat(24),'corrupt-path']]){
   const dir=path.join(media,'diagnosis',caseId),caseOriginal=path.join(dir,'original.mkv'),replacement=path.join(dir,'replacement.mkv'),installed=path.join(dir,'approved.mkv'),caseQuarantine=path.join(quarantineRoot,caseId,'original.mkv');
   await fs.mkdir(dir,{recursive:true});await fs.writeFile(caseOriginal,'synthetic original');await fs.writeFile(replacement,'synthetic replacement');await fs.mkdir(path.dirname(caseQuarantine),{recursive:true});await fs.copyFile(caseOriginal,caseQuarantine);
   const replacementRelative=`diagnosis/${caseId}/replacement.mkv`,replacementSourceFP=identityOf(await fs.stat(replacement)),caseRecord={...c,id:caseId,source:caseOriginal,relative:`diagnosis/${caseId}/original.mkv`,fp:identityOf(await fs.stat(caseQuarantine)),replacementRelative,replacementSourceFP,quarantine:caseQuarantine,retentionError:`private ${kind} evidence reason`};
   if(kind==='corrupt-path')caseRecord.quarantine={malformed:'not a path'};
   await fs.writeFile(installed,'approved synthetic copy');const installedRelative=`diagnosis/${caseId}/approved.mkv`,installedFP=identityOf(await fs.stat(installed)),approvalFile=await approvalEvidencePath(media,replacementRelative,replacementSourceFP);await fs.mkdir(path.dirname(approvalFile),{recursive:true});
   const approval=kind==='invalid'?{version:1}:{version:1,relative:replacementRelative,sourceFP:replacementSourceFP,installedRelative,installedFP,approvedAt:new Date().toISOString()};await fs.writeFile(approvalFile,JSON.stringify(approval));
   if(kind==='changed')await fs.appendFile(installed,' changed');if(kind==='metadata')await fs.chmod(installed,0o600);
   extra.push({id:caseId,kind,caseRecord,caseQuarantine,installed,approvalFile});
  }
  const stateFile=path.join(data,'recovery','state.json');await fs.writeFile(stateFile,JSON.stringify({version:1,cases:{[id]:c,[staleId]:staleCase,[fifoId]:fifoCase,...Object.fromEntries(extra.map(item=>[item.id,item.caseRecord]))}}));
  await fs.writeFile(path.join(data,'radarr.json'),JSON.stringify({url:mockBase,apiKey:'synthetic-radarr-key',mediaRoot:'/fixture-library',preferCzechEnglish:true}));
  const reviewQuarantineRoot=path.join(path.dirname(media),'.tdarr-review-quarantine'),reviewQuarantine=path.join(reviewQuarantineRoot,reviewId,'A.mkv');
  await fs.mkdir(path.dirname(reviewQuarantine),{recursive:true});await fs.copyFile(original,reviewQuarantine);
  const reviewRecord={id:reviewId,created:new Date().toISOString(),phase:'imported',retentionError:'private review retention sentinel',radarrUrl:mockBase,radarrRoot:'/fixture-library',mediaRoot:media,reviewRoot:path.join(root,'review'),replacementRelative:'A/A.mkv',replacementSourceFP:replacementFP,originalQuarantine:reviewQuarantine,originalFP:identityOf(await fs.stat(reviewQuarantine))};
  await fs.mkdir(path.join(data,'radarr-replacements'),{recursive:true});const reviewJournal=path.join(data,'radarr-replacements',reviewId+'.json');await fs.writeFile(reviewJournal,JSON.stringify(reviewRecord));
  const reviewFifoQuarantine=path.join(reviewQuarantineRoot,reviewFifoId,'B.mkv');await fs.mkdir(path.dirname(reviewFifoQuarantine),{recursive:true});await fs.copyFile(bOriginal,reviewFifoQuarantine);
  const reviewFifoRecord={...reviewRecord,id:reviewFifoId,retentionError:'private Review FIFO retention sentinel',replacementRelative:'B/B.mkv',replacementSourceFP:fifoSourceFP,originalQuarantine:reviewFifoQuarantine,originalFP:identityOf(await fs.stat(reviewFifoQuarantine))};
  const reviewFifoJournal=path.join(data,'radarr-replacements',reviewFifoId+'.json');await fs.writeFile(reviewFifoJournal,JSON.stringify(reviewFifoRecord));
  const statusFile=path.join(path.dirname(media),'.tdarr-recovery-status.json');await fs.writeFile(statusFile,JSON.stringify({version:1,updated:new Date().toISOString(),cases:[
   {id,phase:'replacement_imported',title:'Synthetic retention film',statusUpdated:new Date().toISOString(),tdarrStatus:'Queued',error:'private error sentinel',retentionErrorPresent:true},
   {id:staleId,phase:'replacement_imported',title:'Synthetic stale retention flag',statusUpdated:new Date().toISOString(),tdarrStatus:'Queued',error:'stale public error sentinel',retentionErrorPresent:false},
   {id:unknownId,phase:'replacement_imported',title:'Synthetic unbound retention case',statusUpdated:new Date().toISOString(),tdarrStatus:'Queued',error:'unbound public error sentinel',retentionErrorPresent:true},
   {id:fifoId,phase:'replacement_imported',title:'Synthetic FIFO evidence case',statusUpdated:new Date().toISOString(),tdarrStatus:'Queued',error:'private FIFO evidence sentinel',retentionErrorPresent:true},
   {id:reviewFifoId,phase:'imported',title:'Synthetic Review FIFO evidence case',statusUpdated:new Date().toISOString(),tdarrStatus:'Queued',error:'private Review FIFO evidence sentinel'},
   ...extra.map(({id:extraId,kind})=>({id:extraId,phase:'replacement_imported',title:`Synthetic ${kind} evidence case`,statusUpdated:new Date().toISOString(),tdarrStatus:'Queued',error:`public ${kind} sentinel`,retentionErrorPresent:true}))
  ]}));
  for(const item of extra)item.expectedQuarantine=await fs.readFile(item.caseQuarantine);
  expected={stateFile,reviewJournal,reviewFifoJournal,reviewFifoQuarantine,reviewFifoExpected:await fs.readFile(reviewFifoQuarantine),reviewQuarantine,quarantine,staleQuarantine,fifoQuarantine,fifoEvidence,original,expectedOriginal:await fs.readFile(original),expectedQuarantine:await fs.readFile(quarantine),expectedStaleQuarantine:await fs.readFile(staleQuarantine),expectedFifoQuarantine:await fs.readFile(fifoQuarantine),expectedReviewQuarantine:await fs.readFile(reviewQuarantine),extra};
 }});t.after(()=>f.close());
 const beforeState=await fs.readFile(expected.stateFile),beforeReview=await fs.readFile(expected.reviewJournal),beforeReviewFifo=await fs.readFile(expected.reviewFifoJournal),requestStarted=Date.now(),response=await f.get('/api/radarr/requests'),record=response.requests.find(item=>item.id===id),reviewRecord=response.requests.find(item=>item.id===reviewId),reviewFifo=response.requests.find(item=>item.id===reviewFifoId),staleRecord=response.requests.find(item=>item.id===staleId),unknownRecord=response.requests.find(item=>item.id===unknownId),fifoRecord=response.requests.find(item=>item.id===fifoId),extraRecords=Object.fromEntries(expected.extra.map(item=>[item.kind,response.requests.find(record=>record.id===item.id)]));assert.ok(record);assert.ok(reviewRecord);assert.ok(reviewFifo);assert.ok(staleRecord);assert.ok(unknownRecord);assert.ok(fifoRecord);assert.ok(Object.values(extraRecords).every(Boolean));assert.ok(Date.now()-requestStarted<5000,'a special evidence file cannot block the HTTP diagnosis');assert.deepEqual(record.attention.retentionDiagnosis,{status:'verified',reason:'approval-evidence-missing'},JSON.stringify(record));
 assert.equal(record.attention.recommended,'refresh');assert.ok(record.attention.blockers.includes('retention-evidence'));
 assert.doesNotMatch(JSON.stringify(record),/private error sentinel|synthetic-private-key|synthetic-radarr-key|\\media\\|\/media\//);
 assert.deepEqual(await fs.readFile(expected.stateFile),beforeState);
 assert.deepEqual(reviewRecord.attention.retentionDiagnosis,{status:'verified',reason:'approval-evidence-missing'},JSON.stringify(reviewRecord));assert.equal(reviewRecord.retentionErrorPresent,true,'the fresh matching Review journal also sets the safe presentation marker');assert.deepEqual(await fs.readFile(expected.reviewJournal),beforeReview);
 assert.deepEqual(reviewFifo.attention.retentionDiagnosis,{status:'unavailable',reason:'approval-evidence-unavailable'},JSON.stringify(reviewFifo));assert.equal(reviewFifo.retentionErrorPresent,true,'a matching Review retention case stays visible when approval evidence is unreadable');assert.doesNotMatch(JSON.stringify(reviewFifo),/private Review FIFO retention sentinel|synthetic-private-key|synthetic-radarr-key/);assert.deepEqual(await fs.readFile(expected.reviewFifoJournal),beforeReviewFifo);assert.deepEqual(await fs.readFile(expected.reviewFifoQuarantine),expected.reviewFifoExpected);
 assert.deepEqual(staleRecord.attention.retentionDiagnosis,{status:'verified',reason:'approval-evidence-missing'},JSON.stringify(staleRecord));
 assert.equal(staleRecord.retentionErrorPresent,true,'the response derives the retention marker from the fresh matching private case');
 assert.doesNotMatch(JSON.stringify(staleRecord),/stale public error sentinel|fresh private retention reason/);
 assert.deepEqual(unknownRecord.attention.retentionDiagnosis,{status:'unavailable',reason:'case-binding-unavailable'},JSON.stringify(unknownRecord));assert.equal(unknownRecord.retentionErrorPresent,false);assert.match(unknownRecord.error,/Vazbu případu nelze ověřit/);assert.doesNotMatch(JSON.stringify(unknownRecord),/unbound public error sentinel/);
 assert.deepEqual(fifoRecord.attention.retentionDiagnosis,{status:'unavailable',reason:'approval-evidence-unavailable'},JSON.stringify(fifoRecord));assert.equal((await fs.lstat(expected.fifoEvidence)).isFIFO(),true);
 assert.deepEqual(extraRecords.invalid.attention.retentionDiagnosis,{status:'verified',reason:'approval-evidence-invalid'});
 assert.deepEqual(extraRecords.changed.attention.retentionDiagnosis,{status:'verified',reason:'approved-copy-changed'});
 assert.deepEqual(extraRecords.metadata.attention.retentionDiagnosis,{status:'verified',reason:'approved-copy-metadata-changed'});
 assert.deepEqual(extraRecords['corrupt-path'].attention.retentionDiagnosis,{status:'unavailable',reason:'quarantine-binding-unavailable'});
 for(const item of expected.extra){assert.doesNotMatch(JSON.stringify(extraRecords[item.kind]),/private .* evidence reason|synthetic-private-key|synthetic-radarr-key|\\media\\|\/media\//);assert.deepEqual(await fs.readFile(item.caseQuarantine),item.expectedQuarantine);}
 assert.deepEqual(await fs.readFile(expected.quarantine),expected.expectedQuarantine);assert.deepEqual(await fs.readFile(expected.staleQuarantine),expected.expectedStaleQuarantine);assert.deepEqual(await fs.readFile(expected.fifoQuarantine),expected.expectedFifoQuarantine);assert.deepEqual(await fs.readFile(expected.reviewQuarantine),expected.expectedReviewQuarantine);assert.deepEqual(await fs.readFile(expected.original),expected.expectedOriginal);
 assert.equal(record.deleteAfter??null,null);assert.equal(record.approvedAt,undefined);
});
