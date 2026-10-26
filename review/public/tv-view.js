// TV series section (#271): read-only discovery of TV results, series → season → episode.
// There is deliberately no approve, reject, replace or retain control anywhere in this module.
import {tr} from '/i18n.js?v=__APP_VERSION__';
import {$,el,fmt,date,button} from '/ui-kit.js?v=__APP_VERSION__';

const unboundReasons={
 receipt_missing:'Vedle výsledku chybí záznam převodu.',receipt_invalid:'Záznam převodu je neplatný nebo neobsahuje ID úlohy Tdarru.',
 job_missing:'Úloha Tdarru ze záznamu nebyla nalezena.',job_other_library:'Úloha Tdarru patří do jiné knihovny.',job_not_successful:'Úloha Tdarru nebyla úspěšná.',
 job_mismatch:'Úloha Tdarru neodpovídá velikostem souborů.',source_unmapped:'Zdroj se nepodařilo přesně namapovat přes zdrojové cesty TV.',
 files_changed:'Soubory se od záznamu převodu změnily.',file_in_progress:'Výsledek se právě zapisuje; počkej na dokončení.',duplicate_result:'Stejný zdroj nebo stejnou úlohu si nárokuje více výsledků.',
 series_not_found:'Sonarr nemá seriál pro cestu zdroje.',series_ambiguous:'Cesta zdroje patří více seriálům ve Sonarru.',no_episode_file:'Sonarr nemá soubor epizody pro cestu zdroje.',
 multiple_episode_files:'Sonarr má pro cestu zdroje více souborů epizod.',no_linked_episodes:'Soubor epizody ve Sonarru nemá žádnou přiřazenou epizodu.',
};
const unverifiedReasons={sonarr_not_configured:'Sonarr není nastaven.',sonarr_unavailable:'Sonarr není dostupný nebo neodpověděl včas.',sonarr_inconsistent:'Sonarr vrátil nekonzistentní data.'};
const sonarrNotes={not_configured:'Sonarr není nastaven; vazby nejsou ověřené.',unavailable:'Sonarr není dostupný nebo neodpověděl včas; vazby nejsou ověřené.',inconsistent:'Sonarr vrátil nekonzistentní data; vazby nejsou ověřené.',not_needed:'Sonarr se v tomto průchodu nepoužil'};
const failures={tv_roots_overlap:'Přehled seriálů je nedostupný: cesty seriálů se překrývají s cestami filmů.',tv_tdarr_unavailable:'Přehled seriálů je nedostupný: databáze Tdarru není čitelná.',tv_scan_failed:'Přehled seriálů se nepodařilo sestavit.'};

const pad=value=>String(value).padStart(2,'0');
const baseName=path=>String(path||'').split('/').at(-1);
/** One episode as Sonarr numbers it. Specials keep S00, anime adds the absolute number, daily adds the air date. */
export function episodeLabel(episode,seriesType){
 const parts=[];
 if(Number.isSafeInteger(episode.seasonNumber)&&Number.isSafeInteger(episode.episodeNumber))parts.push('S'+pad(episode.seasonNumber)+'E'+pad(episode.episodeNumber));
 if(seriesType==='anime'&&Number.isSafeInteger(episode.absoluteEpisodeNumber))parts.push(tr('Absolutní číslo')+' '+episode.absoluteEpisodeNumber);
 if(seriesType==='daily'&&episode.airDate)parts.push(tr('Datum vysílání')+' '+episode.airDate);
 return parts.join(' · ')||String(episode.id);
}
const seasonTitle=season=>season===null?tr('Sezóna není určena'):season===0?tr('Speciály (sezóna 0)'):tr('Sezóna')+' '+season;
const counts=(results,episodes)=>tr('Soubory')+': '+results+' · '+tr('Epizody')+': '+episodes;

function resultRow(result,seriesType){
 const row=el('li','tv-result');row.dataset.tvResult=result.id;
 row.append(el('strong','tv-result-name',result.file?.label||baseName(result.reviewRelative),true));
 const list=el('span','tv-episodes');
 list.append(el('span','details',result.episodes.map(episode=>episodeLabel(episode,seriesType)).join(', '),true));
 row.append(list,el('span','details',fmt(result.originalBytes)+' → '+fmt(result.reviewBytes),true));
 return row;
}
function problemList(title,intro,items,reasons,kind){
 const section=el('section','tv-problems tv-'+kind);section.append(el('h2','',title),el('p','details',intro));
 const list=el('ul','tv-problem-list');
 for(const item of items){
  const row=el('li','tv-result tv-problem');row.dataset.tvResult=item.id;row.dataset.tvReason=item.reason;
  row.append(el('strong','tv-result-name',item.reviewRelative,true),el('span','details',tr('Důvod')+': '+tr(reasons[item.reason]||item.reason),true));
  list.append(row);
 }
 section.append(list);return section;
}

/** Builds the section content for one /api/tv answer. Pure: no network, no state. */
export function renderTv(data){
 const box=el('div','tv-overview');
 if(data.status==='unavailable'){box.append(el('p','alert',failures[data.code]||'Přehled seriálů se nepodařilo sestavit.'));return box;}
 const totals=data.totals;
 const cards=el('div','summary tv-summary');
 for(const [label,value] of [['Vázané výsledky',totals.bound],['Nevázané výsledky',totals.unbound],['Vazba není ověřena',totals.unverified],['Epizody ve vázaných výsledcích',totals.episodes]]){
  const card=el('div');card.append(el('span','',label),el('strong','',String(value),true));cards.append(card);
 }
 const sizes=el('div');sizes.append(el('span','','Originály → výsledky'),el('strong','',fmt(totals.originalBytes)+' → '+fmt(totals.reviewBytes),true));cards.append(sizes);
 box.append(cards);
 const sonarr=data.sonarr||{};
 const note=el('p',sonarr.status==='verified'||sonarr.status==='not_needed'?'details':'alert',sonarr.status==='verified'?tr('Sonarr ověřil vazby')+' · '+tr('Ověřeno')+' '+date(sonarr.observedAt):tr(sonarrNotes[sonarr.status]||'Sonarr se v tomto průchodu nepoužil'),true);
 note.setAttribute('role','status');box.append(note,el('p','details','Přesně vázaný výsledek odpovídá jedné úloze Tdarru a právě jednomu souboru epizody ve Sonarru. Nic se nehádá podle názvů složek ani souborů.'));
 if(!totals.results)box.append(el('p','empty','Žádné výsledky seriálů nebyly nalezeny.'));
 else if(!data.series.length)box.append(el('p','empty','Žádný seriál zatím nemá přesně vázaný výsledek.'));
 for(const series of data.series){
  const details=el('details','tv-series');details.open=true;details.dataset.tvSeries=String(series.id);
  const summary=el('summary','');summary.append(el('strong','',series.title,true),el('span','details',' · '+counts(series.totals.results,series.totals.episodes),true),el('span','details',' · '+fmt(series.totals.originalBytes)+' → '+fmt(series.totals.reviewBytes),true));
  details.append(summary);
  for(const season of series.seasons){
   const block=el('section','tv-season');block.dataset.tvSeason=String(season.seasonNumber);
   block.append(el('h3','',seasonTitle(season.seasonNumber),true));
   const list=el('ul','tv-result-list');for(const result of season.results)list.append(resultRow(result,series.seriesType));
   block.append(list);details.append(block);
  }
  box.append(details);
 }
 if(data.unverified.length)box.append(problemList('Vazba není ověřena','Výsledky, jejichž vazbu se nepodařilo ověřit ve Sonarru. Nejsou považované za vázané.',data.unverified,unverifiedReasons,'unverified'));
 if(data.unbound.length)box.append(problemList('Nevázané výsledky','Výsledky bez přesné vazby. Nejsou k ničemu způsobilé.',data.unbound,unboundReasons,'unbound'));
 return box;
}

let app=null,mode='off',loading=false,loadedAt=0;
export const tvEnabled=()=>mode==='discovery';
/** Asks the server whether TV discovery is on, and shows or hides the navigation entry. Failures keep the section hidden. */
export async function refreshTvMode(){
 if(!app?.authenticated)return mode;
 try{const value=await app.api('/api/tv/status');mode=value?.mode==='discovery'?'discovery':'off';}catch{mode='off';}
 const link=$('tvNav');if(link)link.hidden=mode!=='discovery';
 if(mode!=='discovery'&&app.ui.view==='tv')location.hash='#attention';
 return mode;
}
export async function loadTv(force=false){
 if(loading||!tvEnabled()||!app.authenticated)return;
 loading=true;const box=$('tvContent');
 try{
  const data=await app.api('/api/tv'+(force?'?refresh=1':''));
  if(data.mode!=='discovery'){mode='off';$('tvNav').hidden=true;return;}
  loadedAt=Date.now();box.replaceChildren(renderTv(data));$('tvCount').textContent=tr(data.totals?.results??'—');
 }catch{
  const note=el('p','alert','Seriály nelze načíst. Zobrazené údaje mohou být zastaralé.');note.setAttribute('role','status');box.prepend(note);
 }finally{loading=false;}
}
export const tvLoadedAt=()=>loadedAt;
export function installTv(context){
 app=context;
 $('tvRefresh').onclick=()=>loadTv(true);
 setInterval(()=>{if(app.ui.view==='tv')void loadTv();},30000);
 setInterval(()=>{void refreshTvMode();},15000);
}
