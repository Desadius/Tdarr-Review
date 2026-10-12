import test from 'node:test';
import assert from 'node:assert/strict';
import {previewArgs} from './av-preview.mjs';
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
