import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRecoveryAttention} from './recovery-attention.mjs';
import {identityOf} from '../recovery/file-identity.mjs';
import {ATTENTION_PATHS,now} from './test-helpers/attention-paths.mjs';

// A Recovery case whose transcoded result is already installed in the library (#230): the imported replacement
// was transcoded and replaced in place, so the library file is no longer the recorded replacement, and no
// approval evidence exists. Synthetic files only.
async function installed(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'installed-result-')),data=path.join(root,'data'),media=path.join(root,'media','movies');
 await fs.mkdir(path.join(data,'recovery'),{recursive:true});await fs.mkdir(path.join(media,'Film'),{recursive:true});await fs.mkdir(path.join(root,'quarantine'),{recursive:true});
 const library=path.join(media,'Film','new.mkv'),quarantined=path.join(root,'quarantine','old.mkv');
 await fs.writeFile(library,'IMPORTED REPLACEMENT');const replacementFP=identityOf(await fs.stat(library));
 await fs.rm(library);await fs.writeFile(library,'TRANSCODED RESULT');await fs.writeFile(quarantined,'FAULTY ORIGINAL');
 const c={id:'a'.repeat(24),status:'replacement_imported',file:'/tdarr/movies/Film/new.mkv',source:path.join(media,'Film','old.mkv'),relative:'Film/old.mkv',fp:identityOf(await fs.stat(quarantined)),
  replacementRelative:'Film/new.mkv',replacementSourceFP:replacementFP,quarantine:quarantined,movieId:7};
 await fs.writeFile(path.join(data,'recovery','state.json'),JSON.stringify({version:1,jobs:{},cases:{[c.id]:c}}));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 return {root,data,media,library,quarantined,c};
}

test('characterization: an installed transcoded result is attention without an action that resolves it',async t=>{
 const f=await installed(t);
 const attention=createRecoveryAttention({data:f.data,getConfig:()=>({libraryId:'library'}),getItems:()=>({}),now:()=>now,tdarr:async()=>null,getConnection:async()=>{throw Error('none')}});
 const overview={requests:[{...ATTENTION_PATHS['replacement transcoded, awaiting review'],radarrMovieUrl:'http://radarr.invalid/movie/x'}]};
 await attention.attach(overview);const a=overview.requests[0].attention;
 assert.equal(a.reason,'awaiting-review');
 assert.deepEqual(a.location.library,{status:'verified',detail:'changed'});
 assert.deepEqual(a.location.review,{status:'not-used'});
 assert.deepEqual(a.actions.map(x=>x.id),['refresh','openRadarr']);
 assert.equal(a.recommended,'refresh');
 assert.ok(a.blockers.includes('review-result-missing'));
});
