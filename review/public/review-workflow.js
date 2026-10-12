const CHECKS=['preparation','image','audio','syncStart','syncMiddle','syncEnd','hdr'];
const STEPS=[['Podklady',['preparation']],['Obraz',['image']],['Zvuk',['audio']],['Synchronizace',['syncStart','syncMiddle','syncEnd']],['Rozhodnutí',[]]];
const clone=value=>JSON.parse(JSON.stringify(value));

/** A saved session records manual observations; opening or playing a preview never confirms a check. */
export function mountReviewWorkflow(host,item,{api,canWrite,openComparison,openAudioComparison,onSession=()=>{},onApprove=()=>{},onReject=()=>{},onDeferred=()=>{},canApprove=()=>false,tr=x=>x,formatBytes=x=>String(x)}={}){
 const make=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=tr(text);return n};
 const button=(text,fn,cls='secondary')=>{const n=make('button',cls,text);n.type='button';n.onclick=fn;return n};
 let dead=false,loaded=false,saving=false,conflict=false,stale=false,revision=0,session=null,baseline=null,complete=false,tracks=null,toolCleanups=[],metadataLoading=false,hdrRequired=false,observations={},scopeValid=true;
 const cacheKey='tdarr-review-draft:'+item.id+':'+item.snapshot;
 const root=make('div','review-workflow'),sidebar=make('nav','workflow-nav'),main=make('section','workflow-main'),status=make('p','workflow-status'),warning=make('div','alert workflow-warning'),steps=make('div','workflow-step-buttons');
 sidebar.setAttribute('aria-label',tr('Kroky posouzení'));status.setAttribute('role','status');warning.setAttribute('role','alert');warning.hidden=true;sidebar.append(make('p','eyebrow','POSOUZENÍ'),steps,status);root.append(sidebar,main);host.replaceChildren(root);
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
 function refreshGuard(){
  if(dead)return;status.textContent=tr(!loaded?'Načítám průběh posouzení…':saving?'Ukládám průběh posouzení…':labelState());
  for(const n of root.querySelectorAll('[data-workflow-write]'))n.disabled=!allowed()||n.dataset.invalid==='true'||!scopeValid&&(n.hasAttribute('data-check')||n.hasAttribute('data-checkpoint')||n.hasAttribute('data-step-save'));
  for(const n of root.querySelectorAll('[data-preview-control]'))n.disabled=!allowed()||n.dataset.previewBusy==='true'||n.dataset.previewInvalid==='true';
  const approve=root.querySelector('[data-workflow-approve]');if(approve)approve.disabled=!allowed()||!complete||sessionDirty()||!canApprove();
 }
 function showWarning(message,reload=false){warning.replaceChildren(make('p','',message));if(reload)warning.append(button('Načíst uložený stav',()=>loadSession(false)));warning.hidden=false;refreshGuard()}
 function applyRecord(record,{render=true}={}){
  if(record.snapshot!==item.snapshot){stale=true;showWarning('Soubory se změnily. Zavři detail a otevři aktuální film.');clearTools();return false}
  revision=record.revision;baseline=clone(record.session);session=clone(record.session);complete=record.complete===true;hdrRequired=record.requirements?.hdr===true;observations=record.observations||{};loaded=true;conflict=false;warning.hidden=true;onSession(record);if(render)renderStep();refreshGuard();return true;
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
  try{const result=await api(`/api/items/${item.id}/audio-compare`,{snapshot:item.snapshot,mode:'tracks'});if(dead||stale)return false;tracks=result;const picker=root.querySelector('[data-pair-picker]');if(picker)fillPairPicker(picker);refreshGuard();return true}
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
 async function saveStep(){
  if(!allowed()||!currentChecks()||!validMethod()||!validPair())return;
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
  const title=make('h3','',STEPS[session.step][0]);title.tabIndex=-1;main.append(title);
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
    markWrite(staticButton);markWrite(avButton);const mountMode=next=>{clearTools();mode=next;staticButton.setAttribute('aria-pressed',String(mode==='frames'));avButton.setAttribute('aria-pressed',String(mode==='av'));const options={host:toolHost,scope:session.scope,onScopeChange:setScope,onScopeValidityChange:setScopeValidity,canInteract:allowed,beforePreview,tracks,tr,mode:mode==='av'?'av':undefined,autoLoad:false};toolCleanups.push(mode==='frames'?openComparison(item,options):openAudioComparison(item,options))};mountMode('av');
   }else{const options={host:tools,scope:session.scope,onScopeChange:setScope,onScopeValidityChange:setScopeValidity,canInteract:allowed,beforePreview,tracks,tr,mode:session.step===3?'av':'audio',autoLoad:false};toolCleanups.push(openAudioComparison(item,options))}
   if(session.step===1){checks.append(confirmation('image','Zkontroloval jsem obraz a výsledek je pro mě přijatelný.'));if(hdrRequired){const device=make('input');device.value=session.device;device.readOnly=true;tools.append(field('Zařízení pro kontrolu HDR/Dolby Vision',device),button('Změnit zařízení',()=>{session.step=0;cache();renderStep()}));checks.append(confirmation('hdr','Ověřil jsem HDR/Dolby Vision na vhodném zařízení.'));tools.append(make('p','details','HDR/Dolby Vision ověř na vhodném zařízení. Náhled v prohlížeči převádí HDR do SDR.'))}}
   if(session.step===2)checks.append(confirmation('audio','Zkontroloval jsem vybraný pár zvukových stop a výsledek je pro mě přijatelný.'));
   if(session.step===3){checks.append(make('p','details','Vyber úsek, potvrď odpovídající kontrolu a ulož ji. Pak pokračuj.'));for(const [key,label,saveLabel]of [['syncStart','Ověřil jsem synchronizaci na začátku filmu.','Uložit kontrolu začátku'],['syncMiddle','Ověřil jsem synchronizaci uprostřed filmu.','Uložit kontrolu středu'],['syncEnd','Ověřil jsem synchronizaci na konci filmu.','Uložit kontrolu konce']]){const row=make('div','workflow-checkpoint'),saved=make('small','details',observationText(key)),save=button(saveLabel,()=>saveCheckpoint(key));saved.dataset.observation=key;save.dataset.checkpoint=key;markWrite(save);row.append(confirmation(key,label),saved,save);checks.append(row)}}
  }else{
   tools.append(make('p','',complete&&!sessionDirty()?'Všechny kontroly jsou potvrzené a uložené. Můžeš rozhodnout o výsledku.':'Nejprve ulož dokončené posouzení.'),make('p','details',tr('Způsob posouzení:')+' '+tr(session.method==='review'?'Nástroje v Review':'Vlastní přehrávač / TV')+(session.device?' · '+session.device:'')));
   const summary=make('ul','workflow-summary');for(const [i,[label]]of STEPS.slice(0,4).entries())summary.append(make('li','',tr(label)+' · '+tr(stepChecks(i).every(key=>session.checks[key])?'Potvrzeno':'Neověřeno')));if(hdrRequired)summary.append(make('li','','HDR/Dolby Vision · '+(session.checks.hdr?tr('Potvrzeno'):tr('Neověřeno'))));for(const [key,label]of [['syncStart','Začátek filmu'],['syncMiddle','Střed filmu'],['syncEnd','Konec filmu']])summary.append(make('li','',tr(label)+' · '+observationText(key)));tools.append(summary);checks.hidden=true;
   const approve=button(item.canApproveDuration?'Posoudit rozdíl délky':'Schválit a nahradit',onApprove,'primary');approve.dataset.workflowApprove='';tools.append(approve);
  }
  main.append(tools,checks);
  const note=make('textarea');note.rows=3;note.maxLength=2000;note.value=session.note;markWrite(note);note.placeholder=tr('Co jsi zjistil nebo co zbývá ověřit?');note.oninput=()=>{session.note=note.value;cache();updateSaveButton()};main.append(field('Poznámka k posouzení',note));
  const actions=make('div','workflow-actions');if(session.step<4){const next=button('Uložit a pokračovat',saveStep,'primary');next.dataset.stepSave='';markWrite(next);actions.append(next)}actions.append(markWrite(button(session.step===4?'Uložit poznámku':'Uložit rozpracované posouzení',()=>saveDraft())));
  const defer=button('Odložit posouzení',()=>saveDraft(true));defer.dataset.defer='';markWrite(defer);actions.append(defer,markWrite(button('Zamítnout převod',onReject,'reject')));main.append(actions,make('p','details','Přehrání ukázky ani graf nepotvrzuje kvalitu. Kontroly potvrzuješ a ukládáš výslovně. Pro odložení je potřeba poznámka.'));cache();updateSaveButton();refreshGuard();
 }
 function observe(record){
  if(dead||!loaded||saving||!record||record.snapshot!==item.snapshot||record.revision<=revision)return;
  if(sessionDirty()){conflict=true;showWarning('Uložené posouzení se změnilo v jiné relaci. Načti aktuální stav před dalším uložením.',true);return}
  applyRecord(record,{render:!metadataLoading});
 }
 loadSession();return {refreshGuard,observe,invalidate(){stale=true;clearTools();showWarning('Soubory se změnily. Zavři detail a otevři aktuální film.')},destroy(){cache();dead=true;clearTools();host.replaceChildren()},get step(){return session?.step??0},get revision(){return revision}};
}
