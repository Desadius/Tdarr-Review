import test from 'node:test';
import assert from 'node:assert/strict';
import {createTranslator} from './public/i18n.js';
import {recoveryRuntimeView,recoveryRestartWarningView,recoveryConfigNoticeView} from './public/recovery-view.js';

class Element {
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.className='';this.textContent=''}
 append(...nodes){this.children.push(...nodes)}
 setAttribute(name,value){this.attributes[name]=String(value)}
}

const running={present:true,mode:'repair',state:'running',reason:null};
for(const [valid,czech,english]of [
 [true,'Konfigurace Recovery byla změněna. Změna se projeví až po restartu kontejneru s Review; restartuj ho, až budou Review i Recovery nečinné.','The Recovery configuration was changed. The change takes effect after restarting the container running Review; restart it when Review and Recovery are idle.'],
 [false,'Konfigurace Recovery byla změněna a není platná. Oprav config.json před restartem, jinak se Recovery nespustí.','The Recovery configuration was changed and is not valid. Fix config.json before restarting, otherwise Recovery will not start.']
])for(const [language,expected]of [['cs',czech],['en',english]])test('Recovery configuration '+(valid?'restart':'invalid-edit')+' notice renders in '+language,()=>withDocument(()=>{
 const view=recoveryConfigNoticeView({restartRequired:true,valid},createTranslator(language));assert.ok(view);assert.equal(textContent(view),expected);assert.equal(view.attributes.role,'status');
}));
const restartCopy={
 cs:'Restart nebo aktualizace kontejneru s Review přeruší Recovery. Počkej na dokončení kontroly originálu nebo změn prováděných Recovery. Přerušená kontrola není důkazem poškození.',
 en:'Restarting or updating the container running Review interrupts Recovery. Wait for the original check or changes made by Recovery to finish. An interrupted check is not evidence of corruption.'
};
for(const language of ['cs','en'])test('Recovery original check renders a container restart warning in '+language,()=>withDocument(()=>{
 const view=recoveryRestartWarningView([{source:'recovery',phase:'verifying',progress:{stage:'original_decode',running:true}}],running,createTranslator(language));
 assert.ok(view,'the active original check needs a warning');assert.equal(textContent(view),restartCopy[language]);assert.equal(view.attributes.role,'status');
}));
for(const phase of ['profile_intent','holding','quarantine_intent','quarantined','blocklist_intent','blocked','search_intent','defer_limit_intent','defer_cooldown_intent','replacement_queue_intent','restore_source_intent','remove_kept_source_intent','replacement_download_intent']){
 test('Recovery '+phase+' renders the interruption warning even with old case data',()=>withDocument(()=>{
  const view=recoveryRestartWarningView([{source:'recovery',phase,statusUpdated:'2026-09-01T00:00:00Z'}],running,createTranslator('en'));
  assert.ok(view,phase+' changes library, Tdarr or Radarr state');assert.equal(textContent(view),restartCopy.en);
 }));
}
for(const stage of ['confirmation','before_quarantine'])test('Recovery active '+stage+' checksum renders the interruption warning',()=>withDocument(()=>{
 const view=recoveryRestartWarningView([{source:'recovery',phase:'confirmed',fullHash:{stage,done:25,total:100}}],running,createTranslator('en'));
 assert.ok(view,'reading the original still needs the interruption warning');assert.equal(textContent(view),restartCopy.en);
}));
const inactiveHashes=[
 ['complete',{phase:'confirmed',fullHash:{stage:'before_quarantine',done:100,total:100}}],
 ['over-complete',{phase:'confirmed',fullHash:{stage:'before_quarantine',done:101,total:100}}],
 ['negative progress',{phase:'confirmed',fullHash:{stage:'before_quarantine',done:-1,total:100}}],
 ['non-finite progress',{phase:'confirmed',fullHash:{stage:'before_quarantine',done:NaN,total:100}}],
 ['empty source',{phase:'confirmed',fullHash:{stage:'before_quarantine',done:0,total:0}}],
 ['non-numeric size',{phase:'confirmed',fullHash:{stage:'before_quarantine',done:25,total:'100'}}],
 ['manual case',{phase:'manual',fullHash:{stage:'before_quarantine',done:25,total:100}}],
 ['imported case',{phase:'replacement_imported',fullHash:{stage:'before_quarantine',done:25,total:100}}]
];
for(const [label,record]of inactiveHashes)test('Recovery '+label+' checksum does not render an active interruption warning',()=>withDocument(()=>{
 assert.equal(recoveryRestartWarningView([{source:'recovery',...record}],running),null,label+' cannot imply an active checksum');
}));
test('Recovery idle cases do not render an active interruption warning',()=>withDocument(()=>{
 for(const phase of ['candidate','confirmed','waiting_replacement','waiting_source_kept','deferred_limit','deferred_cooldown','replacement_imported','manual','no_action','dry_run']){
  assert.equal(recoveryRestartWarningView([{source:'recovery',phase,tdarrStatus:'Transcoding',queue:[{status:'downloading'}]}],running),null,phase);
 }
}));
test('other services do not render the Recovery process interruption warning',()=>withDocument(()=>{
 assert.equal(recoveryRestartWarningView([{source:'radarr',phase:'verifying'}],running),null,'Radarr cases are not Recovery process work');
}));
for(const state of ['off','stopped','refused','restarting','unreadable'])test('inactive Recovery runtime '+state+' does not render an active interruption warning',()=>withDocument(()=>{
 assert.equal(recoveryRestartWarningView([{source:'recovery',phase:'verifying'}],{...running,state}),null,state);
}));
test('Recovery runtime suppresses reason text outside the safe technical-code contract',()=>withDocument(()=>{
 for(const reason of ['API_KEY=private','/private/config.json','<script>private</script>','a'.repeat(65)]){
  const view=recoveryRuntimeView({...running,state:'refused',reason},createTranslator('en'));
  assert.equal(textContent(view),'Recovery status: Startup refused · Repair');
 }
}));
const textContent=node=>[node.textContent,...node.children.map(textContent)].filter(Boolean).join(' ');
function withDocument(run){
 const previous=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};
 try{return run()}finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous}
}

const runtimeStates=[
  [{present:false,mode:'off',state:'off',reason:null},'Stav Recovery: Off','Recovery status: Off'],
  [{present:true,mode:'verify',state:'running',reason:null},'Stav Recovery: Běží · Verify','Recovery status: Running · Verify'],
  [{present:true,mode:'repair',state:'restarting',reason:'crash-loop'},'Stav Recovery: Restartuje se · Repair Důvod: crash-loop','Recovery status: Restarting · Repair Reason: crash-loop'],
  [{present:true,mode:'repair',state:'refused',reason:'approval-registry-invalid'},'Stav Recovery: Spuštění odmítnuto · Repair Důvod: approval-registry-invalid','Recovery status: Startup refused · Repair Reason: approval-registry-invalid'],
  [{present:true,mode:'verify',state:'stopped',reason:'review-exited'},'Stav Recovery: Zastaveno · Verify Důvod: review-exited','Recovery status: Stopped · Verify Reason: review-exited'],
  [{present:true,state:'unreadable',reason:null},'Stav Recovery: Stav nelze přečíst','Recovery status: Status cannot be read']
];
for(const [runtime,czech,english]of runtimeStates){
 for(const [language,expected]of [['cs',czech],['en',english]]){
  test('Recovery runtime renders '+runtime.state+' and its reason in '+language,()=>withDocument(()=>{
   const view=recoveryRuntimeView(runtime,createTranslator(language));
   assert.equal(textContent(view),expected,language+' '+runtime.state);
   assert.equal(view.attributes.role,'status');
  }));
 }
}
