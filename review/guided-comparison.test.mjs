import test from 'node:test';
import assert from 'node:assert/strict';
import {mountGuidedComparison} from './public/guided-comparison.js';

class Style{
 setProperty(name,value){this[name]=String(value)}
 getPropertyValue(name){return this[name]||''}
}
class Element{
 constructor(tag,ownerDocument){
  Object.assign(this,{tagName:tag.toUpperCase(),ownerDocument,children:[],parentElement:null,attributes:new Map(),dataset:{},style:new Style(),className:'',value:'',type:'',disabled:false,hidden:false,checked:false,validity:{valid:true},listeners:new Map(),currentTime:0,duration:1,paused:true,readyState:4,playCalls:0,pauseCalls:0,loadCalls:0,src:'',muted:false,volume:1});
  this.classList={contains:name=>this.className.split(/\s+/).includes(name),add:(...names)=>{this.className=[...new Set([...this.className.split(/\s+/).filter(Boolean),...names])].join(' ')},remove:(...names)=>{this.className=this.className.split(/\s+/).filter(name=>!names.includes(name)).join(' ')},toggle:(name,force)=>{const active=force??!this.classList.contains(name);active?this.classList.add(name):this.classList.remove(name);return active}};
 }
 get isConnected(){return this.ownerDocument?.body===this||!!this.parentElement?.isConnected}
 get textContent(){return (this.ownText||'')+this.children.map(child=>child.textContent).join('')}
 set textContent(value){for(const child of this.children)child.parentElement=null;this.children=[];this.ownText=String(value)}
 append(...nodes){for(const node of nodes){node.parentElement?.removeChild(node);node.parentElement=this;this.children.push(node)}}
 prepend(...nodes){for(const node of nodes){node.parentElement?.removeChild(node);node.parentElement=this}this.children.unshift(...nodes)}
 removeChild(node){this.children=this.children.filter(child=>child!==node);node.parentElement=null;return node}
 replaceChildren(...nodes){for(const child of this.children)child.parentElement=null;this.children=[];this.ownText='';this.append(...nodes)}
 setAttribute(name,value){this.attributes.set(name,String(value));if(name==='class')this.className=String(value);if(name==='type')this.type=String(value);if(name==='id')this.id=String(value)}
 getAttribute(name){return this.attributes.get(name)??null}
 hasAttribute(name){return this.attributes.has(name)}
 removeAttribute(name){this.attributes.delete(name);if(name==='src')this.src=''}
 addEventListener(type,listener){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(listener)}
 removeEventListener(type,listener){this.listeners.get(type)?.delete(listener)}
 async dispatch(type,properties={}){const event={type,target:this,currentTarget:this,defaultPrevented:false,preventDefault(){this.defaultPrevented=true},stopPropagation(){this.propagationStopped=true},...properties};const results=[...this.listeners.get(type)||[]].map(listener=>listener.call(this,event));if(typeof this['on'+type]==='function')results.push(this['on'+type](event));await Promise.all(results);return event}
 async click(){if(this.disabled)return null;this.focus();return this.dispatch('click')}
 focus(){this.ownerDocument.activeElement=this}
 closest(selector){for(let node=this;node;node=node.parentElement){if(selector.split(',').some(part=>{const token=part.trim();if(token.startsWith('.'))return node.className.split(/\s+/).includes(token.slice(1));if(token.startsWith('[')){const attribute=token.slice(1,-1).split('=')[0];return node.hasAttribute(attribute)}return node.tagName===token.toUpperCase()}))return node}return null}
 contains(node){return this===node||this.children.some(child=>child.contains(node))}
 querySelectorAll(selector){
  const result=[];const selectors=selector.split(',').map(value=>value.trim());
  const matches=(node,token)=>{
   if(token.includes(' ')){const parts=token.split(/\s+/);let cursor=node;if(!matches(cursor,parts.pop()))return false;while(parts.length){const part=parts.pop();cursor=cursor.parentElement;while(cursor&&!matches(cursor,part))cursor=cursor.parentElement;if(!cursor)return false}return true}
   if(token.startsWith('.'))return node.className.split(/\s+/).includes(token.slice(1));
   if(token.startsWith('[data-action="'))return node.dataset.action===token.slice(14,-2);
   if(token.startsWith('[role="'))return node.getAttribute('role')===token.slice(7,-2);
   if(token.startsWith('input['))return node.tagName==='INPUT'&&token.includes(node.type);
   if(token==='[hidden]')return node.hidden;
   return node.tagName===token.toUpperCase();
  };
  const visit=node=>{for(const child of node.children){if(selectors.some(token=>matches(child,token)))result.push(child);visit(child)}};visit(this);return result;
 }
 querySelector(selector){return this.querySelectorAll(selector)[0]||null}
 pause(){this.paused=true;this.pauseCalls++}
 async play(){this.playCalls++;this.paused=false;return this.playGate||Promise.resolve()}
 load(){this.loadCalls++;this.readyState=0}
 getBoundingClientRect(){return {left:0,top:0,width:800,height:450}}
}

function audioContextClass(instances){
 return class RecordingAudioContext{
  constructor(){Object.assign(this,{currentTime:0,state:'suspended',destination:{},sources:[],gains:[],mergers:[],listeners:new Set(),resumeCalls:0,closeCalls:0});instances.push(this)}
  createGain(){const gain={value:1,setValueAtTime(value){this.value=value},linearRampToValueAtTime(value){this.value=value},cancelScheduledValues(){},cancelAndHoldAtTime(){}};const node={gain,links:[],connect(target,...args){this.links.push({target,args});return target},disconnect(){this.disconnected=true}};this.gains.push(node);return node}
  createChannelMerger(channels){const node={channels,links:[],connect(target,...args){this.links.push({target,args});return target},disconnect(){this.disconnected=true}};this.mergers.push(node);return node}
  createBuffer(channels,frames,sampleRate){const data=Array.from({length:channels},()=>new Float32Array(frames));return {duration:frames/sampleRate,getChannelData:channel=>data[channel]}}
  createBufferSource(){const node={links:[],buffer:null,onended:null,connect(target,...args){this.links.push({target,args});return target},disconnect(){this.disconnected=true},start(when,offset,duration){this.started={when,offset,duration}},stop(){this.stopped=true}};this.sources.push(node);return node}
  addEventListener(type,listener){if(type==='statechange')this.listeners.add(listener)}
  removeEventListener(type,listener){if(type==='statechange')this.listeners.delete(listener)}
  async resume(){this.resumeCalls++;this.state='running';for(const listener of this.listeners)listener()}
  async close(){this.closeCalls++;this.state='closed';for(const listener of this.listeners)listener()}
  finishPhase(){const source=this.sources.find(node=>node.started&&!node.stopped&&node.onended);assert.ok(source,'Expected an active audio phase');this.currentTime=source.started.when+source.started.duration;source.onended()}
 }
}

const flush=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve))};
const packet=()=>{const frames=24000,bytes=Buffer.alloc(frames*4);for(let i=0;i<frames;i++)bytes.writeFloatLE(.125,i*4);return {pcm:bytes.toString('base64'),sampleRate:48000,frames}};
const item={id:'0123456789abcdef01234567',snapshot:'snapshot-a',durationA:300,durationB:280};

async function withComparison(run,{apiOverride,scope={originalIndex:2,reviewIndex:7},excerptTimes=[12,80,200],beforePreview,onScopeChange=()=>{},onTimesChange=()=>{},onPreparation=()=>{},onPlaybackState=()=>{},onExitPlayer=()=>{}}={}){
 const names=['document','AudioContext','webkitAudioContext','URL','requestAnimationFrame','cancelAnimationFrame','localStorage','atob'];
 const saved=Object.fromEntries(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 const contexts=[],requests=[],createdUrls=[],revokedUrls=[],frames=new Map(),canceledFrames=[],storage=new Map();let frameId=0,activeRequests=0,maxActiveRequests=0,cleaned=false;
 const document={activeElement:null,fullscreenElement:null,createElement(tag){return new Element(tag,this)},exitFullscreen:async()=>{this.fullscreenElement=null}};document.body=new Element('body',document);
 const host=document.createElement('main');document.body.append(host);
 const URLMock={createObjectURL(blob){const url=`blob:guided-${createdUrls.length+1}`;createdUrls.push({url,blob});return url},revokeObjectURL(url){revokedUrls.push(url)}};
 Object.assign(globalThis,{document,AudioContext:audioContextClass(contexts),webkitAudioContext:undefined,URL:URLMock,requestAnimationFrame(callback){const id=++frameId;frames.set(id,callback);return id},cancelAnimationFrame(id){canceledFrames.push(id);frames.delete(id)},localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},atob:value=>Buffer.from(value,'base64').toString('binary')});
 const api=async(route,body)=>{
  const request={route,body:structuredClone(body)};requests.push(request);
  const isPreview=body?.mode==='listen'||body?.mode==='av';if(isPreview){activeRequests++;maxActiveRequests=Math.max(maxActiveRequests,activeRequests)}
  try{
   if(apiOverride)return await apiOverride(request,{requests,contexts});
   if(body?.mode==='tracks')return {original:[{index:2,label:'Original English'}],review:[{index:7,label:'Transcode English'}]};
   await Promise.resolve();if(body?.mode==='listen')return {original:packet(),review:packet()};if(body?.mode==='av')return {original:'AAAA',review:'BBBB'};
   throw Error(`Unexpected API call: ${route} ${body?.mode}`);
  }finally{if(isPreview)activeRequests--}
 };
 let destroy;const playbackStates=[];
 try{
  destroy=mountGuidedComparison(host,item,{api,scope,excerptTimes,beforePreview,onScopeChange,onTimesChange,onPreparation,onPlaybackState:state=>{playbackStates.push(state);onPlaybackState(state)},onExitPlayer,tr:value=>value});
  await flush();
  const root=host.querySelector('.guided-comparison');
  const fixture={host,root,requests,contexts,createdUrls,revokedUrls,frames,canceledFrames,storage,playbackStates,apiStats:()=>({activeRequests,maxActiveRequests}),onPreparation,onPlaybackState,
   controls:()=>root.querySelector('.player-controls'),button:action=>root.querySelector(`[data-action="${action}"]`),
   selectors:()=>root.querySelectorAll('.comparison-controls select').filter(node=>node.tagName==='SELECT'),
   times:()=>root.querySelectorAll('input').filter(node=>node.type==='number'),
   videos:()=>root.querySelectorAll('video'),
   sources:()=>contexts.flatMap(context=>context.sources),
 tickFrame(){const [id,callback]=frames.entries().next().value||[];if(callback){frames.delete(id);callback(0)}return id},
   async start(){const button=this.button('play');assert.ok(button,'Expected the shared play control');assert.equal(button.disabled,false,'play must remain natively activatable from idle');await button.click();await flush()},
   async finishPhase(){const context=contexts[0];context.finishPhase();await flush()},
   cleanup(){if(cleaned)return;cleaned=true;destroy?.();destroy=null;}
  };
  await run(fixture);
 }finally{
  if(!cleaned)destroy?.();
  for(const name of names){if(saved[name])Object.defineProperty(globalThis,name,saved[name]);else delete globalThis[name]}
 }
}

test('page load fetches only track labels and never creates or starts an audio context',()=>withComparison(async f=>{
 assert.deepEqual(f.requests.map(({body})=>body.mode),['tracks']);assert.equal(f.contexts.length,0);assert.equal(f.videos().length,0);assert.equal(f.sources().length,0);
 assert.deepEqual(f.selectors().slice(0,2).map(select=>select.value),['2','7']);assert.deepEqual(f.times().map(input=>Number(input.value)),[12,80,200]);
 assert.equal(f.button('play').disabled,false);f.button('play').disabled=true;await f.button('play').click();assert.equal(f.contexts.length,0,'native button activation must respect disabled');
}));

test('routing descriptions and current transport labels follow sequential and swapped ears without autoplay',()=>withComparison(async f=>{
 assert.ok(f.root.textContent.includes('originál vlevo, oba současně, převod vpravo'));
 await f.button('routing').click();assert.ok(f.root.textContent.includes('Obě uši: stejný úsek dvakrát'));assert.equal(f.button('routing').textContent,'Po sobě · obě uši');
 await f.button('routing').click();await f.button('swap-ears').click();assert.ok(f.root.textContent.includes('originál vpravo, oba současně, převod vlevo'));assert.equal(f.button('routing').textContent,'Prohozené uši');
 assert.equal(f.contexts.length,0);assert.equal(f.sources().length,0);
}));

test('one user start gesture makes exactly six ordered excerpt requests bound to the selected tracks and times',()=>withComparison(async f=>{
 await f.start();
 const previews=f.requests.filter(request=>['listen','av'].includes(request.body.mode));
 assert.equal(previews.length,6);assert.equal(f.apiStats().maxActiveRequests,1);assert.equal(f.contexts.length,1);assert.equal(f.contexts[0].resumeCalls,1);
 assert.deepEqual(previews.map(({body})=>[body.seconds,body.mode]),[[12,'listen'],[12,'av'],[80,'listen'],[80,'av'],[200,'listen'],[200,'av']]);
 assert.ok(previews.every(({route,body})=>route===`/api/items/${item.id}/audio-compare`&&body.originalIndex===2&&body.reviewIndex===7&&body.snapshot===item.snapshot));
 assert.ok(f.requests.every(({route})=>route===`/api/items/${item.id}/audio-compare`),'the player must never call a review write route');
 assert.equal(f.contexts[0].sources.filter(source=>source.started&&!source.stopped).length,1);assert.equal(f.videos().length,2);
}));

test('routing and ear-swap actions keep the visible listening instructions accurate',()=>withComparison(async f=>{
 const note=f.root.querySelector('.details');assert.match(note.textContent,/originál vlevo.*převod vpravo/);
 await f.button('swap-ears').click();assert.match(note.textContent,/originál vpravo.*převod vlevo/);
 await f.button('routing').click();assert.match(note.textContent,/dvakrát.*originál, potom převod.*72 sekund/);
 await f.button('routing').click();assert.match(note.textContent,/originál vpravo.*převod vlevo/);
}));

test('pending audio preparation stops at the first excerpt without skipping or creating media',()=>withComparison(async f=>{
 await f.start();assert.equal(f.requests.filter(({body})=>body.mode==='listen').length,1);assert.equal(f.requests.filter(({body})=>body.mode==='av').length,0);
 assert.equal(f.sources().length,0);assert.equal(f.videos().length,0);assert.equal(f.playbackStates.at(-1).status,'error');assert.ok(f.requests.every(({route})=>route===`/api/items/${item.id}/audio-compare`));
}, {apiOverride:async({body})=>body.mode==='tracks'?{original:[{index:2,label:'Original'}],review:[{index:7,label:'Review'}]}:body.mode==='listen'?{pending:true}:{original:'AAAA',review:'BBBB'}}));

test('a preview error pauses the guided session and does not request later excerpts',()=>withComparison(async f=>{
 await f.start();assert.equal(f.button('play').disabled,false);assert.equal(f.playbackStates.at(-1).status,'error');
 assert.equal(f.requests.filter(({body})=>body.mode==='listen').length,1);assert.equal(f.requests.filter(({body})=>body.mode==='av').length,0);assert.equal(f.sources().length,0);assert.equal(f.videos().length,0);
 assert.ok(f.requests.every(({route})=>route===`/api/items/${item.id}/audio-compare`));
}, {apiOverride:async({body})=>body.mode==='tracks'?{original:[{index:2,label:'Original'}],review:[{index:7,label:'Review'}]}:Promise.reject(Error('Synthetic preview failure'))}));

test('changing selected tracks or times while an excerpt request is pending discards the stale preparation',async()=>{
 for(const change of ['pair','time']){
  let release,firstPreview=true;const gate=new Promise(resolve=>{release=resolve});
  await withComparison(async f=>{
  const start=f.button('play').click();await flush();assert.equal(f.requests.filter(({body})=>body.mode==='listen').length,1);
  if(change==='pair'){f.selectors()[0].value='3';await f.selectors()[0].dispatch('change')}
  else{f.times()[1].value='81';await f.times()[1].dispatch('change')}
  release({original:packet(),review:packet()});await start;await flush();
  assert.equal(f.requests.filter(({body})=>body.mode==='av').length,0);assert.equal(f.requests.filter(({body})=>body.mode==='listen').length,1);assert.equal(f.sources().length,0);assert.equal(f.videos().length,0);
  if(change==='time')assert.equal(f.times()[1].value,'81');
  },{apiOverride:async({body})=>{if(body.mode==='tracks')return {original:[{index:2,label:'Original'},{index:3,label:'Other'}],review:[{index:7,label:'Review'}]};if(body.mode==='listen'&&firstPreview){firstPreview=false;return gate}if(body.mode==='listen')return {original:packet(),review:packet()};return {original:'AAAA',review:'BBBB'}}});
 }
});

test('video waiting pauses audio, and a phase change resets both videos to the audio offset while cancelling the old animation frame',()=>withComparison(async f=>{
 await f.start();const context=f.contexts[0],videos=f.videos();assert.deepEqual(videos.map(video=>video.currentTime),[0,0]);
 const firstSource=f.sources().find(source=>source.started&&!source.stopped);assert.equal(firstSource.started.offset,0);const oldFrame=f.frames.keys().next().value;assert.ok(oldFrame);
 const seek=f.button('seek');seek.value='0.4';await seek.dispatch('input');await flush();const sought=f.sources().find(source=>source.started&&!source.stopped);assert.equal(sought.started.offset,.4);assert.deepEqual(videos.map(video=>video.currentTime),[.4,.4]);
 const seekFrame=f.frames.keys().next().value;let releaseVideoPlay;const phasePlayGate=new Promise(resolve=>{releaseVideoPlay=resolve});for(const video of videos)video.playGate=phasePlayGate;
 context.finishPhase();await flush();assert.ok(f.canceledFrames.includes(seekFrame));assert.equal(f.tickFrame(),undefined,'the canceled prior-phase animation callback cannot interrupt a pending video play');
 releaseVideoPlay();await flush();const nextSource=f.sources().find(source=>source.started&&!source.stopped);assert.equal(nextSource.started.offset,0);assert.deepEqual(videos.map(video=>video.currentTime),[0,0]);assert.ok(videos.every(video=>!video.paused));
 const currentFrame=f.frames.keys().next().value;assert.ok(currentFrame&&currentFrame!==seekFrame);assert.ok(!f.canceledFrames.includes(currentFrame));
 context.state='suspended';for(const listener of context.listeners)listener();await flush();
 assert.ok(f.root.textContent.includes('Prohlížeč pozastavil zvuk. Pokračuj tlačítkem Přehrát.'));assert.ok(videos.every(video=>video.paused));
 await f.button('play').click();await flush();assert.ok(videos.every(video=>!video.paused));
 await videos[0].dispatch('waiting');await flush();assert.equal(f.button('play').getAttribute('aria-label'),'Přehrát');assert.ok(videos.every(video=>video.paused));assert.equal(f.frames.size,0);assert.equal(f.contexts[0].sources.filter(source=>source.started&&!source.stopped).length,0);
 await f.button('play').click();await flush();await videos[1].dispatch('error');await flush();assert.ok(videos.every(video=>video.paused));assert.equal(f.frames.size,0);assert.equal(f.contexts[0].sources.filter(source=>source.started&&!source.stopped).length,0);
},{}));

test('Escape exits focus or fullscreen when an excerpt field has focus and otherwise preserves native field Escape',()=>withComparison(async f=>{
 const field=f.selectors()[0],doc=f.root.ownerDocument;assert.ok(field);
 await f.button('focus').click();assert.equal(f.root.classList.contains('guided-focus'),true);field.focus();
 const focusEscape=await f.root.dispatch('keydown',{key:'Escape',target:field});assert.equal(focusEscape.defaultPrevented,true);assert.equal(focusEscape.propagationStopped,true);assert.equal(f.root.classList.contains('guided-focus'),false);
 doc.exitFullscreen=async()=>{doc.fullscreenElement=null};doc.fullscreenElement=f.root;field.focus();
 const fullEscape=await f.root.dispatch('keydown',{key:'Escape',target:field});assert.equal(fullEscape.defaultPrevented,true);assert.equal(doc.fullscreenElement,null);
 doc.fullscreenElement=null;
 field.focus();const editEscape=await f.root.dispatch('keydown',{key:'Escape',target:field});assert.equal(editEscape.defaultPrevented,false);assert.equal(editEscape.propagationStopped,undefined);
},{}));

test('disposing during playback stops audio and video, revokes every object URL and removes listeners and frames',()=>withComparison(async f=>{
 await f.start();const context=f.contexts[0],videos=f.videos(),sources=f.sources().filter(source=>source.started&&!source.stopped);assert.ok(sources.length>0);assert.equal(context.listeners.size,1);assert.ok(f.frames.size>0);
 const videoListeners=videos.reduce((total,video)=>total+[...video.listeners.values()].reduce((sum,listeners)=>sum+listeners.size,0),0);assert.ok(videoListeners>0);f.cleanup();await flush();
 assert.equal(context.closeCalls,1);assert.equal(context.listeners.size,0);assert.ok(sources.every(source=>source.stopped&&source.disconnected));assert.deepEqual(f.revokedUrls,f.createdUrls.map(record=>record.url));assert.ok(videos.every(video=>video.paused&&!video.src&&video.loadCalls>0));assert.equal(videos.reduce((total,video)=>total+[...video.listeners.values()].reduce((sum,listeners)=>sum+listeners.size,0),0),0);assert.equal(f.root.listeners.get('keydown')?.size||0,0);assert.equal(f.root.listeners.get('pointerdown')?.size||0,0);assert.equal(f.frames.size,0);assert.ok(f.canceledFrames.length>0);
}));
