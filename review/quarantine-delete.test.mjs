import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createQuarantineDelete} from './quarantine-delete.mjs';
import {userDeletedQuarantine,deletedQuarantineCases} from '../recovery/quarantine-deletion.mjs';
import {identityOf} from '../recovery/file-identity.mjs';
import {classifyRecovery} from './public/review-model.js';
import {reviewFixture} from './test-helpers/review-fixture.mjs';
import {linuxServer} from './test-helpers/server.mjs';

// Deleting one quarantined file at the user's request (#280), over synthetic files only.
const ID='a'.repeat(24),NOW=Date.UTC(2026,9,28,12);
async function fixture(t,{requests=[],state=null}={}){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'quarantine-delete-')),data=path.join(root,'data'),media=path.join(root,'media','movies'),quarantine=path.join(root,'media','.tdarr-corrupt');
 await fs.mkdir(path.join(data,'recovery'),{recursive:true});await fs.mkdir(path.join(media,'Film'),{recursive:true});await fs.mkdir(path.join(quarantine,ID),{recursive:true});
 const file=path.join(quarantine,ID,'old.mkv');await fs.writeFile(file,'PRESERVED ORIGINAL');await fs.writeFile(path.join(media,'Film','new.mkv'),'CURRENT COPY');
 if(state)await fs.writeFile(path.join(data,'recovery','state.json'),JSON.stringify({version:1,cases:state(media)}));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const deleter=createQuarantineDelete({data,getConfig:()=>({mediaRoot:media}),getOverview:async()=>({requests}),now:()=>NOW});
 return {root,data,media,quarantine,file,roots:[quarantine,path.join(root,'other')],deleter};
}
const fresh=new Date(NOW-60000).toISOString();

test('a file without a case can be deleted after confirmation; the deletion is recorded first',async t=>{
 const f=await fixture(t),identity=identityOf(await fs.stat(f.file)),view=await f.deleter.inspect(f.roots,ID,'old.mkv');
 assert.equal(view.eligible,true);assert.equal(view.library,'unknown');assert.equal(view.case,null);assert.equal(view.bytes,'PRESERVED ORIGINAL'.length);
 await assert.rejects(f.deleter.remove(f.roots,ID,'old.mkv',{snapshot:view.snapshot}),{code:'quarantine_delete_confirm_required'});
 await assert.rejects(f.deleter.remove(f.roots,ID,'old.mkv',{snapshot:'0'.repeat(64),confirm:true}),{code:'quarantine_delete_changed'});
 assert.equal((await fs.stat(f.file)).isFile(),true,'nothing deleted without the shown snapshot');
 assert.deepEqual(await f.deleter.remove(f.roots,ID,'old.mkv',{snapshot:view.snapshot,confirm:true}),{deleted:true,bytes:view.bytes,library:'unknown'});
 await assert.rejects(fs.lstat(f.file),{code:'ENOENT'});await assert.rejects(fs.lstat(path.dirname(f.file)),{code:'ENOENT'},'the empty case folder goes too');
 assert.equal(await userDeletedQuarantine({data:f.data,file:path.join('/storage/.tdarr-corrupt',ID,'old.mkv'),identity}),true,'accepted under another mount of the share');
 assert.equal(await userDeletedQuarantine({data:f.data,file:path.join('/storage/.tdarr-corrupt',ID,'other.mkv'),identity}),false);
 assert.equal(await userDeletedQuarantine({data:f.data,file:path.join('/storage/.tdarr-corrupt',ID,'old.mkv'),identity:'9:9:9:9:9'}),false,'another file of the same name');
 assert.deepEqual([...await deletedQuarantineCases({data:f.data})],[ID]);
});

test('a case Recovery still works with refuses deletion; a case waiting for the user allows it and names the library copy',async t=>{
 const state=media=>({[ID]:{id:ID,status:'replacement_imported',source:path.join(media,'Film','old.mkv'),relative:'Film/old.mkv',replacementRelative:'Film/new.mkv'}});
 const busy=await fixture(t,{requests:[{id:ID,source:'recovery',phase:'waiting_replacement',statusUpdated:fresh,search:{status:'started'}}],state});
 const blocked=await busy.deleter.inspect(busy.roots,ID,'old.mkv');assert.equal(blocked.eligible,false);assert.deepEqual(blocked.blockers,['quarantine-delete-case-active']);
 await assert.rejects(busy.deleter.remove(busy.roots,ID,'old.mkv',{snapshot:blocked.snapshot,confirm:true}),{code:'quarantine_delete_not_eligible'});
 const open=await fixture(t,{requests:[{id:ID,source:'recovery',phase:'replacement_imported',tdarrStatus:'Not required',statusUpdated:fresh}],state}),view=await open.deleter.inspect(open.roots,ID,'old.mkv');
 assert.equal(view.eligible,true,JSON.stringify(view));assert.equal(view.library,'present');assert.deepEqual(view.case,{source:'recovery',category:'attention'});
 await fs.rm(path.join(open.media,'Film','new.mkv'));assert.equal((await open.deleter.inspect(open.roots,ID,'old.mkv')).library,'missing');
 assert.equal((await open.deleter.inspect(open.roots,ID,'old.mkv',{busy:true})).blockers.includes('quarantine-delete-busy'),true);
});

test('a missing, symlinked or invalid file is never deleted',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.deleter.inspect(f.roots,ID,'missing.mkv'),{code:'quarantine_delete_missing'});
 for(const name of ['../old.mkv','','a/b'])await assert.rejects(f.deleter.inspect(f.roots,ID,name),{code:'quarantine_delete_invalid'});
 await assert.rejects(f.deleter.inspect(f.roots,'x','old.mkv'),{code:'quarantine_delete_invalid'});
 const outside=path.join(f.root,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'old.mkv'),'x');
 const other='b'.repeat(24);await fs.symlink(outside,path.join(f.quarantine,other));
 await assert.rejects(f.deleter.inspect(f.roots,other,'old.mkv'),{code:'quarantine_delete_missing'});
 await fs.symlink(path.join(f.root,'outside','old.mkv'),path.join(f.quarantine,ID,'link.mkv'));
 await assert.rejects(f.deleter.inspect(f.roots,ID,'link.mkv'),{code:'quarantine_delete_missing'});
});

test('a case whose preserved copy the user deleted is done, whatever later warnings say',()=>{
 const base={id:ID,source:'recovery',phase:'replacement_imported',tdarrStatus:'Not required',statusUpdated:fresh};
 assert.equal(classifyRecovery(base,NOW).category,'attention');
 const done=classifyRecovery({...base,quarantineDeleted:true,retentionErrorPresent:true,error:'Approved replacement changed; quarantine preserved'},NOW);
 assert.equal(done.category,'done');assert.equal(done.reason,'quarantine-deleted');
});

test('the HTTP route shows the deletion first and deletes only with the shown snapshot and confirmation',linuxServer,async t=>{
 let file;
 const f=await reviewFixture({beforeStart:async({root})=>{file=path.join(root,'.tdarr-corrupt',ID,'old.mkv');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'PRESERVED ORIGINAL')}});
 t.after(()=>f.close());
 const route='/api/quarantine/delete',view=await f.get(route+'?caseId='+ID+'&name=old.mkv');
 assert.equal(view.eligible,true,JSON.stringify(view));
 assert.equal((await f.post(route,{caseId:ID,name:'old.mkv',snapshot:view.snapshot})).status,400);
 assert.equal((await f.post(route,{caseId:ID,name:'old.mkv',snapshot:'0'.repeat(64),confirm:true})).status,409);
 assert.equal((await f.post(route,{caseId:ID,name:'../old.mkv',snapshot:view.snapshot,confirm:true})).status,400);
 assert.equal((await fs.stat(file)).isFile(),true,'nothing deleted before a confirmed matching request');
 const done=await f.post(route,{caseId:ID,name:'old.mkv',snapshot:view.snapshot,confirm:true});
 assert.equal(done.status,200,await done.clone().text());assert.equal((await done.json()).deleted,true);
 await assert.rejects(fs.lstat(file),{code:'ENOENT'});
 assert.equal((await f.post(route,{caseId:ID,name:'old.mkv',snapshot:view.snapshot,confirm:true})).status,404);
 assert.equal((await f.eventually('quarantine.deleted')).length,1);
});
