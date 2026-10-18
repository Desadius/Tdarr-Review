import {mountReviewWorkflow,classifyPreparation,preparationSummary} from '/review-workflow.js?v=__APP_VERSION__';
import {capabilities, reviewState, classifyRecovery, recoveryProgress, downloadProgress, liveRecoveryRecord, projectRequests, historyWarnings, historyFollowup, recoveryFollowup, fullHashProgress} from '/review-model.js?v=__APP_VERSION__';
import {$,el,fmt,date,elapsedText,etaText,poster,button,badge,keyed,makeTabs,detailsFacts} from '/ui-kit.js?v=__APP_VERSION__';
import {decodeProgressView,downloadProgressView,fullHashProgressView,recoveryDetails,recoveryRuntimeView,recoveryRestartWarningView,recoveryConfigNoticeView} from '/recovery-view.js?v=__APP_VERSION__';
import {installComparisons,openComparison,openAudioComparison} from '/comparison.js?v=__APP_VERSION__';
import {installSettingsDialogs} from '/settings-dialogs.js?v=__APP_VERSION__';
import {installQuarantine,openQuarantine} from '/quarantine.js?v=__APP_VERSION__';
import {installStatistics,loadStatistics,statisticsLoadedAt} from '/statistics.js?v=__APP_VERSION__';
import {tr,locale,language,initializeLocale} from '/i18n.js?v=__APP_VERSION__';
import {errorText} from '/error-messages.js?v=__APP_VERSION__';
initializeLocale();

const busy=d=>!!d?.active||!!d?.batchRunning;
let latest=null,pending=null,loading=false,lastRender='',receivedAt=0,serverAt=Date.now();
let recoveryConfig=null,recoveryRuntime=null,authenticated=false,actionInFlight=false,requests=[],requestsReceived=0,requestsLoading=false,requestsError='',dataError='',confirmOrigin=null;
const selected=new Set();
const ui={view:'attention',filter:'running',tab:'review',detail:null,selection:false,layout:'work',historyPage:0};
let reviewWorkspace=null;
try{ui.layout=localStorage.getItem('tdarr-review-layout')==='gallery'?'gallery':'work'}catch{}
const context=()=>({authenticated,fresh:!!receivedAt&&!dataError&&Date.now()-receivedAt<15000,requests,requestsFresh:!!requestsReceived&&!requestsError&&Date.now()-requestsReceived<90000,settingsBusy:actionInFlight});
const caps=item=>capabilities(item,latest||{items:[],recovery:[]},context());
function previewRenderSignature(data){return JSON.stringify({...data,serverTime:undefined,previews:Object.fromEntries(Object.entries(data.previews||{}).map(([id,value])=>[id,value?{...value,updated:undefined}:value]))})}

// A known error code is rendered in the selected language; otherwise the server's text is used.
const serverError=d=>(typeof d?.code==='string'&&errorText(d.code,d.params,language))||d?.error;
async function api(route,body){
 if(body!==undefined){
  const preview=/^\/api\/items\/([a-f0-9]{24})\/(frames|audio-compare)$/.exec(route);
  if(preview){const item=latest?.items.find(x=>x.id===preview[1]),permitted=body.cachedOnly===true?authenticated&&context().fresh:caps(item||{})[preview[2]==='frames'?'compareImage':'compareAudio'];if(!item||item.snapshot!==body.snapshot||!permitted)throw Error('Porovnání nyní není dostupné. Obnov údaje a ověř stav filmu.');}
  if(/^\/api\/(settings|radarr\/settings|preview-settings)(\/test)?$/.test(route)&&capabilities({},latest,context()).writeBlocked)throw Error('Nastavení nyní nelze měnit. Ověř přihlášení, aktuální údaje a probíhající operace.');
 }
 const r=await fetch(route,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 let d;try{d=await r.json()}catch{throw Error('Server nevrátil platnou odpověď. Obnov údaje a ověř výsledek akce.')}
 if(r.status===401){authenticated=false;$('login').hidden=false;$('workspace').hidden=!latest;updateGuards();throw Error(serverError(d)||'Přihlášení vypršelo. Poslední načtené údaje nejsou aktuální.')}
 if(!r.ok)throw Object.assign(Error(serverError(d)||'Požadavek selhal.'),{status:r.status,code:d.code,field:d.field,revision:d.revision,data:d});
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
function askKeepPaused(name){
 pending={action:'keepPaused',node:name};confirmSetup('NODE TDARRU',name,'Review tento node znovu nespustí a zapomene ho. Použij to jen pro node, který jsi v Tdarru pozastavil sám, například kvůli údržbě. Ostatní nody Review obnoví jako obvykle.','Ponechat node pozastavený');$('confirm').showModal();
}
// Nodes Review paused and will resume; each can be kept paused after a confirmation.
function renderNodeRestores(nodes){
 const box=$('nodeRestores');box.hidden=!nodes.length;if(!nodes.length){box.replaceChildren();return}
 const head=el('div');head.append(el('strong','','Nody Tdarru, které Review po akci znovu spustí'));
 keyed(box,[{name:'',head:true},...nodes],n=>n.head?'head':'node:'+n.name,n=>{if(n.head)return head;const row=el('div'),b=button('Ponechat pozastavený',()=>askKeepPaused(n.name));b.setAttribute('aria-label',tr('Ponechat pozastavený: '+n.name));b.dataset.focus='keep:'+n.name;
  // Older records have no film or time; show only what is known so no fallback text stays untranslated.
  row.append(el('span','',[n.name,n.title?tr('Pozastaveno pro '+n.title):'',n.pausedAt?date(n.pausedAt):''].filter(Boolean).join(' · '),true),b);return row});
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
  else if(request.action==='keepPaused'){if(!latest?.pendingRestores?.some(n=>n.name===request.node))throw Error('Tento node už Review neobnovuje. Obnov přehled.');}
  else if(request.action==='restore'){const current=requests.find(r=>r.id===request.record.id&&r.source===request.record.source);if(!current||!caps(current).restore)throw Error('Stav obnovy se změnil. Obnov údaje.');}
  else writeItem(request.item,request.action);
  if(request.action==='approve'&&latest?.reviewSessions?.[request.item.id]?.revision!==request.reviewRevision)throw Error('Posouzení se od otevření potvrzení změnilo. Znovu ověř uložené kontroly.');
  if(request.action==='batch'&&request.items.some(item=>latest?.reviewSessions?.[item.id]?.revision!==request.reviewRevisions[item.id]))throw Error('Posouzení vybraných filmů se změnilo. Znovu ověř uložené kontroly.');
  actionInFlight=true;updateGuards();
  if(request.action==='batch'){await api('/api/approve-batch',{items:request.items.map(x=>({id:x.id,snapshot:x.snapshot,reviewRevision:request.reviewRevisions[x.id]}))});selected.clear()}
  else if(request.action==='keepPaused')await api('/api/node-restores/keep',{name:request.node,confirm:true});
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
 $('selectionHint').textContent=tr(`Výběr slouží k hromadnému schválení dokončených posouzení. Lze vybrat: ${eligible.length} z ${filteredItems().length}.`);
 for(const row of $('list').children){const checkbox=row.querySelector('input[type=checkbox]');if(checkbox){const c=caps(latest.items.find(x=>x.id===row.dataset.key)||{}),why=row.querySelector('details.selection-why');checkbox.checked=selected.has(row.dataset.key);checkbox.disabled=!c.select;checkbox.closest('label').hidden=!ui.selection;
  // A disabled checkbox cannot be the click target, so the reason is a separate disclosure.
  if(why){why.hidden=!ui.selection||c.select;why.querySelector('p').textContent=tr(c.selectReason);why.querySelector('button').hidden=c.selectAction!=='review';}}}
}
$('selectionToggle').onclick=()=>{ui.selection=!ui.selection;if(!ui.selection)selected.clear();updateSelection()};
$('selectionCancel').onclick=()=>{ui.selection=false;selected.clear();updateSelection();$('selectionToggle').focus()};
$('selectAll').onchange=e=>{for(const item of filteredItems().filter(x=>caps(x).select)){e.target.checked?selected.add(item.id):selected.delete(item.id)}updateSelection()};
$('approveSelected').onclick=()=>{
 const items=(latest?.items||[]).filter(x=>selected.has(x.id));if(!items.length||items.some(x=>!caps(x).approveBatch))return;
 pending={action:'batch',items,reviewRevisions:Object.fromEntries(items.map(item=>[item.id,latest?.reviewSessions?.[item.id]?.revision]))};confirmSetup('HROMADNÉ SCHVÁLENÍ',`Schválit ${items.length} filmů?`,`Vybrané filmy: ${items.map(x=>x.title).join('; ')}. Postupně se ověří identita souborů a kontrolní součet kopie, pak se nahradí originály. Původní verze budou odstraněny. Health check z Tdarru se neopakuje. Možná úspora ${fmt(items.reduce((s,x)=>s+x.originalBytes-x.reviewBytes,0))}. Dávka běží na serveru i po zavření stránky. Při chybě jednoho filmu zachová jeho soubory a pokračuje dalším.`,`Schválit ${items.length} filmů`);$('confirm').showModal();
};

function previewPreparationBadge(item){
 const preparation=latest?.previews?.[item.id],status=classifyPreparation(preparation,item.snapshot),box=el('div','preview-card-status'),icon=el('span','preview-status-icon',status.icon,true),label=el('strong','preview-status-label',tr('Ukázky')+': '+tr(status.label),true);box.dataset.kind=status.kind;box.title=preparation?.snapshot===item.snapshot&&preparation.error?tr(preparation.error):preparationSummary(preparation?.snapshot===item.snapshot?preparation:null,tr);box.setAttribute('role','group');box.setAttribute('aria-label',tr('Stav ukázek'));icon.setAttribute('aria-hidden','true');box.append(icon,label);
 if(status.total>0)box.append(el('span','preview-status-count',status.ready+'/'+status.total,true));
 if(status.progress){const progress=el('progress','preview-status-progress');progress.max=status.total||1;if(status.total>0)progress.value=Math.min(status.ready,status.total);progress.setAttribute('aria-label',tr('Připravené ukázky')+' · '+status.ready+'/'+status.total);box.append(progress)}
 return box;
}
const STATE_ICONS={ready:'○','in-progress':'◐',complete:'●',deferred:'⏸',duration:'⚠',blocked:'⛔'};
function stateBadge(state){const b=badge(state.label,{ready:'ready',complete:'ready'}[state.kind]||'warning'),icon=el('span','state-icon',STATE_ICONS[state.kind],true);icon.setAttribute('aria-hidden','true');b.prepend(icon);b.dataset.state=state.kind;return b}
function reviewRow(item){
 const row=el('article','review-row'),pick=el('label','selection'),checkbox=el('input');checkbox.type='checkbox';checkbox.setAttribute('aria-label',tr('Vybrat '+item.title));checkbox.dataset.focus='pick:'+item.id;checkbox.onchange=e=>{e.target.checked?selected.add(item.id):selected.delete(item.id);updateSelection()};pick.append(checkbox);
 const session=latest?.reviewSessions?.[item.id],deferred=session?.snapshot===item.snapshot&&session.session?.deferred,state=reviewState(item,latest);
 const why=el('details','selection-why'),whyText=el('p','details'),whyOpen=button('Otevřít posouzení',()=>openDetail('review',item.id));why.hidden=true;why.append(el('summary','','Proč nelze vybrat?'),whyText,whyOpen);
 const info=el('div','row-info');info.append(stateBadge(state),el('h2','',item.title,true),el('p','details',deferred?session.session.note:item.status==='ready'?'Další krok: porovnej obraz a zvuk.':item.reason||'Ověř technické údaje a dostupnost souborů.'));
 info.append(previewPreparationBadge(item),why);
 const metric=el('div','row-metric');metric.append(el('strong','saved',fmt(item.originalBytes-item.reviewBytes)),el('span','details',`${fmt(item.originalBytes)} → ${fmt(item.reviewBytes)}`));
 const inspect=button('Posoudit',()=>openDetail('review',item.id),'primary');inspect.dataset.focus='inspect:'+item.id;inspect.setAttribute('aria-label',tr('Posoudit '+item.title));row.append(pick,poster('review',item.id,item.title),info,metric,inspect);return row;
}
const TX_PHASES={preparing:'Příprava kopie','syncing-copy':'Zápis kopie','verifying-copy':'Ověření kopie',ready:'Kopie ověřena','original-backed-up':'Originál přesunut do zálohy','original-removed':'Originál uvolněn z místa',installed:'Výsledek nainstalován',unknown:'Neznámá fáze'};
const TX_REASONS={'invalid-identity':'Zaznamenaná identita souboru je nečitelná; nic nebylo přesunuto.','invalid-paths':'Záznam výměny obsahuje neplatné cesty.',unreadable:'Záznam výměny nelze přečíst ani ověřit.','needs-inspection':'Originál nelze prokazatelně vrátit automaticky: záloha nebo soubory se změnily, nebo výměna pokročila za bod návratu.'};
// Read-only: unresolved exchange transactions are inspected by hand (docs/OPERATIONS.md); Review offers no action on them.
function renderTransactions(){
 const list=Array.isArray(latest?.recovery)?latest.recovery.filter(t=>t&&typeof t==='object'):[],box=$('transactions');box.hidden=!list.length;if(!list.length){box.replaceChildren();return}
 const title=el('h2','',list.length===1?'Nedokončená výměna vyžaduje ruční kontrolu':`Nedokončené výměny vyžadují ruční kontrolu (${list.length})`);title.id='transactionsTitle';
 const rows=el('ul','transaction-list');for(const t of list){const li=el('li'),film=latest.items.find(x=>x.id===t.itemId);li.append(el('strong','',t.title||'Film nelze určit',!!t.title),el('span','details',tr('Fáze')+': '+tr(TX_PHASES[t.phase]||TX_PHASES.unknown),true),el('p','',TX_REASONS[t.reason]||TX_REASONS.unreadable),el('span','details',tr('Záznam výměny')+': '+(t.journal||'—'),true));if(film){const open=button('Otevřít film',()=>openDetail('review',film.id));open.setAttribute('aria-label',tr('Otevřít film '+film.title));li.append(open)}rows.append(li)}
 box.replaceChildren(title,el('p','','Schválení, zamítnutí a dávky jsou zablokované, dokud záznam výměny ručně neprověříš. Review tu nic neopravuje ani nemaže; oba soubory a záznam zůstávají zachované.'),rows,el('p','details','Postup kontroly: docs/OPERATIONS.md, oddíl „Unresolved exchange transaction“.'));
}
function renderAttention(){
 const items=filteredItems();$('readyCount').textContent=tr((latest?.items||[]).filter(x=>x.status==='ready').length);$('blockedCount').textContent=tr((latest?.items||[]).filter(x=>x.status!=='ready').length);
 $('saving').textContent=tr(fmt((latest?.items||[]).filter(x=>x.status==='ready').reduce((s,x)=>s+x.originalBytes-x.reviewBytes,0)));
 $('list').classList.toggle('gallery',ui.layout==='gallery');keyed($('list'),items.map(item=>{const preparation=latest?.previews?.[item.id];return {...item,reviewSession:latest?.reviewSessions?.[item.id],preparation:preparation?{...preparation,updated:undefined}:preparation}}),x=>x.id,reviewRow);$('reviewEmpty').hidden=!!items.length;$('reviewEmpty').textContent=tr(latest?.items.length?'Tomuto hledání neodpovídá žádný výsledek.':'Všechny výsledky jsou vyřízené. Nové se objeví automaticky po dokončení převodu.');
 for(const radio of document.querySelectorAll('input[name=layout]'))radio.checked=radio.value===ui.layout;
 const warnings=historyWarnings(latest?.history||[]),attention=projectRequests(requests,latest?.items||[],Date.now()).filter(x=>x.classification.category==='attention');
 $('events').hidden=!warnings.length&&!attention.length;
 const events=[];if(warnings.length)events.push({kind:'history',count:warnings.length});if(attention.length)events.push({kind:'recovery',count:attention.length});
 keyed($('events'),events,x=>x.kind,x=>{const row=el('div'),b=button(x.kind==='history'?'Historie':'Obnovy',()=>navigate(x.kind,{filter:x.kind==='history'?'warning':'attention'}));b.dataset.focus='event:'+x.kind;row.append(el('span','',x.kind==='history'?`${x.count} upozornění v historii`:`${x.count} obnov k ověření`),b);return row});
 renderTransactions();updateSelection();
}
function recoveryRow(projected){
 const r=projected.record||projected.raw||projected,cl=projected.classification||classifyRecovery(r,Date.now()),row=el('article','recovery-row'),info=el('div','row-info');
 info.append(badge(cl.label,cl.category==='attention'?'warning':cl.category==='done'?'ready':''),el('h2','',r.title,true),el('p','details',cl.nextStep));
 const progress=recoveryProgress(r);if(progress)info.append(decodeProgressView(progress,false));const hashProgress=fullHashProgress(r);if(hashProgress)info.append(fullHashProgressView(hashProgress,false));for(const download of downloadProgress(r).slice(0,1))info.append(downloadProgressView(download,false));
 const meta=el('div','row-metric');meta.append(el('span','details',r.source==='recovery'?'Recovery · Radarr · Tdarr':'Náhrada přes Radarr'),el('small',cl.stale?'failure':'details',cl.stale?'Stav starší než 12 minut':date(r.statusUpdated||r.updated)));
 const b=button('Prohlédnout',()=>openDetail('request',projected.key));b.setAttribute('aria-label',tr('Prohlédnout obnovu '+r.title));b.dataset.focus='recovery:'+projected.key;
 row.append(poster('request',r.id,r.title),info,meta,b);return row;
}
function renderRecovery(){
 const projects=projectRequests(requests,latest?.items||[],Date.now()),categories=[['running','Probíhá'],['waiting','Čeká'],['attention','Vyžaduje zásah'],['unverified','Stav nelze ověřit'],['done','Dokončeno']];
 makeTabs($('recoveryFilters'),categories.map(([key,title])=>[key,`${title} (${projects.filter(p=>p.classification.category===key).length})`]),ui.filter,id=>navigate('recovery',{filter:id}));
 $('recoveryPanel').setAttribute('aria-labelledby','recoveryFilters-'+ui.filter);
 const query=$('recoverySearch').value.trim().toLocaleLowerCase(),visible=projects.filter(p=>p.classification.category===ui.filter&&(p.record||p.raw||p).title.toLocaleLowerCase().includes(query));
 $('recoveryRuntime').replaceChildren(recoveryRuntimeView(recoveryRuntime));
 const restartWarning=recoveryRestartWarningView(requests,recoveryRuntime);$('recoveryRestartWarning').hidden=!restartWarning;$('recoveryRestartWarning').replaceChildren(...(restartWarning?[restartWarning]:[]));
 const configNotice=recoveryConfigNoticeView(recoveryConfig);$('recoveryConfig').hidden=!configNotice;$('recoveryConfig').replaceChildren(...(configNotice?[configNotice]:[]));$('recoveryError').hidden=!requestsError;$('recoveryError').textContent=tr(requestsError?'Stav obnov není dostupný. Poslední údaje zůstávají zobrazené: '+requestsError:'');
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
function guardedButton(item,cap,text,fn,cls='secondary'){const b=button(text,()=>{if(!caps(item)[cap]){error(Error(caps(item).reason||'Akce není dostupná.'));return}fn()},cls);b.dataset.cap=cap;b.disabled=!caps(item)[cap];return b}

function detailReview(item,tab){
 const box=$('detailBody');
 if(tab==='review'){
  if(reviewWorkspace)return;
  reviewWorkspace=mountReviewWorkflow(box,item,{api,tr,formatBytes:fmt,openComparison,openAudioComparison,preparation:latest?.previews?.[item.id],
   canWrite:()=>{const current=latest?.items.find(x=>x.id===item.id);return !!current&&current.snapshot===item.snapshot&&!caps(current).writeBlocked},
   canApprove:()=>{const current=latest?.items.find(x=>x.id===item.id);return !!current&&current.snapshot===item.snapshot&&caps(current).approve},
   onSession:record=>{if(!latest)return;latest.reviewSessions||={};latest.reviewSessions[item.id]=record;updateGuards()},
   onPreparation:record=>{if(!latest||record?.snapshot!==item.snapshot)return;latest.previews||={};latest.previews[item.id]=record;renderAttention()},
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
 if(tab==='overview'){box.append(el('h3','',cl.label),el('p','',cl.nextStep));for(const warning of cl.warnings||[])box.append(el('p','alert inline-warning',warning));const progress=recoveryProgress(r);if(progress)box.append(decodeProgressView(progress));const hashProgress=fullHashProgress(r);if(hashProgress)box.append(fullHashProgressView(hashProgress));box.append(detailsFacts([['Poslední potvrzený stav',date(r.statusUpdated||r.updated)],['Původní kopie',r.quarantineRetained?'Zachovaná v karanténě':r.sourceRetained||r.phase==='waiting_source_kept'?'Zůstává v Plexu; vydání vyloučeno z převodů':'Viz aktuální protokol obnovy'],['Další hledání',r.nextSearchAt?date(r.nextSearchAt):'Termín není doložen'],['Další pokus obnovy',r.nextRetryAt?date(r.nextRetryAt):'Termín není doložen']]));if(r.message)box.append(el('p','details',r.message));
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
  const hashProgress=fullHashProgress(r);if(hashProgress)box.append(fullHashProgressView(hashProgress));
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
  if(ui.detail.kind==='review'&&changed)reviewWorkspace?.invalidate();else{reviewWorkspace?.refreshGuard();if(ui.detail.kind==='review'){reviewWorkspace?.observe(latest.reviewSessions?.[item.id]);reviewWorkspace?.observePreparation(latest.previews?.[item.id],{authoritative:true})}}
  const guard=caps(item);$('detailGuard').hidden=!guard.writeBlocked&&!changed;$('detailGuard').textContent=tr(changed?'Akce čekají na nové posouzení aktuálního stavu.':guard.reason||'Zapisující akce jsou dočasně zablokované.');
 }
 if(pending){let enabled=!actionInFlight;if(pending.action==='batch')enabled&&=pending.items.every(x=>{const current=latest.items.find(i=>i.id===x.id&&i.snapshot===x.snapshot);return current&&caps(current).approveBatch&&latest.reviewSessions?.[x.id]?.revision===pending.reviewRevisions[x.id]});else if(pending.action==='restore'){const current=requests.find(r=>r.id===pending.record.id&&r.source===pending.record.source);enabled&&=!!current&&caps(current).restore;}else if(pending.action==='keepPaused'){enabled&&=!!latest.pendingRestores?.some(n=>n.name===pending.node);}else{const current=latest.items.find(x=>x.id===pending.item.id&&x.snapshot===pending.item.snapshot);enabled&&=!!current&&caps(current)[pending.action]&&(pending.action!=='approve'||latest.reviewSessions?.[pending.item.id]?.revision===pending.reviewRevision)}$('commit').disabled=!enabled;}
}
function render(d){
 const priorSessions=latest?.reviewSessions||{};d.reviewSessions||={};for(const [id,record]of Object.entries(priorSessions)){const current=d.items.find(x=>x.id===id);if(current?.snapshot===record.snapshot&&record.revision>(d.reviewSessions[id]?.revision??-1))d.reviewSessions[id]=record}
 latest=d;authenticated=true;document.querySelector('.server').textContent=d.label||'Tdarr Review';$('login').hidden=true;$('workspace').hidden=false;
 if(ui.detail?.kind==='review')reviewWorkspace?.observePreparation(d.previews?.[ui.detail.id],{authoritative:true});
 for(const id of selected)if(!d.items.some(x=>x.id===id&&caps(x).select))selected.delete(id);
 $('attentionCount').textContent=tr(d.items.length);$('recoveryCount').textContent=tr(projectRequests(requests,d.items,Date.now()).filter(x=>x.classification.category!=='done').length);
 const warningCount=historyWarnings(d.history||[]).length;$('historyCount').hidden=!warningCount;$('historyCount').textContent=tr(warningCount);
 renderNodeRestores(Array.isArray(d.pendingRestores)?d.pendingRestores:[]);$('notice').hidden=!(d.recovery?.length||d.restorePending);$('notice').textContent=tr(d.recovery?.length?'Nedokončená výměna vyžaduje kontrolu. Další změny jsou zablokované; soubory nepřesouvej ručně.':d.restorePending?'Obnova stavu nodů v Tdarru není dokončená. Změny jsou zablokované; ověř jejich pozastavení.':'');
 renderAttention();renderRecovery();renderHistory();renderBatch();paintProgress();updateGuards();handleHash();
}
function renderBatch(){const b=latest?.batch;$('batch').hidden=!b||b.status!=='running';$('batch').replaceChildren();if(b?.status==='running'){const p=el('progress','batch-meter');p.max=b.total;p.value=b.finished;p.setAttribute('aria-label',tr('Dokončené filmy dávky'));$('batch').append(el('strong','',`Hromadné schválení · ${b.finished} z ${b.total}`),p,el('span','details',`Chyby: ${b.failed}${b.message?' · '+b.message:''}`))}}
async function load(){if(loading)return;loading=true;try{const d=await api('/api/items');receivedAt=Date.now();serverAt=d.serverTime||receivedAt;authenticated=true;dataError='';$('lastUpdate').textContent=tr(date(receivedAt));$('lastUpdate').dateTime=new Date(receivedAt).toISOString();const sig=previewRenderSignature(d);if(sig!==lastRender||$('workspace').hidden||!$('login').hidden){render(d);lastRender=sig}else{if(latest)latest.previews=d.previews||{};updateGuards()}}catch(e){dataError=e.message;updateGuards();if(!latest)error(e)}finally{loading=false}}
async function loadRequests(force=false){if(requestsLoading||!authenticated||(!force&&Date.now()-requestsReceived<30000))return;requestsLoading=true;try{const d=await api('/api/radarr/requests');requests=d.requests;recoveryConfig=d.recoveryConfig||null;recoveryRuntime=d.recoveryRuntime||null;requestsReceived=Date.now();requestsError='';if(latest){renderAttention();renderRecovery();$('recoveryCount').textContent=tr(projectRequests(requests,latest.items,Date.now()).filter(x=>x.classification.category!=='done').length);const live=ui.detail?.kind==='request'?liveRecoveryRecord(ui.detail.record,requests):null;if(live){ui.detail.record=live;$('detailSubtitle').textContent=tr(classifyRecovery(live).label);renderDetailTab();}updateGuards();handleHash()}}catch(e){requestsError=e.message;if(authenticated){try{recoveryRuntime=await api('/api/recovery/runtime')}catch{}}renderRecovery();updateGuards()}finally{requestsLoading=false}}
function parseHash(){const [view,query='']=location.hash.slice(1).split('?');return {view:['attention','recovery','history','savings','settings'].includes(view)?view:'attention',params:new URLSearchParams(query)}}
function navigate(view,params={}){if(view==='recovery'&&!params.filter)params.filter=ui.filter;const query=new URLSearchParams(params).toString(),hash='#'+view+(query?'?'+query:'');if(location.hash===hash)handleHash();else location.hash=hash}
function handleHash(){
 const {view,params}=parseHash(),oldView=ui.view,focusWasInContent=$('content').contains(document.activeElement);ui.view=view;
 for(const section of document.querySelectorAll('.view'))section.hidden=section.id!=='view-'+view;
 for(const link of document.querySelectorAll('[data-view]')){if(link.dataset.view===view)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current')}
 if(view==='recovery'){const filter=params.get('filter');if(['running','waiting','attention','unverified','done'].includes(filter)&&filter!==ui.filter){ui.filter=filter;renderRecovery()}}
 if(view==='history'&&params.get('filter')==='warning'&&$('historyFilter').value!=='warning'){$('historyFilter').value='warning';ui.historyPage=0;renderHistory()}
 if(view==='savings'&&Date.now()-statisticsLoadedAt()>15000)loadStatistics();
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

// The one context handed to the UI modules; getters keep app.js state authoritative.
const appContext={api,error,load,loadRequests,openDetail,ui,forceRender:()=>{lastRender=''},get latest(){return latest},get requests(){return requests},get authenticated(){return authenticated}};
installComparisons(appContext);installSettingsDialogs(appContext);installQuarantine(appContext);installStatistics(appContext);
start();
