// Quarantine listing dialog.
import {tr} from '/i18n.js?v=__APP_VERSION__';
import {quarantineLifecycle} from '/review-model.js?v=__APP_VERSION__';
import {$,el,button,fmt,date,detailsFacts} from '/ui-kit.js?v=__APP_VERSION__';

let app=null;
const api=(route,body)=>app.api(route,body);
let quarantineDialog;

export function installQuarantine(context){
 app=context;
 quarantineDialog=el('dialog','settings-dialog');document.body.append(quarantineDialog);
 const quarantineButton=$('settingsQuarantine');quarantineButton.onclick=()=>openQuarantine();
}
// Deleting one file (#280): the server says what stays in the library and what blocks it; deletion needs a second click.
const DELETE_BLOCKERS={'quarantine-delete-busy':'Probíhá jiná akce; smazání bude možné po jejím dokončení.','quarantine-delete-case-active':'Obnova s tímto souborem ještě pracuje; počkej, až skončí nebo bude vyžadovat tvé rozhodnutí.','quarantine-delete-ambiguous-case':'Soubor nelze jednoznačně přiřadit k jednomu případu.'};
const LIBRARY={present:'V knihovně zůstává aktuální soubor filmu.',missing:'V knihovně žádný soubor tohoto filmu není: smazáním o film přijdeš.',unknown:'Nelze ověřit, co je v knihovně.'};
function deleteControl(f,title,caseId){
 const box=el('div','quarantine-delete'),start=button('Smazat',async()=>{
  try{
   const view=await api('/api/quarantine/delete?caseId='+encodeURIComponent(f.caseId)+'&name='+encodeURIComponent(f.name));
   box.replaceChildren(el('p',view.library==='missing'?'failure':'details',LIBRARY[view.library]||LIBRARY.unknown));
   if(!view.eligible){const list=el('ul','attention-blockers');for(const code of view.blockers)list.append(el('li','',DELETE_BLOCKERS[code]||'Soubor teď smazat nelze.'));box.append(list,button('Zavřít',()=>box.replaceChildren(start)));return;}
   box.append(el('p','details','Smazání je trvalé a nejde vrátit. Knihovna, Tdarr ani Radarr se nemění.'),
    button('Smazat natrvalo',async()=>{try{await api('/api/quarantine/delete',{caseId:f.caseId,name:f.name,snapshot:view.snapshot,confirm:true});quarantineDialog.close();await openQuarantine(title,caseId);}catch(e){app.error(e)}},'reject'),
    button('Zrušit',()=>box.replaceChildren(start)));
  }catch(e){app.error(e)}
 });
 box.append(start);return box;
}
export async function openQuarantine(title='',caseId=''){
 try{
  await app.loadRequests(true);const d=await api('/api/quarantine');quarantineDialog.replaceChildren(el('h2','','Karanténa'+(title?' · '+title:'')));
  const query=title.toLocaleLowerCase().replace(/\s*\(\d{4}\).*$/,'').trim();
  const files=d.files.filter(f=>caseId?f.caseId===caseId:!query||f.name.toLocaleLowerCase().includes(query));
  quarantineDialog.append(el('p','details',['Originály se uchovávají do schválení funkční náhrady v Review.',Number.isInteger(d.retentionDays)?'Schválená lhůta pro následný úklid je '+d.retentionDays+' dní.':'',d.cleanupEnabled?'Automatický úklid je zapnutý pro náhrady s uloženým důkazem schválení a nezměněnou identitou obou souborů.':'Automatický úklid karantény je vypnutý.','Starší případy bez důkazu zůstávají zachované.'].filter(Boolean).map(text=>tr(text)).join(' '),true));
  quarantineDialog.append(el('p','details','Velikost zobrazených souborů: '+fmt(files.reduce((sum,f)=>sum+(Number.isSafeInteger(f.bytes)&&f.bytes>=0?f.bytes:0),0))),el('p','details','Součet velikostí souborů nemusí odpovídat fyzicky zabranému místu; některé kopie mohou být hardlinky.'));
  if(!files.length)quarantineDialog.append(el('p','','Pro tento výběr není v karanténě žádný soubor.'));
  for(const f of files){const row=el('article','movie');row.append(el('strong','',f.name,true),el('p','details',fmt(f.bytes)),el('p','details',f.path,true));const lifecycle=quarantineLifecycle(f,app.requests);row.append(el('p','',lifecycle.label),el('p','details',lifecycle.reason));if(lifecycle.deleteAfter!==null)row.append(detailsFacts([['Termín úklidu',date(lifecycle.deleteAfter)]]));if(lifecycle.requestKey)row.append(button('Otevřít obnovu',()=>{quarantineDialog.close();app.openDetail('request',lifecycle.requestKey)}));const copy=el('button','secondary','Kopírovat cestu');copy.onclick=async()=>{try{await navigator.clipboard.writeText(f.path);copy.textContent=tr('Zkopírováno')}catch{copy.textContent=tr('Označ a zkopíruj cestu výše')}};row.append(copy,deleteControl(f,title,caseId));quarantineDialog.append(row)}
  for(const w of d.warnings)quarantineDialog.append(el('p','failure',w));
  if(title){const all=el('button','secondary','Zobrazit celou karanténu');all.onclick=()=>{quarantineDialog.close();openQuarantine()};quarantineDialog.append(all)}
  const close=el('button','secondary','Zavřít');close.onclick=()=>quarantineDialog.close();quarantineDialog.append(close);quarantineDialog.setAttribute('aria-label',tr('Karanténa'+(title?' · '+title:'')));quarantineDialog.showModal();
 }catch(e){app.error(e)}
}
