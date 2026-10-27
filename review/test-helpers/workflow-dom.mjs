import {mountReviewWorkflow} from '../public/review-workflow.js';
import {createTranslator} from '../public/i18n.js';
import {updateReviewSession,reviewComplete} from '../review-session.mjs';

// A minimal DOM and a recording review-session API for driving the real browser review workflow in tests.
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
 // Matches this element only (the helper keeps no parent links): tag names, with input:not([type="range"]).
 closest(selector){return selector.split(',').some(part=>{const tag=/^[a-z]+/.exec(part.trim())?.[0];return !!tag&&this.tagName===tag.toUpperCase()&&!(part.includes('not([type="range"])')&&this.type==='range')})?this:null}
 addEventListener(type,fn){(this.listeners??=new Map()).set(type,[...(this.listeners.get(type)||[]),fn])}
 removeEventListener(type,fn){this.listeners?.set(type,(this.listeners.get(type)||[]).filter(x=>x!==fn))}
 // A key press on this element: listeners see a cancellable event whose target is the element.
 key(key,{shiftKey=false,target=this}={}){const event={key,shiftKey,target,defaultPrevented:false,preventDefault(){this.defaultPrevented=true},stopPropagation(){}};for(const fn of this.listeners?.get('keydown')||[])fn(event);return event}
}
class Option extends Element{constructor(label,value){super('option');this.textContent=label;this.value=value}}
export const flush=async()=>{await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve))};
const keys=['preparation','image','audio','syncStart','syncMiddle','syncEnd','hdr'];
// strict applies the server's session rules (review-session.mjs) to every write, as the real API does.
export async function workflowFixture(t,{language='en',hdr=false,step=0,checks={},device='',method='review',pair=true,prepared=false,openGuided=false,failWriteAt=0,strict=false,comparison,item:itemExtra={},callbacks={}}={}){
 const previous={document:globalThis.document,Option:globalThis.Option,sessionStorage:globalThis.sessionStorage};
 globalThis.document={createElement:tag=>new Element(tag)};globalThis.Option=Option;globalThis.sessionStorage={getItem:()=>null,setItem(){}};
 const host=new Element('div'),writes=[],tools=[];let writable=true,pendingSave=null,pendingLoad=null,playerOptions=null;
 let record={snapshot:'snapshot',revision:0,requirements:{hdr},complete:false,session:{method,device,step,scope:{originalIndex:pair?1:null,reviewIndex:pair?2:null,seconds:10},checks:Object.fromEntries(keys.map(key=>[key,checks[key]===true])),note:'',deferred:false,...(comparison?{comparison}:{})}};
 if(strict&&Object.values(checks).some(Boolean))record.revision=1;
 const player={commands:[],wipeMode:'half',optionsOpen:false,snapshot:()=>({status:'idle',position:0,duration:12}),command(name,value){this.commands.push([name,structuredClone(value)]);return Promise.resolve()},setWipeMode(mode){this.wipeMode=mode;return mode},options(open){this.optionsOpen=!!open}};
 const workflow=mountReviewWorkflow(host,{id:'fixture',snapshot:'snapshot',durationA:100,durationB:100,originalBytes:20e9,reviewBytes:9e9,...itemExtra},{...callbacks,preparation:prepared?{snapshot:'snapshot',state:'ready',ready:22,total:22}:null,tr:createTranslator(language),canWrite:()=>writable,api:async(route,body)=>{
  if(route.endsWith('/audio-compare'))return {original:[{index:1,label:'Original'}],review:[{index:2,label:'Review'}]};
  if(body){writes.push(structuredClone(body));if(pendingSave)await pendingSave;if(failWriteAt&&writes.length===failWriteAt){const error=Error('revision changed');error.status=409;throw error}if(strict){const session=updateReviewSession({session:record.session},body.session);record={...record,revision:record.revision+1,session,complete:reviewComplete(session,{hdr})}}else record={...record,revision:record.revision+1,session:structuredClone(body.session)}}
  if(!body&&pendingLoad)await pendingLoad;return structuredClone(record);
 },openComparison:(_item,options)=>{tools.push(options);return ()=>{}},openAudioComparison:(_item,options)=>{tools.push(options);return ()=>{}},openGuidedComparison:openGuided?(_item,options)=>{playerOptions=options;const cleanup=()=>{};cleanup.controller=player;return cleanup}:undefined});
 t.after(()=>{workflow.destroy();for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value}});
 await flush();
 return {host,writes,workflow,tools,player,playerOptions:()=>playerOptions,stage:()=>host.querySelector('.single-pass'),async press(key,options){const event=host.querySelector('.single-pass').key(key,options);await flush();return event},next:()=>host.querySelector('[data-step-save]'),warning:()=>host.querySelector('.workflow-warning'),check:key=>host.querySelectorAll('[data-check]').find(n=>n.dataset.check===key),async confirm(key){const n=this.check(key);n.checked=true;await n.emit('change')},busy(value){writable=!value;workflow.refreshGuard()},holdSave(promise){pendingSave=promise},holdLoad(promise){pendingLoad=promise},record:()=>structuredClone(record)};
}

