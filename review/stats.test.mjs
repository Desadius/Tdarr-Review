import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evidence,countFile} from './stats.mjs';
test('duplicates count once, pending originals do not count as saved',()=>{const rows=[{start:100,end:20,review:false},{start:100,end:20,review:false},{start:100,end:20,review:true}];assert.equal(countFile(rows,100),null);assert.deepEqual(countFile(rows,20),{saved:80,reviewSaved:80,original:100,current:20});assert.equal(countFile(rows,21),null)});
test('journal approvals and configured library only',()=>{const config={libraryId:'one',sourceRoots:['/films'],mediaRoot:'/media'};const jobs=[{status:'Transcode success',DB:'other',file:'/films/F/a.mkv',fileSizeStartGB:10,fileSizeEndGB:1}];const t={phase:'complete',original:'/media/F/a.mkv',originalFP:'1:2:100:4:5',reviewFP:'1:2:20:4:5'};assert.equal(evidence(jobs,[t],config).size,1);assert.equal(evidence(jobs,[{...t,phase:'aborted'}],config).size,0)});
