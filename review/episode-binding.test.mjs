import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEpisodeBinding } from './episode-binding.mjs';

function snapshot(overrides = {}) {
  return {
    instanceKey: 'sonarr-home',
    seriesId: 12,
    filePath: '/media/Shows/Example/Season 01/Example.mkv',
    episodeFiles: [
      {
        id: 31,
        seriesId: 12,
        path: '/media/Shows/Example/Season 01/Example.mkv',
        relativePath: 'Example/Season 01/Example.mkv',
        seasonNumber: 1,
        sceneName: 'Example.S01E01-E02',
      },
    ],
    episodes: [
      {
        id: 102,
        seriesId: 12,
        episodeFileId: 31,
        seasonNumber: 1,
        episodeNumber: 2,
        absoluteEpisodeNumber: null,
        sceneSeasonNumber: 1,
        sceneEpisodeNumber: 2,
        airDate: '2024-01-08',
        airDateUtc: '2024-01-08T00:00:00Z',
      },
      {
        id: 101,
        seriesId: 12,
        episodeFileId: 31,
        seasonNumber: 1,
        episodeNumber: 1,
        absoluteEpisodeNumber: null,
        sceneSeasonNumber: 1,
        sceneEpisodeNumber: 1,
        airDate: '2024-01-01',
        airDateUtc: '2024-01-01T00:00:00Z',
      },
    ],
    ...overrides,
  };
}

test('maps one exact file to every linked episode in stable numeric ID order', () => {
  const result = resolveEpisodeBinding(snapshot());

  assert.equal(result.status, 'mapped');
  assert.deepEqual(result.binding, {
    instanceKey: 'sonarr-home',
    seriesId: 12,
    episodeFileId: 31,
    episodeIds: [101, 102],
  });
  assert.equal(result.file.path, '/media/Shows/Example/Season 01/Example.mkv');
  assert.equal(result.file.seasonNumber, 1);
  assert.deepEqual(result.episodes.map(({ id }) => id), [101, 102]);
});

test('preserves season zero, daily dates, and anime absolute and scene numbering as separate metadata', () => {
  const result = resolveEpisodeBinding(snapshot({
    episodeFiles: [{ id: 31, seriesId: 12, path: '/media/Shows/Example/Season 01/Example.mkv', seasonNumber: 0 }],
    episodes: [{
      id: 101,
      seriesId: 12,
      episodeFileId: 31,
      seasonNumber: 0,
      episodeNumber: 7,
      absoluteEpisodeNumber: 107,
      sceneAbsoluteEpisodeNumber: 1007,
      sceneSeasonNumber: 2,
      sceneEpisodeNumber: 3,
      unverifiedSceneNumbering: true,
      airDate: '2024-02-01',
      airDateUtc: null,
    }],
  }));

  assert.equal(result.status, 'mapped');
  assert.deepEqual(result.episodes[0], {
    id: 101,
    seasonNumber: 0,
    episodeNumber: 7,
    absoluteEpisodeNumber: 107,
    sceneAbsoluteEpisodeNumber: 1007,
    sceneSeasonNumber: 2,
    sceneEpisodeNumber: 3,
    unverifiedSceneNumbering: true,
    airDate: '2024-02-01',
    airDateUtc: null,
  });
});

test('keeps identical file paths scoped to the explicit instance and selected series', () => {
  const input = snapshot({
    episodeFiles: [
      ...snapshot().episodeFiles,
      { id: 99, seriesId: 999, path: '/archive/Example/Season 01/Example.mkv', relativePath: 'Example/Season 01/Example.mkv', seasonNumber: 1 },
    ],
    episodes: [
      ...snapshot().episodes,
      { id: 901, seriesId: 999, episodeFileId: 99, seasonNumber: 1, episodeNumber: 1 },
    ],
  });
  input.instanceKey = 'sonarr-secondary';

  const result = resolveEpisodeBinding(input);

  assert.equal(result.status, 'mapped');
  assert.equal(result.binding.instanceKey, 'sonarr-secondary');
  assert.equal(result.binding.seriesId, 12);
  assert.equal(result.binding.episodeFileId, 31);
  assert.deepEqual(result.binding.episodeIds, [101, 102]);
});

test('returns unmapped when the exact path has no selected-series file', () => {
  const result = resolveEpisodeBinding(snapshot({ filePath: '/media/Shows/Example/renamed.mkv' }));

  assert.deepEqual(result, { status: 'unmapped', reason: 'file-not-found' });
});

test('returns ambiguous for duplicate selected-series files at the exact path', () => {
  const input = snapshot({
    episodeFiles: [
      ...snapshot().episodeFiles,
      { id: 32, seriesId: 12, path: '/media/Shows/Example/Season 01/Example.mkv', seasonNumber: 1 },
    ],
  });

  assert.deepEqual(resolveEpisodeBinding(input), { status: 'ambiguous', reason: 'duplicate-file-path' });
});

test('fails closed when a selected-series episode points to a missing or duplicate file record', () => {
  const missing = snapshot({ episodes: [{ id: 101, seriesId: 12, episodeFileId: 88, seasonNumber: 1, episodeNumber: 1 }] });
  const duplicate = snapshot({
    episodeFiles: [
      ...snapshot().episodeFiles,
      { id: 31, seriesId: 12, path: '/media/elsewhere.mkv', seasonNumber: 1 },
    ],
  });

  assert.deepEqual(resolveEpisodeBinding(missing), { status: 'invalid', reason: 'episode-file-missing' });
  assert.deepEqual(resolveEpisodeBinding(duplicate), { status: 'ambiguous', reason: 'duplicate-episode-file-id' });
});

test('rejects a foreign-series file at the requested path and a foreign episode linked to the selected file', () => {
  const foreignFile = snapshot({
    episodeFiles: [{ id: 99, seriesId: 999, path: '/media/Shows/Example/Season 01/Example.mkv', seasonNumber: 1 }],
    episodes: [],
  });
  const foreignLink = snapshot({
    episodes: [
      ...snapshot().episodes,
      { id: 901, seriesId: 999, episodeFileId: 31, seasonNumber: 1, episodeNumber: 1 },
    ],
  });

  assert.deepEqual(resolveEpisodeBinding(foreignFile), { status: 'invalid', reason: 'file-series-mismatch' });
  assert.deepEqual(resolveEpisodeBinding(foreignLink), { status: 'invalid', reason: 'episode-series-mismatch' });
});

test('fails closed when hasFile contradicts episodeFileId', () => {
  const fileIdWithoutFile = snapshot({
    episodes: [{ ...snapshot().episodes[0], hasFile: false }],
  });
  const fileWithoutFileId = snapshot({
    episodes: [{ id: 103, seriesId: 12, episodeFileId: 0, hasFile: true, seasonNumber: 1, episodeNumber: 3 }],
  });
  const malformedHasFile = snapshot({
    episodes: [{ ...snapshot().episodes[0], hasFile: 'true' }],
  });

  assert.deepEqual(resolveEpisodeBinding(fileIdWithoutFile), { status: 'invalid', reason: 'episode-file-conflict' });
  assert.deepEqual(resolveEpisodeBinding(fileWithoutFileId), { status: 'invalid', reason: 'episode-file-conflict' });
  assert.deepEqual(resolveEpisodeBinding(malformedHasFile), { status: 'invalid', reason: 'episode-file-conflict' });
});

test('rejects an embedded EpisodeFile ID that conflicts with episodeFileId', () => {
  const episode = {
    ...snapshot().episodes[0],
    episodeFile: { id: 32, seriesId: 12, path: '/media/Shows/Example/Season 01/Example.mkv' },
  };

  assert.deepEqual(resolveEpisodeBinding(snapshot({ episodes: [episode] })), {
    status: 'invalid', reason: 'episode-file-conflict',
  });
});

test('rejects an embedded EpisodeFile series that conflicts with its episode series', () => {
  const episode = {
    ...snapshot().episodes[0],
    episodeFile: { id: 31, seriesId: 99, path: '/media/Shows/Example/Season 01/Example.mkv' },
  };

  assert.deepEqual(resolveEpisodeBinding(snapshot({ episodes: [episode] })), {
    status: 'invalid', reason: 'episode-file-conflict',
  });
});

test('rejects an embedded EpisodeFile path that conflicts with the primary file record', () => {
  const episode = {
    ...snapshot().episodes[0],
    episodeFile: { id: 31, seriesId: 12, path: '/media/other.mkv' },
  };

  assert.deepEqual(resolveEpisodeBinding(snapshot({ episodes: [episode] })), {
    status: 'invalid', reason: 'episode-file-conflict',
  });
});

test('rejects an embedded EpisodeFile when episodeFileId is zero or null', () => {
  const episodes = [0, null].map((episodeFileId) => ({
    id: 103,
    seriesId: 12,
    episodeFileId,
    episodeFile: { id: 31, seriesId: 12, path: '/media/Shows/Example/Season 01/Example.mkv' },
    seasonNumber: 1,
    episodeNumber: 3,
  }));

  for (const episode of episodes) {
    assert.deepEqual(resolveEpisodeBinding(snapshot({ episodes: [episode] })), {
      status: 'invalid', reason: 'episode-file-conflict',
    });
  }
});

test('rejects an embedded EpisodeFile without positive ID, series ID, or path fields', () => {
  const path = '/media/Shows/Example/Season 01/Example.mkv';
  for (const episodeFile of [
    { seriesId: 12, path },
    { id: 31, path },
    { id: 31, seriesId: 12, path: '' },
    [],
  ]) {
    const episode = { ...snapshot().episodes[0], episodeFile };
    assert.deepEqual(resolveEpisodeBinding(snapshot({ episodes: [episode] })), {
      status: 'invalid', reason: 'episode-file-conflict',
    });
  }
});

test('accepts an aligned embedded EpisodeFile and optional null embed', () => {
  const aligned = {
    ...snapshot().episodes[0],
    hasFile: true,
    episodeFile: { id: 31, seriesId: 12, path: '/media/Shows/Example/Season 01/Example.mkv', privateToken: 'ignore' },
  };
  const noEmbed = { ...snapshot().episodes[0], hasFile: true, episodeFile: null };

  assert.equal(resolveEpisodeBinding(snapshot({ episodes: [aligned] })).status, 'mapped');
  assert.equal(resolveEpisodeBinding(snapshot({ episodes: [noEmbed] })).status, 'mapped');
});

test('rejects a reused foreign file ID or episode ID that conflicts with the selected series', () => {
  const repeatedFileId = snapshot({
    episodeFiles: [
      ...snapshot().episodeFiles,
      { id: 31, seriesId: 999, path: '/archive/elsewhere.mkv', seasonNumber: 1 },
    ],
  });
  const repeatedEpisodeId = snapshot({
    episodes: [
      ...snapshot().episodes,
      { id: 101, seriesId: 999, episodeFileId: 31, seasonNumber: 1, episodeNumber: 9 },
    ],
  });

  assert.deepEqual(resolveEpisodeBinding(repeatedFileId), { status: 'ambiguous', reason: 'duplicate-episode-file-id' });
  assert.deepEqual(resolveEpisodeBinding(repeatedEpisodeId), { status: 'ambiguous', reason: 'duplicate-episode-id' });
});

test('compares a Windows canonical path literally without translating separators or case', () => {
  const windowsPath = 'T:\\Media\\Shows\\Example\\Season 01\\Example.mkv';
  const input = snapshot({
    filePath: windowsPath,
    episodeFiles: [{ ...snapshot().episodeFiles[0], path: windowsPath }],
  });

  const exact = resolveEpisodeBinding(input);
  const changedCase = resolveEpisodeBinding({ ...input, filePath: windowsPath.toLowerCase() });

  assert.equal(exact.status, 'mapped');
  assert.equal(exact.file.path, windowsPath);
  assert.deepEqual(changedCase, { status: 'unmapped', reason: 'file-not-found' });
});

test('fails closed for duplicate episode IDs and malformed numeric IDs', () => {
  const duplicate = snapshot({ episodes: [...snapshot().episodes, { ...snapshot().episodes[0] }] });
  const malformed = snapshot({ episodes: [{ ...snapshot().episodes[0], id: '102' }] });

  assert.deepEqual(resolveEpisodeBinding(duplicate), { status: 'ambiguous', reason: 'duplicate-episode-id' });
  assert.deepEqual(resolveEpisodeBinding(malformed), { status: 'invalid', reason: 'invalid-episode' });
});

test('returns invalid for malformed input and numbering without coercion', () => {
  const malformedNumber = snapshot({ episodes: [{ ...snapshot().episodes[0], episodeNumber: '2' }] });
  const malformedSceneMetadata = snapshot({ episodes: [{ ...snapshot().episodes[0], unverifiedSceneNumbering: 'false' }] });

  assert.deepEqual(resolveEpisodeBinding(null), { status: 'invalid', reason: 'invalid-input' });
  assert.deepEqual(resolveEpisodeBinding(malformedNumber), { status: 'invalid', reason: 'invalid-episode' });
  assert.deepEqual(resolveEpisodeBinding(malformedSceneMetadata), { status: 'invalid', reason: 'invalid-episode' });
});

test('excludes future episodes with Sonarr episodeFileId zero from the exact file binding', () => {
  const input = snapshot({
    episodes: [
      ...snapshot().episodes,
      { id: 103, seriesId: 12, episodeFileId: 0, hasFile: false, seasonNumber: 1, episodeNumber: 3 },
      { id: 104, seriesId: 12, episodeFileId: null, hasFile: false, seasonNumber: 1, episodeNumber: 4 },
    ],
  });

  const result = resolveEpisodeBinding(input);

  assert.equal(result.status, 'mapped');
  assert.deepEqual(result.binding.episodeIds, [101, 102]);
});

test('does not retain or mutate caller records through returned metadata', () => {
  const input = snapshot({
    episodeFiles: [{ ...snapshot().episodeFiles[0], privateToken: 'file-secret' }],
    episodes: snapshot().episodes.map((episode) => ({ ...episode, privateToken: 'episode-secret' })),
  });
  const result = resolveEpisodeBinding(input);

  assert.equal(input.episodes[0].episodeNumber, 2);
  input.episodes[0].episodeNumber = 99;
  input.episodeFiles[0].sceneName = 'changed later';
  assert.equal(result.episodes[0].episodeNumber, 1);
  assert.equal(result.file.sceneName, 'Example.S01E01-E02');
  assert.deepEqual(Object.keys(result.file).sort(), ['path', 'relativePath', 'sceneName', 'seasonNumber']);
  assert.deepEqual(Object.keys(result.episodes[0]).sort(), [
    'absoluteEpisodeNumber', 'airDate', 'airDateUtc', 'episodeNumber', 'id', 'sceneAbsoluteEpisodeNumber',
    'sceneEpisodeNumber', 'sceneSeasonNumber', 'seasonNumber', 'unverifiedSceneNumbering',
  ]);
  result.episodes[0].episodeNumber = 77;
  assert.equal(input.episodes[1].episodeNumber, 1);
});

test('requires exact path agreement and at least one linked episode', () => {
  const disagreement = snapshot({
    episodeFiles: [{ ...snapshot().episodeFiles[0], path: '/media/other.mkv' }],
  });
  const noEpisodes = snapshot({ episodes: [] });

  assert.deepEqual(resolveEpisodeBinding(disagreement), { status: 'unmapped', reason: 'file-not-found' });
  assert.deepEqual(resolveEpisodeBinding(noEpisodes), { status: 'unmapped', reason: 'no-linked-episodes' });
});
