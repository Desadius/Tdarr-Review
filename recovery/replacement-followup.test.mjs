import test from 'node:test';
import assert from 'node:assert/strict';
import {identity} from './policy.mjs';
import {replacementFollowup,replacementFollowupId,projectReplacementFollowups} from './replacement-followup.mjs';
import {classifyRecovery} from '../review/public/review-model.js';

function fixture(){
 const cfg={sourceRoot:'/media/movies'},relative='Film/new.mkv',fp='1:2:100:4:5',file=cfg.sourceRoot+'/'+relative;
 const child={id:identity(file,fp),movieId:1,file,relative,fp,size:100,binding:{movieFileId:11}};
 const parent={id:'a'.repeat(24),status:'replacement_imported',movieId:1,replacementRelative:relative,replacementSourceFP:fp,replacement:{movieFileId:11,size:100}};
 return {cfg,parent,child,state:{cases:{parent,child}}};
}
test('follow-up links only the unique exact imported source and current Radarr file',()=>{
 const f=fixture(),before=structuredClone(f.state);
 assert.equal(replacementFollowupId(f.parent,f),f.child.id);assert.deepEqual(f.state,before);
 for(const patch of [{fp:'different'},{relative:'Film/other.mkv'},{file:'/other/Film/new.mkv'},{size:101},{movieId:2},{binding:{movieFileId:12}},{id:'b'.repeat(24)}]){
  const x=fixture();Object.assign(x.child,patch);assert.equal(replacementFollowupId(x.parent,x),null);
 }
});
test('history without exact binding, approved sources and ambiguous entries never link',()=>{
 for(const patch of [{status:'manual'},{replacementSourceFP:null},{replacement:{movieFileId:11}},{cleanup:{approvedAt:'2026-10-12'}},{cleanup:{complete:true}}]){
  const f=fixture();Object.assign(f.parent,patch);assert.equal(replacementFollowupId(f.parent,f),null);
 }
 const f=fixture();f.state.cases.duplicate={...f.child};assert.equal(replacementFollowupId(f.parent,f),null);
});
test('ctime-only differences link display with an explicit flag, never rewriting identity or authority',()=>{
 const f=fixture();f.child.fp='1:2:100:4:6';f.child.id=identity(f.child.file,f.child.fp);const before=structuredClone(f.state);
 assert.deepEqual(replacementFollowup(f.parent,f),{id:f.child.id,binding:'ctime_changed'});assert.deepEqual(f.state,before);
 for(const fp of ['9:2:100:4:6','1:9:100:4:6','1:2:101:4:6','1:2:100:9:6','1:2:100:4:NaN']){
  f.child.fp=fp;f.child.id=identity(f.child.file,fp);assert.equal(replacementFollowup(f.parent,f),null);
 }
});
test('public follow-up is bounded, one level deep and contains no evidence or authority',()=>{
 const f=fixture(),child={id:f.child.id,source:'recovery',phase:'deferred_cooldown',statusUpdated:'2026-10-12T10:00:00Z',sourceRetained:true,nextRetryAt:'2026-10-13T10:00:00Z',sourcePath:'/private/file',approval:{secret:'SECRET'},cleanupComplete:true,error:'/private/error',replacementFollowup:{id:'recursive'}};
 const snapshot={cases:[{id:f.parent.id,replacementFollowupId:f.child.id},child]},out=projectReplacementFollowups(snapshot).cases[0].replacementFollowup;
 assert.equal(out.phase,'deferred_cooldown');assert.equal(out.hasError,true);assert.equal(out.sourceRetained,true);
 assert(!JSON.stringify(out).includes('private'));assert(!JSON.stringify(out).includes('SECRET'));assert(!Object.hasOwn(out,'cleanupComplete'));assert(!Object.hasOwn(out,'replacementFollowup'));assert(!Object.hasOwn(snapshot.cases[0],'replacementFollowup'));
 assert.equal(projectReplacementFollowups({cases:[snapshot.cases[0],child,{...child}]}).cases[0].replacementFollowup,undefined);
});
test('follow-up visibility never supplies mutation or approval capability to the parent',()=>{
 const f=fixture(),now=Date.parse('2026-10-12T10:00:00Z');
 const r={id:f.parent.id,source:'recovery',phase:'replacement_imported',statusUpdated:new Date(now).toISOString(),tdarrStatus:'Hold',replacementFollowupId:f.child.id};
 const next={id:f.child.id,source:'recovery',statusUpdated:r.statusUpdated};
 for(const [phase,category] of [['verifying','running'],['deferred_cooldown','waiting'],['deferred_limit','waiting'],['manual','attention'],['no_action','attention']]){
  const result=classifyRecovery({...r,replacementFollowup:{...next,phase,originalCheckKind:'healthy',cleanupComplete:true,approvedAt:r.statusUpdated}},now);
  assert.equal(result.category,category);assert.match(result.label,/Kontrola náhrady/);
 }
 const stale=classifyRecovery({...r,replacementFollowup:{...next,phase:'verifying',statusUpdated:new Date(now-20*60000).toISOString()}},now);assert.equal(stale.category,'unverified');assert.equal(stale.stale,true);
 const mismatch=classifyRecovery({...r,replacementFollowup:{...next,id:'c'.repeat(24),phase:'verifying'}},now);assert.match(mismatch.label,/pozastavená/);
});

 test('fresh child activity is not made stale by an old or missing parent observation',()=>{
 const f=fixture(),now=Date.parse('2026-10-12T10:00:00Z'),child={id:f.child.id,source:'recovery',phase:'verifying',statusUpdated:new Date(now).toISOString()};
 for(const parentTime of [null,'bad',new Date(now-30*60000).toISOString()]){
 const r={id:f.parent.id,source:'recovery',phase:'replacement_imported',statusUpdated:parentTime,replacementFollowupId:child.id,replacementFollowup:child};
 const result=classifyRecovery(r,now);assert.equal(result.category,'running');assert.equal(result.stale,false);assert.equal(result.unknown,false);assert.equal(result.warnings.length,0);
 const error=classifyRecovery({...r,error:'Quarantine identity changed'},now);assert.equal(error.category,'attention');assert(error.warnings.includes('Quarantine identity changed'));
 }
 });
 test('fresh parent cannot rescue missing or stale child timestamps',()=>{
 const f=fixture(),now=Date.parse('2026-10-12T10:00:00Z');
 for(const childTime of [null,'bad',new Date(now-30*60000).toISOString(),new Date(now+5*60000).toISOString()]){
 const r={id:f.parent.id,source:'recovery',phase:'replacement_imported',statusUpdated:new Date(now).toISOString(),replacementFollowupId:f.child.id,replacementFollowup:{id:f.child.id,source:'recovery',phase:'verifying',statusUpdated:childTime}};
 assert.equal(classifyRecovery(r,now).category,'unverified');
 }
 });

test('linked replacement followups retain Verify pause and original-location display evidence',()=>{
 const parentId='a'.repeat(24),childId='b'.repeat(24),fields={verifyPausedStep:'tdarr_handoff',originalOutsideLibrary:true,originalOutsideSince:'2026-10-13T10:00:00.000Z',originalRestoredAt:null};
 const out=projectReplacementFollowups({cases:[{id:parentId,source:'recovery',phase:'replacement_imported',replacementFollowupId:childId},{id:childId,source:'recovery',phase:'replacement_queue_intent',statusUpdated:'2026-10-13T10:00:00.000Z',...fields}]}).cases[0];
 for(const [key,value]of Object.entries(fields))assert.equal(out.replacementFollowup[key],value,key);
 assert.equal(classifyRecovery(out,Date.parse('2026-10-13T10:01:00.000Z')).category,'waiting');
});
