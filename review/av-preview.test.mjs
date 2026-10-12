import test from 'node:test';
import assert from 'node:assert/strict';
import {previewArgs,previewProfile} from './av-preview.mjs';
test('AV preview preserves stream differences by subtracting one container origin',()=>{
 const args=previewArgs('/source.mkv',3,300,5,{index:0,color_transfer:'bt709'}),f=args[args.indexOf('-filter_complex')+1];
 assert.match(f,/\[0:0\]trim=start=305:end=317,setpts=PTS-\(305\)\/TB/);
 assert.match(f,/\[0:3\]atrim=start=305:end=317,asetpts=PTS-\(305\)\/TB/);
 assert.doesNotMatch(f,/STARTPTS|loudnorm|dynaudnorm/);assert.equal(args[args.indexOf('-ss')+1],'298');assert(args.includes('-copyts'));assert.equal(args[args.indexOf('-bf')+1],'0');
});
test('AV preview rejects unsupported colours and invalid indexes rather than silent tone mapping',()=>{
 for(const v of ['arib-std-b67','linear'])assert.throws(()=>previewArgs('x',1,0,0,{index:0,color_transfer:v}));
 for(const [index,time] of [[-1,0],[1,-1],[1,NaN]])assert.throws(()=>previewArgs('x',index,time,0,{index:0}));
 const hdr=previewArgs('x',1,0,0,{index:0,color_transfer:'smpte2084'});assert.match(hdr[hdr.indexOf('-filter_complex')+1],/tonemap=tonemap=mobius/);
});

test('preview profiles enforce fixed pixel budgets and quality without weakening timing or threads',()=>{
 for(const [name,width,height,crf]of [['compact',960,540,24],['detail',1920,1080,16]]){
  assert.deepEqual(previewProfile(name),{width,height,crf});
  const args=previewArgs('movie',1,300,5,{index:0},name),filter=args[args.indexOf('-filter_complex')+1];
  assert.equal(args[args.indexOf('-crf')+1],String(crf));
  assert.match(filter,new RegExp(`min\\(${width},${height}\\*`));
  assert.match(filter,/iw\*if\(gt\(sar,0\),sar,1\)/);assert.match(filter,/setsar=1/);
  assert.equal(args[args.indexOf('-filter_complex_threads')+1],'1');assert.equal(args[args.indexOf('-t')+1],'12');
  assert.doesNotMatch(filter,/STARTPTS/);assert(!args.includes('-maxrate'));
 }
 for(const name of ['unknown','__proto__',null])assert.throws(()=>previewArgs('movie',1,0,0,{index:0},name));
});
