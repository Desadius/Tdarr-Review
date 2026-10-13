import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {atomicJson}from './atomic-json.mjs';import {publishRecoveryStatus}from './waiting-source.mjs';
test('public snapshot stays readable across atomic refreshes; private state stays private',{skip:process.platform==='win32'?'Requires POSIX directory fsync and permission bits; Windows ACLs do not represent these modes':false},async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'recovery-mode-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const publicFile=path.join(root,'.tdarr-recovery-status.json'),privateFile=path.join(root,'state.json');
 for(let i=0;i<3;i++){
 await fs.writeFile(publicFile+'.tmp','old',{mode:0o600});
 await publishRecoveryStatus({cfg:{mediaRoot:path.join(root,'movies'),sourceRoot:'/media/movies',libraryId:'lib'},state:{cases:{}},atomic:atomicJson});
 assert.equal((await fs.stat(publicFile)).mode&0o777,0o644);assert.equal(JSON.parse(await fs.readFile(publicFile)).version,1);
 await fs.writeFile(privateFile+'.tmp','old',{mode:0o666});await fs.chmod(privateFile+'.tmp',0o666);
 await atomicJson(privateFile,{private:true});assert.equal((await fs.stat(privateFile)).mode&0o777,0o600);
 }
});
