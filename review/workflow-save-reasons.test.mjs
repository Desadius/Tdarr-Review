import test from 'node:test';
import assert from 'node:assert/strict';
import {mountReviewWorkflow} from './public/review-workflow.js';
import {createTranslator} from './public/i18n.js';

class Element{
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attrs={};this.value='';this.disabled=false;this.checked=false;this.hidden=false;this.ownText='';this.classList={add:()=>{}}}
 get textContent(){return this.ownText+this.children.map(n=>n.textContent).join(' ')}
 set textContent(value){this.ownText=String(value);this.children=[]}
 append(...nodes){this.children.push(...nodes)}
 prepend(...nodes){this.children.unshift(...nodes)}
 replaceChildren(...nodes){this.ownText='';this.children=[...nodes]}
 setAttribute(key,value){this.attrs[key]=String(value)}
 getAttribute(key){return this.attrs[key]??null}
 hasAttribute(key){return key.startsWith('data-')?key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()) in this.dataset:key in this.attrs}
 querySelectorAll(selector){const found=[],matches=n=>selector.startsWith('[')?n.hasAttribute(selector.slice(1,-1)):selector.startsWith('.')?n.className?.split(' ').includes(selector.slice(1)):n.tagName===selector.toUpperCase();const visit=n=>{for(const child of n.children){if(matches(child))found.push(child);visit(child)}};visit(this);return found}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null}
 async emit(type){await this['on'+type]?.({target:this,preventDefault(){}})}
 async activate(){if(!this.disabled)await this.emit('click')}
 focus(){}
}
class Option extends Element{constructor(label,value){super('option');this.textContent=label;this.value=value}}
const flush=async()=>{await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve))};
const keys=['preparation','image','audio','syncStart','syncMiddle','syncEnd','hdr'];
async function fixture(t,{language='en',hdr=false,step=0,checks={},device='',method='review',pair=true,prepared=false}={}){
 const previous={document:globalThis.document,Option:globalThis.Option,sessionStorage:globalThis.sessionStorage};
 globalThis.document={createElement:tag=>new Element(tag)};globalThis.Option=Option;globalThis.sessionStorage={getItem:()=>null,setItem(){}};
 const host=new Element('div'),writes=[],tools=[];let writable=true,pendingSave=null,pendingLoad=null;
 let record={snapshot:'snapshot',revision:0,requirements:{hdr},complete:false,session:{method,device,step,scope:{originalIndex:pair?1:null,reviewIndex:pair?2:null,seconds:10},checks:Object.fromEntries(keys.map(key=>[key,checks[key]===true])),note:'',deferred:false}};
 const workflow=mountReviewWorkflow(host,{id:'fixture',snapshot:'snapshot',durationA:100,durationB:100},{preparation:prepared?{snapshot:'snapshot',state:'ready',ready:22,total:22}:null,tr:createTranslator(language),canWrite:()=>writable,api:async(route,body)=>{
  if(route.endsWith('/audio-compare'))return {original:[{index:1,label:'Original'}],review:[{index:2,label:'Review'}]};
  if(body){writes.push(structuredClone(body));if(pendingSave)await pendingSave;record={...record,revision:record.revision+1,session:structuredClone(body.session)}}
  if(!body&&pendingLoad)await pendingLoad;return structuredClone(record);
 },openComparison:(_item,options)=>{tools.push(options);return ()=>{}},openAudioComparison:(_item,options)=>{tools.push(options);return ()=>{}}});
 t.after(()=>{workflow.destroy();for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value}});
 await flush();
 return {host,writes,workflow,tools,next:()=>host.querySelector('[data-step-save]'),warning:()=>host.querySelector('.workflow-warning'),check:key=>host.querySelectorAll('[data-check]').find(n=>n.dataset.check===key),async confirm(key){const n=this.check(key);n.checked=true;await n.emit('change')},busy(value){writable=!value;workflow.refreshGuard()},holdSave(promise){pendingSave=promise},holdLoad(promise){pendingLoad=promise},record:()=>structuredClone(record)};
}

for(const language of ['cs','en'])test(`Save and continue explains HDR device and manual confirmation in ${language}`,async t=>{
 const f=await fixture(t,{hdr:true,language,prepared:true});
 assert.match(f.host.textContent,/22\/22/);
 assert.equal(f.next().disabled,false,'explanation remains available through native button activation');
 assert.equal(f.next().type,'button');assert.equal(f.next().getAttribute('aria-disabled'),'true');
 await f.next().activate();
 assert.equal(f.writes.length,0,'blocked activation never submits a review');
 assert.equal(f.warning().hidden,false);assert.equal(f.warning().getAttribute('role'),'alert');
 const text=f.warning().textContent;assert.match(text,/HDR\/Dolby Vision/);assert.match(text,language==='en'?/Confirm.*correct original/:/Potvrď.*správný originál/);
 assert.equal(f.warning().querySelectorAll('li').length,2);assert.equal(f.writes.length,0);assert.equal(f.workflow.step,0);assert.equal(f.check('preparation').checked,false);
 const device=f.host.querySelectorAll('input').find(n=>n.type!=='checkbox');device.value='Fixture TV';await device.emit('input');
 assert.equal(f.check('preparation').checked,false);await f.confirm('preparation');await f.next().activate();
 assert.equal(f.workflow.step,1);assert.equal(f.writes.at(-1).session.step,1);assert.equal(f.check('image').checked,false);assert.equal(f.check('hdr').checked,false);
});

test('changing the HDR device resets a previous confirmation and explains it again',async t=>{
 const f=await fixture(t,{hdr:true});await f.confirm('preparation');
 const device=f.host.querySelectorAll('input').find(n=>n.type!=='checkbox');device.value='Another TV';await device.emit('input');
 assert.equal(f.check('preparation').checked,false);await f.next().activate();
 assert.equal(f.warning().querySelectorAll('li').length,1);assert.match(f.warning().textContent,/Confirm.*correct original/);assert.doesNotMatch(f.warning().textContent,/Enter.*device/);assert.equal(f.writes.length,0);
});

test('ordinary review explains only its missing pair and preparation confirmation',async t=>{
 const f=await fixture(t,{pair:false});await f.next().activate();
 assert.equal(f.warning().querySelectorAll('li').length,2);assert.match(f.warning().textContent,/audio tracks/);assert.doesNotMatch(f.warning().textContent,/device|HDR/);
 const selects=f.host.querySelectorAll('select');selects[1].value='1';await selects[1].emit('change');selects[2].value='2';await selects[2].emit('change');await f.confirm('preparation');await f.next().activate();
 assert.equal(f.workflow.step,1);assert.equal(f.writes.length,2,'identity is persisted before the explicit confirmation');
});

for(const step of [1,2])test(`step ${step} explains only its own manual check and invalid sample`,async t=>{
 const f=await fixture(t,{step,checks:{preparation:true,image:step===2}});await f.next().activate();
 assert.equal(f.warning().querySelectorAll('li').length,1);assert.match(f.warning().textContent,step===1?/picture/:/selected audio tracks/);
 await f.confirm(step===1?'image':'audio');f.tools.at(-1).onScopeValidityChange(false);await f.next().activate();
 assert.equal(f.warning().querySelectorAll('li').length,1);assert.match(f.warning().textContent,/valid sample interval/);assert.equal(f.writes.length,0);
 f.tools.at(-1).onScopeValidityChange(true);await f.next().activate();assert.equal(f.workflow.step,step+1);
});

test('synchronisation explanation distinguishes unchecked and checked-but-unsaved checkpoints',async t=>{
 const f=await fixture(t,{step:3,checks:{preparation:true,image:true,audio:true}});await f.next().activate();
 assert.equal(f.warning().querySelectorAll('li').length,6);assert.match(f.warning().textContent,/beginning|start/);assert.match(f.warning().textContent,/middle/);assert.match(f.warning().textContent,/end/);
 await f.confirm('syncStart');await f.next().activate();assert.equal(f.writes.length,0);assert.match(f.warning().textContent,/Save.*beginning|Save.*start/);
 await f.confirm('syncMiddle');await f.confirm('syncEnd');await f.next().activate();assert.equal(f.writes.length,0,'checked boxes still need individual saved checkpoints');assert.equal(f.workflow.step,3);assert.equal(f.warning().querySelectorAll('li').length,3);
 for(const key of ['syncStart','syncMiddle','syncEnd']){if(!f.check(key).checked)await f.confirm(key);await f.host.querySelectorAll('[data-checkpoint]').find(n=>n.dataset.checkpoint===key).activate()}
 await f.next().activate();assert.equal(f.workflow.step,4);assert.equal(f.writes.length,4);
});

test('busy and stale state explain the operational blocker without writing',async t=>{
 const f=await fixture(t,{checks:{preparation:true}});f.busy(true);await f.next().activate();assert.match(f.warning().textContent,/another action/);assert.equal(f.writes.length,0);
 f.busy(false);f.workflow.invalidate();await f.next().activate();assert.equal(f.warning().hidden,false);assert.match(f.warning().textContent,/files(?: have)? changed/i);assert.equal(f.writes.length,0);
});

test('an in-flight save cannot be submitted again through the explanation button',async t=>{
 const f=await fixture(t,{checks:{preparation:true}});let release;f.holdSave(new Promise(resolve=>release=resolve));
 const saving=f.next().activate();await flush();await f.next().activate();assert.match(f.warning().textContent,/saving/i);assert.equal(f.writes.length,1);release();await saving;assert.equal(f.workflow.step,1);
});

test('HDR picture step asks only for its missing native-device confirmation',async t=>{
 const f=await fixture(t,{hdr:true,step:1,device:'Fixture TV',checks:{preparation:true,image:true}});await f.next().activate();
 assert.equal(f.warning().querySelectorAll('li').length,1);assert.match(f.warning().textContent,/Confirm.*HDR\/Dolby Vision/);assert.equal(f.writes.length,0);
 await f.confirm('hdr');await f.next().activate();assert.equal(f.workflow.step,2);
});

test('external review requires two non-whitespace device characters',async t=>{
 const f=await fixture(t,{method:'external',checks:{preparation:true},device:' x '});await f.next().activate();
 assert.match(f.warning().textContent,/external check.*two characters/);assert.doesNotMatch(f.warning().textContent,/HDR/);assert.equal(f.writes.length,0);
});

test('a changed saved revision explains the conflict and retains a working reload action',async t=>{
 const f=await fixture(t);const note=f.host.querySelector('textarea');note.value='Unsaved draft';await note.emit('input');
 f.workflow.observe({...f.record(),revision:1});await f.next().activate();assert.match(f.warning().textContent,/other session/);assert.equal(f.writes.length,0);
 const reload=f.warning().querySelector('button');assert.ok(reload,'conflict explanation offers reload');let release;f.holdLoad(new Promise(resolve=>release=resolve));const reloading=reload.activate();await flush();assert.match(f.warning().textContent,/review progress to load/);release();await reloading;await flush();assert.equal(f.warning().hidden,true);
});
