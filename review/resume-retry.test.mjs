import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {RESUME_RETRY_TICK_MS,RESUME_RETRY_MAX_MS,resumeRetryDelay} from './resume-retry.mjs';

test('failed node restores back off exponentially up to a ceiling',()=>{
 assert.deepEqual([0,1,2,3].map(resumeRetryDelay),[RESUME_RETRY_TICK_MS,2*RESUME_RETRY_TICK_MS,4*RESUME_RETRY_TICK_MS,8*RESUME_RETRY_TICK_MS]);
 for(const failures of [6,20,1000,Infinity])assert.equal(resumeRetryDelay(failures),RESUME_RETRY_MAX_MS);
 assert.equal(resumeRetryDelay(-1),RESUME_RETRY_TICK_MS);
});

test('GET /api/items has no node side effects; the retry runs on a guarded server timer',async()=>{
 const server=await fs.readFile(new URL('./server.mjs',import.meta.url),'utf8');
 const start=server.indexOf("if(url.pathname==='/api/items'&&req.method==='GET'){");assert.ok(start>0);
 const block=server.slice(start,server.indexOf('return respond(res,200,',start));
 assert.doesNotMatch(block,/resume\(|tdarr\(|update-node/);
 const timer=/const resumeRetryTimer=setInterval\(\(\)=>\{\n if\(([^\n]*)\)return;\n void resume\(\)/.exec(server);assert.ok(timer,'resume retry timer');
 for(const guard of ['stopping','!state.pauses.length','recovery.length','active','batchRunning','reviewSessions.busy','resumeTask','Date.now()<nextResumeAt'])assert.ok(timer[1].split('||').includes(guard),guard);
 assert.match(server,/clearInterval\(resumeRetryTimer\)/);
});
