import test from 'node:test';
import assert from 'node:assert/strict';
import {matchReviewJob} from './job-matching.mjs';
const relative='Film (2000)/a.mkv';
const config={receipt:{version:1,relative,jobId:'old'},libraryId:'library-A',sourceRoots:['/media/movies'],relative,sourceBytes:1000,outputBytes:500};
const job={_id:'old',DB:'library-A',status:'Transcode success',file:'/media/movies/'+relative,fileSizeStartGB:1000/2**30,fileSizeEndGB:500/2**30,start:1,end:2};
const code=expected=>e=>e.code===expected;
test('exact receipt selects its job despite newer same-size transcode and clock differences',()=>{
 const newer={...job,_id:'newer',end:999};assert.equal(matchReviewJob([newer,job],config),job);
});
test('another job ID cannot replace the exact receipt job',()=>{
 assert.throws(()=>matchReviewJob([{...job,_id:'other'}],config),code('EXACT_JOB_MISSING'));
});
test('another library cannot replace the exact job even with the same ID, path and sizes',()=>{
 assert.throws(()=>matchReviewJob([{...job,DB:'library-B'}],config),code('EXACT_JOB_MISSING'));
});
test('failed exact job cannot borrow another successful job evidence',()=>{
 assert.throws(()=>matchReviewJob([{...job,status:'Transcode error'},{...job,_id:'other'}],config),code('EXACT_JOB_MISSING'));
});
test('exact ID with another source path or wrong output size is rejected',()=>{
 assert.throws(()=>matchReviewJob([{...job,file:'/media/movies/Other/a.mkv'}],config),code('EXACT_JOB_MISSING'));
 assert.throws(()=>matchReviewJob([{...job,fileSizeEndGB:501/2**30}],config),code('EXACT_JOB_MISSING'));
});
test('legacy receipt uses one unique candidate within configured library',()=>{
 const legacy={...config,receipt:{version:1,relative,createdAt:999999}};
 assert.equal(matchReviewJob([{...job,DB:'library-B'},job],legacy),job);
});
test('legacy receipt refuses two successful same-path same-size jobs',()=>{
 const legacy={...config,receipt:{version:1,relative}};
 assert.throws(()=>matchReviewJob([{...job,_id:'newer'},job],legacy),code('LEGACY_AMBIGUOUS'));
});
test('missing receipt retains unique historical match, not arbitrary newest match',()=>{
 assert.equal(matchReviewJob([job],{...config,receipt:null}),job);
 assert.throws(()=>matchReviewJob([{...job,_id:'newer'},job],{...config,receipt:null}),code('LEGACY_AMBIGUOUS'));
});
test('malformed or blank explicit job ID cannot silently use legacy fallback',()=>{
 for(const jobId of ['',null,42,' old '])assert.throws(()=>matchReviewJob([job],{...config,receipt:{version:1,relative,jobId}}),code('INVALID_JOB_ID'));
});
test('receipt for another file is rejected even when job otherwise matches',()=>{
 assert.throws(()=>matchReviewJob([job],{...config,receipt:{...config.receipt,relative:'Other/a.mkv'}}),code('INVALID_RECEIPT'));
});
test('Windows separators in server job paths and trailing configured root normalize',()=>{
 assert.equal(matchReviewJob([{...job,file:'\\media\\movies\\Film (2000)\\a.mkv'}],{...config,sourceRoots:['/media/movies/']} )._id,'old');
});
test('M2TS source is matched by receipt source path, not MKV destination guess',()=>{
 const rel='Film/a.m2ts',j={...job,file:'/media/movies/'+rel};
 assert.equal(matchReviewJob([j],{...config,relative:rel,receipt:{version:1,relative:rel,outputRelative:'Film/a.mkv',jobId:'old'}}),j);
});
