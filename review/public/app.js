import {mountAVComparison} from '/av-player.js?v=20261012-av1';
import {mountReviewWorkflow} from '/review-workflow.js?v=20261012-workflow1';
import {capabilities, classifyRecovery, recoveryProgress, downloadProgress, liveRecoveryRecord, projectRequests, historyWarnings, historyFollowup, quarantineLifecycle, recoveryFollowup} from '/review-model.js?v=20261012-recovery3';
import {tr,locale,initializeLocale,translateAudioTrackLabel as audioTrackLabel} from '/i18n.js?v=20261012-en1';
initializeLocale();

const $=id=>document.getElementById(id);
const el=(tag,cls,text,raw=false)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=raw?text:tr(text);return n};
const fmt=n=>Number.isFinite(n)?(n/2**30).toLocaleString(locale,{maximumFractionDigits:1})+' GiB':'Nedoloženo';
const date=n=>n&&Number.isFinite(new Date(n).getTime())?new Date(n).toLocaleString(locale):'Čas není doložen';
const elapsedText=n=>{n=Math.max(0,Math.floor(n));return [Math.floor(n/3600),Math.floor(n%3600/60),n%60].map(x=>String(x).padStart(2,'0')).join(':')};
const etaText=n=>n<60?'méně než minuta':Math.ceil(n/60)<60?`asi ${Math.ceil(n/60)} min`:`asi ${Math.floor(n/3600)} h ${Math.ceil(n%3600/60)} min`;
const busy=d=>!!d?.active||!!d?.batchRunning;
let latest=null,pending=null,loading=false,lastRender='',receivedAt=0,serverAt=Date.now();
let authenticated=false,actionInFlight=false,requests=[],requestsReceived=0,requestsLoading=false,requestsError='',dataError='',confirmOrigin=null;
const selected=new Set();
const ui={view:'attention',filter:'running',tab:'review',detail:null,selection:false,layout:'work',historyPage:0};
let reviewWorkspace=null;
try{ui.layout=localStorage.getItem('tdarr-review-layout')==='gallery'?'gallery':'work'}catch{}
const context=()=>({authenticated,fresh:!!receivedAt&&!dataError&&Date.now()-receivedAt<15000,requests,requestsFresh:!!requestsReceived&&!requestsError&&Date.now()-requestsReceived<90000,settingsBusy:actionInFlight});
const caps=item=>capabilities(item,latest||{items:[],recovery:[]},context());

async function api(route,body){
 if(body!==undefined){
  const preview=/^\/api\/items\/([a-f0-9]{24})\/(frames|audio-compare)$/.exec(route);
  if(preview){const item=latest?.items.find(x=>x.id===preview[1]);if(!item||item.snapshot!==body.snapshot||!caps(item)[preview[2]==='frames'?'compareImage':'compareAudio'])throw Error('Porovnání nyní není dostupné. Obnov údaje a ověř stav filmu.');}
  if(/^\/api\/(settings|radarr\/settings)(\/test)?$/.test(route)&&capabilities({},latest,context()).writeBlocked)throw Error('Nastavení nyní nelze měnit. Ověř přihlášení, aktuální údaje a probíhající operace.');
 }
 const r=await fetch(route,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 let d;try{d=await r.json()}catch{throw Error('Server nevrátil platnou odpověď. Obnov údaje a ověř výsledek akce.')}
 if(r.status===401){authenticated=false;$('login').hidden=false;$('workspace').hidden=!latest;updateGuards();throw Error(d.error||'Přihlášení vypršelo. Poslední načtené údaje nejsou aktuální.')}
 if(!r.ok)throw Object.assign(Error(d.error||'Požadavek selhal.'),{status:r.status,data:d});
 return d;
}
function error(e){$('error').textContent=tr(e.message);$('error').hidden=false;const active=[...document.querySelectorAll('dialog[open]')].at(-1);if(active){let alert=active.querySelector('.dialog-error');if(!alert){alert=el('p','alert dialog-error');alert.setAttribute('role','alert');active.prepend(alert)}alert.textContent=tr(e.message);alert.tabIndex=-1;alert.focus();}}
async function login(key){await api('/api/login',{key});$('key').value='';authenticated=true;$('login').hidden=true;$('error').hidden=true;await load();await loadRequests(true)}
$('loginForm').addEventListener('submit',e=>{e.preventDefault();login($('key').value.trim()).catch(error)});
$('refresh').addEventListener('click',()=>{$('error').hidden=true;load();loadRequests(true);if(ui.view==='savings')loadStatistics()});

function writeItem(item,action){
 const current=latest?.items.find(x=>x.id===item.id);
 if(!current||current.snapshot!==item.snapshot)throw Error('Soubory nebo položka se změnily. Zavři detail, obnov údaje a posuď aktuální výsledek.');
 if(!caps(current)[action])throw Error(caps(current).reason||'Tato akce nyní není dostupná. Obnov údaje.');
 return current;
}
function confirmSetup(label,title,text,commit,reason=false){
 confirmOrigin=document.activeElement;
 $('rejectReasonBox').hidden=!reason;$('rejectReason').required=reason;$('rejectReason').setCustomValidity(tr(''));
 $('confirm').returnValue='';$('dialogLabel').textContent=tr(label);$('dialogTitle').textContent=pending?.action==='batch'?tr(title):title;$('dialogText').textContent=tr(text);$('commit').textContent=tr(commit);$('commit').disabled=false;
}
const drafts=new Map();
try{const saved=JSON.parse(sessionStorage.getItem('tdarr-review-language-drafts')||'[]');if(Array.isArray(saved))for(const [key,value]of saved)if(typeof key==='string'&&/^[a-f0-9]{24}:(reject|replace)$/.test(key)&&typeof value==='string'&&value.length<=1000)drafts.set(key,value);sessionStorage.removeItem('tdarr-review-language-drafts')}catch{}
document.addEventListener('review-language-change',()=>{try{sessionStorage.setItem('tdarr-review-language-drafts',JSON.stringify([...drafts]))}catch{}});
function ask(item,action){
 try{writeItem(item,action)}catch(e){error(e);return}
 const approve=action==='approve';
 let text=approve?`Po ověření identity souborů a kontrolního součtu kopie se původní film (${fmt(item.originalBytes)}) nahradí výsledkem (${fmt(item.reviewBytes)}). Původní verze bude odstraněna. Plex bude používat nový soubor. Health check z Tdarru se neopakuje. Akce může trvat několik minut.`:'Odstraní se pouze překódovaný soubor z review. Originál v knihovně médií zůstane zachovaný.';
 pending={item,action};if(approve)pending.reviewRevision=latest?.reviewSessions?.[item.id]?.revision;
 if(approve&&item.canApproveDuration){pending.acceptDuration=true;text+=` Výslovně přijímáš rozdíl délky: originál ${item.durationA.toFixed(3)} s, výstup ${item.durationB.toFixed(3)} s, rozdíl ${(item.durationB-item.durationA).toFixed(3)} s. Potvrď pouze po kontrole začátku, konce a synchronizace zvuku.`}
 confirmSetup(approve?'SCHVÁLENÍ VÝSLEDKU':'ZAMÍTNUTÍ VÝSLEDKU',item.title,text,approve?(pending.acceptDuration?'Přijmout rozdíl a nahradit originál':'Schválit a nahradit'):'Zamítnout a odstranit',!approve);
 $('rejectReason').value=drafts.get(item.id+':'+action)||'';$('confirm').showModal();
}
function askReplacement(item){
 try{writeItem(item,'replace')}catch(e){error(e);return}
 pending={item,action:'replace'};
 confirmSetup('NÁHRADA PŘES RADARR',item.title,'Originál i tento převod se zachovají v karanténě a dočasně zmizí z knihovny. Radarr dostane vlastní profil se stejnou nebo vyšší kvalitou a zákazem původního vydání. České + anglické audio se upřednostní, pokud jsou jazyky ve vydání správně označené; dostupnost obou není zaručená. Po importu novou kopii zpracuje Tdarr. Uveď vlastní důvod; jde o tvé rozhodnutí, nikoli automatický důkaz poškození originálu.','Zachovat v karanténě a hledat náhradu',true);
 $('rejectReason').value=drafts.get(item.id+':replace')||'';$('confirm').showModal();
}
function askRestore(record){
 if(!caps(record).restore){error(Error(caps(record).reason||'Obnovení není dostupné.'));return}
 pending={record,action:'restore'};confirmSetup('OBNOVENÍ Z KARANTÉNY',record.title,'Vrátit originál i převod z karantény? Radarr nesmí mít aktivní stažení ani novou importovanou kopii. Server znovu ověří identitu souborů a stav Radarru.','Vrátit zachované kopie');$('confirm').showModal();
}
$('rejectReason').addEventListener('input',()=>{$('rejectReason').setCustomValidity(tr(''));if(pending?.item)drafts.set(pending.item.id+':'+pending.action,$('rejectReason').value)});
$('commit').addEventListener('click',e=>{if(['reject','replace'].includes(pending?.action)&&!$('rejectReason').value.trim()){e.preventDefault();$('rejectReason').setCustomValidity(tr('Uveď důvod rozhodnutí.'));$('rejectReason').reportValidity();}});
$('confirm').addEventListener('cancel',()=>{$('confirm').returnValue='cancel'});
$('confirm').addEventListener('close',async()=>{
 const request=pending,confirmed=$('confirm').returnValue==='confirm',reason=$('rejectReason').value.trim();pending=null;$('confirm').returnValue='';if(!confirmed||!request){if(confirmOrigin?.isConnected&&!confirmOrigin.disabled)confirmOrigin.focus({preventScroll:true});else if($('filmDetail').open)$('detailClose').focus();return;}
 try{
  if(actionInFlight)throw Error('Počkej na výsledek předchozího požadavku.');
  if(request.action==='batch')for(const item of request.items)writeItem(item,'approveBatch');
  else if(request.action==='restore'){const current=requests.find(r=>r.id===request.record.id&&r.source===request.record.source);if(!current||!caps(current).restore)throw Error('Stav obnovy se změnil. Obnov údaje.');}
  else writeItem(request.item,request.action);
  if(request.action==='approve'&&latest?.reviewSessions?.[request.item.id]?.revision!==request.reviewRevision)throw Error('Posouzení se od otevření potvrzení změnilo. Znovu ověř uložené kontroly.');
  if(request.action==='batch'&&request.items.some(item=>latest?.reviewSessions?.[item.id]?.revision!==request.reviewRevisions[item.id]))throw Error('Posouzení vybraných filmů se změnilo. Znovu ověř uložené kontroly.');
  actionInFlight=true;updateGuards();
  if(request.action==='batch'){await api('/api/approve-batch',{items:request.items.map(x=>({id:x.id,snapshot:x.snapshot,reviewRevision:request.reviewRevisions[x.id]}))});selected.clear()}
  else if(request.action==='restore')await api('/api/radarr/requests/'+request.record.id+'/restore',{confirm:true});
  else await api(`/api/items/${request.item.id}/${request.action}`,{snapshot:request.item.snapshot,reviewRevision:request.action==='approve'?request.reviewRevision:undefined,acceptDuration:request.acceptDuration===true,reason:['reject','replace'].includes(request.action)?reason:undefined});
  if(request.item)drafts.delete(request.item.id+':'+request.action);
  $('filmDetail').close();lastRender='';await load();await loadRequests(true);
 }catch(e){error(e)}finally{actionInFlight=false;updateGuards()}
});

function filteredItems(){const query=$('reviewSearch').value.trim().toLocaleLowerCase();return (latest?.items||[]).filter(x=>x.title.toLocaleLowerCase().includes(query))}
function updateSelection(){
 const eligible=filteredItems().filter(x=>caps(x).select),all=eligible.length>0&&eligible.every(x=>selected.has(x.id));
 $('selectAll').disabled=!eligible.length;$('selectAll').checked=all;$('selectAll').indeterminate=!all&&eligible.some(x=>selected.has(x.id));
 $('approveSelected').textContent=tr(`Schválit vybrané (${selected.size})`);
 $('approveSelected').disabled=!selected.size||[...selected].some(id=>!caps(latest?.items.find(x=>x.id===id)||{}).approveBatch);
 $('selectedSaving').textContent=tr(selected.size?`Možná úspora ${fmt((latest?.items||[]).filter(x=>selected.has(x.id)).reduce((s,x)=>s+x.originalBytes-x.reviewBytes,0))}`:'');
 $('bulk').hidden=!ui.selection;
 $('selectionToggle').setAttribute('aria-expanded',String(ui.selection));$('selectionToggle').setAttribute('aria-label',tr(ui.selection?'Ukončit výběr filmů':'Vybrat více filmů'));$('selectionToggle').textContent=tr(ui.selection?'Výběr zapnutý':'Vybrat více');
 for(const row of $('list').children){const checkbox=row.querySelector('input[type=checkbox]');if(checkbox){checkbox.checked=selected.has(row.dataset.key);checkbox.disabled=!caps(latest.items.find(x=>x.id===row.dataset.key)||{}).select;checkbox.closest('label').hidden=!ui.selection;}}
}
$('selectionToggle').onclick=()=>{ui.selection=!ui.selection;if(!ui.selection)selected.clear();updateSelection()};
$('selectionCancel').onclick=()=>{ui.selection=false;selected.clear();updateSelection();$('selectionToggle').focus()};
$('selectAll').onchange=e=>{for(const item of filteredItems().filter(x=>caps(x).select)){e.target.checked?selected.add(item.id):selected.delete(item.id)}updateSelection()};
$('approveSelected').onclick=()=>{
 const items=(latest?.items||[]).filter(x=>selected.has(x.id));if(!items.length||items.some(x=>!caps(x).approveBatch))return;
 pending={action:'batch',items,reviewRevisions:Object.fromEntries(items.map(item=>[item.id,latest?.reviewSessions?.[item.id]?.revision]))};confirmSetup('HROMADNÉ SCHVÁLENÍ',`Schválit ${items.length} filmů?`,`Vybrané filmy: ${items.map(x=>x.title).join('; ')}. Postupně se ověří identita souborů a kontrolní součet kopie, pak se nahradí originály. Původní verze budou odstraněny. Health check z Tdarru se neopakuje. Možná úspora ${fmt(items.reduce((s,x)=>s+x.originalBytes-x.reviewBytes,0))}. Dávka běží na serveru i po zavření stránky. Při chybě jednoho filmu zachová jeho soubory a pokračuje dalším.`,`Schválit ${items.length} filmů`);$('confirm').showModal();
};

function poster(kind,id,title){
 const box=el('div','poster'),fallback=el('span','poster-fallback','▣'),img=el('img');fallback.setAttribute('aria-hidden','true');img.alt=tr('');img.width=96;img.height=144;img.loading='lazy';img.decoding='async';img.src=`/api/artwork/${kind}/${encodeURIComponent(id)}`;
 img.onerror=()=>{img.hidden=true;box.classList.add('missing')};box.append(fallback,img);return box;
}
function button(text,fn,cls='secondary'){const b=el('button',cls,text);b.type='button';b.onclick=fn;return b}
function badge(text,kind=''){return el('span','badge '+kind,text)}
function keyed(container,records,keyOf,build){
 const old=new Map([...container.children].map(n=>[n.dataset.key,n])),focus=document.activeElement?.closest('[data-focus]')?.dataset.focus;
 let cursor=container.firstElementChild;
 for(const data of records){const key=keyOf(data),sig=JSON.stringify(data);let row=old.get(key);old.delete(key);if(!row||row.dataset.signature!==sig){const fresh=build(data);fresh.dataset.key=key;fresh.dataset.signature=sig;if(row){if(cursor===row)cursor=fresh;row.replaceWith(fresh)}row=fresh}if(row!==cursor)container.insertBefore(row,cursor);cursor=row.nextElementSibling;}
 for(const row of old.values())row.remove();
 if(focus&&document.activeElement===document.body){const replacement=[...container.querySelectorAll('[data-focus]')].find(n=>n.dataset.focus===focus);replacement?.focus({preventScroll:true})}
}
function reviewRow(item){
 const row=el('article','review-row'),pick=el('label','selection'),checkbox=el('input');checkbox.type='checkbox';checkbox.setAttribute('aria-label',tr('Vybrat '+item.title));checkbox.dataset.focus='pick:'+item.id;checkbox.onchange=e=>{e.target.checked?selected.add(item.id):selected.delete(item.id);updateSelection()};pick.append(checkbox);
 const session=latest?.reviewSessions?.[item.id],deferred=session?.snapshot===item.snapshot&&session.session?.deferred;
 const info=el('div','row-info');info.append(badge(deferred?'Posouzení odloženo':item.status==='ready'?'K posouzení':'Zvláštní kontrola',deferred?'warning':item.status==='ready'?'ready':'warning'),el('h2','',item.title,true),el('p','details',deferred?session.session.note:item.status==='ready'?'Další krok: porovnej obraz a zvuk.':item.reason||'Ověř technické údaje a dostupnost souborů.'));
 const metric=el('div','row-metric');metric.append(el('strong','saved',fmt(item.originalBytes-item.reviewBytes)),el('span','details',`${fmt(item.originalBytes)} → ${fmt(item.reviewBytes)}`));
 const inspect=button('Posoudit',()=>openDetail('review',item.id),'primary');inspect.dataset.focus='inspect:'+item.id;inspect.setAttribute('aria-label',tr('Posoudit '+item.title));row.append(pick,poster('review',item.id,item.title),info,metric,inspect);return row;
}
function renderAttention(){
 const items=filteredItems();$('readyCount').textContent=tr((latest?.items||[]).filter(x=>x.status==='ready').length);$('blockedCount').textContent=tr((latest?.items||[]).filter(x=>x.status!=='ready').length);
 $('saving').textContent=tr(fmt((latest?.items||[]).filter(x=>x.status==='ready').reduce((s,x)=>s+x.originalBytes-x.reviewBytes,0)));
 $('list').classList.toggle('gallery',ui.layout==='gallery');keyed($('list'),items.map(item=>({...item,reviewSession:latest?.reviewSessions?.[item.id]})),x=>x.id,reviewRow);$('reviewEmpty').hidden=!!items.length;$('reviewEmpty').textContent=tr(latest?.items.length?'Tomuto hledání neodpovídá žádný výsledek.':'Všechny výsledky jsou vyřízené. Nové se objeví automaticky po dokončení převodu.');
 for(const radio of document.querySelectorAll('input[name=layout]'))radio.checked=radio.value===ui.layout;
 const warnings=historyWarnings(latest?.history||[]),attention=projectRequests(requests,latest?.items||[],Date.now()).filter(x=>x.classification.category==='attention');
 $('events').hidden=!warnings.length&&!attention.length;
 const events=[];if(warnings.length)events.push({kind:'history',count:warnings.length});if(attention.length)events.push({kind:'recovery',count:attention.length});
 keyed($('events'),events,x=>x.kind,x=>{const row=el('div'),b=button(x.kind==='history'?'Historie':'Obnovy',()=>navigate(x.kind,{filter:x.kind==='history'?'warning':'attention'}));b.dataset.focus='event:'+x.kind;row.append(el('span','',x.kind==='history'?`${x.count} upozornění v historii`:`${x.count} obnov k ověření`),b);return row});
 updateSelection();
}
function makeTabs(container,tabs,current,onChange){
 const oldFocus=document.activeElement?.id;container.replaceChildren();
 for(const [id,label] of tabs){const b=button(label,()=>onChange(id));b.id=container.id+'-'+id;b.setAttribute('role','tab');b.setAttribute('aria-selected',String(id===current));b.setAttribute('aria-controls',container.id==='detailTabs'?'detailBody':'recoveryPanel');b.tabIndex=id===current?0:-1;
  b.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const i=tabs.findIndex(x=>x[0]===id),next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;onChange(tabs[next][0]);$(container.id+'-'+tabs[next][0])?.focus()};container.append(b)}
 if(oldFocus&&oldFocus.startsWith(container.id+'-'))$(oldFocus)?.focus({preventScroll:true});
}
function recoveryRow(projected){
 const r=projected.record||projected.raw||projected,cl=projected.classification||classifyRecovery(r,Date.now()),row=el('article','recovery-row'),info=el('div','row-info');
 info.append(badge(cl.label,cl.category==='attention'?'warning':cl.category==='done'?'ready':''),el('h2','',r.title,true),el('p','details',cl.nextStep));
 const progress=recoveryProgress(r);if(progress)info.append(decodeProgressView(progress,false));for(const download of downloadProgress(r).slice(0,1))info.append(downloadProgressView(download,false));
 const meta=el('div','row-metric');meta.append(el('span','details',r.source==='recovery'?'Recovery · Radarr · Tdarr':'Náhrada přes Radarr'),el('small',cl.stale?'failure':'details',cl.stale?'Stav starší než 12 minut':date(r.statusUpdated||r.updated)));
 const b=button('Prohlédnout',()=>openDetail('request',projected.key));b.setAttribute('aria-label',tr('Prohlédnout obnovu '+r.title));b.dataset.focus='recovery:'+projected.key;
 row.append(poster('request',r.id,r.title),info,meta,b);return row;
}
function downloadProgressView(p,detail=true){
 const box=el('div','decode-progress');box.append(el('strong','',p.label));if(detail&&p.title)box.append(el('p','details',p.title,true));
 if(p.downloadPercent!==null){const meter=el('progress','task-meter');meter.max=100;meter.value=p.downloadPercent;meter.setAttribute('aria-label',tr('Průběh stažení souboru'));box.append(meter,detailsFacts([['Stažení souboru',p.downloadPercent.toLocaleString(locale,{maximumFractionDigits:1})+' %']]));}
 if(p.eta)box.append(detailsFacts([['Zbývající čas stažení',p.eta]]));
 if(detail){box.append(el('p','details','Procenta označují pouze stažení. Import, převod a schválení jsou samostatné kroky.'));if(p.error)box.append(el('p','failure',p.error));}return box;
}
function decodeProgressView(p,detail=true){
 const box=el('div','decode-progress'),meter=el('progress','task-meter');meter.max=100;meter.setAttribute('aria-label',tr(`Kontrola originálu, průchod ${p.pass} ze 2`));if(p.percent!==null)meter.value=p.percent;
 box.append(el('strong','',`Kontrola originálu · průchod ${p.pass}/2${p.percent===null?'':` · ${p.percent.toLocaleString(locale,{maximumFractionDigits:1})} %`}`),meter);
 const position=p.seconds===null?'Čeká na měření':`Zkontrolováno ${elapsedText(p.seconds)}${p.duration===null?'':` z ${elapsedText(p.duration)}`}`;
 box.append(el('p','details',`${position} · ${p.etaSeconds===null?'Odhad času zatím není dostupný':'Zbývá '+etaText(p.etaSeconds)}`));
 if(detail){box.append(el('p','details',`${p.elapsedSeconds===null?'':`Tento průchod běží ${elapsedText(p.elapsedSeconds)} · `}${p.speed===null?'':'Rychlost '+p.speed.toLocaleString(locale,{maximumFractionDigits:2})+'×'}`),el('p','details',p.note),detailsFacts([['Poslední měření dekodéru',date(p.measuredAt)],['Poslední odezva Recovery',date(p.heartbeatAt)]]));}
 return box;
}
function renderRecovery(){
 const projects=projectRequests(requests,latest?.items||[],Date.now()),categories=[['running','Probíhá'],['waiting','Čeká'],['attention','Vyžaduje zásah'],['unverified','Stav nelze ověřit'],['done','Dokončeno']];
 makeTabs($('recoveryFilters'),categories.map(([key,title])=>[key,`${title} (${projects.filter(p=>p.classification.category===key).length})`]),ui.filter,id=>navigate('recovery',{filter:id}));
 $('recoveryPanel').setAttribute('aria-labelledby','recoveryFilters-'+ui.filter);
 const query=$('recoverySearch').value.trim().toLocaleLowerCase(),visible=projects.filter(p=>p.classification.category===ui.filter&&(p.record||p.raw||p).title.toLocaleLowerCase().includes(query));
 $('recoveryError').hidden=!requestsError;$('recoveryError').textContent=tr(requestsError?'Stav obnov není dostupný. Poslední údaje zůstávají zobrazené: '+requestsError:'');
 $('recoverySummary').textContent=tr(`${visible.length} případů · poslední načtení ${requestsReceived?date(requestsReceived):'dosud nepotvrzeno'}`);
 keyed($('recoveryList'),visible,p=>p.key,recoveryRow);if(!visible.length)$('recoveryList').replaceChildren(el('p','empty',requestsReceived?'V tomto výběru není žádná obnova.':'Načítám případy obnovy…'));
}
function historyRow(h){
 const row=el('article','event-row'),heading=el('div','event-heading');heading.append(el('h2','',h.title,true),el('time','details',date(h.time)));row.append(heading);
 let result=h.status==='error'?(h.fixedIn?`Dřívější chyba · opraveno ve verzi ${h.fixedIn}`:'Akce tehdy selhala: '+(h.message||'Důvod není doložen')):h.action==='approve'?'Nahrazeno · logická úspora '+fmt(h.savedBytes):h.action==='replace'?'Žádost o náhradu předaná; kopie v karanténě':'Review kopie odstraněna';
 const followup=h.status==='error'?historyFollowup(h,latest?.history||[]):null;
 row.append(el('p',h.status==='error'&&!h.fixedIn?'failure':'success',result));if(followup)row.append(el('p','details','Pozdější úspěšné rozhodnutí pro stejnou položku: '+date(followup.time)));if(h.warning)row.append(el('p','alert inline-warning',h.warning));
 if(h.rejectionReason)row.append(el('p','details','Důvod: '+h.rejectionReason));
 const tech=el('details','help');tech.append(el('summary','','Technické údaje události'));for(const key of ['message','jobId','transactionId','fixedIn'])if(h[key])tech.append(el('p','details',key+': '+h[key]));row.append(tech);return row;
}
function renderHistory(){
 const query=$('historySearch').value.trim().toLocaleLowerCase(),filter=$('historyFilter').value,records=(latest?.history||[]).filter(h=>h.title?.toLocaleLowerCase().includes(query)&&(filter==='all'||(filter==='warning'?(h.warning||h.status==='error'&&!h.fixedIn):h.action===filter)));
 const pages=Math.max(1,Math.ceil(records.length/12));ui.historyPage=Math.min(ui.historyPage,pages-1);keyed($('history'),records.slice(ui.historyPage*12,ui.historyPage*12+12),h=>[h.id,h.action,h.time].join(':'),historyRow);if(!records.length)$('history').replaceChildren(el('p','empty','Žádné události v tomto výběru.'));
 $('historyPage').textContent=tr(`Strana ${ui.historyPage+1} z ${pages} · ${records.length} událostí`);$('historyPrev').disabled=ui.historyPage===0;$('historyNext').disabled=ui.historyPage===pages-1;
 const b=latest?.batch;$('batchArchive').hidden=!b||b.status==='running';if(b&&b.status!=='running')$('batchArchive').replaceChildren(el('strong','',b.status==='complete'?'Poslední dávka dokončena':'Poslední dávka přerušena'),el('p','details',`${b.finished} z ${b.total} · chyby: ${b.failed}${b.message?' · '+b.message:''}`));
}
function detailsFacts(facts){const dl=el('dl','facts');for(const [key,value,raw=false]of facts){dl.append(el('dt','',key),el('dd','',value,raw))}return dl}
function guardedButton(item,cap,text,fn,cls='secondary'){const b=button(text,()=>{if(!caps(item)[cap]){error(Error(caps(item).reason||'Akce není dostupná.'));return}fn()},cls);b.dataset.cap=cap;b.disabled=!caps(item)[cap];return b}

function detailReview(item,tab){
 const box=$('detailBody');
 if(tab==='review'){
  if(reviewWorkspace)return;
  reviewWorkspace=mountReviewWorkflow(box,item,{api,tr,formatBytes:fmt,openComparison,openAudioComparison,
   canWrite:()=>{const current=latest?.items.find(x=>x.id===item.id);return !!current&&current.snapshot===item.snapshot&&!caps(current).writeBlocked},
   canApprove:()=>{const current=latest?.items.find(x=>x.id===item.id);return !!current&&current.snapshot===item.snapshot&&caps(current).approve},
   onSession:record=>{if(!latest)return;latest.reviewSessions||={};latest.reviewSessions[item.id]=record;updateGuards()},
   onApprove:()=>ask(item,'approve'),onReject:()=>ask(item,'reject'),onDeferred:()=>{$('filmDetail').close();renderAttention()}});return;
 }
 box.replaceChildren();
 if(tab==='overview'){
  box.append(el('h3','','Výsledek čeká na posouzení'),el('p','',item.reason),detailsFacts([['Originál',fmt(item.originalBytes)],['Výsledek',fmt(item.reviewBytes)],['Možná úspora',fmt(item.originalBytes-item.reviewBytes)],['Obraz',item.videoSummary||'Nedoloženo'],['Zvuk',`${(item.audio||[]).join(', ')||'Nedoloženo'} · ${(item.audio||[]).length} stop`],['Titulky',String((item.subtitles||[]).length)]]),el('p','details','Technické kontroly podporují rozhodnutí. Kvalitu komprese a soulad řeči s obrazem ověř při přehrávání.'));
  const b=button('Přejít k posouzení',()=>changeDetailTab('review'));box.append(b);
 }else if(tab==='comparison'){
  box.append(el('h3','','Originál a výsledek ve stejném čase'),el('p','','Otevři pár snímků a potom porovnej odpovídající zvukové stopy. Celý výsledek můžeš přehrát po stažení.'));
  const pair=el('div','comparison-options');pair.append(guardedButton(item,'compareImage','Porovnat obraz',()=>openComparison(item)),guardedButton(item,'compareAudio','Porovnat zvuk',()=>openAudioComparison(item)));
  const link=el('a','secondary download','Stáhnout výsledek');link.href=`/api/items/${item.id}/video`;link.title=tr('Review MKV pro místní přehrávač');link.onclick=e=>{if(!caps(item).download)e.preventDefault()};pair.append(link);box.append(pair,detailsFacts([['Délka originálu',Number.isFinite(item.durationA)?item.durationA.toFixed(3)+' s':'Nedoloženo'],['Délka výsledku',Number.isFinite(item.durationB)?item.durationB.toFixed(3)+' s':'Nedoloženo'],['Rozdíl délky',Number.isFinite(item.durationA)&&Number.isFinite(item.durationB)?(item.durationB-item.durationA).toFixed(3)+' s':'Nedoloženo']]),el('p','details','Statické snímky nejsou zkouškou plynulosti a věrnost HDR posuď také na TV. Zvukové grafy ukazují hlasitost a odhad posunu; nerozhodují o kvalitě nebo synchronizaci rtů.'));
 }else if(tab==='recovery'){
  const linked=requests.filter(r=>r.itemId===item.id);
  box.append(el('h3','','Když převod nevyhovuje'),el('p','','Zamítnutí odstraní pouze review kopii. Pokud potřebuješ jiné vydání, podej samostatnou žádost Radarru; obě kopie se nejprve zachovají v karanténě.'));
  box.append(guardedButton(item,'replace','Požádat Radarr o jinou kopii',()=>askReplacement(item)));
  for(const r of linked){const key=(r.source||'radarr')+':'+r.id;box.append(el('p','details',r.message),button('Prohlédnout související obnovu',()=>openDetail('request',key)))}
  box.append(button('Prohlédnout karanténu',()=>openQuarantine(item.title)));
 }else{
  box.append(el('h3','','Doložené kontroly'));
  if(item.assessment){const x=item.assessment;box.append(el('p','',`Technická shoda ${x.score}/${x.maximum} bodů · ${x.verdict}`),el('p','details',x.note));for(const marker of x.markers||[]){const row=el('div','check-row');row.append(badge(marker.status==='pass'?'Doloženo':marker.status==='fail'?'Odchylka':'Neověřeno',marker.status==='pass'?'ready':'warning'),el('strong','',marker.label),el('p','details',marker.detail));box.append(row)}}
  const paths=el('details','help');paths.append(el('summary','','Identita a cesty souborů'),detailsFacts([['Review ID',item.id,true],['Úloha Tdarr',item.jobId||tr('Nedoloženo'),true],['Originál',item.relative||tr('Nedoloženo'),true],['Výsledek',item.reviewRelative||tr('Nedoloženo'),true],['Snapshot',item.snapshot||tr('Chybí'),true]]));box.append(paths,el('p','details','Před zápisem server znovu ověří snapshot a soubory. Health check z Tdarru se při schválení neopakuje.'));
  if(item.canRecheck)box.append(guardedButton(item,'recheck','Znovu ověřit soubory',async()=>{try{writeItem(item,'recheck');actionInFlight=true;updateGuards();await api(`/api/items/${item.id}/recheck`,{snapshot:item.snapshot});lastRender='';await load()}catch(e){error(e)}finally{actionInFlight=false;updateGuards()}}));
 }
}
function detailRequest(r,tab){
 const box=$('detailBody'),cl=classifyRecovery(r,Date.now());box.replaceChildren();
 if(tab==='overview'){box.append(el('h3','',cl.label),el('p','',cl.nextStep));for(const warning of cl.warnings||[])box.append(el('p','alert inline-warning',warning));const progress=recoveryProgress(r);if(progress)box.append(decodeProgressView(progress));box.append(detailsFacts([['Poslední potvrzený stav',date(r.statusUpdated||r.updated)],['Původní kopie',r.quarantineRetained?'Zachovaná v karanténě':r.sourceRetained||r.phase==='waiting_source_kept'?'Zůstává v Plexu; vydání vyloučeno z převodů':'Viz aktuální protokol obnovy'],['Další hledání',r.nextSearchAt?date(r.nextSearchAt):'Termín není doložen'],['Další pokus obnovy',r.nextRetryAt?date(r.nextRetryAt):'Termín není doložen']]));if(r.message)box.append(el('p','details',r.message));
  if(r.legacyReplacementBinding===true)box.append(el('p','details','Stav Tdarru je dohledán podle přesné historické cesty náhrady. Tato vazba nepotvrzuje schválení filmu ani neopravňuje k úklidu karantény.'));
  if(r.error==='Approved replacement metadata timestamp changed; content identity is not reverified; quarantine preserved')box.append(el('p','details','Změnil se pouze čas změny metadat schválené kopie. Není to potvrzené poškození filmu. Karanténa zůstává zachovaná, protože chybí nový důkaz shody obsahu; další převod ani stažení nejsou tímto hlášením vyžádány.'));
  const next=recoveryFollowup(r,requests);
  if(next){
   if(r.replacementFollowupBinding==='ctime_changed')box.append(el('p','details','Změnil se čas změny metadat náhrady. Navazující případ používá vlastní aktuální identitu a důkazy; historická schválení se nepřenášejí.'));
   box.append(el('h4','','Navazující kontrola náhrady'),detailsFacts([['Stav náhrady ověřen',date(next.statusUpdated)],['Další pokus obnovy náhrady',next.nextRetryAt?date(next.nextRetryAt):'Termín není doložen'],['Další hledání náhrady',next.nextSearchAt?date(next.nextSearchAt):'Termín není doložen']]),button('Otevřít navazující případ',()=>openDetail('request','recovery:'+next.id)));
   const nextProgress=recoveryProgress(next);if(nextProgress)box.append(decodeProgressView(nextProgress));
  }
 }else if(tab==='comparison'){
  const item=latest?.items.find(x=>x.id===r.itemId);box.append(el('h3','','Ověření nové kopie'));
  if(item)box.append(el('p','','Výsledek je v Review a má přesně přiřazené ID.'),button('Posoudit výsledek v Review',()=>openDetail('review',item.id)));
  else box.append(el('p','','Pro tento případ zatím není doložený přiřazený výsledek v Review. Dokončené stažení ani převod nejsou schválením.'));
  if(r.replacement)box.append(detailsFacts([['Nové vydání',r.replacement.title||tr('Nedoloženo'),true],['Kvalita',r.replacement.quality||tr('Nedoloženo'),true],['Jazyky',r.replacement.languages?.join(', ')||tr('Nedoloženo'),true]]));
 }else if(tab==='recovery'){
  box.append(el('h3','','Průběh obnovy'),recoveryDetails(r));
  const progress=recoveryProgress(r);if(progress)box.append(decodeProgressView(progress));
  if(r.canRestore)box.append(guardedButton(r,'restore','Vrátit originál i převod z karantény',()=>askRestore(r)));
  box.append(button('Prohlédnout karanténu případu',()=>openQuarantine(r.title,r.id)));
 }else{
  box.append(el('h3','','Technické údaje obnovy'),detailsFacts([['ID případu',r.id,true],['Zdroj',r.source||'Radarr',true],['Fáze',r.phase||tr('Neznámá'),true],['Tdarr',r.tdarrStatus||tr('Stav není doložen'),true],['Důvod',r.reason||tr('Nedoloženo'),true],['Vyřazené vydání',r.edition||tr('Neuvedeno'),true],['Nové vydání',r.replacementTitle||r.replacement?.title||tr('Nedoloženo'),true]]));if(r.error)box.append(el('p','failure',r.error));
 }
}
function changeDetailTab(tab){ui.tab=tab;const params={tab};params[ui.detail.kind==='review'?'film':'case']=ui.detail.id;navigate(ui.view,params);renderDetailTab();$('detailTabs-'+tab)?.focus({preventScroll:true})}
function renderDetailTab(){if(!ui.detail)return;const reviewing=ui.detail.kind==='review';if(!reviewing||ui.tab!=='review'){reviewWorkspace?.destroy();reviewWorkspace=null}const tabs=reviewing?[['review','Posouzení'],['overview','Podklady a metadata'],['recovery','Obnova'],['technical','Technické údaje']]:[['overview','Přehled'],['comparison','Porovnání'],['recovery','Obnova'],['technical','Technické údaje']];makeTabs($('detailTabs'),tabs,ui.tab,changeDetailTab);$('filmDetail').classList.toggle('reviewing',reviewing&&ui.tab==='review');$('detailBody').setAttribute('aria-labelledby','detailTabs-'+ui.tab);reviewing?detailReview(ui.detail.record,ui.tab):detailRequest(ui.detail.record,ui.tab);updateGuards()}
function openDetail(kind,id,fromHash=false){
 const projected=kind==='request'?projectRequests(requests,latest?.items||[],Date.now()).find(p=>p.key===id):null;
 let record=kind==='review'?latest?.items.find(x=>x.id===id):requests.find(r=>r.id===projected?.id&&r.source===projected?.source);
 if(!record)return;
 if(ui.detail?.kind===kind&&ui.detail.id===id){renderDetailTab();return}
 reviewWorkspace?.destroy();reviewWorkspace=null;if(!fromHash||!parseHash().params.has('tab'))ui.tab=kind==='review'?'review':'overview';if(kind==='review'&&ui.tab==='comparison')ui.tab='review';if(kind==='request'&&ui.tab==='review')ui.tab='overview';
 $('filmDetail').querySelector('.dialog-error')?.remove();ui.detail={kind,id,record};$('detailTitle').textContent=record.title;$('detailLabel').textContent=tr(kind==='review'?'POSOUZENÍ VÝSLEDKU':'OBNOVA FILMU');$('detailSubtitle').textContent=tr(kind==='review'?(record.status==='ready'?'K posouzení':'Zvláštní kontrola'):classifyRecovery(record,Date.now()).label);
 $('detailPoster').replaceChildren(poster(kind,record.id,record.title));$('detailActions').replaceChildren();
 if(kind==='review')$('detailActions').append(guardedButton(record,'reject','Zamítnout',()=>ask(record,'reject'),'reject'));
 renderDetailTab();if(!$('filmDetail').open)$('filmDetail').showModal();else $('detailTabs-'+ui.tab)?.focus({preventScroll:true});if(!fromHash)navigate(ui.view,{[kind==='review'?'film':'case']:id,tab:ui.tab});
}
$('detailClose').onclick=()=>$('filmDetail').close();
$('filmDetail').addEventListener('close',()=>{reviewWorkspace?.destroy();reviewWorkspace=null;ui.detail=null;ui.tab='review';const parsed=parseHash();if(parsed.params.has('film')||parsed.params.has('case'))navigate(ui.view,ui.view==='recovery'?{filter:ui.filter}:{})});

function updateGuards(){
 if(!latest)return;const c=context();
 $('connection').textContent=tr(!authenticated?'Přihlášení vypršelo':dataError?'Spojení přerušeno':c.fresh?'Připojeno':'Čekám na aktuální údaje');$('connection').classList.toggle('failure',!authenticated||!!dataError||!c.fresh);
 $('freshness').hidden=c.fresh&&authenticated;$('freshness').textContent=tr(!authenticated?'Přihlas se znovu. Zobrazené údaje jsou poslední načtený stav; změny jsou zablokované.':`Údaje nejsou aktuální. Poslední načtení ${date(receivedAt)}. Změny jsou zablokované.${dataError?' '+dataError:''}`);
 updateSelection();
 if(ui.detail){const item=ui.detail.record,current=ui.detail.kind==='review'?latest.items.find(x=>x.id===item.id):requests.find(x=>x.id===item.id&&x.source===item.source),changed=!current||(ui.detail.kind==='review'?current.snapshot!==item.snapshot:JSON.stringify(current)!==JSON.stringify(item));
  $('detailChanged').hidden=!changed;$('detailChanged').textContent=tr('Stav tohoto filmu se změnil. Zavři detail a otevři aktuální údaje.');
  for(const b of $('filmDetail').querySelectorAll('[data-cap]'))b.disabled=changed||!caps(current||item)[b.dataset.cap];
  if(ui.detail.kind==='review'&&changed)reviewWorkspace?.invalidate();else{reviewWorkspace?.refreshGuard();if(ui.detail.kind==='review')reviewWorkspace?.observe(latest.reviewSessions?.[item.id])}
  const guard=caps(item);$('detailGuard').hidden=!guard.writeBlocked&&!changed;$('detailGuard').textContent=tr(changed?'Akce čekají na nové posouzení aktuálního stavu.':guard.reason||'Zapisující akce jsou dočasně zablokované.');
 }
 if(pending){let enabled=!actionInFlight;if(pending.action==='batch')enabled&&=pending.items.every(x=>{const current=latest.items.find(i=>i.id===x.id&&i.snapshot===x.snapshot);return current&&caps(current).approveBatch&&latest.reviewSessions?.[x.id]?.revision===pending.reviewRevisions[x.id]});else if(pending.action==='restore'){const current=requests.find(r=>r.id===pending.record.id&&r.source===pending.record.source);enabled&&=!!current&&caps(current).restore;}else{const current=latest.items.find(x=>x.id===pending.item.id&&x.snapshot===pending.item.snapshot);enabled&&=!!current&&caps(current)[pending.action]&&(pending.action!=='approve'||latest.reviewSessions?.[pending.item.id]?.revision===pending.reviewRevision)}$('commit').disabled=!enabled;}
}
function render(d){
 const priorSessions=latest?.reviewSessions||{};d.reviewSessions||={};for(const [id,record]of Object.entries(priorSessions)){const current=d.items.find(x=>x.id===id);if(current?.snapshot===record.snapshot&&record.revision>(d.reviewSessions[id]?.revision??-1))d.reviewSessions[id]=record}
 latest=d;authenticated=true;document.querySelector('.server').textContent=d.label||'Tdarr Review';$('login').hidden=true;$('workspace').hidden=false;
 for(const id of selected)if(!d.items.some(x=>x.id===id&&caps(x).select))selected.delete(id);
 $('attentionCount').textContent=tr(d.items.length);$('recoveryCount').textContent=tr(projectRequests(requests,d.items,Date.now()).filter(x=>x.classification.category!=='done').length);
 const warningCount=historyWarnings(d.history||[]).length;$('historyCount').hidden=!warningCount;$('historyCount').textContent=tr(warningCount);
 $('notice').hidden=!(d.recovery?.length||d.restorePending);$('notice').textContent=tr(d.recovery?.length?'Nedokončená výměna vyžaduje kontrolu. Další změny jsou zablokované; soubory nepřesouvej ručně.':d.restorePending?'Obnova stavu nodů v Tdarru není dokončená. Změny jsou zablokované; ověř jejich pozastavení.':'');
 renderAttention();renderRecovery();renderHistory();renderBatch();paintProgress();updateGuards();handleHash();
}
function renderBatch(){const b=latest?.batch;$('batch').hidden=!b||b.status!=='running';$('batch').replaceChildren();if(b?.status==='running'){const p=el('progress','batch-meter');p.max=b.total;p.value=b.finished;p.setAttribute('aria-label',tr('Dokončené filmy dávky'));$('batch').append(el('strong','',`Hromadné schválení · ${b.finished} z ${b.total}`),p,el('span','details',`Chyby: ${b.failed}${b.message?' · '+b.message:''}`))}}
const statsBox=$('statsContent');let statsLoading=false,statsLoaded=0;
async function loadStatistics(){
 if(statsLoading||!authenticated||$('workspace').hidden)return;statsLoading=true;
 try{const d=await api('/api/statistics');statsLoaded=Date.now();statsBox.replaceChildren();const cards=el('div','stats-cards');
  for(const [label,value,detail]of [['Doložená logická úspora',fmt(d.saved),`${d.count} souborů · průměr ${Number(d.percent).toFixed(1)} %`],['Z toho přes Review',fmt(d.reviewSaved),`${d.reviewCount} souborů · součást celkové úspory`],['Čeká na schválení',fmt(d.pendingBytes),`${d.pendingCount} výsledků · zatím neuvolněno`],['Tdarr hlásí celkem',d.reported===null?'Nedostupné':fmt(d.reported),'Všechny knihovny · může zahrnovat opakované převody']]){const card=el('div');card.append(el('span','details',label),el('strong','',value),el('small','details',detail));cards.append(card)}
  const methodology=el('details','help');methodology.append(el('summary','','Jak se úspora počítá'),el('p','details',`Porovnání aktuální velikosti souborů s dostupnou historií převodů a dokončenými protokoly Review. Každý soubor se počítá jednou. ${d.unverified} souborů nebylo možné potvrdit; smazaná historie Tdarru může v součtu chybět.`));
  statsBox.append(cards,el('p','details','Jde o logické zmenšení souborů. Volné místo na disku se tímto neměří a zachované kopie v karanténě dál zabírají místo.'),methodology,el('p','details','Poslední výpočet: '+date(d.at)));
  for(const warning of d.warnings||[])statsBox.append(el('p','alert',warning));
 }catch(e){let note=statsBox.querySelector('.stats-error');if(!note){note=el('p','alert stats-error');note.setAttribute('role','status');statsBox.prepend(note)}note.textContent=tr('Statistiky nelze aktualizovat; poslední údaje mohou být zastaralé. '+e.message);}finally{statsLoading=false}
}
setInterval(()=>{if(ui.view==='savings')loadStatistics()},15000);
async function load(){if(loading)return;loading=true;try{const d=await api('/api/items');receivedAt=Date.now();serverAt=d.serverTime||receivedAt;authenticated=true;dataError='';$('lastUpdate').textContent=tr(date(receivedAt));$('lastUpdate').dateTime=new Date(receivedAt).toISOString();const sig=JSON.stringify({...d,serverTime:undefined});if(sig!==lastRender||$('workspace').hidden||!$('login').hidden){render(d);lastRender=sig}else updateGuards()}catch(e){dataError=e.message;updateGuards();if(!latest)error(e)}finally{loading=false}}
async function loadRequests(force=false){if(requestsLoading||!authenticated||(!force&&Date.now()-requestsReceived<30000))return;requestsLoading=true;try{requests=(await api('/api/radarr/requests')).requests;requestsReceived=Date.now();requestsError='';if(latest){renderAttention();renderRecovery();$('recoveryCount').textContent=tr(projectRequests(requests,latest.items,Date.now()).filter(x=>x.classification.category!=='done').length);const live=ui.detail?.kind==='request'?liveRecoveryRecord(ui.detail.record,requests):null;if(live){ui.detail.record=live;$('detailSubtitle').textContent=tr(classifyRecovery(live).label);renderDetailTab();}updateGuards();handleHash()}}catch(e){requestsError=e.message;renderRecovery();updateGuards()}finally{requestsLoading=false}}
function parseHash(){const [view,query='']=location.hash.slice(1).split('?');return {view:['attention','recovery','history','savings','settings'].includes(view)?view:'attention',params:new URLSearchParams(query)}}
function navigate(view,params={}){if(view==='recovery'&&!params.filter)params.filter=ui.filter;const query=new URLSearchParams(params).toString(),hash='#'+view+(query?'?'+query:'');if(location.hash===hash)handleHash();else location.hash=hash}
function handleHash(){
 const {view,params}=parseHash(),oldView=ui.view,focusWasInContent=$('content').contains(document.activeElement);ui.view=view;
 for(const section of document.querySelectorAll('.view'))section.hidden=section.id!=='view-'+view;
 for(const link of document.querySelectorAll('[data-view]')){if(link.dataset.view===view)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current')}
 if(view==='recovery'){const filter=params.get('filter');if(['running','waiting','attention','unverified','done'].includes(filter)&&filter!==ui.filter){ui.filter=filter;renderRecovery()}}
 if(view==='history'&&params.get('filter')==='warning'&&$('historyFilter').value!=='warning'){$('historyFilter').value='warning';ui.historyPage=0;renderHistory()}
 if(view==='savings'&&Date.now()-statsLoaded>15000)loadStatistics();
 const tab=params.get('tab');if(['review','overview','comparison','recovery','technical'].includes(tab))ui.tab=params.has('film')&&tab==='comparison'?'review':tab;
 const kind=params.has('film')?'review':params.has('case')?'request':null,id=params.get(kind==='review'?'film':'case');
 if(kind){if(ui.detail?.kind!==kind||ui.detail.id!==id){const exists=kind==='review'?latest?.items.some(x=>x.id===id):projectRequests(requests,latest?.items||[],Date.now()).some(p=>p.key===id);if(exists)openDetail(kind,id,true);else if($('filmDetail').open)$('filmDetail').close()}else if($('detailTabs').querySelector('[aria-selected=true]')?.id!=='detailTabs-'+ui.tab)renderDetailTab()}
 else if($('filmDetail').open)$('filmDetail').close();
 if(oldView!==view&&focusWasInContent)$('content').focus({preventScroll:true});
}
addEventListener('hashchange',handleHash);
document.querySelector('.skip').addEventListener('click',e=>{e.preventDefault();$('login').hidden?$('content').focus():$('key').focus()});
$('reviewSearch').oninput=renderAttention;$('recoverySearch').oninput=renderRecovery;
for(const radio of document.querySelectorAll('input[name=layout]'))radio.onchange=()=>{ui.layout=radio.value;try{localStorage.setItem('tdarr-review-layout',ui.layout)}catch{}renderAttention()};
$('resetLayout').onclick=()=>{ui.layout='work';try{localStorage.removeItem('tdarr-review-layout')}catch{}renderAttention()};
for(const id of ['historySearch','historyFilter'])$(id).addEventListener(id==='historySearch'?'input':'change',()=>{ui.historyPage=0;renderHistory()});
$('historyPrev').onclick=()=>{ui.historyPage--;renderHistory()};$('historyNext').onclick=()=>{ui.historyPage++;renderHistory()};
$('recoveryRefresh').onclick=()=>loadRequests(true);$('recoveryQuarantine').onclick=()=>openQuarantine();$('statsRefresh').onclick=()=>loadStatistics();

async function start(){
 const params=new URLSearchParams(location.hash.slice(1)),key=params.get('key');if(key){history.replaceState(null,'',location.pathname);try{await login(key)}catch(e){error(e)}}else{await load();await loadRequests(true)}
 handleHash();setInterval(load,2000);setInterval(()=>{paintProgress();updateGuards()},1000);setInterval(()=>loadRequests(),30000);
}

function paintProgress(){
 const a=latest?.active,box=$('progress'),announcement=a?[a.title,a.phase,a.stage].join(':'):'';if($('operationStatus').dataset.phase!==announcement){$('operationStatus').dataset.phase=announcement;$('operationStatus').textContent=a?a.title+' · '+tr(a.stage):'';}box.hidden=!a;box.replaceChildren();if(!a)return;
 const now=serverAt+Date.now()-receivedAt,head=el('div','progress-head');
 head.append(el('strong','',a.title,true),el('span','step-count',`Krok ${a.step||1} ze 6`));box.append(head,el('div','stage-title',a.stage));
 const steps=el('ol','steps');['Soubory','Tdarr','Kopírování','Kontrolní součty','Výměna','Dokončení'].forEach((label,i)=>{const li=el('li',i+1<(a.step||1)?'done':i+1===(a.step||1)?'current':'',`${i+1}. ${label}`);if(i+1===(a.step||1))li.setAttribute('aria-current','step');steps.append(li)});box.append(steps);
 const meter=el('progress','task-meter');meter.max=100;meter.setAttribute('aria-label',tr('Průběh aktuálního kroku'));if(a.percent!=null)meter.value=a.percent;box.append(meter);
 const values=el('div','progress-values');values.append(el('strong','',a.percent!=null?`${a.percent.toLocaleString(locale,{maximumFractionDigits:1})} %`:'Probíhá…'));
 if(a.unit==='seconds')values.append(el('span','',`Zkontrolováno ${elapsedText(a.done)} / ${elapsedText(a.total)} filmu`));
 if(a.unit==='bytes')values.append(el('span','',`${fmt(a.done)} / ${fmt(a.total)}${a.phase==='verifying-copy'?' · obě kopie dohromady':''}`));box.append(values);
 const facts=el('div','progress-facts');facts.append(el('span','',`Film zpracovávám ${elapsedText((now-a.started)/1000)}`));
 if(a.unit==='seconds'&&a.rate)facts.append(el('span','',`Rychlost ${a.rate.toFixed(2)}× přehrávání${a.fps?` · ${Math.round(a.fps)} sn./s`:''}`));
 if(a.unit==='bytes'&&a.rate)facts.append(el('span','',`Rychlost ${(a.rate/2**20).toFixed(1)} MiB/s`));
 const stale=a.updatedAt&&now-a.updatedAt>15000;
 facts.append(el('span','',a.etaSeconds!=null&&!stale?`Do konce tohoto kroku: ${etaText(a.etaSeconds)}`:a.unit?'Odhad času: čekám na aktuální měření':'Čas tohoto kroku nelze spolehlivě odhadnout'));box.append(facts);
 const note=a.phase==='syncing-copy'?'Data byla předána disku. Čekám, až systém potvrdí jejich zápis.':a.phase==='verifying-copy'?'Čtu review i novou kopii a porovnávám SHA-256. Originál se zatím nemaže.':'';
 if(note)box.append(el('p','progress-note',note));
 box.append(el('div','heartbeat',stale?`Čekám na další údaj o průběhu · poslední před ${Math.floor((now-a.updatedAt)/1000)} s`:`Aktualizováno ${new Date(serverAt).toLocaleTimeString('cs-CZ')} · obnova každé 2 sekundy`));
}

// Optional read-only agent access; approvals remain behind the visible confirmation.
if(document.modelContext?.registerTool){
 const lifecycle=new AbortController();
 try{Promise.resolve(document.modelContext.registerTool({name:'get_review_status',title:tr('Stav schvalování filmů'),description:'Read the currently displayed review films, batch progress and recent decisions. Does not approve or reject films.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute(input){if(!input||typeof input!=='object'||Object.keys(input).length)throw new Error('Tool accepts an empty object.');if(!latest||!$('login').hidden)throw new Error('Sign in and load the review list first.');return {items:latest.items.map(({id,title,status,reason,originalBytes,reviewBytes})=>({id,title,status,reason,originalBytes,reviewBytes})),active:latest.active,batch:latest.batch||null,history:latest.history.slice(0,10)}}},{signal:lifecycle.signal})).catch(()=>{})}catch{}
 addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
}
const compareDialog=el('dialog','comparison');document.body.append(compareDialog);
let compareCleanup=null;
compareDialog.addEventListener('close',()=>{compareCleanup?.();compareCleanup=null;compareDialog.replaceChildren()});
function openComparison(item,options={}){
 const host=options.host||compareDialog;let dead=false,request=0;host.replaceChildren();
 const current=()=>!dead&&host.isConnected&&latest?.items.some(x=>x.id===item.id&&x.snapshot===item.snapshot);
 const cleanup=()=>{dead=true;request++;host.replaceChildren()};if(!options.host){compareCleanup?.();compareCleanup=cleanup}
 const heading=el('div','comparison-head'),close=el('button','secondary','Zavřít');close.onclick=()=>compareDialog.close();heading.append(el('h2','',item.title,true),close);
 const note=el('p','','Snímky ve stejném čase, PNG bez další ztrátové komprese. Porovnání je statické, bez zvuku.');
 const controls=el('form','comparison-controls'),label=el('label','','Čas ve filmu (sekundy)'),time=el('input');time.type='number';time.min='0';time.step='0.001';time.max=String(Math.max(0,Math.min(item.durationA,item.durationB)-1));time.value=String(Math.min(Number(time.max),options.scope?.seconds??Math.min(300,Math.floor(Number(time.max)/2))));label.append(time);
 const go=el('button','','Načíst oba snímky'),zoom=el('button','secondary','Zvětšení 1 : 1');zoom.type='button';
 const status=el('p','comparison-status','Vyber čas a načti snímky.');status.setAttribute('role','status');
 const pair=el('div','comparison-pair');let enlarged=false;
 zoom.onclick=()=>{enlarged=!enlarged;pair.classList.toggle('actual-size',enlarged);zoom.textContent=tr(enlarged?'Přizpůsobit šířce':'Zvětšení 1 : 1')};
 controls.append(label,go,zoom);
 const canInteract=()=>current()&&(options.canInteract?.()??true),validTime=()=>time.value.trim()!==''&&time.validity.valid&&Number.isFinite(Number(time.value))&&Number(time.value)>=0&&Number(time.value)<=Number(time.max);
 const scopeChanged=()=>{if(!canInteract())return;const valid=validTime();options.onScopeValidityChange?.(valid);if(valid)options.onScopeChange?.({...options.scope,seconds:Number(time.value)});request++;pair.replaceChildren();status.textContent=tr('Vyber čas a načti snímky.');go.dataset.previewInvalid=String(!valid);go.disabled=!valid};time.oninput=time.onchange=scopeChanged;
 const presets=el('div','comparison-controls');for(const percent of [10,30,50,70,90]){const button=el('button','secondary',percent+' % filmu');button.onclick=()=>{time.value=String(Math.floor(Number(time.max)*percent/100));scopeChanged();controls.requestSubmit()};presets.append(button)}
 for(const control of [time,go,...presets.querySelectorAll('button')])control.dataset.previewControl='';const setBusy=value=>{controls.dataset.previewBusy=String(value);for(const control of [time,go,...presets.querySelectorAll('button')]){control.dataset.previewBusy=String(value);control.disabled=value||!canInteract()||control.dataset.previewInvalid==='true'}};
 controls.onsubmit=async e=>{e.preventDefault();if(go.disabled||!canInteract()||!validTime())return;scopeChanged();const generation=++request;setBusy(true);pair.replaceChildren();status.textContent=tr('Připravuji oba snímky na serveru… Obvykle několik sekund, nejvýše dvě minuty.');
 try{await options.beforePreview?.();if(!current())return;const d=await api(`/api/items/${item.id}/frames`,{snapshot:item.snapshot,seconds:Number(time.value)});if(!current()||generation!==request)return;
 const panes=[];for(const [key,title] of [['original','Originál'],['review','Překódovaný výsledek']]){const figure=el('figure'),pane=el('div','frame-scroll'),img=el('img');img.alt=tr(title+' v čase '+elapsedText(d.seconds));img.src='data:image/png;base64,'+d[key];pane.append(img);figure.append(el('figcaption','',title),pane);pair.append(figure);panes.push(pane)}
 let sync=false;for(const [i,pane] of panes.entries())pane.onscroll=()=>{if(sync)return;sync=true;panes[1-i].scrollLeft=pane.scrollLeft;panes[1-i].scrollTop=pane.scrollTop;requestAnimationFrame(()=>{sync=false})};
 status.textContent=tr(`Čas ${elapsedText(d.seconds)} · ${d.hdr?'HDR převedeno shodně do SDR pro náhled. Věrnost HDR ověř na TV.':'Plné rozlišení snímků; detaily porovnej ve zvětšení 1 : 1.'} Stejný čas nezaručuje shodu při posunutém střihu.`);
 }catch(e){if(current()&&generation===request)status.textContent=tr(e.message)}finally{if(current()&&generation===request)setBusy(false)}};
 host.append(...(options.host?[]:[heading]),note,controls,presets,status,pair);if(!options.host){compareDialog.setAttribute('aria-label',tr('Porovnání obrazu · '+item.title));compareDialog.showModal()}if(options.autoLoad!==false)controls.requestSubmit();return cleanup;
}
const settingsDialog=el('dialog','settings-dialog');document.body.append(settingsDialog);
const settingsButton=$('settingsReview');
settingsButton.onclick=async()=>{
 try{
 const data=await api('/api/settings');settingsDialog.replaceChildren();const title=el('h2','','Nastavení Review'),form=el('form'),fields={};
 const help=el('p','','Jedna knihovna na instalaci. Cesty vlevo v Docker mapování nejsou stejné jako cesty uvnitř kontejnerů. Zde zadávej cesty dostupné uvnitř Review, u polí Tdarr cesty viditelné jeho serverem.');
 const descriptions=[['label','Název instalace','Například Domácí knihovna'],['publicOrigin','Veřejná adresa Review','Úplná adresa včetně http(s) a portu. Při změně se přepne adresa této stránky.'],['tdarrUrl','Adresa API Tdarr','Například http://tdarr:8266; musí být dostupná z kontejneru Review.'],['mediaRoot','Originály v kontejneru Review','Například /media; vyžaduje čtení a zápis.'],['reviewRoot','Výsledky v kontejneru Review','Například /review; oddělená složka s právem zápisu.'],['sourceRoots','Zdrojové cesty v Tdarru','Jedna cesta na řádek. První odpovídá knihovně, další jsou případné aliasy stejného obsahu.'],['tdarrReviewRoot','Review cesta v Tdarru','Například /pilot-review; slouží ke kontrole běžících úloh.'],['reviewPrefixes','Podsložky Review určené k odebrání z cesty','Jedno jméno na řádek, například PROD-Movies. Prázdné = stejná struktura jako originály.'],['libraryId','ID knihovny Tdarr','Prázdné = automaticky podle zdrojové cesty.'],['database','Databáze Tdarr v kontejneru Review','Připoj aktuální adresář SQL včetně WAL/SHM pouze pro čtení.'],['ffprobe','Program FFprobe','Absolutní cesta v kontejneru Review.'],['ffmpeg','Program FFmpeg','Absolutní cesta; používá se pro porovnání snímků.']];
 for(const [key,text,hint] of descriptions){const label=el('label','settings-field',text),input=el(['sourceRoots','reviewPrefixes'].includes(key)?'textarea':'input');input.value=Array.isArray(data.config[key])?data.config[key].join('\n'):data.config[key];label.append(input,el('small','',hint));form.append(label);fields[key]=input}
 const status=el('p');status.setAttribute('role','status');const actions=el('div','dialog-actions'),test=el('button','secondary','Otestovat'),save=el('button','','Ověřit a uložit'),close=el('button','secondary','Zavřít');test.type=close.type='button';close.onclick=()=>settingsDialog.close();actions.append(close,test,save);
 async function submit(onlyTest){test.disabled=save.disabled=true;status.textContent=tr('Ověřuji spojení a cesty…');try{const config={};for(const [k,input] of Object.entries(fields))config[k]=['sourceRoots','reviewPrefixes'].includes(k)?input.value.split('\n').map(x=>x.trim()).filter(Boolean):input.value.trim();const result=await api(onlyTest?'/api/settings/test':'/api/settings',{config,revision:data.revision});status.textContent=tr(onlyTest?result.message:'Nastavení uloženo. '+result.message);data.revision=result.revision;if(!onlyTest){lastRender='';if(result.publicOrigin!==location.origin){location.assign(result.publicOrigin);return}await load()}}catch(e){status.textContent=tr(e.message)}finally{test.disabled=save.disabled=false}}
 test.onclick=()=>submit(true);form.onsubmit=e=>{e.preventDefault();submit(false)};form.append(status,actions);settingsDialog.append(title,help,el('p','','Docker připojení složek, port a trvalý adresář /data se nastavují při instalaci kontejneru. Menu je samo nevytváří. Podporovaný profil: MKV, H.264 → HEVC 10bit, kopírované zvukové a titulkové stopy; HDR10, HDR10+, Dolby Vision 8.1 a zachování Dolby Vision 7/FEL podle kompatibilního profilu Review.'),form);settingsDialog.setAttribute('aria-label',tr('Nastavení Review'));settingsDialog.showModal();
 }catch(e){error(e)}
};
const audioDialog=el('dialog','comparison');document.body.append(audioDialog);let audioCleanup=null;
audioDialog.addEventListener('close',()=>{audioCleanup?.();audioCleanup=null;audioDialog.replaceChildren()});
function openAudioComparison(item,options={}){
 const host=options.host||audioDialog;let dead=false,generation=0,working=false,abPlayer=null,avCleanup=null,prepared=null,trackReady=false;host.replaceChildren();
 const current=()=>!dead&&host.isConnected&&latest?.items.some(x=>x.id===item.id&&x.snapshot===item.snapshot);
 const cleanup=()=>{dead=true;generation++;abPlayer?.close();abPlayer=null;avCleanup?.();avCleanup=null;host.replaceChildren()};if(!options.host){audioCleanup?.();audioCleanup=cleanup}
 const head=el('div','comparison-head'),close=button('Zavřít',()=>audioDialog.close());head.append(el('h2','',item.title+' — porovnání zvuku'),close);
 const note=el('p','details','Porovnej stejný jazyk i verzi zvuku (nikoli dabing s originálem nebo komentářem). Grafy ukazují hlasitost v krocích 10 ms na stejné časové ose, nikoli kvalitu zvuku. Odhad hledá posun do ±1 sekundy. Neověřuje soulad řeči s pohybem úst.');
 const form=el('form','comparison-controls'),a=el('select'),b=el('select'),time=el('input');time.type='number';time.min='0';time.max=String(Math.max(0,Math.min(item.durationA,item.durationB)-12));time.step='0.01';time.value=String(Math.min(Number(time.max),options.scope?.seconds??Math.min(300,Math.floor(Number(time.max)/2))));
 for(const [title,input] of [['Stopa originálu',a],['Stopa převodu',b],['Začátek úseku (sekundy)',time]]){const label=el('label','',title);label.append(input);form.append(label)}
 const go=button('Porovnat 12 sekund',()=>prepare('wave')),avButton=button('Porovnat video a zvuk',()=>prepare('av'),'primary'),listen=button('Přehrát A/B do sluchátek',()=>prepare('listen'),'primary'),stop=button('Zastavit',()=>{generation++;abPlayer?.stop();setWorking(false);status.textContent=tr('Poslech zastaven.')}),repeat=button('Opakovat A/B',()=>play().catch(e=>status.textContent=tr(e.message))),volume=el('input');
 const status=el('p','comparison-status','Načítám seznam zvukových stop…');status.setAttribute('role','status');const plot=el('div'),avHost=el('div','av-host');
 const audioControls=el('div','comparison-controls'),volumeLabel=el('label','','Společná hlasitost');volume.type='range';volume.min='0';volume.max='1';volume.step='.05';volume.value='.5';volume.setAttribute('aria-label',tr('Společná hlasitost obou ukázek'));volumeLabel.append(volume);audioControls.append(listen,repeat,stop,volumeLabel);
 volume.oninput=()=>{if(abPlayer)abPlayer.gain.gain.value=Number(volume.value)};
 const selectedScope=()=>({...options.scope,seconds:Number(time.value),originalIndex:a.value===''?null:Number(a.value),reviewIndex:b.value===''?null:Number(b.value)});
 const canInteract=()=>current()&&(options.canInteract?.()??true),validTime=()=>time.value.trim()!==''&&time.validity.valid&&Number.isFinite(Number(time.value))&&Number(time.value)>=0&&Number(time.value)<=Number(time.max);let lastScope=null;
 const presets=el('div','comparison-controls');
 const setWorking=value=>{working=value;form.dataset.previewBusy=String(value);for(const x of [go,avButton,listen,repeat,a,b,time,...presets.querySelectorAll('button')]){x.dataset.previewControl='';x.dataset.previewBusy=String(value);x.dataset.previewInvalid=String([go,avButton,listen].includes(x)?!trackReady||!validTime():x===repeat?!prepared:false);x.disabled=value||!canInteract()||x.dataset.previewInvalid==='true'}};
 const invalidate=()=>{if(working||!canInteract())return;const valid=validTime();options.onScopeValidityChange?.(valid);const scope=valid?selectedScope():null,key=scope?JSON.stringify(scope):null;if(valid&&key===lastScope)return;lastScope=key;generation++;abPlayer?.stop();prepared=null;avCleanup?.();avCleanup=null;avHost.replaceChildren();plot.replaceChildren();status.textContent=tr('Vyber odpovídající stopy a připrav ukázku.');if(valid)options.onScopeChange?.(scope);setWorking(false)};
 time.addEventListener('input',invalidate);for(const input of [time,a,b])input.addEventListener('change',invalidate);
 for(const [name,percent]of [['Začátek filmu',2],['Střed filmu',50],['Konec filmu',95]])presets.append(button(name,()=>{if(working||!canInteract())return;time.value=String(Math.floor(Number(time.max)*percent/100));invalidate()}));
 const play=async()=>{if(!current()||!prepared||!abPlayer)return;await abPlayer.context.resume();if(!current())return;const durations=abPlayer.play(prepared.original,prepared.review,()=>{if(current())status.textContent=tr('A/B dokončeno. Můžeš úsek opakovat.')});status.textContent=tr(`Originál vlevo (${durations.originalSeconds.toFixed(1)} s), pak převod vpravo (${durations.reviewSeconds.toFixed(1)} s). Úsek od ${prepared.seconds} s. ${audioTrackLabel(prepared.originalTrack.label)} → ${audioTrackLabel(prepared.reviewTrack.label)}.`)};
 async function prepare(mode){
  if(working||!trackReady||!canInteract()||!validTime())return;const attempt=++generation;lastScope=JSON.stringify(selectedScope());options.onScopeValidityChange?.(true);options.onScopeChange?.(selectedScope());setWorking(true);abPlayer?.stop();avCleanup?.();avCleanup=null;plot.replaceChildren();avHost.replaceChildren();
  try{if(mode==='listen'){const AudioCtor=window.AudioContext||window.webkitAudioContext;if(!AudioCtor)throw Error('Prohlížeč nepodporuje zvukové A/B.');abPlayer?.close();abPlayer=new AudioABPlayer(new AudioCtor());abPlayer.gain.gain.value=Number(volume.value);await abPlayer.context.resume()}
   status.textContent=tr(mode==='av'?'Připravuji dvě videa a zvukové průběhy. Příprava může trvat až čtyři minuty.':mode==='listen'?'Připravuji dvě 12sekundové ukázky; nejvýše dvě minuty.':'Připravuji zvukové průběhy… Nejvýše dvě minuty.');
   await options.beforePreview?.();if(!current()||attempt!==generation)return;const capture={snapshot:item.snapshot,...selectedScope()};const d=await api(`/api/items/${item.id}/audio-compare`,{...capture,...(mode==='wave'?{}:{mode})});if(!current()||attempt!==generation)return;
   if(mode==='av'){avHost.append(el('p','',audioTrackLabel(a.selectedOptions[0]?.textContent||'')+' → '+audioTrackLabel(b.selectedOptions[0]?.textContent||''),true));avCleanup=mountAVComparison(avHost,d,{tr});status.textContent=tr('Video i zvuk jsou připravené. Vybrané stopy a čas jsou pevné pro tuto ukázku.')}
   else if(mode==='listen'){prepared=d;await play()}
   else{const canvas=el('canvas');canvas.width=1100;canvas.height=310;canvas.style.width='100%';canvas.setAttribute('role','img');canvas.setAttribute('aria-label',tr('Zvukové průběhy originálu a převodu na společné časové ose'));plot.append(canvas);const ctx=canvas.getContext('2d');ctx.fillStyle='#111827';ctx.fillRect(0,0,1100,310);const max=Math.max(.001,...d.original,...d.review);
    for(const [values,title,color,base]of [[d.original,'Originál','#38bdf8',120],[d.review,'Převod','#fbbf24',250]]){ctx.fillStyle=color;ctx.font='16px sans-serif';ctx.fillText(tr(title),12,base-80);ctx.strokeStyle=color;ctx.beginPath();values.forEach((v,i)=>{const x=85+i/1200*990,y=base-v/max*65;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke()}
    ctx.fillStyle='#d1d5db';ctx.font='13px sans-serif';for(let i=0;i<=12;i+=2){const x=85+i/12*990;ctx.strokeStyle='#374151';ctx.beginPath();ctx.moveTo(x,45);ctx.lineTo(x,260);ctx.stroke();ctx.fillText((d.seconds+i).toFixed(1)+' s',x-20,285)}
    const r=d.alignment;status.textContent=tr(r.reliable?`Odhad posunu: ${r.offsetMs>0?'+':''}${r.offsetMs} ms (krok 10 ms). Kladný posun = zvuk převodu je později. Shoda obálek: ${(r.correlation*100).toFixed(1)} %. Platí jen pro tento úsek; porovnej také začátek a konec filmu.`:r.reason);
   }
  }catch(e){if(current()&&attempt===generation)status.textContent=tr(e.message)}finally{if(current()&&attempt===generation)setWorking(false)}
 }
 form.onsubmit=e=>{e.preventDefault();prepare(options.mode==='av'?'av':'wave')};
 const showAV=options.mode!=='audio',showAudio=options.mode!=='av';if(showAV)form.append(avButton);if(showAudio)form.append(go);
 host.append(...(options.host?[]:[head]),note,form,presets,status);if(showAudio)host.append(el('p','details','Sluchátka: nejprve originál vlevo, potom stejný úsek převodu vpravo. Obě stopy se převedou na mono 48 kHz. Bez samostatné normalizace hlasitosti a bez automatického posunu; použij odpovídající dialogové stopy.'),audioControls);host.append(avHost,plot);
 if(!options.host){audioDialog.setAttribute('aria-label',tr('Porovnání zvuku · '+item.title));audioDialog.showModal()}
 setWorking(false);
 (async()=>{try{await Promise.resolve();const data=options.tracks||await api(`/api/items/${item.id}/audio-compare`,{snapshot:item.snapshot,mode:'tracks'});if(!current())return;for(const [select,tracks,key]of [[a,data.original,'originalIndex'],[b,data.review,'reviewIndex']]){select.append(new Option(tr('Vyber zvukovou stopu'),''));for(const track of tracks){const option=el('option','',audioTrackLabel(track.label),true);option.value=String(track.index);select.append(option)}select.value=options.scope?.[key]===null||options.scope?.[key]===undefined?'':String(options.scope[key])}trackReady=!!a.options.length&&!!b.options.length&&a.value!==''&&b.value!=='';lastScope=JSON.stringify(selectedScope());const ready=()=>{trackReady=a.value!==''&&b.value!=='';setWorking(false)};a.addEventListener('change',ready);b.addEventListener('change',ready);setWorking(false);status.textContent=tr('Vyber odpovídající stopy a připrav ukázku.')}catch(e){if(current())status.textContent=tr(e.message)}})();
 return cleanup;
}

const radarrDialog=el('dialog','settings-dialog');document.body.append(radarrDialog);
const radarrButton=$('settingsRadarr');
radarrButton.onclick=async()=>{try{
 const c=await api('/api/radarr/settings');radarrDialog.replaceChildren(el('h2','','Radarr – náhrady filmů'));
 const fields={},form=el('form');for(const [name,label,type]of [['url','Adresa Radarru','url'],['mediaRoot','Cesta filmové knihovny uvnitř Radarru','text'],['quarantineRoot','Karanténa originálů v Review (mimo filmovou knihovnu)','text'],['apiKey','API klíč (prázdné = zachovat uložený)','password']]){const l=el('label','settings-field',label),input=el('input');input.type=type;input.value=name==='apiKey'?'':c[name]||'';input.autocomplete='off';l.append(input);form.append(l);fields[name]=input;}
 const pref=el('input');pref.type='checkbox';pref.checked=c.preferCzechEnglish!==false;const label=el('label','','Preferovat vydání s českým i anglickým audiem');label.prepend(pref);form.append(label,el('p','','Radarr posuzuje jazyky podle označení vydání. Skutečné stopy se ověří až po stažení. Samotné zamítnutí převodu nové stahování nespouští.'));
 const status=el('p'),buttons=el('div','dialog-actions'),test=el('button','secondary','Otestovat spojení'),save=el('button','','Ověřit a uložit'),close=el('button','secondary','Zavřít');test.type=close.type='button';close.onclick=()=>radarrDialog.close();
 async function submit(testOnly){test.disabled=save.disabled=true;try{const body=Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.value.trim()]));body.preferCzechEnglish=pref.checked;status.textContent=tr((await api('/api/radarr/settings'+(testOnly?'/test':''),body)).message);if(!testOnly)fields.apiKey.value=''}catch(e){status.textContent=tr(e.message)}finally{test.disabled=save.disabled=false}}
 test.onclick=()=>submit(true);form.onsubmit=e=>{e.preventDefault();submit(false)};buttons.append(close,test,save);form.append(status,buttons);radarrDialog.append(form);
 radarrDialog.append(el('p','details','Stavy filmů a žádostí najdeš v sekci Obnovy. Retence karantény běží 7 dní od doloženého schválení funkční náhrady.'));radarrDialog.setAttribute('aria-label',tr('Nastavení Radarru'));radarrDialog.showModal();
}catch(e){error(e)}};

class AudioABPlayer {
 constructor(context){this.context=context;this.sources=[];this.gain=context.createGain();this.gain.gain.value=.5;this.gain.connect(context.destination);}
 stop(){for(const s of this.sources){s.onended=null;try{s.stop()}catch{}}this.sources=[];}
 buffer(packet,channel){const raw=atob(packet.pcm),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);if(bytes.length!==packet.frames*4||packet.sampleRate!==48000)throw Error('Neplatný poslechový úsek.');const view=new DataView(bytes.buffer),b=this.context.createBuffer(2,packet.frames,packet.sampleRate),data=b.getChannelData(channel);for(let i=0;i<data.length;i++){const v=view.getFloat32(i*4,true);if(!Number.isFinite(v))throw Error('Neplatný zvukový vzorek.');data[i]=v;}return b;}
 play(original,review,ended){this.stop();const a=this.buffer(original,0),b=this.buffer(review,1),start=this.context.currentTime+.05;for(const [buffer,when] of [[a,start],[b,start+a.duration+.3]]){const s=this.context.createBufferSource();s.buffer=buffer;s.connect(this.gain);this.sources.push(s);s.start(when);}this.sources[1].onended=()=>{this.sources=[];ended?.()};return {originalSeconds:a.duration,reviewSeconds:b.duration};}
 close(){this.stop();void this.context.close();}
}

const quarantineDialog=el('dialog','settings-dialog');document.body.append(quarantineDialog);
const quarantineButton=$('settingsQuarantine');quarantineButton.onclick=()=>openQuarantine();
async function openQuarantine(title='',caseId=''){
 try{
  await loadRequests(true);const d=await api('/api/quarantine');quarantineDialog.replaceChildren(el('h2','','Karanténa'+(title?' · '+title:'')));
  const query=title.toLocaleLowerCase().replace(/\s*\(\d{4}\).*$/,'').trim();
  const files=d.files.filter(f=>caseId?f.caseId===caseId:!query||f.name.toLocaleLowerCase().includes(query));
  quarantineDialog.append(el('p','details','Originály se uchovávají do schválení funkční náhrady v Review. Schválená lhůta pro následný úklid je 7 dní. Automatický úklid je zapnutý pro náhrady s uloženým důkazem schválení a nezměněnou identitou obou souborů. Starší případy bez důkazu zůstávají zachované.'));
  quarantineDialog.append(el('p','details','Velikost zobrazených souborů: '+fmt(files.reduce((sum,f)=>sum+(Number.isSafeInteger(f.bytes)&&f.bytes>=0?f.bytes:0),0))),el('p','details','Součet velikostí souborů nemusí odpovídat fyzicky zabranému místu; některé kopie mohou být hardlinky.'));
  if(!files.length)quarantineDialog.append(el('p','','Pro tento výběr není v karanténě žádný soubor.'));
  for(const f of files){const row=el('article','movie');row.append(el('strong','',f.name,true),el('p','details',fmt(f.bytes)),el('p','details',f.path,true));const lifecycle=quarantineLifecycle(f,requests);row.append(el('p','',lifecycle.label),el('p','details',lifecycle.reason));if(lifecycle.deleteAfter!==null)row.append(detailsFacts([['Termín úklidu',date(lifecycle.deleteAfter)]]));if(lifecycle.requestKey)row.append(button('Otevřít obnovu',()=>{quarantineDialog.close();openDetail('request',lifecycle.requestKey)}));const copy=el('button','secondary','Kopírovat cestu');copy.onclick=async()=>{try{await navigator.clipboard.writeText(f.path);copy.textContent=tr('Zkopírováno')}catch{copy.textContent=tr('Označ a zkopíruj cestu výše')}};row.append(copy);quarantineDialog.append(row)}
  for(const w of d.warnings)quarantineDialog.append(el('p','failure',w));
  if(title){const all=el('button','secondary','Zobrazit celou karanténu');all.onclick=()=>{quarantineDialog.close();openQuarantine()};quarantineDialog.append(all)}
  const close=el('button','secondary','Zavřít');close.onclick=()=>quarantineDialog.close();quarantineDialog.append(close);quarantineDialog.setAttribute('aria-label',tr('Karanténa'+(title?' · '+title:'')));quarantineDialog.showModal();
 }catch(e){error(e)}
}

function recoveryDetails(r){
 const box=el('div');box.append(el('strong','',r.pipelineLabel||r.message));if(r.statusUpdated){box.append(el('p','details','Stav aktualizován: '+new Date(r.statusUpdated).toLocaleString(locale)));if(Date.now()-Date.parse(r.statusUpdated)>12*60000)box.append(el('p','failure','Stav je starší než 12 minut; spojení s Recovery může být přerušené.'));}if(r.replacementTitle)box.append(el('p','details','Náhrada: '+r.replacementTitle));if(r.tdarrStatus)box.append(el('p','details','Tdarr: '+r.tdarrStatus));if(r.quarantineRetained)box.append(el('p','details','Původní kopie je zachovaná v karanténě.'));if(r.deleteAfter)box.append(el('p','details','Úklid karantény po schválení: '+new Date(r.deleteAfter).toLocaleString(locale)));for(const q of downloadProgress(r))box.append(downloadProgressView(q));if(r.phase==='waiting_source_kept')box.append(el('strong','failure','Vydání vyřazeno z převodů — náhrada zatím nenalezena'),el('p','','Film zůstává v Plexu. Jeho původní zvuk má potvrzenou chybu; toto vydání se nebude znovu převádět.'));
 if(r.edition)box.append(el('p','details','Vyřazené vydání: '+r.edition));
 if(r.lastSearchAt)box.append(el('p','details','Poslední hledání: '+new Date(r.lastSearchAt).toLocaleString(locale)));
 if(r.nextSearchAt)box.append(el('p','details','Další automatické hledání: '+new Date(r.nextSearchAt).toLocaleString(locale)));
 if(r.error)box.append(el('p','failure','Kontrola náhrady: '+r.error));
 if(r.radarrMovieUrl){const link=el('a','secondary','Otevřít film v Radarru — ruční hledání');link.href=r.radarrMovieUrl;link.target='_blank';link.rel='noopener noreferrer';box.append(link);}
 box.append(el('p','details','Můžeš nezávisle hledat jiné vydání přes interaktivní hledání v Radarru. Vybírej stejnou nebo vyšší kvalitu; vyřazené vydání znovu nestahuj. Před nahrazením ověř stav obnovy; původní kopie se uchová podle pravidel karantény.'));
 return box;
}

start();
