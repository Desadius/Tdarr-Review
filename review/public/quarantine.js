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
export async function openQuarantine(title='',caseId=''){
 try{
  await app.loadRequests(true);const d=await api('/api/quarantine');quarantineDialog.replaceChildren(el('h2','','Karanténa'+(title?' · '+title:'')));
  const query=title.toLocaleLowerCase().replace(/\s*\(\d{4}\).*$/,'').trim();
  const files=d.files.filter(f=>caseId?f.caseId===caseId:!query||f.name.toLocaleLowerCase().includes(query));
  quarantineDialog.append(el('p','details',['Originály se uchovávají do schválení funkční náhrady v Review.',Number.isInteger(d.retentionDays)?'Schválená lhůta pro následný úklid je '+d.retentionDays+' dní.':'',d.cleanupEnabled?'Automatický úklid je zapnutý pro náhrady s uloženým důkazem schválení a nezměněnou identitou obou souborů.':'Automatický úklid karantény je vypnutý.','Starší případy bez důkazu zůstávají zachované.'].filter(Boolean).map(text=>tr(text)).join(' '),true));
  quarantineDialog.append(el('p','details','Velikost zobrazených souborů: '+fmt(files.reduce((sum,f)=>sum+(Number.isSafeInteger(f.bytes)&&f.bytes>=0?f.bytes:0),0))),el('p','details','Součet velikostí souborů nemusí odpovídat fyzicky zabranému místu; některé kopie mohou být hardlinky.'));
  if(!files.length)quarantineDialog.append(el('p','','Pro tento výběr není v karanténě žádný soubor.'));
  for(const f of files){const row=el('article','movie');row.append(el('strong','',f.name,true),el('p','details',fmt(f.bytes)),el('p','details',f.path,true));const lifecycle=quarantineLifecycle(f,app.requests);row.append(el('p','',lifecycle.label),el('p','details',lifecycle.reason));if(lifecycle.deleteAfter!==null)row.append(detailsFacts([['Termín úklidu',date(lifecycle.deleteAfter)]]));if(lifecycle.requestKey)row.append(button('Otevřít obnovu',()=>{quarantineDialog.close();app.openDetail('request',lifecycle.requestKey)}));const copy=el('button','secondary','Kopírovat cestu');copy.onclick=async()=>{try{await navigator.clipboard.writeText(f.path);copy.textContent=tr('Zkopírováno')}catch{copy.textContent=tr('Označ a zkopíruj cestu výše')}};row.append(copy);quarantineDialog.append(row)}
  for(const w of d.warnings)quarantineDialog.append(el('p','failure',w));
  if(title){const all=el('button','secondary','Zobrazit celou karanténu');all.onclick=()=>{quarantineDialog.close();openQuarantine()};quarantineDialog.append(all)}
  const close=el('button','secondary','Zavřít');close.onclick=()=>quarantineDialog.close();quarantineDialog.append(close);quarantineDialog.setAttribute('aria-label',tr('Karanténa'+(title?' · '+title:'')));quarantineDialog.showModal();
 }catch(e){app.error(e)}
}
