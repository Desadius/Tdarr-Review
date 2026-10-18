import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {finiteSegmentTruncated,hasFiniteTruncation} from './matroska-bounds.mjs';
const header=Buffer.from('1a45dfa380185380674100','hex');
test('only a finite declared Segment beyond physical EOF supplies truncation evidence',()=>{
 assert.equal(finiteSegmentTruncated(header,header.length),true);
 assert.equal(finiteSegmentTruncated(header,header.length+256),false);
 for(const bytes of [Buffer.from('1a45dfa38018538067ff','hex'),Buffer.from('1a45dfa3801853806701ffffffffffffff','hex'),Buffer.from('1a45dfa38018538067','hex'),Buffer.from('not matroska')])assert.equal(finiteSegmentTruncated(bytes,bytes.length),false);
});
test('file bounds inspection is read-only and refuses links or unreadable inputs',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'finite-mkv-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const file=path.join(root,'fixture.mkv');await fs.writeFile(file,header);assert.equal(await hasFiniteTruncation(file),true);assert.deepEqual(await fs.readFile(file),header);
 const link=path.join(root,'link');await fs.symlink(file,link);assert.equal(await hasFiniteTruncation(link),false);
 await fs.link(file,path.join(root,'hardlink'));assert.equal(await hasFiniteTruncation(file),false);assert.equal(await hasFiniteTruncation(path.join(root,'missing')),false);
});
