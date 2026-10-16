import test from 'node:test';
import assert from 'node:assert/strict';
import {serverHarness,linuxServer} from './test-helpers/server.mjs';
import {hash} from './core.mjs';
import {SESSION_TTL_MS,AUTH_WINDOW_MS,AUTH_MAX_ATTEMPTS,pruneSessions,pruneAuthAttempts,registerAuthAttempt} from './auth-state.mjs';

const NOW=Date.parse('2026-10-13T12:00:00Z');

test('expired and malformed sessions are removed while live sessions stay',()=>{
 const sessions=new Map([['live',NOW+1],['expired',NOW-1],['boundary',NOW],['broken','soon'],['old',NOW-SESSION_TTL_MS]]);
 assert.equal(pruneSessions(sessions,NOW),4);
 assert.deepEqual([...sessions.keys()],['live']);
 assert.equal(pruneSessions(sessions,NOW),0);
});

test('rate-limit entries are dropped once their window has ended',()=>{
 const attempts=new Map([['10.0.0.1',{at:NOW-AUTH_WINDOW_MS,count:3}],['10.0.0.2',{at:NOW-AUTH_WINDOW_MS-1,count:12}],['10.0.0.3',{at:NOW,count:1}]]);
 assert.equal(pruneAuthAttempts(attempts,NOW),1);
 assert.deepEqual([...attempts.keys()],['10.0.0.1','10.0.0.3']);
});

test('login limit allows twelve attempts per window and resets after it',()=>{
 const attempts=new Map();
 for(let i=0;i<AUTH_MAX_ATTEMPTS;i++)assert.equal(registerAuthAttempt(attempts,'10.0.0.1',NOW),true);
 assert.equal(registerAuthAttempt(attempts,'10.0.0.1',NOW+1000),false);
 assert.equal(registerAuthAttempt(attempts,'10.0.0.2',NOW+1000),true);
 assert.equal(registerAuthAttempt(attempts,'10.0.0.1',NOW+AUTH_WINDOW_MS+1),true);
 assert.equal(attempts.get('10.0.0.1').count,1);
});

for(const phase of ['startup','login','periodic'])test(`HTTP sessions are pruned and persisted at ${phase}`,linuxServer,async t=>{
 const f=await serverHarness();t.after(()=>f.close());
 const now=Date.now(),expired=hash('expired'),live=hash('live');
 await f.start({clock:true,state:{items:{},history:[],pauses:phase==='startup'?[{name:'synthetic-node'}]:[],sessions:{[expired]:now+(phase==='startup'?-1000:60000),[live]:now+86400000}}});
 if(phase!=='startup')await f.tick({advance:120000});
 if(phase==='login')await f.login();
 if(phase==='periodic')await f.tick({interval:3600000});
 assert.equal((await f.request('/api/settings',{headers:{cookie:'review_session=expired'}})).status,401);
 if(phase==='startup')assert.equal((await f.request('/api/node-restores/keep',{method:'POST',headers:{cookie:'review_session=live'},body:{name:'synthetic-node',confirm:true}})).status,200);
 const stop=Date.now()+5000;let saved;
 do{saved=await f.state();if(!Object.hasOwn(saved.sessions,expired))break;await new Promise(resolve=>setTimeout(resolve,10))}while(Date.now()<stop);
 assert.equal(Object.hasOwn(saved.sessions,expired),false,'expired session removed from saved state');
 assert.equal(saved.sessions[live],now+86400000,'live session retained');
 assert.equal((await f.request('/api/settings',{headers:{cookie:'review_session=live'}})).status,200);
});

test('HTTP login rate limit resets after its window',linuxServer,async t=>{
 const f=await serverHarness();t.after(()=>f.close());await f.start({clock:true});
 for(let i=0;i<12;i++)assert.equal((await f.request('/api/login',{method:'POST',body:{key:'wrong'}})).status,401);
 assert.equal((await f.request('/api/login',{method:'POST',body:{key:'wrong'}})).status,429);
 await f.tick({advance:AUTH_WINDOW_MS+1});await f.login();
});
