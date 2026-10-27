// Guided comparison transport. All positions are on the AudioContext clock.
// perExcerpt stops after each excerpt ('done') instead of running all three in one pass.
export function createGuidedPlayer({context,excerpts,sampleRate=48000,perExcerpt=false,onState=()=>{},preparePhase=async()=>{}}) {
  if (!context || !Array.isArray(excerpts) || excerpts.length!==3) throw Error('Three audio excerpts are required.');
  if (!Number.isFinite(sampleRate) || sampleRate<=0) throw Error('Invalid audio sample rate.');
  for (const excerpt of excerpts) {
    const frames=Math.round(excerpt.duration*sampleRate);
    if (!Number.isFinite(excerpt.seconds) || excerpt.seconds<0 || !Number.isFinite(excerpt.duration) || excerpt.duration<=0 ||
        !(excerpt.original instanceof Float32Array) || !(excerpt.review instanceof Float32Array) ||
        excerpt.original.length<frames || excerpt.review.length<frames ||
        excerpt.original.some(sample=>!Number.isFinite(sample)) || excerpt.review.some(sample=>!Number.isFinite(sample))) throw Error('Invalid audio excerpt.');
  }

  const buffers=excerpts.map(excerpt=>({original:buffer(excerpt.original),review:buffer(excerpt.review)}));
  const master=context.createGain();
  master.connect(context.destination);
  const listeners=new Set();
  let status='idle',error=null,excerptIndex=0,phaseIndex=0,position=0;
  let volume=.5,muted=false,routing='ears',swapEars=false,listen='original';
  let startTime=0,startPosition=0,handles=[],generation=0,destroyed=false,desiredPlaying=false;
  updateVolume();

  function buffer(samples) {
    const result=context.createBuffer(1,samples.length,sampleRate);
    result.getChannelData(0).set(samples);
    return result;
  }
  function phases() { return routing==='ears' ? ['original','together','transcode'] : routing==='switch' ? ['switch'] : ['original','transcode']; }
  function phase() { return phases()[phaseIndex]; }
  function duration() { return excerpts[excerptIndex].duration; }
  function currentPosition() {
    return status==='playing' ? Math.min(duration(),Math.max(startPosition,startPosition+context.currentTime-startTime)) : position;
  }
  function snapshot() {
    const p=currentPosition(),count=phases().length;
    const before=excerpts.slice(0,excerptIndex).reduce((sum,excerpt)=>sum+excerpt.duration*count,0);
    const totalDuration=excerpts.reduce((sum,excerpt)=>sum+excerpt.duration*count,0);
    return {status,error,excerptIndex,excerptCount:excerpts.length,phaseIndex,phase:phase(),
      position:p,duration:duration(),totalDuration,elapsed:status==='ended'?totalDuration:before+phaseIndex*duration()+p,
      sourceTime:excerpts[excerptIndex].seconds+p,volume,muted,routing,swapEars,listen};
  }
  function emit() {
    const state=snapshot();
    try { onState(state); } catch { /* UI listeners must not interrupt audio. */ }
    for (const listener of listeners) { try { listener(state); } catch { /* Same for subscribers. */ } }
  }
  function updateVolume() {
    const target=muted?0:volume*.5,now=context.currentTime;
    if (master.gain.linearRampToValueAtTime) {
      if (master.gain.cancelAndHoldAtTime) master.gain.cancelAndHoldAtTime(now);
      else { master.gain.cancelScheduledValues?.(now);master.gain.setValueAtTime(master.gain.value,now); }
      master.gain.linearRampToValueAtTime(target,now+.008);
    } else master.gain.value=target;
  }
  function cancel() {
    generation++;
    for (const {source,gain,merger,select} of handles) {
      source.onended=null;
      try { source.stop(); } catch { /* A source may already have ended. */ }
      source.disconnect();gain.disconnect();select?.disconnect();merger.disconnect();
    }
    handles=[];
  }
  function routeFor(name) {
    // Switch mode runs both copies on one clock; only their selection gains change.
    if (name==='switch') return [['original',[0,1]],['review',[0,1]]];
    if (routing==='sequential') return [[name==='transcode'?'review':'original',[0,1]]];
    const left=swapEars?1:0,right=swapEars?0:1;
    if (name==='original') return [['original',[left]]];
    if (name==='transcode') return [['review',[right]]];
    return [['original',[left]],['review',[right]]];
  }
  async function begin() {
    if (destroyed) return;
    cancel();
    const ticket=generation,name=phase(),index=excerptIndex,offset=position;
    desiredPlaying=true;
    error=null;
    try {
      if (context.state!=='running') await context.resume();
      if (ticket!==generation || destroyed) return;
      if (context.state!=='running') { status='suspended';desiredPlaying=false;emit();return; }
      await preparePhase({excerptIndex:index,phase:name,position:offset});
      if (ticket!==generation || destroyed) return;
      if (context.state!=='running') { status='suspended';desiredPlaying=false;emit();return; }
      const remaining=duration()-offset;
      if (remaining<=0) { await advance();return; }
      const when=context.currentTime+.02,fade=Math.min(.008,remaining/2);
      const merger=context.createChannelMerger(2);
      merger.connect(master);
      const sources=[];
      for (const [copy,channels] of routeFor(name)) {
        const source=context.createBufferSource(),gain=context.createGain();
        source.buffer=buffers[index][copy];
        source.connect(gain);
        let select=null,output=gain;
        if (name==='switch') { select=context.createGain();select.gain.value=selected(copy);gain.connect(select);output=select; }
        for (const channel of channels) output.connect(merger,0,channel);
        gain.gain.setValueAtTime(0,when);
        gain.gain.linearRampToValueAtTime(1,when+fade);
        gain.gain.setValueAtTime(1,when+remaining-fade);
        gain.gain.linearRampToValueAtTime(0,when+remaining);
        handles.push({source,gain,merger,select,copy});
        sources.push(source);
      }
      sources[0].onended=()=>{ if (ticket===generation && !destroyed) void advance(); };
      for (const source of sources) source.start(when,offset,remaining);
      startTime=when;startPosition=offset;status='playing';emit();
    } catch (cause) {
      if (ticket!==generation || destroyed) return;
      cancel();desiredPlaying=false;status='error';error=cause instanceof Error?cause.message:String(cause);emit();
    }
  }
  function selected(copy) { return (copy==='original')===(listen==='original') ? 1 : 0; }
  function updateListen() {
    const now=context.currentTime;
    for (const {select,copy} of handles) {
      if (!select) continue;
      const target=selected(copy);
      if (select.gain.linearRampToValueAtTime) {
        select.gain.cancelScheduledValues?.(now);select.gain.setValueAtTime(select.gain.value,now);select.gain.linearRampToValueAtTime(target,now+.01);
      } else select.gain.value=target;
    }
  }
  async function advance() {
    cancel();
    if (perExcerpt && phaseIndex+1>=phases().length) {
      position=duration();desiredPlaying=false;status='done';emit();return;
    }
    position=0;
    if (++phaseIndex>=phases().length) { phaseIndex=0;excerptIndex++; }
    if (excerptIndex>=excerpts.length) {
      excerptIndex=excerpts.length-1;phaseIndex=phases().length-1;position=duration();
      desiredPlaying=false;status='ended';emit();return;
    }
    status='paused';
    await begin();
  }
  function interrupted(nextStatus) {
    position=currentPosition();cancel();desiredPlaying=false;status=nextStatus;emit();
  }
  function stateChanged() {
    if (!destroyed && context.state!=='running' && status==='playing') interrupted('suspended');
  }
  context.addEventListener?.('statechange',stateChanged);

  async function command(action,value) {
    if (destroyed) return;
    switch (action) {
      case 'play':
        if (status==='playing') return;
        if (status==='ended') { excerptIndex=0;phaseIndex=0;position=0; }
        if (status==='done') { phaseIndex=0;position=0; }
        await begin();return;
      case 'toggle':
        if (status==='playing') { interrupted('paused');return; }
        if (status==='ended') { excerptIndex=0;phaseIndex=0;position=0; }
        if (status==='done') { phaseIndex=0;position=0; }
        await begin();return;
      case 'excerpt': {
        if (!value || !Number.isInteger(value.index)) throw Error('Invalid excerpt.');
        cancel();excerptIndex=Math.max(0,Math.min(excerpts.length-1,value.index));
        phaseIndex=0;position=0;status='paused';desiredPlaying=false;emit();
        if (value.play) await begin();return;
      }
      case 'listen':
        if (value!==undefined && !['original','transcode'].includes(value)) throw Error('Invalid audio routing.');
        listen=value??(listen==='original'?'transcode':'original');updateListen();emit();return;
      case 'pause':
        if (status==='playing' || desiredPlaying) interrupted('paused');return;
      case 'stop':
        cancel();desiredPlaying=false;excerptIndex=0;phaseIndex=0;position=0;status='idle';error=null;emit();return;
      case 'repeat': {
        const resume=status==='playing'||desiredPlaying;
        cancel();phaseIndex=0;position=0;status='paused';emit();
        if (resume) await begin();return;
      }
      case 'next':
      case 'previous': {
        const resume=status==='playing'||desiredPlaying;
        cancel();excerptIndex=Math.max(0,Math.min(excerpts.length-1,excerptIndex+(action==='next'?1:-1)));
        phaseIndex=0;position=0;status='paused';emit();
        if (resume) await begin();return;
      }
      case 'seek': {
        if (!Number.isFinite(value)) throw Error('Invalid seek position.');
        const resume=status==='playing'||desiredPlaying;
        cancel();position=Math.max(0,Math.min(duration()-1/sampleRate,value));status='paused';emit();
        if (resume) await begin();return;
      }
      case 'volume':
        if (!Number.isFinite(value) || value<0 || value>1) throw Error('Volume must be between 0 and 1.');
        volume=value;updateVolume();emit();return;
      case 'mute':
        muted=typeof value==='boolean'?value:!muted;updateVolume();emit();return;
      case 'routing': {
        if (!value || !['ears','sequential','switch'].includes(value.mode)) throw Error('Invalid audio routing.');
        const resume=status==='playing'||desiredPlaying;
        cancel();routing=value.mode;swapEars=Boolean(value.swapEars);phaseIndex=0;position=0;status='paused';emit();
        if (resume) await begin();return;
      }
      default: throw Error('Unknown audio command.');
    }
  }
  return {command,snapshot,subscribe(listener) { listeners.add(listener);return ()=>listeners.delete(listener); },
    destroy() { if (destroyed) return;cancel();destroyed=true;desiredPlaying=false;context.removeEventListener?.('statechange',stateChanged);master.disconnect();listeners.clear(); }};
}
