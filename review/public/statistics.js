// Savings statistics view.
import {tr} from '/i18n.js?v=20261013-retention1';
import {$,el,fmt,date} from '/ui-kit.js?v=20261013-split1';

let app=null,statsBox=null,statsLoading=false,statsLoaded=0;
const api=(route,body)=>app.api(route,body);
export const statisticsLoadedAt=()=>statsLoaded;
export function installStatistics(context){
 app=context;
 statsBox=$('statsContent');
 setInterval(()=>{if(app.ui.view==='savings')loadStatistics()},15000);
}
export async function loadStatistics(){
 if(statsLoading||!app.authenticated||$('workspace').hidden)return;statsLoading=true;
 try{const d=await api('/api/statistics');statsLoaded=Date.now();statsBox.replaceChildren();const cards=el('div','stats-cards');
  for(const [label,value,detail]of [['Doložená logická úspora',fmt(d.saved),`${d.count} souborů · průměr ${Number(d.percent).toFixed(1)} %`],['Z toho přes Review',fmt(d.reviewSaved),`${d.reviewCount} souborů · součást celkové úspory`],['Čeká na schválení',fmt(d.pendingBytes),`${d.pendingCount} výsledků · zatím neuvolněno`],['Tdarr hlásí celkem',d.reported===null?'Nedostupné':fmt(d.reported),'Všechny knihovny · může zahrnovat opakované převody']]){const card=el('div');card.append(el('span','details',label),el('strong','',value),el('small','details',detail));cards.append(card)}
  const methodology=el('details','help');methodology.append(el('summary','','Jak se úspora počítá'),el('p','details',`Porovnání aktuální velikosti souborů s dostupnou historií převodů a dokončenými protokoly Review. Každý soubor se počítá jednou. ${d.unverified} souborů nebylo možné potvrdit; smazaná historie Tdarru může v součtu chybět.`));
  statsBox.append(cards,el('p','details','Jde o logické zmenšení souborů. Volné místo na disku se tímto neměří a zachované kopie v karanténě dál zabírají místo.'),methodology,el('p','details','Poslední výpočet: '+date(d.at)));
  for(const warning of d.warnings||[])statsBox.append(el('p','alert',warning));
 }catch(e){let note=statsBox.querySelector('.stats-error');if(!note){note=el('p','alert stats-error');note.setAttribute('role','status');statsBox.prepend(note)}note.textContent=tr('Statistiky nelze aktualizovat; poslední údaje mohou být zastaralé. '+e.message);}finally{statsLoading=false}
}
