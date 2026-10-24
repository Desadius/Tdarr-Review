import test from 'node:test';
import assert from 'node:assert/strict';
import {mountPlayerControls} from './public/player-controls.js';

class Element{
 constructor(tag){Object.assign(this,{tagName:tag.toUpperCase(),children:[],parentElement:null,attributes:new Map(),dataset:{},style:{},className:'',textContent:'',value:'',disabled:false,hidden:false,listeners:new Map(),type:'',ownerDocument:globalThis.document})}
 append(...nodes){for(const node of nodes){node.parentElement?.removeChild(node);node.parentElement=this;this.children.push(node)}}
 prepend(...nodes){for(const node of nodes){node.parentElement?.removeChild(node);node.parentElement=this}this.children.unshift(...nodes)}
 removeChild(node){this.children=this.children.filter(child=>child!==node);node.parentElement=null;return node}
 replaceChildren(...nodes){for(const child of this.children)child.parentElement=null;this.children=[];this.append(...nodes)}
 setAttribute(key,value){this.attributes.set(key,String(value));if(key==='class')this.className=String(value);if(key==='type')this.type=String(value)}
 getAttribute(key){return this.attributes.get(key)??null}
 hasAttribute(key){return this.attributes.has(key)}
 addEventListener(type,listener){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(listener)}
 removeEventListener(type,listener){this.listeners.get(type)?.delete(listener)}
 dispatch(type,properties={}){const event={type,target:this,currentTarget:this,defaultPrevented:false,preventDefault(){this.defaultPrevented=true},stopPropagation(){this.propagationStopped=true},...properties};for(const listener of [...this.listeners.get(type)||[]])listener(event);return event}
 contains(node){return this===node||this.children.some(child=>child.contains(node))}
 closest(selector){for(let node=this;node;node=node.parentElement){if(selector.split(',').some(part=>{const value=part.trim();if(value.startsWith('['))return node.hasAttribute(value.slice(1,-1).split('=')[0]);return node.tagName===value.toUpperCase()}))return node}return null}
 querySelectorAll(selector){const result=[];const visit=node=>{for(const child of node.children){let match=false;if(selector.startsWith('[data-action="'))match=child.dataset.action===selector.slice(14,-2);else if(selector.startsWith('[role="'))match=child.getAttribute('role')===selector.slice(7,-2);else if(selector.startsWith('.'))match=child.className.split(/\s+/).includes(selector.slice(1));else match=child.tagName===selector.toUpperCase();if(match)result.push(child);visit(child)}};visit(this);return result}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null}
 focus(){globalThis.document.activeElement=this}
 click(){if(!this.disabled){this.focus();this.dispatch('click')}}
}

function fixture(){
 const oldDocument=globalThis.document;const document={activeElement:null,fullscreenElement:null,createElement:tag=>new Element(tag)};globalThis.document=document;
 const host=new Element('main');host.ownerDocument=document;host.tabIndex=0;
 const listeners=new Set(),commands=[];let state={status:'paused',excerptIndex:1,excerptCount:3,phaseIndex:2,phase:'together',position:4,duration:12,totalDuration:36,elapsed:16,sourceTime:104,volume:.7,muted:false,routing:'ears',swapEars:false};
 const controller={command:(...args)=>commands.push(args),snapshot:()=>({...state}),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},update(next){state={...state,...next};for(const fn of listeners)fn({...state})}};
 const cleanups=[],callbacks={fullscreen:0,focus:0,view:0,wipe:0,escape:0};const unmount=mountPlayerControls(host,controller,{tr:x=>x,onFullscreen:()=>callbacks.fullscreen++,onFocus:()=>callbacks.focus++,onView:()=>callbacks.view++,onWipe:()=>callbacks.wipe++,onEscape:()=>{callbacks.escape++;return callbacks.escape===1}});
 const find=(action)=>host.querySelectorAll('[data-action="'+action+'"]')[0]||null;
 return {host,controller,commands,callbacks,find,cleanup(){unmount();globalThis.document=oldDocument},key(key,overrides={}){document.activeElement=host;return host.dispatch('keydown',{key,repeat:false,defaultPrevented:false,isComposing:false,...overrides})},setActive(node){document.activeElement=node}};
}

test('workspace shortcuts dispatch one shared transport command and stay focus scoped',()=>{
 const f=fixture();try{
   const expected=[['toggle',undefined],['seek',3],['seek',5],['mute',true],['previous',undefined],['next',undefined],['repeat',undefined],['stop',undefined]];
  for(const [key] of [[' '],['ArrowLeft'],['ArrowRight'],['m'],['['],[']'],['r'],['s']]){const event=f.key(key);assert.equal(event.defaultPrevented,true)}
  assert.deepEqual(f.commands,expected);
  f.commands.length=0;
   const checkbox=new Element('input');checkbox.setAttribute('type','checkbox');const slider=new Element('div');slider.setAttribute('role','slider');const editable=new Element('div');editable.setAttribute('contenteditable','true');
   for(const target of [new Element('input'),checkbox,new Element('textarea'),new Element('select'),new Element('button'),slider,editable]){target.ownerDocument=globalThis.document;f.setActive(f.host);const event=f.host.dispatch('keydown',{key:' ',target,repeat:false});assert.equal(event.defaultPrevented,false)}
   f.setActive(f.find('seek'));assert.equal(f.host.dispatch('keydown',{key:'ArrowRight'}).defaultPrevented,false);
  f.setActive(f.host);assert.equal(f.key('ArrowRight',{ctrlKey:true}).defaultPrevented,false);assert.equal(f.key('ArrowRight',{repeat:true}).defaultPrevented,false);assert.equal(f.key('ArrowRight',{isComposing:true}).defaultPrevented,false);
  f.setActive(f.host);assert.equal(f.key('K',{shiftKey:true}).defaultPrevented,false);
  f.setActive(null);assert.equal(f.host.dispatch('keydown',{key:'m'}).defaultPrevented,false);
  assert.deepEqual(f.commands,[]);
 }finally{f.cleanup()}
});

test('toolbar reflects shared state and dispatches controls without changing playback state itself',()=>{
 const f=fixture();try{
  assert.equal(f.find('play').getAttribute('aria-label'),'Přehrát');
  assert.equal(f.host.querySelector('.player-controls-status').textContent,'Ukázka 2 z 3 · Společné · Oddělené uši · 00:04 / 00:12 · Zbývá 00:08 · Relace 00:16 / 00:36 · Zdroj 01:44');
  f.find('seek').value='8';f.find('seek').dispatch('input');f.find('volume').value='0.4';f.find('volume').dispatch('input');f.find('mute').click();f.find('routing').click();f.find('swap-ears').click();f.find('repeat').click();f.find('play').click();
  assert.deepEqual(f.commands,[['seek',8],['volume',.4],['mute',true],['routing',{mode:'sequential',swapEars:false}],['routing',{mode:'ears',swapEars:true}],['repeat'],['toggle']]);
  f.controller.update({status:'playing',position:9,muted:true,routing:'sequential'});
  assert.equal(f.find('play').getAttribute('aria-label'),'Pozastavit');assert.equal(f.find('seek').value,'9');assert.equal(f.find('mute').getAttribute('aria-pressed'),'true');assert.equal(f.find('routing').textContent,'Po sobě · obě uši');assert.equal(f.find('swap-ears').getAttribute('aria-pressed'),'false');assert.equal(f.find('repeat').getAttribute('aria-pressed'),null);
  f.controller.update({status:'error'});assert.equal(f.find('seek').disabled,false);assert.equal(f.find('play').disabled,false);f.controller.update({status:'suspended'});assert.equal(f.find('play').disabled,false);assert.equal(f.find('seek').disabled,false);
 }finally{f.cleanup()}
});

test('hide moves focus to restore and restore returns focus without issuing transport commands',()=>{
 const f=fixture();try{
  const hide=f.find('hide');hide.focus();hide.click();const restore=f.find('restore');assert.equal(globalThis.document.activeElement,restore);assert.equal(restore.hidden,false);
  const shortcut=f.host.dispatch('keydown',{key:'h',target:restore});assert.equal(shortcut.defaultPrevented,true);assert.equal(restore.hidden,true);assert.equal(globalThis.document.activeElement,hide);
  hide.click();assert.equal(f.find('restore').hidden,false);f.find('restore').click();assert.equal(globalThis.document.activeElement,hide);assert.equal(f.commands.length,0);
 }finally{f.cleanup()}
});

test('help is keyboard reachable, Escape closes owned help, and callbacks and cleanup stay local',()=>{
 const f=fixture();try{
  f.find('help').click();assert.ok(f.host.querySelector('[role="dialog"]'));
  const escape=f.key('Escape');assert.equal(escape.defaultPrevented,true);assert.equal(escape.propagationStopped,true);assert.equal(f.host.querySelector('[role="dialog"]').hidden,true);
  for(const action of ['fullscreen','focus','view','wipe'])f.find(action).click();assert.deepEqual(f.callbacks,{fullscreen:1,focus:1,view:1,wipe:1,escape:0});
  const handled=f.key('Escape');assert.equal(handled.defaultPrevented,true);assert.equal(handled.propagationStopped,true);assert.equal(f.callbacks.escape,1);
  const unhandled=f.key('Escape');assert.equal(unhandled.defaultPrevented,false);assert.equal(unhandled.propagationStopped,undefined);assert.equal(f.callbacks.escape,2);
  const before=f.commands.length;f.cleanup();assert.equal(f.host.listeners.get('keydown')?.size||0,0);assert.equal(f.commands.length,before);
 }finally{f.cleanup()}
});

test('disabled transport actions do not dispatch and mounted workspaces do not hear one another',()=>{
 const f=fixture();let secondCleanup;try{
  f.controller.update({excerptIndex:0});const before=f.commands.length;const first=f.key('[');assert.equal(first.defaultPrevented,true);assert.equal(f.commands.length,before);
  f.controller.update({excerptIndex:2});f.key(']');assert.equal(f.commands.length,before);
  f.controller.update({status:'preparing'});f.key(' ');assert.equal(f.commands.length,before);
  const secondHost=new Element('main');secondHost.ownerDocument=globalThis.document;secondHost.tabIndex=0;const secondCalls=[];
  secondCleanup=mountPlayerControls(secondHost,{command:(...args)=>secondCalls.push(args),snapshot:()=>({status:'paused',excerptIndex:0,excerptCount:1,phase:'original',position:0,duration:10,totalDuration:10,elapsed:0,sourceTime:0,volume:1,muted:false,routing:'ears',swapEars:false}),subscribe:()=>()=>{}},{tr:value=>value});
  assert.notEqual(f.host.querySelector('[role="dialog"]').getAttribute('aria-labelledby'),secondHost.querySelector('[role="dialog"]').getAttribute('aria-labelledby'));
  f.setActive(f.host);f.host.dispatch('keydown',{key:'m'});assert.deepEqual(secondCalls,[]);assert.deepEqual(f.commands.at(-1),['mute',true]);
  globalThis.document.activeElement=secondHost;secondHost.dispatch('keydown',{key:'m'});assert.deepEqual(secondCalls,[['mute',true]]);
  secondCleanup();assert.equal(secondHost.listeners.get('keydown')?.size||0,0);
 }finally{secondCleanup?.();f.cleanup()}
});
