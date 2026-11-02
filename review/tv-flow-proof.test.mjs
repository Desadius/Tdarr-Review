import test from 'node:test';
import assert from 'node:assert/strict';
import {validTvStrictProof,tvStrictProofMatchesFiles} from './tv-flow-proof.mjs';

const receiptWith=(sourceIdentity,outputIdentity)=>JSON.parse(JSON.stringify({version:2,jobId:'job-1',strictProof:{profile:{id:'tv-review-staging-v1-template',version:2},jobId:'job-1',sourceIdentity,outputIdentity,preservation:'passed',decode:'complete',stagedCopy:'verified'}}));

test('strict TV proof accepts Unraid shfs inodes above 2^53 and matches them against a fresh stat',()=>{
 // A /mnt/user inode as Node reports it: 12947848929405251 rounds to 12947848929405252 on every stat.
 const source={dev:44,ino:12947848929405251,ctimeMs:1762100000123.456},output={dev:2**53+1,ino:2**63,ctimeMs:1762100000456.5};
 const receipt=receiptWith({dev:source.dev,ino:source.ino,ctime:source.ctimeMs},{dev:output.dev,ino:output.ino,ctime:output.ctimeMs});
 assert.equal(Number.isSafeInteger(receipt.strictProof.sourceIdentity.ino),false,'the fixture must exceed the safe integer range');
 assert.equal(validTvStrictProof(receipt),true);
 assert.equal(tvStrictProofMatchesFiles(receipt,source,output),true);
 assert.equal(tvStrictProofMatchesFiles(receipt,{...source,ino:12947848929405260},output),false,'a different large inode still fails');
 assert.equal(tvStrictProofMatchesFiles(receipt,source,{...output,ctimeMs:output.ctimeMs+1}),false);
});

test('strict TV proof still refuses non-integer, negative or missing identities',()=>{
 const good={dev:1,ino:2,ctime:3};
 for(const bad of [{dev:1.5,ino:2,ctime:3},{dev:-1,ino:2,ctime:3},{dev:1,ino:0,ctime:3},{dev:1,ino:'2',ctime:3},{dev:1,ino:Infinity,ctime:3},{dev:1,ino:2,ctime:Number.NaN},{dev:1,ino:2}])
  assert.equal(validTvStrictProof(receiptWith(bad,good)),false,JSON.stringify(bad));
 assert.equal(validTvStrictProof(receiptWith(good,good)),true);
});
