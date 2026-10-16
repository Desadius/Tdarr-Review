import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {rejectionReason,recordRejection} from './rejection-audit.mjs';
import {createTranslator} from './public/i18n.js';
for(const value of [undefined,null,42,{},'', '   ','a'.repeat(1001),'bad\u0000value'])test('Reject invalid reason '+JSON.stringify(value)?.slice(0,30),()=>assert.throws(()=>rejectionReason(value)));
test('Unicode, whitespace and multiline reason retained',()=>assert.equal(rejectionReason('  Chybí japonský zvuk.\nNesedí dialog.  '),'Chybí japonský zvuk.\nNesedí dialog.'));
test('Archive survives reopen and safely escapes hostile strings',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'review-reasons-'));
 try{const reason='<script>alert(1)</script>\n"zvuk"';await recordRejection(dir,{event:'requested',reason});await recordRejection(dir,{event:'completed',status:'success',reason});const rows=(await fs.readFile(path.join(dir,'rejection-decisions.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(rows.length,2);assert.equal(rows[0].reason,reason);assert.ok(rows[1].time);}
 finally{await fs.rm(dir,{recursive:true,force:true})}
});
// The server's rejection handling (reason validation before any scan, archive before deletion,
// retained job ID) is tested over HTTP in decision-http.test.mjs.
test('History reasons are rendered as text and action requests include the entered reason',async()=>{
 const ui=await fs.readFile(new URL('./public/app.js',import.meta.url),'utf8');
 assert.ok(ui.includes("reason:['reject','replace'].includes(request.action)?reason:undefined"));
 const kit=await fs.readFile(new URL('./public/ui-kit.js',import.meta.url),'utf8');
 const helper=kit.split('\n').find(line=>line.startsWith('export const el='))?.replace(/^export /,'');
 const renderReason=ui.split('\n').find(line=>line.includes('if(h.rejectionReason)'));
 assert.ok(helper&&renderReason,'Exercise the actual element helper and history reason renderer');
 for(const reason of ['Zavřít','<img src=x onerror=alert(1)>\n"Zavřít"']){
  const nodes=[];
  const context={document:{createElement:()=>({})},tr:createTranslator('en'),h:{rejectionReason:reason},row:{append:node=>nodes.push(node)}};
  vm.runInNewContext(helper+'\n'+renderReason,context);
  assert.equal(nodes.length,1);
  assert.equal(nodes[0].textContent,'Reason: '+reason,'Translate the label, not the user-authored reason');
  assert.equal(nodes[0].innerHTML,undefined,'Hostile markup must never be assigned to innerHTML');
 }
});
