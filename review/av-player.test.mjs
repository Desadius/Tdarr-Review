import test from 'node:test';import assert from 'node:assert/strict';import {mountAVComparison} from './public/av-player.js';
class Element{
 constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.currentTime=0;this.duration=12;this.paused=true;this.value='0';this.style={};}
 append(...nodes){this.children.push(...nodes)}setAttribute(k,v){this[k]=v}removeAttribute(k){delete this[k]}addEventListener(k,cb){this.listeners[k]=cb}replaceChildren(...nodes){this.children=nodes}pause(){this.paused=true}load(){this.loaded=true}play(){this.paused=false;return Promise.resolve()}
 getContext(){return {fillRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}}}getBoundingClientRect(){return {left:0,width:1100}}
}
test('AV playback shares seek and pause, emits sound from only one copy and releases blobs on close',async()=>{
 const old={document:globalThis.document,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame,URL:globalThis.URL};const nodes=[],revoked=[];
 globalThis.document={createElement:tag=>{const n=new Element(tag);nodes.push(n);return n}};globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};globalThis.URL={createObjectURL:()=>`blob:${nodes.length}`,revokeObjectURL:url=>revoked.push(url)};
 try{
  const host=new Element('div'),close=mountAVComparison(host,{original:'AAAA',review:'AAAA',seconds:300,duration:12,originalWave:[.2],reviewWave:[.2],frameRates:[24,24],alignment:{reliable:true,offsetMs:0}});
  const videos=nodes.filter(n=>n.tag==='video'),buttons=nodes.filter(n=>n.tag==='button'),select=nodes.find(n=>n.tag==='select'),seek=nodes.find(n=>n.className==='av-seek');
  assert.equal(videos[0].muted,false);assert.equal(videos[1].muted,true);select.value='1';select.onchange();assert.equal(videos[0].muted,true);assert.equal(videos[1].muted,false);
  seek.value='5';seek.oninput();assert.deepEqual(videos.map(v=>v.currentTime),[5,5]);await buttons[0].onclick();assert(videos.every(v=>!v.paused));buttons[0].onclick();assert(videos.every(v=>v.paused));buttons[2].onclick();assert(videos.every(v=>Math.abs(v.currentTime-5-1/24)<.001));
  select.value='2';select.onchange();assert(videos.every(v=>v.muted));close();assert.equal(revoked.length,2);assert(videos.every(v=>v.paused&&!v.src));assert.equal(host.children.length,0);
 }finally{Object.assign(globalThis,old)}
});
