import test from 'node:test';
import assert from 'node:assert/strict';
import {classify,confirmed,originalFailureReport,fatalMpeg2Input,relative,bindHistory,blocked,within} from './policy.mjs';
const corrupt={code:183,stderr:'[hevc @ 0x123] Invalid NAL unit size (-12 > 42).\nError submitting packet to decoder: Invalid data found when processing input'};
test('DTS XLL requires matching original decoder evidence and rejects operational failures',()=>{
 const a={code:183,stderr:'[dca @ 0x123] Read past end of XLL band data\nError submitting packet to decoder: Invalid data found when processing input'};
 assert.equal(confirmed(a,{...a,stderr:a.stderr.replace('0x123','0x456')}),true);
 assert.equal(confirmed(a,corrupt),false);
 assert.equal(confirmed(a,{code:0,stderr:''}),false);
 for(const x of [{timeout:true},{signal:'SIGKILL'},{error:'ENOENT'},{stderr:a.stderr+'\nInput/output error'},{stderr:a.stderr+'\nPermission denied'}])assert.equal(confirmed(a,{...a,...x}),false);
});
test('only repeated structural decoding errors are eligible',()=>{assert.equal(confirmed(corrupt,{...corrupt,stderr:corrupt.stderr.replace('0x123','0x999')}),true);assert.equal(confirmed(corrupt,{code:1,stderr:'Invalid NAL unit size (-10 > 42).'}),false);});
test('operational failures override any decoder symptom',()=>{for(const stderr of ['Permission denied','Input/output error','Connection reset','No such file or directory','No space left on device','Cannot allocate memory'])assert.equal(classify({...corrupt,stderr:corrupt.stderr+'\n'+stderr}).kind,'operational');for(const x of [{timeout:true},{signal:'SIGKILL'},{error:'ENOENT'}])assert.equal(classify({...corrupt,...x}).kind,'operational');});
test('encoder and generic failures never qualify',()=>{for(const stderr of ['Error initializing output stream','Conversion failed!','Invalid data found when processing input','Unknown encoder libx265','Could not find ref with POC 1'])assert.equal(classify({code:1,stderr}).kind,'unconfirmed');assert.equal(classify({...corrupt,code:0}).kind,'corrupt');});
test('paths cannot escape library',()=>{assert.equal(relative('/media/movies/A/A.mkv','/media/movies'),'A/A.mkv');for(const p of ['/temp/A.mkv','/media/movies/../A.mkv','/media/movies/A/../../B.mkv'])assert.throws(()=>relative(p,'/media/movies'));assert.throws(()=>within('/media','../escape'));});
const movie={id:1,monitored:true,movieFileId:3,movieFile:{id:3,path:'/media/A/A.mkv',size:42,sceneName:'release'}};
const history=[{id:5,eventType:'downloadFolderImported',downloadId:'abc',data:{fileId:'3',importedPath:'/media/A/A.mkv',size:'42'}},{id:4,eventType:'grabbed',movieId:1,downloadId:'abc',sourceTitle:'release',data:{publishedDate:'2026-01-01',indexer:'Indexer',size:'50',protocol:'1'}}];
test('bind only current import to its exact grabbed release',()=>{const b=bindHistory(movie,history,'/media/A/A.mkv',42);assert.equal(b.historyId,4);assert.equal(blocked([{sourceTitle:'release',indexer:'Indexer',protocol:'usenet'}],b),true);assert.equal(blocked([{sourceTitle:'release',indexer:'Indexer',protocol:'torrent'}],b),false);assert.equal(blocked([{sourceTitle:'other',indexer:'Indexer',protocol:'usenet'}],b),false);for(const hs of [[],history.slice(1),[...history,history[1]]])assert.throws(()=>bindHistory(movie,hs,'/media/A/A.mkv',42));assert.throws(()=>bindHistory(movie,history,'/media/A/A.mkv',43));assert.throws(()=>bindHistory({...movie,monitored:false},history,'/media/A/A.mkv',42));});
const dca=message=>({code:183,stderr:`[dca @ 0x5581a2c0] ${message}\nError submitting packet to decoder: Invalid data found when processing input`});
const matroska={code:0,stderr:'[matroska,webm @ 0x55d1f00] Element at 0x1a2b3c ending at 0x1a2c00 exceeds containing master element ending at 0x1a2bf0'};
test('specific DTS core and Matroska structure errors are recognized with signatures free of process addresses',()=>{
 for(const message of ['Residual encoded channels are present without core','Invalid isolated sample location','Invalid bit allocation index','Failed to decode block code(s)']){
  const a=dca(message),b={...a,stderr:a.stderr.replace('0x5581a2c0','0x7ffd0010')};
  assert.equal(classify(a).kind,'corrupt',message);assert.equal(classify(a).signature,'[dca] '+message);
  assert.deepEqual(classify({code:0,stderr:classify(a).signature}),classify(a),'a stored signature classifies to itself');
  assert.equal(confirmed(a,b),true,message);
 }
 const moved={...matroska,stderr:matroska.stderr.replace('0x55d1f00','0x60aa000')};
 assert.equal(classify(matroska).kind,'corrupt','structural error stderr with exit 0 is not healthy');
 assert.equal(classify(matroska).signature,'[matroska,webm] Element at 0x1a2b3c ending at 0x1a2c00 exceeds containing master element ending at 0x1a2bf0');
 assert.deepEqual(classify({code:0,stderr:classify(matroska).signature}),classify(matroska));
 assert.equal(confirmed(matroska,moved),true);
});
test('the new DTS and Matroska signatures never authorize repair on their own or across differing evidence',()=>{
 const residual=dca('Residual encoded channels are present without core');
 assert.equal(confirmed(residual,dca('Invalid bit allocation index')),false,'differing signatures');
 assert.equal(confirmed(residual,matroska),false);
 assert.equal(confirmed(residual,{code:0,stderr:''}),false);
 for(const x of [{timeout:true},{signal:'SIGKILL'},{error:'spawn ENOENT'},{stderr:residual.stderr+'\nInput/output error'},{stderr:matroska.stderr+'\nPermission denied'}]){
  assert.equal(confirmed(residual,{...residual,...x}),false,JSON.stringify(x));assert.equal(classify({...matroska,...x}).kind,'operational');
 }
});
test('timestamp-only DTS warnings, other decoders and generic invalid data stay unconfirmed',()=>{
 for(const stderr of [
  '[matroska @ 0x1] Non-monotonous DTS in output stream 0:1; previous: 1001, current: 1000; changing to 1002. This may result in incorrect timestamps in the output file.',
  '[mpegts @ 0x1] Packet corrupt (stream = 1, dts = 900000).',
  'Application provided invalid, non monotonically increasing dts to muxer in stream 1: 5 >= 5',
  '[aac @ 0x1] Failed to decode block code(s)',
  'Residual encoded channels are present without core',
  '[dca @ 0x1] Invalid data found when processing input',
  '[matroska,webm @ 0x1] Element at 0x10 ending at 0x20 exceeds containing master',
 ])assert.equal(classify({code:1,stderr}).kind,'unconfirmed',stderr);
});

test('premature Matroska EOF needs finite container evidence in both naturally completed checks',()=>{
 const a={code:0,stderr:'[matroska,webm @ 0x123] File ended prematurely',finiteContainerTruncation:true,decodedFrames:0};
 assert.equal(classify(a).kind,'corrupt');assert.equal(confirmed(a,{...a}),true);
 for(const change of [{finiteContainerTruncation:false},{finiteContainerTruncation:undefined},{timeout:true},{signal:'SIGKILL'},{error:'ENOENT'},{stderr:a.stderr+'\nInput/output error'},{code:null}])assert.equal(confirmed(a,{...a,...change}),false);
 assert.equal(classify({code:0,stderr:'',decodedFrames:0}).kind,'unconfirmed','exit zero without decoded frames is not a healthy full check');
});

test('preflight discovery and MPEG-2 compatibility are non-authorizing and preserve operational precedence',()=>{
 const parser='[mpeg2video @ 0x123] ignoring pic cod ext after 0',fatal=parser+'\nError submitting packet to decoder: Invalid data found when processing input';
 assert.equal(originalFailureReport('Starting preflight\nError: Bitrate sampling failed: '+parser+'\nEncoding never started'),'mpeg2_preflight');
 assert.equal(originalFailureReport('Bitrate sampling failed: '+parser+'\nPermission denied'),null);
 const a={code:1,stderr:fatal,decodedFrames:0};assert.equal(fatalMpeg2Input(a),true);assert.equal(classify(a).kind,'unconfirmed');assert.equal(confirmed(a,a),false);
 for(const change of [{timeout:true},{signal:'SIGKILL'},{decodedFrames:1},{code:0},{stderr:parser},{stderr:fatal+'\nInput/output error'},{stderr:'Invalid data found when processing input'}])assert.equal(fatalMpeg2Input({...a,...change}),false);
});
