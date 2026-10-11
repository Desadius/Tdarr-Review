// FFmpeg sends key=value records separated by progress=continue/end.
// Chunk boundaries are unrelated to line or record boundaries.
export function ffmpegProgress(duration,update,clock=Date.now){
  let buffer='',record={},lastSeconds=0;
  return chunk=>{
    buffer+=chunk;
    if(buffer.length>65536)buffer=buffer.slice(-65536);
    const lines=buffer.split('\n');buffer=lines.pop();
    for(const raw of lines){
      const line=raw.trim(),i=line.indexOf('=');if(i<1)continue;
      const key=line.slice(0,i),value=line.slice(i+1);record[key]=value;
      if(key!=='progress')continue;
      let seconds=Number(record.out_time_us)/1e6;
      if(!Number.isFinite(seconds)){
        const m=/^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(record.out_time||'');
        seconds=m?Number(m[1])*3600+Number(m[2])*60+Number(m[3]):lastSeconds;
      }
      seconds=Math.max(lastSeconds,Math.min(duration,Math.max(0,seconds)));lastSeconds=seconds;
      const speed=parseFloat(record.speed),fps=Number(record.fps);
      update({done:seconds,total:duration,unit:'seconds',speed:Number.isFinite(speed)&&speed>0?speed:null,fps:Number.isFinite(fps)?fps:null,updatedAt:clock()});
      record={};
    }
  };
}

export function measure(done,total,started,now=Date.now(),speed=null){
  const elapsed=Math.max(0,(now-started)/1000),bounded=Math.max(0,Math.min(total,done));
  const rate=Number.isFinite(speed)&&speed>0?speed:(elapsed>0?bounded/elapsed:0);
  return {done:bounded,total,percent:total>0?Math.min(99.9,100*bounded/total):null,
    rate:rate>0?rate:null,etaSeconds:elapsed>=5&&bounded>0&&rate>0?Math.max(0,(total-bounded)/rate):null};
}
