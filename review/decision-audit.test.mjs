import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {recordDecision,AUDIT_FILE} from './decision-audit.mjs';

const posix={skip:process.platform==='win32'?'Requires POSIX directory fsync and file modes':false};
const NOW=new Date('2026-10-13T12:00:00.000Z');
async function withDir(run){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'review-decisions-'));try{await run(dir)}finally{await fs.rm(dir,{recursive:true,force:true})}}
const lines=async file=>(await fs.readFile(file,'utf8')).trim().split('\n').map(JSON.parse);

test('records append as private JSON lines and survive reopening',posix,()=>withDir(async dir=>{
 await recordDecision(dir,{event:'approval',id:'a'.repeat(24),title:'<b>Film</b>\n"x"',outcome:'success',reviewSession:{revision:3}},{now:NOW});
 await recordDecision(dir,{event:'replacement',id:'b'.repeat(24),outcome:'error',message:'Radarr offline',time:'2026-10-13T13:00:00.000Z'},{now:NOW});
 const file=path.join(dir,AUDIT_FILE),rows=await lines(file);
 assert.equal((await fs.stat(file)).mode&0o777,0o600);
 assert.deepEqual(rows.map(r=>[r.event,r.outcome,r.time]),[['approval','success','2026-10-13T12:00:00.000Z'],['replacement','error','2026-10-13T13:00:00.000Z']]);
 assert.equal(rows[0].title,'<b>Film</b>\n"x"');assert.deepEqual(rows[0].reviewSession,{revision:3});
}));

test('size rotation archives the full file and never deletes earlier records',posix,()=>withDir(async dir=>{
 const record=n=>({event:'approval',id:String(n).padStart(24,'0'),note:'x'.repeat(100)});
 for(let n=0;n<10;n++)await recordDecision(dir,record(n),{now:new Date(NOW.getTime()+n*1000),maxBytes:600});
 const files=(await fs.readdir(dir)).sort(),archives=files.filter(f=>f!==AUDIT_FILE);
 assert.ok(files.includes(AUDIT_FILE));assert.ok(archives.length>=2);assert.ok(archives.every(f=>/^decision-audit-2026-10-13T12-00-\d\d-000Z(-\d+)?\.jsonl$/.test(f)));
 const all=[];for(const f of files.filter(f=>f!==AUDIT_FILE))all.push(...await lines(path.join(dir,f)));all.push(...await lines(path.join(dir,AUDIT_FILE)));
 assert.deepEqual(all.map(r=>Number(r.id)),[0,1,2,3,4,5,6,7,8,9],'every record kept once, in order');
 for(const f of files)assert.ok((await fs.stat(path.join(dir,f))).size<=600);
}));

test('a rotation never overwrites an archive with the same timestamp',posix,()=>withDir(async dir=>{
 for(let n=0;n<6;n++)await recordDecision(dir,{event:'approval',n,pad:'y'.repeat(200)},{now:NOW,maxBytes:300});
 const archives=(await fs.readdir(dir)).filter(f=>f!==AUDIT_FILE);
 assert.equal(new Set(archives).size,archives.length);assert.equal(archives.length,5);
}));

test('concurrent records are serialized without interleaving',posix,()=>withDir(async dir=>{
 await Promise.all(Array.from({length:25},(_,n)=>recordDecision(dir,{event:'approval',n,pad:'z'.repeat(50)},{now:NOW,maxBytes:2000})));
 const files=await fs.readdir(dir),all=[];for(const f of files)all.push(...await lines(path.join(dir,f)));
 assert.deepEqual(all.map(r=>r.n).sort((a,b)=>a-b),Array.from({length:25},(_,n)=>n));
}));

test('a symlinked audit file is refused and a failure does not block later records',posix,()=>withDir(async dir=>{
 const outside=path.join(dir,'outside.txt');await fs.writeFile(outside,'keep');await fs.symlink(outside,path.join(dir,AUDIT_FILE));
 await assert.rejects(recordDecision(dir,{event:'approval'}),/není běžný soubor/);
 assert.equal(await fs.readFile(outside,'utf8'),'keep');
 await fs.unlink(path.join(dir,AUDIT_FILE));await recordDecision(dir,{event:'approval',n:1});
 assert.equal((await lines(path.join(dir,AUDIT_FILE)))[0].n,1);
}));

test('approvals and replacement requests are audited; audit failure only adds a warning',async()=>{
 const server=await fs.readFile(new URL('./server.mjs',import.meta.url),'utf8');
 const perform=server.slice(server.indexOf('async function perform('),server.indexOf('async function performBatch('));
 const replacement=server.slice(server.indexOf('async function replacementAction('),server.indexOf('const replacementTimer='));
 assert.match(perform,/if\(action==='approve'\)\{try\{await recordDecision\(DATA,\{event:'approval',[^}]*reviewSession:reviewEvidence,[^}]*transaction:journal\?path\.basename\(journal,'\.json'\):null,outcome:outcome\.status/);
 assert.match(replacement,/try\{await recordDecision\(DATA,\{event:'replacement',[^}]*reason,requestId:outcome\.requestId,outcome:outcome\.status/);
 for(const source of [perform,replacement])assert.match(source,/\}catch\(e\)\{auditFailed\(outcome,e\)\}/);
 assert.ok(perform.indexOf("recordDecision(DATA,{event:'approval'")<perform.indexOf('state.history=state.history.slice(0,150)'),'the warning is saved with the history entry');
});
