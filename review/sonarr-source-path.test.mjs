import test from 'node:test';
import assert from 'node:assert/strict';
import {mapSonarrSourcePath} from './sonarr-source-path.mjs';

test('maps only exact component prefixes for POSIX, drive and UNC namespaces',()=>{
 assert.deepEqual(mapSonarrSourcePath({sonarrRoot:'/mnt/tv/Shows',filePath:'/mnt/tv/Shows/Example/Season 01/E01.mkv'}),{status:'mapped',relative:'Example/Season 01/E01.mkv'});
 assert.deepEqual(mapSonarrSourcePath({sonarrRoot:'Z:\\TV\\Shows',filePath:'Z:\\TV\\Shows\\Example\\S01E01.mkv'}),{status:'mapped',relative:'Example/S01E01.mkv'});
 assert.deepEqual(mapSonarrSourcePath({sonarrRoot:'\\\\nas\\media\\tv',filePath:'\\\\nas\\media\\tv\\Example\\S01E01.mkv'}),{status:'mapped',relative:'Example/S01E01.mkv'});
 assert.deepEqual(mapSonarrSourcePath({sonarrRoot:'\\\\nas\\media',filePath:'\\\\nas\\media\\Example\\S01E01.mkv'}),{status:'mapped',relative:'Example/S01E01.mkv'});
});

test('rejects prefix collisions, case or drive equivalence, traversal and namespace changes',()=>{
 const root='/mnt/tv/Shows';
 for(const filePath of ['/mnt/tv/Shows-old/E01.mkv','/mnt/tv/shows/E01.mkv','/mnt/tv/Shows/../Movies/E01.mkv','Z:\\mnt\\tv\\Shows\\E01.mkv','//nas/tv/Shows/E01.mkv','/mnt/tv/Shows//E01.mkv','/mnt/tv/Shows/E01.mkv/']){
  assert.deepEqual(mapSonarrSourcePath({sonarrRoot:root,filePath}),{status:'unmapped',reason:'path_unmapped'},filePath);
 }
 assert.deepEqual(mapSonarrSourcePath({sonarrRoot:'z:\\TV',filePath:'Z:\\TV\\Show\\E01.mkv'}),{status:'unmapped',reason:'path_unmapped'});
 assert.deepEqual(mapSonarrSourcePath({sonarrRoot:'\\\\nas\\media\\TV',filePath:'\\\\NAS\\media\\TV\\Show\\E01.mkv'}),{status:'unmapped',reason:'path_unmapped'});
});

test('rejects malformed inputs without leaking absolute roots',()=>{
 for(const input of [null,{}, {sonarrRoot:'',filePath:'/a/b'}, {sonarrRoot:'/a',filePath:'/a'}, {sonarrRoot:'/a',filePath:'/a\0/b'}]){
  assert.deepEqual(mapSonarrSourcePath(input),{status:'unmapped',reason:'path_unmapped'});
 }
 const result=mapSonarrSourcePath({sonarrRoot:'C:\\Private\\TV',filePath:'C:\\Private\\TV\\Show\\e.mkv'});
 assert.equal(JSON.stringify(result).includes('Private'),false);
});
