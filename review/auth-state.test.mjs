import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
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

test('server prunes sessions at start-up, on login and periodically, saving the pruned state',async()=>{
 const server=await fs.readFile(new URL('./server.mjs',import.meta.url),'utf8');
 assert.match(server,/new Map\(Object\.entries\(state\.sessions\|\|\{\}\)\);pruneSessions\(sessions\);state\.sessions=Object\.fromEntries\(sessions\)/);
 assert.match(server,/setInterval\(\(\)=>\{pruneAuthAttempts\(authAttempts\);if\(pruneSessions\(sessions\)\)\{state\.sessions=Object\.fromEntries\(sessions\);void save\(\)/);
 const login=await fs.readFile(new URL('./routes/auth.mjs',import.meta.url),'utf8');
 assert.match(login,/pruneSessions\(ctx\.sessions\);ctx\.sessions\.set\(hash\(token\),Date\.now\(\)\+SESSION_TTL_MS\)/);
 assert.match(login,/pruneAuthAttempts\(ctx\.authAttempts,now\);if\(!registerAuthAttempt\(/);
});
