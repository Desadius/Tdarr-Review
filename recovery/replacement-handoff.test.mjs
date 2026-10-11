import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureHandoff} from './replacement-handoff.mjs';

const file = '/media/movies/Fixture (2026)/replacement.mkv';
const libraryId = 'replacement-library';
const row = state => ({_id: file, DB: libraryId, TranscodeDecisionMaker: state});

test('a newer confirmed-source Hold is preserved and missing protected entries are never rescanned',async()=>{
 for(const current of [row('Hold'),null]){
  const calls=[],args={file,libraryId,preserveHold:true,tdarr:async(route,body)=>{calls.push({route,body});return current;}};
  if(current)assert.equal(await ensureHandoff(args),'Hold');else await assert.rejects(ensureHandoff(args),{code:'TDARR_HANDOFF_PENDING'});
  assert.equal(calls.length,1);assert.equal(calls[0].route,'/api/v2/cruddb');
 }
});

test('existing queued, active and terminal replacements are observed without scan or requeue', async () => {
  for (const state of ['Queued', 'Transcoding', 'Transcode success', 'Transcode error', 'Not required']) {
    const calls = [];
    const status = await ensureHandoff({file, libraryId, tdarr: async (route, body) => {
      calls.push({route, body});
      return row(state);
    }});
    assert.equal(status, state);
    assert.deepEqual(calls, [{route: '/api/v2/cruddb', body: {
      collection: 'FileJSONDB', mode: 'getById', docID: file,
    }}]);
  }
});

test('plain OK scan and queue responses require exact database acknowledgement', async () => {
  let current = null;
  const calls = [];
  const status = await ensureHandoff({file, libraryId, tdarr: async (route, body) => {
    calls.push({route, body});
    if (route === '/api/v2/cruddb') return current;
    if (route === '/api/v2/rescan-file') {current = row('Hold'); return 'OK';}
    current = row('Queued');
    return 'OK';
  }});
  assert.equal(status, 'Queued');
  assert.deepEqual(calls.filter(c => c.route !== '/api/v2/cruddb'), [
    {route: '/api/v2/rescan-file', body: {_id: file, DB: libraryId}},
    {route: '/api/v2/bulk-update-files', body: {
      fileIds: [file], updatedObj: {TranscodeDecisionMaker: 'Queued', holdUntil: 0},
    }},
  ]);
});

test('missing database row after an accepted scan stays pending and never writes queue state', async () => {
  const calls = [];
  const tdarr = async route => {
    calls.push(route);
    return route === '/api/v2/cruddb' ? '' : 'OK';
  };
  await assert.rejects(ensureHandoff({file, libraryId, tdarr}), {
    code: 'TDARR_HANDOFF_PENDING', message: /scan pending/,
  });
  assert.deepEqual(calls, ['/api/v2/cruddb', '/api/v2/rescan-file', '/api/v2/cruddb']);
});

test('scan timeout after server acceptance is reconciled without a second scan', async () => {
  let current = null, scans = 0, updates = 0;
  const tdarr = async route => {
    if (route === '/api/v2/cruddb') return current;
    if (route === '/api/v2/rescan-file') {
      scans++;
      current = row('Hold');
      throw Error('transport timeout');
    }
    updates++;
    current = row('Queued');
    return 'OK';
  };
  await assert.rejects(ensureHandoff({file, libraryId, tdarr}), /transport timeout/);
  assert.equal(await ensureHandoff({file, libraryId, tdarr}), 'Queued');
  assert.equal(scans, 1);
  assert.equal(updates, 1);
});

test('queue timeout after server acceptance never queues a replacement twice', async () => {
  let current = row('Hold'), updates = 0;
  const tdarr = async route => {
    if (route === '/api/v2/cruddb') return current;
    assert.equal(route, '/api/v2/bulk-update-files');
    updates++;
    current = row('Transcoding');
    throw Error('transport timeout');
  };
  await assert.rejects(ensureHandoff({file, libraryId, tdarr}), /transport timeout/);
  assert.equal(await ensureHandoff({file, libraryId, tdarr}), 'Transcoding');
  assert.equal(updates, 1);
});

test('queue OK without an acknowledged state is pending rather than a successful handoff', async () => {
  await assert.rejects(ensureHandoff({file, libraryId, tdarr: async route =>
    route === '/api/v2/cruddb' ? row('Hold') : 'OK'}), {
    code: 'TDARR_HANDOFF_PENDING', message: /acknowledgement pending/,
  });
});

test('wrong path, wrong library and malformed database replies reject before mutation', async () => {
  for (const current of [
    {...row('Hold'), _id: '/media/movies/unrelated.mkv'},
    {...row('Hold'), DB: 'different-library'},
    'OK', [], undefined,
  ]) {
    let writes = 0;
    await assert.rejects(ensureHandoff({file, libraryId, tdarr: async route => {
      if (route !== '/api/v2/cruddb') writes++;
      return current;
    }}), {code: 'TDARR_HANDOFF_BINDING'});
    assert.equal(writes, 0);
  }
});

test('a scan result bound to another library never reaches queue mutation', async () => {
  let reads = 0, writes = 0;
  await assert.rejects(ensureHandoff({file, libraryId, tdarr: async route => {
    if (route === '/api/v2/cruddb') return reads++ ? {...row('Hold'), DB: 'other'} : null;
    if (route === '/api/v2/bulk-update-files') writes++;
    return 'OK';
  }}), {code: 'TDARR_HANDOFF_BINDING'});
  assert.equal(writes, 0);
});

test('unknown state requires inspection and cannot be silently reset', async () => {
  let writes = 0;
  await assert.rejects(ensureHandoff({file, libraryId, tdarr: async route => {
    if (route !== '/api/v2/cruddb') writes++;
    return row('unexpected-state');
  }}), {code: 'TDARR_HANDOFF_STATE'});
  assert.equal(writes, 0);
});

test('invalid targets fail before contacting Tdarr', async () => {
  for (const target of [
    {file: '', libraryId}, {file: 'relative.mkv', libraryId},
    {file: '/media/../other.mkv', libraryId}, {file: '/media/bad\0.mkv', libraryId},
    {file, libraryId: ''}, {file, libraryId: '  '},
  ]) {
    let calls = 0;
    await assert.rejects(ensureHandoff({...target, tdarr: async () => {calls++;}}), {
      code: 'TDARR_HANDOFF_BINDING',
    });
    assert.equal(calls, 0);
  }
});
