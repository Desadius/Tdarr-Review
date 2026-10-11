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
  const allowed = !writeBlocked && validItem;
  // Comparison uses POST and audio comparison stores evidence. Apply write
  // guards conservatively to previews as well as explicit file operations.
  const previewAllowed = !writeBlocked && validItem;
  const restorePhase = ['waiting', 'manual'].includes(item?.phase);
  return {
    approve: allowed && (normalApproval || durationApproval),
    approveBatch: allowed && normalApproval,
    select: allowed && normalApproval,
    reject: allowed,
    replace: allowed && context.requestsFresh !== false && !requestConflict,
    recheck: allowed && item?.canRecheck === true,
    compareImage: previewAllowed && hasDuration(item?.durationA) && hasDuration(item?.durationB),
    compareAudio: previewAllowed && hasDuration(item?.durationA),
    download: context.authenticated === true && itemId(item?.id),
    // Request identity/capability comes from the server, not its display title.
    restore: !writeBlocked && itemId(item?.id) && item?.canRestore === true && item?.source !== 'recovery' && restorePhase && !list(item?.queue).length && !item?.replacement && context.requestsFresh !== false,
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
export function classifyRecovery(record, now = Date.now()) {
  const r = record || {};
  const clock = Number.isFinite(now) ? now : Date.now();
  const sourceRecovery = r.source === 'recovery';
  const stampValue = sourceRecovery ? r.statusUpdated : (r.statusUpdated || r.updated);
  const stamp = finiteTime(stampValue);
  const unknownTime = stamp === null || stamp > clock + 120000;
  const stale = !unknownTime && clock - stamp > RECOVERY_STALE_MS;
  const queue = list(r.queue);
  const searchStatus = normalize(r.search?.status);
  const tdarrStatus = normalize(r.tdarrStatus);
  const warnings = [text(r.error), text(r.retentionError), text(r.warning), ...queue.map(q => text(q.error))].filter(Boolean);
  const failedSearch = ['failed', 'aborted', 'cancelled'].includes(searchStatus);
  const failedQueue = queue.some(q => ['failed', 'error', 'warning', 'downloadclientunavailable'].includes(normalize(q.status)));
  if (failedSearch) warnings.push('Hledání v Radarru selhalo nebo bylo zrušené.');
  if (failedQueue) warnings.push('Fronta Radarru vyžaduje kontrolu.');
  if (stale) warnings.push('Stav je starší než 12 minut; obnov aktuální údaje.');
  if (unknownTime) warnings.push('Čas posledního ověření stavu není dostupný.');

  let category = 'attention', label = 'Stav nelze ověřit', nextStep = 'Obnov stav a zkontroluj detail případu.', unknown = false;
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
    label = 'Obnova vyžaduje kontrolu'; nextStep = 'Otevři detail a ověř zachované kopie před další akcí.';
  } else if (r.phase === 'deferred_limit') {
    category = 'waiting'; label = 'Čeká na denní limit obnov'; nextStep = 'Obnova pokračuje po uvolnění limitu.';
  } else if (r.phase === 'waiting_source_kept') {
    category = 'waiting'; label = 'Náhrada zatím nenalezena'; nextStep = 'Film zůstává v knihovně; vadné vydání se znovu nepřevádí.';
  } else if (r.phase === 'replacement_imported' || r.phase === 'imported') {
    if (tdarrStatus === 'queued') {
      category = 'running'; label = 'Čeká ve frontě Tdarru'; nextStep = 'Vyčkej na převod náhrady.';
    } else if (tdarrStatus === 'transcoding') {
      category = 'running'; label = 'Tdarr převádí náhradu'; nextStep = 'Výsledek se objeví v Review po dokončení převodu.';
    } else if (tdarrStatus === 'transcode success') {
      label = 'Převod dokončen; čeká na posouzení'; nextStep = 'Ověř výsledek v Review před schválením.';
    } else if (tdarrStatus === 'transcode error') {
      label = 'Převod náhrady skončil chybou'; nextStep = 'Zkontroluj detail chyby a zachované kopie.';
    } else if (tdarrStatus === 'not required') {
      label = 'Tdarr náhradu vynechal'; nextStep = 'Posuď důvod vynechání a funkčnost náhrady.';
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
  if (warnings.some(w => w !== 'Stav je starší než 12 minut; obnov aktuální údaje.' && w !== 'Čas posledního ověření stavu není dostupný.')) {
    category = 'attention'; nextStep = 'Zkontroluj upozornění v detailu případu.';
  } else if ((stale || unknownTime) && category !== 'done') {
    category = 'attention'; nextStep = 'Obnov stav; aktuální průběh nelze spolehlivě ověřit.';
  }
  return {category, label, nextStep, stale, unknown: unknown || unknownTime, warnings: [...new Set(warnings)], confirmedAudioFault: r.audioFaultConfirmed === true || r.phase === 'waiting_source_kept'};
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
