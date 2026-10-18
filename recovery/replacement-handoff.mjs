import path from 'node:path';

const acceptedStates = new Set([
  'Queued', 'Transcoding', 'Transcode success', 'Transcode error', 'Not required',
]);

function fail(code, message) {
  throw Object.assign(new Error(message), {code});
}

// Shared by Recovery's worker and Review's manual Radarr replacement.
// Persist intent before calling it. On an interrupted call, invoke it again with
// the same verified file/library; the fresh read reconciles accepted mutations.
export async function ensureHandoff({tdarr, file, libraryId, preserveHold = false}) {
  if (typeof tdarr !== 'function' || typeof file !== 'string' ||
      !file.startsWith('/') || file.includes('\0') || path.posix.normalize(file) !== file ||
      typeof libraryId !== 'string' || !libraryId.trim() || typeof preserveHold !== 'boolean') {
    fail('TDARR_HANDOFF_BINDING', 'Invalid Tdarr handoff target');
  }

  const read = async () => {
    const row = await tdarr('/api/v2/cruddb', {
      collection: 'FileJSONDB', mode: 'getById', docID: file,
    });
    if (row === '' || row === null) return null;
    if (!row || typeof row !== 'object' || Array.isArray(row) ||
        row._id !== file || row.DB !== libraryId) {
      fail('TDARR_HANDOFF_BINDING', 'Invalid Tdarr file binding');
    }
    return row;
  };

  let row = await read();
  if (!row) {
    if (preserveHold) fail('TDARR_HANDOFF_PENDING', 'Protected source entry is missing; no rescan or queue write is permitted.');
    // Tdarr may reply with plain "OK". Only the following exact DB read is an
    // acknowledgement that the scan has produced this replacement's record.
    await tdarr('/api/v2/rescan-file', {_id: file, DB: libraryId});
    row = await read();
    if (!row) {
      fail('TDARR_HANDOFF_PENDING', 'Tdarr scan pending; handoff will be checked again.');
    }
  }

  if (acceptedStates.has(row.TranscodeDecisionMaker)) return row.TranscodeDecisionMaker;
  if (row.TranscodeDecisionMaker !== 'Hold') {
    fail('TDARR_HANDOFF_STATE', 'Unrecognized Tdarr state; handoff requires inspection.');
  }
  if (preserveHold) return 'Hold';

  await tdarr('/api/v2/bulk-update-files', {
    fileIds: [file], updatedObj: {TranscodeDecisionMaker: 'Queued', holdUntil: 0},
  });
  row = await read();
  if (!row || !acceptedStates.has(row.TranscodeDecisionMaker)) {
    fail('TDARR_HANDOFF_PENDING', 'Queue acknowledgement pending; handoff will be checked again.');
  }
  return row.TranscodeDecisionMaker;
}

// A newer case may hold this exact imported source after confirming its own decoding error: it kept the
// current edition, or froze a cooldown/daily-limit deferral for it. An older or manual handoff of the
// same file must then preserve that Hold. Bound to the source identity, so a different import is free.
export function preservesHold(cases, {id = null, file, sourceFP, libraryId}) {
  return Object.values(cases && typeof cases === 'object' ? cases : {}).some(other =>
    other && other.id !== id && other.file === file &&
    ((other.skipCurrentEdition === true && other.preservedSourceFP === sourceFP) ||
      [other.deferredCooldown, other.deferredLimit].some(journal =>
        journal?.file === file && journal.sourceFP === sourceFP && journal.libraryId === libraryId)));
}
