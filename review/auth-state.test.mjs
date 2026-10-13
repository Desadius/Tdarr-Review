import test from 'node:test';
import assert from 'node:assert/strict';
import {pruneAuthentication,allowAuthenticationAttempt,AUTH_ATTEMPT_WINDOW_MS} from './auth-state.mjs';

test('expired and invalid token hashes are removed, including the expiry boundary',()=>{
  const sessions=new Map([['expired',99],['boundary',100],['valid',101],['invalid','200'],['infinite',Infinity]]);
  assert.deepEqual(pruneAuthentication(sessions,new Map(),100),{sessionsRemoved:4,attemptsRemoved:0});
  assert.deepEqual(Object.fromEntries(sessions),{valid:101});
  assert.deepEqual(pruneAuthentication(sessions,new Map(),100),{sessionsRemoved:0,attemptsRemoved:0});
});

test('login pruning retains the current address window and removes old addresses',()=>{
  const attempts=new Map([['old',{at:0,count:12}],['current',{at:1,count:12}],['bad',{}]]);
  assert.deepEqual(pruneAuthentication(new Map(),attempts,AUTH_ATTEMPT_WINDOW_MS),{sessionsRemoved:0,attemptsRemoved:2});
  assert.deepEqual([...attempts.keys()],['current']);
  assert.equal(allowAuthenticationAttempt(attempts,'current',AUTH_ATTEMPT_WINDOW_MS),false);
});

test('the thirteenth login is denied and a new window begins at exactly 60 seconds',()=>{
  const attempts=new Map();
  for(let n=0;n<12;n++)assert.equal(allowAuthenticationAttempt(attempts,'fixture',0),true);
  assert.equal(allowAuthenticationAttempt(attempts,'fixture',1),false);
  assert.equal(allowAuthenticationAttempt(attempts,'fixture',AUTH_ATTEMPT_WINDOW_MS-1),false);
  assert.equal(allowAuthenticationAttempt(attempts,'fixture',AUTH_ATTEMPT_WINDOW_MS),true);
  assert.deepEqual(attempts.get('fixture'),{at:AUTH_ATTEMPT_WINDOW_MS,count:1});
});

test('periodic pruning bounds growth across many expired login windows',()=>{
  const sessions=new Map(),attempts=new Map();
  for(let n=0;n<1000;n++){
    sessions.set('token-'+n,n);
    allowAuthenticationAttempt(attempts,'address-'+n,n);
  }
  assert.equal(pruneAuthentication(sessions,attempts,1000).sessionsRemoved,1000);
  assert.equal(pruneAuthentication(sessions,attempts,AUTH_ATTEMPT_WINDOW_MS+1000).attemptsRemoved,1000);
  assert.equal(sessions.size,0);assert.equal(attempts.size,0);
});
