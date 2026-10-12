import test from 'node:test';
import assert from 'node:assert/strict';
import {createReviewSessionStore,emptyReviewSession,publicReviewSession,ReviewSessionError,reviewRequirements,sanitizeReviewSession} from './review-session.mjs';

const ID='a'.repeat(24),SNAPSHOT='b'.repeat(64),OTHER='c'.repeat(64);
const checks={preparation:true,image:true,audio:true,syncStart:true,syncMiddle:true,syncEnd:true,hdr:true};
function fixture({hdr=false,save:saveHook,verify:verifyHook}={}){
 const state={items:{[ID]:{snapshot:SNAPSHOT,info:{reviewRequirements:{hdr}}}},reviewSessions:{}},saved=[];
 let actualSnapshot=SNAPSHOT,clock=0;
 const store=createReviewSessionStore({getState:()=>state,now:()=>new Date(Date.UTC(2026,9,12,10,0,clock++)).toISOString(),save:async()=>{await saveHook?.();saved.push(structuredClone(state))},verify:async(item,request)=>{
  await verifyHook?.(item,request);
  if(actualSnapshot!==request.snapshot)throw new ReviewSessionError('actual files changed',409);
  return {duration:100,originalIndexes:[1,3],reviewIndexes:[2,4],requirements:{hdr}};
 }});
 const write=session=>store.write(ID,{snapshot:SNAPSHOT,revision:store.get(ID,SNAPSHOT).revision,session});
 const complete=async(session={})=>{
  const baseline={...emptyReviewSession(),scope:{originalIndex:1,reviewIndex:2,seconds:5},...session};
  await write(baseline);
  return write({...baseline,step:4,checks});
 };
 return {state,saved,store,write,complete,changeFiles:()=>{actualSnapshot=OTHER}};
}
const conflict=error=>error instanceof ReviewSessionError&&error.status===409;
const invalid=error=>error instanceof ReviewSessionError&&error.status===400;

test('default and stale drafts contain no confirmations or client completion',()=>{
 const {store}=fixture();
 const empty=store.get(ID,SNAPSHOT);assert.equal(empty.revision,0);assert.equal(empty.updated,null);assert.equal(empty.complete,false);assert.deepEqual(empty.observations,{});
 assert(Object.values(empty.session.checks).every(value=>value===false));
 const stale={snapshot:OTHER,revision:8,version:1,session:{...emptyReviewSession(),checks,step:4,scope:{originalIndex:1,reviewIndex:2,seconds:5}},updated:new Date().toISOString(),complete:true};
 assert.equal(publicReviewSession(stale,SNAPSHOT).revision,0);
 assert.equal(publicReviewSession({...stale,snapshot:SNAPSHOT,version:2},SNAPSHOT).complete,false);
});

test('manual booleans and field bounds reject forged confirmations and omit unknown properties',()=>{
 for(const session of [{checks:{audio:'true'}},{checks:{audio:1}},{step:5},{step:1.5},{method:'automatic'},{scope:{originalIndex:-1}},{scope:{reviewIndex:0.5}},{scope:{seconds:Infinity}},{deferred:'yes'}])assert.throws(()=>sanitizeReviewSession(session),invalid);
 const value=sanitizeReviewSession({device:'x'.repeat(300),note:'y'.repeat(3000),complete:true,revision:999,checks:{image:true,diagnostic:true},observations:{audio:{at:'forged'}}});
 assert.equal(value.device.length,160);assert.equal(value.note.length,2000);assert.equal(value.checks.image,true);assert.equal(value.checks.audio,false);assert.equal(value.complete,undefined);assert.equal(value.observations,undefined);assert.equal(value.checks.diagnostic,undefined);
});

test('advancement requires previous manual checks and clearing a prerequisite resets later progress',async()=>{
 const {write,store}=fixture();
 await assert.rejects(write({...emptyReviewSession(),step:1}),invalid);
 await write({...emptyReviewSession(),scope:{originalIndex:1,reviewIndex:2,seconds:5}});
 await assert.rejects(write({...store.get(ID,SNAPSHOT).session,step:3,checks:{preparation:true,image:true}}),invalid);
 await write({...store.get(ID,SNAPSHOT).session,checks,step:4});
 const reset=await write({...store.get(ID,SNAPSHOT).session,checks:{...checks,preparation:false}});
 assert.equal(reset.session.step,0);assert(Object.values(reset.session.checks).every(value=>value===false));assert.equal(reset.complete,false);assert.deepEqual(reset.observations,{});
});

test('actual source changes and state snapshot changes reject old confirmations',async()=>{
 const f=fixture();await f.complete();f.changeFiles();
 await assert.rejects(f.write(f.store.get(ID,SNAPSHOT).session),conflict);
 assert.equal(f.saved.length,2);
 f.state.items[ID].snapshot=OTHER;
 assert.equal(f.store.get(ID,OTHER).revision,0);assert.equal(f.store.get(ID,OTHER).complete,false);
 await assert.rejects(f.store.write(ID,{snapshot:SNAPSHOT,revision:2,session:emptyReviewSession()}),conflict);
});

test('simultaneous writes with the same revision cannot both succeed across metadata awaits',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve});
 const {store,saved}=fixture({verify:()=>gate});
 const request={snapshot:SNAPSHOT,revision:0,session:emptyReviewSession()};
 const result=Promise.allSettled([store.write(ID,request),store.write(ID,request)]);assert.equal(store.busy,true);release();
 const writes=await result;await store.idle();assert.equal(store.busy,false);
 assert.equal(writes.filter(value=>value.status==='fulfilled').length,1);assert(conflict(writes.find(value=>value.status==='rejected').reason));assert.equal(saved.length,1);assert.equal(store.get(ID,SNAPSHOT).revision,1);
});

test('audio pair change clears audio and all sync checks until a later explicit confirmation',async()=>{
 const {complete,store,write}=fixture();const initial=await complete();assert.equal(initial.complete,true);
 const changed=await write({...initial.session,scope:{originalIndex:3,reviewIndex:4,seconds:20}});
 assert.equal(changed.session.step,2);assert.equal(changed.session.checks.image,true);assert.equal(changed.complete,false);
 for(const name of ['audio','syncStart','syncMiddle','syncEnd']){assert.equal(changed.session.checks[name],false);assert.equal(changed.observations[name],undefined)}
 const confirmed=await write({...changed.session,checks,step:4});assert.equal(confirmed.complete,true);assert.equal(confirmed.observations.audio.scope.originalIndex,3);
 assert.equal(store.approval(ID,SNAPSHOT,confirmed.revision).revision,confirmed.revision);
});

test('scope rejects nonexistent streams and times outside the current shortest file',async()=>{
 const {write,saved}=fixture();
 for(const scope of [{originalIndex:0,reviewIndex:2,seconds:5},{originalIndex:1,reviewIndex:9,seconds:5},{originalIndex:1,reviewIndex:2,seconds:100}])await assert.rejects(write({...emptyReviewSession(),scope}),invalid);
 assert.equal(saved.length,0);
 await assert.rejects(write({...emptyReviewSession(),checks,step:4}),invalid);
 assert.equal(saved.length,0);
});

test('external review requires a device and device or method changes clear attestations',async()=>{
 const {complete,write}=fixture();
 const noDevice=await complete({method:'external',scope:{originalIndex:1,reviewIndex:2,seconds:null}});assert.equal(noDevice.complete,false);
 const device=await write({...noDevice.session,device:'TV / external player'});assert.equal(device.session.step,0);assert(Object.values(device.session.checks).every(value=>!value));
 const done=await write({...device.session,checks,step:4});assert.equal(done.complete,true);assert.equal(done.observations.syncEnd.scope.seconds,null);assert.equal(done.observations.syncEnd.device,'TV / external player');
 const changed=await write({...done.session,device:'Different TV'});assert.equal(changed.complete,false);assert.deepEqual(changed.observations,{});
 const method=await write({...changed.session,checks,step:4,method:'review'});assert.equal(method.session.step,0);assert.equal(method.complete,false);
});

test('HDR is derived from stream metadata and requires explicit HDR check at a named device',async()=>{
 for(const video of [{color_transfer:'smpte2084'},{color_transfer:'arib-std-b67'},{side_data_list:[{side_data_type:'DOVI configuration record'}]}])assert.equal(reviewRequirements({streams:[{codec_type:'video',...video}]}).hdr,true);
 assert.equal(reviewRequirements({streams:[{codec_type:'video',color_transfer:'bt709'}]}).hdr,false);
 assert.equal(reviewRequirements({streams:[{codec_type:'video',color_transfer:'smpte2084',disposition:{attached_pic:1}}]}).hdr,false);
 const {complete,write}=fixture({hdr:true});let current=await complete();assert.equal(current.requirements.hdr,true);assert.equal(current.complete,false);
 current=await write({...current.session,device:'HDR display'});current=await write({...current.session,step:4,checks:{...checks,hdr:false}});assert.equal(current.complete,false);
 current=await write({...current.session,checks});assert.equal(current.complete,true);assert.equal(current.observations.hdr.device,'HDR display');
});

test('deferral requires a note and blocks approval despite completed manual checks',async()=>{
 const {complete,write,store}=fixture();const completed=await complete();
 await assert.rejects(write({...completed.session,deferred:true,note:'  '}),invalid);
 const deferred=await write({...completed.session,deferred:true,note:'Verify the final dialogue on the TV tomorrow.'});assert.equal(deferred.complete,false);assert.equal(deferred.session.checks.audio,true);
 assert.throws(()=>store.approval(ID,SNAPSHOT,deferred.revision),conflict);
 const resumed=await write({...deferred.session,deferred:false});assert.equal(resumed.complete,true);
});

test('each region keeps server-timed observation of its actual scope while seconds changes',async()=>{
 const {write,store}=fixture();
 await write({...emptyReviewSession(),scope:{originalIndex:1,reviewIndex:2,seconds:5}});
 let current=await write({...store.get(ID,SNAPSHOT).session,step:3,checks:{preparation:true,image:true,audio:true,syncStart:true}});
 const start=current.observations.syncStart;assert.equal(start.scope.seconds,5);
 current=await write({...current.session,scope:{...current.session.scope,seconds:50},checks:{...current.session.checks,syncMiddle:true},observations:{syncStart:{at:'forged'}}});
 assert.deepEqual(current.observations.syncStart,start);assert.equal(current.observations.syncMiddle.scope.seconds,50);
 current=await write({...current.session,step:4,scope:{...current.session.scope,seconds:95},checks:{...current.session.checks,syncEnd:true}});
 assert.equal(current.complete,true);assert.deepEqual(current.observations.syncStart,start);assert.equal(current.observations.syncEnd.scope.seconds,95);assert.notEqual(current.observations.syncMiddle.at,current.observations.syncEnd.at);
 current=await write({...current.session,checks:{...current.session.checks,syncMiddle:false}});assert.equal(current.session.step,3);assert.equal(current.observations.syncMiddle,undefined);assert.deepEqual(current.observations.syncStart,start);
});

test('approval requires current revision and returns immutable sanitized history evidence',async()=>{
 const {complete,store,state}=fixture();const completed=await complete();
 for(const revision of [undefined,completed.revision-1,'2'])assert.throws(()=>store.approval(ID,SNAPSHOT,revision),conflict);
 const receipt=store.approval(ID,SNAPSHOT,completed.revision);state.reviewSessions[ID].session.note='changed';state.reviewSessions[ID].observations.audio.scope.seconds=80;
 assert.equal(receipt.session.note,'');assert.equal(receipt.observations.audio.scope.seconds,5);
});

test('failed durable save rolls back the draft and leaves the queue usable',async()=>{
 let broken=true;const {write,store,saved}=fixture({save:()=>{if(broken)throw Error('disk write failed')}});
 await assert.rejects(write(emptyReviewSession()),/disk write failed/);await store.idle();assert.equal(store.get(ID,SNAPSHOT).revision,0);assert.equal(store.busy,false);assert.equal(saved.length,0);
 broken=false;const stored=await write(emptyReviewSession());assert.equal(stored.revision,1);assert.equal(saved.length,1);
});
