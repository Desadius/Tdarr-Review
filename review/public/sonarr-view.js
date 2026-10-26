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
const sourceStatus={present:'Metadata jednoho běžného souboru jsou dostupná; obsah a identita nejsou ověřené.',missing:'Soubor na odvozené cestě nebyl nalezen.',unsafe:'Soubor nebo cesta nesplňuje bezpečnostní omezení.',unsupported:'Typ souboru není podporován pro tuto kontrolu.',changed:'Cesta se během kontroly změnila.',busy:'Kontrola zdroje už probíhá.',unavailable:'Kontrola zdroje není dostupná.',unmapped:'Cestu Sonarru nelze přesně namapovat.',ambiguous:'Vazba epizody není jednoznačná.',invalid:'Metadata Sonarru nejsou platná.'};
const resultStatus={matched:'Přiřazení výsledku Tdarru odpovídá vybranému souboru a podporovaným metadatům. Není to kontrola technického zdraví ani schválení.',unverified:'Přiřazení výsledku Tdarru nebylo ověřeno.','source-missing':'Zdrojový soubor nebyl nalezen.','result-missing':'Výsledek nebyl nalezen.','receipt-missing':'Chybí podporovaný záznam výsledku.','job-missing':'Chybí přesně uvedená úspěšná úloha Tdarru.','wrong-library':'Úloha patří do jiné knihovny Tdarru.','job-not-successful':'Úloha Tdarru není označena jako úspěšná.','job-path-mismatch':'Cesta úlohy neodpovídá nakonfigurovanému zdroji.','evidence-mismatch':'Velikosti úlohy neodpovídají aktuálním souborům.','ambiguous-result':'Více výsledků odpovídá vybranému souboru.','ambiguous-job':'ID úlohy není jednoznačné.','unsafe-path':'Cesta nebo soubor nesplňuje bezpečnostní omezení.','unsupported-layout':'Rozložení nebo nastavení není pro tuto kontrolu podporované.','unsupported-evidence':'Záznam nemá podporovaný formát nebo údaje.','file-changed':'Zdroj, výsledek nebo vazba se během kontroly změnily.','evidence-unavailable':'Důkazy nejsou dostupné.','busy':'Kontrola výsledku už probíhá.'};
const technicalStatus={'technical-facts-unavailable':'Technická metadata nejsou dostupná pro tento soubor nebo výstup sondy.'};
const factValue=value=>value===null||value===undefined?tr('neznámé'):String(value);
function appendFacts(el,container,label,facts){
 const section=el('section','sonarr-technical-facts');section.append(el('h5','',label));
 section.append(el('p','details',tr('Doba trvání')+': '+factValue(facts.durationSeconds)+(facts.durationSeconds===null?'':' s')));
 const tracks=(kind,items)=>{
  if(!items.length){section.append(el('p','details',tr(kind==='video'?'Nebyla vrácena žádná video stopa':kind==='audio'?'Nebyla vrácena žádná zvuková stopa':'Nebyla vrácena žádná stopa titulků')));return;}
  for(const item of items){
   const values=[tr('Kodek')+': '+factValue(item.codec)];
   if(kind==='video'){
    values.push(tr('Rozměry')+': '+factValue(item.dimensions.width)+' × '+factValue(item.dimensions.height),tr('Snímková frekvence')+': '+factValue(item.frameRateFps));
    values.push(tr('Barva')+': '+[item.color.primaries,item.color.transfer,item.color.space,item.color.range].map(factValue).join(' · '));
    values.push(tr('HDR metadata')+': '+tr('Dolby Vision')+' '+factValue(item.hdrMetadata.dolbyVision)+' · HDR10+ '+factValue(item.hdrMetadata.hdr10Plus)+' · '+tr('Mastering display')+' '+factValue(item.hdrMetadata.masteringDisplay)+' · '+tr('Content light level')+' '+factValue(item.hdrMetadata.contentLightLevel));
   }else{
    values.push(tr('Jazyk')+': '+factValue(item.language));
    if(kind==='audio')values.push(tr('Zvukové kanály')+': '+factValue(item.channels));
    values.push(tr('Výchozí')+': '+factValue(item.default),tr('Vynucené')+': '+factValue(item.forced));
   }
   section.append(el('p','details',tr(kind==='video'?'Video stopa':kind==='audio'?'Zvuková stopa':'Stopa titulků')+' '+(item.index??'—')+' · '+values.join(' · ')));
  }
 };
 tracks('video',facts.video);tracks('audio',facts.audio);tracks('subtitle',facts.subtitles);container.append(section);
}

export function renderSonarrInspector({el,button,api,revision,configured,sourceConfigured=false,resultConfigured=false,dirty}){
 let activeConfigured=configured,activeSourceConfigured=sourceConfigured,activeResultConfigured=resultConfigured,activeDirty=dirty;
 const panel=el('section','sonarr-inspector');panel.setAttribute('aria-label',tr('Ruční kontrola Sonarru'));
 panel.append(el('h3','','Ruční kontrola Sonarru'),el('p','details','Zdroj a odpovědi Sonarru jsou neověřené. Výsledek popisuje pouze metadata; nepotvrzuje existenci souboru ani povolení ke zpracování.'));
 const state=el('p','details','Načtení vyžaduje uložený návrh a ruční akci.');state.setAttribute('role','status');
 const select=el('select');select.setAttribute('aria-label',tr('Vybraná série'));select.disabled=true;
 const selectLabel=el('label','settings-field','Série');selectLabel.append(select);
 const results=el('div','sonarr-inspection-results'),sourceChecks=[],resultChecks=[],technicalChecks=[];
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
    if(item.status==='mapped'){
     const sourceResult=el('p','details','');sourceResult.setAttribute('role','status');
     const check=button('Zkontrolovat cestu zdroje',async()=>{
      if(check.disabled||activeDirty||!activeSourceConfigured)return;check.disabled=true;sourceResult.textContent=tr('Kontrola odvozené cesty běží v odděleném procesu…');
      try{
       const query=new URLSearchParams({revision,seriesId:String(value.series.id),episodeFileId:String(item.file.id)});
       const checked=await api('/api/sonarr/source?'+query.toString());
       sourceResult.textContent=tr(sourceStatus[checked.status]||sourceStatus.unavailable)+(checked.relative?' '+tr('Relativní cesta')+': '+checked.relative:'')+(Number.isSafeInteger(checked.size)?' · '+tr('Velikost')+': '+checked.size+' B':'');
      }catch(error){sourceResult.textContent=apiError(error);}
      finally{check.disabled=activeDirty||!activeSourceConfigured;}
     });
     check.disabled=activeDirty||!activeSourceConfigured;sourceChecks.push(check);block.append(check,sourceResult);
     const resultState=el('p','details','');resultState.setAttribute('role','status');
     const inspectResult=button('Zkontrolovat výsledek Tdarru',async()=>{
      if(inspectResult.disabled||activeDirty||!activeResultConfigured)return;inspectResult.disabled=true;resultState.textContent=tr('Kontrola přiřazení výsledku běží v odděleném procesu…');
      try{
       const query=new URLSearchParams({revision,seriesId:String(value.series.id),episodeFileId:String(item.file.id)});
       const checked=await api('/api/sonarr/result?'+query.toString());
       const explanation=tr(resultStatus[checked.status==='matched'?'matched':checked.reason]||resultStatus.unverified);
       const sizes=Number.isSafeInteger(checked.source?.size)&&Number.isSafeInteger(checked.result?.size)?' '+tr('Zdroj')+': '+checked.source.size+' B · '+tr('Výsledek')+': '+checked.result.size+' B':'';
       const timing=Number.isSafeInteger(checked.evidence?.startedAt)&&Number.isSafeInteger(checked.evidence?.endedAt)?' · '+tr('Úloha')+': '+checked.evidence.startedAt+'–'+checked.evidence.endedAt:'';
       resultState.textContent=explanation+sizes+timing;
      }catch(error){resultState.textContent=apiError(error);}
      finally{inspectResult.disabled=activeDirty||!activeResultConfigured;}
     });
     inspectResult.disabled=activeDirty||!activeResultConfigured;resultChecks.push(inspectResult);block.append(inspectResult,resultState);
     const technicalState=el('div','sonarr-technical-results','');technicalState.setAttribute('role','status');
     const inspectTechnical=button('Zjistit technická fakta',async()=>{
      if(inspectTechnical.disabled||activeDirty||!activeResultConfigured)return;inspectTechnical.disabled=true;technicalState.replaceChildren(el('p','details','Technická metadata načítám ve vyhrazeném procesu…'));
      try{
       const inspected=await api('/api/sonarr/technical-facts',{revision,seriesId:Number(value.series.id),episodeFileId:Number(item.file.id)});
       if(inspected.status!=='available'){
        const message=technicalStatus[inspected.reason]||resultStatus[inspected.reason]||resultStatus.unverified;technicalState.replaceChildren(el('p','alert',tr(message)));
       }else{
        technicalState.replaceChildren(el('p','details','Jde o metadata kontejneru a stop. Nepotvrzují zdraví, kvalitu ani vhodnost souboru.'));
        appendFacts(el,technicalState,tr('Zdrojový soubor'),inspected.facts.source);appendFacts(el,technicalState,tr('Výsledek Tdarru'),inspected.facts.result);
       }
      }catch(error){technicalState.replaceChildren(el('p','alert',apiError(error)));}
      finally{inspectTechnical.disabled=activeDirty||!activeResultConfigured;}
     });
     inspectTechnical.disabled=activeDirty||!activeResultConfigured;technicalChecks.push(inspectTechnical);block.append(inspectTechnical,technicalState);
    }
    results.append(block);
   }
   if(value.unacquiredEpisodes?.length){const block=el('article','sonarr-file-binding');block.append(el('h4','','Epizody bez souboru v Sonarru'));for(const episode of value.unacquiredEpisodes)block.append(el('p','details',tr('ID epizody')+': '+episode.id+' · '+numbering(episode)));results.append(block);}
  }catch(error){state.textContent=apiError(error);}
  finally{inspect.disabled=activeDirty||!activeConfigured||!series.length;load.disabled=activeDirty||!activeConfigured;}
 });
 select.onchange=()=>{inspect.disabled=activeDirty||!activeConfigured||!select.value};
 const buttons=el('div','dialog-actions');buttons.append(load,inspect);panel.append(selectLabel,buttons,state,results);
 panel.setAvailability=({isDirty,isConfigured,isSourceConfigured=activeSourceConfigured,isResultConfigured=activeResultConfigured})=>{activeDirty=isDirty;activeConfigured=isConfigured;activeSourceConfigured=isSourceConfigured;activeResultConfigured=isResultConfigured;load.disabled=isDirty||!isConfigured;inspect.disabled=isDirty||!isConfigured||!series.length||!select.value;select.disabled=isDirty||!series.length;for(const check of sourceChecks)check.disabled=isDirty||!isSourceConfigured;for(const check of resultChecks)check.disabled=isDirty||!isResultConfigured;for(const check of technicalChecks)check.disabled=isDirty||!isResultConfigured;};
 panel.setAvailability({isDirty:dirty,isConfigured:configured});return panel;
}

function apiError(error){
 const code=error?.code||error?.data?.code;
 if(code==='settings_conflict')return tr('Uložený návrh se změnil. Načti nastavení znovu.');
 if(code==='sonarr_too_large')return tr('Odpověď Sonarru překročila bezpečný limit; snímek není úplný.');
 if(code==='login_required')return tr('Přihlášení vyžadováno.');
 return tr('Sonarr není dostupný nebo vrátil neplatná metadata. Zkontroluj uložené připojení.');
}
