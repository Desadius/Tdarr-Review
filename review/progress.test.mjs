import test from 'node:test';
import assert from 'node:assert/strict';
import {ffmpegProgress,measure} from './progress.mjs';

test('FFmpeg progress survives fragmented records, invalid rates and backwards timestamps',()=>{
  const events=[],parse=ffmpegProgress(120,p=>events.push(p),()=>10000);
  parse('fps=48\nout_time_');parse('us=30000000\nspeed=2.0x\nprogress=cont');parse('inue\n');
  assert.equal(events.length,1);assert.equal(events[0].done,30);assert.equal(events[0].speed,2);assert.equal(events[0].fps,48);
  parse('out_time_us=N/A\nout_time=00:00:45.500\nspeed=N/A\nprogress=continue\n');
  assert.equal(events[1].done,45.5);assert.equal(events[1].speed,null);
  parse('out_time_us=-10\nprogress=continue\nout_time_us=999999999\nprogress=end\n');
  assert.equal(events[2].done,45.5);assert.equal(events[3].done,120);
});

test('ETA waits for measurements, is finite and never implies the next steps are finished',()=>{
  assert.equal(measure(0,120,0,1000).etaSeconds,null);
  assert.equal(measure(30,120,0,3000,2).etaSeconds,null);
  const p=measure(30,120,0,15000,2);assert.equal(p.percent,25);assert.equal(p.etaSeconds,45);
  const bytes=measure(50,100,0,10000);assert.equal(bytes.rate,5);assert.equal(bytes.etaSeconds,10);
  assert.equal(measure(120,120,0,10000).percent,99.9);
});
