import test from 'node:test';
import assert from 'node:assert/strict';
import {workflowFixture,flush} from './test-helpers/workflow-dom.mjs';
import {resumePoint,segmentChecks} from './public/continuous-review.js';

const ALL=['preparation','image','audio','syncStart','syncMiddle','syncEnd'];
const confirmed=write=>ALL.filter(key=>write.session.checks[key]);
const chip=(fixture,key)=>fixture.stage().querySelectorAll('[data-review-check]').find(node=>node.dataset.reviewCheck===key)?.dataset.state;
const done=(fixture,excerptIndex)=>{fixture.playerOptions().onPlaybackState({status:'done',excerptIndex,excerptCount:3});return flush()};
// A film whose preparation is saved and whose guided context is current.
const prepared={strict:true,checks:{preparation:true},comparison:{mode:'guided-switch',swapEars:false,excerpts:[1,49,83]}};

test('the review opens as a single pass whose playback never confirms or writes anything',async t=>{
 const fixture=await workflowFixture(t,{openGuided:true});
 assert.ok(fixture.stage(),'the single-pass workspace is mounted');
 assert.equal(fixture.playerOptions().stage,true,'the guided player fills the stage');
 assert.match(fixture.stage().textContent,/correct original/i,'it starts with the preparation prompt');
 fixture.playerOptions().onPlaybackState({status:'playing',excerptIndex:1,excerptCount:3});
 await done(fixture,1);
 assert.equal(fixture.writes.length,0);
 for(const key of ALL)assert.equal(chip(fixture,key),'empty');
 assert.doesNotMatch(fixture.host.textContent,/not saved yet|není uložená|Save all confirmations/i,'no per-check saved notices or global save button');
});

test('Enter on the start prompt saves the preparation with the guided context, then plays the first excerpt once',async t=>{
 const fixture=await workflowFixture(t,{openGuided:true,strict:true});
 await fixture.press('Enter');await flush();
 assert.deepEqual(fixture.writes.map(confirmed),[['preparation']],'the guided context is saved together with the preparation');
 assert.equal(fixture.writes[0].session.comparison.mode,'guided-switch','new reviews use the switch listening mode');
 assert.deepEqual(fixture.player.commands.at(-1),['excerpt',{index:0,play:true}]);
 assert.equal(chip(fixture,'preparation'),'saved');
});

test('after an excerpt the prompt sets nothing until a key is pressed; Enter saves picture, sound and that sync in order',async t=>{
 const fixture=await workflowFixture(t,{openGuided:true,...prepared});
 await fixture.press('Enter');await done(fixture,0);
 assert.match(fixture.stage().textContent,/Excerpt 1 finished/);
 await flush();assert.equal(fixture.writes.length,0,'the prompt alone records nothing');
 for(const key of ['image','audio','syncStart'])assert.equal(chip(fixture,key),'empty');
 await fixture.press('Enter');await flush();
 assert.deepEqual(fixture.writes.map(write=>confirmed(write).at(-1)),['image','audio','syncStart'],'one write per confirmation, in review order');
 assert.equal(fixture.writes[2].session.scope.seconds,1,'the sync observation is bound to its excerpt time');
 assert.deepEqual(fixture.player.commands.at(-1),['excerpt',{index:1,play:true}],'the next excerpt plays without a repeat');
 await done(fixture,1);await fixture.press('Enter');await flush();
 assert.deepEqual(confirmed(fixture.writes.at(-1)),[...ALL.slice(0,4),'syncMiddle']);
 assert.equal(fixture.writes.length,4,'picture and sound are not confirmed again');
 assert.equal(fixture.writes.at(-1).session.scope.seconds,49);
});

test('a single key confirms only its own check, and a sync pressed before picture and sound waits locally',async t=>{
 const fixture=await workflowFixture(t,{openGuided:true,...prepared});
 await fixture.press('Enter');await done(fixture,0);
 await fixture.press('3');await flush();
 assert.equal(fixture.writes.length,0,'the server would drop a sync before audio, so it is not written yet');
 assert.equal(chip(fixture,'syncStart'),'confirmed');
 await fixture.press('1');await flush();
 assert.deepEqual(fixture.writes.map(write=>confirmed(write).at(-1)),['image']);
 assert.equal(chip(fixture,'audio'),'empty','sound stays unconfirmed without its key');
 await fixture.press('2');await flush();
 assert.deepEqual(fixture.writes.map(write=>confirmed(write).at(-1)),['image','audio','syncStart']);
 assert.equal(fixture.record().session.checks.syncStart,true);
 assert.equal(chip(fixture,'syncStart'),'saved');
});

test('reopening a film continues with the first excerpt whose sync is not confirmed and plays nothing by itself',async t=>{
 assert.deepEqual(resumePoint({preparation:true,image:true,audio:true,syncStart:true}),{prompt:'resume',segment:1});
 assert.deepEqual(resumePoint({preparation:false}),{prompt:'start',segment:0});
 assert.deepEqual(resumePoint(Object.fromEntries(ALL.map(key=>[key,true]))),{prompt:'decision',segment:2});
 assert.deepEqual(segmentChecks({image:true,audio:false},2),['audio','syncEnd']);
 const fixture=await workflowFixture(t,{openGuided:true,...prepared,checks:{preparation:true,image:true,audio:true,syncStart:true}});
 assert.deepEqual(fixture.player.commands[0],['excerpt',{index:1,play:false}]);
 assert.match(fixture.stage().textContent,/Continue with excerpt 2/);
 await fixture.press('Enter');
 assert.deepEqual(fixture.player.commands.at(-1),['excerpt',{index:1,play:true}]);
 assert.equal(fixture.writes.length,0);
});

test('shortcuts typed in the problem note do not act, and a deferral needs the note',async t=>{
 let rejects=0,nexts=0;const fixture=await workflowFixture(t,{openGuided:true,...prepared,callbacks:{onReject:()=>rejects++,onNext:()=>nexts++}});
 await fixture.press('Enter');await done(fixture,0);await fixture.press('x');
 const note=fixture.stage().querySelector('textarea');assert.ok(note,'X opens the note over the image');
 const commands=fixture.player.commands.length;
 for(const key of ['Enter','1','a','r','n','z'])assert.equal(fixture.stage().key(key,{target:note}).defaultPrevented,false,`${key} is typed, not a shortcut`);await flush();
 assert.equal(fixture.writes.length,0);assert.equal(rejects+nexts,0);assert.equal(fixture.player.commands.length,commands);
 const defer=fixture.host.querySelector('[data-single-pass-defer]');assert.equal(defer.disabled,true);
 note.value='Lip sync drifts at the end';await note.emit('input');assert.equal(defer.disabled,false);
 await defer.activate();await flush();
 assert.equal(fixture.record().session.deferred,true);assert.equal(fixture.record().session.note,note.value);assert.equal(fixture.record().complete,false);
});

test('a CAS conflict stops the saves, keeps later confirmations local and offers the saved state',async t=>{
 const fixture=await workflowFixture(t,{openGuided:true,...prepared,failWriteAt:2});
 await fixture.press('Enter');await done(fixture,0);await fixture.press('Enter');await flush();
 assert.equal(fixture.writes.length,2,'the failed write stops the queue');
 assert.equal(fixture.record().session.checks.image,true);assert.equal(fixture.record().session.checks.audio,false);
 assert.equal(chip(fixture,'audio'),'confirmed');assert.equal(chip(fixture,'syncStart'),'confirmed');
 assert.match(fixture.stage().querySelector('.single-pass-saved').textContent,/Not saved/);
 assert.ok(fixture.warning().querySelectorAll('button').some(button=>/Load saved state/.test(button.textContent)));
});

test('the HDR film starts only with a named device and asks for the HDR check before the decision',async t=>{
 const fixture=await workflowFixture(t,{openGuided:true,strict:true,hdr:true});
 await fixture.press('Enter');await flush();
 assert.equal(fixture.writes.length,0,'no device, no confirmation');
 const device=fixture.stage().querySelector('input');device.value='Reference OLED';await device.emit('input');
 await fixture.press('Enter');await flush();
 assert.equal(fixture.writes.at(-1).session.checks.preparation,true);assert.equal(fixture.writes.at(-1).session.device,'Reference OLED');
 for(const i of [0,1,2]){await done(fixture,i);await fixture.press('Enter');await flush()}
 assert.match(fixture.stage().textContent,/Decision/);assert.equal(fixture.record().complete,false,'HDR is still open');
 await fixture.press('d');await flush();
 assert.equal(fixture.record().session.checks.hdr,true);assert.equal(fixture.record().complete,true);
});

test('the decision approves only on S, opens replacement on Shift+S and moves on with N',async t=>{
 const calls=[];
 const fixture=await workflowFixture(t,{openGuided:true,...prepared,callbacks:{canApprove:()=>true,canApproveOnly:()=>true,onApprove:()=>calls.push('approve'),onApproveOnly:revision=>calls.push(['only',revision]),onNext:()=>calls.push('next')}});
 await fixture.press('s');assert.deepEqual(calls,[],'S does nothing before the decision');
 await fixture.press('Enter');
 for(const i of [0,1,2]){await done(fixture,i);await fixture.press('Enter');await flush()}
 assert.equal(fixture.record().complete,true);assert.match(fixture.stage().textContent,/Decision/);
 await fixture.press('s');await fixture.press('s',{shiftKey:true});await fixture.press('n');
 assert.deepEqual(calls,[['only',fixture.record().revision],'approve','next']);
});

test('external review continues through the existing manual workflow',async t=>{
 const fixture=await workflowFixture(t,{openGuided:true,method:'external',device:'TV'});
 assert.equal(fixture.playerOptions(),null);
 assert.ok(fixture.host.querySelector('[data-step-save]'));
});
