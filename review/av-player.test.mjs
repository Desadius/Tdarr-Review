import test from 'node:test';
import assert from 'node:assert/strict';
import {mountAVComparison} from './public/av-player.js';

class Style {
 setProperty(name,value){this[name]=String(value)}
 getPropertyValue(name){return this[name]||''}
 removeProperty(name){delete this[name]}
}
class Element {
 constructor(tag){
  Object.assign(this,{tag,children:[],parentElement:null,listeners:new Map(),attributes:new Map(),dataset:{},style:new Style(),className:'',textContent:'',currentTime:0,duration:12,paused:true,value:'0',checked:false,hidden:false,seeking:false,readyState:4,videoWidth:1920,videoHeight:1080,playCalls:0,pauseCalls:0});
  this.rect={left:100,top:40,width:800,height:450};this.captured=new Set();this.released=[];
  this.classList={contains:name=>this.className.split(/\s+/).includes(name),add:(...names)=>{this.className=[...new Set([...this.className.split(/\s+/).filter(Boolean),...names])].join(' ')},remove:(...names)=>{this.className=this.className.split(/\s+/).filter(name=>!names.includes(name)).join(' ')},toggle:(name,force)=>{const active=force??!this.classList.contains(name);active?this.classList.add(name):this.classList.remove(name);return active}};
 }
 append(...nodes){for(const node of nodes){node.parentElement?.removeChild(node);node.parentElement=this;this.children.push(node)}}
 removeChild(node){this.children=this.children.filter(child=>child!==node);node.parentElement=null;return node}
 contains(node){return this===node||this.children.some(child=>child.contains(node))}
 replaceChildren(...nodes){for(const node of this.children)node.parentElement=null;this.children=[];this.append(...nodes)}
 setAttribute(name,value){this.attributes.set(name,String(value));this[name]=String(value)}
 getAttribute(name){return this.attributes.get(name)??null}
 removeAttribute(name){this.attributes.delete(name);delete this[name]}
 addEventListener(name,handler){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(handler)}
 removeEventListener(name,handler){this.listeners.get(name)?.delete(handler)}
 dispatch(name,properties={}){
  const event={type:name,target:this,currentTarget:this,defaultPrevented:false,preventDefault(){this.defaultPrevented=true},stopPropagation(){},...properties};
  const results=[...this.listeners.get(name)||[]].map(handler=>handler.call(this,event));
  if(typeof this['on'+name]==='function')results.push(this['on'+name](event));
  return Promise.all(results);
 }
 setPointerCapture(id){this.captured.add(id)}
 hasPointerCapture(id){return this.captured.has(id)}
 releasePointerCapture(id){this.captured.delete(id);this.released.push(id)}
 focus(){globalThis.document.activeElement=this}
 pause(){this.paused=true;this.pauseCalls++}
 play(){this.paused=false;this.playCalls++;return this.playResult||Promise.resolve()}
 load(){this.loaded=true}
 getContext(){return {fillRect(){},fillText(){},beginPath(){},moveTo(){},lineTo(){},stroke(){}}}
 getBoundingClientRect(){return this.rect}
}

const data={original:'AAAA',review:'AAAA',seconds:300,duration:12,originalWave:[.2,.4],reviewWave:[.2,.4],frameRates:[24,24],alignment:{reliable:true,offsetMs:0}};
async function withPlayer(run,overrides={}){
 const names=['document','requestAnimationFrame','cancelAnimationFrame','URL','performance'],saved=Object.fromEntries(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 const nodes=[],created=[],revoked=[],frames=new Map(),canceled=[];let now=0,nextFrame=0,closed=false;
 const globals={document:{createElement:tag=>{const node=new Element(tag);nodes.push(node);return node}},requestAnimationFrame:callback=>{const id=++nextFrame;frames.set(id,callback);return id},cancelAnimationFrame:id=>{canceled.push(id);frames.delete(id)},URL:{createObjectURL:()=>{const url='blob:fixture-'+(created.length+1);created.push(url);return url},revokeObjectURL:url=>revoked.push(url)},performance:{now:()=>now}};
 for(const name of names)Object.defineProperty(globalThis,name,{configurable:true,writable:true,value:globals[name]});
 const host=new Element('div');let destroy;
 try{
  destroy=mountAVComparison(host,{...data,...overrides});
  const fixture={host,nodes,created,revoked,frames,canceled,videos:nodes.filter(node=>node.tag==='video'),find:predicate=>{const node=nodes.find(predicate);assert.ok(node,'Expected player control was not mounted');return node},close:()=>{closed=true;destroy()},advance:(milliseconds,mediaTime)=>{now+=milliseconds;if(mediaTime!==undefined)for(const video of nodes.filter(node=>node.tag==='video'))video.currentTime=mediaTime;const pending=[...frames.values()];frames.clear();for(const callback of pending)callback(now)},listenerCount:()=>nodes.reduce((sum,node)=>sum+[...node.listeners.values()].reduce((total,listeners)=>total+listeners.size,0),0)};
  await run(fixture);
 }finally{
  if(destroy&&!closed)destroy();
  for(const name of names){if(saved[name])Object.defineProperty(globalThis,name,saved[name]);else delete globalThis[name]}
 }
}
const button=(fixture,text)=>fixture.find(node=>node.tag==='button'&&node.textContent===text);
const aria=(fixture,label)=>fixture.find(node=>node.getAttribute('aria-label')===label);
const wipeControls=fixture=>({stage:fixture.find(node=>node.classList.contains('av-pair')),divider:aria(fixture,'Dělicí čára obrazu'),position:aria(fixture,'Pozice dělicí čáry'),auto:aria(fixture,'Automatický pohyb dělicí čáry'),layout:aria(fixture,'Zobrazení porovnání')});
const wipePercent=stage=>parseFloat(stage.style.getPropertyValue('--av-wipe'));
const near=(actual,expected)=>assert(Math.abs(actual-expected)<.001,`Expected ${expected}, received ${actual}`);

test('AV playback shares seek and pause, emits sound from only one copy and releases blobs on close',()=>withPlayer(async fixture=>{
 const {videos}=fixture,audio=aria(fixture,'Přehrávaný zvuk'),seek=aria(fixture,'Společná časová osa'),play=button(fixture,'Přehrát / pozastavit');
 assert.deepEqual(videos.map(video=>video.muted),[false,true]);audio.value='1';await audio.dispatch('change');assert.deepEqual(videos.map(video=>video.muted),[true,false]);
 seek.value='5';await seek.dispatch('input');assert.deepEqual(videos.map(video=>video.currentTime),[5,5]);await play.dispatch('click');assert(videos.every(video=>!video.paused));await play.dispatch('click');assert(videos.every(video=>video.paused));
 await button(fixture,'Další snímek').dispatch('click');assert(videos.every(video=>Math.abs(video.currentTime-5-1/24)<.001));
 audio.value='2';await audio.dispatch('change');assert(videos.every(video=>video.muted));fixture.close();assert.deepEqual(fixture.revoked,fixture.created);assert(videos.every(video=>video.paused&&!video.src&&video.loaded));assert.equal(fixture.host.children.length,0);assert.equal(fixture.frames.size,0);
}));

test('closing during a pending play cannot restart media or an animation loop',()=>withPlayer(async fixture=>{
 let release;const pending=new Promise(resolve=>{release=resolve});for(const video of fixture.videos)video.playResult=pending;
 const play=button(fixture,'Přehrát / pozastavit'),completion=play.dispatch('click');fixture.close();release();await completion;
 assert(fixture.videos.every(video=>video.paused&&!video.src));assert.equal(fixture.frames.size,0);assert.deepEqual(fixture.revoked,fixture.created);assert.equal(fixture.host.children.length,0);
}));

test('a canceled play promise cannot pause a newer pending or running playback request',async()=>{
 for(const resolveNewFirst of [false,true])await withPlayer(async fixture=>{
  let resolveOld,resolveNew;const oldGate=new Promise(resolve=>{resolveOld=resolve}),newGate=new Promise(resolve=>{resolveNew=resolve});
  const play=button(fixture,'Přehrát / pozastavit');for(const video of fixture.videos)video.playResult=oldGate;
  const oldRequest=play.dispatch('click');await play.dispatch('click');assert(fixture.videos.every(video=>video.paused));
  for(const video of fixture.videos)video.playResult=newGate;const newRequest=play.dispatch('click'),pauseCounts=fixture.videos.map(video=>video.pauseCalls);
  if(resolveNewFirst){resolveNew();await newRequest;assert.equal(fixture.frames.size,1)}
  resolveOld();await oldRequest;assert.deepEqual(fixture.videos.map(video=>video.pauseCalls),pauseCounts);assert(fixture.videos.every(video=>!video.paused));
  if(!resolveNewFirst){assert.equal(fixture.frames.size,0);resolveNew();await newRequest}
  assert.equal(fixture.frames.size,1);assert(fixture.videos.every(video=>!video.paused));
 });
});

test('close removes listeners, cancels RAF and releases each blob exactly once',()=>withPlayer(async fixture=>{
 await button(fixture,'Přehrát / pozastavit').dispatch('click');assert.equal(fixture.frames.size,1);assert(fixture.listenerCount()>0);
 const lateFrame=[...fixture.frames.values()][0];fixture.close();assert.equal(fixture.frames.size,0);assert.equal(fixture.listenerCount(),0);assert.deepEqual(fixture.revoked,fixture.created);
 lateFrame(10000);await fixture.videos[0].dispatch('waiting');fixture.close();
 assert.equal(fixture.frames.size,0);assert.deepEqual(fixture.revoked,fixture.created);assert(fixture.videos.every(video=>video.paused&&!video.src));assert.equal(fixture.host.children.length,0);
}));

test('manual range and divider keyboard adjustment preserve the common video stage and media state',()=>withPlayer(async fixture=>{
 const {stage,position,divider,auto,layout}=wipeControls(fixture),{videos}=fixture;
 assert(stage.classList.contains('av-wipe'));assert.equal(wipePercent(stage),50);assert.equal(position.type,'range');assert.equal(position.min,'0');assert.equal(position.max,'100');assert.equal(position.step,'1');assert.equal(position.value,'50');assert.equal(auto.checked,false);
 assert.equal(divider.getAttribute('role'),'slider');assert.equal(divider.tabIndex,0);assert(videos.every(video=>video.parentElement.parentElement===stage));
 const seek=aria(fixture,'Společná časová osa'),audio=aria(fixture,'Přehrávaný zvuk'),volume=aria(fixture,'Společná hlasitost');seek.value='5';await seek.dispatch('input');audio.value='1';await audio.dispatch('change');volume.value='.3';await volume.dispatch('input');await button(fixture,'Přehrát / pozastavit').dispatch('click');
 const snapshot=videos.map(video=>({src:video.src,time:video.currentTime,muted:video.muted,volume:video.volume,paused:video.paused,playCalls:video.playCalls,width:video.style.width,height:video.style.height}));
 auto.checked=true;await auto.dispatch('change');position.value='25';await position.dispatch('input');assert.equal(auto.checked,false);assert.equal(wipePercent(stage),25);
 await divider.dispatch('keydown',{key:'ArrowRight'});assert.equal(position.value,'26');await divider.dispatch('keydown',{key:'PageUp'});assert.equal(position.value,'36');
 await divider.dispatch('keydown',{key:'Home'});assert.equal(wipePercent(stage),0);await divider.dispatch('keydown',{key:'End'});assert.equal(wipePercent(stage),100);await divider.dispatch('keydown',{key:'ArrowRight'});assert.equal(wipePercent(stage),100);assert.equal(divider.getAttribute('aria-valuenow'),'100');
 layout.value='side';await layout.dispatch('change');assert(stage.classList.contains('av-side'));assert(!stage.classList.contains('av-wipe'));assert.equal(divider.hidden,true);layout.value='wipe';await layout.dispatch('change');assert(stage.classList.contains('av-wipe'));assert.equal(divider.hidden,false);
 assert.deepEqual(videos.map(video=>({src:video.src,time:video.currentTime,muted:video.muted,volume:video.volume,paused:video.paused,playCalls:video.playCalls,width:video.style.width,height:video.style.height})),snapshot);assert.equal(fixture.created.length,2);assert(videos.every(video=>video.parentElement.parentElement===stage));
 // This mock checks stable mounting/state. Actual CSS sizing and pixel alignment are checked in the browser.
}));

test('pointer drag tracks only the captured pointer, clamps bounds and ends on cancellation or view change',()=>withPlayer(async fixture=>{
 const {stage,divider,auto,layout}=wipeControls(fixture);stage.rect={left:100,top:40,width:800,height:450};
 auto.checked=true;await auto.dispatch('change');await divider.dispatch('pointerdown',{button:1,pointerId:7,clientX:300});assert.equal(wipePercent(stage),50);assert.equal(auto.checked,true);assert.equal(divider.captured.size,0);
 await divider.dispatch('pointerdown',{button:0,pointerId:7,clientX:300});assert.equal(wipePercent(stage),25);assert.equal(auto.checked,false);assert.equal(divider.hasPointerCapture(7),true);assert.equal(globalThis.document.activeElement,divider);
 await divider.dispatch('pointermove',{pointerId:9,clientX:700});assert.equal(wipePercent(stage),25);await divider.dispatch('pointermove',{pointerId:7,clientX:700});assert.equal(wipePercent(stage),75);
 await divider.dispatch('pointermove',{pointerId:7,clientX:-300});assert.equal(wipePercent(stage),0);await divider.dispatch('pointermove',{pointerId:7,clientX:1300});assert.equal(wipePercent(stage),100);
 await divider.dispatch('pointerup',{pointerId:9});assert.equal(divider.hasPointerCapture(7),true);await divider.dispatch('pointerup',{pointerId:7});assert.equal(divider.hasPointerCapture(7),false);await divider.dispatch('pointermove',{pointerId:7,clientX:500});assert.equal(wipePercent(stage),100);
 await divider.dispatch('pointerdown',{button:0,pointerId:8,clientX:500});await divider.dispatch('pointercancel',{pointerId:8});assert.equal(divider.hasPointerCapture(8),false);
 await divider.dispatch('pointerdown',{button:0,pointerId:10,clientX:500});layout.value='side';await layout.dispatch('change');assert.equal(divider.hasPointerCapture(10),false);await divider.dispatch('pointerdown',{button:0,pointerId:11,clientX:700});assert.equal(divider.captured.size,0);
 layout.value='wipe';await layout.dispatch('change');await divider.dispatch('pointerdown',{button:0,pointerId:12,clientX:500});fixture.close();assert.equal(divider.captured.size,0);assert(divider.released.includes(12));
}));

test('taking over the native range disables auto even when a boundary key does not change its value',()=>withPlayer(async fixture=>{
 const {stage,position,auto}=wipeControls(fixture);position.value='100';await position.dispatch('input');
 auto.checked=true;await auto.dispatch('change');await position.dispatch('keydown',{key:'End'});assert.equal(auto.checked,false);assert.equal(wipePercent(stage),100);
 auto.checked=true;await auto.dispatch('change');await position.dispatch('pointerdown',{button:0,pointerId:1});assert.equal(auto.checked,false);assert.equal(wipePercent(stage),100);
 auto.checked=true;await auto.dispatch('change');await position.dispatch('keydown',{key:'Tab'});assert.equal(auto.checked,true);assert.equal(wipePercent(stage),100);
}));

test('auto sweep follows 25 to 75 to 25 only during playback and retains phase through pause and buffering',()=>withPlayer(async fixture=>{
 const {stage,auto}=wipeControls(fixture),play=button(fixture,'Přehrát / pozastavit');auto.checked=true;await auto.dispatch('change');fixture.advance(3000);assert.equal(wipePercent(stage),50);assert.equal(fixture.frames.size,0);
 await play.dispatch('click');assert.equal(wipePercent(stage),25);for(const [time,expected]of [[2,50],[4,75],[6,50],[8,25]]){fixture.advance(2000,time);near(wipePercent(stage),expected);assert.equal(fixture.frames.size,1)}
 await play.dispatch('click');fixture.advance(15000);assert.equal(wipePercent(stage),25);assert.equal(fixture.frames.size,0);await play.dispatch('click');assert.equal(wipePercent(stage),25);fixture.advance(1000,9);near(wipePercent(stage),37.5);
 await fixture.videos[1].dispatch('waiting');const frozen=wipePercent(stage);assert(fixture.videos.every(video=>video.paused));fixture.advance(12000);near(wipePercent(stage),frozen);assert.equal(fixture.frames.size,0);await play.dispatch('click');near(wipePercent(stage),frozen);fixture.advance(1000,10);near(wipePercent(stage),50);
},{duration:60}));

test('auto sweep freezes when either stream is unready or side view is selected, then manual input disables it',()=>withPlayer(async fixture=>{
 const {stage,auto,layout,position,divider}=wipeControls(fixture),play=button(fixture,'Přehrát / pozastavit');auto.checked=true;await auto.dispatch('change');await play.dispatch('click');fixture.advance(2000,2);near(wipePercent(stage),50);
 fixture.videos[1].readyState=2;fixture.advance(9000,3);near(wipePercent(stage),50);fixture.videos[1].readyState=4;fixture.advance(1000,4);near(wipePercent(stage),50);fixture.advance(1000,5);near(wipePercent(stage),62.5);
 layout.value='side';await layout.dispatch('change');fixture.advance(9000,6);near(wipePercent(stage),62.5);assert(fixture.videos.every(video=>!video.paused));layout.value='wipe';await layout.dispatch('change');fixture.advance(1000,7);near(wipePercent(stage),62.5);fixture.advance(1000,8);near(wipePercent(stage),75);
 position.value='70';await position.dispatch('input');assert.equal(auto.checked,false);fixture.advance(5000,9);near(wipePercent(stage),70);
 auto.checked=true;await auto.dispatch('change');await divider.dispatch('keydown',{key:'ArrowLeft'});assert.equal(auto.checked,false);fixture.advance(1000,10);near(wipePercent(stage),69);
},{duration:60}));

test('a native pause or ended stream freezes the sweep and stops the shared RAF loop',()=>withPlayer(async fixture=>{
 const {stage,auto}=wipeControls(fixture),play=button(fixture,'Přehrát / pozastavit');auto.checked=true;await auto.dispatch('change');await play.dispatch('click');fixture.advance(1000,1);const frozen=wipePercent(stage);
 await fixture.videos[0].dispatch('pause');assert(fixture.videos.every(video=>video.paused));assert.equal(fixture.frames.size,0);fixture.advance(5000);near(wipePercent(stage),frozen);
 await play.dispatch('click');fixture.videos[1].ended=true;fixture.advance(1000,2);assert(fixture.videos.every(video=>video.paused));assert.equal(fixture.frames.size,0);near(wipePercent(stage),frozen);
},{duration:60}));

test('metadata uses native aspect ratio and warns only for materially different video shapes',()=>withPlayer(async fixture=>{
 const {stage}=wipeControls(fixture),warning=fixture.find(node=>node.classList.contains('av-aspect-warning'));
 Object.assign(fixture.videos[0],{videoWidth:3840,videoHeight:2160});Object.assign(fixture.videos[1],{videoWidth:1920,videoHeight:1080});await fixture.videos[0].dispatch('loadedmetadata');await fixture.videos[1].dispatch('loadedmetadata');near(parseFloat(stage.style.getPropertyValue('--av-aspect')),16/9);assert.equal(warning.hidden,true);
 fixture.videos[1].videoWidth=1440;await fixture.videos[1].dispatch('resize');assert.equal(warning.hidden,false);assert(warning.textContent.includes('Poměr stran'));fixture.videos[1].videoWidth=1920;await fixture.videos[1].dispatch('resize');assert.equal(warning.hidden,true);
}));
