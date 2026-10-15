// Recovery progress and detail renderers. Pure: they read only the record passed in.
import {tr,locale} from './i18n.js?v=20261015-outside1';
import {downloadProgress,recoveryIsBusy,recoveryConfigNotice,originalOutsideTooLong} from './review-model.js?v=20261015-outside1';
import {el,fmt,date,elapsedText,etaText,detailsFacts} from './ui-kit.js?v=20261015-outside1';

export function recoveryRuntimeView(runtime,translate=tr){
 const labels={off:'Off',running:'Běží',restarting:'Restartuje se',refused:'Spuštění odmítnuto',stopped:'Zastaveno',unreadable:'Stav nelze přečíst'};
 const state=runtime?.present===false?'off':runtime?.state;
 const label=runtime?labels[state]||labels.unreadable:'Načítám…';
 const mode=state!=='off'&&['verify','repair'].includes(runtime?.mode)?' · '+(runtime.mode==='verify'?'Verify':'Repair'):'';
 const reason=typeof runtime?.reason==='string'&&/^[a-z0-9-]{1,64}$/.test(runtime.reason)?runtime.reason:null;
 const box=el('div','alert'+(['restarting','refused','stopped','unreadable'].includes(state)||reason==='crash-loop'?' failure':''));box.setAttribute('role','status');
 box.append(el('strong','',translate('Stav Recovery')+': '+translate(label)+mode,true));
 if(reason)box.append(el('p','details',translate('Důvod: ')+reason,true));
 return box;
}

export function recoveryRestartWarningView(requests,runtime,translate=tr){
 if(!recoveryIsBusy(requests,runtime))return null;
 const box=el('p','alert',translate('Restart nebo aktualizace kontejneru s Review přeruší Recovery. Počkej na dokončení kontroly originálu nebo změn prováděných Recovery. Přerušená kontrola není důkazem poškození.'),true);box.setAttribute('role','status');return box;
}

export function recoveryConfigNoticeView(change,translate=tr){
 const notice=recoveryConfigNotice(change);if(!notice)return null;
 const message=notice.kind==='failure'?'Konfigurace Recovery byla změněna a není platná. Oprav config.json před restartem, jinak se Recovery nespustí.':'Konfigurace Recovery byla změněna. Změna se projeví až po restartu kontejneru s Review; restartuj ho, až budou Review i Recovery nečinné.';
 const box=el('p','alert'+(notice.kind==='failure'?' failure':''),[translate(message),notice.detectedAt?translate('Zjištěno:')+' '+date(notice.detectedAt):'',notice.error?'('+notice.error+')':''].filter(Boolean).join(' '),true);box.setAttribute('role','status');return box;
}

export function downloadProgressView(p,detail=true){
 const box=el('div','decode-progress');box.append(el('strong','',p.label));if(detail&&p.title)box.append(el('p','details',p.title,true));
 if(p.downloadPercent!==null){const meter=el('progress','task-meter');meter.max=100;meter.value=p.downloadPercent;meter.setAttribute('aria-label',tr('Průběh stažení souboru'));box.append(meter,detailsFacts([['Stažení souboru',p.downloadPercent.toLocaleString(locale,{maximumFractionDigits:1})+' %']]));}
 if(p.eta)box.append(detailsFacts([['Zbývající čas stažení',p.eta]]));
 if(detail){box.append(el('p','details','Procenta označují pouze stažení. Import, převod a schválení jsou samostatné kroky.'));if(p.error)box.append(el('p','failure',p.error));}return box;
}
export function decodeProgressView(p,detail=true){
 const box=el('div','decode-progress'),meter=el('progress','task-meter');meter.max=100;meter.setAttribute('aria-label',tr(`Kontrola originálu, průchod ${p.pass} ze 2`));if(p.percent!==null)meter.value=p.percent;
 box.append(el('strong','',`Kontrola originálu · průchod ${p.pass}/2${p.percent===null?'':` · ${p.percent.toLocaleString(locale,{maximumFractionDigits:1})} %`}`),meter);
 const position=p.seconds===null?'Čeká na měření':`Zkontrolováno ${elapsedText(p.seconds)}${p.duration===null?'':` z ${elapsedText(p.duration)}`}`;
 box.append(el('p','details',`${position} · ${p.etaSeconds===null?'Odhad času zatím není dostupný':'Zbývá '+etaText(p.etaSeconds)}`));
 if(detail){box.append(el('p','details',`${p.elapsedSeconds===null?'':`Tento průchod běží ${elapsedText(p.elapsedSeconds)} · `}${p.speed===null?'':'Rychlost '+p.speed.toLocaleString(locale,{maximumFractionDigits:2})+'×'}`),el('p','details',p.note),detailsFacts([['Poslední měření dekodéru',date(p.measuredAt)],['Poslední odezva Recovery',date(p.heartbeatAt)]]));}
 return box;
}

export function recoveryVerifyPauseView(r,translate=tr,now=Date.now()){
 const steps={replacement_request:'Čeká: odebrání zachovaného originálu a vyžádání náhrady.',tdarr_handoff:'Čeká: předání náhrady Tdarru.',quarantine_purge:'Čeká: úklid karantény.'};
 if(!steps[r.verifyPausedStep])return null;
 const late=originalOutsideTooLong(r,now),box=el('div','alert'+(late?' failure':''));box.setAttribute('role','status');
 box.append(el('strong','',translate('Pozastaveno režimem Verify; pokračují pouze ochranné kroky.'),true),el('p','',translate(steps[r.verifyPausedStep]),true));
 if(late)box.append(el('p','',translate('Originál je mimo knihovnu déle než 24 hodin. Pokud stahování náhrady v Radarru visí, odstraň ho v Radarru; Recovery pak při příští kontrole vrátí originál do knihovny.'),true));
 const outside=r.originalOutsideLibrary,location=outside===true?'Originál je mimo knihovnu, zachovaný v karanténě.':outside===false?'Originál je v knihovně.':'Umístění originálu není doloženo.';
 box.append(el('p','details',translate(location),true));
 if(typeof outside==='boolean'){
  const since=outside?r.originalOutsideSince:r.originalRestoredAt;
  box.append(el('p','details',translate(outside?'Mimo knihovnu od:':'Vráceno do knihovny:')+' '+(since&&Number.isFinite(Date.parse(since))?date(since):translate('Čas není doložen')),true));
 }
 box.append(el('p','details',translate('Po přepnutí na Repair Recovery znovu ověří aktuální stav a automaticky pokračuje.'),true));
 return box;
}

export function recoveryDetails(r,translate=tr){
 const box=el('div'),pause=recoveryVerifyPauseView(r,translate);if(pause)box.append(pause);box.append(el('strong','',r.pipelineLabel||r.message));if(r.statusUpdated){box.append(el('p','details','Stav aktualizován: '+new Date(r.statusUpdated).toLocaleString(locale)));if(Date.now()-Date.parse(r.statusUpdated)>12*60000)box.append(el('p','failure','Stav je starší než 12 minut; spojení s Recovery může být přerušené.'));}if(r.replacementTitle)box.append(el('p','details','Náhrada: '+r.replacementTitle));if(r.tdarrStatus)box.append(el('p','details','Tdarr: '+r.tdarrStatus));if(r.quarantineRetained&&!r.verifyPausedStep)box.append(el('p','details','Původní kopie je zachovaná v karanténě.'));if(r.deleteAfter)box.append(el('p','details','Úklid karantény po schválení: '+new Date(r.deleteAfter).toLocaleString(locale)));for(const q of downloadProgress(r))box.append(downloadProgressView(q));if(r.phase==='waiting_source_kept')box.append(el('strong','failure','Vydání vyřazeno z převodů — náhrada zatím nenalezena'),el('p','','Film zůstává v Plexu. Jeho původní zvuk má potvrzenou chybu; toto vydání se nebude znovu převádět.'));
 if(r.edition)box.append(el('p','details','Vyřazené vydání: '+r.edition));
 if(r.lastSearchAt)box.append(el('p','details','Poslední hledání: '+new Date(r.lastSearchAt).toLocaleString(locale)));
 if(r.nextSearchAt&&!r.verifyPausedStep)box.append(el('p','details','Další automatické hledání: '+new Date(r.nextSearchAt).toLocaleString(locale)));
 if(r.error)box.append(el('p','failure','Kontrola náhrady: '+r.error));
 if(r.radarrMovieUrl){const link=el('a','secondary','Otevřít film v Radarru — ruční hledání');link.href=r.radarrMovieUrl;link.target='_blank';link.rel='noopener noreferrer';box.append(link);}
 box.append(el('p','details','Můžeš nezávisle hledat jiné vydání přes interaktivní hledání v Radarru. Vybírej stejnou nebo vyšší kvalitu; vyřazené vydání znovu nestahuj. Před nahrazením ověř stav obnovy; původní kopie se uchová podle pravidel karantény.'));
 return box;
}

export function fullHashProgressView(p,detail=true){
 const box=el('div','decode-progress'),meter=el('progress','task-meter');meter.max=100;meter.setAttribute('aria-label',tr('Úplný kontrolní součet originálu'));if(p.percent!==null)meter.value=p.percent;
 box.append(el('strong','',tr('Úplný kontrolní součet originálu')+' · '+tr(p.label)+(p.percent===null?'':' · '+p.percent.toLocaleString(locale,{maximumFractionDigits:1})+' %'),true),meter);
 if(p.done!==null&&p.total!==null)box.append(el('p','details',fmt(p.done)+' / '+fmt(p.total),true));
 if(detail||p.stale)box.append(el('p',p.stale?'failure':'details',p.stale?'Chybí čerstvé hlášení průběhu; obnovením ověř spojení s Recovery.':'Recovery čte celý originál s nízkou prioritou a součet porovná s potvrzeným stavem. Rozdíl zastaví přesun do karantény.'));
 return box;
}

