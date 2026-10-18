import {installSharedSettings} from '/shared-settings-view.js?v=__APP_VERSION__';
// Review, sample-preparation and Radarr settings dialogs.
import {tr,locale} from '/i18n.js?v=__APP_VERSION__';
import {$,el,button} from '/ui-kit.js?v=__APP_VERSION__';

let app=null;
const api=(route,body)=>app.api(route,body);
let previewSettingsDialog;

export function installSettingsDialogs(context){
 app=context;
 const openShared=installSharedSettings(context);
 $('settingsReview').onclick=openShared;
 previewSettingsDialog=el('dialog','settings-dialog');document.body.append(previewSettingsDialog);
 const previewSettingsCard=el('article'),previewSettingsButton=button('Nastavit přípravu ukázek',openPreviewSettings);previewSettingsCard.append(el('h2','','Příprava ukázek'),el('p','','Limity mezipaměti a automatická příprava porovnání pro čekající filmy.'),previewSettingsButton);$('view-settings').querySelector('.settings-grid').append(previewSettingsCard);
 
 $('settingsRadarr').onclick=openShared;
}

async function openPreviewSettings(){
 try{const data=await api('/api/preview-settings');previewSettingsDialog.replaceChildren(el('h2','','Příprava ukázek'));const form=el('form'),enabled=el('input');enabled.type='checkbox';enabled.checked=data.config.enabled;
  const enabledLabel=el('label','preview-settings-enabled','Připravovat ukázky automaticky');enabledLabel.prepend(enabled);form.append(enabledLabel);const fields={};
  for(const [key,label,min,max]of [['maxMiB','Limit mezipaměti (MiB)',32,20480],['maxFilms','Nejvýše připravovaných filmů',1,20],['retentionDays','Uchování ukázek od vytvoření (dny)',1,30]]){const input=el('input');input.type='number';input.min=String(min);input.max=String(max);input.step='1';input.required=true;input.value=String(data.config[key]);const field=el('label','settings-field',label);field.append(input);form.append(field);fields[key]=input}
  const languages={};for(const [key,title]of [['preferredAudioLanguages','Upřednostněné jazyky zvuku (v pořadí)'],['fallbackAudioLanguages','Záložní jazyky zvuku (v pořadí)']]){const input=el('textarea');input.rows=2;input.maxLength=160;input.placeholder='ces, eng, slk, jpn';input.value=(data.config[key]||[]).join(', ');const label=el('label','settings-field',title);label.append(input,el('small','','Kódy odděl čárkou. Prázdný seznam je povolený; nejvýše 10 jazyků.'));const shortcuts=el('div','preview-language-shortcuts');for(const [code,name]of [['ces','Čeština'],['eng','Angličtina'],['slk','Slovenština'],['jpn','Japonština']])shortcuts.append(button(name,()=>{const current=input.value.split(/[\s,;]+/).filter(Boolean);if(!current.includes(code))input.value=[...current,code].join(', ');input.focus()}));form.append(label,shortcuts);languages[key]=input}
  const allowOther=el('input');allowOther.type='checkbox';allowOther.checked=data.config.allowOtherAudioLanguages===true;const allowOtherLabel=el('label','preview-settings-enabled','Pokud chybí preferovaný i záložní jazyk, nabídnout jiný společný hlavní zvuk');allowOtherLabel.prepend(allowOther);form.append(allowOtherLabel,el('p','details','Uložený pár stop má vždy přednost. Nejednoznačný návrh musíš zkontrolovat a stopy vybrat ručně.'));
  const stats=el('p','details'),status=el('p');status.setAttribute('role','status');const showStats=value=>stats.textContent=tr('Mezipaměť:')+' '+(Number(value.bytes||0)/2**20).toLocaleString(locale,{maximumFractionDigits:1})+' MiB · '+tr('Hotové položky:')+' '+Number(value.entries||0)+' · '+tr('Ve frontě:')+' '+Number(value.queued||0)+' · '+tr('Probíhá:')+' '+Number(value.running||0);showStats(data.stats||{});
  const actions=el('div','dialog-actions'),close=button('Zavřít',()=>previewSettingsDialog.close()),save=el('button','primary','Uložit nastavení');save.type='submit';actions.append(close,save);
  form.append(el('p','details','Na pozadí se připravuje vždy jedna úloha. Jiný čas nebo jiné stopy můžeš vytvořit na požádání. Hotové ukázky nic nepotvrzují a A/B poslech spouštíš ručně.'),stats,status,actions);
  form.onsubmit=async e=>{e.preventDefault();if(save.disabled||!form.reportValidity())return;save.disabled=true;const inputs=[...form.querySelectorAll('input'),...form.querySelectorAll('textarea'),...form.querySelectorAll('.preview-language-shortcuts button')];for(const input of inputs)input.disabled=true;try{const config={enabled:enabled.checked,...Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,Number(input.value)])),...Object.fromEntries(Object.entries(languages).map(([key,input])=>[key,input.value.split(/[\s,;]+/).filter(Boolean).map(x=>x.toLowerCase())])),allowOtherAudioLanguages:allowOther.checked},result=await api('/api/preview-settings',{config,revision:data.revision});data.revision=result.revision;for(const [key,input]of Object.entries(languages))input.value=(result.config[key]||[]).join(', ');status.textContent=tr(result.message||'Nastavení uloženo.');showStats(result.stats||{});app.forceRender();await app.load()}catch(e){status.textContent=tr(e.message)}finally{save.disabled=false;for(const input of inputs)input.disabled=false}};
  previewSettingsDialog.append(form);previewSettingsDialog.setAttribute('aria-label',tr('Příprava ukázek'));previewSettingsDialog.showModal();
 }catch(e){app.error(e)}
}
