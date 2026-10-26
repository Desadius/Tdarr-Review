import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Module} from 'node:module';
import {EventEmitter} from 'node:events';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {matchReviewJob,ReviewJobMatchError} from './job-matching.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const flowPath=path.join(root,'templates/tdarr/tv-flow-v1.json');

async function loadFlow(){
 return JSON.parse(await fs.readFile(flowPath,'utf8'));
}
function compileFlowHelper(code){
 const filename=path.join(root,'templates/tdarr/flow-custom-function.cjs');
 const flowModule=new Module(filename);flowModule.filename=filename;flowModule.paths=Module._nodeModulePaths(root);flowModule._compile(code,filename);
 return flowModule.exports;
}

test('versioned TV flow is a closed, non-destructive transcode graph with review-only output',async()=>{
 const flow=await loadFlow();
 assert.deepEqual(Object.keys(flow).sort(),['_id','flowEdges','flowPlugins','isUiLocked','name','priority'].sort(),'only the reviewed flow envelope may be exported');
 assert.equal(flow._id,'tv-review-staging-v1-template');
 assert.equal(flow.name,'TV Review staging v1 (paused setup only)');
 assert.equal(flow.priority,0);
 assert.equal(flow.isUiLocked,false);
 const plugins=new Map(flow.flowPlugins.map(node=>[node.id,node]));
 const summarizeNode=node=>({keys:Object.keys(node).sort(),id:node.id,name:node.name,position:node.position,pluginName:node.pluginName,sourceRepo:node.sourceRepo,version:node.version,fpEnabled:node.fpEnabled,inputsDB:node.inputsDB?Object.fromEntries(Object.entries(node.inputsDB).map(([key,value])=>[key,key==='code'?'__reviewed-helper__':value])):null});
 const expectedNodes=[
  {id:'tv-input',name:'TV source file',pluginName:'inputFile',version:'1.0.0',inputsDB:null},
  {id:'tv-preflight',name:'TV source and exception preflight',pluginName:'customFunction',version:'1.0.0',inputsDB:{code:'__reviewed-helper__'}},
  {id:'tv-start',name:'Begin transcode',pluginName:'ffmpegCommandStart',version:'1.0.0',inputsDB:null},
  {id:'tv-encoder',name:'Software HEVC encode',pluginName:'ffmpegCommandSetVideoEncoder',version:'1.0.0',inputsDB:{outputCodec:'hevc',enableFFmpegPreset:'true',ffmpegPreset:'slow',enableFFmpegQuality:'true',ffmpegQuality:'22',hardwareEncoding:'false',hardwareType:'auto',hardwareDecoding:'false',forceEncoding:'false'}},
  {id:'tv-container',name:'Matroska output without forced stream removal',pluginName:'ffmpegCommandSetContainer',version:'1.0.0',inputsDB:{container:'mkv',forceConform:'false'}},
  {id:'tv-execute',name:'Execute transcode',pluginName:'ffmpegCommandExecute',version:'1.0.0',inputsDB:null},
  {id:'tv-duration',name:'Duration sanity gate',pluginName:'compareFileDurationRatio',version:'1.0.0',inputsDB:{greaterThan:'99.5',lessThan:'100.5'}},
  {id:'tv-size',name:'Output size sanity gate',pluginName:'compareFileSizeRatio',version:'2.0.0',inputsDB:{greaterThan:'25',lessThan:'150'}},
  {id:'tv-receipt',name:'Strict decode, exclusive TV Review stage, exact-job receipt',pluginName:'customFunction',version:'1.0.0',inputsDB:{code:'__reviewed-helper__'}},
  {id:'tv-fail',name:'Fail closed for manual review',pluginName:'failFlow',version:'1.0.0',inputsDB:null},
 ].map((node,index)=>({keys:['fpEnabled','id','name','pluginName','position','sourceRepo','version',...(node.inputsDB?['inputsDB']:[])].sort(),sourceRepo:'Community',fpEnabled:true,position:{x:index*250,y:0},...node}));
 assert.deepEqual(flow.flowPlugins.map(summarizeNode),expectedNodes,'node identities, plugin versions, settings, and all node keys are closed to review');
 const expectedEdges=[
  ['tv-edge-1','tv-input','tv-preflight','1',null],['tv-edge-2','tv-preflight','tv-start','1',null],['tv-edge-3','tv-preflight','tv-fail','2',null],
  ['tv-edge-4','tv-start','tv-encoder','1',null],['tv-edge-5','tv-encoder','tv-container','1',null],['tv-edge-6','tv-container','tv-execute','1',null],
  ['tv-edge-7','tv-execute','tv-duration','1',null],['tv-edge-8','tv-duration','tv-size','1',null],['tv-edge-9','tv-duration','tv-fail','2',null],
  ['tv-edge-10','tv-duration','tv-fail','3',null],['tv-edge-11','tv-size','tv-receipt','1',null],['tv-edge-12','tv-size','tv-fail','2',null],
  ['tv-edge-13','tv-size','tv-fail','3',null],['tv-edge-14','tv-receipt','tv-fail','2',null],
 ].map(([id,source,target,sourceHandle,targetHandle])=>({keys:['id','source','sourceHandle','target','targetHandle'],id,source,target,sourceHandle,targetHandle}));
 assert.deepEqual(flow.flowEdges.map(edge=>({keys:Object.keys(edge).sort(),id:edge.id,source:edge.source,target:edge.target,sourceHandle:edge.sourceHandle,targetHandle:edge.targetHandle})),expectedEdges,'only the reviewed edges may connect nodes; preflight failures must fail closed');
 assert.ok(flow.flowPlugins.some(node=>node.pluginName==='ffmpegCommandExecute'),'the template must perform a real encode');
 assert.ok(flow.flowPlugins.some(node=>node.pluginName==='failFlow'),'unsafe or unsupported inputs must fail closed');
 assert.equal(flow.flowPlugins.filter(node=>node.pluginName==='copyToDirectory').length,0,'stock copying cannot enforce exclusive no-follow writes');
 const output=flow.flowPlugins.find(node=>node.id==='tv-receipt');
 assert.ok(output);
 const customFunctions=flow.flowPlugins.filter(node=>node.pluginName==='customFunction');
 assert.equal(customFunctions.length,2);
 assert.ok(customFunctions.every(node=>typeof node.inputsDB.code==='string'&&node.inputsDB.code.length>0));
 for(const edge of flow.flowEdges){
  assert.ok(plugins.has(edge.source),`unknown source node ${edge.source}`);
  assert.ok(plugins.has(edge.target),`unknown target node ${edge.target}`);
 }
 const encode=flow.flowPlugins.find(node=>node.pluginName==='ffmpegCommandExecute');
 const fail=flow.flowPlugins.find(node=>node.pluginName==='failFlow');
 const reachable=(from,to)=>{
  const seen=new Set(),queue=[from];
  while(queue.length){const current=queue.shift();if(current===to)return true;if(seen.has(current))continue;seen.add(current);for(const edge of flow.flowEdges)if(edge.source===current)queue.push(edge.target);}
  return false;
 };
 assert.ok(reachable(encode.id,output.id),'only a successfully encoded file can reach staging');
 assert.ok(reachable(output.id,fail.id),'a failed receipt/preservation check must fail the flow');
 assert.ok(!flow.flowPlugins.some(node=>node.pluginName==='writeToLibrary'));
 assert.doesNotMatch(JSON.stringify(flow),/\b(?:radarr|tmdb|api[_-]?key|password|secret)\b/i);
 assert.doesNotMatch(JSON.stringify(flow),/https?:\/\/|[A-Z]:\\|\/mnt\/|\/media\//i,'the exported template must contain only generic placeholders');
});

test('TV receipt helper runs against synthetic files and never changes the source',async()=>{
 const flow=await loadFlow();
 const [preflightHelper,finishHelper]=flow.flowPlugins.filter(node=>node.pluginName==='customFunction').map(node=>compileFlowHelper(node.inputsDB.code));
 const temp=await fs.mkdtemp(path.join(await fs.realpath(path.join(root,'..')),'tv-flow-test-'));
 const sourceRoot=path.join(temp,'source'),reviewRoot=path.join(temp,'review'),cacheRoot=path.join(reviewRoot,'.cache');
 const relative='Series/Season 01/Episode 01.mkv';
 const source=path.join(sourceRoot,relative),output=path.join(reviewRoot,relative);
 const working=path.join(cacheRoot,'worker.mkv');
 try{
  await fs.mkdir(path.dirname(source),{recursive:true});
  await fs.mkdir(cacheRoot,{recursive:true});
  await fs.writeFile(source,Buffer.from('original synthetic episode'));
  const sourceBytes=await fs.readFile(source);
  const args={
   inputFileObj:{_id:source,ffProbeData:{format:{format_name:'matroska',duration:'60.0'},streams:[{index:0,codec_type:'video',codec_name:'h264',width:1280,height:720,field_order:'progressive',avg_frame_rate:'24/1',pix_fmt:'yuv420p',bits_per_raw_sample:'8',sample_aspect_ratio:'1:1',display_aspect_ratio:'16:9',color_transfer:'bt709',color_primaries:'bt709',color_space:'bt709',color_range:'tv',disposition:{default:1,forced:0}},{index:1,codec_type:'audio',codec_name:'aac',tags:{language:'ces'},channels:2,channel_layout:'stereo',disposition:{default:1,forced:0}},{index:2,codec_type:'subtitle',codec_name:'subrip',tags:{language:'eng'},disposition:{default:0,forced:0}}],chapters:[{start_time:'0',end_time:'60',tags:{title:'Chapter 1'}}]}},
   originalLibraryFile:{_id:source},workDir:cacheRoot,ffmpegPath:'/usr/bin/ffmpeg',job:{jobId:'synthetic-current-job'},variables:{inFlow:{}},
   userVariables:{library:{tvSourceRoot:sourceRoot,tvReviewRoot:reviewRoot,tvCacheRoot:cacheRoot}},
  };
  const preflight=await preflightHelper(args);
  assert.equal(preflight.outputNumber,1);
  const privateState=JSON.stringify(preflight.variables);
  for(const value of [source,sourceRoot,reviewRoot,cacheRoot,relative,'Chapter 1'])assert.ok(!privateState.includes(value),'flow state must not persist paths or chapter titles');
  args.variables=preflight.variables;
  await fs.writeFile(working,Buffer.from('encoded synthetic episode'));
  args.inputFileObj={...args.inputFileObj,_id:working,ffProbeData:{...args.inputFileObj.ffProbeData,streams:[{...args.inputFileObj.ffProbeData.streams[0],codec_name:'hevc'},...args.inputFileObj.ffProbeData.streams.slice(1)]}};
  let decodeArgs;
  const fakeSpawn=(executable,argv,options)=>{decodeArgs={executable,argv,options};const child=new EventEmitter();child.stderr=new EventEmitter();child.pid=process.pid;queueMicrotask(()=>child.emit('close',0));return child;};
  const completed=await finishHelper(args,{spawnChild:fakeSpawn});
  assert.equal(completed.outputNumber,1);
  assert.ok(decodeArgs.argv.includes('-xerror'));
  assert.ok(decodeArgs.argv.includes('-err_detect')&&decodeArgs.argv.includes('explode'));
  assert.ok(decodeArgs.argv.includes('-protocol_whitelist')&&decodeArgs.argv.includes('file'));
  assert.ok(decodeArgs.argv.includes('-format_whitelist')&&decodeArgs.argv.includes('matroska'));
  assert.equal(decodeArgs.options.shell,false);
  assert.deepEqual(await fs.readFile(source),sourceBytes);
  assert.equal(completed.outputFileObj._id,output);
  assert.deepEqual(await fs.readFile(output),await fs.readFile(working));
  const receipt=JSON.parse(await fs.readFile(`${output}.tdarr-receipt.json`,'utf8'));
  assert.equal(receipt.version,1);
  assert.equal(receipt.relative,relative);
  assert.equal(receipt.outputRelative,relative);
  assert.equal(receipt.jobId,'synthetic-current-job');
  assert.deepEqual(Object.keys(receipt).sort(),['createdAt','jobId','output','outputRelative','relative','source','version'].sort());
  assert.deepEqual(Object.keys(receipt.source).sort(),['mtime','sample','size']);
  assert.deepEqual(Object.keys(receipt.output).sort(),['mtime','sample','size']);
  const job={_id:'synthetic-current-job',DB:'synthetic-library',status:'Transcode success',file:source,fileSizeStartGB:receipt.source.size/2**30,fileSizeEndGB:receipt.output.size/2**30};
  const database=new DatabaseSync(path.join(temp,'tdarr.sqlite'));
  try{database.exec('CREATE TABLE jobsjsondb (json_data TEXT NOT NULL)');database.prepare('INSERT INTO jobsjsondb (json_data) VALUES (?)').run(JSON.stringify(job));}
  finally{database.close();}
  const worker=spawnSync(process.execPath,[path.join(root,'review/sonarr-result-worker.mjs')],{input:JSON.stringify({mediaRoot:sourceRoot,reviewRoot,database:path.join(temp,'tdarr.sqlite'),relative,outputRelatives:[relative]}),encoding:'utf8',timeout:10000,windowsHide:true,maxBuffer:256*1024});
  assert.equal(worker.status,0,'Review result worker must complete');
  const inspected=JSON.parse(worker.stdout);
  assert.equal(inspected.status,'present','Review result reader must accept the real file identity and v1 receipt');
  assert.equal(matchReviewJob([job],{receipt,libraryId:'synthetic-library',sourceRoots:[sourceRoot],relative,sourceBytes:receipt.source.size,outputBytes:receipt.output.size}),job);
  assert.throws(()=>matchReviewJob([job],{receipt:{...receipt,jobId:'different-job'},libraryId:'synthetic-library',sourceRoots:[sourceRoot],relative,sourceBytes:receipt.source.size,outputBytes:receipt.output.size}),ReviewJobMatchError);
 }finally{
  await fs.rm(temp,{recursive:true,force:true});
 }
});

test('TV helper blocks root aliases, unknown/HDR inputs, missing job IDs and destination links before receipt',async()=>{
 const helperPath=path.join(root,'templates/tdarr/tv-flow-helper.cjs');
 const helper=(await import(`${pathToFileURL(helperPath).href}?guard=${Date.now()}`)).default;
 const temp=await fs.mkdtemp(path.join(await fs.realpath(path.join(root,'..')),'tv-flow-guards-'));
 const sourceRoot=path.join(temp,'source'),reviewRoot=path.join(temp,'review'),cacheRoot=path.join(reviewRoot,'.cache');
 const relative='Series/Season 01/Episode 02.mkv',source=path.join(sourceRoot,relative),output=path.join(reviewRoot,relative),working=path.join(cacheRoot,'worker.mkv');
 const metadata=(overrides={})=>({format:{format_name:'matroska',duration:'120.0'},streams:[{index:0,codec_type:'video',codec_name:'h264',width:1280,height:720,field_order:'progressive',avg_frame_rate:'24/1',pix_fmt:'yuv420p',bits_per_raw_sample:'8',sample_aspect_ratio:'1:1',display_aspect_ratio:'16:9',color_transfer:'bt709',color_primaries:'bt709',color_space:'bt709',color_range:'tv',disposition:{default:1,forced:0},...overrides},{index:1,codec_type:'audio',codec_name:'aac',tags:{language:'ces'},channels:2,channel_layout:'stereo',disposition:{default:1,forced:0}}],chapters:[]});
 const base=()=>({inputFileObj:{_id:source,ffProbeData:metadata()},originalLibraryFile:{_id:source},workDir:cacheRoot,ffmpegPath:'/usr/bin/ffmpeg',job:{jobId:'synthetic-job'},variables:{inFlow:{}},userVariables:{library:{tvSourceRoot:sourceRoot,tvReviewRoot:reviewRoot,tvCacheRoot:cacheRoot}}});
 try{
  await fs.mkdir(path.dirname(source),{recursive:true});await fs.mkdir(cacheRoot,{recursive:true});await fs.writeFile(source,'source bytes');
  const aliased=base();aliased.userVariables.library.tvReviewRoot=sourceRoot;
  assert.equal((await helper(aliased)).outputNumber,2,'source and review roots must not alias');
  const hdr=base();hdr.inputFileObj.ffProbeData=metadata({color_transfer:'smpte2084',color_primaries:'bt2020'});
  assert.equal((await helper(hdr)).outputNumber,2,'HDR must be routed to manual handling');
  const unknown=base();unknown.inputFileObj.ffProbeData=metadata({color_transfer:undefined});
  assert.equal((await helper(unknown)).outputNumber,2,'unknown color metadata must not pass as SDR');
  const contradictoryDepth=base();contradictoryDepth.inputFileObj.ffProbeData=metadata({bits_per_raw_sample:'10'});
  assert.equal((await helper(contradictoryDepth)).outputNumber,2,'an explicit non-8-bit depth must fail even when pix_fmt looks 8-bit');

  const noJob=base(),preflight=await helper(noJob);assert.equal(preflight.outputNumber,1);noJob.variables=preflight.variables;
  await fs.writeFile(working,'encoded bytes');noJob.job={};
  noJob.inputFileObj={_id:working,ffProbeData:{...noJob.inputFileObj.ffProbeData,streams:[{...noJob.inputFileObj.ffProbeData.streams[0],codec_name:'hevc'},...noJob.inputFileObj.ffProbeData.streams.slice(1)]}};
  let decoderCalls=0;
  const fakeSpawn=()=>{decoderCalls++;const child=new EventEmitter();child.stderr=new EventEmitter();child.pid=process.pid;queueMicrotask(()=>child.emit('close',0));return child;};
  assert.equal((await helper(noJob,{spawnChild:fakeSpawn})).outputNumber,2,'a receipt requires the actual current job ID');
  assert.equal(decoderCalls,0,'missing job evidence must stop before decoding or staging');
  await assert.rejects(fs.stat(output),{code:'ENOENT'});

  const linked=base(),linkedPreflight=await helper(linked);assert.equal(linkedPreflight.outputNumber,1);linked.variables=linkedPreflight.variables;
  await fs.writeFile(working,'second encoded bytes');
  await fs.mkdir(path.dirname(output),{recursive:true});await fs.symlink(source,output);
  linked.inputFileObj={_id:working,ffProbeData:{...linked.inputFileObj.ffProbeData,streams:[{...linked.inputFileObj.ffProbeData.streams[0],codec_name:'hevc'},...linked.inputFileObj.ffProbeData.streams.slice(1)]}};
  assert.equal((await helper(linked,{spawnChild:fakeSpawn})).outputNumber,2,'a destination link must never replace or follow a source file');
  assert.equal(await fs.readFile(source,'utf8'),'source bytes');
  await assert.rejects(fs.readFile(`${output}.tdarr-receipt.json`),{code:'ENOENT'});
  await fs.unlink(output);

  const badDecode=base(),badPreflight=await helper(badDecode);assert.equal(badPreflight.outputNumber,1);badDecode.variables=badPreflight.variables;
  await fs.writeFile(working,'corrupt encoded bytes');
  badDecode.inputFileObj={_id:working,ffProbeData:{...badDecode.inputFileObj.ffProbeData,streams:[{...badDecode.inputFileObj.ffProbeData.streams[0],codec_name:'hevc'},...badDecode.inputFileObj.ffProbeData.streams.slice(1)]}};
  const failedSpawn=()=>{const child=new EventEmitter();child.stderr=new EventEmitter();child.pid=process.pid;queueMicrotask(()=>child.emit('close',1));return child;};
  assert.equal((await helper(badDecode,{spawnChild:failedSpawn})).outputNumber,2,'decoder errors must never stage a result or receipt');
  await assert.rejects(fs.stat(output),{code:'ENOENT'});
  const stderrSpawn=()=>{const child=new EventEmitter();child.stderr=new EventEmitter();child.pid=process.pid;queueMicrotask(()=>{child.stderr.emit('data',Buffer.from('synthetic decoder error'));child.emit('close',0);});return child;};
  assert.equal((await helper(badDecode,{spawnChild:stderrSpawn})).outputNumber,2,'any decoder error output must fail even with exit code zero');
  await assert.rejects(fs.stat(output),{code:'ENOENT'});
 }finally{await fs.rm(temp,{recursive:true,force:true});}
});

test('TV source resolution refuses an internal symlinked parent',async()=>{
 const helper=(await import(`${pathToFileURL(path.join(root,'templates/tdarr/tv-flow-helper.cjs')).href}?parents=${Date.now()}`)).default;
 const temp=await fs.mkdtemp(path.join(await fs.realpath(path.join(root,'..')),'tv-flow-parent-'));
 const sourceRoot=path.join(temp,'source'),reviewRoot=path.join(temp,'review'),cacheRoot=path.join(reviewRoot,'.cache'),outside=path.join(temp,'outside');
 const relative='Series/Season 01/Episode.mkv',source=path.join(sourceRoot,relative),target=path.join(outside,'Season 01','Episode.mkv');
 try{
  await fs.mkdir(path.dirname(target),{recursive:true});await fs.mkdir(sourceRoot,{recursive:true});await fs.mkdir(reviewRoot,{recursive:true});await fs.mkdir(cacheRoot,{recursive:true});
  await fs.writeFile(target,'external synthetic source');await fs.symlink(outside,path.join(sourceRoot,'Series'));
  const args={inputFileObj:{_id:source,ffProbeData:{}},originalLibraryFile:{_id:source},workDir:cacheRoot,job:{jobId:'synthetic'},userVariables:{library:{tvSourceRoot:sourceRoot,tvReviewRoot:reviewRoot,tvCacheRoot:cacheRoot}},variables:{inFlow:{}}};
  assert.equal((await helper(args)).outputNumber,2);
  assert.equal(await fs.readFile(target,'utf8'),'external synthetic source');
 }finally{await fs.rm(temp,{recursive:true,force:true});}
});
