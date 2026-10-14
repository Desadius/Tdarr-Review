import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

// The child enables Node's browser-module VM loader; npm test needs no extra flags.
if(typeof vm.SourceTextModule!=='function'){
 test('real Review app consumes Recovery runtime and renders both interface languages',()=>{
  const environment={...process.env};delete environment.NODE_TEST_CONTEXT;
  const child=spawnSync(process.execPath,['--experimental-vm-modules','--test',fileURLToPath(import.meta.url)],{encoding:'utf8',env:environment,timeout:30000});
  assert.equal(child.status,0,child.stdout+child.stderr);
  assert.match(child.stdout,/real Review app shows API runtime and interruption changes in cs/,'the flagged child must execute the consumer tests');
 });
}else{
 class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.dataset={};this.events=new Map();this.className='';this.value='';this.hidden=false;this.open=false;this.checked=false;this.disabled=false;this.ownText='';this.parentElement=null;this.style={};this.classList={toggle:(name,on)=>{const classes=new Set(this.className.split(/\s+/).filter(Boolean));if(on??!classes.has(name))classes.add(name);else classes.delete(name);this.className=[...classes].join(' ')}}}
  get textContent(){return this.ownText+this.children.map(node=>node.textContent).join('')}
  set textContent(value){this.ownText=String(value);this.children=[]}
  get firstElementChild(){return this.children.find(node=>node.tagName)||null}
  get nextElementSibling(){if(!this.parentElement)return null;const siblings=this.parentElement.children;return siblings.slice(siblings.indexOf(this)+1).find(node=>node.tagName)||null}
  append(...nodes){for(const node of nodes){node.remove();node.parentElement=this;this.children.push(node)}}
  prepend(...nodes){for(const node of nodes.reverse()){node.remove();node.parentElement=this;this.children.unshift(node)}}
  replaceChildren(...nodes){for(const node of this.children)node.parentElement=null;this.children=[];this.ownText='';this.append(...nodes)}
  insertBefore(node,before){node.remove();node.parentElement=this;const index=this.children.indexOf(before);if(index<0)this.children.push(node);else this.children.splice(index,0,node)}
  replaceWith(node){const parent=this.parentElement;if(parent){parent.insertBefore(node,this);this.remove()}}
  remove(){if(this.parentElement){const siblings=this.parentElement.children;siblings.splice(siblings.indexOf(this),1);this.parentElement=null}}
  setAttribute(name,value){this.attributes[name]=String(value);if(name==='class')this.className=String(value);if(['id','value','type','name'].includes(name))this[name]=String(value);if(['hidden','open','checked','disabled'].includes(name))this[name]=true;if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(value)}
  getAttribute(name){return this.attributes[name]??null}
  hasAttribute(name){return Object.hasOwn(this.attributes,name)}
  removeAttribute(name){delete this.attributes[name]}
  matches(selector){const attr=/\[([^=\]]+)(?:=["']?([^\]"']+)["']?)?\]/.exec(selector),tag=selector.split(/[.#[\s]/)[0];if(tag&&this.tagName!==tag.toUpperCase())return false;const cls=/\.([\w-]+)/.exec(selector);if(cls&&!this.className.split(/\s+/).includes(cls[1]))return false;const id=/#([\w-]+)/.exec(selector);if(id&&this.id!==id[1])return false;return !attr||(this.hasAttribute(attr[1])&&(attr[2]===undefined||this.getAttribute(attr[1])===attr[2]))}
  querySelectorAll(selector){const result=[];for(const child of this.children){if(child.tagName&&selector.split(',').some(part=>child.matches(part)))result.push(child);result.push(...child.querySelectorAll(selector))}return result}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null}
  closest(selector){return this.matches(selector)?this:this.parentElement?.closest(selector)||null}
  contains(node){return node===this||this.children.some(child=>child.contains(node))}
  addEventListener(type,fn){if(!this.events.has(type))this.events.set(type,[]);this.events.get(type).push(fn)}
  async emit(type){const event={target:this,preventDefault(){}};await this['on'+type]?.(event);for(const fn of this.events.get(type)||[])await fn(event)}
  focus(){}
 }
 class TextNode extends Element{constructor(value){super('');this.tagName=null;this.nodeValue=value}get textContent(){return this.nodeValue}set textContent(value){this.nodeValue=value}}
 function browserDocument(html){
  const root=new Element('document'),stack=[root],voids=new Set(['meta','link','input','img','br','hr','source']);
  for(const match of html.matchAll(/<[^>]*>|[^<]+/g)){
   const token=match[0];if(token.startsWith('<!'))continue;
   if(token.startsWith('</')){stack.pop();continue}
   if(token.startsWith('<')){const tag=/^<([\w-]+)/.exec(token)[1],node=new Element(tag);for(const attr of token.matchAll(/\s([\w-]+)(?:="([^"]*)")?/g))node.setAttribute(attr[1],attr[2]??'');stack.at(-1).append(node);if(!voids.has(tag)&&!token.endsWith('/>'))stack.push(node)}else stack.at(-1).append(new TextNode(token));
  }
  const document={documentElement:root.querySelector('html'),body:root.querySelector('body'),createElement:tag=>new Element(tag),getElementById:id=>root.querySelector('#'+id),querySelector:selector=>root.querySelector(selector),querySelectorAll:selector=>root.querySelectorAll(selector),addEventListener(){},createTreeWalker(node){const texts=[];const walk=entry=>{if(entry.tagName===null)texts.push(entry);for(const child of entry.children)walk(child)};walk(node);let index=-1;return {nextNode(){this.currentNode=texts[++index];return !!this.currentNode}}}};
  document.activeElement=document.body;return document;
 }
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 async function appFixture(language){
  const html=await fs.readFile(new URL('./public/index.html',import.meta.url),'utf8'),document=browserDocument(html),calls=[],timers=[],storage=new Map();let now=Date.now(),overviewError=null,fallbackRuntime=null,fallbackStatus=200;
  class BrowserDate extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
  const runtime={present:true,version:1,mode:'repair',state:'running',reason:null};
  let response={requests:[{id:'b'.repeat(24),source:'recovery',title:'Synthetic movie',phase:'verifying',canRestore:false,statusUpdated:new Date().toISOString()}],recoveryRuntime:runtime,recoveryConfig:{restartRequired:true,valid:true}};
  const location=new URL('http://localhost/?lang='+language+'#recovery');
  const context=vm.createContext({document,location,URL,URLSearchParams,Date:BrowserDate,console,AbortController,NodeFilter:{SHOW_TEXT:4},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},sessionStorage:{getItem:()=>null,removeItem(){},setItem(){}},history:{replaceState(){}},addEventListener(){},setInterval(fn,ms){timers.push({fn,ms});return timers.length},clearInterval(){},setTimeout,clearTimeout,fetch:async(route,options)=>{
   calls.push({route,method:options.method});if(route==='/api/radarr/requests'&&overviewError)return {status:overviewError.status,ok:false,json:async()=>({error:overviewError.message})};
   if(route==='/api/recovery/runtime'&&fallbackStatus!==200)return {status:fallbackStatus,ok:false,json:async()=>({error:'synthetic runtime unavailable'})};
   const data=route==='/api/items'?{label:'Synthetic Review',serverTime:now,items:[],history:[],recovery:[],pendingRestores:[],restorePending:0}:route==='/api/radarr/requests'?response:route==='/api/recovery/runtime'?fallbackRuntime:null;
   if(!data)throw Error('Unexpected fixture route: '+route);return {status:200,ok:true,json:async()=>structuredClone(data)};
  }});
  const publicRoot=new URL('./public/',import.meta.url),modules=new Map();
  // Execute the unmodified app source and link every real browser module.
  const appSource=await fs.readFile(new URL('./public/app.js',import.meta.url),'utf8');
  async function moduleFor(url){const key=url.href;if(modules.has(key))return modules.get(key);const filename=new URL(url);filename.search='';const source=url.pathname.endsWith('/app.js')?appSource:await fs.readFile(filename,'utf8');const module=new vm.SourceTextModule(source,{context,identifier:key});modules.set(key,module);return module}
  const app=await moduleFor(new URL('app.js',publicRoot));
  await app.link((specifier,referencing)=>moduleFor(specifier.startsWith('/')?new URL(specifier.slice(1),publicRoot):new URL(specifier,referencing.identifier)));
  await app.evaluate();for(let i=0;i<10;i++)await flush();
  const refresh=async()=>{await document.getElementById('recoveryRefresh').emit('click');for(let i=0;i<10;i++)await flush()};
  return {document,calls,timers,async update(value){response=value;await refresh()},async failOverview(runtime,status=500,runtimeStatus=200){overviewError={status,message:'synthetic shared case status invalid'};fallbackRuntime=runtime;fallbackStatus=runtimeStatus;now+=60000;await refresh()}};
 }
 for(const language of ['cs','en'])test('real Review app shows API runtime and interruption changes in '+language,async()=>{
  const fixture=await appFixture(language),dom=fixture.document,runtime=dom.getElementById('recoveryRuntime'),warning=dom.getElementById('recoveryRestartWarning');
  assert.equal(dom.documentElement.lang,language);assert.equal(dom.getElementById('error').hidden,true,dom.getElementById('error').textContent);
  assert.match(runtime.textContent,language==='en'?/Recovery status: Running · Repair/:/Stav Recovery: Běží · Repair/);
  assert.equal(warning.hidden,false);assert.match(warning.textContent,language==='en'?/container running Review interrupts Recovery/:/kontejneru s Review přeruší Recovery/);
  assert.match(dom.getElementById('recoveryConfig').textContent,language==='en'?/container running Review/:/kontejneru s Review/);
  await fixture.update({requests:[],recoveryConfig:null,recoveryRuntime:{present:true,mode:'repair',state:'refused',reason:'approval-registry-invalid'}});
  assert.match(runtime.textContent,language==='en'?/Startup refused/:/Spuštění odmítnuto/);assert.match(runtime.textContent,/approval-registry-invalid/);
  assert.equal(warning.hidden,true);assert.equal(warning.textContent,'');assert.equal(dom.getElementById('recoveryConfig').hidden,true);
  await fixture.update({requests:[],recoveryRuntime:{present:false,mode:'off',state:'off',reason:null}});
  assert.match(runtime.textContent,language==='en'?/Recovery status: Off/:/Stav Recovery: Off/);assert.doesNotMatch(runtime.textContent,/approval-registry-invalid/);
  assert(fixture.calls.every(call=>call.method==='GET'),'runtime polling must remain read-only');
 });
 for(const language of ['cs','en'])for(const [state,runtime,english,czech]of [
  ['refused',{present:true,mode:'repair',state:'refused',reason:'approval-registry-invalid'},'Startup refused','Spuštění odmítnuto'],
  ['unreadable',{present:true,state:'unreadable',reason:null},'Status cannot be read','Stav nelze přečíst']
 ])test('real Review app shows '+state+' runtime despite unreadable case status in '+language,async()=>{
  const fixture=await appFixture(language),dom=fixture.document,priorSummary=dom.getElementById('recoverySummary').textContent;
  await fixture.failOverview(runtime);
  assert(dom.getElementById('recoveryRuntime').textContent.includes(language==='en'?english:czech),'runtime must update independently of failed case data');
  if(runtime.reason)assert.match(dom.getElementById('recoveryRuntime').textContent,/approval-registry-invalid/);
  const error=dom.getElementById('recoveryError');assert.equal(error.hidden,false);assert.match(error.textContent,/synthetic shared case status invalid/);
  assert.match(error.textContent,language==='en'?/last loaded data remains visible/:/Poslední údaje zůstávají zobrazené/);
  assert.match(dom.getElementById('recoveryList').textContent,/Synthetic movie/,'last known cases must remain visible');
  assert.equal(dom.getElementById('recoverySummary').textContent,priorSummary,'failed overview must not renew case freshness');
  assert.equal(dom.getElementById('recoveryRestartWarning').hidden,true);
  assert.equal(fixture.calls.filter(call=>call.route==='/api/recovery/runtime').length,1);assert(fixture.calls.every(call=>call.method==='GET'));
 });
 test('real Review app skips the runtime fallback after authentication expires',async()=>{
  const fixture=await appFixture('en');await fixture.failOverview({present:true,state:'refused',mode:'repair',reason:'config-invalid'},401);
  assert.equal(fixture.calls.filter(call=>call.route==='/api/recovery/runtime').length,0,'runtime fallback requires the existing authenticated session');
  assert.equal(fixture.document.getElementById('login').hidden,false);assert.equal(fixture.document.getElementById('recoveryError').hidden,false);
 });
 for(const status of [500,401])test('real Review app retains the overview error when runtime fallback fails with '+status,async()=>{
  const fixture=await appFixture('en'),runtime=fixture.document.getElementById('recoveryRuntime'),prior=runtime.textContent;
  await fixture.failOverview(null,500,status);
  assert.equal(runtime.textContent,prior,'failed runtime read retains the last supervised state');assert.match(fixture.document.getElementById('recoveryError').textContent,/synthetic shared case status invalid/);assert.equal(fixture.document.getElementById('recoveryError').hidden,false);
  if(status===401)assert.equal(fixture.document.getElementById('login').hidden,false);
 });
}
