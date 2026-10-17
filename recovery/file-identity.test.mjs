import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {caseId} from './policy.mjs';
import {identityOf,compareIdentity} from './file-identity.mjs';
import {identityVariants} from '../review/test-helpers/identity-variants.mjs';

// File identities are persisted in journals, state, approval evidence and the frozen
// registry, and hashed into Recovery case IDs: their bytes must never change.
// Values are plain fs.Stats numbers (no bigint), including dev/ino near and above 2^53.
const golden=[
 [{dev:2049,ino:1234567,size:8,mtimeMs:1700000000123.4567,ctimeMs:1700000000456.789},'2049:1234567:8:1700000000123.4568:1700000000456.789'],
 [{dev:2**53-1,ino:2**53,size:0,mtimeMs:-1234.5,ctimeMs:0},'9007199254740991:9007199254740992:0:-1234.5:0'],
 [{dev:2**53+1,ino:2**53+2,size:2**40,mtimeMs:1e21,ctimeMs:1.5},'9007199254740992:9007199254740994:1099511627776:1e+21:1.5'],
 [{dev:2**64,ino:2**63,size:1,mtimeMs:0.1,ctimeMs:-0},'18446744073709552000:9223372036854776000:1:0.1:0'],
];

test('identityOf writes the frozen bytes every former producer wrote',()=>{
 for(const [stat,expected] of golden)assert.equal(identityOf(stat),expected);
});

test('a real plain stat produces its fields joined in order',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'file-identity-'));
 try{
  const file=path.join(root,'film.mkv');await fs.writeFile(file,'synthetic');const stat=await fs.stat(file);
  assert.equal(typeof stat.ino,'number');
  assert.equal(identityOf(stat),`${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`);
 }finally{await fs.rm(root,{recursive:true,force:true})}
});

test('Recovery case IDs derived from a file identity keep their value',()=>{
 assert.equal(caseId('/media/movies/Film/a.mkv',golden[0][1]),'acf95bf98b6d30d2563e9899');
 assert.equal(caseId('/media/movies/Film/a.mkv',golden[1][1]),'abd45ac0b0cd275f01c3603f');
});

test('comparison names a lone ctime or device change and calls every other difference different',()=>{
 const expected={same:'same',ctimeChanged:'ctime-changed',deviceChanged:'device-changed',deviceAndCtimeChanged:'different',inodeChanged:'different',fourFields:'invalid',emptyCtime:'invalid',textCtime:'invalid',textDevice:'invalid',sixFields:'invalid',missing:'invalid'};
 for(const [,current] of golden)for(const [variant,stored] of Object.entries(identityVariants(current))){
  assert.equal(compareIdentity(stored,current),expected[variant],variant+' recorded');
  assert.equal(compareIdentity(current,stored),expected[variant],variant+' current');
 }
 assert.equal(compareIdentity('1:2:100:4:5','1:2:101:4:5'),'different');
 assert.equal(compareIdentity('1:2:100:4:5','1:2:100:9:5'),'different');
});

test('only the exact text of a finite number is a valid field',()=>{
 for(const [,value] of golden)assert.equal(compareIdentity(value,value),'same',value);
 for(const value of ['1:2:100:-4:5','1:2:100:4.25:5','1:2:100:1e+21:5','0:0:0:0:0'])assert.equal(compareIdentity(value,value),'same',value);
 for(const value of ['',' 1:2:100:4:5','1:2:100:4:5 ','01:2:100:4:5','1:2:100:4:NaN','1:2:100:4:Infinity','1:2:100:4:0x10','-0:2:100:4:5','1:2:100:4:1E21','1::100:4:5',null,5,{}])
  assert.equal(compareIdentity(value,value),'invalid',String(value));
});
