import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createCachedPreviewLoader,previewJobMatches,mountReviewWorkflow,classifyPreparation} from './public/review-workflow.js';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
const item={id:'a'.repeat(24),snapshot:'b'.repeat(64),title:'Fixture',durationA:120,durationB:120,originalBytes:200,reviewBytes:100};
const scope={originalIndex:1,reviewIndex:2,seconds:10};
const jobs=modes=>modes.map(mode=>({...scope,mode,previewProfile:mode==='av'?'detail':null,status:'ready'}));

test('dashboard readiness requires a current complete picture/audio plan without failed jobs',()=>{
 const done={snapshot:item.snapshot,state:'ready',ready:3,total:3,defaultScope:scope,jobs:jobs(['av','wave','listen'])};
 assert.equal(classifyPreparation(done,item.snapshot).kind,'ready');
 assert.equal(classifyPreparation({...done,snapshot:'c'.repeat(64)},item.snapshot).kind,'waiting');
 assert.equal(classifyPreparation({...done,defaultScope:null,jobs:jobs(['frames','frames','frames'])},item.snapshot).kind,'partial');
 assert.equal(classifyPreparation({...done,jobs:jobs(['av','wave','listen']).map((job,i)=>i===2?{...job,status:'error'}:job)},item.snapshot).kind,'attention');
 assert.equal(classifyPreparation({...done,state:'unavailable'},item.snapshot).kind,'attention');
});

test('dashboard distinguishes active progress, partial preparation and disabled preparation',()=>{
 const p={snapshot:item.snapshot,state:'running',ready:1,total:3,defaultScope:scope,jobs:jobs(['av','wave','listen']).map((job,i)=>({...job,status:i===0?'ready':i===1?'running':'queued'}))};
 const active=classifyPreparation(p,item.snapshot);assert.equal(active.kind,'preparing');assert.equal(active.progress,true);assert.equal(active.ready,1);assert.equal(active.total,3);
 assert.equal(classifyPreparation({...p,state:'partial',jobs:p.jobs.map(job=>job.status==='running'?{...job,status:'missing'}:job)},item.snapshot).kind,'partial');
 assert.equal(classifyPreparation({...p,state:'disabled'},item.snapshot).kind,'disabled');
 assert.equal(classifyPreparation(null,item.snapshot).kind,'waiting');
});
const preparation=(modes,state='ready')=>({snapshot:item.snapshot,state,ready:state==='ready'?modes.length:0,total:modes.length,defaultScope:scope,jobs:jobs(modes).map(x=>({...x,status:state==='ready'?'ready':'queued'}))});
function timers(){let next=0;const pending=new Map();return {pending,setTimeout(fn,delay){pending.set(++next,{fn,delay});return next},clearTimeout(id){pending.delete(id)},async tick(){const [id,value]=pending.entries().next().value||[];if(!id)return;pending.delete(id);value.fn();await flush()}}}

test('cache loader forces read-only requests and reads each ready artifact once',async()=>{
 const clock=timers(),calls=[],ready=[];
 const loader=createCachedPreviewLoader({timers:clock,current:()=>true,load:async body=>{calls.push(body);return {cached:true,mode:body.mode}},onReady:(data,request)=>ready.push(request.mode)});
 loader.start([{...scope,snapshot:item.snapshot,mode:'wave',cachedOnly:false},{...scope,snapshot:item.snapshot,mode:'listen'}]);await flush();
 assert.deepEqual(new Set(ready),new Set(['wave','listen']));assert.equal(calls.length,2);assert(calls.every(x=>x.cachedOnly===true));assert.equal(clock.pending.size,0);loader.stop();
});
test('pending artifacts use status polling and never remount an already ready artifact',async()=>{
 const clock=timers(),calls=[],ready=[];let reads=0,waveReady=false;
 const loader=createCachedPreviewLoader({timers:clock,current:()=>true,load:async body=>{calls.push(body.mode);return body.mode==='listen'||waveReady?{cached:true}:{pending:true,preparation:preparation(['wave','listen'],'running')}},readPreparation:async()=>{reads++;const p=preparation(['wave','listen'],'running');p.jobs.find(x=>x.mode==='listen').status='ready';if(reads===2){waveReady=true;p.jobs.find(x=>x.mode==='wave').status='ready'}return {preparation:p}},onReady:(data,request)=>ready.push(request.mode)});
 loader.start(['wave','listen'].map(mode=>({...scope,mode,snapshot:item.snapshot})));await flush();assert.equal(clock.pending.size,1);assert.equal([...clock.pending.values()][0].delay,4000);
 await clock.tick();assert.deepEqual(calls,['listen','wave']);await clock.tick();assert.deepEqual(calls,['listen','wave','wave']);assert.deepEqual(ready,['listen','wave']);assert.equal(clock.pending.size,0);loader.stop();
});
test('cleanup ignores late cache responses and cancels polling',async()=>{
 const clock=timers();let resolve,ready=0;
 const loader=createCachedPreviewLoader({timers:clock,current:()=>true,load:()=>new Promise(r=>resolve=r),onReady:()=>ready++});loader.start([{...scope,mode:'av',previewProfile:'detail'}]);loader.stop();resolve({cached:true});await flush();assert.equal(ready,0);assert.equal(clock.pending.size,0);
 const pending=createCachedPreviewLoader({timers:clock,current:()=>true,load:async()=>({pending:true,preparation:preparation(['av'],'running')}),onReady:()=>{}});pending.start([{...scope,mode:'av',previewProfile:'detail'}]);await flush();assert.equal(clock.pending.size,1);pending.stop();assert.equal(clock.pending.size,0);
});
test('custom time or unavailable plan never creates an automatic foreground task',async()=>{
 const clock=timers(),calls=[];const loader=createCachedPreviewLoader({timers:clock,current:()=>true,load:async body=>{calls.push(body);return {pending:true,preparation:preparation(['av'],'running')}},onReady:()=>{}});
 loader.start([{...scope,seconds:20,mode:'av',previewProfile:'detail'}]);await flush();assert.equal(calls.length,1);assert.equal(calls[0].cachedOnly,true);assert.equal(clock.pending.size,0);
 assert(!previewJobMatches(jobs(['av'])[0],{...scope,mode:'av',previewProfile:'compact'}));assert(previewJobMatches(jobs(['wave'])[0],{...scope,mode:'wave'}));loader.stop();
});

class Element{
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.style={};this.attrs={};this.events=new Map();this.value='';this.checked=false;this.disabled=false;this.isConnected=true;this.validity={valid:true};this.className='';this.textContent='';this.classList={toggle:()=>{},add:()=>{},remove:()=>{}}}
 append(...nodes){this.children.push(...nodes)}
 prepend(...nodes){this.children.unshift(...nodes)}
 replaceChildren(...nodes){this.children=[...nodes]}
 setAttribute(name,value){this.attrs[name]=String(value)}
 getAttribute(name){return this.attrs[name]??null}
 hasAttribute(name){return name.startsWith('data-')?name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()) in this.dataset:name in this.attrs}
 addEventListener(type,fn){if(!this.events.has(type))this.events.set(type,[]);this.events.get(type).push(fn)}
 async emit(type){const event={preventDefault(){},target:this};if(this['on'+type])await this['on'+type](event);for(const fn of this.events.get(type)||[])await fn(event)}
 get options(){return this.children.filter(x=>x.tagName==='OPTION')}
 get selectedOptions(){return this.options.filter(x=>x.value===this.value)}
 querySelectorAll(selector){const result=[];const match=n=>selector.startsWith('[')?n.hasAttribute(selector.slice(1,-1)):n.tagName===selector.toUpperCase();const walk=node=>{for(const child of node.children){if(match(child))result.push(child);walk(child)}};walk(this);return result}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null}
 focus(){}
 getContext(){return new Proxy({},{get:()=>()=>{}})}
}
class Option extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value}}
const el=(tag,cls,text)=>{const node=new Element(tag);node.className=cls||'';node.textContent=text||'';return node};
const button=(text,fn,cls)=>{const b=el('button',cls,text);b.onclick=fn;return b};
const find=(host,tag,text)=>host.querySelectorAll(tag).find(x=>x.textContent===text);
const appSource=await fs.readFile(new URL('./public/comparison.js',import.meta.url),'utf8');
const audioCode=appSource.slice(appSource.indexOf('function openAudioComparison(item,options={}){'),appSource.indexOf('class AudioABPlayer'));
function audioFixture(mode='audio',load){
 const host=new Element('div'),requests=[],clock=timers(),counters={contexts:0,plays:0,mounts:0,cleanups:0,save:0,scope:0};
 class Context{constructor(){counters.contexts++}async resume(){}async close(){}}
 class ABPlayer{constructor(context){this.context=context;this.gain={gain:{value:.5}}}stop(){}close(){void this.context.close()}play(){counters.plays++;return {originalSeconds:12,reviewSeconds:12}}}
 const packet={seconds:scope.seconds,original:[.1,.2],review:[.1,.2],alignment:{reliable:true,offsetMs:0},originalTrack:{label:'original'},reviewTrack:{label:'review'}};
 const context=vm.createContext({el,button,Option,tr:x=>x,audioTrackLabel:x=>x,app:{latest:{items:[item]}},window:{AudioContext:Context},AudioABPlayer:ABPlayer,createCachedPreviewLoader,previewJobMatches,preparationSummary:()=>'',pendingPreviewMessage:()=>'',encodeURIComponent,Promise,Number,JSON,console,api:async(route,body)=>{requests.push(body);return load?load(body):{...packet,cached:true}},mountAVComparison:()=>{counters.mounts++;return ()=>counters.cleanups++}});
 vm.runInContext(audioCode,context);const cleanup=context.openAudioComparison(item,{host,scope:{...scope},tracks:{original:[{index:1,label:'original'}],review:[{index:2,label:'review'}]},mode,previewProfile:'detail',cachedAutoLoad:true,canInteract:()=>true,beforePreview:()=>counters.save++,onScopeChange:()=>counters.scope++});
 return {host,requests,clock,counters,cleanup,packet};
}
test('PCM and waveform preload create neither AudioContext nor playback nor review writes',async()=>{
 const f=audioFixture();try{await flush();assert.equal(f.requests.length,2);assert(f.requests.every(x=>x.cachedOnly));assert.equal(f.counters.contexts,0);assert.equal(f.counters.plays,0);assert.equal(f.counters.save,0);assert.equal(f.counters.scope,0);assert.equal(f.host.querySelectorAll('canvas').length,1,f.host.querySelectorAll('p').map(x=>x.textContent).join('\n'));
 await find(f.host,'button','Přehrát A/B do sluchátek').emit('click');assert.equal(f.counters.contexts,1);assert.equal(f.counters.plays,1);assert.equal(f.requests.length,2);assert.equal(f.counters.save,0)}finally{f.cleanup()}
});
test('AV preload is cache-only; changing time waits for explicit foreground request',async()=>{
 const f=audioFixture('av');await flush();assert.equal(f.counters.mounts,1);assert.equal(f.requests[0].previewProfile,'detail');assert.equal(f.requests[0].cachedOnly,true);assert.equal(f.counters.save,0);
 const time=f.host.querySelectorAll('input').find(x=>x.type==='number');time.value='20';await time.emit('input');await flush();assert.equal(f.counters.cleanups,1);assert.equal(f.requests.length,1);
 await find(f.host,'button','Porovnat video a zvuk').emit('click');assert.equal(f.requests.length,2);assert.equal(f.requests[1].cachedOnly,undefined);assert.equal(f.counters.save,1);assert.equal(f.counters.mounts,2);f.cleanup();
});
test('a late AV cache response cannot mount after its time was changed',async()=>{
 let resolve;const f=audioFixture('av',()=>new Promise(r=>resolve=r));await flush();const time=f.host.querySelectorAll('input').find(x=>x.type==='number');time.value='20';await time.emit('input');resolve({...f.packet,cached:true});await flush();assert.equal(f.counters.mounts,0);assert.equal(f.counters.save,0);f.cleanup();
});
test('server default pair becomes only an unconfirmed local draft and preserves a valid saved pair',async()=>{
 const previous={document:globalThis.document,Option:globalThis.Option,sessionStorage:globalThis.sessionStorage};const storage=new Map();globalThis.document={createElement:tag=>new Element(tag)};globalThis.Option=Option;globalThis.sessionStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
 try{for(const saved of [null,{originalIndex:3,reviewIndex:4,seconds:25}]){storage.clear();const calls=[],host=new Element('div'),checks=Object.fromEntries(['preparation','image','audio','syncStart','syncMiddle','syncEnd','hdr'].map(x=>[x,false]));const record={snapshot:item.snapshot,revision:0,session:{method:'review',device:'',step:0,scope:saved||{originalIndex:null,reviewIndex:null,seconds:null},checks,note:'',deferred:false},complete:false,requirements:{hdr:false}};
   const workflow=mountReviewWorkflow(host,item,{canWrite:()=>true,api:async(route,body)=>{calls.push({route,body});return body?{original:[{index:1,label:'suggested'},{index:3,label:'saved'}],review:[{index:2,label:'suggested'},{index:4,label:'saved'}],preparation:preparation(['av']),defaultScope:scope}:record},openComparison:()=>()=>{},openAudioComparison:()=>()=>{}});await flush();assert.equal(calls.length,2);assert(calls.every(x=>!x.body||x.body.mode==='tracks'));assert(host.querySelectorAll('[data-check]').every(x=>!x.checked));workflow.destroy();const draft=JSON.parse([...storage.values()][0]);assert.deepEqual(draft.session.scope,saved||scope);assert.equal(draft.revision,0);
  }
 }finally{for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value}}
});
test('latest whole-film progress updates the active workspace without remounting tools or saving review state',async()=>{
 const previous={document:globalThis.document,Option:globalThis.Option,sessionStorage:globalThis.sessionStorage};globalThis.document={createElement:tag=>new Element(tag)};globalThis.Option=Option;globalThis.sessionStorage={getItem:()=>null,setItem:()=>{}};
 let workflow;
 try{const host=new Element('div'),calls=[],initial={...preparation(['av'],'running'),ready:8,total:13},complete={...initial,state:'ready',ready:13},checks=Object.fromEntries(['preparation','image','audio','syncStart','syncMiddle','syncEnd','hdr'].map(key=>[key,key==='preparation']));let mounts=0,cleanups=0,feedback=0;
  const record={snapshot:item.snapshot,revision:3,session:{method:'review',device:'',step:1,scope:{...scope},checks,note:'',deferred:false},complete:false,requirements:{hdr:false}};
  workflow=mountReviewWorkflow(host,item,{preparation:initial,canWrite:()=>true,onPreparation:()=>feedback++,api:async(route,body)=>{calls.push({route,body});return body?{original:[{index:1,label:'original'}],review:[{index:2,label:'review'}],preparation:initial,defaultScope:scope}:record},openComparison:()=>()=>{},openAudioComparison:()=>{mounts++;return ()=>cleanups++}});
  await flush();const note=host.querySelector('textarea');note.value='Unsaved note';await note.emit('input');const currentTools=host.querySelectorAll('div').find(x=>x.className==='workflow-tools'),currentCheck=host.querySelector('[data-check]');assert(host.querySelectorAll('strong').some(x=>x.textContent.includes('8/13')));
  workflow.observePreparation(complete,{authoritative:true});assert(host.querySelectorAll('strong').some(x=>x.textContent.includes('13/13')));workflow.observePreparation(initial);assert(host.querySelectorAll('strong').some(x=>x.textContent.includes('13/13')));
  assert.equal(host.querySelector('textarea'),note);assert.equal(note.value,'Unsaved note');assert.equal(host.querySelector('[data-check]'),currentCheck);assert.equal(currentCheck.checked,false);assert.equal(host.querySelectorAll('div').find(x=>x.className==='workflow-tools'),currentTools);assert.equal(mounts,1);assert.equal(cleanups,0);assert.equal(calls.length,2);assert.equal(workflow.revision,3);assert.equal(feedback,0);
  workflow.observePreparation({...initial,snapshot:'c'.repeat(64)},{authoritative:true});assert(host.querySelectorAll('strong').some(x=>x.textContent.includes('13/13')));
  workflow.observePreparation(initial,{authoritative:true});assert(host.querySelectorAll('strong').some(x=>x.textContent.includes('8/13')));assert.equal(mounts,1);
 }finally{workflow?.destroy();for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value}}
});
test('server observation time accepts reduced readiness and rejects a stale higher count',async()=>{
 const previous={document:globalThis.document,Option:globalThis.Option,sessionStorage:globalThis.sessionStorage};globalThis.document={createElement:tag=>new Element(tag)};globalThis.Option=Option;globalThis.sessionStorage={getItem:()=>null,setItem:()=>{}};let workflow;
 try{const host=new Element('div'),initial={...preparation(['av']),ready:13,total:13,updated:1000},expired={...initial,state:'partial',ready:8,updated:2000};let mounts=0,feedback=0;const calls=[],checks=Object.fromEntries(['preparation','image','audio','syncStart','syncMiddle','syncEnd','hdr'].map(key=>[key,key==='preparation']));
  const record={snapshot:item.snapshot,revision:3,session:{method:'review',device:'',step:1,scope:{...scope},checks,note:'Preserve note',deferred:false},complete:false,requirements:{hdr:false}};
  workflow=mountReviewWorkflow(host,item,{preparation:initial,canWrite:()=>true,onPreparation:()=>feedback++,api:async(route,body)=>{calls.push({route,body});return body?{original:[{index:1,label:'original'}],review:[{index:2,label:'review'}],preparation:initial,defaultScope:scope}:record},openComparison:()=>()=>{},openAudioComparison:()=>{mounts++;return ()=>{}}});await flush();const note=host.querySelector('textarea'),check=host.querySelector('[data-check]');
  workflow.observePreparation(expired,{authoritative:true});assert(host.querySelectorAll('strong').some(x=>x.textContent.includes('8/13')));assert.equal(feedback,0);
  workflow.observePreparation({...initial,updated:1500});assert(host.querySelectorAll('strong').some(x=>x.textContent.includes('8/13')));workflow.observePreparation({...initial,updated:1500},{authoritative:true});assert(host.querySelectorAll('strong').some(x=>x.textContent.includes('8/13')));
  workflow.observePreparation({...expired,ready:7,updated:2500});assert(host.querySelectorAll('strong').some(x=>x.textContent.includes('7/13')));assert.equal(feedback,1);
  workflow.observePreparation({...initial,updated:3000},{authoritative:true});assert(host.querySelectorAll('strong').some(x=>x.textContent.includes('13/13')));assert.equal(host.querySelector('textarea'),note);assert.equal(note.value,'Preserve note');assert.equal(host.querySelector('[data-check]'),check);assert.equal(check.checked,false);assert.equal(workflow.revision,3);assert.equal(calls.length,2);assert.equal(mounts,1);
 }finally{workflow?.destroy();for(const [key,value]of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value}}
});
