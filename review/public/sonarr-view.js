import {tr} from '/i18n.js?v=__APP_VERSION__';

const numbering=episode=>{
 const values=[];
 if(Number.isSafeInteger(episode.seasonNumber)&&Number.isSafeInteger(episode.episodeNumber))values.push('S'+String(episode.seasonNumber).padStart(2,'0')+'E'+String(episode.episodeNumber).padStart(2,'0'));
 if(Number.isSafeInteger(episode.absoluteEpisodeNumber))values.push(tr('Absolutní číslo')+' '+episode.absoluteEpisodeNumber);
 if(Number.isSafeInteger(episode.sceneAbsoluteEpisodeNumber))values.push(tr('Scénové absolutní číslo')+' '+episode.sceneAbsoluteEpisodeNumber);
 if(Number.isSafeInteger(episode.sceneSeasonNumber)||Number.isSafeInteger(episode.sceneEpisodeNumber))values.push(tr('Scénové číslování')+' '+(episode.sceneSeasonNumber??'—')+'x'+(episode.sceneEpisodeNumber??'—'));
 if(episode.unverifiedSceneNumbering===true)values.push(tr('Scénové číslování není ověřené'));else if(episode.unverifiedSceneNumbering===false)values.push(tr('Scénové číslování je označené jako ověřené'));else values.push(tr('Ověření scénového číslování není uvedeno'));
 if(episode.airDate)values.push(tr('Datum vysílání')+' '+episode.airDate);
 if(episode.airDateUtc)values.push(tr('Datum vysílání UTC')+' '+episode.airDateUtc);
 return values.join(' · ')||tr('Číslování neuvedeno');
};
const bindingStatus={mapped:'Přesně přiřazeno',unmapped:'Vazba nenalezena',ambiguous:'Nejednoznačná vazba',invalid:'Neplatná metadata'};

export function renderSonarrInspector({el,button,api,revision,configured,dirty}){
 let activeConfigured=configured,activeDirty=dirty;
 const panel=el('section','sonarr-inspector');panel.setAttribute('aria-label',tr('Ruční kontrola Sonarru'));
 panel.append(el('h3','','Ruční kontrola Sonarru'),el('p','details','Zdroj a odpovědi Sonarru jsou neověřené. Výsledek popisuje pouze metadata; nepotvrzuje existenci souboru ani povolení ke zpracování.'));
 const state=el('p','details','Načtení vyžaduje uložený návrh a ruční akci.');state.setAttribute('role','status');
 const select=el('select');select.setAttribute('aria-label',tr('Vybraná série'));select.disabled=true;
 const selectLabel=el('label','settings-field','Série');selectLabel.append(select);
 const results=el('div','sonarr-inspection-results');
 let series=[];
 const load=button('Načíst série',async()=>{
  if(load.disabled)return;load.disabled=true;inspect.disabled=true;state.textContent=tr('Načítám série z uloženého Sonarru…');results.replaceChildren();
  try{const value=await api('/api/sonarr/series?revision='+encodeURIComponent(revision));series=value.series;select.replaceChildren();for(const item of series){const option=el('option','',item.title);option.value=String(item.id);select.append(option);}select.value=String(series[0]?.id||'');select.disabled=!series.length;inspect.disabled=!series.length||activeDirty||!activeConfigured;state.textContent=tr('Série načteny ručním požadavkem.');}
  catch(error){series=[];select.replaceChildren();state.textContent=apiError(error);}
  finally{load.disabled=activeDirty||!activeConfigured;}
 });
 const inspect=button('Zkontrolovat vybranou sérii',async()=>{
  const id=select.value;if(inspect.disabled||!id)return;inspect.disabled=true;load.disabled=true;state.textContent=tr('Načítám úplný snímek vybrané série…');results.replaceChildren();
  try{const value=await api('/api/sonarr/inspect?revision='+encodeURIComponent(revision)+'&seriesId='+encodeURIComponent(id));
   state.textContent=tr('Metadata načtena. Zdroj a identita souborů zůstávají neověřené.');
   const heading=el('h4','',value.series.title+' · '+value.bindings.length+' '+tr('souborů epizod'));results.append(heading,el('p','details','Úplný snímek · Zdroj: NEOVĚŘENÁ metadata Sonarru'));
   for(const item of value.bindings){const block=el('article','sonarr-file-binding');
    const label=item.file.label||tr('Soubor epizody')+' '+item.file.id;block.append(el('h5','',label),el('p','details',tr('ID souboru epizody')+': '+item.file.id+' · '+tr('Sezóna')+' '+(item.file.seasonNumber??'—')));
    block.append(el('p',item.status==='mapped'?'success':'alert',tr('Stav vazby')+': '+tr(bindingStatus[item.status]||'Neznámý stav vazby')+(item.reason?' ('+item.reason+')':'')));
    if(item.episodes.length)for(const episode of item.episodes){const row=el('p','details',tr('ID epizody')+': '+episode.id+' · '+numbering(episode));block.append(row);}
    else block.append(el('p','details',tr('Nebyly vráceny přesné vazby epizod.')));
    results.append(block);
   }
   if(value.unacquiredEpisodes?.length){const block=el('article','sonarr-file-binding');block.append(el('h4','','Epizody bez souboru v Sonarru'));for(const episode of value.unacquiredEpisodes)block.append(el('p','details',tr('ID epizody')+': '+episode.id+' · '+numbering(episode)));results.append(block);}
  }catch(error){state.textContent=apiError(error);}
  finally{inspect.disabled=activeDirty||!activeConfigured||!series.length;load.disabled=activeDirty||!activeConfigured;}
 });
 select.onchange=()=>{inspect.disabled=activeDirty||!activeConfigured||!select.value};
 const buttons=el('div','dialog-actions');buttons.append(load,inspect);panel.append(selectLabel,buttons,state,results);
 panel.setAvailability=({isDirty,isConfigured})=>{activeDirty=isDirty;activeConfigured=isConfigured;load.disabled=isDirty||!isConfigured;inspect.disabled=isDirty||!isConfigured||!series.length||!select.value;select.disabled=isDirty||!series.length;};
 panel.setAvailability({isDirty:dirty,isConfigured:configured});return panel;
}

function apiError(error){
 const code=error?.code||error?.data?.code;
 if(code==='settings_conflict')return tr('Uložený návrh se změnil. Načti nastavení znovu.');
 if(code==='sonarr_too_large')return tr('Odpověď Sonarru překročila bezpečný limit; snímek není úplný.');
 if(code==='login_required')return tr('Přihlášení vyžadováno.');
 return tr('Sonarr není dostupný nebo vrátil neplatná metadata. Zkontroluj uložené připojení.');
}
