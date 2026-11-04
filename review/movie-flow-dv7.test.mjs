import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Module} from 'node:module';
import {fileURLToPath} from 'node:url';

// The movie flow's HDRextraPost node (DV7 -> DV 8.1 branch) against stub ffmpeg/ffprobe/dovi_tool/mkvmerge.
// The stubs record every call. A file written by mkvmerge that also carries the encoded file's audio gets one
// DTS packet 3 ms earlier, as mkvmerge 102.0 did on LOTR The Two Towers (it recomputes audio timestamps from its
// own sample clock); ffmpeg stream copy keeps every timestamp.
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const codeFile=path.join(repo,'templates/tdarr/movie-flow/HDRextraPost.cjs');
const linux={skip:process.platform==='linux'?false:'Requires executable stub tools (shebang scripts)',timeout:120000};

const stub=String.raw`
const fs=require('fs'),path=require('path');
const [name,...args]=process.argv.slice(2),cfg=JSON.parse(fs.readFileSync(process.env.STUB_CONFIG,'utf8'));
fs.appendFileSync(cfg.log,JSON.stringify([name,args])+'\n');
const has=x=>args.includes(x),after=x=>args[args.indexOf(x)+1],out=s=>process.stdout.write(s);
const marker=file=>{try{return fs.readFileSync(file,'utf8').split('\n')[0]}catch{return ''}};
const audio=[[1,1000],[2,333]],streams=[{index:0,codec_type:'video'},{index:1,codec_type:'audio'},{index:2,codec_type:'audio'},{index:3,codec_type:'subtitle'}];
function framemd5(file){
 const kind=marker(file);let s='#tb 0: 1/1000\n#tb 1: 1/1000\n#tb 2: 1/1000\n';
 for(const [k,[,step]] of audio.entries())for(let j=0;j<40;j++){let t=j*step+(j%3);if(kind==='mkvmerge-all'&&k===0&&j===7)t-=3;if(kind==='ffmpeg-shift'&&k===1&&j===5)t+=3;s+=k+', '+t+', '+t+', '+step+', 100, md5'+k+'x'+j+'\n'}
 for(let j=0;j<4;j++)s+='2, '+(j*5000)+', '+(j*5000)+', 2000, 20, sub'+j+'\n';
 return s;
}
if(name==='ffprobe'){
 if(has('stream=nb_read_packets'))out(cfg.frames+'\n');
 else if(has('packet=pts_time')&&after('-select_streams')==='v:0'){
  // Decode order differs from presentation order, as with B-frames; the node sorts. CRLF as on Windows nodes.
  const n=cfg.frames,pts=Array.from({length:n},(_,i)=>i*1001/24000);for(let i=1;i+1<n;i+=4)[pts[i],pts[i+1]]=[pts[i+1],pts[i]];
  out(pts.map(x=>x.toFixed(6)+',').join('\r\n')+'\r\n')}
 else if(has('stream=index,codec_type'))out(JSON.stringify({streams}));
 else process.exit(9);
}else if(name==='ffmpeg'){
 if(has('framemd5'))out(framemd5(after('-i')));
 else if(has('hevc')&&args[args.length-1]==='-')out('hevc-'+path.basename(after('-i')));
 else if(has('hevc'))fs.writeFileSync(args[args.length-1],'annexb\n');
 else if(has('1:a?'))fs.writeFileSync(args[args.length-1],(cfg.shiftCopy?'ffmpeg-shift':'ffmpeg-copy')+'\n'+marker(args[args.indexOf('-i')+1])+'\n');
 else process.exit(9);
}else if(name==='dovi_tool'){
 if(has('extract-rpu')){fs.readFileSync(0);fs.writeFileSync(after('-o'),'RPU 8.1 x'+cfg.frames)}
 else if(has('info'))out('Summary:\n  Frames: '+cfg.frames+'\n  Profile: 8\n');
 else if(has('inject-rpu'))fs.writeFileSync(after('-o'),'injected\n');
 else process.exit(9);
}else if(name==='mkvmerge'){
 fs.writeFileSync(after('-o'),(has('--no-video')?'mkvmerge-all':'mkvmerge-video')+'\n');
}else process.exit(9);
`;

async function setup(t,{frames=340000,shiftCopy=false,code}={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'movie-flow-dv7-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const bin=path.join(dir,'bin'),log=path.join(dir,'calls.jsonl'),config=path.join(dir,'stub.json');await fs.mkdir(bin);
 await fs.writeFile(path.join(bin,'stub.cjs'),stub);await fs.writeFile(config,JSON.stringify({frames,shiftCopy,log}));
 for(const name of ['ffmpeg','ffprobe','dovi_tool','mkvmerge']){const file=path.join(bin,name);await fs.writeFile(file,'#!/bin/sh\nexec "'+process.execPath+'" "'+path.join(bin,'stub.cjs')+'" '+name+' "$@"\n');await fs.chmod(file,0o755)}
 const source=path.join(dir,'source.mkv'),encoded=path.join(dir,'work','encoded.mkv');await fs.mkdir(path.dirname(encoded));
 await fs.writeFile(source,'dv7 source\n');await fs.writeFile(encoded,'ffmpeg-encode\n');
 const st=await fs.stat(source),logLines=[];
 const m=new Module(codeFile);m.filename=codeFile;m.paths=Module._nodeModulePaths(repo);m._compile(code??await fs.readFile(codeFile,'utf8'),codeFile);
 const args={inputFileObj:{_id:encoded},ffmpegPath:path.join(bin,'ffmpeg'),jobLog:s=>logLines.push(String(s)),
  variables:{user:{dv7to81:{path:source,size:st.size,mtime:st.mtimeMs,tool:path.join(bin,'dovi_tool'),mkvmerge:path.join(bin,'mkvmerge')}}}};
 const prev=process.env.STUB_CONFIG;process.env.STUB_CONFIG=config;t.after(()=>{if(prev===undefined)delete process.env.STUB_CONFIG;else process.env.STUB_CONFIG=prev});
 const calls=async()=>(await fs.readFile(log,'utf8')).trim().split('\n').map(l=>JSON.parse(l));
 return {run:()=>m.exports(args),args,calls,logLines,encoded};
}

test('DV7 to 8.1 restore keeps every audio and subtitle timestamp of a feature-length encode',linux,async t=>{
 const s=await setup(t);
 const result=await s.run();
 assert.equal(result.outputNumber,1);
 assert.equal(path.basename(result.outputFileObj._id),'encoded.mkv');assert.match(result.outputFileObj._id,/\/dv7to81-[^/]+\/encoded\.mkv$/);
 assert.equal((await fs.readFile(result.outputFileObj._id,'utf8')).split('\n')[0],'ffmpeg-copy');
 assert.ok(s.logLines.some(l=>/^DV7 -> 8\.1 restored: 340000 RPU SHA256 [0-9a-f]{64}; 84 audio\/subtitle packets unchanged \(0 timestamps within 1 ms\)$/.test(l)),s.logLines.join('\n'));
 assert.equal(s.args.variables.user.dv7to81.restored,true);
 const calls=await s.calls(),mkv=calls.filter(([n])=>n==='mkvmerge');
 assert.equal(mkv.length,1);
 // mkvmerge sees only the injected video and the encoded video's timestamps, never the encoded file's audio.
 assert.ok(!mkv[0][1].includes('--no-video')&&!mkv[0][1].includes(s.encoded),JSON.stringify(mkv[0][1]));
 const ts=mkv[0][1][mkv[0][1].indexOf('--timestamps')+1];assert.match(ts,/^0:.*video-timestamps\.txt$/);
 const mux=calls.find(([n,a])=>n==='ffmpeg'&&a.includes('1:a?'))[1];
 for(const x of ['0:v:0','1:a?','1:s?','1:t?'])assert.ok(mux.includes(x),x);
 assert.deepEqual(mux.slice(mux.indexOf('-c'),mux.indexOf('-c')+2),['-c','copy']);
 const tags=[];for(let i=0;i<mux.length;i++)if(/^-map_metadata:s:\d+$/.test(mux[i]))tags.push(mux[i]+'='+mux[i+1]);
 assert.deepEqual(tags,['-map_metadata:s:0=1:s:0','-map_metadata:s:1=1:s:1','-map_metadata:s:2=1:s:2','-map_metadata:s:3=1:s:3']);
 assert.deepEqual(mux.slice(mux.indexOf('-map_chapters'),mux.indexOf('-map_chapters')+2),['-map_chapters','1']);
 // Temporary files are removed; only the restored result remains in the diagnostic directory.
 assert.deepEqual(await fs.readdir(path.dirname(result.outputFileObj._id)),['encoded.mkv']);
});

test('a restore that moves an audio timestamp names the stream, packet and both times',linux,async t=>{
 const s=await setup(t,{frames:2159,shiftCopy:true});
 await assert.rejects(s.run(),{message:'Audio or subtitle timing changed during restore (stream 1, packet 5: 1667 -> 1670 ms)'});
 assert.ok(s.logLines.some(l=>l.startsWith('DV7 -> 8.1 failed; original retained. Diagnostic files: ')));
});

test('the previous restore, which let mkvmerge remux the audio, is refused by the timing proof',linux,async t=>{
 // Guards the stub: mkvmerge's retiming must be visible to the 6/6 proof, or the first test proves nothing.
 const current=await fs.readFile(codeFile,'utf8');
 const start=current.indexOf("  const ts=path.join(dir,'video-timestamps.txt'),video="),end=current.indexOf("  log('DV7 -> 8.1 5/6");
 assert.ok(start>0&&end>start);
 const old=current.slice(0,start)+"  const ts=path.join(dir,'video-timestamps.txt');if(await stamps(encoded,'v:0',ts)!==n)throw Error('Encoded video timestamps unavailable');\n"+
  "  await ex.command(d7.mkvmerge,['-o',out,'--timestamps','0:'+ts,injected,'--no-video',encoded],log);await fs.unlink(injected);await fs.unlink(ts);\n"+current.slice(end);
 const s=await setup(t,{frames:2159,code:old});
 await assert.rejects(s.run(),{message:'Audio or subtitle timing changed during restore (stream 0, packet 7: 7001 -> 6998 ms)'});
});
