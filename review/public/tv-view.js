// TV series discovery and explicit strict-review workspace, series → season → episode.
// Discovery stays read-only; only supported strict-review rows open the separate assessment.
import {tr,translateAudioTrackLabel} from '/i18n.js?v=__APP_VERSION__';
import {$,el,fmt,date,button} from '/ui-kit.js?v=__APP_VERSION__';
import {mountReviewWorkflow} from '/review-workflow.js?v=__APP_VERSION__';
import {openComparison,openAudioComparison,openGuidedComparison} from '/comparison.js?v=__APP_VERSION__';

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
const sampleReasons={not_acquired:'Epizoda není v Sonarru získaná.',season_membership_unknown:'Zařazení epizody do sezóny není známé.',episode_binding_unknown:'Vazba souboru epizody není známá.',source_path_unmapped:'Zdroj není bezpečně namapovaný do TV knihovny.',result_path_unmapped:'Cestu výsledku nelze bezpečně namapovat.',outside_series_root:'Soubor epizody je mimo bezpečně vymezený kořen série.',stale_discovery_result:'Dříve zobrazený výsledek už není ve snímku Sonarru.',multiple_staged_results:'K souboru epizody odpovídá více výsledků.',staged_result_unsafe:'Cesta výsledku není bezpečná nebo dostupná.',staged_result_unverified:'Výsledek existuje, ale jeho soubor nebo doklad nelze ověřit.',no_staged_result:'Výsledek zatím není připravený.',sonarr_order_unknown:'Číslování Sonarru nestačí k určení pořadí.',sonarr_order_ambiguous:'Více souborů má stejné číslování Sonarru; jejich pořadí nelze určit.',multi_episode_file:'Jeden fyzický soubor obsahuje více epizod.',unsupported_format:'Soubor je mimo aktuální podporovaný přísný profil.',strict_flow_unverified:'Přísný doklad převodu nelze ověřit.',job_unverified:'Přesnou úspěšnou úlohu Tdarru nelze ověřit.',release_group_unknown:'Sonarr neuvedl použitelnou skupinu vydání.',essential_evidence_unknown:'Chybí některý povinný technický údaj.',metadata_unavailable:'Technická metadata nejsou dostupná.',unsupported_streams:'Rozložení obrazových streamů není podporované.',unsupported_video:'Obrazový formát není podporovaný.',unknown_or_hdr_color:'Barevné nebo HDR údaje nejsou známé nebo nejsou podporované.',essential_video_fact_unknown:'Povinné údaje o obrazu nejsou známé.',essential_track_fact_unknown:'Povinné údaje zvuku nebo titulků nejsou známé.',unsupported_result_codec:'Výsledek je mimo přísný profil.',duration_mismatch:'Délka zdroje a výsledku překračuje toleranci přísného profilu.',metadata_changed:'Identita souboru nebo dokladu se během čtení změnila.'};
const shownSignatureValue=value=>value===null||value===undefined?tr('Nehlášeno'):typeof value==='boolean'?tr(value?'Ano':'Ne'):String(value);
const roleNames={comment:'Komentář',original:'Původní',dub:'Dabing',hearing_impaired:'Pro neslyšící',visual_impaired:'Pro nevidomé',clean_effects:'Čisté efekty',attached_pic:'Přiložený obrázek',timed_thumbnails:'Časové náhledy',captions:'Skryté titulky',descriptions:'Zvukový popis',metadata:'Metadata',dependent:'Závislá stopa',still_image:'Statický obraz',non_diegetic:'Nediegetický zvuk',multilayer:'Více vrstev'};
const trackSignature=(kind,tracks)=>{
 const heading=kind==='audio'?'Zvuk':'Titulky',list=el('ul','tv-signature-tracks');
 if(!tracks?.length)list.append(el('li','details',tr('Bez stop')));
 for(const track of tracks||[]){
  const details=[tr('Kodek')+': '+shownSignatureValue(track.codec),tr('Jazyk')+': '+shownSignatureValue(track.language)];
  if(kind==='audio')details.push(tr('Počet kanálů')+': '+shownSignatureValue(track.channels),tr('Rozložení kanálů')+': '+shownSignatureValue(track.channelLayout));
  details.push(tr('Výchozí')+': '+shownSignatureValue(track.default),tr('Vynucené')+': '+shownSignatureValue(track.forced));
  const roles=Object.entries(track.roles||{}).filter(([,value])=>value!==false).map(([name,value])=>tr(roleNames[name]||name)+': '+shownSignatureValue(value));
  details.push(tr('Role')+': '+(roles.length?roles.join(', '):tr('Bez zvláštních příznaků')));
  list.append(el('li','details',details.join(' · '),true));
 }
 const box=el('div','tv-signature-track-group');box.append(el('h5','',tr(heading)),list);return box;
};
function signatureSide(name,side){
 const box=el('section','tv-signature-side');box.append(el('h4','',tr(name)));
 const video=side?.video;
 if(video){
  box.append(el('p','details',[tr('Video'),tr('Kontejner')+': '+shownSignatureValue(side.container),tr('Kodek')+': '+shownSignatureValue(video.codec),video.dimensions?.width+'×'+video.dimensions?.height,shownSignatureValue(video.frameRateFps)+' fps',tr('Pořadí polí')+': '+shownSignatureValue(video.fieldOrder),tr('Formát pixelů')+': '+shownSignatureValue(video.pixelFormat),tr('Bitová hloubka')+': '+shownSignatureValue(video.bitDepth)].join(' · '),true));
  const color=video.color||{};box.append(el('p','details',tr('Barva')+': '+['Primární složky','Přenos','Barevný prostor','Rozsah'].map(key=>tr(key)+': '+shownSignatureValue(color[{ 'Primární složky':'primaries','Přenos':'transfer','Barevný prostor':'space','Rozsah':'range'}[key]])).join(' · '),true));
  const hdr=video.hdrMetadata||{},hdrLabels={dolbyVision:'Dolby Vision',hdr10Plus:'HDR10+',masteringDisplay:'Mastering display',contentLightLevel:'Content light level'};
  box.append(el('p','details',tr('HDR vedlejší údaje')+': '+Object.entries(hdrLabels).map(([key,label])=>tr(label)+': '+(hdr[key]===null||hdr[key]===undefined?tr('Nehlášeno'):hdr[key]?tr('Přítomno'):tr('Nezjištěno'))).join(' · '),true));
  box.append(el('p','details',tr('Deklarace kodéru ve video streamu')+': '+shownSignatureValue(video.encoderTag?.state==='declared'?video.encoderTag.value:null),true));
 }
 box.append(trackSignature('audio',side?.audio),trackSignature('subtitle',side?.subtitles));return box;
}
function signatureDetails(signature){
 const details=el('details','tv-signature-details');details.append(el('summary','',tr('Podrobnosti technického seskupení')));
 details.append(el('p','details',tr('Metadata zobrazují pozorované vlastnosti, neověřují kvalitu ani původ. Neuvedené HDR vedlejší údaje neprokazují, že HDR chybí.')));
 details.append(signatureSide('Zdroj',signature?.source),signatureSide('Výsledek',signature?.result));
 const profile=signature?.profile;details.append(el('p','details',tr('Profil')+': '+shownSignatureValue(profile?.id)+' v'+shownSignatureValue(profile?.version)+' · '+tr('Verze toku')+': v'+shownSignatureValue(signature?.flowVersion),true));return details;
}
function renderSamplePlan(plan,seriesType){
 const section=el('section','tv-sample-plan');
 section.append(el('h3','',tr(plan.status==='complete'?'Plán vzorku je úplný':plan.status==='complete_with_exclusions'?'Plán je úplný s vyloučenými položkami':'Plán je neúplný')));
 section.append(el('p','details',tr('Jde o technické seskupení a návrh vzorku, nikoli o ověření původu či kvality ani o schválení dávky. Uvedená úspora je pouze odhad velikosti souborů.')));
 section.append(el('p','details',tr('Vzorec')+': '+plan.policy.sampleCount+'. '+tr('Výběr používá skutečné číslování Sonarru. Autorita dávky: žádná.')));
 for(const cohort of plan.cohorts){
  const card=el('article','tv-sample-cohort');card.append(el('h4','',tr('Skupina')+' '+cohort.id+' · '+cohort.count+' '+tr('fyzických souborů')));
  card.append(el('p','details',tr('Skupina vydání uvedená Sonarr')+': '+cohort.declaredReleaseGroup+'. '+tr('Původ ani kvalita vydání nejsou ověřené.')));
  const source=cohort.signature?.source?.video,result=cohort.signature?.result?.video,encoderLabel=value=>value?.state==='declared'?value.value:tr('Kodér není deklarován');if(source&&result)card.append(el('p','details',tr('Údaje deklarované streamem')+': '+source.codec+' '+source.dimensions.width+'×'+source.dimensions.height+' '+source.frameRateFps+' fps ('+encoderLabel(source.encoderTag)+') → '+result.codec+' '+result.dimensions.width+'×'+result.dimensions.height+' '+result.frameRateFps+' fps ('+encoderLabel(result.encoderTag)+'). '+tr('Deklarace streamu a nastavení kodéru nejsou ověřeny.')));
  card.append(signatureDetails(cohort.signature));
  card.append(el('p','details',tr('Odhadované velikosti')+': '+fmt(cohort.estimatedSourceBytes)+' → '+fmt(cohort.estimatedResultBytes)+'; '+tr('nejde o instalovanou úsporu')));
  const list=el('ul','tv-sample-members');
  for(const member of cohort.members){const row=el('li',member.sampled?'tv-sample-selected':'',member.label+' · '+member.episodes.map(value=>episodeLabel(value,seriesType)).join(', '));if(member.sampled)row.append(el('strong','details',' · '+tr('Doporučený vzorek')));list.append(row)}
  card.append(list);section.append(card);
 }
 if(plan.unknown?.length){const list=el('ul','tv-sample-exceptions');for(const item of plan.unknown)list.append(el('li','',tr('Soubor epizody')+' '+item.episodeFileId+': '+tr(sampleReasons[item.reason]||item.reason)));section.append(el('h4','',tr('Nezařazené položky')),list)}
 if(plan.exceptions?.length){const list=el('ul','tv-sample-exceptions');for(const item of plan.exceptions)list.append(el('li','',(item.kind==='episode'?tr('Epizoda'):tr('Soubor epizody'))+' '+(item.id??'—')+': '+tr(sampleReasons[item.reason]||item.reason)));section.append(list)}
 return section;
}

const strictBlocked={multi_episode_file:'Jeden soubor obsahuje více epizod.',unsupported_format:'Podporovány jsou pouze soubory Matroska .mkv.',strict_flow_evidence_missing:'Chybí důkaz dokončené přísné kontroly Tdarru.',flow_evidence_invalid:'Důkaz přísné kontroly Tdarru je neplatný.',binding_not_verified:'Vazba na jednu epizodu není ověřená.',files_changed:'Soubory se od poslední kontroly změnily.',tv_technical_facts_unavailable:'Technické údaje zdroje nebo výsledku chybí či nejsou úplné.',tv_unsupported_video_stream_count:'Podporován je právě jeden obrazový stream bez přiloženého obrázku.',tv_unsupported_container_or_scan:'Podporováno je pouze progresivní video v kontejneru Matroska.',tv_unsupported_bit_depth:'Podporováno je pouze 8bitové SDR video.',tv_hdr_or_unknown_color:'HDR nebo neznámý barevný formát není podporován.',tv_unsupported_result_codec:'Výsledek přísného TV profilu musí používat kodek HEVC.',tv_duration_mismatch:'Délka zdroje a výsledku se neshoduje v povolené toleranci.'};
function resultRow(result,seriesType,strict=false){
 const row=el('li','tv-result');row.dataset.tvResult=result.id;
 row.append(el('strong','tv-result-name',result.file?.label||baseName(result.reviewRelative),true));
 const list=el('span','tv-episodes');
 list.append(el('span','details',result.episodes.map(episode=>episodeLabel(episode,seriesType)).join(', '),true));
 row.append(list,el('span','details',fmt(result.originalBytes)+' → '+fmt(result.reviewBytes),true));
 if(strict){
  const reason=result.episodes?.length!==1?'multi_episode_file':!String(result.reviewRelative||'').toLowerCase().endsWith('.mkv')?'unsupported_format':result.strictEvidence==='passed'?result.strictBlockReason:result.strictEvidence==='legacy'?'strict_flow_evidence_missing':'flow_evidence_invalid';
  if(reason)row.append(el('span','details tv-blocked',tr(strictBlocked[reason]||reason),true));
  else{const review=button('Posoudit',()=>{} ,'primary');review.dataset.tvReview=result.id;review.setAttribute('aria-label',tr('Posoudit '+(result.file?.label||baseName(result.reviewRelative))));row.append(review)}
 }
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
   if(data.mode==='strict-review'&&data.planContext&&Number.isSafeInteger(season.seasonNumber)){
    const planButton=button('Vytvořit plán vzorku',()=>{},'secondary');planButton.dataset.tvSamplePlan='';planButton.dataset.seriesId=String(series.id);planButton.dataset.seasonNumber=String(season.seasonNumber);block.append(planButton);
   }
   const list=el('ul','tv-result-list');for(const result of season.results)list.append(resultRow(result,series.seriesType,data.mode==='strict-review'));
   block.append(list);details.append(block);
  }
  box.append(details);
 }
 if(data.unverified.length)box.append(problemList('Vazba není ověřena','Výsledky, jejichž vazbu se nepodařilo ověřit ve Sonarru. Nejsou považované za vázané.',data.unverified,unverifiedReasons,'unverified'));
 if(data.unbound.length)box.append(problemList('Nevázané výsledky','Výsledky bez přesné vazby. Nejsou k ničemu způsobilé.',data.unbound,unboundReasons,'unbound'));
 return box;
}

let app=null,mode='off',installationsAvailable=false,loading=false,ledgerLoading=false,loadedAt=0,ledgerLoadedAt=0,ledgerCursors=[],ledgerPage=0,currentLedgerPage=null,reviewDialog=null,reviewWorkspace=null,activeReview=null,reviewApproval=null,reviewRevision=0,tvPlanContext=null;
export const tvEnabled=()=>mode==='discovery'||mode==='strict-review';
export const tvLedgerEnabled=()=>installationsAvailable;
function updateTvModeCopy(){
 const eyebrow=$('tvModeEyebrow'),intro=$('tvModeIntro');if(!eyebrow||!intro)return;
 eyebrow.textContent=tr(mode==='strict-review'?'Přísné posouzení · ruční kontrola a oddělená instalace':'Pouze čtení · žádná akce schválení, zamítnutí ani nahrazení');
 intro.textContent=tr(mode==='strict-review'?'Přesně vázané podporované epizody lze ručně posoudit a samostatně nainstalovat po schválení. Instalace uchová původní soubor v oddělené TV karanténě.':'Seriály jsou zatím jen k prohlížení. Schválení, zamítnutí ani nahrazení výsledků seriálů zatím neexistuje a nic se tu nemění v knihovně, Tdarru ani Sonarru.');
}
/** Asks the server whether TV discovery is on, and shows or hides the navigation entry. Failures keep the section hidden. */
export async function refreshTvMode(){
 if(!app?.authenticated)return mode;
 try{const value=await app.api('/api/tv/status');mode=['discovery','strict-review'].includes(value?.mode)?value.mode:'off';installationsAvailable=value?.installationsAvailable===true;}catch{mode='off';installationsAvailable=false;}
 const link=$('tvNav');if(link)link.hidden=mode==='off';const ledgerLink=$('tvLedgerNav');if(ledgerLink)ledgerLink.hidden=!installationsAvailable;
 updateTvModeCopy();
 if(mode==='off'&&app.ui.view==='tv')location.hash=installationsAvailable?'#tv-history':'#attention';
 return mode;
}
export async function loadTv(force=false){
 if(loading||!tvEnabled()||!app.authenticated)return;
 loading=true;tvPlanContext=null;const box=$('tvContent');
 try{
  const data=await app.api('/api/tv'+(force?'?refresh=1':''));
  if(!['discovery','strict-review'].includes(data.mode)){mode='off';$('tvNav').hidden=true;return;}
  mode=data.mode;tvPlanContext=data.planContext||null;updateTvModeCopy();loadedAt=Date.now();app.refreshGuards?.();const content=renderTv(data);box.replaceChildren(content);$('tvCount').textContent=tr(data.totals?.results??'—');
  content.querySelectorAll('[data-tv-review]').forEach(control=>control.addEventListener('click',()=>void openTvReview(control.dataset.tvReview)));
  content.querySelectorAll('[data-tv-sample-plan]').forEach(control=>control.addEventListener('click',()=>void createSeasonSamplePlan(control,data.planContext,data.series.find(series=>String(series.id)===control.dataset.seriesId)?.seriesType||'standard')));
 }catch{
  const note=el('p','alert','Seriály nelze načíst. Zobrazené údaje mohou být zastaralé.');note.setAttribute('role','status');box.prepend(note);
 }finally{loading=false;}
}
async function createSeasonSamplePlan(control,context,seriesType){
 const block=control.closest('.tv-season');if(!block||!context?.settingsRevision||!context?.discoveryRevision)return;
 const settingsRevision=context.settingsRevision,discoveryRevision=context.discoveryRevision,seriesId=control.dataset.seriesId,seasonNumber=control.dataset.seasonNumber;
 control.disabled=true;block.querySelector('.tv-sample-plan')?.remove();
 const waiting=el('p','details',tr('Ověřuji aktuální metadata a vazby. Soubory zůstanou beze změny.'));block.append(waiting);
 try{
  const query=new URLSearchParams({settingsRevision,discoveryRevision,seriesId,seasonNumber});
  const plan=await app.api('/api/tv/season-sample-plan?'+query.toString());
  if(!control.isConnected||app.ui?.view!=='tv'||mode!=='strict-review'||tvPlanContext?.settingsRevision!==settingsRevision||tvPlanContext?.discoveryRevision!==discoveryRevision)return;
  waiting.remove();block.append(renderSamplePlan(plan,seriesType));
 }catch(error){if(control.isConnected&&app.ui?.view==='tv'&&tvPlanContext?.settingsRevision===settingsRevision&&tvPlanContext?.discoveryRevision===discoveryRevision)waiting.textContent=tr(error.message||'Plán vzorku nelze sestavit.');}
 finally{control.disabled=false;}
}
export const tvLoadedAt=()=>loadedAt;
export const tvHistoryLoadedAt=()=>ledgerLoadedAt;

const ledgerReason={journal_unavailable:'Instalace potřebuje kontrolu: transakční protokol není dostupný.',audit_context_incomplete:'Instalace potřebuje kontrolu: auditní kontext není úplný.',index_unsafe:'Index instalací není bezpečný ke čtení.',index_changed_or_truncated:'Index se změnil nebo byl zkrácen; obnov stránku historie.',cursor_out_of_range:'Stránka historie je mimo dostupný rozsah.',cursor_not_on_record_boundary:'Odkaz na stránku historie není platný.',index_row_too_large:'Řádek indexu překračuje bezpečný limit.',index_truncated:'Konec indexu je neúplný.',index_corrupt:'Index obsahuje neplatný záznam.',index_duplicate:'Index obsahuje duplicitní odkaz; tento rozsah je neúplný.',index_incomplete:'Index nelze bezpečně dokončit.',index_unavailable:'Index instalací není dostupný.'};
const identityLabel={matches:'Současná kopie odpovídá zaznamenané identitě.',changed:'Současná kopie se liší od zaznamenané identity.',missing:'Současná kopie chybí.',unsafe:'Současná kopie nesplňuje bezpečnostní podmínky.',inaccessible:'Současnou kopii nelze přečíst.',root_changed:'Aktuální kořen se liší od kořene použitého při instalaci; původní cesta nebyla čtena.',root_unavailable:'Aktuální stav nelze bezpečně ověřit.',missing_or_root_unavailable:'Aktuální stav nelze bezpečně ověřit.',not_verifiable:'Aktuální stav nelze bezpečně ověřit.',unknown:'Aktuální stav nelze bezpečně ověřit.'};
const phaseLabel=phase=>phase==='complete'?'Výsledek byl nainstalován':phase==='aborted'?'Transakce byla přerušena':'Instalace čeká na kontrolu';
const refreshLabel=value=>({completed:'Dokončeno',pending:'Čeká',failed:'Selhalo',unknown:'Neznámé',not_applicable:'Nepoužito'}[value]||'Neznámé');
const ledgerBytes=value=>Number.isSafeInteger(value)?fmt(value)+' ('+value.toLocaleString()+' B)':tr('Nedoloženo');
function renderLedgerRecord(record){
 const card=el('details','tv-install-record');card.open=false;
 const summary=el('summary','');summary.append(el('strong','',record.series?.title||(record.series?.id?tr('Seriály')+' · '+record.series.id:tr('Neověřený starší záznam')),true),el('span','details',' · '+(record.episodes||[]).map(episode=>episodeLabel(episode,record.series?.type)).join(', '),true),el('span','details',' · '+tr(phaseLabel(record.phase)),true));card.append(summary);
 if(record.verification!=='recorded'){card.append(el('p','alert inline-warning',tr(record.reason==='journal_unavailable'?'Instalace potřebuje kontrolu: transakční protokol není dostupný.':'Instalace potřebuje kontrolu: auditní kontext není úplný.')));return card;}
 const facts=[
  ['Schváleno',tr(date(record.approvedAt))],['Nainstalováno',record.installedAt?tr(date(record.installedAt)):tr('Aktuální stav nelze bezpečně ověřit.')],
  ['Zásada posouzení',tr(record.policy==='individual'?'Jednotlivé posouzení':'Neověřená zásada')],['ID souboru epizody',String(record.episodeFileId??'—')],['ID úlohy Tdarru',String(record.jobId??'—')],['Odkaz na transakci',record.transaction],
  ['Původní velikost',ledgerBytes(record.sourceBytes)],['Nainstalovaná velikost',ledgerBytes(record.installed.bytes)],['Rozdíl velikosti',ledgerBytes(Number.isSafeInteger(record.installed.bytes)?record.sourceBytes-record.installed.bytes:null)],['Bajty uchované při instalaci',ledgerBytes(record.retained.bytes)],
  ['Doklad při instalaci',tr(record.retained.atInstall==='verified'?'Ověřeno při instalaci':'Doklad o uchování při instalaci chybí.')],['Doklad výsledku při instalaci',tr(record.installed.identityVerified&&record.installed.hashVerified?'Ověřeno při instalaci':'Nedoloženo')],['Aktuální identita',tr(identityLabel[record.retained.current]||identityLabel.unknown)],['Aktualizace Tdarru',tr(refreshLabel(record.refresh.tdarr))],['Aktualizace Sonarru',tr(refreshLabel(record.refresh.sonarr))]
 ];
 const list=el('dl','tv-install-facts');for(const [label,value] of facts){list.append(el('dt','',label),el('dd','',value,true));}card.append(list,el('p','details','Rozdíl velikosti není uvolněné místo. Uchované bajty jsou údaj při instalaci; současný stav je uveden zvlášť.'),el('p','details','Zaznamenané ověření při instalaci a aktuální pozorování identity nejsou kontrolou kvality média.'));
 return card;
}
function renderLegacy(records){const box=$('tvLedgerLegacy');box.replaceChildren();if(!records?.length)return;box.append(el('h3','',tr('Nedávná historie instalací TV')));for(const record of records){const card=el('article','tv-install-record unverified'),status=record.status==='success'?'completed':record.status==='error'?'failed':record.status==='incomplete_refresh'?'pending':'unknown';card.append(el('strong','',tr('Neověřený starší záznam')),el('p','details',tr('Nedávná historie bez přesného transakčního propojení; nejde o důkaz instalace ani uchovaného souboru.')),el('p','details',tr('Stav')+': '+tr(refreshLabel(status))),el('p','details',record.time?date(record.time):''));box.append(card)}}
function drawLedger(value){
 const entries=$('tvLedgerEntries');entries.replaceChildren();for(const record of value.items||[])entries.append(renderLedgerRecord(record));
 $('tvLedgerScope').textContent=tr('Záznamy jsou načtené pouze z přesného TV indexu a svázaného transakčního protokolu. Starší, osiřelé a nezaindexované kopie nejsou úplným inventářem.')+' '+tr('Zobrazení historie zůstává jen pro čtení a nevolá Tdarr, Sonarr, Radarr ani Plex.');
 if(value.reason)entries.prepend(el('p','alert',tr(ledgerReason[value.reason]||'Index instalací není dostupný.')));
 else if(!(value.items||[]).length)entries.append(el('p','empty',tr('V indexu zatím nejsou žádné instalace.')));
 $('tvLedgerPage').textContent=tr('Stránka {0} · {1} záznamů · zachycený snímek indexu').replace('{0}',String(ledgerPage+1)).replace('{1}',String(value.items?.length||0));
 $('tvLedgerPrev').disabled=ledgerPage===0;$('tvLedgerNext').disabled=!value.nextCursor;
 $('tvLedgerLegacy').dataset.visible='true';renderLegacy(value.legacyUnverified||[]);ledgerLoadedAt=Date.now();$('lastUpdate').textContent=date(ledgerLoadedAt);$('lastUpdate').dateTime=new Date(ledgerLoadedAt).toISOString();app.refreshGuards?.();
}
export async function loadTvInstallations({next=false,previous=false,reset=false}={}){
 if(ledgerLoading||!app?.authenticated)return;ledgerLoading=true;
 if(reset){ledgerCursors=[];ledgerPage=0}else if(next){if(!currentLedgerPage?.nextCursor){ledgerLoading=false;return}ledgerCursors[ledgerPage+1]=currentLedgerPage.nextCursor;ledgerPage++}else if(previous)ledgerPage=Math.max(0,ledgerPage-1);
 try{const cursor=ledgerCursors[ledgerPage],value=await app.api('/api/tv/installations?limit=20'+(cursor?'&cursor='+encodeURIComponent(cursor):''));currentLedgerPage=value;drawLedger(value)}catch{const entries=$('tvLedgerEntries');entries.replaceChildren(el('p','alert',tr('Index instalací není dostupný.')))}finally{ledgerLoading=false}
}
export function installTv(context){
 app=context;
 reviewDialog=el('dialog','comparison tv-review-dialog');document.body.append(reviewDialog);
 $('tvRefresh').onclick=()=>loadTv(true);
 $('tvLedgerNext').onclick=()=>void loadTvInstallations({next:true});$('tvLedgerPrev').onclick=()=>void loadTvInstallations({previous:true});
 setInterval(()=>{if(app.ui.view==='tv')void loadTv();},30000);
 setInterval(()=>{void refreshTvMode();},15000);
}

async function openTvReview(id){
 if(mode!=='strict-review'||!app.authenticated)return;
 const listing=await app.api('/api/tv?refresh=1'),item=listing.series?.flatMap(s=>s.seasons.flatMap(season=>season.results)).find(value=>value.id===id);
 if(!item)return;
 try{
  const record=await app.api(`/api/tv/${id}/review-session?snapshot=${encodeURIComponent(item.snapshot)}`);
  activeReview={...record.item,snapshot:item.snapshot,videoUrl:`/api/tv/${id}/video`};reviewApproval=record.approval;reviewRevision=record.revision;
  reviewWorkspace?.destroy();reviewDialog.replaceChildren();
  const heading=el('div','comparison-head'),close=button('Zavřít',()=>reviewDialog.close());heading.append(el('h2','',activeReview.title,true),close);
  const notice=el('p','details','Posouzení ukládá tvoje ruční potvrzení. Schválení pouze zaznamená rozhodnutí; instalace je samostatná akce.');notice.setAttribute('role','status');
  const host=el('div','tv-review-host'),install=button(tr('Nainstalovat schválený výsledek'),()=>void installTvResult(),'primary');install.disabled=true;install.dataset.tvInstall='';
  const status=el('p','details','');status.setAttribute('role','status');
  reviewDialog.append(heading,notice,host,install,status);reviewDialog.showModal();
  const rewrite=(route,value)=>app.api(route.replace('/api/items/'+id,'/api/tv/'+id),value);
  const isCurrent=()=>!!reviewDialog.open&&mode==='strict-review'&&activeReview?.snapshot===item.snapshot;
  const updateInstall=()=>{install.disabled=!reviewApproval||reviewApproval.snapshot!==activeReview.snapshot||reviewApproval.reviewRevision!==reviewRevision||!isCurrent()};
  const retireReviewWorkspace=()=>{reviewWorkspace?.destroy();reviewWorkspace=null;host.hidden=true};
  const t=key=>{
   const television={'Délka filmu':'Délka epizody','Začátek filmu':'Začátek epizody','Střed filmu':'Střed epizody','Konec filmu':'Konec epizody','Synchronizace na začátku filmu':'Synchronizace na začátku epizody','Synchronizace uprostřed filmu':'Synchronizace uprostřed epizody','Synchronizace na konci filmu':'Synchronizace na konci epizody','Detail filmu':'Detail epizody','Posouzení filmu v jednom průchodu':'Posouzení epizody v jednom průchodu','Tři úseky ze začátku, středu a konce filmu se přehrají za sebou, každý jednou. Po každém úseku potvrdíš, co jsi ověřil. Přehrání ani technická kontrola nic nepotvrzuje.':'Tři úseky ze začátku, středu a konce epizody se přehrají za sebou, každý jednou. Po každém úseku potvrdíš, co jsi ověřil. Přehrání ani technická kontrola nic nepotvrzuje.'};
   return translateAudioTrackLabel(tr(television[key]||key),tr);
  };
  reviewWorkspace=mountReviewWorkflow(host,activeReview,{api:rewrite,comparisonApi:rewrite,isCurrent,canWrite:isCurrent,openComparison,openAudioComparison,openGuidedComparison,tr:t,formatBytes:fmt,canApprove:()=>false,showInstall:false,decisionText:'Schválení uloží rozhodnutí pro tuto přesně vázanou epizodu. Žádný soubor se tímto tlačítkem nemění.',decisionCapabilities:{reject:false,next:false,approveReplace:false},canApproveOnly:()=>true,isApproved:()=>reviewApproval?.snapshot===activeReview.snapshot&&reviewApproval.reviewRevision===reviewRevision,
   onSession:value=>{reviewRevision=value.revision;if(value.approval)reviewApproval=value.approval;updateInstall()},
   onApproveOnly:async revision=>{try{const result=await app.api(`/api/tv/${id}/approval`,{snapshot:activeReview.snapshot,reviewRevision:revision});reviewApproval=result.approval;status.textContent=tr('Schválení uloženo. Soubory zůstaly beze změny.');updateInstall();reviewWorkspace?.refreshGuard()}catch(error){status.textContent=tr(error.message)}}});
  async function installTvResult(){
   if(install.disabled)return;install.disabled=true;status.textContent=tr('Ověřuji aktuální vazbu a připravuji bezpečnou instalaci…');
   try{await app.api(`/api/tv/${id}/install`,{snapshot:activeReview.snapshot,reviewRevision});status.textContent=tr('Instalace spuštěna. Obnovuji pouze příslušnou knihovnu TV a sérii Sonarru.');
    const poll=async()=>{if(!reviewDialog.open)return;try{const value=await app.api('/api/tv/status');const outcome=value.history?.find(entry=>entry.id===id);if(value.active?.id===id){status.textContent=tr('Instalace probíhá…');setTimeout(poll,1000);return}if(outcome){status.textContent=tr(outcome.status==='success'?'Výsledek je nainstalován a obě metadata jsou aktualizovaná.':outcome.status==='incomplete_refresh'?'Výsledek je nainstalován, ale aktualizace metadat zůstává nedokončená.':'Instalace nebyla dokončena. Zkontroluj stav TV a obnovy.');if(['success','incomplete_refresh'].includes(outcome.status))retireReviewWorkspace();return}setTimeout(poll,1000)}catch{setTimeout(poll,1500)}};setTimeout(poll,750)
   }catch(error){status.textContent=tr(error.message);updateInstall()}
  }
 }catch(error){app.error(error)}
}
