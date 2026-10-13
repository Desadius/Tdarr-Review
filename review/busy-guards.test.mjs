import test from 'node:test';
import assert from 'node:assert/strict';
import {BUSY_POLICIES,busyFor,mutationKind} from './busy-guards.mjs';

test('every mutating route has an explicit concurrency policy',()=>{
 const id='a'.repeat(24);
 const routes={settings:['/api/settings','/api/settings/test'],radarrSettings:['/api/radarr/settings','/api/radarr/settings/test'],previewSettings:['/api/preview-settings'],batch:['/api/approve-batch'],restore:[`/api/radarr/requests/${id}/restore`],reviewSession:[`/api/items/${id}/review-session`]};
 for(const action of ['approve','reject','replace','recheck'])routes[action]=[`/api/items/${id}/${action}`];
 for(const [kind,paths] of Object.entries(routes))for(const route of paths){assert.equal(mutationKind('POST',route),kind);assert.ok(BUSY_POLICIES[kind]);assert.equal(mutationKind('GET',route),null)}
 assert.equal(mutationKind('POST','/api/login'),null);
 assert.equal(mutationKind('POST',`/api/items/${id}/frames`),null,'preview mutability is decided from the parsed body');
 assert.throws(()=>busyFor('unknown',{}),/Unknown busy policy/);
});

test('all mutation policies exclude foreground work and a running node resume',()=>{
 for(const kind of Object.keys(BUSY_POLICIES)){
  assert.equal(busyFor(kind,{}),null);
  for(const flag of ['foreground','active','batchRunning','resumeTask','previewBusy','settingsBusy'])assert.equal(busyFor(kind,{[flag]:true}),flag,`${kind}: ${flag}`);
 }
});

test('intentional scan, recovery and review CAS differences are bounded',()=>{
 for(const kind of ['approve','reject','batch','replace']){
  assert.equal(busyFor(kind,{scan:true}),null,'fresh preflight joins an existing scan');
  for(const flag of ['reviewSessions','recovery','pauses'])assert.equal(busyFor(kind,{[flag]:true}),flag);
 }
 for(const kind of ['radarrSettings','previewSettings','preview']){
  for(const flag of ['scan','reviewSessions'])assert.equal(busyFor(kind,{[flag]:true}),flag);
  for(const flag of ['recovery','pauses'])assert.equal(busyFor(kind,{[flag]:true}),null,'read-only media/cache operations remain available');
 }
 for(const kind of ['restore','recheck','settings','reviewSession'])for(const flag of ['scan','recovery','pauses'])assert.equal(busyFor(kind,{[flag]:true}),flag);
 assert.equal(busyFor('reviewSession',{reviewSessions:true}),null,'CAS writes retain their queue');
 assert.equal(busyFor('resume',{pauses:true}),null,'the retry owns these pending pauses');
 assert.equal(busyFor('settings',{statistics:true}),'statistics');
 assert.equal(busyFor('background',{previewHolds:true}),'previewHolds');
});
