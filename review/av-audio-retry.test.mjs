import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {canRetryAudioInitialization,withPreviewSeekRetry,AUDIO_PREROLLS} from './av-preview.mjs';
import {createPreviewRenderer} from './preview-render.mjs';

// Seek-induced audio initialization failure (#183): the exact FFmpeg 7.1.4 cascade from the
// real extraction reproduction (tools/test-dts-seek-repro.mjs), pointer values replaced.
const cascade=index=>[`[graph_0_in_0:${index} @ 0x55d1c0a2b340] Changing audio frame properties on the fly is not supported.`,'[fc#0 @ 0x55d1c0a29e00] Error reinitializing filters!','[fc#0 @ 0x55d1c0a29e00] Task finished with error code: -22 (Invalid argument)','[fc#0 @ 0x55d1c0a29e00] Terminating thread with return code -22 (Invalid argument)','[vost#0:0/libx264 @ 0x55d1c0a31b00] Could not open encoder before EOF','[vost#0:0/libx264 @ 0x55d1c0a31b00] Task finished with error code: -22 (Invalid argument)','[vost#0:0/libx264 @ 0x55d1c0a31b00] Terminating thread with return code -22 (Invalid argument)','[aost#0:1/aac @ 0x55d1c0a33c80] Could not open encoder before EOF','[aost#0:1/aac @ 0x55d1c0a33c80] Task finished with error code: -22 (Invalid argument)','[aost#0:1/aac @ 0x55d1c0a33c80] Terminating thread with return code -22 (Invalid argument)','[out#0/mp4 @ 0x55d1c0a2c000] Nothing was written into output file, because at least one of its streams received no packets.'].join('\n')+'\n';
const failure=(diagnostics,code=234)=>Object.assign(Error('Nelze připravit náhled: '+diagnostics),{previewDiagnostics:diagnostics,previewExitCode:code});
const context={seconds:2657,index:1,video:{index:0,codec_name:'hevc'}};

test('only the exact audio initialization cascade of the selected stream qualifies, for any video codec',()=>{
 for(const codec of ['hevc','h264'])assert.equal(canRetryAudioInitialization(failure(cascade(1)),{...context,video:{codec_name:codec}}),true,codec);
 assert.equal(canRetryAudioInitialization(failure(cascade(2)),{...context,index:2}),true);
 const lines=cascade(1).trim().split('\n');
 const rejected={
  'another stream':[failure(cascade(2)),context],
  'exit 0':[failure(cascade(1),0),context],'exit 1':[failure(cascade(1),1),context],'killed':[failure(cascade(1),null),context],
  'trigger not first':[failure([lines[1],lines[0],...lines.slice(2)].join('\n')),context],
  'no filter reinitialization':[failure(lines.filter(line=>!/reinitializing/.test(line)).join('\n')),context],
  'reinitialization alone':[failure(lines[1]),context],
  'real in-window decoding error':[failure(cascade(1)+'[dca @ 0x55d1c0a2b340] Invalid frame header\n'),context],
  'other encoder':[failure(cascade(1).replace('vost#0:0/libx264','vost#0:0/libx265')),context],
  'permission denied':[failure(cascade(1)+'/media/x.mkv: Permission denied\n'),context],
  'truncated diagnostics':[failure(cascade(1).repeat(20)),context],
  'timeout':[Error('Příprava náhledu překročila 90 sekund.'),context],
  'aborted':[failure(cascade(1)),{...context,signal:{aborted:true}}],
  'no stream':[failure(cascade(1)),{...context,index:undefined}],
 };
 for(const [name,[error,ctx]] of Object.entries(rejected))assert.equal(canRetryAudioInitialization(error,ctx),false,name);
});

test('the audio failure retries at 30 then 60 seconds of preroll, validating the recovered output once',async()=>{
 assert.deepEqual(AUDIO_PREROLLS,[30,60]);
 const attempts=[],validated=[];
 assert.equal(await withPreviewSeekRetry(async preroll=>{attempts.push(preroll);if(preroll<60)throw failure(cascade(1));return 'mp4'},{...context,recovered:async data=>{validated.push(data);return data+' validated'}}),'mp4 validated');
 assert.deepEqual(attempts,[2,30,60]);assert.deepEqual(validated,['mp4']);
 const first=[];assert.equal(await withPreviewSeekRetry(async preroll=>{first.push(preroll);if(preroll===2)throw failure(cascade(1));return 'mp4'},{...context,recovered:async()=>'checked'}),'checked');assert.deepEqual(first,[2,30]);
 const plain=[];assert.equal(await withPreviewSeekRetry(async preroll=>{plain.push(preroll);return 'mp4'},{...context,recovered:async()=>assert.fail('an ordinary sample is not a recovery')}),'mp4');assert.deepEqual(plain,[2]);
});

test('exhausted, unrelated, invalid, cancelled or impossible retries stop without readiness',async()=>{
 const run=async(ctx,behaviour)=>{const attempts=[];let result,error;try{result=await withPreviewSeekRetry(async preroll=>{attempts.push(preroll);return behaviour(preroll)},ctx)}catch(e){error=e}return {attempts,result,error}};
 const exhausted=await run(context,()=>{throw failure(cascade(1))});
 assert.deepEqual(exhausted.attempts,[2,30,60]);assert.equal(exhausted.error.previewFallback,'external');assert.match(exhausted.error.message,/30 a 60 s/);assert.match(exhausted.error.previewDiagnostics,/Changing audio frame properties/);
 const other=await run(context,preroll=>{throw preroll===2?failure(cascade(1)):failure('[dca @ 0x1] Invalid frame header\n',1)});
 assert.deepEqual(other.attempts,[2,30]);assert.equal(other.error.previewFallback,undefined,'an unrelated failure is reported as itself');
 const invalid=await run({...context,recovered:async()=>{throw Error('Neúplný zvukový úsek.')}},preroll=>{if(preroll===2)throw failure(cascade(1));return 'short mp4'});
 assert.deepEqual(invalid.attempts,[2,30]);assert.equal(invalid.error.message,'Neúplný zvukový úsek.');
 const controller=new AbortController();
 const cancelled=await run({...context,signal:controller.signal},()=>{controller.abort();throw failure(cascade(1))});
 assert.deepEqual(cancelled.attempts,[2]);assert.equal(cancelled.error.previewFallback,undefined,'a cancelled request is not a recovery result');
 const late=await run({...context,deadline:Date.now()-1},()=>{throw failure(cascade(1))});
 assert.deepEqual(late.attempts,[2]);assert.match(late.error.message,/180 sekund/);assert.equal(late.error.previewFallback,'external');
 // Near the start of the film earlier seeks collapse to 0: never repeat the same seek.
 assert.deepEqual((await run({...context,seconds:20},()=>{throw failure(cascade(1))})).attempts,[2,30]);
 assert.deepEqual((await run({...context,seconds:1},()=>{throw failure(cascade(1))})).attempts,[2]);
});

// A fake FFmpeg on PATH-free absolute path: it logs each run and fails with the cascade after a delay.
// Each attempt also records when it finished on its own (a killed attempt never does), for the
// timeline a failing deadline test prints (#255).
async function fakeFfmpeg(root,{delayMs}){
 const log=path.join(root,'runs.jsonl'),done=path.join(root,'done.jsonl'),exe=path.join(root,'ffmpeg');
 await fs.writeFile(exe,`#!${process.execPath}
const fs=require('node:fs');const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({pid:process.pid,ss:args[args.indexOf('-ss')+1],file:args[args.indexOf('-i')+1],at:Date.now()})+'\\n');
setTimeout(()=>{fs.appendFileSync(${JSON.stringify(done)},JSON.stringify({pid:process.pid,at:Date.now()})+'\\n');process.stderr.write(${JSON.stringify(cascade(1))});process.exit(234)},${delayMs});
`,{mode:0o755});
 const lines=async file=>(await fs.readFile(file,'utf8').catch(()=>'')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
 return {exe,runs:()=>lines(log),done:()=>lines(done)};
}
// A fake FFmpeg with a plan per input: extraction attempts fail with the cascade or emit an MP4
// stand-in; validation runs (input pipe:0) report a complete 12-second sample.
async function plannedFfmpeg(root,plan){
 const log=path.join(root,'runs.jsonl'),exe=path.join(root,'ffmpeg-planned');
 await fs.writeFile(exe,`#!${process.execPath}
const fs=require('node:fs');const args=process.argv.slice(2),input=args[args.indexOf('-i')+1],plan=${JSON.stringify(plan)};
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({pid:process.pid,ss:args[args.indexOf('-ss')+1],file:input,at:Date.now()})+'\\n');
if(input==='pipe:0'){process.stdin.resume();process.stdin.on('end',()=>{
 if(args.includes('framecrc'))process.stdout.write('#tb 0: 1/12288\\n#tb 1: 1/48000\\n0, 0, '+plan.videoStart+', 512, 1, 0x1\\n1, 0, '+plan.audioStart+', 1024, 1, 0x1\\n');
 else if(args.includes('-progress'))process.stdout.write('frame=288\\nout_time_us=12000000\\nprogress=end\\n');
 else process.stdout.write(Buffer.alloc(48000*4*12));
});return}
const step=(plan[require('node:path').basename(input)]||{})[args[args.indexOf('-ss')+1]]||{fail:true,delay:0};
setTimeout(()=>{if(step.fail){process.stderr.write(${JSON.stringify(cascade(1))});process.exit(234)}const mp4=Buffer.alloc(64);mp4.write('ftyp',4);process.stdout.write(mp4)},step.delay);
`,{mode:0o755});
 return {exe,runs:async()=>(await fs.readFile(log,'utf8').catch(()=>'')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line))};
}
const alive=pid=>{try{process.kill(pid,0);return true}catch{return false}};
const posix={skip:process.platform==='win32'?'Needs an executable script as FFmpeg':false};
const pair=()=>({a:{path:'/synthetic/original.mkv'},b:{path:'/synthetic/review.mkv'},pa:probe('h264'),pb:probe('hevc')});
const probe=codec=>({format:{duration:'3000',start_time:'0'},streams:[{index:0,codec_type:'video',codec_name:codec,avg_frame_rate:'24/1',color_transfer:'bt709'},{index:1,codec_type:'audio',codec_name:'dts',channels:6}]});
const request={mode:'av',seconds:2657,originalIndex:1,reviewIndex:1,profile:'compact'};

test('both sides share one AV pair deadline; exhausted recovery names its side and offers the external player',posix,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'av-audio-retry-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const fake=await fakeFfmpeg(root,{delayMs:50});
 const render=createPreviewRenderer({getPair:async()=>pair(),getConfig:()=>({ffmpeg:fake.exe}),pairMs:10000});
 await assert.rejects(render(request),error=>{assert.match(error.message,/^Originál: Zvuk vybrané stopy nešlo po přetočení připravit ani s dřívějším začátkem dekódování \(30 a 60 s\)\. Posuď film ve vlastním přehrávači\.$/);assert.equal(error.previewFallback,'external');return true});
 assert.deepEqual((await fake.runs()).map(run=>[path.basename(run.file),run.ss]),[['original.mkv','2655'],['original.mkv','2627'],['original.mkv','2597']],'the Review side is not started after the original is exhausted');
});

test('the pair deadline spans both sides and their attempts; a timed-out attempt is killed and drained',posix,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'av-audio-deadline-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const fake=await fakeFfmpeg(root,{delayMs:600});
 // The deadline is set right after getPair resolves; the timeline below is relative to the test start.
 let pairAt=null;
 const render=createPreviewRenderer({getPair:async()=>{pairAt=Date.now();return {...pair(),pa:{...probe('h264'),streams:probe('h264').streams}}},getConfig:()=>({ffmpeg:fake.exe}),pairMs:1500});
 const started=Date.now();let outcome;
 try{await render(request);outcome={settledAt:Date.now(),resolved:true}}catch(error){outcome={settledAt:Date.now(),message:String(error?.message)}}
 try{
  assert.ok(!outcome.resolved,'the pair must not succeed');
  assert.match(outcome.message,/^Originál: Zvuk vybrané stopy nešlo po přetočení připravit v časovém limitu 180 sekund\. Posuď film ve vlastním přehrávači\.$/);
  const elapsed=outcome.settledAt-started;
  assert.ok(elapsed<1500+800,`the pair stopped near its deadline (${elapsed} ms)`);
  const runs=await fake.runs();assert.ok(runs.length<=3,'no attempt starts after the deadline: '+runs.length);
  for(const run of runs)assert.equal(alive(run.pid),false,'every FFmpeg child is gone');
 }catch(error){
  // Intermittent in the full suite only (#255): attach the observed timeline to the failure.
  const at=time=>time==null?'-':`+${time-started} ms`,done=new Map((await fake.done()).map(entry=>[entry.pid,entry.at]));
  const attempts=(await fake.runs()).map(run=>`  ss ${run.ss}: started ${at(run.at)}, ${done.has(run.pid)?'finished on its own '+at(done.get(run.pid)):'did not finish on its own (killed)'}`);
  const timeline=['','#255 timeline (relative to the test start):',`  getPair resolved (deadline set, due 1500 ms later): ${at(pairAt)}`,...attempts,`  render settled: ${at(outcome.settledAt)}`,`  outcome: ${outcome.resolved?'resolved':JSON.stringify(outcome.message)}`].join('\n');
  // The reporter prints the stack, captured when the error was created, so extend both.
  error.message+=timeline;error.stack=String(error.stack)+timeline;
  throw error;
 }
});

test('cancelling the pair stops the running attempt and starts no further one',posix,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'av-audio-cancel-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const fake=await fakeFfmpeg(root,{delayMs:400});
 const render=createPreviewRenderer({getPair:async()=>pair(),getConfig:()=>({ffmpeg:fake.exe}),pairMs:10000}),controller=new AbortController();
 const pending=render(request,{signal:controller.signal});
 while((await fake.runs()).length<2)await new Promise(resolve=>setTimeout(resolve,20));
 controller.abort();await assert.rejects(pending,error=>error.name==='AbortError');
 await new Promise(resolve=>setTimeout(resolve,600));
 const runs=await fake.runs();assert.deepEqual(runs.map(run=>run.ss),['2655','2627'],'no 60-second attempt after cancellation');
 for(const run of runs)assert.equal(alive(run.pid),false);
});

test('the Review side gets only what remains of the pair deadline after the original recovered',posix,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'av-audio-pair-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const fake=await plannedFfmpeg(root,{videoStart:0,audioStart:0,'original.mkv':{2655:{fail:true,delay:400},2627:{fail:false,delay:400}},'review.mkv':{2655:{fail:true,delay:900},2627:{fail:true,delay:900},2597:{fail:true,delay:900}}});
 const render=createPreviewRenderer({getPair:async()=>pair(),getConfig:()=>({ffmpeg:fake.exe}),pairMs:1500});
 const started=Date.now();
 await assert.rejects(render(request),error=>{assert.equal(error.message,'Příprava náhledu překročila společný časový limit 180 sekund pro originál a výsledek.');return true});
 const elapsed=Date.now()-started,runs=await fake.runs();
 assert.ok(elapsed<1500+500,`the Review side stopped at the shared deadline (${elapsed} ms)`);
 assert.deepEqual(runs.filter(run=>run.file!=='pipe:0').map(run=>[path.basename(run.file),run.ss]),[['original.mkv','2655'],['original.mkv','2627'],['review.mkv','2655']],'the recovered original was validated, then Review had no time for a retry');
 assert.ok(runs.some(run=>run.file==='pipe:0'),'the recovered original was validated');
 for(const run of runs)assert.equal(alive(run.pid),false);
});

test('a recovered sample whose video or audio starts away from the target is rejected',posix,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'av-audio-align-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const steps={'original.mkv':{2655:{fail:true,delay:0},2627:{fail:false,delay:0}}};
 for(const [name,start] of [['aligned',{videoStart:0,audioStart:0}],['audio late',{videoStart:0,audioStart:24000}],['video late',{videoStart:6144,audioStart:0}]]){
  const fake=await plannedFfmpeg(await fs.mkdtemp(path.join(root,'case-')),{...start,...steps});
  const render=createPreviewRenderer({getPair:async()=>pair(),getConfig:()=>({ffmpeg:fake.exe}),pairMs:10000});
  if(name==='aligned'){await assert.rejects(render(request),error=>!/nezačíná/.test(error.message),name);continue}
  await assert.rejects(render(request),/^Error: Obnovený náhled nezačíná u požadovaného času\.$|Obnovený náhled nezačíná/,name);
 }
});
