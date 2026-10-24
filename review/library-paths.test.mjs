import assert from 'node:assert/strict';
import {constants as fsConstants} from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {emptyTvLibrary,validateLibraryPlans,diagnoseLibraryPaths} from './library-paths.mjs';

const defaults={enabled:false,mediaRoot:'',reviewRoot:'',libraryId:'',sourceRoots:[],tdarrReviewRoot:'',reviewPrefixes:[],sonarrRoot:'',quarantineRoot:'',reports:''};
const plan=(overrides={})=>({...defaults,...overrides});

test('the documented shared TV path example remains a valid disabled library plan',async()=>{
 const guide=await fs.readFile(new URL('../docs/ADD-TV-PATHS.md',import.meta.url),'utf8');
 const block=[...guide.matchAll(/```json\n([\s\S]*?)```/g)].map(([,text])=>JSON.parse(text)).find(value=>value.libraries);
 assert.ok(block,'the guide supplies a shared-settings example');assert.equal(validateLibraryPlans(block.libraries).tv.enabled,false);
});

test('empty TV plan is an isolated disabled descriptor',()=>{
 assert.deepEqual(emptyTvLibrary(),defaults);
 const value=emptyTvLibrary();value.sourceRoots.push('/changed');assert.deepEqual(emptyTvLibrary(),defaults);
});

test('library plans preserve absent and null while normalizing partial TV plans',()=>{
 assert.equal(validateLibraryPlans(undefined),undefined);
 assert.deepEqual(validateLibraryPlans({tv:null}),{tv:null});
 assert.deepEqual(validateLibraryPlans({tv:{mediaRoot:'/media/tv'}}),{tv:plan({mediaRoot:'/media/tv'})});
 const input={tv:{sourceRoots:['Z:\\Tdarr\\TV\\','/tdarr//TV/','\\\\nas\\share\\TV\\'] ,reviewPrefixes:['TV']}};
 const output=validateLibraryPlans(input);assert.deepEqual(output,{tv:plan({sourceRoots:['Z:/Tdarr/TV','/tdarr/TV','//nas/share/TV'],reviewPrefixes:['TV']})});
 assert.deepEqual(input,{tv:{sourceRoots:['Z:\\Tdarr\\TV\\','/tdarr//TV/','\\\\nas\\share\\TV\\'],reviewPrefixes:['TV']}});
});

test('plans reject unknown keys, malformed fields, traversal, and enabled TV processing',()=>{
 for(const input of [{movies:{}},{tv:{unexpected:true}},{tv:{enabled:'false'}},{tv:{libraryId:4}},
  {tv:{mediaRoot:'/media/../escape'}},{tv:{reviewRoot:'/review/./x'}},{tv:{reports:'/reports\0private'}},
  {tv:{sourceRoots:['/tdarr/../private']}},{tv:{sourceRoots:['C:/tdarr/../private']}},
  {tv:{reviewPrefixes:['../escape']}},{tv:{reviewPrefixes:['TV/child']}},{tv:{mediaRoot:'relative'}},{tv:{quarantineRoot:'\\\\server\\share'}}]){
  assert.throws(()=>validateLibraryPlans(input),e=>e.code==='settings_invalid'&&e.field==='libraries.tv'&&e.status===400);
 }
 assert.throws(()=>validateLibraryPlans({tv:{enabled:true}}),e=>e.code==='settings_tv_processing_unavailable'&&!('field'in e)&&!('status'in e));
});

test('disabled and incomplete TV plans remain saveable',()=>{
 assert.deepEqual(validateLibraryPlans({tv:{enabled:false,libraryId:'future'}}),{tv:plan({libraryId:'future'})});
 assert.deepEqual(validateLibraryPlans({tv:{enabled:false,mediaRoot:'/media/tv',reviewRoot:'/review/tv'}}),{tv:plan({mediaRoot:'/media/tv',reviewRoot:'/review/tv'})});
});

const linuxOnly={skip:process.platform==='linux'?false:'Requires Linux filesystem semantics'};
test('diagnostics are read only, report unavailable optional TV roots, and preserve movie readiness',linuxOnly,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'library-paths-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const media=path.join(root,'movies'),review=path.join(root,'review'),quarantine=path.join(root,'quarantine'),reports=path.join(root,'reports'),data=path.join(root,'data');
 for(const dir of [media,review,quarantine,reports,data])await fs.mkdir(dir);
 const database=path.join(data,'database.db');await fs.writeFile(database,'synthetic');
 const before=await Promise.all([root,...[media,review,quarantine,reports,data,database].map(p=>p)].map(async p=>{const s=await fs.lstat(p);return [p,s.ino,s.mtimeMs,s.size];}));
 const candidate={review:{mediaRoot:media,reviewRoot:review,database,sourceRoots:['/tdarr/movies']},radarr:{quarantineRoot:quarantine},recovery:{reports}};
 const result=await diagnoseLibraryPaths(candidate,{data});
 assert.equal(result.readOnly,true);assert.equal(result.processingEnabled,false);assert.equal(result.libraries[0].id,'movies');assert.equal(result.libraries[0].ok,true);
 assert.deepEqual(result.libraries[1].issues,[]);assert.equal(result.libraries[1].enabled,false);
 for(const pathEntry of result.libraries[1].paths)assert.ok(['not_configured','missing_or_unmounted'].includes(pathEntry.status));
 assert.deepEqual(Object.keys(result.libraries[0]).sort(),['enabled','id','issues','ok','paths']);
 assert.deepEqual(Object.keys(result.libraries[1]).sort(),['enabled','id','issues','ok','paths']);
 const after=await Promise.all(before.map(async ([p])=>{const s=await fs.lstat(p);return [p,s.ino,s.mtimeMs,s.size];}));assert.deepEqual(after,before);
 assert.deepEqual((await fs.readdir(root)).sort(),['data','movies','quarantine','reports','review']);
});

test('reports remain ready when they are readable but read only and Recovery is off',linuxOnly,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'library-readonly-reports-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const media=path.join(root,'movies'),review=path.join(root,'review'),quarantine=path.join(root,'quarantine'),reports=path.join(root,'reports');
 for(const dir of [media,review,quarantine,reports])await fs.mkdir(dir);
 const fsApi={lstat:(...args)=>fs.lstat(...args),stat:(...args)=>fs.stat(...args),realpath:(...args)=>fs.realpath(...args),access:(file,mode)=>{
  if(file===reports&&(mode&fsConstants.W_OK))return Promise.reject(Object.assign(Error('synthetic read only'),{code:'EACCES'}));
  return fs.access(file,mode);
 }};
 const result=await diagnoseLibraryPaths({review:{mediaRoot:media,reviewRoot:review},radarr:{quarantineRoot:quarantine},recovery:{reports,enabled:false}},{data:path.join(root,'data'),fsApi});
 const entry=result.libraries[0].paths.find(value=>value.role==='reports');assert.equal(entry.status,'ready');assert.equal(entry.readable,true);assert.equal(entry.writable,false);assert.equal(entry.required,false);
});

test('EROFS on source write access reports not writable while preserving readability',linuxOnly,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'library-erofs-source-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const media=path.join(root,'movies'),review=path.join(root,'review'),quarantine=path.join(root,'quarantine'),data=path.join(root,'data');
 for(const dir of [media,review,quarantine,data])await fs.mkdir(dir);const database=path.join(data,'database.db');await fs.writeFile(database,'synthetic');
 const fsApi={lstat:(...args)=>fs.lstat(...args),stat:(...args)=>fs.stat(...args),realpath:(...args)=>fs.realpath(...args),access:(file,mode)=>
  file===media&&(mode&fsConstants.W_OK)?Promise.reject(Object.assign(Error('synthetic read-only filesystem'),{code:'EROFS'})):fs.access(file,mode)};
 const result=await diagnoseLibraryPaths({review:{mediaRoot:media,reviewRoot:review,database},radarr:{quarantineRoot:quarantine}},{data,fsApi});
 const source=result.libraries[0].paths.find(value=>value.role==='source');
 assert.deepEqual({status:source.status,readable:source.readable,writable:source.writable},{status:'not_writable',readable:true,writable:false});
});

test('EROFS on optional reports write access remains ready when readable',linuxOnly,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'library-erofs-reports-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const media=path.join(root,'movies'),review=path.join(root,'review'),quarantine=path.join(root,'quarantine'),reports=path.join(root,'reports');
 for(const dir of [media,review,quarantine,reports])await fs.mkdir(dir);
 const fsApi={lstat:(...args)=>fs.lstat(...args),stat:(...args)=>fs.stat(...args),realpath:(...args)=>fs.realpath(...args),access:(file,mode)=>
  file===reports&&(mode&fsConstants.W_OK)?Promise.reject(Object.assign(Error('synthetic read-only filesystem'),{code:'EROFS'})):fs.access(file,mode)};
 const result=await diagnoseLibraryPaths({review:{mediaRoot:media,reviewRoot:review},radarr:{quarantineRoot:quarantine},recovery:{reports,enabled:false}},{data:path.join(root,'data'),fsApi});
 const report=result.libraries[0].paths.find(value=>value.role==='reports');
 assert.deepEqual({status:report.status,readable:report.readable,writable:report.writable},{status:'ready',readable:true,writable:false});
});

test('movie source needs write access while disabled TV source can be read only',linuxOnly,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'library-source-write-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const media=path.join(root,'movies'),tv=path.join(root,'tv'),review=path.join(root,'review'),quarantine=path.join(root,'quarantine'),data=path.join(root,'data');
 for(const dir of [media,tv,review,quarantine,data])await fs.mkdir(dir);const database=path.join(data,'database.db');await fs.writeFile(database,'synthetic');
 const fsApi={lstat:(...args)=>fs.lstat(...args),stat:(...args)=>fs.stat(...args),realpath:(...args)=>fs.realpath(...args),access:(file,mode)=>{
  if([media,tv].includes(file)&&(mode&fsConstants.W_OK))return Promise.reject(Object.assign(Error('synthetic read only'),{code:'EACCES'}));
  return fs.access(file,mode);
 }};
 const result=await diagnoseLibraryPaths({review:{mediaRoot:media,reviewRoot:review,database},radarr:{quarantineRoot:quarantine},libraries:{tv:plan({mediaRoot:tv})}},{data,fsApi});
 const movieSource=result.libraries[0].paths.find(value=>value.role==='source'),tvSource=result.libraries[1].paths.find(value=>value.role==='source');
 assert.equal(movieSource.writable,false);assert.equal(movieSource.status,'not_writable');assert.equal(result.libraries[0].ok,false);
 assert.equal(tvSource.writable,false);assert.equal(tvSource.status,'ready');assert.equal(result.libraries[1].ok,true);
 assert.equal(result.processingEnabled,false);
});

test('overlapping source and result paths are diagnosed across movie and disabled TV plans',linuxOnly,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'library-overlap-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const media=path.join(root,'media'),review=path.join(root,'media','review');await fs.mkdir(review,{recursive:true});
 const result=await diagnoseLibraryPaths({review:{mediaRoot:media,reviewRoot:review,database:path.join(root,'db')},libraries:{tv:plan({mediaRoot:path.join(root,'tv'),reviewRoot:path.join(root,'media','nested')})}},{data:path.join(root,'data')});
 assert.ok(result.libraries.some(lib=>lib.issues.some(issue=>issue.code==='overlap'&&issue.roles.includes('source')&&issue.roles.includes('result'))));
 assert.equal(result.libraries[0].enabled,true);assert.equal(result.processingEnabled,false);
});

test('library-specific result prefixes allow TV and movie roots under one Review parent',linuxOnly,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'library-prefixes-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const movies=path.join(root,'movies'),tv=path.join(root,'tv'),review=path.join(root,'review');
 for(const dir of [movies,tv,path.join(review,'PROD-Movies'),path.join(review,'TV')])await fs.mkdir(dir,{recursive:true});
 const result=await diagnoseLibraryPaths({review:{mediaRoot:movies,reviewRoot:review,reviewPrefixes:['PROD-Movies']},libraries:{tv:plan({mediaRoot:tv,reviewRoot:review,reviewPrefixes:['TV']})}},{data:path.join(root,'data')});
 assert.ok(result.libraries.every(library=>!library.issues.some(value=>value.code==='overlap')));
});

test('a prefixed result symlink escaping the Review root is unsafe',linuxOnly,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'library-prefix-symlink-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const movies=path.join(root,'movies'),review=path.join(root,'review'),outside=path.join(root,'outside'),quarantine=path.join(root,'quarantine'),data=path.join(root,'data');
 for(const dir of [movies,review,outside,quarantine,data])await fs.mkdir(dir);
 const database=path.join(data,'database.db');await fs.writeFile(database,'synthetic');
 await fs.symlink(outside,path.join(review,'PROD-Movies'),'dir');
 const result=await diagnoseLibraryPaths({review:{mediaRoot:movies,reviewRoot:review,database,reviewPrefixes:['PROD-Movies']},radarr:{quarantineRoot:quarantine}},{data});
 const movie=result.libraries[0],entry=movie.paths.find(value=>value.role==='result');
 assert.equal(entry.status,'unsafe_path');assert.equal(entry.path,path.join(review,'PROD-Movies'));assert.equal(movie.ok,false);
});

test('a missing prefixed result is reported at its effective path',linuxOnly,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'library-prefix-missing-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const movies=path.join(root,'movies'),review=path.join(root,'review'),quarantine=path.join(root,'quarantine'),data=path.join(root,'data');
 for(const dir of [movies,review,quarantine,data])await fs.mkdir(dir);
 const database=path.join(data,'database.db');await fs.writeFile(database,'synthetic');
 const result=await diagnoseLibraryPaths({review:{mediaRoot:movies,reviewRoot:review,database,reviewPrefixes:['PROD-Movies']},radarr:{quarantineRoot:quarantine}},{data});
 const movie=result.libraries[0],entry=movie.paths.find(value=>value.role==='result');
 assert.equal(entry.status,'missing_or_unmounted');assert.equal(entry.path,path.join(review,'PROD-Movies'));assert.equal(movie.ok,false);
});

test('each configured result prefix is inspected once at its effective path',linuxOnly,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'library-multiple-prefixes-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const movies=path.join(root,'movies'),review=path.join(root,'review'),outside=path.join(root,'outside'),quarantine=path.join(root,'quarantine'),data=path.join(root,'data');
 for(const dir of [movies,review,outside,quarantine,data,path.join(review,'PROD-Movies')])await fs.mkdir(dir,{recursive:true});
 const database=path.join(data,'database.db');await fs.writeFile(database,'synthetic');
 await fs.symlink(outside,path.join(review,'TV'),'dir');
 const result=await diagnoseLibraryPaths({review:{mediaRoot:movies,reviewRoot:review,database,reviewPrefixes:['PROD-Movies','TV']},radarr:{quarantineRoot:quarantine}},{data});
 const movie=result.libraries[0],entries=movie.paths.filter(value=>value.role==='result');
 assert.deepEqual(entries.map(value=>value.path),[path.join(review,'PROD-Movies'),path.join(review,'TV')]);
 assert.deepEqual(entries.map(value=>value.status),['ready','unsafe_path']);assert.equal(movie.ok,false);
});

test('matching movie and TV result prefixes are diagnosed as overlapping',linuxOnly,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'library-same-prefix-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const movies=path.join(root,'movies'),tv=path.join(root,'tv'),review=path.join(root,'review');
 for(const dir of [movies,tv,path.join(review,'TV')])await fs.mkdir(dir,{recursive:true});
 const result=await diagnoseLibraryPaths({review:{mediaRoot:movies,reviewRoot:review,reviewPrefixes:['TV']},libraries:{tv:plan({mediaRoot:tv,reviewRoot:review,reviewPrefixes:['TV']})}},{data:path.join(root,'data')});
 assert.ok(result.libraries.some(library=>library.issues.some(value=>value.code==='overlap'&&value.roles.includes('result'))));
});

test('nested effective result roots are diagnosed as overlapping',linuxOnly,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'library-nested-result-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const movies=path.join(root,'movies'),tv=path.join(root,'tv'),review=path.join(root,'review'),movieResult=path.join(review,'PROD-Movies');
 for(const dir of [movies,tv,path.join(movieResult,'TV'),path.join(root,'review-out')])await fs.mkdir(dir,{recursive:true});
 const result=await diagnoseLibraryPaths({review:{mediaRoot:movies,reviewRoot:review,reviewPrefixes:['PROD-Movies']},libraries:{tv:plan({mediaRoot:tv,reviewRoot:path.join(movieResult,'TV')})}},{data:path.join(root,'data')});
 assert.ok(result.libraries.some(library=>library.issues.some(value=>value.code==='overlap'&&value.roles.includes('result'))));
});

test('bind mount aliases participate in cross-library containment checks',linuxOnly,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'library-bind-alias-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const media=path.join(root,'media'),alias=path.join(root,'alias'),review=path.join(root,'review');
 await fs.mkdir(path.join(media,'nested'),{recursive:true});await fs.mkdir(path.join(alias,'nested'),{recursive:true});await fs.mkdir(review);
 const mountinfo=`10 1 0:1 / ${root} rw - ext4 /dev/test rw\n11 10 0:1 ${media} ${media} rw - ext4 /dev/test rw\n12 10 0:1 ${media} ${alias} rw - ext4 /dev/test rw\n`;
 const result=await diagnoseLibraryPaths({review:{mediaRoot:media,reviewRoot:review},libraries:{tv:plan({mediaRoot:path.join(root,'tv'),reviewRoot:path.join(alias,'nested')})}},{data:path.join(root,'data'),readMountInfo:async()=>mountinfo});
 assert.ok(result.libraries.some(library=>library.issues.some(value=>value.code==='overlap'&&value.roles.includes('source')&&value.roles.includes('result'))));
});

test('distinct filesystems with matching mount roots are not treated as aliases',linuxOnly,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'library-distinct-mounts-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const media=path.join(root,'media'),alias=path.join(root,'alias'),review=path.join(root,'review');
 await fs.mkdir(path.join(media,'nested'),{recursive:true});await fs.mkdir(path.join(alias,'nested'),{recursive:true});await fs.mkdir(review);
 const mountinfo=`10 1 0:1 / ${root} rw - ext4 /dev/test rw\n11 10 0:1 ${media} ${media} rw - ext4 /dev/test rw\n12 10 0:2 ${media} ${alias} rw - ext4 /dev/other rw\n`;
 const result=await diagnoseLibraryPaths({review:{mediaRoot:media,reviewRoot:review},libraries:{tv:plan({mediaRoot:path.join(root,'tv'),reviewRoot:path.join(alias,'nested')})}},{data:path.join(root,'data'),readMountInfo:async()=>mountinfo});
 assert.ok(result.libraries.every(library=>!library.issues.some(value=>value.code==='overlap')));
});

test('quarantine and data paths cannot overlap any library source or result',linuxOnly,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'library-protected-paths-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const media=path.join(root,'movies'),review=path.join(root,'review'),tv=path.join(root,'tv'),quarantine=path.join(tv,'quarantine');
 for(const dir of [media,review,tv,quarantine])await fs.mkdir(dir,{recursive:true});
 const result=await diagnoseLibraryPaths({review:{mediaRoot:media,reviewRoot:review},radarr:{quarantineRoot:quarantine},libraries:{tv:plan({mediaRoot:tv,reviewRoot:path.join(review,'tv')})}},{data:path.join(media,'app-data')});
 assert.ok(result.libraries.some(library=>library.issues.some(value=>value.code==='overlap'&&value.roles.includes('quarantine')&&value.roles.includes('source'))));
 assert.ok(result.libraries.some(library=>library.issues.some(value=>value.code==='overlap'&&value.roles.includes('data')&&value.roles.includes('source'))));
 assert.equal(result.libraries[1].paths.find(value=>value.role==='quarantine').path,'');
});

test('TV quarantine cannot overlap a movie result root',linuxOnly,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'library-quarantine-result-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const media=path.join(root,'media'),review=path.join(root,'review'),tv=path.join(root,'tv'),quarantine=path.join(review,'tv-quarantine');
 for(const dir of [media,review,tv,quarantine])await fs.mkdir(dir,{recursive:true});
 const result=await diagnoseLibraryPaths({review:{mediaRoot:media,reviewRoot:review},libraries:{tv:plan({mediaRoot:tv,reviewRoot:path.join(root,'tv-review'),quarantineRoot:quarantine})}},{data:path.join(root,'data')});
 assert.ok(result.libraries.some(library=>library.issues.some(value=>value.code==='overlap'&&value.roles.includes('quarantine')&&value.roles.includes('result'))));
});

test('application data cannot be placed beneath a media source',linuxOnly,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'library-data-overlap-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const media=path.join(root,'media'),review=path.join(root,'review'),data=path.join(media,'app-data');
 await fs.mkdir(data,{recursive:true});await fs.mkdir(review);
 const result=await diagnoseLibraryPaths({review:{mediaRoot:media,reviewRoot:review}},{data});
 assert.ok(result.libraries[0].issues.some(value=>value.code==='overlap'&&value.roles.includes('data')&&value.roles.includes('source')));
});

test('reports cannot be placed beneath a media source',linuxOnly,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'library-reports-overlap-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const media=path.join(root,'media'),review=path.join(root,'review'),reports=path.join(media,'reports');
 await fs.mkdir(reports,{recursive:true});await fs.mkdir(review);
 const result=await diagnoseLibraryPaths({review:{mediaRoot:media,reviewRoot:review},recovery:{reports,enabled:true}},{data:path.join(root,'data')});
 assert.ok(result.libraries[0].issues.some(value=>value.code==='overlap'&&value.roles.includes('reports')&&value.roles.includes('source')));
});

test('TV quarantine never inherits the movie quarantine setting',linuxOnly,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'library-no-quarantine-fallback-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const result=await diagnoseLibraryPaths({radarr:{quarantineRoot:path.join(root,'movie-quarantine')}},{data:''});
 const quarantine=result.libraries[1].paths.find(value=>value.role==='quarantine');
 assert.deepEqual({path:quarantine.path,status:quarantine.status,required:quarantine.required},{path:'',status:'not_configured',required:false});
});

test('a configured offline TV path fails TV readiness without gating movies',linuxOnly,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'library-tv-offline-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const media=path.join(root,'movies'),review=path.join(root,'review'),quarantine=path.join(root,'quarantine'),reports=path.join(root,'reports'),data=path.join(root,'data');
 for(const dir of [media,review,quarantine,reports,data])await fs.mkdir(dir);const database=path.join(data,'database.db');await fs.writeFile(database,'synthetic');
 const result=await diagnoseLibraryPaths({review:{mediaRoot:media,reviewRoot:review,database},radarr:{quarantineRoot:quarantine},recovery:{reports},libraries:{tv:plan({mediaRoot:path.join(root,'offline-tv')})}},{data});
 assert.equal(result.libraries[0].ok,true);assert.equal(result.libraries[1].ok,false);
 assert.equal(result.libraries[1].paths.find(value=>value.role==='source').status,'missing_or_unmounted');
});

test('permission errors while walking components are reported as unreadable',linuxOnly,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'library-denied-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const media=path.join(root,'movies');await fs.mkdir(media);
 const fsApi={lstat:file=>file===media?Promise.reject(Object.assign(Error('synthetic denied'),{code:'EACCES'})):fs.lstat(file),access:(...args)=>fs.access(...args),stat:(...args)=>fs.stat(...args),realpath:(...args)=>fs.realpath(...args)};
 const result=await diagnoseLibraryPaths({review:{mediaRoot:media}},{data:'',fsApi});
 assert.equal(result.libraries[0].paths.find(value=>value.role==='source').status,'unreadable');
 assert.equal(JSON.stringify(result).includes('EACCES'),false);
});

test('unexpected filesystem failures use the value-free unavailable status',linuxOnly,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'library-unavailable-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const media=path.join(root,'movies');await fs.mkdir(media);
 const fsApi={lstat:file=>file===media?Promise.reject(Object.assign(Error('synthetic I/O failure'),{code:'EIO'})):fs.lstat(file),access:(...args)=>fs.access(...args),stat:(...args)=>fs.stat(...args),realpath:(...args)=>fs.realpath(...args)};
 const result=await diagnoseLibraryPaths({review:{mediaRoot:media}},{data:'',fsApi});
 assert.equal(result.libraries[0].paths.find(value=>value.role==='source').status,'unavailable');
 assert.equal(JSON.stringify(result).includes('EIO'),false);
});

test('symlink components are unsafe and the diagnostic never returns host errors',linuxOnly,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'library-symlink-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const actual=path.join(root,'actual'),alias=path.join(root,'alias');await fs.mkdir(actual);await fs.symlink(actual,alias,'dir');
 const result=await diagnoseLibraryPaths({review:{mediaRoot:alias,reviewRoot:path.join(root,'review'),database:path.join(root,'missing.db')}},{data:path.join(root,'data')});
 assert.equal(result.libraries[0].paths.find(p=>p.role==='source').status,'unsafe_path');
 const serialized=JSON.stringify(result);assert.equal(serialized.includes(root),true);assert.equal(serialized.includes('ENOENT'),false);assert.equal(serialized.includes('Error:'),false);
});

test('quarantine on a different mount is incompatible even when the device is the same',linuxOnly,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'library-mount-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const media=path.join(root,'media'),review=path.join(root,'review'),quarantine=path.join(root,'quarantine');for(const dir of [media,review,quarantine])await fs.mkdir(dir);
 const mountinfo=`10 1 0:1 / ${root} rw - ext4 /dev/test rw\n11 10 0:1 / ${media} rw - ext4 /dev/test rw\n12 10 0:1 / ${quarantine} rw - ext4 /dev/test rw\n`;
 const result=await diagnoseLibraryPaths({review:{mediaRoot:media,reviewRoot:review,database:path.join(root,'db')},radarr:{quarantineRoot:quarantine}},{data:path.join(root,'data'),readMountInfo:async()=>mountinfo});
 assert.ok(result.libraries[0].issues.some(issue=>issue.code==='quarantine_mount_incompatible'&&issue.roles.includes('source')&&issue.roles.includes('quarantine')));
 assert.equal(JSON.stringify(result).includes('/dev/test'),false);
});
