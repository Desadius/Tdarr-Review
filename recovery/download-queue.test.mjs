import test from 'node:test';import assert from 'node:assert/strict';
import {downloadQueue}from './download-queue.mjs';
test('download completion does not mask a blocked manual import',()=>{
 const r=downloadQueue({status:'completed',trackedDownloadState:'importBlocked',trackedDownloadStatus:'warning',size:100,sizeleft:0,errorMessage:'Unpack SUCCESS',statusMessages:[{messages:['Manual Import required.']}]});
 assert.equal(r.percent,100);assert.equal(r.error,'Manual Import required.');assert.equal(r.trackedDownloadState,'importBlocked');
});
test('healthy completed downloads do not turn downloader status strings into failures',()=>{
 assert.equal(downloadQueue({status:'completed',trackedDownloadStatus:'ok',errorMessage:'Unpack SUCCESS'}).error,null);
 assert.equal(downloadQueue({status:'failed',errorMessage:'connection refused'}).error,'connection refused');
 assert.equal(downloadQueue({size:10,sizeleft:NaN}).percent,null);
 assert.equal(downloadQueue({size:10,sizeleft:20}).percent,0);
 assert.equal(downloadQueue({trackedDownloadState:'importBlocked',statusMessages:[{messages:['x'.repeat(4000)]}]}).error.length,2000);
});

 test('unknown tracking cannot hide a real error',()=>{assert.equal(downloadQueue({status:'completed',errorMessage:'Import failed'}).error,'Import failed');assert.equal(downloadQueue({status:'completed',errorMessage:'PAR Status: NONE - Unpack Status: SUCCESS'}).error,null);assert.match(downloadQueue({status:'completed',errorMessage:'PAR Status: FAILURE - Unpack Status: SUCCESS'}).error,/FAILURE/);});
