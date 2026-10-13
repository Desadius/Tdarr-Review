// Recovery progress and detail renderers. Pure: they read only the record passed in.
import {tr,locale} from '/i18n.js?v=20261013-retention1';
import {downloadProgress} from '/review-model.js?v=20261012-recovery3';
import {el,date,elapsedText,etaText,detailsFacts} from '/ui-kit.js?v=20261013-split1';

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

export function recoveryDetails(r){
 const box=el('div');box.append(el('strong','',r.pipelineLabel||r.message));if(r.statusUpdated){box.append(el('p','details','Stav aktualizován: '+new Date(r.statusUpdated).toLocaleString(locale)));if(Date.now()-Date.parse(r.statusUpdated)>12*60000)box.append(el('p','failure','Stav je starší než 12 minut; spojení s Recovery může být přerušené.'));}if(r.replacementTitle)box.append(el('p','details','Náhrada: '+r.replacementTitle));if(r.tdarrStatus)box.append(el('p','details','Tdarr: '+r.tdarrStatus));if(r.quarantineRetained)box.append(el('p','details','Původní kopie je zachovaná v karanténě.'));if(r.deleteAfter)box.append(el('p','details','Úklid karantény po schválení: '+new Date(r.deleteAfter).toLocaleString(locale)));for(const q of downloadProgress(r))box.append(downloadProgressView(q));if(r.phase==='waiting_source_kept')box.append(el('strong','failure','Vydání vyřazeno z převodů — náhrada zatím nenalezena'),el('p','','Film zůstává v Plexu. Jeho původní zvuk má potvrzenou chybu; toto vydání se nebude znovu převádět.'));
 if(r.edition)box.append(el('p','details','Vyřazené vydání: '+r.edition));
 if(r.lastSearchAt)box.append(el('p','details','Poslední hledání: '+new Date(r.lastSearchAt).toLocaleString(locale)));
 if(r.nextSearchAt)box.append(el('p','details','Další automatické hledání: '+new Date(r.nextSearchAt).toLocaleString(locale)));
 if(r.error)box.append(el('p','failure','Kontrola náhrady: '+r.error));
 if(r.radarrMovieUrl){const link=el('a','secondary','Otevřít film v Radarru — ruční hledání');link.href=r.radarrMovieUrl;link.target='_blank';link.rel='noopener noreferrer';box.append(link);}
 box.append(el('p','details','Můžeš nezávisle hledat jiné vydání přes interaktivní hledání v Radarru. Vybírej stejnou nebo vyšší kvalitu; vyřazené vydání znovu nestahuj. Před nahrazením ověř stav obnovy; původní kopie se uchová podle pravidel karantény.'));
 return box;
}
