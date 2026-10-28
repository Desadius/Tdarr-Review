const hdr=require('./hdr10.cjs');
const dv=require('./dv81.cjs');
const hdrExtra=require('./hdr-extra.cjs');
const MARKER='tdarr-dv7to81-crf21-v1';
const withoutDV=p=>{const q=JSON.parse(JSON.stringify(p));for(const x of [...(q.streams||[]),...(q.frames||[])])x.side_data_list=(x.side_data_list||[]).filter(s=>!/dovi|dolby/i.test(s.side_data_type));return q};
// The flow re-encodes the DV7 base layer with x265, drops the enhancement layer and injects the RPU converted to 8.1.
// Review accepts that only from a DV7 dual-layer original to a DV 8.1 result with the same picture size and HDR10 static metadata.
function compare(original,review){
 if(hdrExtra.kind(original)!=='p7')throw Error('DV7 to 8.1 requires a Dolby Vision 7 dual-layer original');
 const out=dv.signature(review),src=hdr.signature(withoutDV(original));
 const pick=x=>JSON.stringify({width:x.width,height:x.height,master:x.master,light:x.light});
 if(pick(src)!==pick(out))throw Error('DV7 to 8.1 changed resolution or HDR10 static metadata');
 return out;
}
module.exports={MARKER,compare};
