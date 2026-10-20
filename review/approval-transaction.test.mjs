import test from 'node:test';
import assert from 'node:assert/strict';
import {createApprovalTransaction} from './approval-transaction.mjs';

// The transaction driven in-process with recording fakes for files, Tdarr, records and activity.
function fixture({snapshot='snap',busy=false,duration=false,replace=async()=>{},journalPhase='complete',publish=async()=>{},libraries=async()=>[{_id:'lib',folder:'/library/'}]}={}){
 const events=[],recovery=[];
 const item={id:'item',title:'Film',relative:'Film/film.mkv',reviewRelative:'PROD/Film/film.mkv',snapshot:'snap',reviewRevision:3,jobId:'job',originalBytes:100,reviewBytes:40};
 const state={items:{item:{originalFP:'o-fp',reviewFP:'r-fp'}},reviewSessions:{item:{}},approvals:{item:{}},history:[]};
 const record=name=>async(...args)=>{events.push(name);return undefined;};
 const perform=createApprovalTransaction({
  getState:()=>state,getConfig:()=>({libraryId:'lib',sourceRoots:['/library'],reviewPrefixes:['PROD']}),recovery,
  reviewSessions:{approval:(id,snap,revision)=>{events.push('review-evidence');return {revision};}},
  files:{media:()=>'/media',review:()=>'/review',safeFile:async(root,relative)=>{events.push('safe-file:'+root);return {path:root+'/'+relative,fp:root+'-fp',stat:{}};},
   hash:()=>snapshot,captureReceipt:async()=>{events.push('receipt');return 'receipt';},cleanupReviewed:record('cleanup'),unlink:async file=>{events.push('unlink:'+file);},
   probe:async file=>{events.push('probe');return file;},inspect:()=>({durationMismatch:duration}),
   replaceChecked:async options=>{events.push('replace:'+options.destination);await options.beforeCommit();await replace(options);},
   newJournal:()=>{events.push('journal');return '/data/transactions/t1.json';},readJournal:async()=>{events.push('read-journal');return {id:'t1',phase:journalPhase};}},
  tdarr:{nodes:async()=>{events.push('nodes');return {};},workerBusy:()=>busy,pauseDispatch:record('pause'),verifyPaused:record('verify-paused'),resume:record('resume'),
   libraries:async()=>{events.push('libraries');return libraries();},rescan:async body=>{events.push('rescan:'+body._id+'|'+body.DB);}},
  records:{publishApproval:async entry=>{events.push('publish');await publish(entry);},recordRejection:async entry=>{events.push('rejection:'+entry.event);},recordDecision:async entry=>{events.push('decision:'+entry.outcome+':'+entry.transaction);}},
  activity:{start:entry=>events.push('start:'+entry.action),progress:()=>{},measured:()=>{},finish:()=>events.push('finish')},
  log:event=>events.push('log:'+event),forgetPreviews:record('forget-previews'),invalidateStats:()=>events.push('invalidate-stats'),save:record('save'),next:()=>events.push('next'),
 });
 return {perform,events,recovery,state,item};
}

test('an approval runs its steps in order: checks, pause, journaled replacement, evidence, rescan, cleanup, audit, resume',async()=>{
 const f=fixture(),outcome=await f.perform('approve',f.item);
 assert.equal(outcome.status,'success');assert.equal(outcome.savedBytes,60);
 assert.deepEqual(f.events,['start:approve','log:action.started','forget-previews','review-evidence','safe-file:/media','safe-file:/review','nodes','receipt','probe','probe','pause','journal','replace:/media/Film/film.mkv','verify-paused','publish','libraries','rescan:/library/Film/film.mkv|lib','cleanup','invalidate-stats','decision:success:t1','resume','save','finish','log:action.finished','next']);
 assert.equal(f.state.items.item,undefined);assert.equal(f.state.reviewSessions.item,undefined);assert.equal(f.state.approvals.item,undefined);assert.equal(f.state.history[0],outcome);
});

test('the server reservation hands over without a gap: the action is started before the first await',()=>{
 const f=fixture(),running=f.perform('approve',f.item);
 assert.deepEqual(f.events.slice(0,2),['start:approve','log:action.started']);
 return running;
});

test('changed files stop the approval before Tdarr is paused or anything moves, and nodes are still restored',async()=>{
 const f=fixture({snapshot:'other'}),outcome=await f.perform('approve',f.item);
 assert.equal(outcome.message,'Soubory se změnily. Obnov přehled.');
 for(const step of ['nodes','pause','journal','publish','cleanup'])assert.ok(!f.events.includes(step),step);
 assert.ok(!f.events.some(e=>e.startsWith('replace:')||e.startsWith('rescan:')));
 assert.deepEqual(f.events.slice(-6),['decision:error:null','resume','save','finish','log:action.finished','next']);
 assert.equal(f.state.items.item.originalFP,'o-fp','the item stays for another attempt');
});

test('a film Tdarr is processing and a duration difference are refused before the pause',async()=>{
 for(const [options,message] of [[{busy:true},'Tento film právě zpracovává Tdarr. Zkus akci po dokončení.'],[{duration:true},'Rozdílnou délku nelze schválit bez zvláštní kontroly.']]){
  const f=fixture(options),outcome=await f.perform('approve',f.item);
  assert.equal(outcome.message,message);assert.ok(!f.events.includes('pause'));assert.ok(f.events.includes('resume'));
 }
});

test('a failure after the pause with a finished journal takes the normal resume path and blocks nothing',async()=>{
 const f=fixture({replace:async()=>{throw Error('Během výměny se změnil stav nodů. Originál nebyl vyměněn.');},journalPhase:'aborted'}),outcome=await f.perform('approve',f.item);
 assert.equal(outcome.status,'error');assert.deepEqual(f.recovery,[]);
 assert.deepEqual(f.events.slice(f.events.indexOf('verify-paused')),['verify-paused','read-journal','decision:error:t1','resume','save','finish','log:action.finished','next']);
});

test('an unfinished journal becomes a pending recovery entry, nodes stay paused and the next approval is refused at once',async()=>{
 const f=fixture({replace:async()=>{throw Error('install failed');},journalPhase:'installed'}),outcome=await f.perform('approve',f.item);
 assert.equal(outcome.status,'error');
 assert.deepEqual(f.recovery,[{id:'t1',phase:'installed',journal:'/data/transactions/t1.json'}]);
 assert.ok(f.events.includes('log:transaction.unresolved'));assert.ok(!f.events.includes('resume'),'nodes are not resumed over an unfinished exchange');
 f.events.length=0;f.state.items.item={originalFP:'o-fp',reviewFP:'r-fp'};
 const next=await f.perform('approve',f.item);
 assert.equal(next.message,'Je nutné dokončit obnovu předchozí výměny.');
 assert.deepEqual(f.events,['start:approve','log:action.started','forget-previews','review-evidence','decision:error:null','save','finish','log:action.finished','next']);
});

test('a rejection removes only the review copy, archived before and after, and never pauses or rescans',async()=>{
 const f=fixture(),outcome=await f.perform('reject',f.item,false,'Synthetic reason');
 assert.equal(outcome.status,'success');assert.equal(outcome.rejectionReason,'Synthetic reason');assert.equal(outcome.savedBytes,0);
 assert.deepEqual(f.events,['start:reject','log:action.started','forget-previews','safe-file:/media','safe-file:/review','nodes','receipt','safe-file:/review','rejection:requested','unlink:/review/PROD/Film/film.mkv','cleanup','invalidate-stats','rejection:completed','resume','save','finish','log:action.finished','next']);
});

// As before the move, a rescan warning replaces an evidence warning instead of joining it.
test('evidence and rescan failures after the replacement become a warning on a successful approval; the rescan one wins',async()=>{
 const f=fixture({publish:async()=>{throw Error('evidence disk full');},libraries:async()=>{throw Error('Tdarr down');}}),outcome=await f.perform('approve',f.item);
 assert.equal(outcome.status,'success');
 assert.equal(outcome.warning,'Film je nahrazený, ale aktualizace údajů v Tdarru selhala: Tdarr down');
});
