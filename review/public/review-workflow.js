const CHECKS=['preparation','image','audio','syncStart','syncMiddle','syncEnd','hdr'];
const STEPS=[['Podklady',['preparation']],['Obraz',['image']],['Zvuk',['audio']],['Synchronizace',['syncStart','syncMiddle','syncEnd']],['Rozhodnutí',[]]];
const clone=value=>JSON.parse(JSON.stringify(value));

export function classifyPreparation(preparation,snapshot){
 const waiting={kind:'waiting',label:'Čeká',icon:'◷',ready:0,total:0,progress:false};
 if(!preparation||snapshot!==undefined&&preparation.snapshot!==snapshot)return waiting;
 const jobs=Array.isArray(preparation.jobs)?preparation.jobs:[],ready=Math.max(0,Number(preparation.ready)||0),total=Math.max(0,Number(preparation.total)||0),result={ready,total,progress:false};
 if(preparation.state==='disabled')return {...result,kind:'disabled',label:'Vypnuto',icon:'Ⅱ'};
 if(['error','unavailable'].includes(preparation.state)||jobs.some(x=>x.status==='error'))return {...result,kind:'attention',label:'Vyžaduje zásah',icon:'!'};
 const pair=preparation.defaultScope,validPair=Number.isInteger(pair?.originalIndex)&&pair.originalIndex>=0&&Number.isInteger(pair?.reviewIndex)&&pair.reviewIndex>=0,hasAudio=jobs.some(x=>['av','wave','listen'].includes(x.mode)&&x.status==='ready');
 if(total>0&&ready>=total&&validPair&&hasAudio&&jobs.every(x=>x.status==='ready'))return {...result,kind:'ready',label:'Připraveno',icon:'✓'};
 if(preparation.state==='running'||jobs.some(x=>x.status==='running'))return {...result,kind:'preparing',label:'Připravuje se',icon:'↻',progress:true};
 if(preparation.state==='partial'||ready>0)return {...result,kind:'partial',label:'Částečně',icon:'◐'};
 return {...waiting,ready,total};
}

export function preparationSummary(preparation,tr=x=>x){
 if(!preparation)return tr('Ukázky zatím nejsou připravené.');
 const status=classifyPreparation(preparation),labels={ready:'Ukázky připravené',preparing:'Příprava ukázek probíhá',disabled:'Příprava ukázek je vypnutá',attention:preparation.state==='unavailable'?'Ukázky nejsou dostupné':'Příprava ukázek má chybu',partial:'Ukázky částečně připravené',waiting:'Ukázky čekají na přípravu'};
 return tr(labels[status.kind])+(status.total>0?' · '+status.ready+'/'+status.total:'');
}
export function previewJobMatches(job,request){
 if(job?.mode!==request.mode||!Number.isFinite(Number(job.seconds))||Math.abs(Number(job.seconds)-Number(request.seconds))>1e-6)return false;
 if(request.mode==='frames')return true;
 if(job.originalIndex!==request.originalIndex||job.reviewIndex!==request.reviewIndex)return false;
 return request.mode!=='av'||job.previewProfile===(request.previewProfile||'compact');
}
/** Cache reads never invoke review save hooks or start foreground preparation. */
export function createCachedPreviewLoader({load,readPreparation,current,onReady,onPending=()=>{},onError=()=>{},onPreparation=()=>{},delayMs=4000,timers=globalThis}){
 let epoch=0,timer=null;
 const stop=()=>{epoch++;if(timer!==null)timers.clearTimeout(timer);timer=null};
 function start(requests){
  stop();const run=epoch,pending=requests.map(request=>({...request,cachedOnly:true}));
  const valid=()=>run===epoch&&current();
  const retry=(preparation,request)=>{const job=preparation?.jobs?.find(x=>previewJobMatches(x,request));return !!job&&!['disabled','unavailable'].includes(preparation.state)&&job.status!=='error'};
  async function cycle(first){
   if(!valid())return;let preparation=null;
   try{if(!first&&readPreparation){preparation=(await readPreparation())?.preparation;if(!valid())return;onPreparation(preparation)}
    for(let i=pending.length-1;i>=0;i--){const request=pending[i];if(!valid())return;
     if(preparation){const job=preparation.jobs?.find(x=>previewJobMatches(x,request));if(!retry(preparation,request)){onPending({pending:true,preparation},request);pending.splice(i,1);continue}if(job.status!=='ready'){onPending({pending:true,preparation},request);continue}}
     const result=await load(request);if(!valid())return;if(result?.preparation)onPreparation(result.preparation);
     if(result?.pending){onPending(result,request);if(!retry(result.preparation,request))pending.splice(i,1)}else{await onReady(result,request);if(!valid())return;pending.splice(i,1)}
    }
   }catch(e){if(valid())onError(e);if(e?.status===401||e?.status===409)pending.length=0}
   if(valid()&&pending.length)timer=timers.setTimeout(()=>{timer=null;void cycle(false)},delayMs);
  }
  void cycle(true);
 }
 return {start,stop};
}

/** A saved session records manual observations; opening or playing a preview never confirms a check. */
// Kino layout: the checks/decision panel and focus mode are viewer preferences, kept across films.
const layout={panel:'open',focus:false};
try{const saved=JSON.parse(sessionStorage.getItem('tdarr-review-layout')||'null');if(saved?.panel==='closed')layout.panel='closed'}catch{}
export function mountReviewWorkflow(host,item,{api,canWrite,openComparison,openAudioComparison,onSession=()=>{},onPreparation=()=>{},preparation=null,onApprove=()=>{},onApproveOnly=()=>{},onReject=()=>{},onDeferred=()=>{},canApprove=()=>false,canApproveOnly=()=>false,isApproved=()=>false,tr=x=>x,formatBytes=x=>String(x)}={}){
 const make=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=tr(text);return n};
 const button=(text,fn,cls='secondary')=>{const n=make('button',cls,text);n.type='button';n.onclick=fn;return n};
 let dead=false,loaded=false,saving=false,conflict=false,stale=false,revision=0,session=null,baseline=null,complete=false,tracks=null,toolCleanups=[],metadataLoading=false,hdrRequired=false,observations={},scopeValid=true,explainingSave=false;
 const cacheKey='tdarr-review-draft:'+item.id+':'+item.snapshot;
 const root=make('div','review-workflow'),sidebar=make('nav','workflow-nav'),main=make('section','workflow-main'),status=make('p','workflow-status'),warning=make('div','alert workflow-warning'),steps=make('div','workflow-step-buttons'),preparationPanel=make('div','preview-preparation');
 sidebar.setAttribute('aria-label',tr('Kroky posouzení'));status.setAttribute('role','status');warning.setAttribute('role','alert');warning.hidden=true;
 // Panel and focus toggles only change the layout; they never change review state.
 const panelId='workflow-panel-'+item.id,panelToggle=button('Kontroly a rozhodnutí',()=>setPanel(layout.panel==='open'?'closed':'open',true)),focusToggle=button('Soustředit se na obraz',()=>setFocus(!layout.focus));
 panelToggle.dataset.panelToggle='';panelToggle.setAttribute('aria-controls',panelId);focusToggle.dataset.focusToggle='';
 const layoutTools=make('div','workflow-layout-tools');layoutTools.append(panelToggle,focusToggle);
 sidebar.append(make('p','eyebrow','POSOUZENÍ'),steps,status,layoutTools);root.append(sidebar,main);host.replaceChildren(root);
 function applyLayout(){root.dataset.panel=layout.panel;root.dataset.focus=layout.focus?'on':'off';panelToggle.setAttribute('aria-expanded',String(layout.panel==='open'&&!layout.focus));focusToggle.setAttribute('aria-pressed',String(layout.focus))}
 function setPanel(next,moveFocus=false){layout.panel=next;layout.focus=false;try{sessionStorage.setItem('tdarr-review-layout',JSON.stringify({panel:next}))}catch{}applyLayout();
  if(!moveFocus)return;if(next==='open')root.querySelector('.workflow-panel')?.querySelector('input,textarea,select,button:not([disabled])')?.focus();else panelToggle.focus()}
 function setFocus(on){layout.focus=on;applyLayout();focusToggle.focus()}
 applyLayout();
 const sessionDirty=()=>!!session&&JSON.stringify(session)!==JSON.stringify(baseline);
 const cache=()=>{if(!session||!loaded||dead)return;try{sessionStorage.setItem(cacheKey,JSON.stringify({revision,session}))}catch{}};
 const clearTools=()=>{scopeValid=true;for(const cleanup of toolCleanups.splice(0))cleanup?.()};
 const allowed=()=>loaded&&!dead&&!stale&&!conflict&&!saving&&canWrite();
 const validPair=()=>Number.isInteger(session?.scope.originalIndex)&&Number.isInteger(session?.scope.reviewIndex)&&(!tracks||tracks.original.some(x=>x.index===session.scope.originalIndex)&&tracks.review.some(x=>x.index===session.scope.reviewIndex));
 const validMethod=()=>session?.method!=='external'&&!hdrRequired||typeof session?.device==='string'&&session.device.trim().length>=2;
 const stepChecks=i=>i===1&&hdrRequired?['image','hdr']:STEPS[i][1];
 const beforeStep=step=>validMethod()&&STEPS.slice(0,step).every((_,i)=>stepChecks(i).every(key=>session.checks[key]))&&(step<3||validPair());
 const currentChecks=()=>scopeValid&&stepChecks(session.step).every(key=>session.checks[key]&&(session.step!==3||baseline.checks[key]));
 const labelState=()=>session?.deferred?'Posouzení odloženo':complete&&!sessionDirty()?'Posouzení uloženo a dokončeno':sessionDirty()?'Rozpracované změny':'Průběh posouzení je uložený';
 function observePreparation(value,{authoritative=false}={}){
  if(dead||value?.snapshot!==item.snapshot)return;
  // Observation time orders cache reads and items polls even when expiry or a new plan reduces ready counts.
  const hasTimes=Number.isFinite(value.updated)&&Number.isFinite(preparation?.updated);
  if(hasTimes&&value.updated<preparation.updated)return;
  if(!hasTimes&&!authoritative&&preparation?.snapshot===value.snapshot&&preparation.total===value.total&&Number(value.ready)<Number(preparation.ready))return;
  if(JSON.stringify(value)===JSON.stringify(preparation))return;preparation=value;if(!authoritative)onPreparation(value);renderPreparation();
 }
 function renderPreparation(){
  preparationPanel.replaceChildren(make('strong','',preparationSummary(preparation,tr)));preparationPanel.dataset.state=preparation?.state||'waiting';
  if(preparation?.total>0){const progress=make('progress');progress.max=preparation.total;progress.value=preparation.ready||0;progress.setAttribute('aria-label',tr('Připravené ukázky'));preparationPanel.append(progress)}
  if(preparation?.error)preparationPanel.append(make('p','failure',preparation.error));
  if(session?.step===0){preparationPanel.append(make('p','details','Ukázky se připravují předem. Navržený pár stop je pouze návrh; správné soubory a stopy potvrď ručně.'));const scope=preparation?.defaultScope;if(Number.isInteger(scope?.originalIndex)&&Number.isInteger(scope?.reviewIndex)){const label=(list,index)=>list?.find(x=>x.index===index)?.label||String(index);preparationPanel.append(make('p','details',tr('Navržený pár stop:')+' '+label(tracks?.original,scope.originalIndex)+' → '+label(tracks?.review,scope.reviewIndex)));const times=[...new Set((preparation.jobs||[]).map(x=>x.seconds).filter(Number.isFinite))].sort((a,b)=>a-b);if(times.length)preparationPanel.append(make('p','details',tr('Plánované úseky (sekundy):')+' '+times.map(x=>Number(x).toFixed(2)).join(', ')))}else if(preparation)preparationPanel.append(make('p','details','Pár stop není jednoznačný. Vyber odpovídající stopy ručně.'))}
 }
 function refreshGuard(){
  if(dead)return;status.textContent=tr(!loaded?'Načítám průběh posouzení…':saving?'Ukládám průběh posouzení…':labelState());
  for(const n of root.querySelectorAll('[data-workflow-write]')){
   const blocked=!allowed()||n.dataset.invalid==='true'||!scopeValid&&(n.hasAttribute('data-check')||n.hasAttribute('data-checkpoint')||n.hasAttribute('data-step-save'));
   // A native button remains activatable to explain its existing save guard.
   if(n.hasAttribute('data-step-save')){n.disabled=false;n.setAttribute('aria-disabled',String(blocked))}else n.disabled=blocked;
  }
  if(explainingSave)renderSaveReasons();
  for(const n of root.querySelectorAll('[data-preview-control]'))n.disabled=!allowed()||n.dataset.previewBusy==='true'||n.dataset.previewInvalid==='true';
  const approve=root.querySelector('[data-workflow-approve]');if(approve)approve.disabled=!allowed()||!complete||sessionDirty()||!canApprove();
  const only=root.querySelector('[data-workflow-approve-only]');if(only){const done=isApproved();only.disabled=done||!allowed()||!complete||sessionDirty()||!canApproveOnly();only.textContent=tr(done?'Schváleno · čeká na nahrazení':'Schválit')}
 }
 function showWarning(message,reload=false){explainingSave=false;warning.replaceChildren(make('p','',message));if(reload)warning.append(button('Načíst uložený stav',()=>loadSession(false)));warning.hidden=false;refreshGuard()}
 function applyRecord(record,{render=true}={}){
  if(record.snapshot!==item.snapshot){stale=true;showWarning('Soubory se změnily. Zavři detail a otevři aktuální film.');clearTools();return false}
  revision=record.revision;baseline=clone(record.session);session=clone(record.session);complete=record.complete===true;hdrRequired=record.requirements?.hdr===true;observations=record.observations||{};loaded=true;conflict=false;explainingSave=false;warning.hidden=true;onSession(record);if(render)renderStep();refreshGuard();return true;
 }
 async function loadSession(restoreLocal=true){
  if(dead||saving)return;clearTools();loaded=false;refreshGuard();main.replaceChildren(warning,make('p','details','Načítám průběh posouzení…'));
  try{const record=await api(`/api/items/${item.id}/review-session?snapshot=${encodeURIComponent(item.snapshot)}`);if(dead||!applyRecord(record,{render:false}))return;
   if(restoreLocal)try{const draft=JSON.parse(sessionStorage.getItem(cacheKey)||'null');if(draft?.revision===revision&&draft.session?.checks&&draft.session?.scope&&typeof draft.session.note==='string'&&typeof draft.session.device==='string'&&['review','external'].includes(draft.session.method)){session=clone(draft.session);session.step=Math.min(4,Math.max(0,session.step));if(!beforeStep(session.step))session.step=0}}catch{}
   if(!await loadTracks()||dead||stale)return;renderStep();
  }catch(e){if(!dead){showWarning(e.message,true);main.replaceChildren(warning,make('p','details','Průběh posouzení se nepodařilo načíst.'))}}
 }
 async function loadTracks(){
  if(dead||metadataLoading)return false;if(tracks)return true;metadataLoading=true;
  try{const result=await api(`/api/items/${item.id}/audio-compare`,{snapshot:item.snapshot,mode:'tracks'});if(dead||stale)return false;tracks=result;observePreparation(result.preparation);const proposed=result.defaultScope||preparation?.defaultScope;
   if(proposed&&session.scope.originalIndex===null&&session.scope.reviewIndex===null&&tracks.original.some(x=>x.index===proposed.originalIndex)&&tracks.review.some(x=>x.index===proposed.reviewIndex)){session.scope.originalIndex=proposed.originalIndex;session.scope.reviewIndex=proposed.reviewIndex}
   if(session.method==='review'&&session.scope.seconds===null&&proposed&&session.scope.originalIndex===proposed.originalIndex&&session.scope.reviewIndex===proposed.reviewIndex&&Number.isFinite(proposed.seconds)&&proposed.seconds>=0&&proposed.seconds<=Math.max(0,Math.min(item.durationA,item.durationB)-12))session.scope.seconds=proposed.seconds;
   cache();const picker=root.querySelector('[data-pair-picker]');if(picker)fillPairPicker(picker);refreshGuard();return true}
  catch(e){if(!dead)showWarning(e.message,true);return false}finally{metadataLoading=false}
 }
 function setScope(next){
  if(!allowed()||next.seconds!==null&&(!Number.isFinite(next.seconds)||next.seconds<0))return;const changedPair=next.originalIndex!==session.scope.originalIndex||next.reviewIndex!==session.scope.reviewIndex;
  const oldStep=session.step;Object.assign(session.scope,next);if(changedPair){for(const key of ['audio','syncStart','syncMiddle','syncEnd'])session.checks[key]=false;session.step=Math.min(session.step,2);complete=false;updateChecks();}
  cache();if(session.step!==oldStep)renderStep();else updateSaveButton();refreshGuard();
 }
 const setScopeValidity=valid=>{scopeValid=valid===true;updateSaveButton()};
 function updateChecks(){for(const input of root.querySelectorAll('[data-check]'))input.checked=session.checks[input.dataset.check]===true}
 async function postSession(value){
  if(!allowed())throw Error(tr('Posouzení teď nelze uložit. Obnov aktuální údaje.'));
  saving=true;refreshGuard();try{const record=await api(`/api/items/${item.id}/review-session`,{snapshot:item.snapshot,revision,session:value});if(dead)return null;if(record.snapshot!==item.snapshot){stale=true;clearTools();throw Error(tr('Soubory se změnily. Zavři detail a otevři aktuální film.'))}revision=record.revision;baseline=clone(record.session);session=clone(record.session);complete=record.complete===true;observations=record.observations||{};loaded=true;onSession(record);cache();return record}
  catch(e){if(e.status===409||/revision|reviz|jiné|changed|změnil/i.test(e.message)){conflict=true}if(!dead)showWarning(e.message,conflict);throw e}
  finally{saving=false;refreshGuard()}
 }
 // Persist a changed identity first. The server deliberately clears confirmations when method, device or pair changes.
 async function persistIdentity(){
  const identityChanged=session.method!==baseline.method||session.device!==baseline.device,pairChanged=session.scope.originalIndex!==baseline.scope.originalIndex||session.scope.reviewIndex!==baseline.scope.reviewIndex;
  if(!identityChanged&&!pairChanged)return;
  const desired=clone(session),value=clone(session);if(identityChanged){for(const key of CHECKS)value.checks[key]=false;value.step=0}else{for(const key of ['audio','syncStart','syncMiddle','syncEnd'])value.checks[key]=false;value.step=Math.min(value.step,2)}
  await postSession(value);if(dead)return;
  // Input handlers already removed checks for the previous identity. Keep subsequent manual changes as an unsaved draft.
  session={...desired,step:Math.min(desired.step,baseline.step),checks:{...baseline.checks,...desired.checks}};cache();
 }
 async function beforePreview(){await persistIdentity();if(dead||!allowed())throw Error(tr('Posouzení teď nelze uložit. Obnov aktuální údaje.'))}
 function saveReasons(){
  if(!loaded)return ['Počkej na načtení průběhu posouzení.'];
  if(stale)return ['Soubory se změnily. Zavři detail a otevři aktuální film.'];
  if(conflict)return ['Načti aktuální uložený stav posouzení z jiné relace.'];
  if(saving)return ['Počkej na dokončení ukládání posouzení.'];
  const reasons=[];
  if(!canWrite())reasons.push('Počkej na dokončení jiné akce nebo obnovy a obnov aktuální údaje.');
  if(!validMethod())reasons.push(hdrRequired?'Vyplň přehrávač nebo zařízení pro kontrolu HDR/Dolby Vision (alespoň dva znaky).':'Vyplň přehrávač nebo zařízení pro externí kontrolu (alespoň dva znaky).');
  if(!validPair())reasons.push('Vyber platný pár zvukových stop originálu a převodu.');
  if(!scopeValid)reasons.push('Vyber platný časový úsek ukázky.');
  const confirmations={preparation:'Potvrď, že porovnáváš správný originál a tento převod.',image:'Potvrď, že jsi zkontroloval obraz a výsledek je přijatelný.',hdr:'Potvrď kontrolu HDR/Dolby Vision na vhodném zařízení.',audio:'Potvrď kontrolu vybraného páru zvukových stop.',syncStart:'Potvrď synchronizaci na začátku filmu.',syncMiddle:'Potvrď synchronizaci uprostřed filmu.',syncEnd:'Potvrď synchronizaci na konci filmu.'};
  const checkpoints={syncStart:'Ulož kontrolu synchronizace na začátku filmu.',syncMiddle:'Ulož kontrolu synchronizace uprostřed filmu.',syncEnd:'Ulož kontrolu synchronizace na konci filmu.'};
  for(const key of stepChecks(session.step)){
   if(!session.checks[key])reasons.push(confirmations[key]);
   // Synchronisation requires an individual saved checkpoint even after its box is ticked.
   if(session.step===3&&!baseline.checks[key])reasons.push(checkpoints[key]);
  }
  return reasons;
 }
 function renderSaveReasons(){
  const reasons=saveReasons();warning.hidden=!reasons.length;
  if(!reasons.length)return;
  const list=make('ul');for(const reason of reasons)list.append(make('li','',reason));
  warning.replaceChildren(make('p','','Než bude možné uložit a pokračovat:'),list);
  if(conflict)warning.append(button('Načíst uložený stav',()=>loadSession(false)));
 }
 async function saveStep(){
  if(!allowed()||!currentChecks()||!validMethod()||!validPair()){explainingSave=true;renderSaveReasons();return;}
  explainingSave=false;
  const desired=clone(session),next=Math.min(4,session.step+1);try{await persistIdentity();if(dead)return;
   // These are the user's checks from this step, made against the newly selected identity.
   const keys=stepChecks(desired.step);for(const key of keys)session.checks[key]=desired.checks[key];session.note=desired.note;session.deferred=false;session.step=next;
   const record=await postSession(clone(session));if(record&&!dead){renderStep();main.querySelector('h3')?.focus({preventScroll:true})}
  }catch{refreshGuard()}
 }
 async function saveDraft(deferred=false){
  if(!allowed()||deferred&&!session.note.trim())return;const oldStep=session.step;try{await persistIdentity();if(dead)return;session.deferred=deferred;const value=clone(session);for(const key of ['syncStart','syncMiddle','syncEnd'])if(value.checks[key]&&!baseline.checks[key])value.checks[key]=false;const record=await postSession(value);if(record){if(session.step!==oldStep)renderStep();else{updateChecks();refreshObservations();updateSaveButton()}if(deferred)onDeferred(record)}}catch{}
 }
 async function saveCheckpoint(key){
  if(!allowed()||!scopeValid||!validPair())return;const value=clone(session);value.checks={...baseline.checks,[key]:session.checks[key]};value.deferred=false;
  try{const result=await postSession(value);if(result){updateChecks();refreshObservations();updateSaveButton()}}catch{}
 }
 const observationText=key=>{const saved=observations[key];if(!saved)return tr('Kontrola zatím není uložená.');return saved.scope.seconds===null?tr('Uloženo bez času kontrolovaného úseku.'):tr('Uloženo v čase:')+' '+Number(saved.scope.seconds).toFixed(2)+' s'};
 function refreshObservations(){for(const n of root.querySelectorAll('[data-observation]'))n.textContent=observationText(n.dataset.observation);for(const b of root.querySelectorAll('[data-checkpoint]'))b.dataset.invalid=String(session.checks[b.dataset.checkpoint]===baseline.checks[b.dataset.checkpoint]);refreshGuard()}
 function markWrite(n,invalid=false){n.dataset.workflowWrite='';n.dataset.invalid=String(invalid);return n}
 function field(text,input){const label=make('label','workflow-field',text);label.append(input);return label}
 function pairPicker(){const picker=make('div','workflow-pair-picker');picker.dataset.pairPicker='';fillPairPicker(picker);return picker}
 function fillPairPicker(picker){
  picker.replaceChildren();if(!tracks){picker.append(make('p','details','Načítám dostupné zvukové stopy…'));return}
  for(const [key,label,list]of [['originalIndex','Stopa originálu',tracks.original],['reviewIndex','Stopa převodu',tracks.review]]){const select=make('select');select.append(new Option(tr('Vyber zvukovou stopu'),'') );for(const track of list){const option=new Option(track.label,String(track.index));select.append(option)}select.value=session.scope[key]===null?'':String(session.scope[key]);select.onchange=()=>setScope({...session.scope,[key]:select.value===''?null:Number(select.value)});markWrite(select);picker.append(field(label,select))}
  picker.append(make('p','details','Vyber stejný jazyk a verzi zvuku. Změna páru ruší potvrzení zvuku a synchronizace.'));
 }
 function confirmation(key,text){
  const input=make('input');input.type='checkbox';input.dataset.check=key;input.checked=session.checks[key]===true;markWrite(input);input.onchange=()=>{session.checks[key]=input.checked;if(!input.checked){const at=STEPS.findIndex(([,keys])=>keys.includes(key));for(const [,keys] of STEPS.slice(at+1))for(const downstream of keys)session.checks[downstream]=false;complete=false;updateChecks()}cache();refreshGuard();updateSaveButton()};const label=make('label','workflow-confirmation');label.append(input,make('span','',text));return label;
 }
 function updateSaveButton(){const save=root.querySelector('[data-step-save]');if(save){save.dataset.invalid=String(!currentChecks()||!validMethod()||!validPair());refreshGuard()}const defer=root.querySelector('[data-defer]');if(defer){defer.dataset.invalid=String(!session.note.trim());refreshGuard()}refreshObservations()}
 function renderStep(){
  if(dead||!session)return;clearTools();steps.replaceChildren();main.replaceChildren(warning);root.dataset.step=String(session.step);
  for(const [i,[title]] of STEPS.entries()){const keys=stepChecks(i),b=button(title,()=>{if(!allowed()||i>baseline.step)return;session.step=i;cache();renderStep()});b.classList.add('workflow-step');b.setAttribute('aria-current',i===session.step?'step':'false');b.dataset.workflowWrite='';b.dataset.invalid=String(i>baseline.step);const number=make('span','workflow-number',keys.length&&keys.every(key=>session.checks[key])?'✓':String(i+1));b.prepend(number);steps.append(b)}
  const title=make('h3','',STEPS[session.step][0]);title.tabIndex=-1;renderPreparation();main.append(title,preparationPanel);
  const tools=make('div','workflow-tools'),checks=make('fieldset','workflow-checks');checks.append(make('legend','','Tvoje kontrola'));
  if(session.step===0){
   main.append(make('p','details','Vyber způsob posouzení a odpovídající zvukové stopy. Pokračuj po vlastní kontrole obou souborů.'));
   const method=make('select');method.append(new Option(tr('Nástroje v Review'),'review'),new Option(tr('Vlastní přehrávač / TV'),'external'));method.value=session.method;markWrite(method);method.onchange=()=>{session.method=method.value;if(session.method==='external')session.scope.seconds=null;for(const key of CHECKS)session.checks[key]=false;session.step=0;complete=false;cache();renderStep()};
   tools.append(field('Způsob posouzení',method));
   if(session.method==='external'||hdrRequired){const device=make('input');device.maxLength=160;device.value=session.device;device.placeholder=tr('Například TV v obýváku · Plex');markWrite(device);device.oninput=()=>{session.device=device.value;for(const key of CHECKS)session.checks[key]=false;complete=false;cache();updateChecks();updateSaveButton()};tools.append(field('Přehrávač nebo zařízení',device));if(session.method==='external')tools.append(make('p','details','Obraz, zvuk a synchronizaci potvrď podle vlastního přehrávání. Review načte pouze seznam stop.'));if(hdrRequired)tools.append(make('p','details','HDR/Dolby Vision ověř na vhodném zařízení. Náhled v prohlížeči převádí HDR do SDR.'))}
   tools.append(pairPicker());const facts=make('dl','facts');for(const [label,value] of [['Originál',formatBytes(item.originalBytes)],['Výsledek',formatBytes(item.reviewBytes)],['Délka originálu',Number.isFinite(item.durationA)?item.durationA.toFixed(3)+' s':tr('Nedoloženo')],['Délka výsledku',Number.isFinite(item.durationB)?item.durationB.toFixed(3)+' s':tr('Nedoloženo')]])facts.append(make('dt','',label),make('dd','',value));tools.append(facts);
   const download=make('a','secondary download','Stáhnout výsledek');download.href=`/api/items/${item.id}/video`;tools.append(download);
   checks.append(confirmation('preparation','Ověřil jsem, že porovnávám správný originál a tento převod.'));
  }else if(session.step<4){
   const help=['','Porovnej detaily, tmavé scény, pohyb a případné HDR.','Poslechni odpovídající dialogové stopy, hlasitost a případné výpadky.','Ověř soulad řeči nebo ruchů s obrazem na začátku, uprostřed a na konci.'][session.step];main.append(make('p','details',help));
   if(session.method==='external'){tools.append(make('p','workflow-external',tr('Posouzení na zařízení:')+' '+session.device),pairPicker(),make('p','details','Použij vlastní přehrávač a porovnej obě verze. Potvrzení níže vyplň po dokončení kontroly.'))}
   else if(session.step===1){
    const modes=make('div','comparison-controls'),toolHost=make('div');tools.append(modes,toolHost);let mode='av';const staticButton=button('Statické snímky',()=>mountMode('frames')),avButton=button('Video a zvuk',()=>mountMode('av'));modes.append(avButton,staticButton);
    markWrite(staticButton);markWrite(avButton);const mountMode=next=>{clearTools();mode=next;staticButton.setAttribute('aria-pressed',String(mode==='frames'));avButton.setAttribute('aria-pressed',String(mode==='av'));const options={host:toolHost,scope:session.scope,onScopeChange:setScope,onScopeValidityChange:setScopeValidity,onPreparation:observePreparation,preparation,canInteract:allowed,beforePreview,tracks,tr,mode:mode==='av'?'av':undefined,previewProfile:'detail',cachedAutoLoad:true,autoLoad:false};toolCleanups.push(mode==='frames'?openComparison(item,options):openAudioComparison(item,options))};mountMode('av');
   }else{const options={host:tools,scope:session.scope,onScopeChange:setScope,onScopeValidityChange:setScopeValidity,onPreparation:observePreparation,preparation,canInteract:allowed,beforePreview,tracks,tr,mode:session.step===3?'av':'audio',cachedAutoLoad:true,autoLoad:false};toolCleanups.push(openAudioComparison(item,options))}
   if(session.step===1){checks.append(confirmation('image','Zkontroloval jsem obraz a výsledek je pro mě přijatelný.'));if(hdrRequired){const device=make('input');device.value=session.device;device.readOnly=true;tools.append(field('Zařízení pro kontrolu HDR/Dolby Vision',device),button('Změnit zařízení',()=>{session.step=0;cache();renderStep()}));checks.append(confirmation('hdr','Ověřil jsem HDR/Dolby Vision na vhodném zařízení.'));tools.append(make('p','details','HDR/Dolby Vision ověř na vhodném zařízení. Náhled v prohlížeči převádí HDR do SDR.'))}}
   if(session.step===2)checks.append(confirmation('audio','Zkontroloval jsem vybraný pár zvukových stop a výsledek je pro mě přijatelný.'));
   if(session.step===3){checks.append(make('p','details','Vyber úsek, potvrď odpovídající kontrolu a ulož ji. Pak pokračuj.'));for(const [key,label,saveLabel]of [['syncStart','Ověřil jsem synchronizaci na začátku filmu.','Uložit kontrolu začátku'],['syncMiddle','Ověřil jsem synchronizaci uprostřed filmu.','Uložit kontrolu středu'],['syncEnd','Ověřil jsem synchronizaci na konci filmu.','Uložit kontrolu konce']]){const row=make('div','workflow-checkpoint'),saved=make('small','details',observationText(key)),save=button(saveLabel,()=>saveCheckpoint(key));saved.dataset.observation=key;save.dataset.checkpoint=key;markWrite(save);row.append(confirmation(key,label),saved,save);checks.append(row)}}
  }else{
   tools.append(make('p','',complete&&!sessionDirty()?'Všechny kontroly jsou potvrzené a uložené. Můžeš rozhodnout o výsledku.':'Nejprve ulož dokončené posouzení.'),make('p','details',tr('Způsob posouzení:')+' '+tr(session.method==='review'?'Nástroje v Review':'Vlastní přehrávač / TV')+(session.device?' · '+session.device:'')));
   const summary=make('ul','workflow-summary');for(const [i,[label]]of STEPS.slice(0,4).entries())summary.append(make('li','',tr(label)+' · '+tr(stepChecks(i).every(key=>session.checks[key])?'Potvrzeno':'Neověřeno')));if(hdrRequired)summary.append(make('li','','HDR/Dolby Vision · '+(session.checks.hdr?tr('Potvrzeno'):tr('Neověřeno'))));for(const [key,label]of [['syncStart','Začátek filmu'],['syncMiddle','Střed filmu'],['syncEnd','Konec filmu']])summary.append(make('li','',tr(label)+' · '+observationText(key)));tools.append(summary);checks.hidden=true;
   // Two separate decisions: approve only (no file is touched) or approve and replace now.
   if(!item.canApproveDuration){const only=button('Schválit',()=>onApproveOnly(revision),'primary');only.dataset.workflowApproveOnly='';tools.append(make('p','details','Schválit uloží rozhodnutí bez nahrazení: oba soubory zůstanou beze změny a film počká na hromadné nahrazení schválených filmů. Schválit a nahradit spustí nahrazení hned po potvrzení.'),only)}
   const approve=button(item.canApproveDuration?'Posoudit rozdíl délky':'Schválit a nahradit',onApprove,item.canApproveDuration?'primary':'secondary');approve.dataset.workflowApprove='';tools.append(approve);
  }
  // Checks, note and decisions live in one panel; in the wide layout it takes its own column beside the comparison.
  const panel=make('aside','workflow-panel');panel.id=panelId;panel.setAttribute('aria-label',tr('Kontroly a rozhodnutí'));main.append(tools,panel);panel.append(checks);
  const note=make('textarea');note.rows=3;note.maxLength=2000;note.value=session.note;markWrite(note);note.placeholder=tr('Co jsi zjistil nebo co zbývá ověřit?');note.oninput=()=>{session.note=note.value;cache();updateSaveButton()};panel.append(field('Poznámka k posouzení',note));
  const actions=make('div','workflow-actions');if(session.step<4){const next=button('Uložit a pokračovat',saveStep,'primary');next.dataset.stepSave='';markWrite(next);actions.append(next)}actions.append(markWrite(button(session.step===4?'Uložit poznámku':'Uložit rozpracované posouzení',()=>saveDraft())));
  const defer=button('Odložit posouzení',()=>saveDraft(true));defer.dataset.defer='';markWrite(defer);actions.append(defer,markWrite(button('Zamítnout převod',onReject,'reject')));panel.append(actions,make('p','details','Přehrání ukázky ani graf nepotvrzuje kvalitu. Kontroly potvrzuješ a ukládáš výslovně. Pro odložení je potřeba poznámka.'));cache();updateSaveButton();refreshGuard();
 }
 function observe(record){
  if(dead||!loaded||saving||!record||record.snapshot!==item.snapshot||record.revision<=revision)return;
  if(sessionDirty()){conflict=true;showWarning('Uložené posouzení se změnilo v jiné relaci. Načti aktuální stav před dalším uložením.',true);return}
  applyRecord(record,{render:!metadataLoading});
 }
 loadSession();return {refreshGuard,observe,observePreparation,invalidate(){stale=true;clearTools();showWarning('Soubory se změnily. Zavři detail a otevři aktuální film.')},destroy(){cache();dead=true;clearTools();host.replaceChildren()},get step(){return session?.step??0},get revision(){return revision}};
}
