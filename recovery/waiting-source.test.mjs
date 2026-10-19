import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {maintainWaitingSources,eligibleRelease,publishRecoveryStatus} from './waiting-source.mjs';
import {identityOf} from './file-identity.mjs';
import {safeFile} from '../review/core.mjs';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'tdarr-kept-'));
try{
 const cfg={mediaRoot:path.join(root,'movies'),radarrRoot:'/media',quarantineRoot:path.join(root,'quarantine')};await fs.mkdir(path.join(cfg.mediaRoot,'Movie'),{recursive:true});await fs.mkdir(path.join(cfg.quarantineRoot,'case'),{recursive:true});
 const q=path.join(cfg.quarantineRoot,'case','file.mkv'),source=path.join(cfg.mediaRoot,'Movie/file.mkv');await fs.writeFile(q,'retained original bytes');await fs.utimes(q,1000000000,1000000000);
 const c={id:'case',movieId:1,file:'/media/movies/Movie/file.mkv',relative:'Movie/file.mkv',source,quarantine:q,size:(await fs.stat(q)).size,fp:identityOf(await fs.stat(q)),status:'waiting_replacement',binding:{movieFileId:10,sourceTitle:'bad release'}};const state={cases:{case:c}};
 let movie={movieFileId:0,tmdbId:123,titleSlug:'movie-123'},releases=[],downloads=0;
 const profile={items:[{allowed:false,quality:{id:7}},{allowed:true,quality:{id:30}}]};
 const rad=async p=>p.startsWith('/movie/')?movie:p.startsWith('/queue')?{records:[]}:p.startsWith('/qualityprofile')?profile:p.startsWith('/blocklist')?[]:p.startsWith('/release')?releases:undefined;
 // A stateful Tdarr row; with ignoreWrites it keeps its state, as an unacknowledged write would.
 const row={_id:c.file,TranscodeDecisionMaker:'Transcode error'};let ignoreWrites=false;
 const td=async(route,body)=>{if(route==='/api/v2/cruddb')return structuredClone(row);if(route==='/api/v2/bulk-update-files'&&!ignoreWrites)Object.assign(row,body.updatedObj);return 'OK'};
 const deps={cfg,state,rad:async(p,b)=>{if(p==='/release'&&b){downloads++;return {}}return rad(p)},td,phase:async(c,status,message)=>Object.assign(c,{status,message}),save:async()=>{},command:async()=>{if(!(await fs.stat(source).catch(()=>null))){movie={movieFileId:0,qualityProfileId:4,tmdbId:123,titleSlug:'movie-123'};return;}movie={movieFileId:11,movieFile:{path:'/media/Movie/file.mkv',size:c.size,quality:{quality:{id:30,resolution:1080}}},qualityProfileId:4,tmdbId:123,titleSlug:'movie-123'}},idle:async()=>{},safeSource:async()=>{const st=await fs.stat(source);return {fp:identityOf(st),size:st.size}},sample:async p=>fs.readFile(p,'utf8')};
 // An unconfirmed Hold stops before the kept source is linked back into the library (#196).
 ignoreWrites=true;await maintainWaitingSources(deps);assert.equal(c.status,'waiting_replacement');assert.match(c.observationError,/Hold of the kept source was not confirmed/);await assert.rejects(fs.stat(source),{code:'ENOENT'});assert.equal((await fs.stat(q)).nlink,1);ignoreWrites=false;delete c.observationError;
 await maintainWaitingSources(deps);assert.equal(c.status,'waiting_source_kept',c.observationError);assert.equal(row.TranscodeDecisionMaker,'Hold');assert.equal(c.skipCurrentEdition,true);assert.equal(await fs.readFile(source,'utf8'),'retained original bytes');assert.equal((await fs.stat(q)).nlink,2);assert.equal(downloads,0);
 // Recovery keeps the quarantined inode linked into the library. Review must
 // reject that preserved edition, even when a separate regular result exists.
 const reviewRoot=path.join(root,'review');await fs.mkdir(path.join(reviewRoot,'Movie'),{recursive:true});await fs.writeFile(path.join(reviewRoot,c.relative),'synthetic review result');
 assert.equal((await safeFile(reviewRoot,c.relative)).stat.nlink,1);
 assert.equal((await fs.stat(source)).ino,(await fs.stat(q)).ino);
 await assert.rejects(safeFile(cfg.mediaRoot,c.relative),/Soubor není běžný soubor nebo má více pevných odkazů/);
 assert.equal(await fs.readFile(q,'utf8'),'retained original bytes');assert.equal(await fs.readFile(source,'utf8'),'retained original bytes');assert.equal((await fs.stat(q)).nlink,2);
 assert(!eligibleRelease({downloadAllowed:true,title:'bad release',quality:{quality:{id:30}},rejections:[]},profile,new Set(['bad release'])));
 assert(!eligibleRelease({downloadAllowed:true,title:'other',quality:{quality:{id:7}},rejections:[]},profile,new Set()));
 assert(!eligibleRelease({downloadAllowed:true,title:'other',quality:{quality:{id:30}},rejections:['Language not wanted']},profile,new Set()));
 assert(!eligibleRelease({downloadAllowed:true,title:'lower quality',quality:{quality:{id:7,resolution:1080}},rejections:[]},{items:[{allowed:true,quality:{id:7}},{allowed:true,quality:{id:30}}]},new Set(),{id:30,resolution:1080}));
 const good={downloadAllowed:true,title:'new release',guid:'new-guid',indexerId:2,quality:{quality:{id:30,resolution:1080}},rejections:['Existing file on disk meets quality cutoff']};assert(eligibleRelease(good,profile,new Set()));
 c.nextSearchAt=new Date(0).toISOString();await maintainWaitingSources(deps);assert.equal(c.status,'waiting_source_kept');assert.equal(downloads,0);assert.equal((await fs.stat(q)).nlink,2);
 // Tdarr released the Hold and ignores the new write: the kept source stays and nothing is downloaded.
 row.TranscodeDecisionMaker='Queued';row.holdUntil=0;ignoreWrites=true;c.nextSearchAt=new Date(0).toISOString();releases=[good];await maintainWaitingSources(deps);assert.equal(c.status,'waiting_source_kept');assert.match(c.observationError,/source kept in the library/);assert.equal(downloads,0);assert.equal((await fs.stat(q)).nlink,2);ignoreWrites=false;delete c.observationError;
 c.nextSearchAt=new Date(0).toISOString();releases=[good];await maintainWaitingSources(deps);assert.equal(c.status,'waiting_replacement');assert.equal(downloads,1);assert.equal((await fs.stat(q)).nlink,1);assert.equal(await fs.readFile(q,'utf8'),'retained original bytes');await assert.rejects(fs.stat(source));
 await publishRecoveryStatus({cfg,state,atomic:async(p,v)=>fs.writeFile(p,JSON.stringify(v))});const exported=JSON.parse(await fs.readFile(path.join(root,'.tdarr-recovery-status.json')));assert.equal(exported.cases.length,1);assert(!JSON.stringify(exported).includes('apiKey'));
 const newSource=path.join(cfg.mediaRoot,'Movie/new-file.mkv');await fs.writeFile(newSource,'a different replacement');
 assert.equal((await safeFile(cfg.mediaRoot,'Movie/new-file.mkv')).stat.nlink,1,'a distinct imported source passes the hardlink guard; other Review checks still apply');
 c.status='waiting_source_kept';c.keptMovieFileId=11;c.skipCurrentEdition=true;c.observationError='ENOENT old file';
 movie={movieFileId:12,movieFile:{path:'/media/Movie/new-file.mkv',size:(await fs.stat(newSource)).size,sceneName:'new release'}};
 deps.safeSource=async rel=>{const st=await fs.stat(path.join(cfg.mediaRoot,rel));return {fp:identityOf(st),size:st.size}};
 await maintainWaitingSources(deps);assert.equal(c.status,'waiting_replacement');assert.equal(c.observationError,undefined);assert.equal(c.skipCurrentEdition,false);assert.equal(c.nextSearchAt,null);assert.equal(await fs.readFile(q,'utf8'),'retained original bytes');
 c.status='waiting_source_kept';movie.movieFile.sceneName='bad release';await maintainWaitingSources(deps);assert.equal(c.status,'waiting_source_kept');assert.match(c.observationError,/identity not confirmed/);
 console.log('Retention, Review hardlink guard, exclusion, replacement rename and public status checks passed');
}finally{assert(root.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(root).startsWith('tdarr-kept-'));await fs.rm(root,{recursive:true,force:true});}
