export function guidedExcerptTimes(duration,chosen){
 if(!Number.isFinite(duration)||duration<12)throw Error('Film je příliš krátký pro tři řízené ukázky. Použij vlastní přehrávač.');
 const end=duration-12;
 if(chosen!==undefined){if(!Array.isArray(chosen)||chosen.length!==3||chosen.some(x=>!Number.isFinite(x)||x<0||x>end)||!(chosen[0]<chosen[1]&&chosen[1]<chosen[2]))throw Error('Neplatný úsek řízeného porovnání.');return [...chosen]}
 const lastMillisecond=Math.floor(end*1000+1e-9);
 if(lastMillisecond<2)throw Error('Film je příliš krátký pro tři řízené ukázky. Použij vlastní přehrávač.');
 const positions=[.02,.5,.95].map(r=>Math.round(lastMillisecond*r));
 for(let i=1;i<positions.length;i++)if(positions[i]<=positions[i-1])positions[i]=positions[i-1]+1;
 if(positions[2]>lastMillisecond){positions[2]=lastMillisecond;positions[1]=Math.min(positions[1],lastMillisecond-1);positions[0]=Math.min(positions[0],lastMillisecond-2)}
 return positions.map(milliseconds=>milliseconds/1000);
}
export function decodeGuidedPCM(packet){
 if(!packet||packet.sampleRate!==48000||!Number.isSafeInteger(packet.frames)||packet.frames<1||packet.frames>576000||typeof packet.pcm!=='string'||packet.pcm.length>3072000)throw Error('Neplatný poslechový úsek.');
 const raw=atob(packet.pcm);if(raw.length!==packet.frames*4)throw Error('Neplatný poslechový úsek.');
 const bytes=Uint8Array.from(raw,x=>x.charCodeAt(0)),view=new DataView(bytes.buffer),out=new Float32Array(packet.frames);
 for(let i=0;i<out.length;i++){out[i]=view.getFloat32(i*4,true);if(!Number.isFinite(out[i]))throw Error('Neplatné zvukové vzorky.')}
 return out;
}
export async function prepareGuidedExcerpts({times,scope,snapshot,load,current=()=>true,onState=()=>{},cachedOnly=false}){
 const rows=times.map(seconds=>({seconds,status:'waiting'})),clips=[];
 const publish=()=>{if(current())onState(rows.map(row=>({...row})))};
 const check=()=>{if(!current())throw Error('Rozsah porovnání se změnil. Připrav ukázky znovu.')};
 for(let i=0;i<times.length;i++){
  check();rows[i].status='preparing';publish();
  try{
   const request={snapshot,originalIndex:scope.originalIndex,reviewIndex:scope.reviewIndex,seconds:times[i],cachedOnly};
   const audio=await load({...request,mode:'listen'});check();
   if(audio?.pending)throw Error('Ukázka ještě není připravená. Zkus přípravu znovu.');
   const original=decodeGuidedPCM(audio.original),review=decodeGuidedPCM(audio.review);
   const video=await load({...request,mode:'av',previewProfile:'compact'});check();
   if(video?.pending)throw Error('Ukázka ještě není připravená. Zkus přípravu znovu.');
   if(typeof video?.original!=='string'||!video.original||typeof video?.review!=='string'||!video.review)throw Error('Chybí video pro řízené porovnání. Použij vlastní přehrávač.');
   clips.push({seconds:times[i],duration:Math.min(original.length,review.length)/48000,original,review,video});
   rows[i].status='ready';publish();
  }catch(error){if(current()){rows[i].status='error';rows[i].error=error.message;publish()}throw error}
 }
 return clips;
}
