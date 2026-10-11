const {execFile}=require('node:child_process');
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
