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
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.dataset={};this.events=new Map();this.className='';this.value='';this.hidden=false;this.open=false;this.checked=false;this.disabled=false;this.ownText='';this.parentElement=null;this.style={setProperty(){}};this.classList={add:(...names)=>{for(const name of names)this.classList.toggle(name,true)},remove:(...names)=>{for(const name of names)this.classList.toggle(name,false)},toggle:(name,on)=>{const classes=new Set(this.className.split(/\s+/).filter(Boolean));if(on??!classes.has(name))classes.add(name);else classes.delete(name);this.className=[...classes].join(' ')}}}
  // Like the DOM, the type property reflects the type attribute (input[type=checkbox] selectors).
  get type(){return this.attributes.type??''}
  set type(value){this.attributes.type=String(value)}
  get textContent(){return this.ownText+this.children.map(node=>node.textContent).join('')}
  set textContent(value){this.ownText=String(value);this.children=[]}
  get firstElementChild(){return this.children.find(node=>node.tagName)||null}
  // Attached to the parsed document, like the browser property (comparisons render only while connected).
  // Constraint validation is not modelled: every value is valid.
  get validity(){return {valid:true}}
  get isConnected(){let node=this;while(node.parentElement)node=node.parentElement;return node.tagName==='DOCUMENT'}
  get nextElementSibling(){if(!this.parentElement)return null;const siblings=this.parentElement.children;return siblings.slice(siblings.indexOf(this)+1).find(node=>node.tagName)||null}
  append(...nodes){for(const node of nodes){node.remove();node.parentElement=this;this.children.push(node)}}
  prepend(...nodes){for(const node of nodes.reverse()){node.remove();node.parentElement=this;this.children.unshift(node)}}
  replaceChildren(...nodes){for(const node of this.children)node.parentElement=null;this.children=[];this.ownText='';this.append(...nodes)}
  insertBefore(node,before){node.remove();node.parentElement=this;const index=this.children.indexOf(before);if(index<0)this.children.push(node);else this.children.splice(index,0,node)}
  replaceWith(node){const parent=this.parentElement;if(parent){parent.insertBefore(node,this);this.remove()}}
  remove(){if(this.parentElement){const siblings=this.parentElement.children;siblings.splice(siblings.indexOf(this),1);this.parentElement=null}}
  setAttribute(name,value){this.attributes[name]=String(value);if(name==='class')this.className=String(value);if(['id','value','type','name'].includes(name))this[name]=String(value);if(['hidden','open','checked','disabled'].includes(name))this[name]=true;if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(value)}
  getAttribute(name){return name.startsWith('data-')?this.dataset[name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]??null:this.attributes[name]??null}
  hasAttribute(name){return name.startsWith('data-')?name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()) in this.dataset:Object.hasOwn(this.attributes,name)}
  removeAttribute(name){delete this.attributes[name]}
  matches(selector){const attr=/\[([^=\]]+)(?:=["']?([^\]"']+)["']?)?\]/.exec(selector),tag=selector.split(/[.#[\s]/)[0];if(tag&&this.tagName!==tag.toUpperCase())return false;const cls=/\.([\w-]+)/.exec(selector.replace(/\[[^\]]*\]/g,''));if(cls&&!this.className.split(/\s+/).includes(cls[1]))return false;const id=/#([\w-]+)/.exec(selector.replace(/\[[^\]]*\]/g,''));if(id&&this.id!==id[1])return false;return !attr||(this.hasAttribute(attr[1])&&(attr[2]===undefined||this.getAttribute(attr[1])===attr[2]))}
  querySelectorAll(selector){const result=[];for(const child of this.children){if(child.tagName&&selector.split(',').some(part=>child.matches(part)))result.push(child);result.push(...child.querySelectorAll(selector))}return result}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null}
  closest(selector){return this.matches(selector)?this:this.parentElement?.closest(selector)||null}
  contains(node){return node===this||this.children.some(child=>child.contains(node))}
  addEventListener(type,fn){if(!this.events.has(type))this.events.set(type,[]);this.events.get(type).push(fn)}
  removeEventListener(type,fn){this.events.set(type,(this.events.get(type)||[]).filter(listener=>listener!==fn))}
  async emit(type){if(type==='click'&&this.disabled)return;const event={target:this,preventDefault(){}};await this['on'+type]?.(event);for(const fn of this.events.get(type)||[])await fn(event)}
  showModal(){this.open=true}
  close(value){if(value!==undefined)this.returnValue=value;this.open=false;return this.emit('close')}
  setCustomValidity(value){this.validationMessage=value}
  reportValidity(){return !this.validationMessage}
  // Like the DOM, focusing an element makes it the document's active element.
  focus(){if(activeDocument)activeDocument.activeElement=this}
 }
 let activeDocument=null;
 class TextNode extends Element{constructor(value){super('');this.tagName=null;this.nodeValue=value}get textContent(){return this.nodeValue}set textContent(value){this.nodeValue=value}}
 function browserDocument(html){
  const root=new Element('document'),stack=[root],voids=new Set(['meta','link','input','img','br','hr','source']);
  for(const match of html.matchAll(/<[^>]*>|[^<]+/g)){
   const token=match[0];if(token.startsWith('<!'))continue;
   if(token.startsWith('</')){stack.pop();continue}
   if(token.startsWith('<')){const tag=/^<([\w-]+)/.exec(token)[1],node=new Element(tag);for(const attr of token.matchAll(/\s([\w-]+)(?:="([^"]*)")?/g))node.setAttribute(attr[1],attr[2]??'');stack.at(-1).append(node);if(!voids.has(tag)&&!token.endsWith('/>'))stack.push(node)}else stack.at(-1).append(new TextNode(token));
  }
  const document={documentElement:root.querySelector('html'),body:root.querySelector('body'),createElement:tag=>new Element(tag),getElementById:id=>root.querySelector('#'+id),querySelector:selector=>root.querySelector(selector),querySelectorAll:selector=>root.querySelectorAll(selector),addEventListener(){},createTreeWalker(node){const texts=[];const walk=entry=>{if(entry.tagName===null)texts.push(entry);for(const child of entry.children)walk(child)};walk(node);let index=-1;return {nextNode(){this.currentNode=texts[++index];return !!this.currentNode}}}};
  for(const select of root.querySelectorAll('select'))select.value=(select.children.find(n=>n.hasAttribute('selected'))||select.children[0])?.value||'';
  document.activeElement=document.body;activeDocument=document;return document;
 }
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 async function appFixture(language,{itemsData={},routes={}}={}){
  const windowListeners={};
  const html=await fs.readFile(new URL('./public/index.html',import.meta.url),'utf8'),document=browserDocument(html),calls=[],timers=[],storage=new Map(),session=new Map();let now=Date.now(),overviewError=null,fallbackRuntime=null,fallbackStatus=200;
  class BrowserDate extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
  const runtime={present:true,version:1,mode:'repair',state:'running',reason:null};
  let response={requests:[{id:'b'.repeat(24),source:'recovery',title:'Synthetic movie',phase:'verifying',canRestore:false,statusUpdated:new Date().toISOString()}],recoveryRuntime:runtime,recoveryConfig:{restartRequired:true,valid:true}};
  const location=new URL('http://localhost/?lang='+language+'#recovery'),navigations=[];location.assign=value=>navigations.push(value);
  const context=vm.createContext({document,location,URL,URLSearchParams,Option:class extends Element{constructor(label,value){super('option');this.textContent=label;this.value=value}},Date:BrowserDate,console,AbortController,NodeFilter:{SHOW_TEXT:4},requestAnimationFrame:fn=>setTimeout(fn,0),cancelAnimationFrame(){},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},sessionStorage:{getItem:key=>session.has(key)?session.get(key):null,removeItem:key=>session.delete(key),setItem:(key,value)=>session.set(key,String(value))},history:{replaceState(){}},addEventListener(type,fn){(windowListeners[type]||=[]).push(fn)},setInterval(fn,ms){timers.push({fn,ms});return timers.length},clearInterval(){},setTimeout,clearTimeout,fetch:async(route,options)=>{
   calls.push({route,method:options.method,body:options.body?JSON.parse(options.body):undefined});
   const configured=routes[route]||routes[route.split('?')[0]],fixture=typeof configured==='function'?await configured({route,body:options.body?JSON.parse(options.body):undefined}):configured;if(fixture)return {status:fixture.status||200,ok:!fixture.status||fixture.status<400,json:async()=>structuredClone(fixture.data)};if(route==='/api/radarr/requests'&&overviewError)return {status:overviewError.status,ok:false,json:async()=>({error:overviewError.message})};
   if(route==='/api/recovery/runtime'&&fallbackStatus!==200)return {status:fallbackStatus,ok:false,json:async()=>({error:'synthetic runtime unavailable'})};
   const data=route==='/api/items'?{label:'Synthetic Review',serverTime:now,items:[],history:[],recovery:[],pendingRestores:[],restorePending:0,...itemsData}:route==='/api/radarr/requests'?response:route==='/api/recovery/runtime'?fallbackRuntime:null;
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
  return {document,calls,timers,storage,navigations,async hash(value){location.hash=value;for(const fn of windowListeners.hashchange||[])fn();for(let i=0;i<6;i++)await flush()},async tick(){for(const timer of timers.filter(t=>t.ms===1000))timer.fn();for(let i=0;i<15;i++)await flush();},async update(value){response=value;await refresh()},async failOverview(runtime,status=500,runtimeStatus=200){overviewError={status,message:'synthetic shared case status invalid'};fallbackRuntime=runtime;fallbackStatus=runtimeStatus;now+=60000;await refresh()}};
 }
 const sharedFixture={revision:'fixture-revision',managed:false,generation:0,active:null,historyUsesSetupTime:true,conflicts:[],migrationChoices:[],history:[],apply:{state:'idle'},draft:{review:{label:'Fixture',publicOrigin:'http://localhost',tdarrUrl:'http://127.0.0.1:8266',libraryId:'fixture',sourceRoots:['/tdarr-films','/alias'],tdarrReviewRoot:'/tdarr-review',mediaRoot:'/media',reviewRoot:'/review',reviewPrefixes:[],database:'/db',ffmpeg:'/ffmpeg',ffprobe:'/ffprobe'},radarr:{url:'http://127.0.0.1:7878',mediaRoot:'/radarr-films',quarantineRoot:'/radarr-quarantine',preferCzechEnglish:true,hasApiKey:true},sonarr:{url:'http://127.0.0.1:8989',hasApiKey:true},recovery:{sourceRoot:'/tdarr-films',quarantineRoot:'/recovery-quarantine',reports:'/reports',stableMinutes:10,confirmDelaySeconds:30,pollSeconds:300,decodeTimeoutHours:12,maxRepairsPerDay:3,movieCooldownDays:30,fullSourceHash:false,detectTerminalHeaders:true,since:1700000000000}}};
 test('both legacy settings entry points open one guided shared draft without applying',async()=>{
  const fixture=await appFixture('cs',{routes:{'/api/shared-settings':{data:sharedFixture},'/api/recovery/runtime':{data:{mode:'off',state:'off'}}}}),dom=fixture.document;
  await dom.getElementById('settingsReview').emit('click');
  const dialog=dom.querySelectorAll('dialog').find(n=>n.open);assert.ok(dialog);assert.match(dialog.textContent,/Společné nastavení/);assert.match(dialog.textContent,/První nastavení/);
  assert(fixture.calls.every(call=>call.method==='GET'));
  await dialog.close();await dom.getElementById('settingsRadarr').emit('click');assert.equal(dom.querySelectorAll('dialog').filter(n=>n.open).length,1);assert.equal(dom.querySelectorAll('dialog').find(n=>n.open),dialog);
 });
 const setting=(dom,key)=>dom.querySelector('[data-setting="'+key+'"]'),action=(dom,key)=>dom.querySelector('[data-settings-action="'+key+'"]');
 const tested={ok:true,invalidation:{level:'none',fields:[],reviews:0,approvals:0}};
 async function settingsFixture(language='cs',extra={}){const fixture=await appFixture(language,{routes:{'/api/shared-settings':{data:sharedFixture},'/api/shared-settings/test':{data:tested},'/api/recovery/runtime':{data:{mode:'off',state:'off'}},...extra}});await fixture.document.getElementById('settingsReview').emit('click');return fixture;}
 for(const language of ['cs','en'])test('guided shared settings exposes every option and keeps secrets absent in '+language,async()=>{
  const f=await settingsFixture(language),dom=f.document,dialog=dom.querySelector('dialog.shared-settings-dialog');
  assert.match(dialog.textContent,language==='en'?/Shared Review and Recovery settings/:/Společné nastavení Review a Recovery/);assert.match(dialog.textContent,/RECOVERY_MODE/);
  assert.match(dom.querySelector('.settings-summary').textContent,language==='en'?/Off · Not running/:/Off · Neběží/);assert.equal(dom.querySelector('.settings-summary').querySelector('.alert'),null);
  assert.equal(setting(dom,'radarr.apiKey').value,'');assert.equal(dom.querySelectorAll('[data-setting="radarr.apiKey"]').length,1);
  assert.equal(dialog.querySelectorAll('fieldset').filter(n=>!n.hidden).length,1);await action(dom,'next').emit('click');assert.equal(dialog.querySelectorAll('fieldset').filter(n=>!n.hidden).length,1);await action(dom,'next').emit('click');assert.equal(dom.querySelector('details.settings-advanced').hidden,false);
  for(const key of ['review.database','review.ffmpeg','review.ffprobe','review.reviewPrefixes','recovery.reports','recovery.stableMinutes','recovery.confirmDelaySeconds','recovery.pollSeconds','recovery.decodeTimeoutHours','recovery.maxRepairsPerDay','recovery.movieCooldownDays','recovery.fullSourceHash','recovery.detectTerminalHeaders','recovery.since'])assert.ok(setting(dom,key),key);
  assert.equal(dom.querySelector('details.settings-advanced').open,false);assert(f.calls.every(call=>call.method==='GET'));
 });
 for(const language of ['cs','en'])test('manual Sonarr inspector waits for explicit actions and renders selected metadata in '+language,async()=>{
  const result={series:{id:7,title:'Synthetic Show'},complete:true,source:'unverified',bindings:[{status:'mapped',reason:null,file:{id:31,label:'Synthetic Show/Specials/S00E01.mkv',seasonNumber:0},episodes:[{id:42,seasonNumber:0,episodeNumber:1,absoluteEpisodeNumber:1,sceneAbsoluteEpisodeNumber:101,unverifiedSceneNumbering:true,airDate:'2020-01-02'}]}],unacquiredEpisodes:[{id:43,seasonNumber:1,episodeNumber:3,absoluteEpisodeNumber:null,sceneAbsoluteEpisodeNumber:null,sceneSeasonNumber:null,sceneEpisodeNumber:null,unverifiedSceneNumbering:null,airDate:null,airDateUtc:null}]};
  const snapshot={...sharedFixture,draft:{...sharedFixture.draft,libraries:{tv:{sonarrRoot:'/sonarr/tv',mediaRoot:'/media/tv'}}}};
  const f=await settingsFixture(language,{'/api/shared-settings':{data:snapshot},'/api/sonarr/series?revision=fixture-revision':{data:{series:[{id:7,title:'Synthetic Show'}]}},'/api/sonarr/inspect?revision=fixture-revision&seriesId=7':{data:result},'/api/sonarr/source?revision=fixture-revision&seriesId=7&episodeFileId=31':{data:{status:'present',source:'unverified',relative:'Show/S00E01.mkv',size:1024}}}),dom=f.document,panel=dom.querySelector('.sonarr-inspector'),buttons=panel.querySelectorAll('button');
  assert.ok(panel);assert.match(panel.textContent,language==='en'?/unverified/iu:/neověřené/i);assert.equal(f.calls.some(call=>call.route.startsWith('/api/sonarr/')),false,'opening settings must not contact Sonarr');
  await buttons[0].emit('click');assert.equal(f.calls.at(-1).route,'/api/sonarr/series?revision=fixture-revision');assert.equal(f.calls.at(-1).method,'GET');
  await buttons[1].emit('click');assert.equal(f.calls.at(-1).route,'/api/sonarr/inspect?revision=fixture-revision&seriesId=7');assert.equal(f.calls.at(-1).method,'GET');
  assert.match(panel.textContent,/S00E01/);assert.match(panel.textContent,language==='en'?/Episode ID: 42/:/ID epizody: 42/);assert.match(panel.textContent,language==='en'?/Scene absolute episode number 101/:/Scénové absolutní číslo 101/);assert.match(panel.textContent,language==='en'?/UNVERIFIED Sonarr metadata/:/NEOVĚŘENÁ metadata Sonarru/);
  assert.match(panel.textContent,language==='en'?/Episodes without a file in Sonarr/:/Epizody bez souboru v Sonarru/);assert.match(panel.textContent,language==='en'?/Episode ID: 43/:/ID epizody: 43/);
  const sourceCheck=panel.querySelectorAll('button')[2];assert.match(sourceCheck.textContent,language==='en'?/Check source path/:/Zkontrolovat cestu zdroje/);await sourceCheck.emit('click');
  assert.equal(f.calls.at(-1).route,'/api/sonarr/source?revision=fixture-revision&seriesId=7&episodeFileId=31');assert.equal(f.calls.at(-1).method,'GET');
  assert.match(panel.textContent,language==='en'?/Relative path: Show\/S00E01\.mkv/:/Relativní cesta: Show\/S00E01\.mkv/);assert.equal(f.calls.filter(call=>call.route.includes('/api/sonarr/source')).length,1);
  assert.equal(f.calls.some(call=>call.method==='POST'&&call.route!=='/api/shared-settings/draft'),false);
 });
 test('an unconfigured Sonarr connection offers no inspection action',async()=>{
  const snapshot={...sharedFixture,draft:{...sharedFixture.draft,sonarr:{url:'',hasApiKey:false}}},f=await settingsFixture('cs',{'/api/shared-settings':{data:snapshot}}),panel=f.document.querySelector('.sonarr-inspector');
  assert.equal(panel.querySelectorAll('button').every(control=>control.disabled),true);assert.equal(f.calls.some(call=>call.route.startsWith('/api/sonarr/')),false);
 });
 test('offline draft saves only changed fields and clears typed keys without browser persistence',async()=>{
  let body;const f=await settingsFixture('en',{'/api/shared-settings/draft':request=>{body=request.body;return {data:{...sharedFixture,revision:'saved',draft:{...sharedFixture.draft,review:{...sharedFixture.draft.review,label:'Offline label'}}}};}}),dom=f.document;
  const label=setting(dom,'review.label');label.value='Offline label';await label.emit('input');assert.equal(action(dom,'test').disabled,true);assert.equal(action(dom,'apply').disabled,true);assert.equal(action(dom,'save').disabled,false);
  const key=setting(dom,'radarr.apiKey');key.value='synthetic-only-secret';await key.emit('input');await action(dom,'save').emit('click');
  assert.equal(body.patch.review.label,'Offline label');assert.equal(body.patch.radarr.apiKey,'synthetic-only-secret');assert.equal(body.patch.recovery,undefined);assert.equal(setting(dom,'radarr.apiKey').value,'');assert.equal(JSON.stringify([...f.storage]).includes('synthetic-only-secret'),false);
  assert.deepEqual(f.calls.filter(call=>call.method==='POST').map(call=>call.route),['/api/shared-settings/draft']);assert.match(dom.querySelector('.shared-settings-status').textContent,/Draft saved/);
 });
test('editing the optional Sonarr URL never submits the redacted API key status as a setting',async()=>{
 let submitted;const f=await settingsFixture('en',{'/api/shared-settings/draft':request=>{submitted=request.body;return {data:{...sharedFixture,revision:'saved'}};}}),dom=f.document;
 const url=setting(dom,'sonarr.url');url.value='http://127.0.0.1:8990/sonarr';await url.emit('input');await action(dom,'save').emit('click');
 assert.deepEqual(submitted.patch,{sonarr:{url:'http://127.0.0.1:8990/sonarr'}});assert.equal(submitted.patch.sonarr.hasApiKey,undefined);assert.equal(submitted.patch.sonarr.apiKey,undefined);
});
test('a mapped Sonarr file cannot be source-checked without an explicit saved root mapping',async()=>{
 const result={series:{id:7,title:'Synthetic Show'},complete:true,source:'unverified',bindings:[{status:'mapped',reason:null,file:{id:31,label:'Show/E01.mkv',seasonNumber:1},episodes:[{id:42,seasonNumber:1,episodeNumber:1}]}],unacquiredEpisodes:[]};
 const f=await settingsFixture('cs',{'/api/sonarr/series?revision=fixture-revision':{data:{series:[{id:7,title:'Synthetic Show'}]}},'/api/sonarr/inspect?revision=fixture-revision&seriesId=7':{data:result}}),panel=f.document.querySelector('.sonarr-inspector');
 await panel.querySelectorAll('button')[0].emit('click');await panel.querySelectorAll('button')[1].emit('click');assert.equal(panel.querySelectorAll('button')[2].disabled,true);assert.equal(f.calls.some(call=>call.route.includes('/api/sonarr/source')),false);
});
 test('validation errors preserve entered values and refresh revision while real CAS conflicts require reload',async()=>{
  const sent=[];let failures=0;const f=await settingsFixture('en',{'/api/shared-settings/draft':request=>{sent.push(request.body);failures++;return {status:409,data:{code:failures===1?'settings_invalid':'settings_conflict',field:'review.label',revision:failures===1?'audit-revision':'newer-user-revision'}};}}),dom=f.document;
  setting(dom,'review.label').value='Keep my edit';await setting(dom,'review.label').emit('input');await action(dom,'save').emit('click');assert.equal(setting(dom,'review.label').value,'Keep my edit');assert.equal(action(dom,'save').disabled,false);await action(dom,'save').emit('click');assert.equal(sent[1].revision,'audit-revision');assert.equal(action(dom,'save').disabled,true);
  await dom.getElementById('sharedSettingsForm').emit('submit');assert.equal(sent.length,2);assert.equal(setting(dom,'review.label').value,'Keep my edit');assert.match(dom.querySelector('.shared-settings-status').textContent,/Reload/);assert.equal(action(dom,'reload').disabled,false);
 });
 test('source selection and secret legacy decisions are explicit draft writes',async()=>{
  let body;const snapshot={...sharedFixture,conflicts:['radarr.apiKey'],migrationChoices:[{field:'radarr.apiKey',secret:true,hasSharedValue:true,hasRecoveryValue:true}]};
  const f=await settingsFixture('cs',{'/api/shared-settings':{data:snapshot},'/api/shared-settings/draft':request=>{body=request.body;return {data:sharedFixture};}}),dom=f.document;
  setting(dom,'recovery.sourceRoot').value='/alias';await setting(dom,'recovery.sourceRoot').emit('change');const choice=dom.querySelector('[data-conflict="radarr.apiKey"]');choice.value='recovery';await choice.emit('change');await action(dom,'save').emit('click');
  assert.equal(body.patch.recovery.sourceRoot,'/alias');assert.deepEqual(body.resolutions,[{field:'radarr.apiKey',source:'recovery'}]);assert.equal(body.patch.radarr,undefined);
 });
 test('custom earlier history sends an explicit date and acknowledgement; unchanged setup omits since',async()=>{
  let body;const f=await settingsFixture('cs',{'/api/shared-settings/draft':request=>{body=request.body;return {data:sharedFixture};}}),dom=f.document;
  const custom=setting(dom,'customSince');custom.checked=true;await custom.emit('change');setting(dom,'recovery.since').value='2020-01-01T12:00';await setting(dom,'recovery.since').emit('input');setting(dom,'acknowledgeHistory').checked=true;await action(dom,'save').emit('click');assert.equal(body.acknowledgeHistory,true);assert.ok(body.patch.recovery.since<1700000000000);
 });
 test('saving a draft refreshes its durable audit without applying',async()=>{
  const f=await settingsFixture('en',{'/api/shared-settings/draft':{data:sharedFixture},'/api/shared-settings/audit':{data:{history:[{at:'2026-10-17T10:00:00Z',action:'save',result:'success',fields:['review.label'],generation:0,revision:'new-draft'}]}}});
  await action(f.document,'save').emit('click');assert.match(f.document.querySelector('.settings-history').textContent,/2026/);assert.equal(f.calls.filter(c=>c.route.endsWith('/apply')).length,0);
 });
 test('Apply polling preserves active draft runtime and supports Cancel without replaying apply',async()=>{
  let state='draining';const f=await settingsFixture('en',{'/api/shared-settings/apply':{data:{id:'operation',state:'draining'}},'/api/shared-settings/status':()=>({data:{id:'operation',state}}),'/api/shared-settings/cancel':()=>{state='cancelled';return {data:{id:'operation',state:'draining',cancelling:true}};}}),dom=f.document;
  await action(dom,'test').emit('click');await action(dom,'apply').emit('click');assert.equal(action(dom,'cancel').disabled,false);assert.equal(action(dom,'save').disabled,true);assert.match(dom.querySelector('.settings-summary').textContent,/Finishing the Recovery operation/);await action(dom,'cancel').emit('click');await f.tick();
  assert.equal(f.calls.filter(call=>call.route==='/api/shared-settings/apply'&&call.method==='POST').length,1);assert.equal(f.calls.filter(call=>call.route==='/api/shared-settings/cancel').length,1);assert(f.calls.filter(call=>call.method==='POST').every(call=>call.route.startsWith('/api/shared-settings/')));
  assert.doesNotMatch(dom.querySelector('.shared-settings-status').textContent,/You can cancel while waiting/);
 });
 test('finalizing disables Cancel and a fast Host switch offers a manual address link without automatic navigation',async()=>{
  const f=await settingsFixture('en',{'/api/shared-settings/apply':{data:{id:'fast',state:'validating',publicOrigin:'http://next-review:8270'}},'/api/shared-settings/status':{status:403,data:{code:'host_forbidden'}}}),dom=f.document;
  await action(dom,'test').emit('click');await action(dom,'apply').emit('click');await f.tick();assert.equal(f.navigations.length,0);assert.match(dom.querySelector('.shared-settings-status').textContent,/address may have changed/);assert.equal(dom.querySelector('.shared-settings-status').querySelector('a').href,'http://next-review:8270/?lang=en#settings');assert.equal(f.calls.filter(call=>call.route.endsWith('/apply')).length,1);
  const final=await settingsFixture('cs',{'/api/shared-settings':{data:{...sharedFixture,apply:{id:'end',state:'finalizing'}}}});assert.equal(action(final.document,'cancel').disabled,true);assert.equal(action(final.document,'apply').disabled,true);
 });
 for(const language of ['cs','en'])test('failed or interrupted setup preserves distinct active values, draft and runtime in '+language,async()=>{
  const snapshot={...sharedFixture,managed:true,generation:4,active:{...sharedFixture.draft,review:{...sharedFixture.draft.review,label:'Active label'}},draft:{...sharedFixture.draft,review:{...sharedFixture.draft.review,label:'Draft label'}},apply:{id:'failed',state:'failed',error:{code:'settings_start_failed'}},history:[{at:'2026-10-17T10:00:00Z',action:'apply',result:'failure',fields:['review.label'],generation:4,revision:'abc123'}]};
  const f=await settingsFixture(language,{'/api/shared-settings':{data:snapshot},'/api/recovery/runtime':{data:{mode:'verify',state:'refused'}}}),dom=f.document;
  assert.equal(setting(dom,'review.label').value,'Draft label');assert.match(dom.querySelector('.settings-active').textContent,/Active label/);assert.match(dom.querySelector('.settings-summary').textContent,language==='en'?/did not start/:/nenastartovalo/);assert.match(dom.querySelector('.settings-history').textContent,/2026/);assert.match(dom.querySelector('.settings-history').textContent,language==='en'?/Failure/:/Selhání/);assert(f.calls.every(c=>c.method==='GET'));
 });
 for(const language of ['cs','en'])test('Apply waits for a Test of the saved draft, shows what it clears and sends that with Apply in '+language,async()=>{
  let sent;const report={ok:true,invalidation:{level:'all',fields:['mediaRoot'],reviews:2,approvals:1}};
  const f=await settingsFixture(language,{'/api/shared-settings/test':{data:report},'/api/shared-settings/apply':request=>{sent=request.body;return {data:{id:'shown',state:'validating'}};}}),dom=f.document;
  assert.equal(action(dom,'apply').disabled,true,'no Test yet');assert.match(dom.querySelector('.settings-summary').textContent,language==='en'?/Test the draft before applying it/:/Před použitím návrh otestuj/);
  await action(dom,'test').emit('click');assert.equal(action(dom,'apply').disabled,false);
  const text=dom.querySelector('.settings-summary').textContent;
  assert.match(text,language==='en'?/Applying clears saved reviews, Approve decisions and prepared samples\. Saved reviews: 2 · Approve decisions: 1\. Changed fields: [^.]+\./:/Použití smaže uložená posouzení, rozhodnutí Approve a připravené vzorky\. Uložená posouzení: 2 · Rozhodnutí Approve: 1\. Změněná pole: [^.]+\./);
  await action(dom,'apply').emit('click');assert.deepEqual(sent.invalidation,{level:'all',reviews:2,approvals:1});assert.equal(sent.revision,sharedFixture.revision);
 });
 test('only an observed committed origin can trigger automatic navigation',async()=>{
  const f=await settingsFixture('en',{'/api/shared-settings/apply':{data:{id:'done',state:'starting',publicOrigin:'http://next-review:8270'}},'/api/shared-settings/status':{data:{id:'done',state:'succeeded',publicOrigin:'http://next-review:8270'}}});
  await action(f.document,'test').emit('click');await action(f.document,'apply').emit('click');assert.equal(f.navigations.length,0);await f.tick();assert.deepEqual(f.navigations,['http://next-review:8270/?lang=en#settings']);assert.equal(f.calls.filter(c=>c.route.endsWith('/apply')).length,1);
 });
 for(const language of ['cs','en'])for(const cleanupEnabled of [false,true])test(`real dialogs render retention settings and cleanup state in ${language} (${cleanupEnabled})`,async()=>{
  const fixture=await appFixture(language,{routes:{'/api/quarantine':{data:{files:[],warnings:[],retentionDays:14,cleanupEnabled}},'/api/radarr/settings':{data:{url:'http://127.0.0.1',mediaRoot:'/fixture',quarantineRoot:'/quarantine',retentionDays:21}}}}),dom=fixture.document;
  await dom.getElementById('settingsQuarantine').emit('click');
  const quarantine=dom.querySelectorAll('dialog').find(n=>n.open);assert.ok(quarantine);
  assert.match(quarantine.textContent,language==='en'?/retention period before cleanup is 14 days/:/úklid je 14 dní/);
  assert.match(quarantine.textContent,language==='en'?(cleanupEnabled?/Automatic cleanup is enabled/:/Automatic quarantine cleanup is disabled/):(cleanupEnabled?/Automatický úklid je zapnutý/:/Automatický úklid karantény je vypnutý/));
  assert.doesNotMatch(quarantine.textContent,/7 (?:days|dní)/);assert(fixture.calls.every(c=>c.method==='GET'));
 });
 for(const language of ['cs','en'])test('real retention dialogs omit an unknown period in '+language,async()=>{
  const fixture=await appFixture(language,{routes:{'/api/quarantine':{data:{files:[],warnings:[],retentionDays:null,cleanupEnabled:false}},'/api/radarr/settings':{data:{url:'http://127.0.0.1',mediaRoot:'/fixture',quarantineRoot:'/quarantine',retentionDays:null}}}}),dom=fixture.document;
  await dom.getElementById('settingsQuarantine').emit('click');const quarantine=dom.querySelectorAll('dialog').find(n=>n.open);assert.doesNotMatch(quarantine.textContent,/(?:null|undefined|\d+) (?:days|dní)/);
  assert.doesNotMatch(quarantine.textContent,/(?:null|undefined|\d+) (?:days|dní)/);
 });
 for(const language of ['cs','en'])test('real app renders only known pending-node film and time in '+language,async()=>{
  const now='2026-10-16T10:00:00Z',fixture=await appFixture(language,{itemsData:{restorePending:2,pendingRestores:[{name:'node-known',title:'Film (2020)',pausedAt:now},{name:'node-legacy',title:null,pausedAt:null}]}}),box=fixture.document.getElementById('nodeRestores');
  const known=box.children.find(n=>n.textContent.includes('node-known')),legacy=box.children.find(n=>n.textContent.includes('node-legacy'));
  assert.match(known.textContent,language==='en'?/Paused for Film \(2020\)/:/Pozastaveno pro Film \(2020\)/);assert.match(known.textContent,/2026/);
  assert.doesNotMatch(legacy.textContent,/Film|Paused for|Pozastaveno pro|\?|null|undefined|2026/);assert.match(legacy.textContent,/node-legacy/);
 });
 for(const language of ['cs','en'])for(const coded of [true,false])test(`real app localizes error codes and preserves unknown server text in ${language} (${coded})`,async()=>{
  const fixture=await appFixture(language,{routes:{'/api/quarantine':{status:409,data:{code:coded?'item_changed':'unknown-fixture-code',error:'Synthetic untranslated fallback /fixture/movie.mkv'}}}}),dom=fixture.document;
  await dom.getElementById('settingsQuarantine').emit('click');const error=dom.getElementById('error');assert.equal(error.hidden,false);
  if(coded)assert.match(error.textContent,language==='en'?/item.*changed/i:/Položka se změnila/);else assert.equal(error.textContent,'Synthetic untranslated fallback /fixture/movie.mkv');
 });
 const reviewItem={id:'a'.repeat(24),snapshot:'b'.repeat(64),title:'Fixture film',status:'ready',originalBytes:200,reviewBytes:100,durationA:100,durationB:100};
 for(const language of ['cs','en'])for(const reason of ['Zavřít','<img src=x onerror=alert(1)>\nZavřít'])test('real rejection dialog sends the entered reason and never confirms review in '+language+' ('+reason.slice(0,6)+')',async()=>{
  const checks=Object.fromEntries(['preparation','image','audio','syncStart','syncMiddle','syncEnd','hdr'].map(key=>[key,false]));
  const session={snapshot:reviewItem.snapshot,revision:0,requirements:{hdr:false},complete:false,session:{method:'review',device:'',step:0,scope:{originalIndex:1,reviewIndex:2,seconds:10},checks,note:'',deferred:false}};
  const fixture=await appFixture(language,{itemsData:{items:[reviewItem],history:[{id:'history',title:'Past film',action:'reject',status:'success',time:'2026-10-16T10:00:00Z',rejectionReason:reason}]},routes:{['/api/items/'+reviewItem.id+'/review-session']:{data:session},['/api/items/'+reviewItem.id+'/audio-compare']:{data:{original:[{index:1,label:'Original'}],review:[{index:2,label:'Review'}]}},['/api/items/'+reviewItem.id+'/reject']:{data:{ok:true}}}}),dom=fixture.document;
  const history=dom.getElementById('history');assert.ok(history.textContent.includes((language==='en'?'Reason: ':'Důvod: ')+reason));assert.equal(history.querySelectorAll('img').length,0);
  const inspect=dom.querySelectorAll('button').find(n=>n.getAttribute('aria-label')===(language==='en'?'Review Fixture film':'Posoudit Fixture film'));assert.ok(inspect);await inspect.emit('click');for(let i=0;i<4;i++)await flush();
  assert(dom.querySelectorAll('[data-check]').length>0);assert(dom.querySelectorAll('[data-check]').every(n=>n.checked===false));
  const reject=dom.getElementById('detailActions').querySelector('button');assert.equal(reject.disabled,false);await reject.emit('click');assert.equal(dom.getElementById('confirm').open,true);
  await dom.getElementById('commit').emit('click');assert.ok(dom.getElementById('rejectReason').validationMessage);assert.equal(fixture.calls.filter(c=>c.method==='POST'&&!c.route.endsWith('/audio-compare')).length,0);
  dom.getElementById('rejectReason').value=reason;await dom.getElementById('rejectReason').emit('input');await dom.getElementById('commit').emit('click');await dom.getElementById('confirm').close('confirm');for(let i=0;i<4;i++)await flush();
  const writes=fixture.calls.filter(c=>c.method==='POST'&&!c.route.endsWith('/audio-compare'));assert.equal(writes.length,1);assert.equal(writes[0].route,'/api/items/'+reviewItem.id+'/reject');assert.equal(writes[0].body.reason,reason);
  assert.equal(fixture.calls.filter(c=>c.method==='POST'&&c.route.endsWith('/review-session')).length,0,'opening and rejecting do not confirm review');
 });
 for(const language of ['cs','en'])test('selection mode explains every unavailable film and updates after a saved review in '+language,async()=>{
  const en=language==='en',ids=['c','d','e'].map(x=>x.repeat(24)),items=[{...reviewItem,id:ids[0],title:'Unreviewed film'},{...reviewItem,id:ids[1],title:'Completed film'},{...reviewItem,id:ids[2],title:'Blocked film',status:'blocked',reason:'Synthetic blocker'}];
  const checks=Object.fromEntries(['preparation','image','audio','syncStart','syncMiddle','syncEnd'].map(key=>[key,true])),done={version:1,revision:3,requirements:{hdr:false},snapshot:reviewItem.snapshot,complete:true,session:{step:4,deferred:false,checks}};
  const data={label:'Synthetic Review',items,history:[],recovery:[],pendingRestores:[],restorePending:0,reviewSessions:{[ids[1]]:done},approvals:{[ids[1]]:{reviewRevision:3,approvedAt:'2026-10-18T10:00:00Z'}}};
  const session={snapshot:reviewItem.snapshot,revision:0,requirements:{hdr:false},complete:false,session:{method:'review',device:'',step:0,scope:{originalIndex:1,reviewIndex:2,seconds:10},checks:{...checks,preparation:false},note:'',deferred:false}};
  const f=await appFixture(language,{routes:{'/api/items':()=>({data:{...structuredClone(data),serverTime:Date.now()}}),['/api/items/'+ids[0]+'/review-session']:{data:session},['/api/items/'+ids[0]+'/audio-compare']:{data:{original:[],review:[]}}}}),dom=f.document;
  const row=title=>dom.getElementById('list').children.find(n=>n.textContent.includes(title)),why=title=>row(title).querySelector('details.selection-why'),box=title=>row(title).querySelector('input[type=checkbox]');
  const states=Object.fromEntries(items.map(x=>[x.title,row(x.title).querySelector('.badge').dataset.state]));
  assert.deepEqual(states,{'Unreviewed film':'ready','Completed film':'approved','Blocked film':'blocked'});
  assert.match(row('Completed film').querySelector('.badge').textContent,en?/Approved · waiting for replacement/:/Schváleno · čeká na nahrazení/);assert.match(row('Blocked film').querySelector('.badge').textContent,en?/Technically blocked/:/Technicky blokováno/);
  assert.equal(row('Completed film').querySelector('.state-icon').getAttribute('aria-hidden'),'true');
  for(const x of items)assert.equal(why(x.title).hidden,true,'no explanation outside selection mode');
  await dom.getElementById('selectionToggle').emit('click');
  assert.match(dom.getElementById('selectionHint').textContent,en?/batch replacement of approved films\. Selectable: 1 of 3\./:/hromadnému nahrazení schválených filmů\. Lze vybrat: 1 z 3\./);
  assert.equal(box('Completed film').disabled,false);assert.equal(why('Completed film').hidden,true);
  assert.equal(box('Unreviewed film').disabled,true);assert.equal(why('Unreviewed film').hidden,false);
  assert.match(why('Unreviewed film').querySelector('summary').textContent,en?/Why can't I select it\?/:/Proč nelze vybrat\?/);
  assert.match(why('Unreviewed film').textContent,en?/has not been reviewed yet/:/ještě nebyl posouzen/);
  assert.match(why('Blocked film').textContent,en?/technically blocked/:/technicky blokovaný/);
  assert.equal(why('Unreviewed film').querySelector('button').hidden,false);
  const writesBefore=f.calls.filter(c=>c.method==='POST').length;
  await why('Unreviewed film').querySelector('button').emit('click');for(let i=0;i<4;i++)await flush();
  assert.equal(dom.getElementById('filmDetail').open,true);assert.equal(dom.getElementById('detailTitle').textContent,'Unreviewed film');
  assert.equal(f.calls.filter(c=>c.method==='POST'&&!c.route.endsWith('/audio-compare')).length,writesBefore,'opening an explanation or review confirms nothing');
  await dom.getElementById('filmDetail').close();
  data.reviewSessions[ids[0]]={...done,snapshot:reviewItem.snapshot};data.approvals[ids[0]]={reviewRevision:3,approvedAt:'2026-10-18T11:00:00Z'};
  for(const timer of f.timers.filter(t=>t.ms===2000))timer.fn();for(let i=0;i<15;i++)await flush();
  assert.equal(box('Unreviewed film').disabled,false);assert.equal(why('Unreviewed film').hidden,true);
  assert.match(dom.getElementById('selectionHint').textContent,en?/Selectable: 2 of 3/:/Lze vybrat: 2 z 3/);
 });
 for(const language of ['cs','en'])test('unresolved exchange transactions are listed read-only with film, phase and reason in '+language,async()=>{
  const en=language==='en',recovery=[{id:'tx1',journal:'tx1.json',phase:'installed',reason:'needs-inspection',title:reviewItem.title,itemId:reviewItem.id},{id:'tx2.json',journal:'tx2.json',phase:'unknown',reason:'unreadable',title:null,itemId:null}];
  const f=await appFixture(language,{itemsData:{items:[reviewItem],recovery},routes:{['/api/items/'+reviewItem.id+'/review-session']:{data:{snapshot:reviewItem.snapshot,revision:0,requirements:{hdr:false},complete:false,session:{method:'review',device:'',step:0,scope:{originalIndex:1,reviewIndex:2,seconds:10},checks:{},note:'',deferred:false}}},['/api/items/'+reviewItem.id+'/audio-compare']:{data:{original:[],review:[]}}}}),dom=f.document,box=dom.getElementById('transactions');
  assert.equal(box.hidden,false);
  assert.match(box.textContent,en?/Unfinished exchanges need manual inspection \(2\)/:/Nedokončené výměny vyžadují ruční kontrolu \(2\)/);
  assert.match(box.textContent,en?/Phase: Result installed/:/Fáze: Výsledek nainstalován/);
  assert.match(box.textContent,en?/cannot be proven safe to restore automatically/:/nelze prokazatelně vrátit automaticky/);
  assert.match(box.textContent,en?/Film cannot be identified.*Phase: Unknown phase.*cannot be read or verified/:/Film nelze určit.*Fáze: Neznámá fáze.*nelze přečíst ani ověřit/);
  assert.match(box.textContent,en?/Exchange record: tx1\.json/:/Záznam výměny: tx1\.json/);
  assert.match(box.textContent,/OPERATIONS\.md/);
  const buttons=box.querySelectorAll('button');assert.equal(buttons.length,1,'only navigation, no action on the transaction');
  await buttons[0].emit('click');for(let i=0;i<4;i++)await flush();
  assert.equal(dom.getElementById('filmDetail').open,true);
  assert.equal(f.calls.filter(c=>c.method==='POST'&&!c.route.endsWith('/audio-compare')).length,0,'nothing is written');
 });
 test('no unresolved exchange transaction keeps the panel hidden',async()=>{
  const f=await appFixture('cs',{itemsData:{items:[reviewItem],recovery:[]}});assert.equal(f.document.getElementById('transactions').hidden,true);
 });
 for(const language of ['cs','en'])test('changed files open a verification step instead of a review in '+language,async()=>{
  const en=language==='en',reason='Změnil se jen čas změny metadat souboru (ctime). Shodu obsahu nelze prokázat: ověř soubory a posuď film znovu od začátku.';
  for(const [recheck,canRecheck] of [['verify',true],[null,false]]){
   const item={...reviewItem,status:'blocked',identityChanged:true,recheck,canRecheck,reason};
   const f=await appFixture(language,{itemsData:{items:[item]},routes:{['/api/items/'+item.id+'/recheck']:{data:{ok:true,item:{...reviewItem}}}}}),dom=f.document;
   const inspect=dom.querySelectorAll('button').find(n=>n.getAttribute('aria-label')===(en?'Review Fixture film':'Posoudit Fixture film'));await inspect.emit('click');for(let i=0;i<4;i++)await flush();
   const body=dom.getElementById('detailBody');
   assert.match(body.textContent,en?/The files changed since the film was queued/:/Soubory se od zařazení změnily/);
   assert.match(body.textContent,en?/Only the file's metadata change time/:/Změnil se jen čas změny metadat/);
   assert.equal(f.calls.some(c=>c.route.includes('/review-session')),false,'no review is loaded for changed files');
   assert.equal(body.querySelectorAll('[data-check]').length,0);
   const verify=body.querySelectorAll('button').find(n=>/Ověřit soubory a začít nové posouzení|Verify the files and start a new review/.test(n.textContent));
   if(recheck==='verify'){
    assert.ok(verify);assert.equal(verify.disabled,false);await verify.emit('click');for(let i=0;i<4;i++)await flush();
    assert.deepEqual(f.calls.filter(c=>c.method==='POST').map(c=>c.route),['/api/items/'+item.id+'/recheck']);
   }else{
    assert.equal(verify,undefined);assert.match(body.textContent,en?/cannot be verified automatically/:/nelze ověřit automaticky/);
    assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
   }
  }
 });
 for(const language of ['cs','en'])test('the film strip switches films without losing a draft or carrying checks over in '+language,async()=>{
  const en=language==='en',second={...reviewItem,id:'c'.repeat(24),snapshot:'d'.repeat(64),title:'Second film'};
  const blank=item=>({version:1,snapshot:item.snapshot,revision:1,requirements:{hdr:false},complete:false,observations:{},session:{method:'review',device:'',step:0,scope:{originalIndex:1,reviewIndex:2,seconds:10},checks:Object.fromEntries(['preparation','image','audio','syncStart','syncMiddle','syncEnd'].map(key=>[key,false])),note:'',deferred:false}});
  const routes={};for(const item of [reviewItem,second]){routes['/api/items/'+item.id+'/review-session']={data:blank(item)};routes['/api/items/'+item.id+'/audio-compare']={data:{original:[],review:[]}}}
  const f=await appFixture(language,{itemsData:{items:[reviewItem,second],reviewSessions:{[reviewItem.id]:blank(reviewItem),[second.id]:blank(second)}},routes}),dom=f.document,settle=async()=>{for(let i=0;i<6;i++)await flush()};
  const inspect=dom.querySelectorAll('button').find(n=>n.getAttribute('aria-label')===(en?'Review Fixture film':'Posoudit Fixture film'));await inspect.emit('click');await settle();
  const strip=dom.getElementById('filmStrip'),entry=id=>strip.querySelector('[data-film="'+id+'"]'),check=()=>dom.getElementById('detailBody').querySelector('[data-check="preparation"]');
  assert.equal(strip.hidden,false);assert.equal(strip.querySelectorAll('.film-strip-item').length,2);assert.equal(entry(reviewItem.id).getAttribute('aria-current'),'true');
  const box=check();box.checked=true;await box.emit('change');
  await entry(second.id).emit('click');await settle();
  assert.equal(dom.getElementById('detailTitle').textContent,'Second film');assert.equal(entry(second.id).getAttribute('aria-current'),'true');
  assert.equal(check().checked,false,'checks never carry over to another film');
  assert.match(entry(reviewItem.id).textContent,en?/Unsaved changes|Draft/:/Rozpracované změny/);
  await entry(reviewItem.id).emit('click');await settle();
  assert.equal(dom.getElementById('detailTitle').textContent,'Fixture film');assert.equal(check().checked,true,'the draft comes back');
  entry(reviewItem.id).onkeydown({key:'ArrowRight',preventDefault(){}});assert.equal(dom.activeElement?.dataset?.film,second.id,'arrow keys move along the strip');
  assert.equal(f.calls.filter(c=>c.method==='POST'&&!c.route.endsWith('/audio-compare')).length,0,'switching saves nothing');
 });
 for(const language of ['cs','en'])test('the checks panel and focus mode toggle the layout only, with focus moved deliberately, in '+language,async()=>{
  const en=language==='en',checks=Object.fromEntries(['preparation','image','audio','syncStart','syncMiddle','syncEnd'].map(key=>[key,false]));
  const record={version:1,snapshot:reviewItem.snapshot,revision:2,requirements:{hdr:false},complete:false,observations:{},session:{method:'external',device:'TV',step:1,scope:{originalIndex:1,reviewIndex:2,seconds:10},checks:{...checks,preparation:true},note:'Draft note',deferred:false}};
  const f=await appFixture(language,{itemsData:{items:[reviewItem],reviewSessions:{[reviewItem.id]:record}},routes:{['/api/items/'+reviewItem.id+'/review-session']:{data:record},['/api/items/'+reviewItem.id+'/audio-compare']:{data:{original:[],review:[]}}}}),dom=f.document;
  const inspect=dom.querySelectorAll('button').find(n=>n.getAttribute('aria-label')===(en?'Review Fixture film':'Posoudit Fixture film'));await inspect.emit('click');for(let i=0;i<6;i++)await flush();
  const root=dom.querySelector('.review-workflow'),panel=dom.querySelector('.workflow-panel'),toggle=dom.querySelector('[data-panel-toggle]'),focus=dom.querySelector('[data-focus-toggle]');
  assert.ok(panel.querySelector('[data-check]'),'checks are in the panel');assert.ok(panel.querySelector('textarea'),'the note is in the panel');assert.ok(panel.querySelector('.workflow-actions'),'decisions are in the panel');
  assert.equal(toggle.getAttribute('aria-controls'),panel.id);assert.equal(toggle.textContent,en?'Checks and decision':'Kontroly a rozhodnutí');
  assert.deepEqual([root.dataset.panel,root.dataset.focus,toggle.getAttribute('aria-expanded'),focus.getAttribute('aria-pressed')],['open','off','true','false']);
  const before=JSON.stringify([...dom.querySelectorAll('[data-check]')].map(n=>n.checked))+panel.querySelector('textarea').value;
  await toggle.emit('click');assert.deepEqual([root.dataset.panel,toggle.getAttribute('aria-expanded')],['closed','false']);assert.equal(dom.activeElement,toggle,'closing returns focus to the toggle');
  await toggle.emit('click');assert.equal(root.dataset.panel,'open');assert.ok(panel.contains(dom.activeElement),'opening moves focus into the panel');
  await focus.emit('click');assert.deepEqual([root.dataset.focus,focus.getAttribute('aria-pressed'),toggle.getAttribute('aria-expanded')],['on','true','false']);
  await focus.emit('click');assert.deepEqual([root.dataset.focus,toggle.getAttribute('aria-expanded')],['off','true']);
  assert.equal(JSON.stringify([...dom.querySelectorAll('[data-check]')].map(n=>n.checked))+panel.querySelector('textarea').value,before,'toggles keep checks and the note');
  assert.equal(f.calls.filter(c=>c.method==='POST'&&!c.route.endsWith('/audio-compare')).length,0,'toggles write nothing');
 });
 for(const language of ['cs','en'])test('external review does not prepare browser clips and keeps picture confirmation explicit in '+language,async()=>{
  const en=language==='en',checks=Object.fromEntries(['preparation','image','audio','syncStart','syncMiddle','syncEnd'].map(key=>[key,false]));
  const record={version:1,snapshot:reviewItem.snapshot,revision:2,requirements:{hdr:false},complete:false,observations:{},session:{method:'external',device:'TV',step:1,scope:{originalIndex:1,reviewIndex:2,seconds:10},checks:{...checks,preparation:true},note:'Keep this note',deferred:false}};
  const f=await appFixture(language,{itemsData:{items:[reviewItem],reviewSessions:{[reviewItem.id]:record}},routes:{['/api/items/'+reviewItem.id+'/review-session']:{data:record},['/api/items/'+reviewItem.id+'/audio-compare']:{data:{original:[{index:1,label:'1: cze · dts · 6 kan. · '}],review:[{index:2,label:'2: cze · dts · 6 kan. · '}]}}}}),dom=f.document;
  await dom.querySelectorAll('button').find(n=>n.getAttribute('aria-label')===(en?'Review Fixture film':'Posoudit Fixture film')).emit('click');for(let i=0;i<30;i++)await flush();
  assert.equal(dom.querySelectorAll('button').some(n=>/Compare video and audio|Porovnat video a zvuk/.test(n.textContent)),false,'external review has no browser preview control');
  assert.deepEqual(f.calls.filter(c=>c.route.endsWith('/audio-compare')).map(c=>c.body?.mode),['tracks'],'external review reads tracks only');
  const image=dom.querySelector('[data-check="image"]');assert.ok(image);assert.equal(image.checked,false,'opening external review does not confirm picture');
  assert.equal(f.calls.filter(c=>c.method==='POST'&&!c.route.endsWith('/audio-compare')).length,0,'opening review does not save review-session observations');
  image.checked=true;await image.emit('change');assert.equal(f.calls.filter(c=>c.method==='POST'&&!c.route.endsWith('/audio-compare')).length,0,'checking a box remains a draft');
  await dom.querySelectorAll('button').find(n=>n.textContent===(en?'Save and continue':'Uložit a pokračovat')).emit('click');for(let i=0;i<8;i++)await flush();
  const writes=f.calls.filter(c=>c.method==='POST'&&c.route.endsWith('/review-session'));assert.equal(writes.length,1);assert.equal(writes[0].body.session.checks.image,true,'only explicit save records the manual check');
  assert.equal(f.calls.filter(c=>c.method==='POST'&&/approve|approval/.test(c.route)).length,0,'nothing is approved');
 }); for(const language of ['cs','en'])test('the decision step separates approve only from approve and replace in '+language,async()=>{
  const en=language==='en',checks=Object.fromEntries(['preparation','image','audio','syncStart','syncMiddle','syncEnd'].map(key=>[key,true]));
  const record={version:1,snapshot:reviewItem.snapshot,revision:3,requirements:{hdr:false},complete:true,observations:{},session:{method:'review',device:'',step:4,scope:{originalIndex:1,reviewIndex:2,seconds:10},checks,note:'',deferred:false}};
  const f=await appFixture(language,{itemsData:{items:[reviewItem],reviewSessions:{[reviewItem.id]:record},approvals:{}},routes:{['/api/items/'+reviewItem.id+'/review-session']:{data:record},['/api/items/'+reviewItem.id+'/audio-compare']:{data:{original:[],review:[]}},['/api/items/'+reviewItem.id+'/approval']:{data:{ok:true,approval:{reviewRevision:3}}}}}),dom=f.document;
  const inspect=dom.querySelectorAll('button').find(n=>n.getAttribute('aria-label')===(en?'Review Fixture film':'Posoudit Fixture film'));await inspect.emit('click');for(let i=0;i<6;i++)await flush();
  const only=dom.querySelector('[data-workflow-approve-only]'),replace=dom.querySelector('[data-workflow-approve]');
  assert.ok(only&&replace);assert.equal(only.textContent,en?'Approve':'Schválit');assert.match(replace.textContent,en?/Approve and replace/:/Schválit a nahradit/);
  assert.equal(only.disabled,false);
  await replace.emit('click');assert.equal(dom.getElementById('confirm').open,true);await dom.getElementById('confirm').close('cancel');for(let i=0;i<4;i++)await flush();
  assert.equal(f.calls.filter(c=>c.method==='POST'&&!c.route.endsWith('/audio-compare')).length,0,'cancelling the replacement dialog records nothing');
  await only.emit('click');for(let i=0;i<6;i++)await flush();
  const writes=f.calls.filter(c=>c.method==='POST'&&!c.route.endsWith('/audio-compare'));
  assert.deepEqual(writes.map(c=>[c.route,c.body]),[['/api/items/'+reviewItem.id+'/approval',{snapshot:reviewItem.snapshot,reviewRevision:3}]]);
  assert.equal(dom.getElementById('filmDetail').open,false,'approve only returns to the overview');
 });
 test('while a replacement runs, another film keeps its review controls and the film in the operation is locked',async()=>{
  const second={...reviewItem,id:'c'.repeat(24),snapshot:'d'.repeat(64),title:'Second film'};
  const blank=item=>({version:1,snapshot:item.snapshot,revision:1,requirements:{hdr:false},complete:false,observations:{},session:{method:'review',device:'',step:0,scope:{originalIndex:1,reviewIndex:2,seconds:10},checks:Object.fromEntries(['preparation','image','audio','syncStart','syncMiddle','syncEnd'].map(key=>[key,false])),note:'',deferred:false}});
  const routes={};for(const item of [reviewItem,second]){routes['/api/items/'+item.id+'/review-session']={data:blank(item)};routes['/api/items/'+item.id+'/audio-compare']={data:{original:[],review:[]}}}
  const f=await appFixture('cs',{itemsData:{items:[reviewItem,second],active:{id:reviewItem.id,title:reviewItem.title,action:'approve',stage:'Kopíruji',started:Date.now()},restorePending:1,reviewSessions:{[reviewItem.id]:blank(reviewItem),[second.id]:blank(second)}},routes}),dom=f.document,settle=async()=>{for(let i=0;i<6;i++)await flush()};
  const open=async title=>{if(dom.getElementById('filmDetail').open)await dom.getElementById('filmDetail').close();await dom.querySelectorAll('button').find(n=>n.getAttribute('aria-label')==='Posoudit '+title).emit('click');await settle();return dom.getElementById('detailBody').querySelector('[data-check="preparation"]')};
  assert.equal((await open('Second film')).disabled,false,'another film stays reviewable');
  assert.equal(await open('Fixture film'),null,'the film being replaced shows no checklist');assert.match(dom.getElementById('detailBody').textContent,/Tento film se právě nahrazuje nebo čeká v dávce/);
  assert.equal(f.calls.filter(c=>c.method==='POST'&&!c.route.endsWith('/audio-compare')).length,0);
 });
 for(const language of ['cs','en'])test('Needs attention shows the server reason, location and only the server-listed actions, recommended first, in '+language,async()=>{
  const id='d'.repeat(24),itemId='e'.repeat(24),runtime={present:true,version:1,mode:'repair',state:'running',reason:null};
  const attention={reason:'awaiting-review',recommended:'openReview',recoveryPolledAt:new Date().toISOString(),blockers:['transcode-retry-unavailable'],
   location:{library:{status:'verified',detail:'present'},quarantine:{status:'verified',detail:'present'},review:{status:'verified',detail:'pending'},tdarr:{status:'unverified',detail:'transcode success',by:'recovery'},radarr:{status:'not-used'}},
   actions:[{id:'refresh',changes:'information'},{id:'openRadarr',changes:'nothing',href:'http://radarr.invalid/movie/x'},{id:'openReview',changes:'nothing',itemId}]};
  const record={id,source:'recovery',title:'Synthetic attention film',phase:'replacement_imported',tdarrStatus:'Transcode success',canRestore:false,statusUpdated:new Date().toISOString(),radarrMovieUrl:'http://radarr.invalid/movie/x',attention};
  const f=await appFixture(language,{routes:{'/api/recovery/refresh':{data:{requests:[record],recoveryConfig:null,recoveryRuntime:runtime}}}}),dom=f.document;
  await f.update({requests:[record],recoveryRuntime:runtime});
  await f.hash('#recovery?filter=attention');
  const card=dom.getElementById('recoveryList');
  assert.deepEqual(card.querySelectorAll('[data-attention-action]').map(n=>n.dataset.attentionAction),['openReview'],'the card shows the recommended action only');
  assert.match(card.textContent,language==='en'?/Opens the assessment; approval is a separate step/:/Otevře posouzení; schválení je samostatný krok/);
  await dom.querySelectorAll('button').find(n=>/Synthetic attention film/.test(n.getAttribute('aria-label')||'')).emit('click');for(let i=0;i<6;i++)await flush();
  const body=dom.getElementById('detailBody');
  assert.deepEqual(body.querySelectorAll('[data-attention-action]').map(n=>n.dataset.attentionAction),['openReview','refresh','openRadarr'],'recommended first, then the other listed actions; nothing else');
  assert.equal(body.querySelector('[data-attention-action="restore"]'),null);
  assert.match(body.textContent,language==='en'?/Where the film is now/:/Kde je film teď/);
  assert.match(body.textContent,language==='en'?/The file is in place · verified/:/Soubor je na místě · ověřeno/);
  assert.match(body.textContent,language==='en'?/Transcode finished · not verified/:/Převod dokončen · neověřeno/);
  assert.match(body.textContent,language==='en'?/Review does not offer another transcode yet/:/Opakovaný převod Review zatím nenabízí/);
  assert.equal(body.querySelector('[data-attention-action="openRadarr"]').href,'http://radarr.invalid/movie/x');
  const before=f.calls.length;await body.querySelector('[data-attention-action="refresh"]').emit('click');for(let i=0;i<8;i++)await flush();
  const sent=f.calls.slice(before).find(c=>c.route==='/api/recovery/refresh');assert.equal(sent.method,'POST');assert.deepEqual(sent.body,{keys:['recovery:'+id]});
  assert.equal(f.calls.slice(before).some(c=>c.method==='POST'&&c.route!=='/api/recovery/refresh'),false,'refresh only reads');
 });
 for(const language of ['cs','en'])test('an installed result is assessed in the case detail with the disclosure, a saved complete assessment and its own confirmation in '+language,async()=>{
  const id='f'.repeat(24),runtime={present:true,version:1,mode:'repair',state:'running',reason:null},snapshot='s'.repeat(64);
  const attention={reason:'awaiting-review',recommended:'assessInstalled',blockers:['restore-over-installed'],location:{library:{status:'verified',detail:'changed'}},actions:[{id:'refresh',changes:'information'},{id:'assessInstalled',changes:'nothing'}]};
  const record={id,source:'recovery',title:'Synthetic installed film',phase:'replacement_imported',tdarrStatus:'Transcode success',canRestore:true,statusUpdated:new Date().toISOString(),attention};
  const complete={image:true,audio:true,syncStart:true,syncMiddle:true,syncEnd:true,hdr:true};
  const routes={['/api/recovery/cases/'+id+'/installed']:({body})=>({data:{eligible:true,blockers:[],snapshot,requirements:{hdr:true},draft:body?{...body,complete:Object.values(body.checks).every(Boolean)&&!!body.device.trim()&&!!body.note.trim()}:null}}),
   ['/api/recovery/cases/'+id+'/installed/approve']:{data:{ok:true,approvedAt:new Date().toISOString()}}};
  const f=await appFixture(language,{routes}),dom=f.document;
  await f.update({requests:[record],recoveryRuntime:runtime});await f.hash('#recovery?filter=attention');
  assert.deepEqual(dom.getElementById('recoveryList').querySelectorAll('[data-attention-action]').map(n=>n.dataset.attentionAction),['assessInstalled']);
  await dom.getElementById('recoveryList').querySelector('[data-attention-action="assessInstalled"]').emit('click');for(let i=0;i<8;i++)await flush();
  const body=dom.getElementById('detailBody');
  assert.equal(dom.getElementById('filmDetail').open,true);
  assert.match(body.textContent,language==='en'?/You are assessing only the copy that is in the library now/:/Posuzuješ jen kopii, která je teď v knihovně/);
  assert.match(body.textContent,language==='en'?/does not prove that the transcode is faithful to the original/:/nedokazuje, že převod je věrný originálu/);
  assert.match(body.textContent,language==='en'?/Opening or playing it confirms nothing/:/Otevření ani přehrání nic nepotvrzuje/);
  assert.equal(body.querySelector('[data-attention-action="restore"]'),null,'restore is never offered over the installed copy');
  const approve=()=>body.querySelector('[data-installed="approve"]');
  assert.equal(approve().disabled,true,'approval needs a saved complete assessment');
  assert.deepEqual(body.querySelectorAll('input[type=checkbox]').map(n=>n.dataset.check),['image','audio','syncStart','syncMiddle','syncEnd','hdr'],'HDR asks for its own confirmation');
  assert.equal(body.querySelectorAll('input[type=checkbox]').some(n=>n.checked),false,'opening the assessment ticks nothing');
  dom.getElementById('installedDevice').value='Living room TV';for(const box of body.querySelectorAll('input[type=checkbox]'))box.checked=true;dom.getElementById('installedNote').value='Watched start, middle and end.';
  await body.querySelector('[data-installed="save"]').emit('click');for(let i=0;i<8;i++)await flush();
  const saved=f.calls.find(c=>c.method==='POST'&&c.route==='/api/recovery/cases/'+id+'/installed');assert.deepEqual(saved.body,{snapshot,device:'Living room TV',note:'Watched start, middle and end.',checks:complete});
  assert.equal(approve().disabled,false);
  dom.getElementById('installedNote').value='Changed';await dom.getElementById('installedNote').emit('input');assert.equal(approve().disabled,true,'an unsaved edit disables approval');
  dom.getElementById('installedNote').value='Watched start, middle and end.';await dom.getElementById('installedNote').emit('input');assert.equal(approve().disabled,false);
  await approve().emit('click');
  assert.equal(dom.getElementById('confirm').open,true);assert.match(dom.getElementById('dialogText').textContent,language==='en'?/without comparing it with the original/:/bez porovnání s originálem/);
  assert.equal(f.calls.some(c=>c.route.endsWith('/installed/approve')),false,'opening the dialog changes nothing');
  dom.getElementById('confirm').returnValue='confirm';await dom.getElementById('confirm').close();for(let i=0;i<8;i++)await flush();
  assert.deepEqual(f.calls.filter(c=>c.route.endsWith('/installed/approve')).map(c=>c.body),[{snapshot,confirm:true}]);
 });
 for(const language of ['cs','en'])for(const uncertain of [false,true])test('a replacement that did not reach Tdarr is handed over only after its own confirmation'+(uncertain?', acknowledging the unconfirmed previous handoff,':'')+' in '+language,async()=>{
  const id='c'.repeat(24),runtime={present:true,version:1,mode:'repair',state:'running',reason:null},snapshot='h'.repeat(64);
  const attention={reason:'tdarr-missing',recommended:'handoffTdarr',blockers:[],location:{library:{status:'verified',detail:'present'}},actions:[{id:'refresh',changes:'information'},{id:'handoffTdarr',changes:'starts-work',...(uncertain?{uncertain:true}:{})}]};
  const record={id,source:'recovery',title:'Synthetic handoff film',phase:'replacement_imported',tdarrMissing:true,statusUpdated:new Date().toISOString(),attention};
  const f=await appFixture(language,{routes:{['/api/recovery/cases/'+id+'/handoff']:({body})=>body?{data:{ok:true,state:'Queued'}}:{data:{eligible:true,blockers:[],uncertain,snapshot}}}}),dom=f.document;
  await f.update({requests:[record],recoveryRuntime:runtime});await f.hash('#recovery?filter=attention');
  const card=dom.getElementById('recoveryList');
  assert.match(card.textContent,language==='en'?/The replacement did not reach Tdarr/:/Náhrada se do Tdarru nedostala/);
  assert.match(card.textContent,language==='en'?/Tdarr rescans the file and queues it by its own rules; nothing in the library moves/:/Tdarr soubor znovu naskenuje a zařadí ho podle svých pravidel; v knihovně se nic nepřesouvá/);
  await card.querySelector('[data-attention-action="handoffTdarr"]').emit('click');for(let i=0;i<8;i++)await flush();
  assert.equal(dom.getElementById('confirm').open,true);
  const text=dom.getElementById('dialogText').textContent;
  assert.match(text,language==='en'?/the quarantine is kept, and the transcoded result will still need approval/:/karanténa zůstává zachovaná a převedený výsledek bude potřeba schválit/);
  if(uncertain){assert.match(text,language==='en'?/you checked Tdarr/:/jsi Tdarr zkontroloval/);assert.equal(dom.getElementById('commit').textContent,language==='en'?'I checked Tdarr, hand over again':'Zkontroloval jsem Tdarr, předat znovu');}
  assert.equal(f.calls.some(c=>c.method==='POST'&&c.route.endsWith('/handoff')),false,'opening the dialog changes nothing');
  dom.getElementById('confirm').returnValue='confirm';await dom.getElementById('confirm').close();for(let i=0;i<8;i++)await flush();
  assert.deepEqual(f.calls.filter(c=>c.method==='POST'&&c.route.endsWith('/handoff')).map(c=>c.body),[uncertain?{snapshot,confirm:true,acknowledgeUncertain:true}:{snapshot,confirm:true}]);
 });
 test('a cancelled handoff dialog writes nothing',async()=>{
  const id='c'.repeat(24),runtime={present:true,version:1,mode:'repair',state:'running',reason:null};
  const record={id,source:'recovery',title:'Synthetic handoff film',phase:'replacement_imported',tdarrMissing:true,statusUpdated:new Date().toISOString(),attention:{reason:'tdarr-missing',recommended:'handoffTdarr',blockers:[],location:{},actions:[{id:'refresh',changes:'information'},{id:'handoffTdarr',changes:'starts-work'}]}};
  const f=await appFixture('en',{routes:{['/api/recovery/cases/'+id+'/handoff']:{data:{eligible:true,blockers:[],uncertain:false,snapshot:'h'.repeat(64)}}}}),dom=f.document;
  await f.update({requests:[record],recoveryRuntime:runtime});await f.hash('#recovery?filter=attention');
  await dom.getElementById('recoveryList').querySelector('[data-attention-action="handoffTdarr"]').emit('click');for(let i=0;i<8;i++)await flush();
  dom.getElementById('confirm').returnValue='cancel';await dom.getElementById('confirm').close();for(let i=0;i<8;i++)await flush();
  assert.equal(f.calls.some(c=>c.method==='POST'&&c.route.endsWith('/handoff')),false);
 });
 test('Verify the status of all cases asks the server for a read-only refresh of the whole queue',async()=>{
  const runtime={present:true,version:1,mode:'repair',state:'running',reason:null};
  const f=await appFixture('en',{routes:{'/api/recovery/refresh':{data:{requests:[],recoveryConfig:null,recoveryRuntime:runtime}}}}),dom=f.document;
  await f.hash('#recovery?filter=attention');const before=f.calls.length;
  await dom.getElementById('recoveryVerifyAll').emit('click');for(let i=0;i<8;i++)await flush();
  const sent=f.calls.slice(before).filter(c=>c.method==='POST');assert.deepEqual(sent.map(c=>[c.route,c.body]),[['/api/recovery/refresh',{}]]);
  assert.equal(dom.getElementById('recoveryVerifyAll').textContent,'Verify the status of all cases');
 });
 test('a confirmed binding-failure case offers the manual Radarr replacement only with the server offer and a reason',async()=>{
  const id='c'.repeat(24),record={id,source:'recovery',title:'Vadný film',phase:'manual',bindingFailure:'grab-missing',sourceConfirmed:true,canRestore:false,statusUpdated:new Date().toISOString()};
  const f=await appFixture('cs',{routes:{['/api/recovery/cases/'+id+'/replace-source']:{status:202,data:{ok:true}}}}),dom=f.document;
  await f.update({requests:[{...record,sourceReplacementBlocked:'Originál se od potvrzení vady změnil.'}],recoveryRuntime:{present:true,version:1,mode:'repair',state:'running',reason:null}});
  await f.hash('#recovery?filter=attention');
  await dom.querySelectorAll('button').find(n=>n.getAttribute('aria-label')==='Prohlédnout obnovu Vadný film').emit('click');for(let i=0;i<6;i++)await flush();
  await dom.getElementById('detailTabs-recovery').emit('click');for(let i=0;i<4;i++)await flush();
  assert.equal(dom.querySelector('[data-cap="replaceSource"]'),null,'no offer, no action');assert.match(dom.getElementById('detailBody').textContent,/Originál se od potvrzení vady změnil/);
  dom.getElementById('filmDetail').close();
  await f.update({requests:[{...record,sourceReplacement:{snapshot:'s'.repeat(64)}}],recoveryRuntime:{present:true,version:1,mode:'repair',state:'running',reason:null}});
  await f.hash('#recovery?filter=attention');
  await dom.querySelectorAll('button').find(n=>n.getAttribute('aria-label')==='Prohlédnout obnovu Vadný film').emit('click');for(let i=0;i<6;i++)await flush();
  assert.match(dom.getElementById('detailBody').textContent,/vyžádat přes Radarr na kartě Obnova/);
  await dom.getElementById('detailTabs-recovery').emit('click');for(let i=0;i<4;i++)await flush();
  const offer=dom.querySelector('[data-cap="replaceSource"]');assert.equal(offer.disabled,false);
  await offer.emit('click');assert.equal(dom.getElementById('confirm').open,true);assert.equal(dom.getElementById('rejectReasonBox').hidden,false,'a reason is required');
  assert.equal(f.calls.some(c=>c.route.includes('replace-source')),false,'opening the dialog changes nothing');
  dom.getElementById('rejectReason').value='Potvrzená vada';dom.getElementById('confirm').returnValue='confirm';await dom.getElementById('confirm').close();for(let i=0;i<8;i++)await flush();
  const sent=f.calls.find(c=>c.route==='/api/recovery/cases/'+id+'/replace-source');assert.deepEqual(sent.body,{snapshot:'s'.repeat(64),reason:'Potvrzená vada'});
 });
 test('during another replacement a confirmed replacement says it will be queued; interrupted queue entries are listed',async()=>{
  const checks=Object.fromEntries(['preparation','image','audio','syncStart','syncMiddle','syncEnd'].map(key=>[key,true]));
  const done={version:1,snapshot:reviewItem.snapshot,revision:3,requirements:{hdr:false},complete:true,observations:{},session:{method:'review',device:'',step:4,scope:{originalIndex:1,reviewIndex:2,seconds:10},checks,note:'',deferred:false}};
  const f=await appFixture('cs',{itemsData:{items:[reviewItem],reviewSessions:{[reviewItem.id]:done},active:{id:'f'.repeat(24),title:'Jiný film',action:'approve',stage:'Kopíruji',started:Date.now()},restorePending:1,queueInterrupted:[{id:'e'.repeat(24),title:'Přerušený film',queuedAt:'2026-10-18T10:00:00Z',interruptedAt:'2026-10-18T11:00:00Z'}]},routes:{['/api/items/'+reviewItem.id+'/review-session']:{data:done},['/api/items/'+reviewItem.id+'/audio-compare']:{data:{original:[],review:[]}}}}),dom=f.document;
  const box=dom.getElementById('queueInterrupted');assert.equal(box.hidden,false);assert.match(box.textContent,/Restart přerušil čekající nahrazení.*Přerušený film/);
  await dom.querySelectorAll('button').find(n=>n.getAttribute('aria-label')==='Posoudit Fixture film').emit('click');for(let i=0;i<6;i++)await flush();
  const replace=dom.querySelector('[data-workflow-approve]');assert.equal(replace.disabled,false,'approve and replace stays available');
  await replace.emit('click');assert.equal(dom.getElementById('confirm').open,true);assert.match(dom.getElementById('dialogText').textContent,/zařadí do fronty/);
 });
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
