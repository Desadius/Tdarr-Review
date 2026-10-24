import {tr,locale,language} from '/i18n.js?v=__APP_VERSION__';
import {el,button,date} from '/ui-kit.js?v=__APP_VERSION__';
import {errorText} from '/error-messages.js?v=__APP_VERSION__';
import {renderLibraryPaths,renderPathDiagnostics,libraryPathsPatch} from '/library-paths-view.js?v=__APP_VERSION__';
import {renderSonarrInspector} from '/sonarr-view.js?v=__APP_VERSION__';

const fields=[
 ['review','label','Název instalace','text',0],['review','publicOrigin','Veřejná adresa Review','url',0],['review','tdarrUrl','Společná adresa API Tdarr','url',0],['review','libraryId','ID knihovny Tdarr (Off dovoluje automatický výběr)','text',0],
 ['radarr','url','Společná adresa Radarru (volitelné v Off)','url',0],['radarr','apiKey','API klíč Radarru (prázdné = zachovat)','password',0],['radarr','preferCzechEnglish','Preferovat české a anglické audio','checkbox',0],
 ['sonarr','url','Adresa Sonarru pro ruční kontrolu','url',0],['sonarr','apiKey','API klíč Sonarru (prázdné = zachovat)','password',0],
 ['review','mediaRoot','Originály v kontejneru Review','text',1],['review','reviewRoot','Výsledky v kontejneru Review','text',1],['review','sourceRoots','Zdrojové cesty v Tdarru (jedna na řádek)','list',1],['recovery','sourceRoot','Zdrojová cesta vybraná pro Recovery','select',1],['review','tdarrReviewRoot','Cesta výsledků viditelná Tdarru','text',1],['radarr','mediaRoot','Cesta knihovny viditelná Radarru','text',1],['radarr','quarantineRoot','Karanténa ručních náhrad Review','text',1],['recovery','quarantineRoot','Karanténa automatických obnov Recovery','text',1],
 ['recovery','maxRepairsPerDay','Nejvýše obnov za den','number',2],['recovery','movieCooldownDays','Odstup obnov stejného filmu (dny)','number',2],
 ['review','database','Databáze Tdarr v kontejneru Review','text',3],['review','ffmpeg','Program FFmpeg','text',3],['review','ffprobe','Program FFprobe','text',3],['review','reviewPrefixes','Podsložky výsledků odebrané z cesty (jedna na řádek)','list',3],['recovery','reports','Adresář reportů Tdarr','text',3],['recovery','stableMinutes','Stabilita originálu před kontrolou (minuty)','number',3],['recovery','confirmDelaySeconds','Odstup nezávislých kontrol (sekundy)','number',3],['recovery','pollSeconds','Interval kontrol Recovery (sekundy)','number',3],['recovery','decodeTimeoutHours','Časový limit dekódování (hodiny)','number',3],['recovery','fullSourceHash','Ověřovat celý SHA-256 originálu','checkbox',3],['recovery','detectTerminalHeaders','Zjišťovat poškozené terminální hlavičky','checkbox',3],
];
const fieldLabel=field=>fields.find(([s,k])=>s+'.'+k===field)?.[2]||field;
const stateNames={idle:'Žádné čekající použití',waiting:'Čekám na nečinné Review',draining:'Dokončuji operaci Recovery',validating:'Ověřuji uložený návrh',stopping:'Zastavuji připravené Recovery',committing:'Zapisuji celou konfiguraci',starting:'Spouštím Recovery',finalizing:'Dokončuji zápis historie',succeeded:'Změny použity',failed:'Použití selhalo',cancelled:'Použití zrušeno',interrupted:'Použití bylo přerušeno'};
const terminal=new Set(['idle','succeeded','failed','cancelled','interrupted']);
const cancellable=new Set(['waiting','draining','validating']);
const safeRevisionErrors=new Set(['settings_invalid','settings_history_acknowledgement','settings_frozen','settings_pending_cases','settings_migration_conflict']);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const libraryPathsUi={el,button,tr};
const localDate=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16):'';};

export function installSharedSettings(app){
 const dialog=el('dialog','settings-dialog shared-settings-dialog');dialog.id='sharedSettings';document.body.append(dialog);
 const card=el('article');card.append(el('h2','','Recovery a společná konfigurace'),el('p','','Průvodce připojením, mapováním knihovny a limity obnov. Uložený návrh a bezpečné použití změn.'),button('Nastavit Recovery a společné připojení',()=>open()));document.getElementById('view-settings').querySelector('.settings-grid').append(card);
 let tested=null,saved=null,runtime=null,inputs={},controls={},choices={},step=0,dirty=false,conflicted=false,busy=false,timer=null,operation={state:'idle'},status,summary,form,groups,advanced,history,ack,customSince,since,stepInfo,tvPanel,tvDraft=null,sonarrPanel=null,pathsDiagnostic=null,checkingPaths=false;
 const api=(route,body)=>app.api('/api/shared-settings'+route,body);
 const message=error=>{const code=error?.code||error?.data?.code;return (errorText(code,{},language)||tr('Nastavení se nepodařilo zpracovat.'))+(error?.field||error?.data?.field?' · '+tr(fieldLabel(error.field||error.data.field)):'');};
 function currentPatch(){
  const patch={};for(const [section,key,,type] of fields){const input=inputs[section+'.'+key],value=type==='checkbox'?input.checked:type==='number'?Number(input.value):type==='list'?input.value.split('\n').map(x=>x.trim()).filter(Boolean):input.value.trim();if(key==='apiKey'&&!value)continue;if(!same(value,saved.draft[section]?.[key]))(patch[section]??={})[key]=value;}
  const tvPatch=libraryPathsPatch(tvDraft,saved.draft);if(tvPatch)Object.assign(patch,tvPatch);
  if(customSince.checked){const value=new Date(since.value).getTime();if(value!==saved.draft.recovery.since)(patch.recovery??={}).since=value;}
  return patch;
 }
 // What applying the tested draft clears: nothing, only prepared samples, or saved reviews, Approve decisions and samples.
 function invalidationText(value){
  if(value.level==='none')return tr('Použití nic nesmaže.');
  const causes=' '+tr('Změněná pole')+': '+value.fields.map(key=>tr(fieldLabel('review.'+key))).join(', ')+'.';
  if(value.level==='samples')return tr('Použití smaže jen připravené vzorky.')+causes;
  return tr('Použití smaže uložená posouzení, rozhodnutí Approve a připravené vzorky.')+' '+tr('Uložená posouzení')+': '+value.reviews+' · '+tr('Rozhodnutí Approve')+': '+value.approvals+'.'+causes;
 }
 function changed(){dirty=Object.keys(currentPatch()).length>0||Object.values(choices).some(input=>!!input.value);update();}
 function update(){
  if(!saved)return;const pending=!terminal.has(operation.state);
  controls.save.disabled=busy||pending||conflicted||checkingPaths;
  // Apply needs the Test result of this exact saved draft: it carries what applying clears.
  controls.test.disabled=busy||pending||dirty||conflicted;controls.apply.disabled=controls.test.disabled||tested?.revision!==saved.revision;
  controls.cancel.disabled=busy||!cancellable.has(operation.state)||!!operation.cancelling;
  controls.reload.disabled=busy||pending;
  for(const input of Object.values(inputs))input.disabled=busy||pending;
  customSince.disabled=busy||pending||!saved.historyUsesSetupTime;since.disabled=ack.disabled=busy||pending;since.disabled||= !customSince.checked;
  for(const input of Object.values(choices))input.disabled=busy||pending;
  if(tvPanel){tvPanel.querySelectorAll('[data-tv-field]').forEach(input=>input.disabled=busy||pending);tvPanel.querySelectorAll('[data-tv-action]').forEach(control=>control.disabled=busy||pending||checkingPaths);tvPanel.pathCheckButton.disabled=busy||pending||checkingPaths||dirty||conflicted;tvPanel.pathDirtyHint.hidden=!dirty&&!conflicted;tvPanel.pathOutput.replaceChildren();if(pathsDiagnostic&&pathsDiagnostic.revision===saved.revision&&!dirty&&!conflicted)tvPanel.pathOutput.append(renderPathDiagnostics(pathsDiagnostic.paths,libraryPathsUi));}
  sonarrPanel?.setAvailability({isDirty:dirty||conflicted||busy||pending,isConfigured:!!saved.draft.sonarr?.url&&saved.draft.sonarr?.hasApiKey===true,isSourceConfigured:!!saved.draft.libraries?.tv?.sonarrRoot&&!!saved.draft.libraries?.tv?.mediaRoot});
  const guided=!saved.managed;groups.forEach((group,index)=>group.hidden=guided&&index!==step);advanced.hidden=guided&&step!==2;
  controls.previous.hidden=controls.next.hidden=!guided;controls.previous.disabled=step===0;controls.next.disabled=step===2;
  stepInfo.textContent=guided?tr('První nastavení')+' · '+(step+1)+' / 3':tr('Běžná správa');
  const runtimeLabels={off:'Neběží',running:'Běží',restarting:'Restartuje se',refused:'Spuštění odmítnuto',stopped:'Zastaveno',unreadable:'Stav nelze přečíst',unknown:'Stav není známý'};
  summary.replaceChildren();const lines=[['Uložený návrh',saved.revision?.slice(0,12)],['Používaná konfigurace',saved.active?String(saved.generation):tr('Používá dosavadní souborové nastavení (bez spravované generace)')],['Skutečný stav Recovery',(runtime?.mode?runtime.mode[0].toUpperCase()+runtime.mode.slice(1):tr('Stav není známý'))+' · '+tr(runtimeLabels[runtime?.state]||'Stav není známý')]];
  for(const [label,value] of lines){const line=el('p');line.append(el('strong','',label),el('span','',' · '+value,true));summary.append(line);}
  if(tested?.revision===saved.revision)summary.append(el('p',tested.invalidation.level==='none'?'details':'alert',invalidationText(tested.invalidation),true));else if(!dirty&&!conflicted)summary.append(el('p','details','Před použitím návrh otestuj. Test ukáže, co použití smaže.'));
  summary.append(el('p','details','Režim určuje RECOVERY_MODE. Tato stránka ho nemění.'),el('p','details',dirty?'Formulář má neuložené změny. Před testem nebo použitím ulož návrh.':'Zobrazený návrh je uložený na serveru a může se lišit od používané konfigurace.'));
  const state=el('p',operation.state==='idle'?'details':operation.state==='succeeded'?'success':'alert');state.setAttribute('role','status');state.append(el('strong','',stateNames[operation.state]||'Stav není známý'));if(operation.error)state.append(el('span','',' · '+message(operation.error),true));summary.append(state);if(operation.auditError)summary.append(el('p','alert failure',errorText(operation.auditError,{},language)||tr('Historii se nepodařilo zapsat.')));
  if(operation.state==='failed'||operation.state==='interrupted')summary.append(el('p','details','Zkontroluj návrh a stav Recovery. Nová konfigurace se automaticky nevrací zpět a přerušené použití se samo neopakuje.'));
 }
 function sources(){const input=inputs['recovery.sourceRoot'],selected=input.value||saved.draft.recovery.sourceRoot,roots=inputs['review.sourceRoots'].value.split('\n').map(x=>x.trim()).filter(Boolean);input.replaceChildren();for(const root of roots){const option=el('option','',root,true);option.value=root;input.append(option);}input.value=roots.includes(selected)?selected:'';}
 function redirectIfCommitted(value){const target=value?.publicOrigin||operation.publicOrigin;if(!target||!['committing','starting','finalizing','succeeded'].includes(value?.state||operation.state))return false;let next;try{next=new URL(target);}catch{return false;}if(next.origin===location.origin)return false;location.assign(next.origin+'/?lang='+language+'#settings');return true;}
 async function refreshStatus(){
  try{operation=await api('/status');update();if(operation.state==='succeeded'&&redirectIfCommitted(operation))return;if(terminal.has(operation.state)){const finished=operation,previousStep=step;clearInterval(timer);timer=null;const latest=await api('');saved=latest;operation=latest.apply||finished;try{runtime=await app.api('/api/recovery/runtime');}catch{}build();step=previousStep;status.textContent=finished.error?message(finished.error):tr(stateNames[finished.state]||'Stav není známý');update();app.forceRender();await app.load();}}
  catch(error){if(error.status===403){if(redirectIfCommitted(operation))return;status.textContent=tr('Adresa Review se mohla změnit. Poslední známý stav použití je zachovaný.');let target;try{target=new URL(operation.publicOrigin);}catch{}if(target&&['http:','https:'].includes(target.protocol)&&!target.username&&!target.password&&!target.search&&!target.hash&&target.pathname==='/'){const link=el('a','','Otevřít nastavenou adresu');link.href=target.origin+'/?lang='+language+'#settings';status.append(link);}return;}status.textContent=message(error);}
 }
 function watch(){if(timer)clearInterval(timer);if(!terminal.has(operation.state))timer=setInterval(()=>{if(dialog.open)void refreshStatus();},1000);}
 async function checkLibraryPaths(){
  if(checkingPaths||dirty||conflicted||busy||!saved?.revision)return;
  const revision=saved.revision;checkingPaths=true;status.textContent=tr('Ověřuji uložené cesty…');update();
  try{const result=await api('/paths?revision='+encodeURIComponent(revision));pathsDiagnostic={revision,paths:result.paths};status.textContent=tr('Kontrola cest dokončena. Zobrazený výsledek je pouze pro čtení.');}
  catch(error){pathsDiagnostic=null;status.textContent=message(error);}
  finally{checkingPaths=false;update();}
 }
 async function action(kind){
  if(busy||!terminal.has(operation.state)||kind==='save'&&conflicted)return;if(kind!=='save'&&(dirty||conflicted))return;busy=true;update();status.textContent=tr(kind==='save'?'Ukládám návrh…':'Ověřuji uložený návrh…');
  try{
   const input={revision:saved.revision,acknowledgeHistory:ack.checked};
   if(kind==='save'){
    const resolutions=Object.entries(choices).filter(([,select])=>select.value).map(([field,select])=>field==='legacyFiles'?field:{field,source:select.value});
    const previousHistory=saved.history||[],result=await api('/draft',{...input,patch:currentPatch(),resolutions});saved=result;pathsDiagnostic=null;let auditRefreshFailed=false;try{saved.history=(await api('/audit')).history;}catch{saved.history=previousHistory;auditRefreshFailed=true;}dirty=false;conflicted=false;build();status.textContent=tr('Návrh uložen. Běžící služby používají dosavadní konfiguraci.');if(auditRefreshFailed)status.append(el('small','','Historii se nepodařilo obnovit. Načti aktuální návrh.'));
   }else if(kind==='test'){const result=await api('/test',input);tested={revision:saved.revision,invalidation:result.invalidation};if(result.paths)pathsDiagnostic={revision:saved.revision,paths:result.paths};status.textContent=tr('Uložený návrh prošel diagnostikou. Test neschvaluje žádnou opravu.')+' '+invalidationText(result.invalidation);}
   else{const {level,reviews,approvals}=tested.invalidation;operation=await api('/apply',{...input,invalidation:{level,reviews,approvals}});status.textContent=tr('Použití změn bylo vyžádáno. Čekání lze zrušit.');watch();}
  }catch(error){
   const code=error.code||error.data?.code;if(kind==='save'&&code==='settings_conflict')conflicted=true;
   else if(kind==='save'&&safeRevisionErrors.has(code)&&typeof (error.revision||error.data?.revision)==='string')saved.revision=error.revision||error.data.revision;
   status.textContent=message(error);if(conflicted)status.append(el('span','',' Načti aktuální návrh; neuložený formulář zatím zůstává zobrazený.'));
  }finally{busy=false;update();}
 }
 function auditTable(records){const table=el('table','settings-audit'),head=el('tr');for(const title of ['Čas','Akce','Výsledek akce','Změněná pole','Generace'])head.append(el('th','',title));table.append(head);const labels={create:'Vytvoření',save:'Uložení',apply:'Použití',startup:'Spuštění',cancel:'Zrušení',success:'Úspěch',failure:'Selhání',interrupted:'Přerušeno',cancelled:'Zrušeno'};for(const row of records.slice(-200).reverse()){const trNode=el('tr');for(const value of [date(row.at),tr(labels[row.action]||row.action),tr(labels[row.result]||row.result),(row.fields||[]).map(k=>tr(fieldLabel(k))).join(', '),String(row.generation)+' · '+(row.revision||'').slice(0,10)])trNode.append(el('td','',value,true));table.append(trNode);}return table;}
 function build(){
  inputs={};choices={};step=0;tvDraft=saved.draft.libraries?.tv??null;tvPanel=null;sonarrPanel=null;dialog.replaceChildren(el('h2','','Společné nastavení Review a Recovery'));
  const intro=el('p','','Ulož návrh, otestuj ho a výslovně použij změny. Uložení funguje i při nedostupném Tdarru nebo Radarru.');summary=el('section','settings-summary');status=el('p','shared-settings-status');status.setAttribute('role','status');
  form=el('form');form.id='sharedSettingsForm';groups=['1. Připojení','2. Mapování knihovny','3. Limity Recovery'].map(title=>{const fieldset=el('fieldset','settings-group');fieldset.append(el('legend','',title));return fieldset;});advanced=el('details','settings-advanced');advanced.append(el('summary','','Pokročilé volby'));const advancedBody=el('div');advanced.append(advancedBody);
  for(const [section,key,label,type,group] of fields){const input=el(type==='list'?'textarea':type==='select'?'select':'input');if(!['list','select'].includes(type))input.type=type;input.setAttribute('data-setting',section+'.'+key);input.name=section+'.'+key;input.id='shared-'+section+'-'+key;
   const value=saved.draft[section]?.[key];if(type==='checkbox')input.checked=value===true;else input.value=key==='apiKey'?'':type==='list'?(value||[]).join('\n'):String(value??'');if(type==='password'){input.autocomplete='new-password';input.spellcheck=false;}if(type==='number'){input.min=key==='maxRepairsPerDay'?'1':'0';input.step=key==='maxRepairsPerDay'?'1':'any';if(['pollSeconds','confirmDelaySeconds'].includes(key))input.max='2147483';if(key==='decodeTimeoutHours')input.min='0.000001';}
   const wrapper=el('label','settings-field',label);wrapper.setAttribute('for',input.id);wrapper.append(input);if(key==='apiKey')wrapper.append(el('small','',saved.draft[section].hasApiKey?'API klíč je uložený; hodnotu prohlížeč neobdrží.':'API klíč zatím není uložený.'));(group===3?advancedBody:groups[group]).append(wrapper);inputs[section+'.'+key]=input;input.oninput=input.onchange=()=>{if(key==='sourceRoots')sources();changed();};}
  const sonarrConfigured=!!saved.draft.sonarr?.url&&saved.draft.sonarr?.hasApiKey===true;
  const sonarrSourceConfigured=!!saved.draft.libraries?.tv?.sonarrRoot&&!!saved.draft.libraries?.tv?.mediaRoot;
  sonarrPanel=renderSonarrInspector({el,button,api:app.api,revision:saved.revision,configured:sonarrConfigured,sourceConfigured:sonarrSourceConfigured,dirty:dirty||conflicted});groups[0].append(sonarrPanel);
  sources();groups[1].insertBefore(el('p','details','Tdarr, kontejner Review a Radarr mohou používat různé cesty ke stejným filmům. Recovery vybírá jednu zdrojovou cestu Tdarru. Obě karantény jsou samostatné.'),groups[1].children[1]);
  tvPanel=renderLibraryPaths({tv:tvDraft,onChange:value=>{tvDraft=value;pathsDiagnostic=null;changed();},onCheck:()=>void checkLibraryPaths(),disabled:busy||!terminal.has(operation.state),checking:checkingPaths,dirty,ui:libraryPathsUi});groups[1].append(tvPanel);
  customSince=el('input');customSince.type='checkbox';customSince.checked=!saved.historyUsesSetupTime;customSince.setAttribute('data-setting','customSince');const customLabel=el('label','settings-check','Použít vlastní časovou hranici chyb');customLabel.prepend(customSince);since=el('input');since.type='datetime-local';since.value=localDate(saved.draft.recovery.since);since.setAttribute('data-setting','recovery.since');const sinceLabel=el('label','settings-field','Začátek historie v místním čase');sinceLabel.append(since);ack=el('input');ack.type='checkbox';ack.setAttribute('data-setting','acknowledgeHistory');const ackLabel=el('label','settings-check','Výslovně potvrzuji zahrnutí starší historie a její možný rozsah.');ackLabel.prepend(ack);advancedBody.append(customLabel,sinceLabel,el('p','details','Bez vlastní hranice nová instalace sleduje chyby od dokončení použití nastavení. Existující hranice se zachová.'),ackLabel);customSince.onchange=since.oninput=()=>changed();
  const migrations=el('section','settings-migrations');if(saved.conflicts?.length){migrations.append(el('h3','','Vyřeš rozdíly převzatých nastavení'));for(const choice of saved.migrationChoices||saved.conflicts.map(field=>({field}))){const wrapper=el('label','settings-field',fieldLabel(choice.field)),select=el('select');select.setAttribute('data-conflict',choice.field);for(const [value,title] of [['','Vyber výslovné rozhodnutí'],['shared',choice.field==='legacyFiles'?'Potvrdit změnu souborů a znovu načíst soukromé výjimky':'Použít společný návrh'],...(choice.field==='legacyFiles'?[]:[['recovery','Převzít původní hodnotu Recovery']])]){const option=el('option','',title);option.value=value;select.append(option);}select.value='';wrapper.append(select);if(choice.secret)wrapper.append(el('small','','Volba klíče proběhne na serveru. Jeho hodnotu prohlížeč neobdrží.'));else if(choice.field!=='legacyFiles')wrapper.append(el('small','',JSON.stringify(choice.sharedValue)+' → '+JSON.stringify(choice.recoveryValue),true));migrations.append(wrapper);choices[choice.field]=select;select.onchange=changed;}}
  const privateHelp=el('p','details','Soukromý registr, approvedCaseIds a approvedImportRepairs zůstávají pouze v souborech. Zmrazené důkazy a nedokončené případy nelze tímto editorem obejít ani migrovat.');
  if(saved.active){const active=el('details','settings-active'),values=el('dl','facts');active.append(el('summary','','Zobrazit používané hodnoty'));for(const [section,key,label,type] of fields){if(key==='apiKey')continue;const value=saved.active[section]?.[key];values.append(el('dt','',label),el('dd','',Array.isArray(value)?value.join('\n'):type==='checkbox'?tr(value?'Ano':'Ne'):String(value??''),true));}values.append(el('dt','','Začátek historie v místním čase'),el('dd','',date(saved.active.recovery.since),true));active.append(values);dialog.append(active);}
  stepInfo=el('p','details');controls={previous:button('Zpět',()=>{step--;update();}),next:button('Pokračovat',()=>{step++;update();}),save:button('Uložit návrh',()=>action('save'),'primary'),test:button('Otestovat uložený návrh',()=>action('test')),apply:button('Použít změny',()=>action('apply'),'primary'),cancel:button('Zrušit čekající použití',async()=>{try{operation=await api('/cancel',{id:operation.id});update();}catch(error){status.textContent=message(error);}}),reload:button('Načíst aktuální návrh',()=>open()),close:button('Zavřít',()=>dialog.close())};
  for(const [key,control] of Object.entries(controls))control.setAttribute('data-settings-action',key);
  const navigation=el('div','dialog-actions');navigation.append(stepInfo,controls.previous,controls.next);const actions=el('div','dialog-actions');actions.append(controls.close,controls.reload,controls.save,controls.test,controls.apply,controls.cancel);form.onsubmit=event=>{event.preventDefault();void action('save');};form.append(navigation,...groups,advanced,migrations,privateHelp,status,actions);const historyDetails=el('details','settings-history');history=el('div');historyDetails.append(el('summary','','Historie změn'),history);history.append(auditTable(saved.history||[]));dialog.append(intro,summary,form,historyDetails);update();
 }
 async function open(){try{const value=await api('');let observed;try{observed=await app.api('/api/recovery/runtime');}catch{observed={state:'unreadable',mode:'unknown'};}saved=value;runtime=observed;operation=value.apply||{state:'idle'};dirty=false;conflicted=false;pathsDiagnostic=null;checkingPaths=false;build();if(!dialog.open)dialog.showModal();watch();}catch(error){app.error(error);}}
 dialog.addEventListener('close',()=>{clearInterval(timer);timer=null;for(const input of Object.values(inputs))if(input.type==='password')input.value='';});
 return open;
}
