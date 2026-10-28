import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {withReviewPaths,sameDirectory} from './recovery-case-alias.mjs';

// The share is reached through two names, as Recovery's /storage and Review's /media mounts are in one container.
async function share(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'case-alias-'));
 await fs.mkdir(path.join(root,'media','movies','Film (2020)'),{recursive:true});
 await fs.mkdir(path.join(root,'media','.tdarr-corrupt','case'),{recursive:true});
 await fs.symlink(path.join(root,'media'),path.join(root,'storage'));
 await fs.mkdir(path.join(root,'other','movies'),{recursive:true});
 return root;
}
const recorded=root=>({id:'case',relative:'Film (2020)/film.mkv',source:path.join(root,'storage','movies','Film (2020)','film.mkv'),file:'/tdarr/movies/Film (2020)/film.mkv',quarantine:path.join(root,'storage','.tdarr-corrupt','case','film.mkv'),fp:'1:2:3:4:5'});

test('Recovery paths under another mount of the same share are expressed under Review\'s mediaRoot',async()=>{
 const root=await share(),c=recorded(root);
 const out=await withReviewPaths({case:c},path.join(root,'media','movies'));
 assert.equal(out.case.source,path.join(root,'media','movies','Film (2020)','film.mkv'));
 assert.equal(out.case.quarantine,path.join(root,'media','.tdarr-corrupt','case','film.mkv'));
 assert.equal(out.case.file,c.file,'the Tdarr path is never rewritten');
 assert.equal(out.case.fp,c.fp);
 assert.equal(c.source,path.join(root,'storage','movies','Film (2020)','film.mkv'),'the read state is not mutated');
});

test('a different directory, an unsafe relative path or a quarantine outside the share stays as recorded',async()=>{
 const root=await share(),c=recorded(root);
 assert.equal((await withReviewPaths({case:c},path.join(root,'other','movies'))).case,c);
 const unsafe={...c,relative:'../movies/Film (2020)/film.mkv',source:path.join(root,'storage','movies','../movies/Film (2020)/film.mkv')};
 assert.equal((await withReviewPaths({case:unsafe},path.join(root,'media','movies'))).case,unsafe);
 const outside={...c,quarantine:path.join(root,'other','q','film.mkv')};
 const out=await withReviewPaths({case:outside},path.join(root,'media','movies'));
 assert.equal(out.case.quarantine,outside.quarantine);
 assert.equal(out.case.source,path.join(root,'media','movies','Film (2020)','film.mkv'));
});

test('a missing root, missing cases or a relative mediaRoot change nothing',async()=>{
 const root=await share(),c=recorded(root);
 assert.equal(await withReviewPaths(null,path.join(root,'media','movies')),null);
 assert.equal((await withReviewPaths({case:c},'media/movies')).case,c);
 assert.equal(await sameDirectory(path.join(root,'missing'),path.join(root,'media')),false);
 assert.equal((await withReviewPaths({case:undefined},path.join(root,'media','movies'))).case,undefined);
});
