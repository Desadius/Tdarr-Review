import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {rejectionReason,recordRejection} from './rejection-audit.mjs';
const server=await fs.readFile(new URL('./server.mjs',import.meta.url),'utf8');
const code=server.slice(server.indexOf('async function perform('),server.indexOf('async function performBatch('));
for(const value of [undefined,null,42,{},'', '   ','a'.repeat(1001),'bad\u0000value'])test('Reject invalid reason '+JSON.stringify(value)?.slice(0,30),()=>assert.throws(()=>rejectionReason(value)));
test('Unicode, whitespace and multiline reason retained',()=>assert.equal(rejectionReason('  Chybí japonský zvuk.\nNesedí dialog.  '),'Chybí japonský zvuk.\nNesedí dialog.'));
test('Archive survives reopen and safely escapes hostile strings',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'review-reasons-'));
 try{const reason='<script>alert(1)</script>\n"zvuk"';await recordRejection(dir,{event:'requested',reason});await recordRejection(dir,{event:'completed',status:'success',reason});const rows=(await fs.readFile(path.join(dir,'rejection-decisions.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(rows.length,2);assert.equal(rows[0].reason,reason);assert.ok(rows[1].time);}
 finally{await fs.rm(dir,{recursive:true,force:true})}
});
function context(failArchive=false){
 const events=[],state={items:{film:{jobId:'job17'}},history:[],pauses:[]};
 const item={id:'film',title:'Film',relative:'Film.mkv',reviewRelative:'PROD/Film.mkv',snapshot:'snapshot',originalBytes:900,reviewBytes:400,assessment:{score:90}};
 const box={state,active:null,cache:null,statsCache:null,recovery:[],DATA:'/data',MEDIA:'/media',REVIEW:'/review',config:{reviewPrefixes:['PROD']},hash:()=> 'snapshot',safeFile:async(root)=>({path:root+'/Film.mkv',fp:'fp',stat:{size:root==='/media'?900:400}}),tdarr:async()=>({}),workerBusy:()=>false,captureReceipt:async()=>({}),cleanupReviewed:async()=>events.push('cleanup'),progress:()=>{},resume:async()=>{},save:async()=>events.push('save'),fs:{unlink:async p=>events.push('unlink:'+p)},rejectionReason,recordRejection:async(_data,row)=>{events.push(row.event);if(failArchive&&row.event==='requested')throw Error('archive unavailable');events.push(row)},path,crypto:{},console};
 vm.createContext(box);vm.runInContext(code+';globalThis.performTest=perform;',box);
 return {box,events,state,item};
}
test('Real reject handler archives reason before deletion, keeps original and retains job ID',async()=>{
 const {box,events,state,item}=context();await box.performTest('reject',item,false,'Chybí zvuk');assert.ok(events.indexOf('requested')<events.indexOf('unlink:/review/Film.mkv'));assert.ok(!events.some(e=>String(e).includes('unlink:/media')));assert.equal(state.history[0].status,'success');assert.equal(state.history[0].rejectionReason,'Chybí zvuk');assert.equal(state.history[0].jobId,'job17');assert.equal(events.find(e=>e?.event==='requested').snapshot,'snapshot');assert.ok(!state.items.film);
});
test('Failed durable archive prevents destructive action',async()=>{
 const {box,events,state,item}=context(true);await box.performTest('reject',item,false,'Nesedí obraz');assert.equal(state.history[0].status,'error');assert.equal(state.history[0].rejectionReason,'Nesedí obraz');assert.ok(state.items.film);assert.ok(!events.some(e=>String(e).startsWith('unlink:')));
});
test('Missing reason cannot start a rejection',async()=>{const {box,events,item}=context();await assert.rejects(box.performTest('reject',item));assert.deepEqual(events,[]);assert.equal(box.active,null)});
test('API validates reason before file scan and passes it into handler',()=>{const route=server.slice(server.indexOf("const action=/^\\/api\\/items"),server.indexOf('const audio=/'));assert.ok(route.indexOf('rejectionReason(b.reason)')<route.indexOf('await scan(true)'));assert.ok(route.includes('respond(res,400'));assert.ok(route.includes('perform(action[2],item,acceptDuration,reason)'))});
test('History reasons are rendered as text and action requests include the entered reason',async()=>{const ui=await fs.readFile(new URL('./public/app.js',import.meta.url),'utf8');assert.ok(ui.includes("'Důvod: '+h.rejectionReason"));assert.ok(ui.includes("reason:['reject','replace'].includes(request.action)?reason:undefined"));const line=ui.split('\n').find(x=>x.startsWith('const el='));const context={document:{createElement:()=>({})},value:'<img src=x onerror=alert(1)>'};vm.runInNewContext(line+";this.node=el('p','',value)",context);assert.equal(context.node.textContent,context.value);assert.equal(context.node.innerHTML,undefined);});
