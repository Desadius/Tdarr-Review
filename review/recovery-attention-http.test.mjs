import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewFixture} from './test-helpers/review-fixture.mjs';
import {linuxServer as linux} from './test-helpers/server.mjs';

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
