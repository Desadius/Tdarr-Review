const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isPositiveId = (value) => Number.isSafeInteger(value) && value > 0;
const isNumbering = (value) => value === null || (Number.isSafeInteger(value) && value >= 0);
const isOptionalString = (value) => value === null || typeof value === 'string';
const isOptionalBoolean = (value) => value === null || typeof value === 'boolean';
const invalid = (reason) => ({ status: 'invalid', reason });
const ambiguous = (reason) => ({ status: 'ambiguous', reason });
const copyIssue = (issue) => ({ status: issue.status, reason: issue.reason });

function buildEpisodeBindingResolver(input = {}) {
  if (!isRecord(input)) return { resolve: () => invalid('invalid-input'), integrity: () => invalid('invalid-input') };
  const { instanceKey, seriesId, episodeFiles, episodes } = input;
  if (typeof instanceKey !== 'string' || instanceKey.trim() === ''
      || !isPositiveId(seriesId) || !Array.isArray(episodeFiles) || !Array.isArray(episodes)) {
    return { resolve: () => invalid('invalid-input'), integrity: () => invalid('invalid-input') };
  }

  const allFiles = [], filesByPath = new Map(), filesById = new Map();
  let fileIssue = null;
  for (const record of episodeFiles) {
    if (!isRecord(record) || !isPositiveId(record.id) || !isPositiveId(record.seriesId)
        || typeof record.path !== 'string' || record.path.length === 0) {
      fileIssue ??= invalid('invalid-episode-file');
      continue;
    }
    const season = record.seasonNumber ?? null;
    const relativePath = record.relativePath ?? null;
    const sceneName = record.sceneName ?? null;
    if (!isNumbering(season) || !isOptionalString(relativePath) || !isOptionalString(sceneName)) {
      fileIssue ??= invalid('invalid-episode-file');
      continue;
    }
    const normalized = { id: record.id, seriesId: record.seriesId, path: record.path,
      relativePath, seasonNumber: season, sceneName };
    allFiles.push(normalized);
    const pathMatches = filesByPath.get(record.path) || [];
    pathMatches.push(normalized); filesByPath.set(record.path, pathMatches);
    const idMatches = filesById.get(record.id) || [];
    idMatches.push(normalized); filesById.set(record.id, idMatches);
  }
  const selectedFiles = allFiles.filter((record) => record.seriesId === seriesId);
  const selectedFilesByPath = new Map();
  for (const file of selectedFiles) {
    const matches = selectedFilesByPath.get(file.path) || [];
    matches.push(file); selectedFilesByPath.set(file.path, matches);
  }
  const selectedFileIds = new Set(selectedFiles.map(({ id }) => id));
  const duplicateSelectedFileIds = selectedFileIds.size !== selectedFiles.length;
  const foreignFileIdConflict = !duplicateSelectedFileIds && allFiles.some((record) => record.seriesId !== seriesId && selectedFileIds.has(record.id));

  const allEpisodes = [], episodesByFileId = new Map(), episodeIds = new Map();
  let episodeIssue = null;
  for (const record of episodes) {
    if (!isRecord(record) || !isPositiveId(record.id) || !isPositiveId(record.seriesId)) {
      episodeIssue ??= invalid('invalid-episode');
      continue;
    }
    const linkedFileId = record.episodeFileId;
    if (linkedFileId !== null && linkedFileId !== 0 && !isPositiveId(linkedFileId)) {
      episodeIssue ??= invalid('invalid-episode');
      continue;
    }
    if (Object.hasOwn(record, 'hasFile')
        && (typeof record.hasFile !== 'boolean' || record.hasFile !== isPositiveId(linkedFileId))) {
      episodeIssue ??= invalid('episode-file-conflict');
      continue;
    }
    let embeddedEpisodeFile = null;
    if (Object.hasOwn(record, 'episodeFile') && record.episodeFile !== null) {
      const embedded = record.episodeFile;
      if (!isRecord(embedded) || !isPositiveId(embedded.id) || !isPositiveId(embedded.seriesId)
          || typeof embedded.path !== 'string' || embedded.path.length === 0
          || !isPositiveId(linkedFileId) || embedded.id !== linkedFileId || embedded.seriesId !== record.seriesId) {
        episodeIssue ??= invalid('episode-file-conflict');
        continue;
      }
      embeddedEpisodeFile = { id: embedded.id, seriesId: embedded.seriesId, path: embedded.path };
    }
    const coordinates = {};
    let valid = true;
    for (const key of ['seasonNumber', 'episodeNumber', 'absoluteEpisodeNumber', 'sceneAbsoluteEpisodeNumber', 'sceneSeasonNumber', 'sceneEpisodeNumber']) {
      const value = record[key] ?? null;
      if (!isNumbering(value)) valid = false;
      coordinates[key] = value;
    }
    const airDate = record.airDate ?? null, airDateUtc = record.airDateUtc ?? null;
    const unverifiedSceneNumbering = record.unverifiedSceneNumbering ?? null;
    if (!valid || !isOptionalString(airDate) || !isOptionalString(airDateUtc) || !isOptionalBoolean(unverifiedSceneNumbering)) {
      episodeIssue ??= invalid('invalid-episode');
      continue;
    }
    const normalized = { id: record.id, seriesId: record.seriesId, episodeFileId: linkedFileId,
      embeddedEpisodeFile, metadata: { id: record.id, ...coordinates, unverifiedSceneNumbering, airDate, airDateUtc } };
    allEpisodes.push(normalized);
    const idMatches = episodeIds.get(record.id) || [];
    idMatches.push(normalized); episodeIds.set(record.id, idMatches);
    if (isPositiveId(linkedFileId)) {
      const fileMatches = episodesByFileId.get(linkedFileId) || [];
      fileMatches.push(normalized); episodesByFileId.set(linkedFileId, fileMatches);
    }
  }
  const selectedEpisodes = allEpisodes.filter((record) => record.seriesId === seriesId);
  const selectedEpisodeIds = new Set(selectedEpisodes.map(({ id }) => id));
  const duplicateSelectedEpisodeIds = selectedEpisodeIds.size !== selectedEpisodes.length;
  const foreignEpisodeIdConflict = !duplicateSelectedEpisodeIds && allEpisodes.some((record) => record.seriesId !== seriesId && selectedEpisodeIds.has(record.id));
  const targetEpisodeSeriesConflict = allEpisodes.some((record) => record.episodeFileId !== null
    && selectedFileIds.has(record.episodeFileId) && record.seriesId !== seriesId);

  let linkIssue = null;
  if (!episodeIssue && !duplicateSelectedEpisodeIds && !foreignEpisodeIdConflict && !targetEpisodeSeriesConflict) {
    for (const record of selectedEpisodes) {
      if (record.episodeFileId === null || record.episodeFileId === 0) continue;
      const linkedFiles = filesById.get(record.episodeFileId) || [];
      if (linkedFiles.length === 0) { linkIssue = invalid('episode-file-missing'); break; }
      if (linkedFiles.length > 1) { linkIssue = ambiguous('duplicate-episode-file-id'); break; }
      if (linkedFiles[0].seriesId !== seriesId) { linkIssue = invalid('episode-file-series-mismatch'); break; }
      if (record.embeddedEpisodeFile !== null && record.embeddedEpisodeFile.path !== linkedFiles[0].path) {
        linkIssue = invalid('episode-file-conflict'); break;
      }
    }
  }

  return {
    integrity() {
      if (fileIssue) return copyIssue(fileIssue);
      if (duplicateSelectedFileIds || foreignFileIdConflict) return ambiguous('duplicate-episode-file-id');
      if ([...selectedFilesByPath.values()].some((matches) => matches.length > 1)) return ambiguous('duplicate-file-path');
      if (episodeIssue) return copyIssue(episodeIssue);
      if (duplicateSelectedEpisodeIds || foreignEpisodeIdConflict) return ambiguous('duplicate-episode-id');
      if (targetEpisodeSeriesConflict) return invalid('episode-series-mismatch');
      if (linkIssue) return copyIssue(linkIssue);
      return { status: 'valid', reason: null };
    },
    resolve(filePath) {
      if (typeof filePath !== 'string' || filePath.length === 0) return invalid('invalid-input');
      if (fileIssue) return copyIssue(fileIssue);
      const pathMatches = filesByPath.get(filePath) || [];
      if (pathMatches.length > 1) return ambiguous('duplicate-file-path');
      if (pathMatches.length === 1 && pathMatches[0].seriesId !== seriesId) return invalid('file-series-mismatch');
      const targetFiles = selectedFilesByPath.get(filePath) || [];
      if (targetFiles.length === 0) return { status: 'unmapped', reason: 'file-not-found' };
      if (targetFiles.length > 1) return ambiguous('duplicate-file-path');
      if (duplicateSelectedFileIds || foreignFileIdConflict) return ambiguous('duplicate-episode-file-id');
      if (episodeIssue) return copyIssue(episodeIssue);
      if (duplicateSelectedEpisodeIds || foreignEpisodeIdConflict) return ambiguous('duplicate-episode-id');
      if (targetEpisodeSeriesConflict) return invalid('episode-series-mismatch');
      if (linkIssue) return copyIssue(linkIssue);

      const targetFile = targetFiles[0];
      const linkedEpisodes = episodesByFileId.get(targetFile.id)?.filter((record) => record.seriesId === seriesId) || [];
      linkedEpisodes.sort((left, right) => left.id - right.id);
      if (linkedEpisodes.length === 0) return { status: 'unmapped', reason: 'no-linked-episodes' };
      return {
        status: 'mapped',
        binding: { instanceKey, seriesId, episodeFileId: targetFile.id, episodeIds: linkedEpisodes.map(({ id }) => id) },
        file: { path: targetFile.path, relativePath: targetFile.relativePath,
          seasonNumber: targetFile.seasonNumber, sceneName: targetFile.sceneName },
        episodes: linkedEpisodes.map(({ metadata }) => ({ ...metadata })),
      };
    },
  };
}

/** Build one validated index to resolve every file in a complete Sonarr snapshot efficiently. */
export function createEpisodeBindingResolver(input = {}) {
  return buildEpisodeBindingResolver(input);
}

/** Resolve one exact canonical path from Sonarr v3 records; results are descriptive metadata only. */
export function resolveEpisodeBinding(input = {}) {
  if (!isRecord(input)) return invalid('invalid-input');
  return buildEpisodeBindingResolver(input).resolve(input.filePath);
}
