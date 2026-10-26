import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Module} from 'node:module';
import {fileURLToPath} from 'node:url';
import {matchReviewJob} from '../review/job-matching.mjs';

const ffmpeg=process.env.FFMPEG||'/usr/lib/jellyfin-ffmpeg/ffmpeg';
const ffprobe=process.env.FFPROBE||'/usr/lib/jellyfin-ffmpeg/ffprobe';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const flow=JSON.parse(await fs.readFile(path.join(repo,'templates/tdarr/tv-flow-v1.json'),'utf8'));
function loadFlowFunction(code){
 const filename=path.join(repo,'templates/tdarr/flow-custom-function.cjs'),flowModule=new Module(filename);
 flowModule.filename=filename;flowModule.paths=Module._nodeModulePaths(repo);flowModule._compile(code,filename);return flowModule.exports;
}
const [preflightHelper,finishHelper]=flow.flowPlugins.filter(node=>node.pluginName==='customFunction').map(node=>loadFlowFunction(node.inputsDB.code));

function run(executable,args){
 const result=spawnSync(executable,args,{encoding:'utf8',timeout:120000,windowsHide:true,stdio:['ignore','pipe','pipe']});
 if(result.error||result.status!==0)throw Error(`synthetic media command failed (${result.status??result.error?.code??'unknown'})`);
 return result.stdout;
}
function probe(file){return JSON.parse(run(ffprobe,['-v','error','-show_format','-show_streams','-show_chapters','-of','json',file]));}

const temp=await fs.mkdtemp(path.join(os.tmpdir(),'tdarr-tv-flow-real-'));
const sourceRoot=path.join(temp,'source'),reviewRoot=path.join(temp,'review-prefix'),cacheRoot=path.join(reviewRoot,'.tdarr-cache');
const relative='Series/Season 01/Episode 01.mkv';
const source=path.join(sourceRoot,relative),working=path.join(cacheRoot,'encoded.mkv'),output=path.join(reviewRoot,relative);
try{
 await fs.mkdir(path.dirname(source),{recursive:true});await fs.mkdir(cacheRoot,{recursive:true});
 const chapterMetadata=path.join(temp,'chapters.ffmeta');
 await fs.writeFile(chapterMetadata,';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1\nSTART=0\nEND=3\ntitle=Episode\n');
 run(ffmpeg,['-hide_banner','-v','error','-f','lavfi','-i','testsrc2=size=320x240:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-f','ffmetadata','-i',chapterMetadata,'-map','0:v:0','-map','1:a:0','-map_metadata','2','-map_chapters','2','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-x264-params','colorprim=bt709:transfer=bt709:colormatrix=bt709','-color_range','tv','-c:a','aac','-shortest','-t','3',source]);
 const original=await fs.readFile(source),args={
  inputFileObj:{_id:source,ffProbeData:probe(source)},originalLibraryFile:{_id:source},workDir:cacheRoot,
  ffmpegPath:ffmpeg,job:{jobId:'synthetic-tv-job-269'},variables:{inFlow:{}},
  userVariables:{library:{tvSourceRoot:sourceRoot,tvReviewRoot:reviewRoot,tvCacheRoot:cacheRoot}},
 };
 const preflight=await preflightHelper(args);assert.equal(preflight.outputNumber,1);
 args.variables=preflight.variables;
 run(ffmpeg,['-hide_banner','-v','error','-nostdin','-i',source,'-map','0','-map_chapters','0','-c:v','libx265','-x265-params','pools=1:frame-threads=1:log-level=error','-preset','ultrafast','-crf','30','-c:a','copy','-f','matroska',working]);
 args.inputFileObj={_id:working,ffProbeData:probe(working)};
 const completed=await finishHelper(args);assert.equal(completed.outputNumber,1);
 assert.equal(completed.outputFileObj._id,output);
 assert.deepEqual(await fs.readFile(source),original);
 const receipt=JSON.parse(await fs.readFile(`${output}.tdarr-receipt.json`,'utf8'));
 const job={_id:receipt.jobId,DB:'synthetic-tv-library',status:'Transcode success',file:source,fileSizeStartGB:receipt.source.size/2**30,fileSizeEndGB:receipt.output.size/2**30};
 assert.equal(matchReviewJob([job],{receipt,libraryId:'synthetic-tv-library',sourceRoots:[sourceRoot],relative,sourceBytes:receipt.source.size,outputBytes:receipt.output.size}),job);
 process.stdout.write('real synthetic transcode, full strict decode, exclusive Review staging, unchanged source, and exact-job receipt: PASS\n');
}finally{await fs.rm(temp,{recursive:true,force:true});}
