// Recovery progress and detail renderers. Pure: they read only the record passed in.
import {tr,locale} from './i18n.js?v=__APP_VERSION__';
import {downloadProgress,recoveryIsBusy,recoveryConfigNotice,originalOutsideTooLong} from './review-model.js?v=__APP_VERSION__';
import {el,fmt,date,elapsedText,etaText,detailsFacts} from './ui-kit.js?v=__APP_VERSION__';

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
 const box=el('div');
 if(r.phase==='manual'&&r.originalCheckKind==='compatibility')box.append(el('p','alert',translate('Ověř kompatibilitu dekodéru nebo vyžádej novou výslovně povolenou náhradu. Originál zůstává zachovaný; tento případ nepovoluje automatické nahrazení.'),true));
 if(r.phase==='manual'&&/Missing or ambiguous original (?:import history|grabbed release)|Incomplete release blocklist identity/.test(r.reason||''))box.append(el('p','alert',translate('Chybí přesná historie vydání. Zachovej originál a zkontroluj údaje v Radarru; případná náhrada potřebuje nové výslovné oprávnění.'),true));
 const pause=recoveryVerifyPauseView(r,translate);if(pause)box.append(pause);box.append(el('strong','',r.pipelineLabel||r.message));if(r.statusUpdated){box.append(el('p','details','Stav aktualizován: '+new Date(r.statusUpdated).toLocaleString(locale)));if(Date.now()-Date.parse(r.statusUpdated)>12*60000)box.append(el('p','failure','Stav je starší než 12 minut; spojení s Recovery může být přerušené.'));}if(r.replacementTitle)box.append(el('p','details','Náhrada: '+r.replacementTitle));if(r.tdarrStatus)box.append(el('p','details','Tdarr: '+r.tdarrStatus));if(r.quarantineRetained&&!r.verifyPausedStep)box.append(el('p','details','Původní kopie je zachovaná v karanténě.'));if(r.deleteAfter)box.append(el('p','details','Úklid karantény po schválení: '+new Date(r.deleteAfter).toLocaleString(locale)));for(const q of downloadProgress(r))box.append(downloadProgressView(q));if(r.phase==='waiting_source_kept')box.append(el('strong','failure','Vydání vyřazeno z převodů — náhrada zatím nenalezena'),el('p','','Film zůstává v Plexu. Jeho původní zvuk má potvrzenou chybu; toto vydání se nebude znovu převádět.'));
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


// Needs attention (#229): the server's reason, verified location, actions and blockers for one case. Only actions
// the server lists become buttons; `changes` says what an action does before it runs.
const LOCATION_SOURCES=[['library','Knihovna'],['quarantine','Karanténa'],['review','Výsledek v Review'],['tdarr','Tdarr'],['radarr','Radarr']];
const LOCATION_DETAILS={present:'Soubor je na místě',changed:'Soubor se od záznamu změnil',missing:'Soubor chybí',pending:'Čeká na posouzení',retained:'Zachovaná podle záznamu',
 'transcode success':'Převod dokončen','transcode error':'Převod skončil chybou','not required':'Vynecháno jako Not required',hold:'Pozastaveno (Hold)',queued:'Ve frontě',transcoding:'Převádí se',
 'import-blocked':'Import je blokovaný','queue-failed':'Fronta hlásí chybu','search-failed':'Hledání selhalo',downloading:'Stahuje se','no-download':'Nic se nestahuje'};
export const ATTENTION_ACTIONS={refresh:['Obnovit stav','Jen znovu načte údaje z Radarru, Tdarru a knihovny; nic nemění.'],openRadarr:['Otevřít film v Radarru','Otevře Radarr; nic nemění.'],openQueue:['Otevřít frontu Radarru','Otevře obecnou frontu Radarru; nic nemění.'],
 openReview:['Posoudit výsledek v Review','Otevře posouzení; schválení je samostatný krok.'],replaceSource:['Vyžádat jinou kopii přes Radarr','Spustí vyžádání náhrady; originál zůstane zachovaný v karanténě.'],
 restore:['Vrátit originál i převod z karantény','Přesune zachované soubory zpět do knihovny.'],assessInstalled:['Posoudit nainstalovanou kopii','Otevře posouzení kopie, která je v knihovně; nic nemění.'],
 handoffTdarr:['Předat náhradu Tdarru','Tdarr soubor znovu naskenuje a zařadí ho podle svých pravidel; v knihovně se nic nepřesouvá.']};
const BLOCKERS={'source-not-confirmed':'Vada originálu není potvrzená dvěma kontrolami; náhradu nelze vyžádat.','inspect-case':'Správce musí zkontrolovat záznam případu a zachované kopie.',
 'diagnosis-needed':'Kontrola originálu skončila provozní nebo nejednoznačnou chybou; prověř ji v detailu.','verify-mode':'Recovery běží v režimu Verify; změny povolí až přepnutí na Repair.',
 'transcode-retry-unavailable':'Opakovaný převod Review zatím nenabízí; důvod zkontroluj v Tdarru.','hold-not-released':'Hold v Tdarru Review neuvolňuje; zkontroluj navazující případ a důvod pozastavení.',
 'radarr-download-stuck':'Pokud stahování v Radarru visí, odstraň ho v Radarru.','manual-import-in-radarr':'Stažený soubor přiřaď správnému filmu ručním importem v Radarru.',
 'retention-evidence':'Důkaz pro úklid karantény nesouhlasí; karanténa zůstává zachovaná.','status-unverified':'Stav nelze ověřit; obnov ho, a pokud zůstane neověřený, správce zkontroluje propojení.',
 'review-result-missing':'Výsledek v Review k této kopii zatím není doložený.','replacement-blocked':'Náhradu teď nelze vyžádat; důvod je uvedený v detailu.','radarr-link-unavailable':'Odkaz do Radarru není k dispozici; zkontroluj připojení Radarru.',
 'installed-unverified':'Nainstalovanou kopii nelze ověřit; obnov stav.','installed-evidence-exists':'Kopie je schválená; Recovery spustí úklid karantény při další kontrole.',
 'installed-file-missing':'V knihovně není žádná kopie k posouzení.','installed-ambiguous':'V knihovně je víc možných kopií; správce musí ponechat jen jednu.',
 'installed-file-unsafe':'Kopie v knihovně není běžný samostatný soubor; správce ji musí zkontrolovat.','installed-not-transcoded':'V knihovně je stále nepřevedená náhrada.',
 'installed-tdarr-not-success':'Tdarr pro tuto kopii nehlásí Transcode success.','installed-no-success-job':'V historii Tdarru není úspěšný převod této kopie po importu náhrady.',
 'installed-review-pending':'K této kopii čeká výsledek v Review; posuď ho tam.','installed-busy':'Probíhá jiná akce; posouzení bude možné po jejím dokončení.',
 'restore-over-installed':'Zastaralý originál Review přes aktuální kopii nevrací.',
 'handoff-unverified':'Stav předání nelze ověřit; obnov stav.',
 'handoff-library-id':'Pro předání Tdarru vyplň v nastavení ID knihovny Tdarr.',
 'handoff-file-missing':'Soubor náhrady v knihovně chybí.',
 'handoff-file-unsafe':'Soubor náhrady není běžný samostatný soubor; správce ho musí zkontrolovat.',
 'handoff-file-changed':'Soubor náhrady se od importu změnil; správce musí zkontrolovat, co ho změnilo.',
 'handoff-file-unstable':'Soubor náhrady se nedávno změnil; předání bude možné po 10 minutách klidu.',
 'handoff-hold':'Náhrada je v Tdarru pozastavená (Hold); Review Hold neuvolňuje, uvolni ho v Tdarru.',
 'handoff-hold-protected':'Náhradu drží Hold jiného případu, který ji chrání; Review ho neuvolní.',
 'handoff-reached':'Náhrada už do Tdarru došla; obnov stav.',
 'handoff-worker-busy':'Tdarr soubor právě zpracovává.',
 'handoff-busy':'Probíhá jiná akce; předání bude možné po jejím dokončení.',
 'handoff-manual':'Recovery předání vzdala; správce musí případ zkontrolovat. Schválení by tu úklid karantény nespustilo.'};

const IMPORT_DIAGNOSIS={
 'language-quality-mismatch':'Nesoulad jazyka nebo kvality; podrobnosti ověř v Radarru.',
 'download-pending':'Stahování stále probíhá; podrobnosti ověř ve frontě Radarru.',
 'import-problem':'Radarr hlásí problém při importu; vyřeš ho v Radarru.',
 unrecognized:'Příčina není jednoznačná; podrobnosti ověř ve frontě Radarru.',
 unverified:'Diagnóza importu zatím není ověřena. Obnov stav ručně.',
 unavailable:'Diagnózu importu se nepodařilo ověřit. Obnov stav ručně.'
};
const RETENTION_DIAGNOSIS={
 'approval-evidence-missing':'Schválení nebylo v ověřeném umístění nalezeno. Karanténa zůstává zachovaná; správce musí zkontrolovat vazbu případu a schvalovací evidenci. Zde schválení neopakuj ani neměň lhůtu.',
 'approval-evidence-unavailable':'Schvalovací evidenci nelze bezpečně přečíst. Karanténa zůstává zachovaná; správce musí ověřit přístup a vazbu evidence.',
 'approval-evidence-invalid':'Schvalovací evidence nemá očekávanou strukturu. Karanténa zůstává zachovaná; správce musí zkontrolovat evidenci.',
 'approval-evidence-mismatch':'Schvalovací evidence patří jiné kopii. Karanténa zůstává zachovaná; správce musí zkontrolovat vazbu.',
 'approval-time-invalid':'Čas schválení nelze ověřit. Karanténa zůstává zachovaná; správce musí zkontrolovat evidenci.',
 'approved-copy-missing':'Schválená kopie v knihovně chybí. Karanténa zůstává zachovaná; správce musí ověřit její umístění.',
 'approved-copy-unavailable':'Schválenou kopii nelze bezpečně přečíst. Karanténa zůstává zachovaná; správce musí zkontrolovat soubor.',
 'approved-copy-metadata-changed':'Změnila se pouze metadata schválené kopie; obsah ani schválení tím nejsou znovu ověřené. Karanténa zůstává zachovaná; správce musí ověřit kopii.',
 'approved-copy-changed':'Schválená kopie se změnila. Karanténa zůstává zachovaná; správce musí ověřit aktuální soubor.',
 'approved-identity-unavailable':'Identitu schválené kopie nelze ověřit. Karanténa zůstává zachovaná; správce musí zkontrolovat evidenci.',
 'quarantine-file-missing':'Zaznamenaná kopie v karanténě chybí. Karanténa se nemaže; správce musí ověřit stav případu.',
 'quarantine-file-changed':'Kopie v karanténě se změnila. Karanténa zůstává zachovaná; správce musí ověřit soubor.',
 'quarantine-file-unavailable':'Kopii v karanténě nelze bezpečně přečíst. Karanténa zůstává zachovaná; správce musí zkontrolovat umístění.',
 'quarantine-identity-unavailable':'Zaznamenanou identitu kopie v karanténě nelze ověřit. Karanténa zůstává zachovaná.',
 'quarantine-binding-unavailable':'Vazbu kopie v karanténě nelze ověřit. Karanténa zůstává zachovaná; správce musí zkontrolovat cestu a záznam.',
 'configuration-unavailable':'Nastavení Recovery nelze ověřit. Karanténa zůstává zachovaná; správce musí zkontrolovat konfiguraci.',
 'configuration-binding-changed':'Nastavení nebo vazba případu se změnily. Karanténa zůstává zachovaná; správce musí ověřit propojení.',
 'case-binding-unavailable':'Záznam případu nelze ověřit. Karanténa zůstává zachovaná; správce musí zkontrolovat Recovery data.',
 'case-binding-changed':'Záznam případu neodpovídá aktuálnímu stavu. Karanténa zůstává zachovaná; správce musí zkontrolovat vazbu.',
 'replacement-binding-unavailable':'Vazbu náhrady nelze ověřit. Karanténa zůstává zachovaná; správce musí zkontrolovat případ.',
 'approval-binding-unavailable':'Cestu ke schvalovací evidenci nelze ověřit. Karanténa zůstává zachovaná; správce musí zkontrolovat konfiguraci.',
 'retention-error-unresolved':'Čtení neodhalilo příčinu chyby úklidu. Karanténa zůstává zachovaná; správce musí zkontrolovat případ a zachované kopie.'
};
export function retentionDiagnosisView(diagnosis,translate=tr){
 const message=diagnosis&&RETENTION_DIAGNOSIS[diagnosis.reason];if(!message)return null;
 const box=el('section','retention-diagnosis');box.setAttribute('aria-label',translate('Diagnóza úklidu karantény'));
 box.append(el('p','details',translate(message),true));return box;
}
export function importDiagnosisView(diagnosis,translate=tr){
 if(!diagnosis||!IMPORT_DIAGNOSIS[diagnosis.status==='verified'?diagnosis.category:diagnosis.status])return null;
 const box=el('section','import-diagnosis'),status=diagnosis.status==='verified'?diagnosis.category:diagnosis.status;
 box.setAttribute('aria-label',translate('Diagnóza importu'));
 box.append(el('p','details',translate(IMPORT_DIAGNOSIS[status])));
 const links=el('div','import-diagnosis-links');
 const addLink=(url,label)=>{if(typeof url!=='string'||!/^https?:\/\/[^/?#@]+(?:\/[^?#]*)?$/i.test(url)||/[\u0000-\u0020\\]/.test(url))return;const link=el('a','secondary',translate(label));link.href=url;link.target='_blank';link.rel='noopener noreferrer';links.append(link)};
 addLink(diagnosis.movieUrl,'Otevřít ověřený film v Radarru');addLink(diagnosis.queueUrl,'Otevřít frontu Radarru');
 if(links.children.length)box.append(links);
 return box;
}

export function attentionLocationView(location,translate=tr){
 const rows=LOCATION_SOURCES.filter(([key])=>location?.[key]&&location[key].status!=='not-used').map(([key,label])=>{const v=location[key];
  return [label,translate(LOCATION_DETAILS[v.detail]||(v.status==='unverified'?'Nelze ověřit':'Není doloženo'))+' · '+translate(v.status==='verified'?'ověřeno':'neověřeno')+(v.at?' · '+date(v.at):''),true];});
 return rows.length?detailsFacts(rows):el('p','details','Umístění filmu zatím nelze ověřit.');
}
/** Buttons for the server-listed actions (only the recommended one when `recommendedOnly`), with what each changes. */
export function attentionActionsView(attention,run,{recommendedOnly=false}={},translate=tr){
 const box=el('div','attention-actions'),list=(attention?.actions||[]).filter(a=>ATTENTION_ACTIONS[a.id]&&(!recommendedOnly||a.id===attention.recommended));
 list.sort((a,b)=>(b.id===attention.recommended)-(a.id===attention.recommended));
 for(const action of list){const [label,changes]=ATTENTION_ACTIONS[action.id],primary=action.id===attention.recommended;
  const node=['openRadarr','openQueue'].includes(action.id)?Object.assign(el('a',primary?'primary':'secondary',label),{href:action.href,target:'_blank',rel:'noopener noreferrer'}):el('button',primary?'primary':'secondary',label);
  if(node.tagName==='BUTTON'){node.type='button';node.onclick=()=>run(action);}node.dataset.attentionAction=action.id;
  const line=el('div','attention-action');line.append(node,el('small','details',changes));box.append(line);}
 return box;
}
export function attentionView(attention,run,translate=tr){
 const box=el('section','attention-model');box.setAttribute('aria-label',translate('Co dál'));
 box.append(el('h4','','Kde je film teď'),attentionLocationView(attention.location,translate));const diagnosis=importDiagnosisView(attention.importDiagnosis,translate);if(diagnosis)box.append(diagnosis);const retention=retentionDiagnosisView(attention.retentionDiagnosis,translate);if(retention)box.append(retention);
 box.append(el('h4','','Co můžeš udělat'),attentionActionsView(attention,run,{},translate));
 const blockers=(attention.blockers||[]).filter(code=>BLOCKERS[code]);
 if(blockers.length){const list=el('ul','attention-blockers');for(const code of blockers)list.append(el('li','',BLOCKERS[code]));box.append(el('h4','','Co brání dalšímu kroku'),list);}
 if(attention.recoveryPolledAt)box.append(el('p','details',translate('Recovery naposledy ověřila stav:')+' '+date(attention.recoveryPolledAt),true));
 return box;
}
