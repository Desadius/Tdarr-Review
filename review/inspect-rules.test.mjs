import test from 'node:test';
import assert from 'node:assert/strict';
import {inspect} from './core.mjs';
import {createTranslator} from './public/i18n.js';

const en=createTranslator('en');
const original=()=>({format:{duration:'100'},streams:[{codec_type:'video',codec_name:'h264',width:1920,height:1080},{codec_type:'audio',codec_name:'aac',tags:{language:'eng'}}],chapters:[]});
const output=()=>{const r=original();r.streams[0].codec_name='hevc';r.streams[0].pix_fmt='yuv420p10le';return r};

test('each strict video rule names the check that failed, in Czech and English',()=>{
 const cases=[
  [a=>a.streams.push({codec_type:'video',codec_name:'h264'}),null,/^Originál nemá právě jednu video stopu \(nalezeno: 2\)\.$/,/^The original does not have exactly one video track \(found: 2\)\.$/],
  [null,b=>b.streams.shift(),/^Výsledek nemá právě jednu video stopu \(nalezeno: 0\)\.$/,/^The result does not have exactly one video track \(found: 0\)\.$/],
  [a=>{a.streams[0].codec_name='av1'},null,/^Kodek originálu není podporovaný: av1\./,/^The original's codec is not supported: av1\. Allowed codecs are h264, hevc, vc1 and mpeg2video\.$/],
  [null,b=>{b.streams[0].codec_name='h264'},/^Výsledek není HEVC: h264\.$/,/^The result is not HEVC: h264\.$/],
  [null,b=>{b.streams[0].pix_fmt='yuv420p'},/^Výsledek nemá 10bitový formát pixelů yuv420p10le: yuv420p\.$/,/^The result does not use the 10-bit pixel format yuv420p10le: yuv420p\.$/],
  [null,b=>{delete b.streams[0].pix_fmt},/yuv420p10le: \?\.$/,/yuv420p10le: \?\.$/],
  [null,b=>{b.streams[0].width=1280;b.streams[0].height=720},/^Rozlišení výsledku 1280×720 se liší od originálu 1920×1080\.$/,/^The result's resolution 1280×720 differs from the original's 1920×1080\.$/],
 ];
 for(const [changeA,changeB,czech,english] of cases){
  const a=original(),b=output();changeA?.(a);changeB?.(b);
  let message;assert.throws(()=>inspect(a,b),e=>{message=e.message;return true});
  assert.match(message,czech);assert.match(en(message),english);
 }
 assert.equal(inspect(original(),output()).durationMismatch,false);
});
