import test from 'node:test';
import assert from 'node:assert/strict';
import {workflowFixture,flush} from './test-helpers/workflow-dom.mjs';

test('guided playback state never confirms or writes review evidence',async t=>{
 const fixture=await workflowFixture(t,{openGuided:true});
 const player=fixture.playerOptions();
 assert.ok(player,'guided workspace opens the media-first comparison');
 player.onPlaybackState?.({status:'playing',excerptIndex:1,excerptCount:3,phase:'original'});
 await flush();
 assert.equal(fixture.writes.length,0);
 assert.match(fixture.host.textContent,/2\/3/);
 for(const key of ['preparation','image','audio','syncStart','syncMiddle','syncEnd'])assert.equal(fixture.check(key)?.checked,false);
});

test('one explicit guided save stores each sync observation at its matching excerpt time',async t=>{
 const fixture=await workflowFixture(t,{openGuided:true});
 for(const key of ['preparation','image','audio','syncStart','syncMiddle','syncEnd']){const input=fixture.check(key);input.checked=true;await input.emit('change')}
 const save=fixture.host.querySelector('[data-guided-save]');
 assert.ok(save,'continuous workspace has one explicit save action');
 await save.activate();
 await flush();
 const writes=fixture.writes;
 const sync=['syncStart','syncMiddle','syncEnd'];
 for(let i=0;i<sync.length;i++){
  const saved=writes.find(write=>write.session.checks[sync[i]]===true);
  assert.ok(saved,`${sync[i]} is explicitly persisted`);
  assert.equal(saved.session.scope.seconds,fixture.playerOptions().comparison.excerpts[i]);
 }
 assert.equal(fixture.record().revision,writes.length);
});

test('guided save stops at a CAS conflict and leaves later confirmations in the local draft',async t=>{
 const fixture=await workflowFixture(t,{openGuided:true,failWriteAt:5});
 for(const key of ['preparation','image','audio','syncStart','syncMiddle','syncEnd']){const input=fixture.check(key);input.checked=true;await input.emit('change')}
 await fixture.host.querySelector('[data-guided-save]').activate();
 await flush();
 assert.equal(fixture.writes.length,5,'the failed write stops the sequential save');
 assert.equal(fixture.record().revision,4,'earlier accepted writes remain committed');
 assert.equal(fixture.record().session.checks.syncStart,true);
 assert.equal(fixture.record().session.checks.syncMiddle,false);
 assert.equal(fixture.check('syncMiddle').checked,true,'the uncommitted human confirmation remains visible');
 assert.equal(fixture.check('syncEnd').checked,true);
});

test('HDR confirmation still requires a named device before explicit save',async t=>{
 const fixture=await workflowFixture(t,{openGuided:true,hdr:true});
 for(const key of ['preparation','image','hdr','audio','syncStart','syncMiddle','syncEnd']){const input=fixture.check(key);input.checked=true;await input.emit('change')}
 const save=fixture.host.querySelector('[data-guided-save]');
 assert.equal(save.disabled,true);
 const device=fixture.host.querySelectorAll('input').find(input=>!input.dataset.check);
 device.value='Reference HDR display';await device.emit('input');
 for(const key of ['preparation','image','hdr','audio','syncStart','syncMiddle','syncEnd']){const input=fixture.check(key);input.checked=true;await input.emit('change')}
 assert.equal(save.disabled,false);
});

test('external review continues through the existing manual workflow',async t=>{
 const fixture=await workflowFixture(t,{openGuided:true,method:'external',device:'TV'});
 assert.equal(fixture.playerOptions(),null);
 assert.ok(fixture.host.querySelector('[data-step-save]'));
});

test('a reviewer can defer an incomplete guided review with an explicit note',async t=>{
 const fixture=await workflowFixture(t,{openGuided:true});
 const defer=fixture.host.querySelector('[data-guided-defer]');assert.ok(defer,'guided review retains the explicit defer action');assert.equal(defer.disabled,true);
 const note=fixture.host.querySelector('textarea');note.value='Check dialogue on the reference display';await note.emit('input');assert.equal(defer.disabled,false);
 await defer.activate();await flush();
 assert.equal(fixture.record().session.deferred,true);assert.equal(fixture.record().session.note,note.value);assert.equal(fixture.record().complete,false);
 for(const key of ['preparation','image','audio','syncStart','syncMiddle','syncEnd'])assert.equal(fixture.record().session.checks[key],false);
});
