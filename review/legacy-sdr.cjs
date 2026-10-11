const MARKER='tdarr-legacy-sdr-crf21-v1';
const main=p=>(p?.streams||[]).filter(s=>s.codec_type==='video'&&Number(s.disposition?.attached_pic)!==1);
const unknown=v=>!v||['unknown','unspecified','N/A'].includes(v);
const ratio=v=>{const a=String(v||'').split(/[/:]/).map(Number);return a.length===2&&a[1]>0?a[0]/a[1]:NaN};
function eligible(file,p){
 const videos=main(p),v=videos[0];if(!/\.mkv$/i.test(file)||videos.length!==1||!['vc1','mpeg2video'].includes(v.codec_name))return false;
 const fps=ratio(v.avg_frame_rate);
 return v.width===1920&&v.height===1080&&v.pix_fmt==='yuv420p'&&v.field_order==='progressive'
 &&Number.isFinite(fps)&&fps>=23&&fps<=30&&(unknown(v.sample_aspect_ratio)||v.sample_aspect_ratio==='1:1')
 &&(unknown(v.color_transfer)||v.color_transfer==='bt709')&&(unknown(v.color_primaries)||v.color_primaries==='bt709')
 &&(unknown(v.color_space)||v.color_space==='bt709')&&(unknown(v.color_range)||v.color_range==='tv')
 &&!videos.some(s=>(s.side_data_list||[]).some(d=>/stereo|mastering|content light|dovi|hdr/i.test(JSON.stringify(d))))
 &&!/(^|[ ._\/-])(3d|sbs|hsbs|tab|htab|mvc)([ ._\/-]|$)/i.test(file);
}
function compare(source,result){
 if(!eligible('source.mkv',source))throw Error('Legacy source outside supported progressive 1080p SDR scope');
 const a=main(source)[0],videos=main(result),b=videos[0];
 if(videos.length!==1||b.codec_name!=='hevc'||b.pix_fmt!=='yuv420p10le'||b.width!==a.width||b.height!==a.height||b.field_order!=='progressive')throw Error('Legacy output video parameters changed');
 if(result.format?.tags?.TDARR_SDR_PROFILE!==MARKER)throw Error('Legacy output marker missing');
 const af=ratio(a.avg_frame_rate),bf=ratio(b.avg_frame_rate);if(!Number.isFinite(bf)||Math.abs(af-bf)>0.001)throw Error('Legacy frame rate changed');
 if(!unknown(b.sample_aspect_ratio)&&b.sample_aspect_ratio!=='1:1')throw Error('Legacy output aspect ratio changed');
 for(const key of ['color_transfer','color_primaries','color_space','color_range']){
  if(!unknown(a[key])&&a[key]!==b[key])throw Error('Legacy colour metadata changed: '+key);
  if(!unknown(b[key])&&b[key]!== (key==='color_range'?'tv':'bt709'))throw Error('Unexpected legacy output colour metadata: '+key);
 }
 if((b.side_data_list||[]).some(d=>/stereo|mastering|content light|dovi|hdr/i.test(JSON.stringify(d))))throw Error('Unexpected HDR/3D output');
}
module.exports={MARKER,eligible,compare};
