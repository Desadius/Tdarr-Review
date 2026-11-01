// A Matroska cue warning emitted by input seeking is not a decoder failure.
// Accept it only after successful exit and separately validated complete output.
const MATROSKA_CUE=/^\[matroska,webm @ 0x[0-9a-f]+\] File is broken, keyframes not correctly marked!\s*$/i;
// After an input seek into a Dolby Vision profile 7 dual-layer stream, FFmpeg 7.1 reports the enhancement
// layer's parameter sets; the base layer still decodes every frame (#300). Tolerated only for such a source.
const DV7_EL_PPS=/^\[hevc @ 0x[0-9a-f]+\] PPS changed between slices\.\s*$/;
const REPEAT=/^\s+Last message repeated \d+ times\s*$/;
export function hasDolbyVisionEnhancementLayer(video){
 return (video?.side_data_list||[]).some(s=>s?.side_data_type==='DOVI configuration record'&&Number(s.dv_profile)===7&&Number(s.el_present_flag)===1);
}
export function previewErrors(stderr,{dolbyVisionEnhancementLayer=false}={}){
 if(String(stderr).length>=16384)return 'Příliš mnoho diagnostických zpráv při přípravě náhledu.';
 let tolerated=false;
 return String(stderr).split(/\r?\n/).filter(line=>{
  if(!line.trim())return false;
  // A repeat line belongs to the message before it.
  if(REPEAT.test(line))return !tolerated;
  tolerated=MATROSKA_CUE.test(line)||dolbyVisionEnhancementLayer&&DV7_EL_PPS.test(line);
  return !tolerated;
 }).join('\n');
}
