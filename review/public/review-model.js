// Pure presentation rules. The server remains authoritative for every action.
export const RECOVERY_STALE_MS = 12 * 60 * 1000;
const itemId = value => typeof value === 'string' && /^[a-f0-9]{24}$/.test(value);
const snapshot = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = value => typeof value === 'string' ? value.trim() : '';
const finiteTime = value => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const normalize = value => text(value).toLowerCase();
const list = value => Array.isArray(value) ? value : [];
const hasDuration = value => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Pass authenticated/fresh explicitly. Missing state disables writes. */
export function capabilities(item, d, context = {}) {
  const reasons = [];
  if (context.authenticated !== true) reasons.push('Přihlas se pro provedení akce.');
  if (context.fresh !== true) reasons.push('Obnov aktuální stav před další akcí.');
  if (!d || !Array.isArray(d.recovery)) reasons.push('Stav výměn nelze ověřit.');
  if (d?.active || d?.batchRunning || d?.batch?.status === 'running') reasons.push('Jiná akce nebo dávka právě probíhá.');
  if (list(d?.recovery).length) reasons.push('Nedokončená výměna vyžaduje kontrolu.');
  if (d?.restorePending) reasons.push('Nejprve je nutné obnovit původní stav nodů.');
  if (context.previewBusy || context.settingsBusy || context.resumePending || context.mutationPending || context.scanBusy) reasons.push('Nejprve dokonči probíhající akci.');
  if (context.expectedSnapshot !== undefined && context.expectedSnapshot !== item?.snapshot) reasons.push('Soubory se změnily. Obnov přehled.');
  const writeBlocked = reasons.length > 0;
  const validItem = itemId(item?.id) && snapshot(item?.snapshot);
  const normalApproval = item?.status === 'ready' && item?.canApproveDuration !== true;
  const durationApproval = item?.canApproveDuration === true && hasDuration(item?.durationA) && hasDuration(item?.durationB);
  const requestConflict = list(context.requests).some(r => r?.itemId === item?.id && !['imported', 'restored'].includes(r.phase));
  const review = d?.reviewSessions?.[item?.id];
  const checks = review?.session?.checks;
  const reviewComplete = review?.version === 1 && typeof review?.requirements?.hdr === 'boolean' && (!review.requirements.hdr || (checks?.hdr === true && typeof review?.session?.device === 'string' && review.session.device.trim().length > 1)) && review?.snapshot === item?.snapshot && review?.complete === true && review?.session?.step === 4 && review?.session?.deferred === false && ['preparation','image','audio','syncStart','syncMiddle','syncEnd'].every(k=>checks?.[k] === true);
  const allowed = !writeBlocked && validItem;
  // Comparison uses POST and audio comparison stores evidence. Apply write
  // guards conservatively to previews as well as explicit file operations.
  const previewAllowed = !writeBlocked && validItem;
  const restorePhase = ['waiting', 'manual'].includes(item?.phase);
  return {
    approve: allowed && reviewComplete && (normalApproval || durationApproval),
    approveBatch: allowed && reviewComplete && normalApproval,
    select: allowed && reviewComplete && normalApproval,
    reject: allowed,
    replace: allowed && context.requestsFresh !== false && !requestConflict,
    recheck: allowed && item?.canRecheck === true,
    compareImage: previewAllowed && hasDuration(item?.durationA) && hasDuration(item?.durationB),
    compareAudio: previewAllowed && hasDuration(item?.durationA),
    download: context.authenticated === true && itemId(item?.id),
    // Request identity/capability comes from the server, not its display title.
    restore: !writeBlocked && itemId(item?.id) && item?.canRestore === true && item?.source !== 'recovery' && restorePhase && !list(item?.queue).length && !item?.replacement && context.requestsFresh !== false,
    reviewComplete,
    writeBlocked,
    reason: reasons[0] || (!validItem ? 'Položka nemá ověřený aktuální otisk souborů.' : ''),
    reasons,
  };
}

const RECOVERY_RUNNING = {
  candidate: ['Ověřuje se originál', 'Vyčkej na výsledek kontroly.'],
  verifying: ['Kontrola originálu', 'Vyčkej na výsledek kontroly.'],
  confirmed: ['Chyba originálu potvrzena', 'Obnova připraví náhradu.'],
  profile_intent: ['Připravuje se kvalita náhrady', 'Vyčkej na dokončení přípravy.'],
  holding: ['Pozastavuje se vadné vydání', 'Vyčkej na bezpečné zastavení.'],
  quarantine_intent: ['Přesun do karantény', 'Vyčkej na zachování kopií.'],
  quarantined: ['Kopie je v karanténě', 'Obnova připraví hledání náhrady.'],
  blocklist_intent: ['Vyřazuje se vadné vydání', 'Vyčkej na dokončení vyřazení.'],
  blocked: ['Vadné vydání vyřazeno', 'Obnova připraví hledání náhrady.'],
  search_intent: ['Spouští se hledání náhrady', 'Vyčkej na výsledek hledání.'],
  defer_cooldown_intent: ['Pozastavuje se vadná náhrada', 'Vyčkej na potvrzení pozastavení přesného vydání.'],
  defer_limit_intent: ['Pozastavuje se vadné vydání', 'Vyčkej na potvrzení pozastavení během denního limitu.'],
  replacement_queue_intent: ['Náhrada se předává Tdarru', 'Vyčkej na potvrzení předání.'],
  restore_source_intent: ['Vrací se zachovaná kopie', 'Vyčkej na dokončení návratu.'],
  remove_kept_source_intent: ['Připravuje se stažení náhrady', 'Vyčkej na dokončení přípravy.'],
  replacement_download_intent: ['Náhrada se předává ke stažení', 'Vyčkej na potvrzení stažení.'],
};
const RADARR_RUNNING = {
  preparing: ['Připravuje se náhrada', 'Vyčkej na dokončení přípravy.'],
  quarantine_intent: ['Zachovávají se obě kopie', 'Vyčkej na přesun do karantény.'],
  review_quarantined: ['Review kopie je v karanténě', 'Vyčkej na zachování originálu.'],
  quarantined: ['Obě kopie jsou v karanténě', 'Vyčkej na hledání náhrady.'],
  rescan_intent: ['Obnovuje se evidence v Radarru', 'Vyčkej na dokončení kontroly.'],
  search_intent: ['Spouští se hledání náhrady', 'Vyčkej na výsledek hledání.'],
  queue_intent: ['Náhrada se předává Tdarru', 'Vyčkej na potvrzení předání.'],
  restore_intent: ['Vrací se originál a převod', 'Vyčkej na dokončení návratu.'],
};

/** Classify structured facts; labels/messages are never completion evidence. */
const VERIFY_PAUSED_PHASES={replacement_request:['waiting_source_kept','waiting_replacement'],tdarr_handoff:['waiting_replacement','replacement_queue_intent'],quarantine_purge:['replacement_imported']};
const verifyPaused=r=>r?.source==='recovery'&&VERIFY_PAUSED_PHASES[r.verifyPausedStep]?.includes(r.phase)&&!r.cleanupComplete;

export function classifyRecovery(record, now = Date.now()) {
  const r = record || {};
  const clock = Number.isFinite(now) ? now : Date.now();
  const sourceRecovery = r.source === 'recovery';
  const stampValue = sourceRecovery ? r.statusUpdated : (r.statusUpdated || r.updated);
  const stamp = finiteTime(stampValue);
  let unknownTime = stamp === null || stamp > clock + 120000;
  let stale = !unknownTime && clock - stamp > RECOVERY_STALE_MS;
  const queue = ['waiting','waiting_replacement','waiting_source_kept','manual'].includes(r.phase) ? list(r.queue).filter(q=>q&&typeof q==='object'&&!Array.isArray(q)) : [];
  const searchStatus = normalize(r.search?.status);
  const tdarrStatus = normalize(r.tdarrStatus);
  const warnings = [text(r.error), text(r.retentionError), text(r.warning), ...queue.map(q => text(q.error))].filter(Boolean);
  const failedSearch = ['failed', 'aborted', 'cancelled'].includes(searchStatus);
  const blockedImport = queue.some(q => normalize(q.trackedDownloadState)==='importblocked');
  const failedQueue = blockedImport || queue.some(q => ['failed', 'error', 'warning', 'downloadclientunavailable'].includes(normalize(q.status)));
  if (failedSearch) warnings.push('Hledání v Radarru selhalo nebo bylo zrušené.');
  if (failedQueue) warnings.push('Fronta Radarru vyžaduje kontrolu.');
  if (stale) warnings.push('Stav je starší než 12 minut; obnov aktuální údaje.');
  if (unknownTime) warnings.push('Čas posledního ověření stavu není dostupný.');

  let category = 'unverified', label = 'Stav nelze ověřit', nextStep = 'Obnov stav a zkontroluj detail případu.', unknown = false;
  // deleteAfter is only published after the backend verified approval evidence.
  const approvalTime = finiteTime(r.approvedAt || r.cleanup?.approvedAt);
  const deletionTime = finiteTime(r.deleteAfter || r.cleanup?.deleteAfter);
  const approvalEvidence = (approvalTime !== null && approvalTime <= clock && r.approvalVerified !== false) || deletionTime !== null;
  if (r.cleanupComplete === true || r.cleanup?.complete === true) {
    category = 'done'; label = 'Náhrada schválena; karanténa uklizena'; nextStep = 'Obnova je dokončená.';
  } else if (approvalEvidence) {
    category = 'done'; label = 'Náhrada schválena'; nextStep = 'Karanténa zůstává do termínu automatického úklidu.';
  } else if (r.phase === 'restored') {
    category = 'done'; label = 'Obě kopie byly vráceny'; nextStep = 'Vrácený převod před případným schválením znovu ověř v Review.';
  } else if (r.phase === 'manual') {
    category = 'attention'; label = 'Obnova vyžaduje kontrolu'; nextStep = 'Otevři detail a ověř zachované kopie před další akcí.';
  } else if (r.phase === 'deferred_limit') {
    category = 'waiting'; label = 'Čeká na denní limit obnov'; nextStep = 'Obnova pokračuje po uvolnění limitu.';
  } else if (r.phase === 'deferred_cooldown') {
    category = 'waiting'; label = 'Vadná náhrada pozastavena'; nextStep = 'Film zůstává v Plexu. Další obnova čeká na ochranný limit; toto vydání se znovu nepřevádí.';
  } else if (r.phase === 'no_action') {
    if (r.originalCheckKind === 'healthy') {
      category = 'done'; label = 'Kontrola originálu bez chyby'; nextStep = 'Celý originál se dekódoval bez chyby. Jde o dokončení diagnostiky; výsledek převodu se schvaluje zvlášť v Review.';
    } else {
      category = 'attention'; label = 'Kontrola originálu nepotvrdila poškození'; nextStep = 'Prověř provozní nebo nejednoznačnou chybu v detailu. Náhrada se automaticky nestahuje.';
    }
  } else if (r.phase === 'dry_run') {
    category = 'attention'; label = 'Chyba potvrzena; změny jsou vypnuté'; nextStep = 'Zkontroluj nastavení Recovery před povolením obnovy.';
  } else if (r.phase === 'waiting_source_kept') {
    category = 'waiting'; label = 'Náhrada zatím nenalezena'; nextStep = 'Film zůstává v knihovně; vadné vydání se znovu nepřevádí.';
  } else if (r.phase === 'replacement_imported' || r.phase === 'imported') {
    const followup=r.replacementFollowup;
    if(sourceRecovery&&itemId(followup?.id)&&followup.id===r.replacementFollowupId&&followup.id!==r.id&&followup.source==='recovery'){
      // A later case concerns this exact replacement, not the preserved parent.
      // Do not inherit its completion/approval or use the parent's DB freshness.
      const next=classifyRecovery({source:'recovery',phase:followup.phase,statusUpdated:followup.statusUpdated,originalCheckKind:followup.originalCheckKind,verifyPausedStep:followup.verifyPausedStep,nextSearchAt:followup.nextSearchAt,tdarrStatus:followup.tdarrStatus,error:followup.hasError?'Navazující obnova vyžaduje kontrolu.':null},clock);
      category=next.category==='done'?'attention':next.category;
      label='Kontrola náhrady: '+next.label;
      nextStep=next.category==='done'?'Otevři navazující případ; dokončení diagnostiky není schválením náhrady.':next.nextStep;
      // The displayed activity belongs to the child. Retain real parent
      // errors, but do not apply the parent's observation age to this activity.
      for(let i=warnings.length-1;i>=0;i--)if(['Stav je starší než 12 minut; obnov aktuální údaje.','Čas posledního ověření stavu není dostupný.'].includes(warnings[i]))warnings.splice(i,1);
      const followupStamp=finiteTime(followup.statusUpdated);
      unknownTime=followupStamp===null||followupStamp>clock+120000;
      warnings.push(...next.warnings);unknown=next.unknown;stale=next.stale;
    } else if (tdarrStatus === 'queued') {
      category = 'running'; label = 'Čeká ve frontě Tdarru'; nextStep = 'Vyčkej na převod náhrady.';
    } else if (tdarrStatus === 'transcoding') {
      category = 'running'; label = 'Tdarr převádí náhradu'; nextStep = 'Výsledek se objeví v Review po dokončení převodu.';
    } else if (tdarrStatus === 'transcode success') {
      category = 'attention'; label = 'Převod dokončen; čeká na posouzení'; nextStep = 'Ověř výsledek v Review před schválením.';
    } else if (tdarrStatus === 'transcode error') {
      category = 'attention'; label = 'Převod náhrady skončil chybou'; nextStep = 'Zkontroluj detail chyby a zachované kopie.';
    } else if (tdarrStatus === 'not required') {
      category = 'attention'; label = 'Tdarr náhradu vynechal'; nextStep = 'Posuď důvod vynechání a funkčnost náhrady.';
    } else if (tdarrStatus === 'hold') {
      category = 'attention'; label = 'Náhrada je pozastavená v Tdarru'; nextStep = 'Zkontroluj důvod pozastavení a navazující případ Recovery.';
    } else {
      unknown = true; label = 'Náhrada předána; stav Tdarru není doložen'; nextStep = 'Obnov stav a ověř, kde se náhrada nachází.';
    }
  } else if (r.phase === 'waiting' || r.phase === 'waiting_replacement') {
    if (queue.length) {
      category = 'running'; label = 'Radarr stahuje nebo importuje náhradu'; nextStep = 'Vyčkej na import náhrady.';
    } else if (['started', 'queued', 'running'].includes(searchStatus)) {
      category = 'running'; label = 'Radarr hledá náhradu'; nextStep = 'Vyčkej na výsledek hledání.';
    } else if (searchStatus === 'completed' || (sourceRecovery && finiteTime(r.nextSearchAt) !== null)) {
      category = 'waiting'; label = 'Čeká na dostupnou náhradu'; nextStep = 'Zkontroluj plán dalšího hledání v detailu.';
    } else {
      unknown = true; label = 'Hledání nebo stažení není doložené'; nextStep = 'Ověř stav hledání v Radarru.';
    }
  } else {
    const running = (sourceRecovery ? RECOVERY_RUNNING : RADARR_RUNNING)[r.phase];
    if (running) { category = 'running'; [label, nextStep] = running; }
    else unknown = true;
  }
  if(verifyPaused(r)){category='waiting';label='Pozastaveno režimem Verify';nextStep='Po přepnutí na Repair Recovery znovu ověří aktuální stav a automaticky pokračuje.';unknown=false;}
  if (warnings.some(w => w !== 'Stav je starší než 12 minut; obnov aktuální údaje.' && w !== 'Čas posledního ověření stavu není dostupný.')) {
    category = 'attention'; nextStep = 'Zkontroluj upozornění v detailu případu.';
    if(blockedImport){label='Staženo; Radarr blokuje import';nextStep='Otevři frontu Radarru a přiřaď stažený soubor správnému filmu přes ruční import. Nové stahování není potřeba.';}
  } else if ((stale || unknownTime) && !['done', 'attention'].includes(category)) {
    category = 'unverified'; nextStep = 'Obnov seznam. Pokud stav zůstane neověřený, správce musí zkontrolovat propojení Recovery a Tdarru; převod ani nové stažení nespouštěj naslepo.';
  }
  return {category, label, nextStep, stale, unknown: unknown || unknownTime, warnings: [...new Set(warnings)], confirmedAudioFault: r.audioFaultConfirmed === true || r.phase === 'waiting_source_kept'};
}

/** Display only measured progress. Completion of FFmpeg's progress stream is
 * never approval or evidence of a healthy full decode. */
export function recoveryProgress(record, now = Date.now()) {
  const p = record?.progress;
  if (record?.source !== 'recovery' || record.phase !== 'verifying' || p?.stage !== 'original_decode' || ![1, 2].includes(p.pass)) return null;
  const started = finiteTime(p.startedAt), measured = finiteTime(p.updatedAt), heartbeat = finiteTime(p.heartbeatAt), advanced = finiteTime(p.lastAdvanceAt);
  const validTime = value => value !== null && value <= now + 120000;
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const seconds = number(p.seconds) ? p.seconds : null, duration = hasDuration(p.durationSeconds) ? p.durationSeconds : null;
  const freshMeasurement = validTime(measured) && now - measured <= 90000;
  const alive = p.running === true && validTime(heartbeat) && now - heartbeat <= 90000;
  const noAdvance = p.running === true && validTime(advanced ?? started) && now - (advanced ?? started) > 90000;
  let note = 'Kontroluje se dekódování původního obrazu a všech zvukových stop. Každý průchod má vlastní postup.';
  if (!p.running) note = 'Průchod skončil; čeká se na vyhodnocení skutečného výsledku dekódování.';
  else if (!alive) note = 'Chybí čerstvé hlášení Recovery; obnovením ověř spojení. Samo o sobě to nedokazuje chybu filmu.';
  else if (noAdvance) note = 'Recovery odpovídá, ale poloha kontroly se přes 90 sekund nezměnila. Může čekat na čtení dat; chyba filmu tím není potvrzená.';
  else if (!freshMeasurement) note = 'Recovery odpovídá; čeká se na další měření z dekodéru.';
  return {pass:p.pass,running:p.running === true,alive,note,seconds,duration,percent:seconds !== null && duration !== null ? Math.min(99.9,100 * seconds / duration) : null,
    elapsedSeconds:validTime(started) ? Math.max(0,(now-started)/1000) : null,
    etaSeconds:p.running === true && duration !== null && freshMeasurement && alive && !noAdvance && number(p.etaSeconds) ? p.etaSeconds : null,
    speed:hasDuration(p.speed) ? p.speed : null,measuredAt:validTime(measured)?p.updatedAt:null,heartbeatAt:validTime(heartbeat)?p.heartbeatAt:null};
}

/** Download percentages never describe import, encoding or approval progress. */
export function downloadProgress(record) {
  if(!['waiting','waiting_replacement','waiting_source_kept','manual'].includes(record?.phase))return [];
  return list(record.queue).filter(q=>q&&typeof q==='object'&&!Array.isArray(q)).slice(0,8).map(q=>{
    const state=normalize(q?.trackedDownloadState),status=normalize(q?.status);
    const stage=state==='importblocked'?'blocked':state==='importing'?'importing':status==='completed'?'downloaded':status==='paused'?'paused':'downloading';
    const labels={blocked:'Staženo; import je zablokovaný',importing:'Radarr importuje film',downloaded:'Staženo; čeká na import',paused:'Stahování je pozastavené',downloading:'Průběh stahování'};
    const measured=typeof q.percent==='number'&&Number.isFinite(q.percent)&&q.percent>=0;
    const left=text(q.timeleft);
    const eta=stage==='downloading'&&/^\d{1,6}:[0-5]\d:[0-5]\d$/.test(left)&&!/^0+:00:00$/.test(left)?left:null;
    return {title:text(q.title),stage,label:labels[stage],downloadPercent:measured?Math.min(100,q.percent):null,eta,error:text(q.error)};
  });
}

/** Only read-only Recovery details may follow live observations automatically.
 * Approval and restorable requests keep their original decision snapshot. */
export function liveRecoveryRecord(current, records) {
  if (current?.source !== 'recovery' || current.canRestore !== false || typeof current.id !== 'string') return null;
  return list(records).find(r => r?.source === 'recovery' && r.id === current.id && r.canRestore === false) || null;
}

/** Exact itemId matches only. Same titles never merge distinct cases/files. */
export function projectRequests(requests, items = [], now = Date.now()) {
  const records = Array.isArray(requests) ? requests : list(requests?.requests);
  const reviewItems = Array.isArray(items) ? items : list(items?.items);
  const byId = new Map(reviewItems.filter(x => itemId(x?.id)).map(x => [x.id, x]));
  return records.map((r, index) => {
    const record = r && typeof r === 'object' ? r : {};
    const linkedItem = typeof record.itemId === 'string' ? byId.get(record.itemId) || null : null;
    const classification = classifyRecovery(record, now);
    return {...record, key: `${record.source === 'recovery' ? 'recovery' : 'radarr'}:${record.id || `unknown-${index}`}`, reviewItemId: linkedItem?.id || null, linkedItem, classification, ...classification};
  });
}

/** Earliest later success for the same exact file ID and action, regardless
 * of array order. This proves a subsequent decision, not a repair diagnosis. */
export function historyFollowup(entry, history) {
  if (!itemId(entry?.id) || !text(entry?.action)) return null;
  const entryTime = finiteTime(entry.time);
  if (entryTime === null) return null;
  let followup = null, followupTime = Infinity;
  for (const candidate of list(history)) {
    if (!itemId(candidate?.id) || candidate.id !== entry.id || candidate.action !== entry.action || candidate.status !== 'success') continue;
    const time = finiteTime(candidate.time);
    if (time !== null && time > entryTime && time < followupTime) {
      followup = candidate;
      followupTime = time;
    }
  }
  return followup;
}

/** Warnings are history events, not new pending review films. Later successful
 * decisions remove prior error-only events from the main attention badge;
 * warning text remains visible until explicitly resolved. */
export function historyWarnings(history) {
  return list(history).flatMap((h, index) => {
    const warning = text(h?.warning);
    const activeError = h?.status === 'error' && !h?.fixedIn && !historyFollowup(h, history);
    if (!warning && !activeError) return [];
    return [{key: `history:${h.id || 'unknown'}:${h.action || 'event'}:${h.time || index}`, id: h.id, title: h.title, action: h.action, time: h.time, status: h.status, category: 'attention', severity: activeError ? 'error' : 'warning', message: [activeError ? text(h.message) || 'Operace skončila chybou.' : '', warning].filter(Boolean).join(' '), entry: h, reviewItemId: null}];
  });
}

/** Read-only explanation of a quarantined file. Never supplies deletion rights. */
export function quarantineLifecycle(file, requests, now = Date.now()) {
  const matches = itemId(file?.caseId) ? list(requests).filter(r => r?.id === file.caseId) : [];
  if(matches.length !== 1) return {label:'Případ není jednoznačně přiřazen', requestKey:null, deleteAfter:null, reason:'Soubor zůstává zachovaný; nelze určit podmínky jeho úklidu.'};
  const r=matches[0],requestKey=`${r.source==='recovery'?'recovery':'radarr'}:${r.id}`;
  const error=text(r.error)||text(r.retentionError),deadline=finiteTime(r.deleteAfter||r.cleanup?.deleteAfter);
  if(error) return {label:'Úklid vyžaduje kontrolu',requestKey,deleteAfter:deadline,reason:error};
  if(r.cleanupComplete===true||r.cleanup?.complete===true) return {label:'Soubor je stále přítomný po evidovaném úklidu',requestKey,deleteAfter:deadline,reason:'Otevři obnovu a ověř evidenci; automatické mazání nelze odvodit z tohoto přehledu.'};
  if(deadline!==null) return {label:deadline>now?'Čeká na konec schválené lhůty':'Lhůta uběhla; čeká na bezpečný úklid',requestKey,deleteAfter:deadline,reason:'Úklid proběhne jen při splnění kontrol identity zachovaných souborů.'};
  return {label:'Chybí doložené schválení náhrady',requestKey,deleteAfter:null,reason:'Nejprve je potřeba posoudit funkční náhradu. Samotný úspěšný převod nestačí k úklidu karantény.'};
}

/** UI links must tolerate older snapshots and require a unique real child. */
export function recoveryFollowup(record,records){
 const child=record?.replacementFollowup;
 if(record?.source!=='recovery'||!itemId(child?.id)||child.id!==record.replacementFollowupId||child.id===record.id||child.source!=='recovery')return null;
 return list(records).filter(r=>r?.id===child.id&&r.source==='recovery').length===1?child:null;
}

// Recovery's config.json was edited after start-up and needs a restart (status file `configChange`).
export function recoveryConfigNotice(change) {
  if (!change || change.restartRequired !== true) return null;
  return {kind: change.valid === false ? 'failure' : 'warning', detectedAt: finiteTime(change.detectedAt), error: change.valid === false ? text(change.error) || null : null};
}

/** A container restart interrupts Recovery's original checks and journaled mutations. */
const RECOVERY_MUTATION_PHASES=new Set(['profile_intent','holding','quarantine_intent','quarantined','blocklist_intent','blocked','search_intent','defer_limit_intent','defer_cooldown_intent','replacement_queue_intent','restore_source_intent','remove_kept_source_intent','replacement_download_intent']);
export function recoveryIsBusy(requests,runtime){
  if(runtime?.state!=='running')return false;
  return list(requests).some(r=>{
    if(r?.source!=='recovery'||verifyPaused(r))return false;
    if(r.phase==='verifying'||RECOVERY_MUTATION_PHASES.has(r.phase))return true;
    if(!['candidate','confirmed'].includes(r.phase))return false;
    const hash=fullHashProgress(r);
    return hash!==null&&hash.done!==null&&hash.total>0&&hash.done<hash.total;
  });
}

const FULL_HASH_STAGES = {confirmation: 'při potvrzení chyby', before_quarantine: 'před přesunem do karantény'};
// Optional full SHA-256 of an original that Recovery is reading (case `fullHash`, setting fullSourceHash).
export function fullHashProgress(record, now = Date.now()) {
  const h = record?.fullHash;
  if (record?.source !== 'recovery' || !h || typeof h !== 'object' || !Object.hasOwn(FULL_HASH_STAGES, h.stage)) return null;
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  const done = number(h.done), total = number(h.total), updated = finiteTime(h.updated) ?? finiteTime(h.started);
  return {stage: h.stage, label: FULL_HASH_STAGES[h.stage], done, total, percent: done !== null && total ? Math.min(100, 100 * done / total) : null, stale: updated === null || updated > now + 120000 || now - updated > 90000};
}

