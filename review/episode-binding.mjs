const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isPositiveId = (value) => Number.isSafeInteger(value) && value > 0;
const isNumbering = (value) => value === null || (Number.isSafeInteger(value) && value >= 0);
const isOptionalString = (value) => value === null || typeof value === 'string';
const isOptionalBoolean = (value) => value === null || typeof value === 'boolean';

function invalid(reason) {
  return { status: 'invalid', reason };
}

function ambiguous(reason) {
  return { status: 'ambiguous', reason };
}

function numbering(record, name) {
  const value = record[name] ?? null;
  return isNumbering(value) ? { valid: true, value } : { valid: false };
}

function optionalString(record, name) {
  const value = record[name] ?? null;
  return isOptionalString(value) ? { valid: true, value } : { valid: false };
}

function optionalBoolean(record, name) {
  const value = record[name] ?? null;
  return isOptionalBoolean(value) ? { valid: true, value } : { valid: false };
}

/**
 * Resolve a canonical Sonarr file path to its selected-series EpisodeFile and
 * every episode explicitly linked to that file in the caller's snapshot.
 *
 * `episodeFiles` and `episodes` are Sonarr v3 API records supplied by the
 * caller. This function performs no I/O, path normalization, filename
 * inference, or snapshot freshness/completeness check. A mapped result is
 * descriptive metadata only; it is not filesystem identity, validation,
 * approval, or authority to mutate media.
 *
 * @param {{instanceKey: string, seriesId: number, filePath: string, episodeFiles: object[], episodes: object[]}} input
 * @returns {{status: 'mapped', binding: {instanceKey: string, seriesId: number, episodeFileId: number, episodeIds: number[]}, file: {path: string, relativePath: string|null, seasonNumber: number|null, sceneName: string|null}, episodes: Array<{id: number, seasonNumber: number|null, episodeNumber: number|null, absoluteEpisodeNumber: number|null, sceneAbsoluteEpisodeNumber: number|null, sceneSeasonNumber: number|null, sceneEpisodeNumber: number|null, unverifiedSceneNumbering: boolean|null, airDate: string|null, airDateUtc: string|null}>} | {status: 'invalid'|'unmapped'|'ambiguous', reason: string}}
 */
export function resolveEpisodeBinding(input = {}) {
  if (!isRecord(input)) return invalid('invalid-input');
  const { instanceKey, seriesId, filePath, episodeFiles, episodes } = input;
  if (typeof instanceKey !== 'string' || instanceKey.trim() === ''
      || !isPositiveId(seriesId)
      || typeof filePath !== 'string' || filePath.length === 0
      || !Array.isArray(episodeFiles) || !Array.isArray(episodes)) {
    return invalid('invalid-input');
  }

  const allFiles = [];
  for (const record of episodeFiles) {
    if (!isRecord(record) || !isPositiveId(record.id) || !isPositiveId(record.seriesId)
        || typeof record.path !== 'string' || record.path.length === 0) {
      return invalid('invalid-episode-file');
    }
    const season = numbering(record, 'seasonNumber');
    const relativePath = optionalString(record, 'relativePath');
    const sceneName = optionalString(record, 'sceneName');
    if (!season.valid || !relativePath.valid || !sceneName.valid) return invalid('invalid-episode-file');
    allFiles.push({
      id: record.id,
      seriesId: record.seriesId,
      path: record.path,
      relativePath: relativePath.value,
      seasonNumber: season.value,
      sceneName: sceneName.value,
    });
  }

  const selectedFiles = allFiles.filter((record) => record.seriesId === seriesId);
  const pathMatches = allFiles.filter((record) => record.path === filePath);
  if (pathMatches.length > 1) return ambiguous('duplicate-file-path');
  if (pathMatches.length === 1 && pathMatches[0].seriesId !== seriesId) {
    return invalid('file-series-mismatch');
  }

  const selectedFileIds = new Set(selectedFiles.map(({ id }) => id));
  if (selectedFileIds.size !== selectedFiles.length) return ambiguous('duplicate-episode-file-id');
  for (const record of allFiles) {
    if (record.seriesId !== seriesId && selectedFileIds.has(record.id)) {
      return ambiguous('duplicate-episode-file-id');
    }
  }

  const targetFiles = selectedFiles.filter((record) => record.path === filePath);
  if (targetFiles.length === 0) return { status: 'unmapped', reason: 'file-not-found' };
  if (targetFiles.length > 1) return ambiguous('duplicate-file-path');
  const targetFile = targetFiles[0];

  const allEpisodes = [];
  for (const record of episodes) {
    if (!isRecord(record) || !isPositiveId(record.id) || !isPositiveId(record.seriesId)) {
      return invalid('invalid-episode');
    }
    const linkedFileId = record.episodeFileId;
    if (linkedFileId !== null && linkedFileId !== 0 && !isPositiveId(linkedFileId)) return invalid('invalid-episode');
    if (Object.hasOwn(record, 'hasFile')) {
      const hasFile = record.hasFile;
      if (typeof hasFile !== 'boolean' || hasFile !== isPositiveId(linkedFileId)) {
        return invalid('episode-file-conflict');
      }
    }
    let embeddedEpisodeFile = null;
    if (Object.hasOwn(record, 'episodeFile') && record.episodeFile !== null) {
      const embedded = record.episodeFile;
      if (!isRecord(embedded) || !isPositiveId(embedded.id) || !isPositiveId(embedded.seriesId)
          || typeof embedded.path !== 'string' || embedded.path.length === 0
          || !isPositiveId(linkedFileId)
          || embedded.id !== linkedFileId || embedded.seriesId !== record.seriesId) {
        return invalid('episode-file-conflict');
      }
      embeddedEpisodeFile = { id: embedded.id, seriesId: embedded.seriesId, path: embedded.path };
    }
    const coordinates = {};
    for (const key of ['seasonNumber', 'episodeNumber', 'absoluteEpisodeNumber', 'sceneAbsoluteEpisodeNumber', 'sceneSeasonNumber', 'sceneEpisodeNumber']) {
      const result = numbering(record, key);
      if (!result.valid) return invalid('invalid-episode');
      coordinates[key] = result.value;
    }
    const airDate = optionalString(record, 'airDate');
    const airDateUtc = optionalString(record, 'airDateUtc');
    const unverifiedSceneNumbering = optionalBoolean(record, 'unverifiedSceneNumbering');
    if (!airDate.valid || !airDateUtc.valid || !unverifiedSceneNumbering.valid) return invalid('invalid-episode');
    allEpisodes.push({
      id: record.id,
      seriesId: record.seriesId,
      episodeFileId: linkedFileId,
      embeddedEpisodeFile,
      metadata: {
        id: record.id,
        ...coordinates,
        unverifiedSceneNumbering: unverifiedSceneNumbering.value,
        airDate: airDate.value,
        airDateUtc: airDateUtc.value,
      },
    });
  }

  const selectedEpisodes = allEpisodes.filter((record) => record.seriesId === seriesId);
  const selectedEpisodeIds = new Set(selectedEpisodes.map(({ id }) => id));
  if (selectedEpisodeIds.size !== selectedEpisodes.length) return ambiguous('duplicate-episode-id');
  for (const record of allEpisodes) {
    if (record.seriesId !== seriesId && selectedEpisodeIds.has(record.id)) {
      return ambiguous('duplicate-episode-id');
    }
    if (record.episodeFileId === targetFile.id && record.seriesId !== seriesId) {
      return invalid('episode-series-mismatch');
    }
  }

  for (const record of selectedEpisodes) {
    if (record.episodeFileId === null || record.episodeFileId === 0) continue;
    const linkedFiles = allFiles.filter(({ id }) => id === record.episodeFileId);
    if (linkedFiles.length === 0) return invalid('episode-file-missing');
    if (linkedFiles.length > 1) return ambiguous('duplicate-episode-file-id');
    if (linkedFiles[0].seriesId !== seriesId) return invalid('episode-file-series-mismatch');
    if (record.embeddedEpisodeFile !== null && record.embeddedEpisodeFile.path !== linkedFiles[0].path) {
      return invalid('episode-file-conflict');
    }
  }

  const linkedEpisodes = selectedEpisodes
    .filter((record) => record.episodeFileId === targetFile.id)
    .sort((left, right) => left.id - right.id);
  if (linkedEpisodes.length === 0) return { status: 'unmapped', reason: 'no-linked-episodes' };

  return {
    status: 'mapped',
    binding: {
      instanceKey,
      seriesId,
      episodeFileId: targetFile.id,
      episodeIds: linkedEpisodes.map(({ id }) => id),
    },
    file: {
      path: targetFile.path,
      relativePath: targetFile.relativePath,
      seasonNumber: targetFile.seasonNumber,
      sceneName: targetFile.sceneName,
    },
    episodes: linkedEpisodes.map(({ metadata }) => ({ ...metadata })),
  };
}
