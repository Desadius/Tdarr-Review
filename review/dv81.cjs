const hdr=require('./hdr10.cjs');
const {spawn}=require('node:child_process');
const crypto=require('node:crypto');
const MARKER='tdarr-dv81-crf21-v1';
function staticProbe(p){
 const copy=JSON.parse(JSON.stringify(p));
 const v=copy.streams?.find(s=>s.codec_type==='video'&&!s.disposition?.attached_pic);
 const d=v?.side_data_list?.find(s=>s.side_data_type==='DOVI configuration record');
 // Profile 8 with compatibility id 1 explicitly identifies the HDR10 base layer.
 // Fill missing VUI only; contradictory values still fail strict HDR validation.
 if(d?.dv_profile===8&&d.dv_bl_signal_compatibility_id===1){
  for(const [k,value] of Object.entries({color_transfer:'smpte2084',color_primaries:'bt2020',color_space:'bt2020nc'}))
   if(!v[k]||['unknown','unspecified'].includes(v[k]))v[k]=value;
 }
 for(const x of [...(copy.streams||[]),...(copy.frames||[])])x.side_data_list=(x.side_data_list||[]).filter(s=>!/dovi|dolby/i.test(s.side_data_type));
 return copy;
}
function signature(p){
 const videos=(p?.streams||[]).filter(s=>s.codec_type==='video'&&!s.disposition?.attached_pic);
 if(videos.length!==1)throw Error('DV81 requires one video');
 const v=videos[0],records=(v.side_data_list||[]).filter(s=>s.side_data_type==='DOVI configuration record');
 const d=records[0];
 if(records.length!==1||d.dv_profile!==8||d.dv_bl_signal_compatibility_id!==1||d.rpu_present_flag!==1||d.el_present_flag!==0||d.bl_present_flag!==1)throw Error('Only Dolby Vision 8.1 BL+RPU without enhancement layer is supported');
 if(v.width!==3840||v.height<1600||v.height>2160||v.height%2)throw Error('DV81 resolution outside scope');
 if(!p.frames?.length||p.frames.some(f=>f.interlaced_frame||!f.side_data_list?.some(s=>s.side_data_type==='Dolby Vision Metadata')))throw Error('DV81 progressive frame metadata missing');
 return {...hdr.signature(staticProbe(p)),profile:8,compatibility:1};
}
function compare(a,b){if(JSON.stringify(signature(a))!==JSON.stringify(signature(b)))throw Error('Dolby Vision profile, static HDR metadata or dimensions changed')}
function params(p){signature(p);return hdr.params(staticProbe(p))+':vbv-maxrate=100000:vbv-bufsize=100000'}
function canonical(x){if(Array.isArray(x))return x.map(canonical);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]));return x}
// Streaming ffprobe JSON frames: bounded memory, including nested DV metadata.
function frameParser(onFrame){
 let started=false,ended=false,depth=0,str=false,esc=false,buf='',prefix='';
 return {write(chunk){for(const ch of chunk){
  if(!started){prefix+=ch;if(prefix.length>128)throw Error('Unexpected ffprobe frames JSON');if(ch==='['){if(!/"frames"\s*:\s*\[$/.test(prefix))throw Error('Missing frames array');started=true}continue}
  if(ended)continue;
  if(!depth){if(ch===']'){ended=true;continue}if(/[\s,]/.test(ch))continue;if(ch!=='{')throw Error('Invalid frame JSON');depth=1;buf='{';continue}
  buf+=ch;if(buf.length>1024*1024)throw Error('Frame metadata too large');
  if(str){if(esc)esc=false;else if(ch==='\\')esc=true;else if(ch==='"')str=false}
  else if(ch==='"')str=true;else if(ch==='{')depth++;else if(ch==='}'&&!--depth){onFrame(JSON.parse(buf));buf=''}
 }},end(){if(!ended||depth)throw Error('Incomplete ffprobe frames JSON')}};
}
async function digest(exe,file,log=()=>{},duration=0,fps=0){
 const fs=require('node:fs/promises');const before=await fs.stat(file);
 const result=await new Promise((resolve,reject)=>{
  const child=spawn(exe,['-v','error','-threads','2','-select_streams','v:0','-show_frames','-show_entries','frame=best_effort_timestamp_time:frame_side_data','-of','json',file],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  const hash=crypto.createHash('sha256');let count=0,first,last=-Infinity,stderr='',failure;
  const parser=frameParser(frame=>{const t=Number(frame.best_effort_timestamp_time),dv=(frame.side_data_list||[]).filter(s=>s.side_data_type==='Dolby Vision Metadata');
   if(!Number.isFinite(t)||t<=last||dv.length!==1)throw Error('Missing, repeated or unordered Dolby Vision frame metadata');
   first??=t;if(fps>0&&Math.abs((t-first)-Math.round((t-first)*fps)/fps)>0.002)throw Error('DV frame timing outside supported time base');last=t;hash.update(JSON.stringify([fps>0?Math.round((t-first)*fps):count,canonical(dv[0])])+'\n');count++;
  });
  const fail=e=>{failure??=e;child.kill('SIGKILL')};
  const timer=setTimeout(()=>fail(Error('DV metadata verification exceeded 12 hours')),12*3600000);
  const progress=setInterval(()=>log(`DV metadata verification: ${count} frames, ${Math.max(0,last).toFixed(1)}s`+(duration>0?` / ${duration.toFixed(1)}s (${Math.min(100,100*Math.max(0,last)/duration).toFixed(1)}%)`:'')),30000);
  child.stdout.setEncoding('utf8');child.stdout.on('data',s=>{try{parser.write(s)}catch(e){fail(e)}});child.stderr.on('data',s=>{stderr=(stderr+s).slice(-4000)});
  child.on('error',e=>{clearTimeout(timer);clearInterval(progress);reject(e)});
  child.on('close',code=>{clearTimeout(timer);clearInterval(progress);try{if(failure)throw failure;if(code||stderr.trim())throw Error('DV metadata probe failed: '+stderr);parser.end();if(!count)throw Error('No DV frames');resolve({count,first,last,sha256:hash.digest('hex')})}catch(e){reject(e)}});
 });
 const after=await fs.stat(file);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ino!==after.ino)throw Error('File changed during Dolby Vision verification');
 return result;
}
function compareDigests(a,b){if(a.count!==b.count||Math.abs(a.first-b.first)>0.002||Math.abs(a.last-b.last)>0.002||a.sha256!==b.sha256)throw Error('Dolby Vision metadata or frame timing changed; output will not be installed')}
module.exports={MARKER,signature,compare,params,frameParser,digest,compareDigests};
