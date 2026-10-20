import test from 'node:test';
import assert from 'node:assert/strict';
import {updateReviewSession,reviewComplete,emptyReviewSession} from './review-session.mjs';
import {workflowFixture} from './test-helpers/workflow-dom.mjs';

// The review-session rules the server and the browser both apply (#219): checks per step (HDR in the picture
// step), reachable steps (a track pair from synchronisation on), what a changed method, device or pair clears,
// and the named device for an external or HDR review. The server is the only authority for saving and
// completion; the browser is deliberately stricter and requires the device and the HDR confirmation before
// leaving a step. Each side is pinned here.
const keys=['preparation','image','audio','syncStart','syncMiddle','syncEnd','hdr'];
const checks=(...on)=>Object.fromEntries(keys.map(key=>[key,on.includes(key)]));
const session=({method='review',device='',step=0,on=[],pair=[1,2]}={})=>({...emptyReviewSession(),method,device,step,checks:checks(...on),scope:{originalIndex:pair?.[0]??null,reviewIndex:pair?.[1]??null,seconds:null}});
const confirmed=s=>keys.filter(key=>s.checks[key]);
const update=(from,to)=>{try{const s=updateReviewSession({session:session(from)},session(to));return {step:s.step,confirmed:confirmed(s)};}catch(e){return {error:e.code||e.message};}};

test('server: a changed method or device clears every confirmation and returns to the first step',()=>{
 assert.deepEqual(update({step:3,on:['preparation','image','audio']},{method:'external',device:'TV',step:3,on:['preparation','image','audio']}),{step:0,confirmed:[]});
 assert.deepEqual(update({method:'external',device:'TV one',step:2,on:['preparation','image']},{method:'external',device:'TV two',step:2,on:['preparation','image']}),{step:0,confirmed:[]});
});

test('server: a changed track pair clears audio and synchronisation and caps the step at audio',()=>{
 assert.deepEqual(update({step:3,on:['preparation','image','audio','syncStart']},{step:3,on:['preparation','image','audio','syncStart'],pair:[3,2]}),{step:2,confirmed:['preparation','image']});
});

test('server: steps open in order, synchronisation needs a pair, and HDR or the device do not gate a step',()=>{
 assert.deepEqual(update({step:0,on:['preparation']},{step:2,on:['preparation']}),{error:'review_previous_checks_first'});
 assert.deepEqual(update({step:2,on:['preparation','image','audio'],pair:null},{step:3,on:['preparation','image','audio'],pair:null}),{error:'review_previous_checks_first'});
 assert.deepEqual(update({step:1,on:['preparation','image']},{step:2,on:['preparation','image']}),{step:2,confirmed:['preparation','image']},'HDR confirmation is not needed to leave the picture step on the server');
 assert.deepEqual(update({method:'external',device:'X',step:0,on:['preparation']},{method:'external',device:'X',step:1,on:['preparation']}),{step:1,confirmed:['preparation']},'a short device does not gate a step on the server');
});

test('server: completion needs every step, a named device for an external or HDR review, and the HDR check',()=>{
 const all=['preparation','image','audio','syncStart','syncMiddle','syncEnd'];
 const done=(options,requirements={hdr:false})=>reviewComplete(session({step:4,on:all,...options}),requirements);
 assert.equal(done({}),true);
 assert.equal(done({pair:null}),false);
 assert.equal(done({method:'external',device:'X'}),false);
 assert.equal(done({method:'external',device:' TV '}),true);
 assert.equal(done({device:'TV'},{hdr:true}),false,'HDR check missing');
 assert.equal(done({device:'X',on:[...all,'hdr']},{hdr:true}),false,'HDR needs a named device');
 assert.equal(done({device:'TV',on:[...all,'hdr']},{hdr:true}),true);
 assert.equal(done({step:3}),false);
});

const selects=f=>f.host.querySelectorAll('select');
const device=f=>f.host.querySelectorAll('input').find(n=>n.type!=='checkbox'&&!n.readOnly);

test('browser: a changed method clears every confirmation; the new identity is saved first, then the step',async t=>{
 const f=await workflowFixture(t,{});await f.confirm('preparation');
 const method=selects(f)[0];method.value='external';await method.emit('change');
 assert.equal(f.check('preparation').checked,false);
 const named=device(f);named.value='TV';await named.emit('input');await f.confirm('preparation');await f.next().activate();
 assert.deepEqual(f.writes.map(w=>({step:w.session.step,confirmed:confirmed(w.session),method:w.session.method})),[{step:0,confirmed:[],method:'external'},{step:1,confirmed:['preparation'],method:'external'}]);
});

test('browser: a changed device clears every confirmation',async t=>{
 const f=await workflowFixture(t,{method:'external',device:'TV one'});await f.confirm('preparation');
 const named=device(f);named.value='TV two';await named.emit('input');
 assert.equal(f.check('preparation').checked,false);
});

test('browser: a changed track pair clears audio and synchronisation and caps the step at audio',async t=>{
 const f=await workflowFixture(t,{method:'external',device:'TV',step:3,checks:{preparation:true,image:true,audio:true,syncStart:true}});
 assert.equal(f.workflow.step,3);
 const original=selects(f)[0];original.value='';await original.emit('change');
 assert.equal(f.workflow.step,2);
 assert.equal(f.check('audio').checked,false,'the audio confirmation is cleared');
 await f.next().activate();assert.equal(f.writes.length,0,'without a pair the audio step cannot be saved');
});

test('browser: the picture step with HDR required needs the HDR confirmation before it can be left',async t=>{
 const f=await workflowFixture(t,{hdr:true,device:'TV',step:1,checks:{preparation:true}});
 await f.confirm('image');await f.next().activate();assert.equal(f.writes.length,0);assert.equal(f.workflow.step,1);
 await f.confirm('hdr');await f.next().activate();assert.equal(f.writes.at(-1).session.step,2);
});

test('browser: an external review needs a named device before the first step can be left',async t=>{
 const f=await workflowFixture(t,{method:'external',device:'X'});await f.confirm('preparation');
 await f.next().activate();assert.equal(f.writes.length,0);
 const named=device(f);named.value='TV';await named.emit('input');await f.confirm('preparation');await f.next().activate();
 assert.equal(f.writes.at(-1).session.step,1);
});

test('browser: the audio step cannot be left without a track pair',async t=>{
 const f=await workflowFixture(t,{step:2,pair:false,checks:{preparation:true,image:true}});
 await f.confirm('audio');await f.next().activate();assert.equal(f.writes.length,0);assert.equal(f.workflow.step,2);
});

test('browser: with HDR required a short device keeps the first step closed, also in the review tools',async t=>{
 const f=await workflowFixture(t,{hdr:true,device:'X'});await f.confirm('preparation');
 await f.next().activate();assert.equal(f.writes.length,0);assert.equal(f.workflow.step,0);
});
