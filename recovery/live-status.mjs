import {projectReplacementFollowups} from './replacement-followup.mjs';
// Public status is a projection of the private journal, never a repair decision.
const PUBLIC_FIELDS = ['verifyPausedStep', 'originalOutsideLibrary', 'originalOutsideSince', 'originalRestoredAt', 'legacyReplacementBinding', 'replacementFollowupId', 'replacementFollowupBinding', 'id', 'title', 'phase', 'pipelineLabel', 'source', 'message', 'reason', 'created', 'updated', 'lastSearchAt', 'nextSearchAt', 'nextRetryAt', 'sourceRetained', 'originalCheckKind', 'bindingFailure', 'sourceConfirmed', 'tmdbId', 'titleSlug', 'edition', 'error', 'retentionErrorPresent', 'tdarrStatus', 'replacementTitle', 'quarantineRetained', 'cleanupComplete', 'deleteAfter', 'canRestore', 'fullHash'];
const PUBLIC_TEXT = ['message', 'reason', 'error'];
const iso = value => new Date(value).toISOString();
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const publicText = value => typeof value === 'string' ? value.slice(0, 2000).replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s'"<>]+|\/(?:[^\s/'"<>]+\/)+[^\s'"<>]*/g, '[soukromá cesta]') : null;

/** Parse FFmpeg -progress output. End of a progress stream is not health evidence. */
export function createDecodeProgressParser(update, clock = Date.now) {
  let buffer = '', record = {}, lastSeconds = null;
  const keys = new Set(['out_time_us', 'out_time_ms', 'out_time', 'speed', 'fps', 'frame', 'progress']);
  return chunk => {
    buffer += String(chunk);
    if (buffer.length > 65536) buffer = buffer.slice(-65536);
    const lines = buffer.split('\n'); buffer = lines.pop();
    for (const raw of lines) {
      const line = raw.trim(), separator = line.indexOf('=');
      if (separator < 1) continue;
      const key = line.slice(0, separator), value = line.slice(separator + 1);
      if (!keys.has(key)) continue;
      record[key] = value;
      if (key !== 'progress') continue;
      if (!['continue', 'end'].includes(value)) { record = {}; continue; }
      const number = raw => typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
      let seconds = number(record.out_time_us) / 1e6;
      if (!Number.isFinite(seconds)) seconds = number(record.out_time_ms) / 1e6;
      if (!Number.isFinite(seconds)) {
        const match = /^(\d+):([0-5]\d):([0-5]\d(?:\.\d+)?)$/.exec(record.out_time || '');
        seconds = match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : NaN;
      }
      if (Number.isFinite(seconds)) lastSeconds = Math.max(lastSeconds ?? 0, seconds, 0);
      const speed = number(record.speed?.replace(/x$/, '')), fps = number(record.fps), frame = number(record.frame);
      update({seconds: lastSeconds, speed: positive(speed) ? speed : null, fps: Number.isFinite(fps) && fps >= 0 ? fps : null, frame: Number.isSafeInteger(frame) && frame >= 0 ? frame : null, ended: value === 'end', updatedAt: clock()});
      record = {};
    }
  };
}

/** Coalesce writes and keep DB freshness separate from worker/decode liveness.
 * publish({state, tdarrFiles, decorate}) uses the existing public status exporter
 * and applies decorate(snapshot) immediately before its serialized atomic write.
 */
export function createLiveStatusPublisher({getState, publish, readTdarrFiles, clock = Date.now, heartbeatMs = 30000, progressIntervalMs = 15000, onError = () => {}, setIntervalFn = setInterval, clearIntervalFn = clearInterval}) {
  if (![getState, publish, readTdarrFiles].every(fn => typeof fn === 'function') || !positive(heartbeatMs) || !positive(progressIntervalMs)) throw Error('Invalid live status publisher configuration');
  const phases = new Map(), decodes = new Map(), retention = new Map();
  let files = [], filesCheckedAt = null, pending = false, refreshPending = false, inFlight = null, timer = null, closed = false, lastProgressPublication = -Infinity;
  const notify = error => { try { onError(error); } catch {} };
  const stopTimer = () => { if (timer !== null) { clearIntervalFn(timer); timer = null; } };

  function decorate(snapshot) {
    const now = clock(), state = getState();
    // configChange is already reduced to its public fields by the exporter; registryAllowedModes holds only mode names.
    return projectReplacementFollowups({version: snapshot.version, updated: iso(now), configChange: snapshot.configChange ?? null, registryAllowedModes: snapshot.registryAllowedModes ?? null, cases: (snapshot.cases || []).map(entry => {
      const c = state.cases?.[entry.id] || {}, phase = phases.get(entry.id), decode = decodes.get(entry.id);
      const previous = retention.get(entry.id), retentionKey = JSON.stringify([c.cleanup?.approvedAt, c.cleanup?.deleteAfter, c.cleanup?.complete, c.cleanup?.completedAt, c.retentionError]);
      if (!previous) retention.set(entry.id, {key: retentionKey, changedAt: Math.max(timestamp(c.cleanup?.approvedAt) ?? 0, timestamp(c.cleanup?.completedAt) ?? 0)});
      else if (previous.key !== retentionKey) retention.set(entry.id, {key: retentionKey, changedAt: now});
      const result = Object.fromEntries(PUBLIC_FIELDS.filter(key => Object.hasOwn(entry, key)).map(key => [key, entry[key]]));
      for (const key of PUBLIC_TEXT) if (Object.hasOwn(result, key)) result[key] = publicText(result[key]);
      result.queue = (Array.isArray(entry.queue) ? entry.queue : []).map(q => ({title: q.title, status: q.status, trackedDownloadState: q.trackedDownloadState, trackedDownloadStatus: q.trackedDownloadStatus, percent: q.percent, timeleft: q.timeleft, error: publicText(q.error)}));
      const active = c.status === 'verifying' && decode?.running === true;
      const observed = Math.max(timestamp(c.updated) ?? 0, phase?.startedAt ?? 0, retention.get(entry.id)?.changedAt ?? 0, filesCheckedAt ?? 0, decode?.finishedAt ?? 0, active ? now : 0);
      result.statusUpdated = observed > 0 ? iso(observed) : null;
      result.phaseStartedAt = phase?.status === c.status ? iso(phase.startedAt) : c.updated || null;
      result.tdarrStatusUpdated = c.status === 'replacement_imported' && filesCheckedAt !== null ? iso(filesCheckedAt) : null;
      result.heartbeatAt = active ? iso(now) : null;
      result.progress = null;
      if (c.status === 'verifying' && decode) {
        const done = decode.doneSeconds, duration = decode.durationSeconds, elapsed = Math.max(0, (now - decode.startedAt) / 1000);
        const rate = positive(decode.speed) ? decode.speed : elapsed > 0 && done !== null ? done / elapsed : null;
        result.progress = {stage: 'original_decode', pass: decode.pass, totalPasses: 2, running: decode.running, startedAt: iso(decode.startedAt), updatedAt: decode.updatedAt === null ? null : iso(decode.updatedAt), lastAdvanceAt: decode.lastAdvanceAt === null ? null : iso(decode.lastAdvanceAt), heartbeatAt: active ? iso(now) : null,
          seconds: done, durationSeconds: duration, percent: duration !== null && done !== null ? Math.min(99.9, 100 * done / duration) : null, speed: decode.speed, fps: decode.fps, frame: decode.frame,
          etaSeconds: decode.running && elapsed >= 5 && duration !== null && done !== null && positive(rate) ? Math.max(0, (duration - done) / rate) : null, ended: decode.recordEnded};
      }
      return result;
    })});
  }

  function requestPublication(refresh = false) {
    if (closed) return Promise.reject(Error('Live status publisher is closed'));
    pending = true; refreshPending ||= refresh;
    if (!inFlight) inFlight = Promise.resolve().then(async () => {
      while (pending) {
        pending = false; const refresh = refreshPending; refreshPending = false;
        if (refresh) {
          const rows = await readTdarrFiles();
          if (!Array.isArray(rows)) throw Error('Invalid Tdarr status snapshot');
          files = rows.filter(row => row && typeof row === 'object').map(row => ({_id: row._id, DB: row.DB, TranscodeDecisionMaker: row.TranscodeDecisionMaker}));
          filesCheckedAt = clock();
        }
        await publish({state: getState(), tdarrFiles: files, decorate});
      }
    }).finally(() => { inFlight = null; });
    return inFlight;
  }

  function ensureTimer() {
    if (timer !== null) return;
    timer = setIntervalFn(() => { void requestPublication().catch(notify); }, heartbeatMs);
    timer?.unref?.();
  }

  return {
    refresh: () => requestPublication(true),
    phaseChanged(c) {
      if (closed) return Promise.reject(Error('Live status publisher is closed'));
      const previous = phases.get(c.id), signature = JSON.stringify([c.status, c.message]);
      if (!previous || previous.signature !== signature) phases.set(c.id, {status: c.status, signature, startedAt: clock()});
      if (c.status !== 'verifying') decodes.delete(c.id);
      if (![...decodes.values()].some(value => value.running)) stopTimer();
      return requestPublication();
    },
    startDecode(c, {pass, durationSeconds = null}) {
      if (closed || c.status !== 'verifying' || ![1, 2].includes(pass)) throw Error('Invalid original decode pass');
      decodes.set(c.id, {pass, running: true, startedAt: clock(), durationSeconds: positive(durationSeconds) ? durationSeconds : null, doneSeconds: null, speed: null, fps: null, frame: null, updatedAt: null, lastAdvanceAt: null, recordEnded: false});
      lastProgressPublication = -Infinity; ensureTimer();
      return requestPublication();
    },
    updateDecode(c, measurement, pass) {
      const decode = decodes.get(c.id);
      if (!decode?.running || c.status !== 'verifying' || decode.pass !== pass) return;
      const now = clock(), value = measurement?.seconds;
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        const bounded = decode.durationSeconds !== null ? Math.min(decode.durationSeconds, value) : value;
        if (decode.doneSeconds === null || bounded > decode.doneSeconds) decode.lastAdvanceAt = now;
        decode.doneSeconds = Math.max(decode.doneSeconds ?? 0, bounded);
      }
      decode.speed = positive(measurement?.speed) ? measurement.speed : null;
      decode.fps = typeof measurement?.fps === 'number' && Number.isFinite(measurement.fps) && measurement.fps >= 0 ? measurement.fps : null;
      decode.frame = Number.isSafeInteger(measurement?.frame) && measurement.frame >= 0 ? measurement.frame : null;
      decode.recordEnded = measurement?.ended === true; decode.updatedAt = now;
      if (now - lastProgressPublication >= progressIntervalMs) { lastProgressPublication = now; void requestPublication().catch(notify); }
    },
    finishDecode(c) {
      const decode = decodes.get(c.id); if (decode) { decode.running = false; decode.finishedAt = clock(); }
      if (![...decodes.values()].some(value => value.running)) stopTimer();
      return requestPublication();
    },
    async flush() { while (inFlight) await inFlight; },
    async close() { stopTimer(); while (inFlight) await inFlight; closed = true; },
  };
}
