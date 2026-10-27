import assert from 'node:assert/strict';
import test from 'node:test';
import {createGuidedPlayer} from './public/guided-player.js';

function context() {
  const ctx={currentTime:0,state:'running',destination:{},sources:[],gains:[],mergers:[],listeners:new Set(),resumeCount:0};
  const node=()=>({links:[],connect(target,...inputs){this.links.push({target,inputs});return target},disconnect(){this.disconnected=true}});
  ctx.createGain=()=>{const gain={value:1,events:[],setValueAtTime(value,time){this.value=value;this.events.push(['set',value,time])},linearRampToValueAtTime(value,time){this.value=value;this.events.push(['ramp',value,time])}};const item={...node(),gain};ctx.gains.push(item);return item};
  ctx.createChannelMerger=channels=>{const item={...node(),channels};ctx.mergers.push(item);return item};
  ctx.createBuffer=(channels,frames,sampleRate)=>{const data=Array.from({length:channels},()=>new Float32Array(frames));return {duration:frames/sampleRate,getChannelData:channel=>data[channel]}};
  ctx.createBufferSource=()=>{const item={...node(),buffer:null,onended:null,start(when,offset,duration){this.started={when,offset,duration}},stop(){this.stopped=true}};ctx.sources.push(item);return item};
  ctx.resume=async()=>{ctx.resumeCount++;ctx.state='running';ctx.emitState()};
  ctx.addEventListener=(name,fn)=>{if(name==='statechange')ctx.listeners.add(fn)};
  ctx.removeEventListener=(name,fn)=>{if(name==='statechange')ctx.listeners.delete(fn)};
  ctx.emitState=()=>{for(const fn of ctx.listeners)fn()};
  ctx.finish=()=>{const active=ctx.sources.filter(s=>s.started&&!s.stopped&&s.onended);assert.equal(active.length,1);ctx.currentTime=active[0].started.when+active[0].started.duration;active[0].onended()};
  return ctx;
}

const excerpts=()=>[0,1,2].map(i=>({seconds:100+i*100,duration:12,original:new Float32Array(12).fill(i+1),review:new Float32Array(12).fill(i+4)}));
const flush=async()=>{for(let i=0;i<5;i++)await Promise.resolve()};

test('construction stays silent and subscription can be removed',async()=>{
  const ctx=context(),player=createGuidedPlayer({context:ctx,excerpts:excerpts(),sampleRate:1});
  assert.equal(ctx.sources.length,0);
  assert.equal(ctx.resumeCount,0);
  assert.equal(player.snapshot().status,'idle');
  const events=[],unsubscribe=player.subscribe(state=>events.push(state.status));
  await player.command('play');
  assert.deepEqual(events,['playing']);
  unsubscribe();
  await player.command('pause');
  assert.deepEqual(events,['playing']);
});

test('invalid PCM is refused before scheduling any audio',()=>{
  const ctx=context(),samples=excerpts();samples[0].review[3]=NaN;
  assert.throws(()=>createGuidedPlayer({context:ctx,excerpts:samples,sampleRate:1}),/Invalid audio excerpt/);
  assert.equal(ctx.sources.length,0);
});

test('headphone plan repeats one film interval in L, L+R, R for each of three excerpts',async()=>{
  const ctx=context(),player=createGuidedPlayer({context:ctx,excerpts:excerpts(),sampleRate:1});
  assert.equal(player.snapshot().totalDuration,108);
  await player.command('play');
  const plan=[];
  for(let i=0;i<9;i++){
    const state=player.snapshot(),active=ctx.sources.filter(s=>s.started&&!s.stopped);
    const routes=active.flatMap(s=>s.links.flatMap(link=>link.target.links.filter(l=>l.target.channels===2).map(l=>l.inputs[1])));
    plan.push([state.excerptIndex,state.phase,state.sourceTime,routes.sort(),active.map(s=>[s.started.when,s.started.offset,s.started.duration]),active.map(s=>s.buffer.getChannelData(0)[0])]);
    ctx.finish();await flush();
  }
  assert.deepEqual(plan.map(([i,p,t,r])=>[i,p,t,r]),[
    [0,'original',100,[0]],[0,'together',100,[0,1]],[0,'transcode',100,[1]],
    [1,'original',200,[0]],[1,'together',200,[0,1]],[1,'transcode',200,[1]],
    [2,'original',300,[0]],[2,'together',300,[0,1]],[2,'transcode',300,[1]],
  ]);
  for(const [,phase,, ,starts] of plan){assert(starts.every(s=>s[1]===0&&s[2]===12));if(phase==='together')assert.equal(starts[0][0],starts[1][0])}
  assert.deepEqual(plan.map(row=>row[5]),[[1],[1,4],[4],[2],[2,5],[5],[3],[3,6],[6]]);
  assert.equal(player.snapshot().status,'ended');
  assert.equal(player.snapshot().elapsed,108);
});

test('pause, resume and seek use the audio clock and stop old sources',async()=>{
  const ctx=context(),player=createGuidedPlayer({context:ctx,excerpts:excerpts(),sampleRate:1});
  await player.command('play');ctx.currentTime=4.02;
  assert(Math.abs(player.snapshot().position-4)<1e-9);
  await player.command('pause');assert(Math.abs(player.snapshot().position-4)<1e-9);
  assert(ctx.sources[0].stopped&&ctx.sources[0].disconnected);
  await player.command('play');assert(Math.abs(ctx.sources.at(-1).started.offset-4)<1e-9);
  await player.command('seek',7);assert.equal(ctx.sources.at(-1).started.offset,7);
  assert.equal(player.snapshot().sourceTime,107);
});

test('navigation, repeat, stop and concurrent play never overlap sources',async()=>{
  const ctx=context(),player=createGuidedPlayer({context:ctx,excerpts:excerpts(),sampleRate:1});
  await Promise.all([player.command('play'),player.command('play')]);
  assert.equal(ctx.sources.filter(s=>s.started&&!s.stopped).length,1);
  await player.command('next');assert.equal(player.snapshot().excerptIndex,1);
  assert.equal(ctx.sources.filter(s=>s.started&&!s.stopped).length,1);
  await player.command('repeat');assert.equal(player.snapshot().phase,'original');
  await player.command('previous');assert.equal(player.snapshot().excerptIndex,0);
  await player.command('stop');assert.equal(player.snapshot().status,'idle');
  assert.equal(ctx.sources.filter(s=>s.started&&!s.stopped).length,0);
});

test('sequential routing plays each copy in both ears; swap reverses headphone ears',async()=>{
  const ctx=context(),player=createGuidedPlayer({context:ctx,excerpts:excerpts(),sampleRate:1});
  await player.command('routing',{mode:'sequential',swapEars:false});assert.equal(player.snapshot().totalDuration,72);
  await player.command('play');
  let active=ctx.sources.filter(s=>s.started&&!s.stopped);
  assert.deepEqual(active[0].links[0].target.links.map(l=>l.inputs[1]),[0,1]);
  ctx.finish();await flush();assert.equal(player.snapshot().phase,'transcode');
  assert.deepEqual([...ctx.sources.at(-1).buffer.getChannelData(0)],[...excerpts()[0].review]);
  await player.command('routing',{mode:'ears',swapEars:true});
  active=ctx.sources.filter(s=>s.started&&!s.stopped);
  assert.deepEqual(active[0].links[0].target.links.map(l=>l.inputs[1]),[1]);
});

test('volume, mute and phase fades use shared gain without changing PCM',async()=>{
  const ctx=context(),samples=excerpts(),player=createGuidedPlayer({context:ctx,excerpts:samples,sampleRate:1});
  await player.command('volume',0.8);await player.command('play');
  assert.deepEqual([...ctx.sources[0].buffer.getChannelData(0)],[...samples[0].original]);
  assert.equal(ctx.gains[0].gain.value,0.4);
  assert(ctx.gains.some(g=>g.gain.events.some(e=>e[0]==='ramp')));
  await player.command('mute',true);assert.equal(ctx.gains[0].gain.value,0);
  await player.command('mute',false);assert.equal(ctx.gains[0].gain.value,0.4);
  assert(ctx.gains[0].gain.events.filter(e=>e[0]==='ramp').length>=3);
});

test('stale preparation cannot start audio after stop or a newer seek',async()=>{
  const ctx=context(),pending=[];
  const player=createGuidedPlayer({context:ctx,excerpts:excerpts(),sampleRate:1,preparePhase:()=>new Promise(resolve=>pending.push(resolve))});
  const first=player.command('play');await flush();
  await player.command('stop');pending.shift()();await first;
  assert.equal(ctx.sources.length,0);
  const second=player.command('play');await flush();
  const seek=player.command('seek',5);await flush();
  pending.shift()();await second;assert.equal(ctx.sources.length,0);
  pending.shift()();await seek;assert.equal(ctx.sources.length,1);
  assert.equal(ctx.sources[0].started.offset,5);
});

test('suspension preserves coverage, errors are reported, and destroy detaches playback',async()=>{
  const ctx=context(),states=[];
  const player=createGuidedPlayer({context:ctx,excerpts:excerpts(),sampleRate:1,onState:s=>states.push(s.status)});
  await player.command('play');ctx.currentTime=3.02;ctx.state='suspended';ctx.emitState();
  assert.equal(player.snapshot().status,'suspended');assert.equal(player.snapshot().position,3);
  assert.equal(ctx.sources.filter(s=>s.started&&!s.stopped).length,0);
  await player.command('play');assert.equal(ctx.sources.at(-1).started.offset,3);
  ctx.state='interrupted';ctx.emitState();assert.equal(player.snapshot().status,'suspended');
  player.destroy();assert.equal(ctx.listeners.size,0);
  assert.equal(ctx.sources.filter(s=>s.started&&!s.stopped).length,0);
  assert(states.includes('suspended'));

  const bad=createGuidedPlayer({context:context(),excerpts:excerpts(),sampleRate:1,preparePhase:async()=>{throw Error('sample unavailable')}});
  await bad.command('play');assert.equal(bad.snapshot().status,'error');assert.match(bad.snapshot().error,/sample unavailable/);
});

test('switch mode plays each excerpt once with both copies on one clock and stops after it',async()=>{
  const ctx=context(),player=createGuidedPlayer({context:ctx,excerpts:excerpts(),sampleRate:1,perExcerpt:true});
  await player.command('routing',{mode:'switch',swapEars:false});
  assert.equal(player.snapshot().totalDuration,36);
  await player.command('play');
  const active=ctx.sources.filter(s=>s.started&&!s.stopped);
  assert.equal(active.length,2,'original and transcode run together');
  assert.deepEqual(active.map(s=>s.started),[active[0].started,active[0].started],'both start at the same clock time and offset');
  assert.equal(player.snapshot().phase,'switch');
  ctx.finish();await flush();
  const state=player.snapshot();
  assert.equal(state.status,'done');
  assert.equal(state.excerptIndex,0,'the next excerpt waits for an explicit action');
  assert.equal(ctx.sources.filter(s=>s.started&&!s.stopped).length,0,'nothing plays again by itself');
  await player.command('excerpt',{index:1,play:true});
  assert.equal(player.snapshot().excerptIndex,1);assert.equal(player.snapshot().status,'playing');
});

test('switching what is heard changes only the selection gains without moving the playhead',async()=>{
  const ctx=context(),player=createGuidedPlayer({context:ctx,excerpts:excerpts(),sampleRate:1,perExcerpt:true});
  await player.command('routing',{mode:'switch',swapEars:false});
  await player.command('play');
  const started=ctx.sources.length,before=player.snapshot(),selects=ctx.gains.filter(g=>g.links.some(link=>link.target.channels===2));
  assert.deepEqual(selects.map(g=>g.gain.value),[1,0],'the original is heard first');
  ctx.currentTime+=4;
  await player.command('listen');
  assert.equal(player.snapshot().listen,'transcode');
  assert.deepEqual(selects.map(g=>g.gain.value),[0,1]);
  assert.equal(ctx.sources.length,started,'no source is restarted');
  assert.ok(ctx.sources.every(s=>!s.stopped));
  const when=ctx.sources[0].started.when;
  assert.equal(before.position,0);
  assert.ok(Math.abs(player.snapshot().position-(ctx.currentTime-when))<1e-9,'the position keeps running on the same clock');
  assert.equal(player.snapshot().status,'playing');
});
