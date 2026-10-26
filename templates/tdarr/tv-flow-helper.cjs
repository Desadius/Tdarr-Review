const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const constants=require('node:fs').constants;
const path=require('node:path').posix;
const spawn=require('node:child_process').spawn;

const stateKey='tvReviewProofV1';
const sampleSize=1024*1024;
const maxDecodeMs=6*60*60*1000;
const maxDecodeError=128*1024;
const supportedVideo=new Set(['h264','hevc','mpeg2video','mpeg4','av1','vp9']);
const supportedAudio=new Set(['aac','ac3','eac3','flac','mp2','mp3','opus','truehd','vorbis','dts','dts_hd','pcm_s16le','pcm_s24le']);
const supportedSubtitles=new Set(['ass','ssa','subrip','srt','mov_text','webvtt','hdmv_pgs_subtitle','dvd_subtitle']);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const blocked=args=>({outputFileObj:args?.inputFileObj,outputNumber:2,variables:args?.variables});
const continued=(args,filePath,variables=args.variables)=>({outputFileObj:{_id:filePath},outputNumber:1,variables});
const under=(root,file)=>{const relative=path.relative(root,file);return relative!==''&&!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('../');};
const validAbsolute=value=>typeof value==='string'&&value.length<=4096&&path.isAbsolute(value)&&!value.includes('\0')&&path.normalize(value)===value;
const validRelative=value=>typeof value==='string'&&value.length>0&&value.length<=4096&&!value.startsWith('/')&&!value.includes('\\')&&!value.includes('\0')&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'&&part.length<=255);
const sameStat=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs&&a.mode===b.mode;
const sameDirectory=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.mode===b.mode&&a.isDirectory()&&b.isDirectory();
const sameIdentity=(a,b)=>a.size===b.size&&a.mtime===b.mtime&&a.sample===b.sample&&a.dev===b.dev&&a.ino===b.ino&&a.ctime===b.ctime;
const fileFlags=constants.O_RDONLY|(constants.O_NOFOLLOW||0)|(constants.O_NONBLOCK||0);
const directoryFlags=constants.O_RDONLY|(constants.O_DIRECTORY||0)|(constants.O_NOFOLLOW||0)|(constants.O_NONBLOCK||0);
const createFlags=constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW||0)|(constants.O_NONBLOCK||0);
function ratio(value){
 if(typeof value!=='string'||value.length>32)return null;
 const match=/^(\d{1,8})[:/](\d{1,8})$/.exec(value);if(!match)return null;
 const numerator=Number(match[1]),denominator=Number(match[2]);
 return numerator>0&&denominator>0&&numerator/denominator<=100?numerator/denominator:null;
}

function rootsFrom(args){
 const values=args?.userVariables?.library;
 const sourceRoot=values?.tvSourceRoot,reviewRoot=values?.tvReviewRoot,cacheRoot=values?.tvCacheRoot;
 if(process.platform!=='linux'||![sourceRoot,reviewRoot,cacheRoot].every(validAbsolute))throw Error('unsupported-root-binding');
 if(sourceRoot===reviewRoot||under(sourceRoot,reviewRoot)||under(reviewRoot,sourceRoot)||sourceRoot===cacheRoot||under(sourceRoot,cacheRoot)||!(under(reviewRoot,cacheRoot)))throw Error('overlapping-root-binding');
 return {sourceRoot,reviewRoot,cacheRoot};
}
async function identity(record){
 const length=Math.min(record.stat.size,sampleSize),buffer=Buffer.alloc(length),hash=crypto.createHash('sha256');
 for(const offset of [0,Math.max(0,record.stat.size-length)]){
  let read=0;while(read<length){const result=await record.handle.read(buffer,read,length-read,offset+read);if(!result.bytesRead)throw Error('changed-file');read+=result.bytesRead;}hash.update(buffer);
 }
 await verifyOpenFile(record);
 return {size:record.stat.size,mtime:Math.round(record.stat.mtimeMs),sample:hash.digest('hex'),dev:record.stat.dev,ino:record.stat.ino,ctime:record.stat.ctimeMs};
}
function trackFacts(media){
 const streams=media?.streams,chapters=media?.chapters;
 if(!Array.isArray(streams)||streams.length<1||streams.length>64||!Array.isArray(chapters)||chapters.length>256)throw Error('missing-stream-metadata');
 const videos=streams.filter(stream=>stream?.codec_type==='video');
 if(videos.length!==1)throw Error('video-stream-layout');
 const video=videos[0],format=media.format;
 if(!supportedVideo.has(video.codec_name)||video.field_order!=='progressive'||!Number.isSafeInteger(video.width)||!Number.isSafeInteger(video.height)||video.width<1||video.height<1||video.pix_fmt!=='yuv420p')throw Error('unsupported-video');
 const sampleAspectRatio=ratio(video.sample_aspect_ratio),displayAspectRatio=ratio(video.display_aspect_ratio);
 const bitDepth=video.bits_per_raw_sample===undefined||video.bits_per_raw_sample===null?(video.pix_fmt==='yuv420p'?8:null):Number(video.bits_per_raw_sample);
 if(sampleAspectRatio===null||displayAspectRatio===null||bitDepth!==8)throw Error('unsupported-video-format');
 if(String(format?.format_name||'').split(',')[0]!=='matroska')throw Error('unsupported-container');
 const duration=Number(format.duration),rate=video.avg_frame_rate||video.r_frame_rate;
 if(!Number.isFinite(duration)||duration<1||duration>14400||typeof rate!=='string'||!/^\d+(?:\/\d+)?$/.test(rate))throw Error('unsupported-timing');
 const [num,den=1]=rate.split('/').map(Number),fps=num/den;if(!Number.isFinite(fps)||fps<10||fps>60)throw Error('unsupported-timing');
 if(Array.isArray(video.side_data_list)&&video.side_data_list.length)throw Error('special-video-metadata');
 const sdrTransfer=new Set(['bt709','smpte170m','smpte240m','gamma22','gamma28','iec61966-2-1']);
 const sdrPrimaries=new Set(['bt709','smpte170m','smpte240m','bt470bg','bt470m']);
 const sdrSpace=new Set(['bt709','smpte170m','smpte240m','fcc','bt470bg']);
 if(!sdrTransfer.has(video.color_transfer)||!sdrPrimaries.has(video.color_primaries)||!sdrSpace.has(video.color_space)||!['tv','pc'].includes(video.color_range))throw Error('hdr-or-unknown-color-metadata');
 const facts=[];
 for(const stream of streams){
  if(!plain(stream)||!['video','audio','subtitle'].includes(stream.codec_type))throw Error('unsupported-stream');
  const disposition=stream.disposition;
  if(!plain(disposition)||![0,1,true,false].includes(disposition.default)||![0,1,true,false].includes(disposition.forced))throw Error('missing-track-flags');
  const tags=plain(stream.tags)?stream.tags:{};
  const language=typeof tags.language==='string'&&/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(tags.language)?tags.language.toLowerCase():null;
  if((stream.codec_type==='audio'&&!supportedAudio.has(stream.codec_name))||(stream.codec_type==='subtitle'&&!supportedSubtitles.has(stream.codec_name)))throw Error('unsupported-track');
  if(stream.codec_type==='audio'&&(!Number.isSafeInteger(stream.channels)||stream.channels<1||typeof stream.channel_layout!=='string'||!stream.channel_layout))throw Error('unknown-audio-layout');
  if(Array.isArray(stream.side_data_list)&&stream.side_data_list.length)throw Error('special-track-metadata');
  facts.push({type:stream.codec_type,codec:stream.codec_name,language,default:Boolean(disposition.default),forced:Boolean(disposition.forced),channels:stream.channels??null,channelLayout:stream.channel_layout??null,width:stream.width??null,height:stream.height??null,fieldOrder:stream.field_order??null,frameRate:stream.avg_frame_rate||stream.r_frame_rate||null,pixelFormat:stream.pix_fmt??null,bitsPerRawSample:stream.codec_type==='video'?bitDepth:(stream.bits_per_raw_sample??null),sampleAspectRatio:stream.sample_aspect_ratio??null,displayAspectRatio:stream.display_aspect_ratio??null,primaries:stream.color_primaries??null,transfer:stream.color_transfer??null,colorSpace:stream.color_space??null,colorRange:stream.color_range??null});
 }
 const chapterFacts=chapters.map(chapter=>{
  const start=Number(chapter?.start_time),end=Number(chapter?.end_time);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start)throw Error('unsupported-chapter');
  return {start,end,titleHash:typeof chapter?.tags?.title==='string'?crypto.createHash('sha256').update(chapter.tags.title).digest('hex'):null};
 });
 return {duration,videoCount:videos.length,tracks:facts,chapters:chapterFacts};
}
function preserved(before,after){
 if(!plain(before)||!plain(after)||before.videoCount!==after.videoCount||before.tracks.length!==after.tracks.length||before.chapters.length!==after.chapters.length)return false;
 for(let index=0;index<before.tracks.length;index++){
  const left=before.tracks[index],right=after.tracks[index];
  if(left.type!==right.type||left.default!==right.default||left.forced!==right.forced)return false;
  if(left.type!=='video'&&(left.codec!==right.codec||left.language!==right.language||left.channels!==right.channels||left.channelLayout!==right.channelLayout))return false;
  if(left.type==='video'&&(right.codec!=='hevc'||left.width!==right.width||left.height!==right.height||left.frameRate!==right.frameRate||left.pixelFormat!==right.pixelFormat||left.bitsPerRawSample!==right.bitsPerRawSample||left.sampleAspectRatio!==right.sampleAspectRatio||left.displayAspectRatio!==right.displayAspectRatio||left.primaries!==right.primaries||left.transfer!==right.transfer||left.colorSpace!==right.colorSpace||left.colorRange!==right.colorRange))return false;
 }
 for(let index=0;index<before.chapters.length;index++){
  const left=before.chapters[index],right=after.chapters[index];
  if(Math.abs(left.start-right.start)>0.05||Math.abs(left.end-right.end)>0.05||left.titleHash!==right.titleHash)return false;
 }
 return Math.abs(before.duration-after.duration)<=Math.max(0.5,before.duration*0.005);
}
function safeRootPath(rootPath,relative){if(!validRelative(relative)||!under(rootPath,path.join(rootPath,relative)))throw Error('unsafe-path');return path.join(rootPath,relative);}
async function decodeCompletely(file,ffmpegPath,spawnChild=spawn){
 if(!validAbsolute(ffmpegPath))throw Error('missing-decoder');
 return new Promise((resolve,reject)=>{
  const argv=['-nostdin','-v','error','-xerror','-err_detect','explode','-threads','1','-filter_threads','1','-protocol_whitelist','file','-format_whitelist','matroska','-probesize','5000000','-analyzeduration','5000000','-max_alloc','33554432','-f','matroska','-i','/proc/self/fd/3','-map','0:v?','-map','0:a?','-f','null','-'];
  let child;try{child=spawnChild(ffmpegPath,argv,{shell:false,detached:true,windowsHide:true,stdio:['ignore','ignore','pipe',file.handle.fd],env:{PATH:process.env.PATH||''}});}catch{return reject(Error('decoder-start-failed'));}
  let stderrBytes=0,overflow=false,timedOut=false,closed=false,killTimer=null;
  const kill=(signal)=>{try{if(child.pid)process.kill(-child.pid,signal);else child.kill(signal);}catch{try{child.kill(signal);}catch{}}};
  const terminate=()=>{kill('SIGTERM');killTimer=setTimeout(()=>{if(!closed)kill('SIGKILL');},1500);killTimer.unref?.();};
  const deadline=setTimeout(()=>{timedOut=true;terminate();},maxDecodeMs);deadline.unref?.();
  child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;if(stderrBytes>maxDecodeError&&!overflow){overflow=true;terminate();}});
  child.once('error',()=>{overflow=true;});
  child.once('close',code=>{closed=true;clearTimeout(deadline);clearTimeout(killTimer);if(code===0&&!timedOut&&!overflow&&stderrBytes===0)resolve();else reject(Error('decoder-did-not-complete'));});
 });
}
async function syncDirectoryChain(record){
 for(const directory of [...record.chain.handles].reverse())await directory.handle.sync();
 await record.root.handle.sync();
}
async function copyFile(source,destination){
 const buffer=Buffer.alloc(4*1024*1024);let position=0;
 while(position<source.stat.size){
  const amount=Math.min(buffer.length,source.stat.size-position),read=await source.handle.read(buffer,0,amount,position);
  if(read.bytesRead!==amount)throw Error('source-changed');
  let written=0;while(written<amount){const result=await destination.handle.write(buffer,written,amount-written,position+written);if(!result.bytesWritten)throw Error('destination-write-failed');written+=result.bytesWritten;}
  position+=amount;
 }
 await destination.handle.sync();
 if((await source.handle.stat()).size!==source.stat.size)throw Error('source-changed');
}
async function preflight(args){
 const {sourceRoot,reviewRoot,cacheRoot}=rootsFrom(args);
 const sourcePath=args.originalLibraryFile?._id,workDir=args.workDir;
 if(!validAbsolute(sourcePath)||sourcePath!==args.inputFileObj?._id||!validAbsolute(workDir)||!under(sourceRoot,sourcePath)||!(workDir===cacheRoot||under(cacheRoot,workDir)))throw Error('source-or-cache-outside-binding');
 const relative=path.relative(sourceRoot,sourcePath);
 if(!validRelative(relative)||!relative.toLowerCase().endsWith('.mkv'))throw Error('unsupported-relative-path');
 const workRelative=path.relative(cacheRoot,workDir);
 const source=await openFileUnder(sourceRoot,relative);
 let cache,review,workDirectory;
 try{
  cache=await openRoot(cacheRoot);
  review=await openRoot(reviewRoot);
  workDirectory=await openDirectories(cache,workRelative==='.'?[]:workRelative.split('/'));
  const sourceIdentity=await identity(source),profile=trackFacts(args.inputFileObj?.ffProbeData);
  if(profile.tracks.some(track=>track.type==='video'&&track.codec==='hevc'))throw Error('already-target-codec');
  if(profile.tracks.some(track=>track.type==='video'&&track.codec==='hevc'))throw Error('already-target-codec');
  const destination=safeRootPath(reviewRoot,relative);
  for(const candidate of [destination,`${destination}.tdarr-receipt.json`])try{await fs.lstat(candidate);throw Error('result-already-exists');}catch(error){if(error.code!=='ENOENT')throw error;}
  const proof={version:1,source:sourceIdentity,sourceRelativeHash:crypto.createHash('sha256').update(relative).digest('hex'),profile,roots:{source:{dev:source.root.stat.dev,ino:source.root.stat.ino},review:{dev:review.stat.dev,ino:review.stat.ino},cache:{dev:cache.stat.dev,ino:cache.stat.ino}}};
  const variables={...(plain(args.variables)?args.variables:{}),inFlow:{...(plain(args.variables?.inFlow)?args.variables.inFlow:{}),[stateKey]:JSON.stringify(proof)}};
  return continued(args,sourcePath,variables);
 }finally{for(const directory of workDirectory?.handles.reverse()||[])await directory.handle.close().catch(()=>{});await closeFile(source);await review?.handle.close().catch(()=>{});await cache?.handle.close().catch(()=>{});}
}
async function finish(args,spawnChild=spawn){
 const {sourceRoot,reviewRoot,cacheRoot}=rootsFrom(args);
 const serialized=args.variables?.inFlow?.[stateKey];if(typeof serialized!=='string'||serialized.length>65536)throw Error('missing-source-proof');
 const proof=JSON.parse(serialized);if(!plain(proof)||proof.version!==1||!plain(proof.source)||!/^([a-f0-9]{64})$/.test(proof.sourceRelativeHash))throw Error('invalid-source-proof');
 const currentSourcePath=args.originalLibraryFile?._id,workingPath=args.inputFileObj?._id;
 if(!validAbsolute(currentSourcePath)||!under(sourceRoot,currentSourcePath)||!validAbsolute(workingPath)||!under(cacheRoot,workingPath))throw Error('path-binding-changed');
 const relative=path.relative(sourceRoot,currentSourcePath);if(!validRelative(relative)||!relative.toLowerCase().endsWith('.mkv')||crypto.createHash('sha256').update(relative).digest('hex')!==proof.sourceRelativeHash)throw Error('source-path-changed');
 const workRelative=path.relative(cacheRoot,workingPath);if(!validRelative(workRelative))throw Error('unsafe-cache-file');
 const cachePath=args.workDir;if(!validAbsolute(cachePath)||!(cachePath===cacheRoot||under(cacheRoot,cachePath)))throw Error('cache-binding-changed');
 const source=await openFileUnder(sourceRoot,relative),working=await openFileUnder(cacheRoot,workRelative);
 if(!plain(proof.roots)||proof.roots.source?.dev!==source.root.stat.dev||proof.roots.source?.ino!==source.root.stat.ino||proof.roots.cache?.dev!==working.root.stat.dev||proof.roots.cache?.ino!==working.root.stat.ino){await Promise.all([closeFile(source),closeFile(working)]);throw Error('root-binding-changed');}
 let staged,receiptFile;
 try{
  const sourceIdentity=await identity(source),workingIdentity=await identity(working);
  if(!sameIdentity(sourceIdentity,proof.source))throw Error('source-changed');
  const jobId=args.job?.jobId;if(typeof jobId!=='string'||!jobId.trim()||jobId!==jobId.trim()||jobId.length>512)throw Error('missing-current-job-id');
  const outputFacts=trackFacts(args.inputFileObj?.ffProbeData);if(!preserved(proof.profile,outputFacts))throw Error('preservation-check-failed');
  await decodeCompletely(working,args.ffmpegPath,spawnChild);
  await verifyOpenFile(source);await verifyOpenFile(working);
  if(!sameIdentity(await identity(source),proof.source)||!sameIdentity(await identity(working),workingIdentity))throw Error('input-changed-during-decode');
  const destination=safeRootPath(reviewRoot,relative);
  staged=await openFileUnder(reviewRoot,relative,{create:true,mode:0o640});
  if(proof.roots.review?.dev!==staged.root.stat.dev||proof.roots.review?.ino!==staged.root.stat.ino)throw Error('review-root-changed');
  await copyFile(working,staged);
  staged.stat=await staged.handle.stat();
  const stagedIdentity=await identity(staged);
  if(stagedIdentity.size!==workingIdentity.size||stagedIdentity.sample!==workingIdentity.sample)throw Error('staged-copy-mismatch');
  await verifyOpenFile(source);await verifyOpenFile(working);await verifyOpenFile(staged);
  if(!sameIdentity(await identity(source),proof.source)||!sameIdentity(await identity(working),workingIdentity))throw Error('input-changed-during-stage');
  const outputRelative=path.relative(reviewRoot,destination);
  if(!validRelative(outputRelative)||outputRelative!==relative)throw Error('output-path-mismatch');
  const receipt={version:1,relative,outputRelative,source:{size:sourceIdentity.size,mtime:sourceIdentity.mtime,sample:sourceIdentity.sample},output:{size:stagedIdentity.size,mtime:stagedIdentity.mtime,sample:stagedIdentity.sample},jobId,createdAt:Date.now()};
  await syncDirectoryChain(staged);
  receiptFile=await openFileUnder(reviewRoot,`${outputRelative}.tdarr-receipt.json`,{create:true,mode:0o600});
  await receiptFile.handle.writeFile(JSON.stringify(receipt));await receiptFile.handle.sync();
  receiptFile.stat=await receiptFile.handle.stat();
  await verifyOpenFile(staged);await verifyOpenFile(receiptFile);await syncDirectoryChain(receiptFile);
  return continued(args,destination);
 }finally{
  await Promise.all([closeFile(source),closeFile(working),...(staged?[closeFile(staged)]:[]),...(receiptFile?[closeFile(receiptFile)]:[])]);
 }
}
async function root(pathname){
 const stat=await fs.lstat(pathname);
 if(stat.isSymbolicLink()||!stat.isDirectory()||await fs.realpath(pathname)!==pathname)throw Error('unsafe-root');
 return stat;
}
async function openFileUnder(rootPath,relative,{create=false,mode=0o640}={}){
 if(!validRelative(relative))throw Error('unsafe-relative');
 const rootRecord=await openRoot(rootPath),parts=relative.split('/'),leaf=parts.pop();let chain;
 try{
  chain=await openDirectories(rootRecord,parts,{create});const parent=chain.parent;
  const actual=path.join(parent.path,leaf),via=`/proc/self/fd/${parent.handle.fd}/${leaf}`;
  const handle=await fs.open(via,create?createFlags:fileFlags,mode),stat=await handle.stat(),named=await fs.lstat(actual);
  if(!stat.isFile()||named.isSymbolicLink()||!sameStat(stat,named)||stat.nlink!==1||await fs.realpath(actual)!==actual){await handle.close();throw Error('unsafe-file');}
  return {root:rootRecord,chain,handle,path:actual,stat};
 }catch(error){for(const directory of chain?.handles?.reverse()||[])await directory.handle.close().catch(()=>{});await rootRecord.handle.close().catch(()=>{});throw error;}
}
async function openRoot(rootPath){
 const before=await root(rootPath);
 const handle=await fs.open(rootPath,directoryFlags),stat=await handle.stat();
 if(!sameStat(before,stat)){await handle.close();throw Error('changed-root');}
 return {handle,path:rootPath,stat,root:true};
}
async function openDirectories(rootRecord,parts,{create=false}={}){
 const handles=[];let parent=rootRecord;
 try{
  for(const part of parts){
   const actual=path.join(parent.path,part),via=`/proc/self/fd/${parent.handle.fd}/${part}`;
   let handle;
   try{handle=await fs.open(via,directoryFlags);}
   catch(error){if(!create||error.code!=='ENOENT')throw error;try{await fs.mkdir(via,{mode:0o750});}catch(mkdirError){if(mkdirError.code!=='EEXIST')throw mkdirError;}handle=await fs.open(via,directoryFlags);}
   const stat=await handle.stat(),named=await fs.lstat(actual);
   if(!stat.isDirectory()||named.isSymbolicLink()||!sameStat(stat,named)||await fs.realpath(actual)!==actual){await handle.close();throw Error('unsafe-parent');}
   const record={handle,path:actual,stat};handles.push(record);parent=record;
  }
  return {handles,parent};
 }catch(error){for(const record of handles.reverse())await record.handle.close().catch(()=>{});throw error;}
}
async function verifyOpenFile(record){
 const stat=await record.handle.stat(),named=await fs.lstat(record.path);
 if(!sameStat(record.stat,stat)||named.isSymbolicLink()||!sameStat(record.stat,named)||await fs.realpath(record.path)!==record.path)throw Error('changed-file');
 for(const directory of [record.root,...record.chain.handles]){
  const current=await fs.lstat(directory.path);if(current.isSymbolicLink()||!sameDirectory(directory.stat,current)||await fs.realpath(directory.path)!==directory.path)throw Error('changed-parent');
 }
}
async function closeFile(record){await record.handle.close().catch(()=>{});for(const directory of record.chain.handles.reverse())await directory.handle.close().catch(()=>{});await record.root.handle.close().catch(()=>{});}
module.exports=async function tvFlowHelper(args,testDependencies={}){
 try{return args?.variables?.inFlow?.[stateKey]?await finish(args,testDependencies.spawnChild||spawn):await preflight(args);}
 catch{return blocked(args);}
};
