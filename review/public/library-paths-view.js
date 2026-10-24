export const EMPTY_TV_LIBRARY=Object.freeze({enabled:false,mediaRoot:'',reviewRoot:'',libraryId:'',sourceRoots:[],tdarrReviewRoot:'',reviewPrefixes:[],sonarrRoot:'',quarantineRoot:'',reports:''});

const tvFields=[
 ['mediaRoot','Originály TV v kontejneru Review','text'],
 ['reviewRoot','Výsledky TV v kontejneru Review','text'],
 ['libraryId','ID knihovny TV v Tdarru','text'],
 ['sourceRoots','Zdrojové cesty TV v Tdarru (jedna na řádek)','list'],
 ['tdarrReviewRoot','Výsledky TV viditelné Tdarru','text'],
 ['reviewPrefixes','Podsložky výsledků TV odebrané z cesty (jedna na řádek)','list'],
 ['sonarrRoot','Kořen knihovny TV viditelný Sonarru','text'],
 ['quarantineRoot','Karanténa TV v kontejneru Review','text'],
 ['reports','Reporty TV Tdarru viditelné Review','text'],
];
const roles={source:'Zdroj',result:'Výsledek',quarantine:'Karanténa',reports:'Reporty',database:'Databáze',data:'Data'};
const statuses={ready:'Připraveno',not_configured:'Není nastaveno',missing_or_unmounted:'Chybí nebo není připojeno',not_directory:'Není adresář',not_file:'Není soubor',unreadable:'Nelze číst',not_writable:'Nelze zapisovat',unsafe_path:'Nebezpečná cesta',unavailable:'Nelze ověřit'};
const issues={overlap:'Některé nastavené cesty se překrývají.',quarantine_mount_incompatible:'Karanténa není na bezpečně kompatibilním připojení.',namespace_unverified:'Překlad cesty mezi kontejnery nelze ověřit.',processing_unavailable:'Zpracování TV zatím není dostupné.'};
const tvFieldHelp={sourceRoots:'Tyto cesty popisují umístění souborů viditelné Tdarru, ne identitu epizody.',tdarrReviewRoot:'Jde o přeloženou cestu výsledků, kterou vidí Tdarr.',sonarrRoot:'Jde o přeložený kořen knihovny, který vidí Sonarr.'};
const readOnlyRoles=new Set(['reports','database']);

function listValue(value){return Array.isArray(value)?value.join('\n'):'';}
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
export function libraryPathsPatch(tv,savedDraft){return JSON.stringify(stable(tv))===JSON.stringify(stable(savedDraft?.libraries?.tv??null))?null:{libraries:{tv}};}
function readTvDescriptor(formFields,existing){
 return {...makeTvDescriptor(),...(existing||{}),...Object.fromEntries(tvFields.map(([field,,type])=>[field,type==='list'?formFields.querySelector(`[data-tv-field="${field}"]`)?.value.split('\n').map(x=>x.trim()).filter(Boolean)??[]:formFields.querySelector(`[data-tv-field="${field}"]`)?.value.trim()??''])),enabled:false};
}
function tvFieldInput(key,value,{el,tr}){
 const [,label,type]=tvFields.find(([field])=>field===key);
 const input=el(type==='list'?'textarea':'input');if(type!=='list')input.type='text';input.name='libraries.tv.'+key;input.dataset.tvField=key;
 input.value=type==='list'?listValue(value):String(value??'');
 const wrapper=el('label','settings-field',label);wrapper.append(input);if(tvFieldHelp[key])wrapper.append(el('small','',tvFieldHelp[key]));return {input,wrapper};
}
function makeTvDescriptor(){return {...EMPTY_TV_LIBRARY,sourceRoots:[],reviewPrefixes:[]};}

export function renderLibraryPaths({tv,paths,onChange,onCheck,disabled=false,checking=false,dirty=false,ui}){
 const {el,button,tr}=ui;
 const panel=el('section','tv-library-settings');panel.setAttribute('aria-label',tr('Cesty knihovny TV'));
 panel.append(el('p','details','Viditelná složka /media sama o sobě neznamená, že jsou cesty TV nastavené. Tyto hodnoty popisují cesty uvnitř jednotlivých kontejnerů. Změna mapování vyžaduje výslovné znovuvytvoření kontejnerů; tato kontrola nic nemění.'));
 panel.append(el('p','details','Cesty Tdarru a Sonarru jsou překlady umístění mezi kontejnery. Samy neurčují, ke které epizodě soubor patří.'));
 panel.append(el('p','details','Zpracování TV zůstává nedostupné do zpřístupnění samostatných bezpečnostních opatření.'));
 const details=el('details','settings-advanced tv-library-details');details.open=!!tv;
 details.append(el('summary','','Volitelné cesty knihovny TV'));
 let removed=!tv;
 const formFields=el('div');
 const add=button('Přidat cestu knihovny TV',()=>{if(add.disabled)return;removed=false;renderFields();onChange?.(makeTvDescriptor());});add.dataset.tvAction='add';add.disabled=disabled||checking;
 const remove=button('Odebrat TV cesty',()=>{if(remove.disabled)return;removed=true;details.open=false;formFields.replaceChildren();add.hidden=false;remove.hidden=true;onChange?.(null);});remove.classList.add('secondary');remove.dataset.tvAction='remove';remove.disabled=disabled||checking;
 function renderFields(){
  formFields.replaceChildren();
  if(removed){add.hidden=false;remove.hidden=true;return;}
  add.hidden=true;remove.hidden=false;
  const descriptor=tv||makeTvDescriptor();
  for(const [key] of tvFields){const {input,wrapper}=tvFieldInput(key,descriptor[key],ui);input.disabled=disabled;input.oninput=input.onchange=()=>{
   onChange?.(readTvDescriptor(formFields,tv));
  };formFields.append(wrapper);}
  const actionRow=el('div','dialog-actions');actionRow.append(remove);formFields.append(actionRow);
 }
 details.append(add,formFields);panel.append(details);renderFields();

 const diagnosticControls=el('div','tv-path-diagnostic-controls');
 const check=button(checking?'Kontroluji cesty…':'Ověřit cesty knihoven',()=>{if(!check.disabled)onCheck?.();});
 check.disabled=disabled||checking||dirty;
 diagnosticControls.append(check);
 const dirtyHint=el('p','details','Nejprve ulož změny. Kontrola ověřuje výhradně uložený návrh.');dirtyHint.hidden=!dirty;diagnosticControls.append(dirtyHint);
 panel.append(diagnosticControls);
 const pathOutput=el('div','tv-path-output');if(paths)pathOutput.append(renderPathDiagnostics(paths,ui));panel.append(pathOutput);
 panel.append(el('p','details','Kontrola pouze čte metadata a oprávnění. Nedokazuje budoucí úspěšný zápis ani transakci; jednotlivé operace musí oprávnění ověřovat znovu. Šablona kontejneru dodá počáteční hodnoty při aktivaci společného nastavení. Pozdější změny šablony aktivní konfiguraci nezmění.'));
 panel.pathCheckButton=check;panel.pathDirtyHint=dirtyHint;panel.pathOutput=pathOutput;
 return panel;
}

export function renderPathDiagnostics(paths,ui){
 const {el,tr}=ui;
 const section=el('section','tv-path-diagnostics');section.setAttribute('aria-label',tr('Výsledek kontroly cest'));
 section.append(el('h3','','Výsledek kontroly cest knihoven'));
 if(paths?.readOnly===true&&paths?.processingEnabled===false)section.append(el('p','details','Kontrola je pouze pro čtení. Zpracování knihoven se tímto tlačítkem nespouští.'));
 for(const library of paths?.libraries||[]){
  const heading=library.id==='tv'?'Televizní knihovna':'Filmová knihovna';section.append(el('h4','',heading));
  for(const item of library.paths||[]){
   const row=el('div','tv-path-row');row.append(el('strong','',roles[item.role]||item.role||'Cesta'),el('code','',item.path||'—'));
   let detail=tr(statuses[item.status]||statuses.unavailable);
   if(item.status==='ready'){detail+=' · '+tr(item.readable?'Čtení ověřeno':'Čtení nepotvrzeno');const writeStatus=readOnlyRoles.has(item.role)&&!item.writable?'Zápis se nevyžaduje':item.writable?'Oprávnění zápisu dostupné':'Oprávnění zápisu nepotvrzené';detail+=' · '+tr(writeStatus);}
   else if(item.status==='not_configured')detail+=' · '+tr(item.required?'Povinná cesta':'Volitelná cesta');
   row.append(el('span',item.status==='ready'?'success':'details',detail,true));section.append(row);
  }
  for(const issue of library.issues||[]){const text=tr(issues[issue.code]||'Některá nastavená cesta vyžaduje pozornost.');const rolesText=(issue.roles||[]).map(role=>tr(roles[role]||role)).join(', ');section.append(el('p','alert',rolesText?text+' ('+rolesText+')':text,true));}
  if(library.ok===true)section.append(el('p','success','Kontrola nakonfigurovaných cest nehlásí problém.'));
 }
 return section;
}
