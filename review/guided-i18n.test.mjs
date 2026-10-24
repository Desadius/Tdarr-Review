import test from 'node:test';
import assert from 'node:assert/strict';
import guidedMessages from './public/guided-messages.js';
import {createTranslator} from './public/i18n.js';
import {mountPlayerControls} from './public/player-controls.js';

class Element{
 constructor(tag,doc){Object.assign(this,{tagName:tag.toUpperCase(),ownerDocument:doc,children:[],parentElement:null,attributes:new Map(),dataset:{},listeners:new Map(),textContent:'',value:'',disabled:false,hidden:false,type:''})}
 append(...nodes){for(const node of nodes){node.parentElement?.removeChild(node);node.parentElement=this;this.children.push(node)}}
 prepend(...nodes){for(const node of nodes){node.parentElement?.removeChild(node);node.parentElement=this}this.children.unshift(...nodes)}
 removeChild(node){this.children=this.children.filter(child=>child!==node);node.parentElement=null;return node}
 setAttribute(key,value){this.attributes.set(key,String(value));if(key==='type')this.type=String(value)}
 getAttribute(key){return this.attributes.get(key)??null}
 hasAttribute(key){return this.attributes.has(key)}
 addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn)}
 removeEventListener(type,fn){this.listeners.get(type)?.delete(fn)}
 contains(node){return this===node||this.children.some(child=>child.contains(node))}
 focus(){this.ownerDocument.activeElement=this}
 querySelectorAll(selector){const result=[];const visit=node=>{for(const child of node.children){if(selector.startsWith('[data-action="')){if(child.dataset.action===selector.slice(14,-2))result.push(child)}else if(selector.startsWith('[role="')){if(child.getAttribute('role')===selector.slice(7,-2))result.push(child)}else if(selector.startsWith('.')){if(child.className?.split(/\s+/).includes(selector.slice(1)))result.push(child)}else if(child.tagName===selector.toUpperCase())result.push(child);visit(child)}};visit(this);return result}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null}
 click(){if(this.disabled)return;for(const fn of this.listeners.get('click')||[])fn({target:this,preventDefault(){},stopPropagation(){}})}
}

test('every guided authored string has an English translation',()=>{
 const tr=createTranslator('en',{exact:guidedMessages});
 assert.ok(Object.keys(guidedMessages).length>=140);
 for(const [source,translated]of Object.entries(guidedMessages)){
  assert.ok(source.length>0&&translated.length>0,`empty translation for ${source}`);
  assert.notEqual(tr(source),source,`untranslated guided text: ${source}`);
  assert.equal(tr(source),translated);
 }
});

test('the mounted playback toolbar and keyboard help use the guided English catalog',()=>{
 const doc={activeElement:null,createElement:tag=>new Element(tag,doc)};const host=doc.createElement('main');host.tabIndex=0;
 const controller={snapshot:()=>({status:'paused',excerptIndex:1,excerptCount:3,phase:'together',position:4,duration:12,totalDuration:36,elapsed:16,sourceTime:104,volume:.5,muted:false,routing:'ears',swapEars:false}),subscribe:()=>()=>{},command(){}};
 const tr=createTranslator('en',{exact:guidedMessages}),cleanup=mountPlayerControls(host,controller,{tr});
 try{
  assert.equal(host.querySelector('[data-action="play"]').getAttribute('aria-label'),'Play');
  assert.match(host.querySelector('.player-controls-status').textContent,/Excerpt 2 of 3 · Together/);
  host.querySelector('[data-action="help"]').click();
  const help=host.querySelector('[role="dialog"]');assert.equal(help.getAttribute('aria-label'),'Player keyboard shortcuts');
  const helpText=help.querySelectorAll('span').map(node=>node.textContent).join(' ');
  assert.ok(helpText.includes('Play or pause'));
  assert.ok(helpText.includes('Close help; then exit fullscreen or focus mode'));
 }finally{cleanup()}
});

test('mapped controller errors translate without changing technical values in unknown text',()=>{
 const tr=createTranslator('en',{exact:guidedMessages});
 assert.equal(tr('Neplatný poslechový úsek.'),'Invalid audio excerpt.');
 assert.equal(tr('Neplatné nastavení porovnání úseků.'),'Invalid excerpt comparison settings.');
 assert.equal(tr('Přehrávání selhalo u track-17 / 48000 Hz.'),'Přehrávání selhalo u track-17 / 48000 Hz.');
});
