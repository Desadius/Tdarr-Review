// Assessment of an already installed transcoded result (#230). Renders the server's view only: the
// disclosure, the device, the explicit confirmations and the note. Opening or playing the file confirms
// nothing; approval needs a saved, complete assessment and its own confirmation dialog.
import {tr} from './i18n.js?v=__APP_VERSION__';
import {el,button} from './ui-kit.js?v=__APP_VERSION__';

export const INSTALLED_DISCLOSURE=['Posuzuješ jen kopii, která je teď v knihovně. Plný originál k porovnání není k dispozici: zdroj náhrady už v knihovně není a vadný originál v karanténě se pro porovnání nepoužívá.',
 'Schválení nedokazuje, že převod je věrný originálu, jen že je kopie pro tebe přijatelná.'];
const CHECKS=[['image','Obraz je v pořádku'],['audio','Zvuk je v pořádku'],['syncStart','Synchronizace na začátku sedí'],['syncMiddle','Synchronizace uprostřed sedí'],['syncEnd','Synchronizace na konci sedí']];

/**
 * @param {any} view The server's view: {eligible, blockers, snapshot, requirements:{hdr}, draft}.
 * @param {{save:(input:any)=>Promise<void>, approve:(snapshot:string)=>void}} actions
 */
export function installedAssessmentView(view,actions,translate=tr){
 const box=el('section','installed-assessment');box.setAttribute('aria-label',translate('Posouzení nainstalované kopie'));
 box.append(el('h3','','Posouzení nainstalované kopie'));
 if(!view?.eligible){box.append(el('p','details','Nainstalovanou kopii teď nelze posoudit. Důvod je uvedený v přehledu případu.'));return box;}
 const disclosure=el('div','alert');for(const text of INSTALLED_DISCLOSURE)disclosure.append(el('p','',text));
 // A replacement Tdarr skipped as Not required is assessed untranscoded (#232).
 if(view.untranscoded)disclosure.append(el('p','','Tato kopie nebyla převedena: Tdarr ji podle svých pravidel nepotřeboval převádět. Posuzuješ importovanou náhradu tak, jak ji stáhl Radarr.'));
 box.append(disclosure);
 box.append(el('p','details','Přehraj soubor ve vlastním přehrávači. Otevření ani přehrání nic nepotvrzuje.'));
 const draft=view.draft||{},checks=[...CHECKS,...(view.requirements?.hdr?[['hdr','HDR se zobrazuje správně']]:[])];
 const device=Object.assign(el('input'),{type:'text',value:draft.device||'',maxLength:160,id:'installedDevice'});
 const deviceLabel=el('label','','Zařízení, na kterém jsi film přehrál');deviceLabel.htmlFor='installedDevice';box.append(deviceLabel,device);
 const boxes={};
 for(const [key,label]of checks){const input=Object.assign(el('input'),{type:'checkbox',checked:draft.checks?.[key]===true,id:'installedCheck-'+key});input.dataset.check=key;boxes[key]=input;
  const line=el('label','check');line.append(input,el('span','',label));box.append(line);}
 const note=Object.assign(el('textarea'),{value:draft.note||'',maxLength:2000,id:'installedNote'});
 const noteLabel=el('label','','Poznámka (povinná)');noteLabel.htmlFor='installedNote';box.append(noteLabel,note);
 const save=button('Uložit posouzení',()=>actions.save({snapshot:view.snapshot,device:device.value,note:note.value,checks:Object.fromEntries(Object.entries(boxes).map(([k,input])=>[k,input.checked===true]))}));
 save.dataset.installed='save';
 const approve=button('Schválit aktuální kopii',()=>actions.approve(view.snapshot),'primary');approve.dataset.installed='approve';
 // Approval is offered only for the saved assessment; any unsaved edit disables it until saved again.
 const dirty=()=>device.value!==(draft.device||'')||note.value!==(draft.note||'')||Object.entries(boxes).some(([k,input])=>input.checked!==(draft.checks?.[k]===true));
 const guard=()=>{approve.disabled=draft.complete!==true||dirty();};
 for(const input of [device,note,...Object.values(boxes)]){input.addEventListener('input',guard);input.addEventListener('change',guard);}guard();
 const status=el('p','details',draft.complete?'Posouzení je uložené a úplné.':'Uveď zařízení, potvrď všechny kontroly, napiš poznámku a posouzení ulož.');status.setAttribute('role','status');
 const row=el('div','actions');row.append(save,approve);box.append(row,status);
 return box;
}
