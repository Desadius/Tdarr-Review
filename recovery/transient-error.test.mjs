import test from 'node:test';
import assert from 'node:assert/strict';
import {isTransientError,isTransientMessage,noteObservationError,clearObservationError,publishedObservationError,TRANSIENT_GRACE_MS} from './transient-error.mjs';

test('only network failures of an HTTP call count as transient',()=>{
 assert.equal(isTransientError(new TypeError('fetch failed')),true);
 assert.equal(isTransientError(Object.assign(new Error('x'),{name:'TimeoutError'})),true);
 assert.equal(isTransientError(Object.assign(new TypeError('fetch failed'),{cause:{code:'ECONNREFUSED'}})),true);
 assert.equal(isTransientError(Object.assign(new Error('connect'),{code:'EHOSTUNREACH'})),true);
 for(const e of [new Error('Radarr 500'),new Error('Confirmed source changed during cooldown'),Object.assign(new Error('x'),{code:'ENOENT'}),null,'fetch failed'])assert.equal(isTransientError(e),false);
 assert.equal(isTransientMessage('fetch failed'),true);assert.equal(isTransientMessage('fetch failed: changed'),false);
});

test('a transient read failure is published only after the grace period; others at once',()=>{
 const now=Date.UTC(2026,9,28,12),c={};
 noteObservationError(c,new TypeError('fetch failed'),now);
 assert.equal(publishedObservationError(c,now+TRANSIENT_GRACE_MS-1),null);
 noteObservationError(c,new TypeError('fetch failed'),now+60000);
 assert.equal(c.observationErrorSince,new Date(now).toISOString(),'a continuing outage keeps its start');
 assert.equal(publishedObservationError(c,now+TRANSIENT_GRACE_MS),'fetch failed');
 noteObservationError(c,new Error('Radarr 500'),now);
 assert.equal(c.observationErrorSince,undefined);assert.equal(publishedObservationError(c,now),'Radarr 500');
 clearObservationError(c);assert.deepEqual(c,{});assert.equal(publishedObservationError(c,now),null);
 assert.equal(publishedObservationError({observationError:'fetch failed'},now),'fetch failed','an old failure without a start time is shown');
});
