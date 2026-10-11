const hdr=require('./hdr10.cjs');
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
async function command(exe,args,log=()=>{}){
 return new Promise((resolve,reject)=>{const p=spawn(exe,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';
 const timer=setTimeout(()=>p.kill('SIGKILL'),2*3600000),progress=setInterval(()=>log('HDR processing is running: '+path.basename(exe)),30000);
 p.stdout.on('data',s=>{out=(out+s).slice(-100000)});p.stderr.on('data',s=>{err=(err+s).slice(-8000)});
 p.on('error',e=>{clearTimeout(timer);clearInterval(progress);reject(e)});p.on('close',c=>{clearTimeout(timer);clearInterval(progress);c===0?resolve(out):reject(Error('HDR tool failed '+c+': '+err))});
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
async function videoHash(ff,file,log){const text=await command(ff,['-v','error','-i',file,'-map','0:v:0','-c:v','copy','-f','hash','-hash','sha256','-'],log);const m=text.match(/SHA256=([a-f0-9]{64})/i);if(!m)throw Error('Video hash missing');return m[1]}
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
