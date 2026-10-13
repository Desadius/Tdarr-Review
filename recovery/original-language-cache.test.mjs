import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {refreshOriginalLanguages} from './original-language-cache.mjs';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'tdarr-languages-'));
try{
 const cfg={mediaRoot:root,radarrRoot:'/media'},target=path.join(root,'.tdarr-original-languages.json');
 const atomic=async(file,value)=>fs.writeFile(file,JSON.stringify(value));
 const read=async()=>JSON.parse(await fs.readFile(target,'utf8'));
 let movies=[],calls=0;const rad=async route=>{assert.equal(route,'/movie');calls++;return movies};
 const movie=(id,file,size=1000,language='English')=>({id,tmdbId:id*10,originalLanguage:language&&{name:language},movieFile:file===undefined?undefined:{path:file,size}});
 movies=[
  movie(1,'/media/Film (2020)/Film.mkv'),
  movie(2,'/media/Other (2021)/Other.mkv',2000,null),
  movie(3,'/media/Same/Same.mkv'),movie(4,'/media/Same/Same.mkv'),
  movie(5,'/media2/Lookalike/Lookalike.mkv'),movie(6,'/other/Outside.mkv'),
  movie(7,'/media/../etc/Escape.mkv'),movie(8,'/media/./Dot.mkv'),movie(9,'/media/Empty//Segment.mkv'),
  movie(10,'/media/Zero/Zero.mkv',0),movie(11,'/media/Fraction/Fraction.mkv',1.5),movie(12,'/media/Text/Text.mkv','1000'),
  movie(13,undefined),
 ];
 await refreshOriginalLanguages({cfg,rad,atomic});
 const out=await read();
 assert.equal(out.version,1);assert.equal(calls,1);
 assert.deepEqual(out.entries,{
  'Film (2020)/Film.mkv':{tmdbId:10,movieId:1,bytes:1000,originalLanguage:'English'},
  'Other (2021)/Other.mkv':{tmdbId:20,movieId:2,bytes:2000,originalLanguage:null},
  'Same/Same.mkv':{ambiguous:true},
 },'only safe paths below the Radarr root are kept and duplicates are never attributed to one movie');
 if(process.platform!=='win32')assert.equal((await fs.stat(target)).mode&0o777,0o644);

 // A fresh cache is reused without asking Radarr again.
 movies=[movie(1,'/media/New/New.mkv')];
 await refreshOriginalLanguages({cfg,rad,atomic});
 assert.equal(calls,1);assert.ok((await read()).entries['Film (2020)/Film.mkv']);

 // A stale or corrupt cache is regenerated.
 await fs.writeFile(target,JSON.stringify({...out,generatedAt:new Date(Date.now()-11*60000).toISOString()}));
 await refreshOriginalLanguages({cfg,rad,atomic});
 assert.equal(calls,2);assert.deepEqual(Object.keys((await read()).entries),['New/New.mkv']);
 await fs.writeFile(target,'{not json');
 await refreshOriginalLanguages({cfg,rad,atomic});
 assert.equal(calls,3);assert.deepEqual(Object.keys((await read()).entries),['New/New.mkv']);

 // An invalid Radarr response fails without replacing the existing cache.
 await fs.writeFile(target,JSON.stringify({...out,generatedAt:new Date(0).toISOString()}));
 movies={error:'unexpected'};
 await assert.rejects(refreshOriginalLanguages({cfg,rad,atomic}),/Invalid Radarr language response/);
 assert.ok((await read()).entries['Film (2020)/Film.mkv']);
}finally{await fs.rm(root,{recursive:true,force:true})}
