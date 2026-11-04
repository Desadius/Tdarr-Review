module.exports=async(args)=>{const sameSourceMtime=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&a>=0&&b>=0&&Math.abs(a-b)<=0.001;
const hdr=(()=>{const module={exports:{}};const {execFile}=require('node:child_process');
const MARKER='tdarr-hdr10-crf21-v1';
async function probeHDR(exe,file){
 const run=args=>new Promise((resolve,reject)=>execFile(exe,args,{windowsHide:true,timeout:120000,maxBuffer:2000000},(e,out)=>{if(e)return reject(e);try{resolve(JSON.parse(out))}catch(e){reject(e)}}));
 return run(['-v','error','-select_streams','v:0','-read_intervals','%+#3','-show_frames','-show_streams','-show_format','-of','json',file]);
}
const rat=x=>{const [a,b=1]=String(x).split('/').map(Number);if(!Number.isFinite(a)||!Number.isFinite(b)||!b)throw Error('Invalid HDR rational');return a/b};
function signature(p){
 const v=p.streams?.filter(s=>s.codec_type==='video'&&Number(s.disposition?.attached_pic)!==1);
 if(v?.length!==1)throw Error('HDR requires exactly one video');
 const s=v[0];if(s.codec_name!=='hevc'||s.pix_fmt!=='yuv420p10le'||s.color_transfer!=='smpte2084'||s.color_primaries!=='bt2020'||s.color_space!=='bt2020nc'||s.color_range!=='tv')throw Error('Unsupported HDR10 colour format');
 const side=[...(s.side_data_list||[]),...(p.frames||[]).flatMap(f=>f.side_data_list||[])];
 if(side.some(x=>/dovi|dolby|2094|hdr10\+|stereo/i.test(x.side_data_type)))throw Error('Dynamic HDR or 3D excluded');
 const masters=side.filter(x=>x.side_data_type==='Mastering display metadata');const lights=side.filter(x=>x.side_data_type==='Content light level metadata');
 if(!masters.length||!lights.length||!p.frames?.length)throw Error('HDR10 static metadata missing');
 const keys=['red_x','red_y','green_x','green_y','blue_x','blue_y','white_point_x','white_point_y','min_luminance','max_luminance'];
 const master=keys.map(k=>rat(masters[0][k]));const light=[Number(lights[0].max_content),Number(lights[0].max_average)];
 if(!light.every(Number.isFinite)||masters.some(m=>keys.some((k,i)=>rat(m[k])!==master[i]))||lights.some(l=>Number(l.max_content)!==light[0]||Number(l.max_average)!==light[1]))throw Error('Inconsistent HDR metadata');
 return {width:s.width,height:s.height,master,light};
}
function compareHDR(a,b){const x=signature(a),y=signature(b);if(JSON.stringify(x)!==JSON.stringify(y))throw Error('HDR10 metadata or dimensions changed');return x}
function params(p){signature(p);const m=p.frames.flatMap(f=>f.side_data_list||[]).find(s=>s.side_data_type==='Mastering display metadata');const c=p.frames.flatMap(f=>f.side_data_list||[]).find(s=>s.side_data_type==='Content light level metadata');const n=(k,mul)=>Math.round(rat(m[k])*mul);return 'hdr10=1:hdr10-opt=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:master-display='+[['G','green'],['B','blue'],['R','red'],['WP','white_point']].map(([l,k])=>`${l}(${n(k+'_x',50000)},${n(k+'_y',50000)})`).join('')+`L(${n('max_luminance',10000)},${n('min_luminance',10000)}):max-cll=${c.max_content},${c.max_average}`}
module.exports={MARKER,probeHDR,signature,compareHDR,params};
;return module.exports;})();const ex=(()=>{const module={exports:{}};
const {spawn}=require('child_process'),fs=require('fs/promises'),path=require('path'),crypto=require('crypto');
const PLUS='tdarr-hdr10plus-crf21-v1',P7='tdarr-dv7-video-copy-v1';
function clean(p,pattern){const q=JSON.parse(JSON.stringify(p));for(const x of [...q.streams,...q.frames])x.side_data_list=(x.side_data_list||[]).filter(s=>!pattern.test(s.side_data_type));return q}
function kind(p){
 const vs=(p.streams||[]).filter(s=>s.codec_type==='video'&&!s.disposition?.attached_pic);if(vs.length!==1)throw Error('Expected one main video');
 const v=vs[0],sides=[...(v.side_data_list||[]),...(p.frames||[]).flatMap(f=>f.side_data_list||[])],d=sides.find(s=>s.side_data_type==='DOVI configuration record');
 if(!p.frames?.length||p.frames.some(f=>f.interlaced_frame))throw Error('Progressive frames required');
 if(d){if(d.dv_profile!==7||d.bl_present_flag!==1||d.el_present_flag!==1||d.rpu_present_flag!==1)throw Error('Not supported DV7 dual layer');hdr.signature(clean(p,/dovi|dolby/i));return 'p7'}
 if(sides.some(s=>/2094|HDR10\+/.test(s.side_data_type))){hdr.signature(clean(p,/2094|HDR10\+/));if(!p.frames.every(f=>f.side_data_list?.some(s=>/2094|HDR10\+/.test(s.side_data_type))))throw Error('HDR10+ frame metadata missing');return 'plus'}
 hdr.signature(p);return 'hdr10';
}
function compare(a,b,type){if(kind(a)!==type||kind(b)!==type)throw Error('HDR profile changed');const pattern=type==='p7'?/dovi|dolby/i:/2094|HDR10\+/;hdr.compareHDR(clean(a,pattern),clean(b,pattern));
 if(type==='p7'){const dv=p=>p.streams[0].side_data_list.find(s=>s.side_data_type==='DOVI configuration record');if(JSON.stringify(dv(a))!==JSON.stringify(dv(b)))throw Error('DV7 layer configuration changed')}
}
function params(p){if(kind(p)!=='plus')throw Error('Not HDR10+');return hdr.params(clean(p,/2094|HDR10\+/))}
// full: return the whole stdout (callers that parse it) and fail above limit; otherwise keep only the tail for diagnostics.
async function command(exe,args,log=()=>{},{full=false,limit=64*1024*1024}={}){
 return new Promise((resolve,reject)=>{const p=spawn(exe,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';
 const timer=setTimeout(()=>p.kill('SIGKILL'),2*3600000),progress=setInterval(()=>log('HDR processing is running: '+path.basename(exe)),30000);
 let overflow=false;p.stdout.setEncoding('utf8');p.stdout.on('data',s=>{if(!full){out=(out+s).slice(-100000);return}if(overflow)return;out+=s;if(out.length>limit){overflow=true;out='';p.kill('SIGKILL')}});p.stderr.on('data',s=>{err=(err+s).slice(-8000)});
 p.on('error',e=>{clearTimeout(timer);clearInterval(progress);reject(e)});p.on('close',c=>{clearTimeout(timer);clearInterval(progress);overflow?reject(Error('HDR tool output exceeds '+limit+' characters: '+path.basename(exe))):c===0?resolve(out):reject(Error('HDR tool failed '+c+': '+err))});
 });
}
async function extract(ff,tool,file,json,log){
 const dest=await fs.open(json,'wx');await dest.close();
 return new Promise((resolve,reject)=>{
  const a=spawn(ff,['-v','error','-i',file,'-map','0:v:0','-c:v','copy','-bsf:v','hevc_mp4toannexb','-f','hevc','-'],{windowsHide:true,stdio:['ignore','pipe','pipe']}),b=spawn(tool,['extract','-','-o',json],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let error='',failure,closed=0;const fail=e=>{failure??=e;a.kill('SIGKILL');b.kill('SIGKILL')};
  const timer=setTimeout(()=>fail(Error('HDR10+ extraction timeout')),2*3600000),progress=setInterval(()=>log('HDR10+ metadata extraction in progress'),30000);
  a.stdout.pipe(b.stdin);b.stdout.resume();b.stdin.on('error',e=>{if(e.code!=='EPIPE')fail(e)});
  for(const p of [a,b]){p.stderr.on('data',s=>error=(error+s).slice(-8000));p.on('error',fail);p.on('close',c=>{if(c!==0)fail(Error('HDR10+ extraction failed '+c+': '+error));if(++closed===2){clearTimeout(timer);clearInterval(progress);failure?reject(failure):resolve()}})}
 });
}
function canonical(x){if(Array.isArray(x))return x.map(canonical);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]));return x}
async function metadata(file){const stat=await fs.stat(file);if(stat.size>512*1024*1024)throw Error('HDR10+ JSON exceeds size limit');const x=JSON.parse(await fs.readFile(file,'utf8'));if(!Array.isArray(x.SceneInfo)||!x.SceneInfo.length)throw Error('Empty HDR10+ metadata');if(x.SceneInfo.some((s,i)=>s.SequenceFrameIndex!==i))throw Error('Missing HDR10+ frame metadata');return {count:x.SceneInfo.length,sha:crypto.createHash('sha256').update(JSON.stringify(canonical({profile:x.JSONInfo,frames:x.SceneInfo}))).digest('hex')}}
async function videoHash(ff,file,log){const text=await command(ff,['-v','error','-i',file,'-map','0:v:0','-c:v','copy','-f','hash','-hash','sha256','-'],log,{full:true});const m=text.match(/SHA256=([a-f0-9]{64})/i);if(!m)throw Error('Video hash missing');return m[1]}
async function restorePlus({ff,tool,source,encoded,fps,log,mkvmerge}){
 const dir=await fs.mkdtemp(path.join(path.dirname(encoded),'hdr10plus-'));
 const json=path.join(dir,'source.json'),raw=path.join(dir,'encoded.hevc'),injected=path.join(dir,'injected.hevc'),out=path.join(dir,path.basename(encoded)),check=path.join(dir,'output.json');
 try{
  log('HDR10+ 1/5: extract original metadata');await extract(ff,tool,source,json,log);const a=await metadata(json);
  log('HDR10+ 2/5: export encoded video');await command(ff,['-v','error','-i',encoded,'-map','0:v:0','-c:v','copy','-bsf:v','hevc_mp4toannexb','-f','hevc','-n',raw],log);
  log('HDR10+ 3/5: inject metadata');await command(tool,['inject',raw,'-j',json,'-o',injected],log);
  log('HDR10+ 4/5: restore MKV, tracks and chapters');await command(mkvmerge,['-o',out,'--default-duration','0:'+fps+'fps',injected,'--no-video',encoded],log);
  log('HDR10+ 5/5: verify every metadata record');await extract(ff,tool,out,check,log);const b=await metadata(check);if(a.count!==b.count||a.sha!==b.sha)throw Error('HDR10+ metadata changed');
  for(const f of [json,raw,injected,check])await fs.unlink(f);log('HDR10+ verified '+a.count+' records SHA256 '+a.sha);return out;
 }catch(e){log('HDR10+ failed; original retained. Diagnostic files: '+dir);throw e}
}
module.exports={PLUS,P7,kind,compare,params,command,extract,metadata,videoHash,restorePlus};
;return module.exports;})();
const dd=args.variables.user?.dv81;if(dd?.dual){const fs=require('fs/promises');const check=async()=>{const s=await fs.stat(dd.path);if(s.size!==dd.size||!sameSourceMtime(s.mtimeMs,dd.mtime))throw Error('Dual HDR source changed')};await check();const output=await ex.restorePlus({ff:args.ffmpegPath,tool:dd.tool,mkvmerge:dd.mkvmerge,source:dd.path,encoded:args.inputFileObj._id,fps:dd.source.streams[0].avg_frame_rate,log:args.jobLog});await check();dd.plusVerified=true;return {outputFileObj:{_id:output.replaceAll(String.fromCharCode(92),'/')},outputNumber:1,variables:args.variables};}
const d7=args.variables.user?.dv7to81;if(d7){
 const fs=require('fs/promises'),path=require('path'),crypto=require('crypto'),{spawn}=require('child_process');
 const ff=args.ffmpegPath,probe=ff.replace(/ffmpeg(\.exe)?$/i,'ffprobe$1'),encoded=args.inputFileObj._id,log=args.jobLog;
 const check=async()=>{const s=await fs.stat(d7.path);if(s.size!==d7.size||!sameSourceMtime(s.mtimeMs,d7.mtime))throw Error('DV7 source changed')};
 // ffmpeg -> dovi_tool pipe, as in HDR10+ extraction; mode 2 converts the P7 RPU to 8.1.
 const rpu=(file,out,mode2)=>new Promise((resolve,reject)=>{
  const a=spawn(ff,['-v','error','-i',file,'-map','0:v:0','-c:v','copy','-bsf:v','hevc_mp4toannexb','-f','hevc','-'],{windowsHide:true,stdio:['ignore','pipe','pipe']}),b=spawn(d7.tool,[...(mode2?['-m','2']:[]),'extract-rpu','-','-o',out],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let error='',failure,closed=0;const fail=e=>{failure??=e;a.kill('SIGKILL');b.kill('SIGKILL')};
  const timer=setTimeout(()=>fail(Error('RPU extraction timeout')),4*3600000),progress=setInterval(()=>log('DV RPU extraction in progress: '+path.basename(file)),30000);
  a.stdout.pipe(b.stdin);b.stdout.resume();b.stdin.on('error',e=>{if(e.code!=='EPIPE')fail(e)});
  for(const p of [a,b]){p.stderr.on('data',s=>error=(error+s).slice(-8000));p.on('error',fail);p.on('close',c=>{if(c!==0)fail(Error('RPU extraction failed '+c+': '+error));if(++closed===2){clearTimeout(timer);clearInterval(progress);failure?reject(failure):resolve()}})}
 });
 const summary=async file=>{const text=await ex.command(d7.tool,['info','-i',file,'--summary'],undefined,{full:true});const m=text.match(/Frames:\s*(\d+)/),p=text.match(/Profile:\s*(\d+)/);if(!m||!p)throw Error('RPU summary unreadable');return {count:Number(m[1]),profile:Number(p[1])}};
 const sha=async file=>{const s=await fs.stat(file);if(s.size>512*1024*1024)throw Error('RPU file exceeds size limit');return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')};
 const frames=async file=>{const n=Number((await ex.command(probe,['-v','error','-select_streams','v:0','-count_packets','-show_entries','stream=nb_read_packets','-of','default=nw=1:nk=1',file],undefined,{full:true})).trim());if(!Number.isInteger(n)||n<1)throw Error('Video frame count unavailable');return n};
 // Per stream: packet order, size, payload MD5 and duration must be identical; pts/dts may differ by at most 1 ms
 // (Matroska 1 ms timebase; ffmpeg and mkvmerge round sub-millisecond TrueHD timestamps differently).
 const tracks=file=>new Promise((resolve,reject)=>{const p=spawn(ff,['-v','error','-i',file,'-map','0:a?','-map','0:s?','-c','copy','-f','framemd5','-'],{windowsHide:true,stdio:['ignore','pipe','pipe']});const s=new Map();let rest='',err='',tb='';
  const line=l=>{if(l.startsWith('#')){if(/^#tb /.test(l))tb+=l+'\n';return}const [i,dts,pts,dur,size,md5]=l.split(/,\s*/);let x=s.get(i);if(!x)s.set(i,x={h:crypto.createHash('sha256'),t:[]});x.h.update([dur,size,md5].join(',')+'\n');x.t.push(Number(dts),Number(pts))};
  p.stdout.setEncoding('utf8');p.stdout.on('data',c=>{const lines=(rest+c).split('\n');rest=lines.pop();for(const l of lines)if(l)line(l)});p.stderr.on('data',c=>err=(err+c).slice(-4000));
  p.on('error',reject);p.on('close',c=>{if(rest)line(rest);if(c!==0||err.trim())return reject(Error('Track hash failed '+c+': '+err));resolve({tb,streams:[...s].map(([i,x])=>({i,packets:x.t.length/2,sha:x.h.digest('hex'),t:Float64Array.from(x.t)}))})})});
 const compareTracks=(a,b)=>{
  if(a.tb!==b.tb||a.streams.length!==b.streams.length)throw Error('Audio or subtitle track layout changed during restore');
  if(!a.tb||a.tb.trim().split('\n').some(l=>!/^#tb \d+: 1\/1000$/.test(l)))throw Error('Audio or subtitle timebase is not 1 ms');
  let packets=0,shifted=0;
  for(const [k,x] of a.streams.entries()){const y=b.streams[k];
   if(x.i!==y.i||x.packets!==y.packets||x.sha!==y.sha)throw Error('Audio or subtitle packets changed during restore (stream '+x.i+')');
   for(let j=0;j<x.t.length;j++){const d=Math.abs(x.t[j]-y.t[j]);if(!(d<=1))throw Error('Audio or subtitle timing changed during restore (stream '+x.i+', packet '+(j>>1)+': '+x.t[j]+' -> '+y.t[j]+' ms)');if(d)shifted++}
   packets+=x.packets}
  return {packets,shifted};
 };
 // One stream's packet pts as a timestamp v2 file (sorted, in ms); returns the packet count.
 const stamps=(file,select,dest)=>new Promise((resolve,reject)=>{const p=spawn(probe,['-v','error','-select_streams',select,'-show_entries','packet=pts_time','-of','csv=p=0',file],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let t=new Float64Array(1<<16),n=0,bad=0,rest='',err='';const add=l=>{l=l.replace(/,/g,'').trim();if(!l)return;const x=Number(l);if(!Number.isFinite(x)){bad++;return}if(n===t.length){const u=new Float64Array(n*2);u.set(t);t=u}t[n++]=x};
  p.stdout.setEncoding('utf8');p.stdout.on('data',s=>{const lines=(rest+s).split('\n');rest=lines.pop();for(const l of lines)add(l)});p.stderr.on('data',s=>err=(err+s).slice(-4000));p.on('error',reject);
  p.on('close',async code=>{try{add(rest);if(code!==0||err.trim())throw Error('Timestamp probe failed '+code+': '+err);if(bad||!n)throw Error('Encoded timestamps unavailable (stream '+select+')');
   const v=t.subarray(0,n).sort(),w=await fs.open(dest,'wx');try{await w.write('# timestamp format v2\n');for(let i=0;i<n;i+=65536){let s='';for(let j=i;j<Math.min(n,i+65536);j++)s+=(v[j]*1000).toFixed(6)+'\n';await w.write(s)}}finally{await w.close()}resolve(n)}catch(e){reject(e)}})});
 await check();const dir=await fs.mkdtemp(path.join(path.dirname(encoded),'dv7to81-'));
 const src=path.join(dir,'source-81.rpu'),raw=path.join(dir,'encoded.hevc'),injected=path.join(dir,'injected.hevc'),out=path.join(dir,path.basename(encoded)),outRpu=path.join(dir,'output.rpu');
 try{
  log('DV7 -> 8.1 1/6: convert original RPU with dovi_tool -m 2');await rpu(d7.path,src,true);const a=await summary(src);
  const n=await frames(encoded);if(a.profile!==8||a.count!==n)throw Error(`RPU/frame mismatch: ${a.count} RPU profile ${a.profile}, ${n} encoded frames`);
  log('DV7 -> 8.1 2/6: export encoded video');await ex.command(ff,['-v','error','-i',encoded,'-map','0:v:0','-c:v','copy','-bsf:v','hevc_mp4toannexb','-f','hevc','-n',raw],log);
  log('DV7 -> 8.1 3/6: inject 8.1 RPU');await ex.command(d7.tool,['inject-rpu','-i',raw,'--rpu-in',src,'-o',injected],log);await fs.unlink(raw);
  log('DV7 -> 8.1 4/6: restore MKV, tracks and chapters');
  // Keep the encoded video's own timestamps (--default-duration would even out a timing gap) and let mkvmerge write
  // only the video: it recomputes audio timestamps from its own clock (DTS moved up to 3 ms and an AC-3 gap was smoothed
  // over 7 packets on LOTR The Two Towers). ffmpeg, which wrote the encoded file, copies audio, subtitles, attachments,
  // chapters and tags from it unchanged.
  const ts=path.join(dir,'video-timestamps.txt'),video=path.join(dir,'video-81.mkv');if(await stamps(encoded,'v:0',ts)!==n)throw Error('Encoded video timestamps unavailable');
  await ex.command(d7.mkvmerge,['-o',video,'--timestamps','0:'+ts,injected],log);await fs.unlink(injected);await fs.unlink(ts);
  // Output streams: the video, then the encoded file's audio, subtitles and attachments in their order. A per-stream
  // -map_metadata turns off ffmpeg's automatic copy, so each output stream takes its own encoded stream's tags.
  const all=JSON.parse(await ex.command(probe,['-v','error','-show_entries','stream=index,codec_type','-of','json',encoded],undefined,{full:true})).streams||[];
  const order=[all.find(s=>s.codec_type==='video'),...['audio','subtitle','attachment'].flatMap(k=>all.filter(s=>s.codec_type===k))];
  if(!order[0])throw Error('Encoded video stream missing');const tags=order.flatMap((s,i)=>['-map_metadata:s:'+i,'1:s:'+s.index]);
  await ex.command(ff,['-v','error','-i',video,'-i',encoded,'-map','0:v:0','-map','1:a?','-map','1:s?','-map','1:t?','-c','copy','-map_metadata','1',...tags,'-map_chapters','1','-n',out],log);await fs.unlink(video);
  log('DV7 -> 8.1 5/6: verify every RPU');await rpu(out,outRpu,false);const b=await summary(outRpu),sa=await sha(src),sb=await sha(outRpu);
  if(b.profile!==8||b.count!==a.count||sa!==sb)throw Error('Dolby Vision 8.1 RPU changed during injection');
  log('DV7 -> 8.1 6/6: verify audio and subtitle packets');const tr=compareTracks(await tracks(encoded),await tracks(out));
  await check();for(const x of [src,outRpu])await fs.unlink(x);const os=await fs.stat(out);
  Object.assign(d7,{rpuCount:a.count,rpuSha256:sa,restored:true,output:{size:os.size,mtime:os.mtimeMs}});log('DV7 -> 8.1 restored: '+a.count+' RPU SHA256 '+sa+'; '+tr.packets+' audio/subtitle packets unchanged ('+tr.shifted+' timestamps within 1 ms)');
  return {outputFileObj:{_id:out.replaceAll(String.fromCharCode(92),'/')},outputNumber:1,variables:args.variables};
 }catch(e){log('DV7 -> 8.1 failed; original retained. Diagnostic files: '+dir);throw e}
}
const d=args.variables.user?.extraHDR;if(!d)return {outputFileObj:args.inputFileObj,outputNumber:1,variables:args.variables};
const fs=require('fs/promises');const check=async()=>{const s=await fs.stat(d.path);if(s.size!==d.size||!sameSourceMtime(s.mtimeMs,d.mtime))throw Error('HDR source changed')};await check();let output=args.inputFileObj._id;
if(d.type==='plus')output=await ex.restorePlus({ff:args.ffmpegPath,tool:d.tool,mkvmerge:d.mkvmerge,source:d.path,encoded:output,fps:d.fps,log:args.jobLog});
const p=await hdr.probeHDR(args.ffmpegPath.replace(/ffmpeg(\.exe)?$/i,'ffprobe$1'),output);ex.compare(d.source,p,d.type);
if(p.format?.tags?.TDARR_HDR_PROFILE!==(d.type==='p7'?ex.P7:ex.PLUS))throw Error('HDR marker missing');
if(d.type==='p7'){args.jobLog('DV7/FEL: comparing complete encoded video bitstream, BL+EL+RPU');const a=await ex.videoHash(args.ffmpegPath,d.path,args.jobLog),b=await ex.videoHash(args.ffmpegPath,output,args.jobLog);if(a!==b)throw Error('DV7/FEL video bitstream changed');args.jobLog('DV7/FEL complete video SHA256 verified: '+a)}
await check();d.verified=true;return {outputFileObj:{_id:output.replaceAll(String.fromCharCode(92),'/')},outputNumber:1,variables:args.variables};};