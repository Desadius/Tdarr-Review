const fs = require('fs'), vm = require('vm'), assert = require('assert/strict'), crypto = require('crypto');
const sourceRelative = 'Fixture (2000)/Fixture.mkv';
const serverSource = '/media/movies/' + sourceRelative;
const pcSource = '//UNRAID/media/movies/' + sourceRelative;
const sourceSize = 28744107025, outputSize = 3732760521;
const sample = crypto.createHash('sha256').update(Buffer.alloc(1048576)).update(Buffer.alloc(1048576)).digest('hex');
const sourceIdentity = {size:sourceSize, mtime:100, sample};
const outputIdentity = {size:outputSize, mtime:100, sample};
const validJob = {_id:'fixture-job', DB:'YOUR_TDARR_LIBRARY_ID', file:serverSource, status:'Transcode success', fileSizeStartGB:sourceSize/2**30, fileSizeEndGB:outputSize/2**30, start:10, end:20};
let receipt, jobs, targetExists, calls;
function reset() {
  receipt = {version:1, relative:sourceRelative, outputRelative:sourceRelative, source:{...sourceIdentity}, output:{...outputIdentity}, jobId:validJob._id, createdAt:15};
  jobs = [validJob]; targetExists = true; calls = [];
}
const fakeFs = {
  stat: async file => {
    if (file.includes('tdarr-review-output/PROD-Movies/') || file.includes('/pilot-review/PROD-Movies/')) {
      if (!targetExists) throw Object.assign(new Error('missing'), {code:'ENOENT'});
      return {size:outputSize,mtimeMs:100,isFile:()=>true};
    }
    return {size:sourceSize,mtimeMs:100,isFile:()=>true};
  },
  open: async () => ({read:async b=>{b.fill(0);return{bytesRead:b.length}},close:async()=>{}}),
  readFile:async()=>JSON.stringify(receipt),
  writeFile:async(p,s)=>{calls.push(['write',p]);receipt=JSON.parse(s)},
  rename:async()=>{},
};
function load(code, platform) {
  const c = {module:{exports:{}},require:n=>n==='fs/promises'?fakeFs:require(n),process:{platform},Buffer,Date,AbortSignal,fetch:async()=>({ok:true,json:async()=>jobs})};
  vm.runInNewContext(code,c); return c.module.exports;
}
const fixedSource = fs.readFileSync('examples/tdarr/review-guard.cjs','utf8');
const guardLinux = load(fixedSource,'linux');
// Tdarr rewrites path strings in customFunction inputs before executing on mapped Windows nodes.
const pcTranslate = code => code.replaceAll('/media', '//UNRAID/media').replaceAll('/pilot-review', '//UNRAID/tdarr-review-output');
const guardPC = load(pcTranslate(fixedSource),'win32');
const brokenSource = pcTranslate(fixedSource).replace("const serverKey=['','media','movies',''].join('/');","const serverKey=key;");
const baselinePC = load(brokenSource,'win32');
const args = platform => ({inputFileObj:{_id:platform==='win32'?pcSource:serverSource},variables:{},job:{jobId:'new-job'},jobLog:()=>{}});
(async()=>{
  reset(); await assert.rejects(()=>baselinePC(args('win32')),/UNVERIFIED/);
  reset(); assert.equal((await guardPC(args('win32'))).outputNumber,2);
  reset(); assert.equal((await guardLinux(args('linux'))).outputNumber,2);
  for (const [label, mutation] of [
    ['wrong ID',()=>{jobs=[{...validJob,_id:'other'}]}],
    ['wrong library',()=>{jobs=[{...validJob,DB:'other'}]}],
    ['wrong server path',()=>{jobs=[{...validJob,file:'/media/movies/other.mkv'}]}],
    ['failed job',()=>{jobs=[{...validJob,status:'Transcode error'}]}],
    ['wrong source size',()=>{jobs=[{...validJob,fileSizeStartGB:(sourceSize+1)/2**30}]}],
    ['wrong output size',()=>{jobs=[{...validJob,fileSizeEndGB:(outputSize+1)/2**30}]}],
  ]) {reset();mutation();await assert.rejects(()=>guardPC(args('win32')),/UNVERIFIED/,label);}
  reset(); receipt.output.sample='different'; await assert.rejects(()=>guardPC(args('win32')),/CHANGED/);
  reset(); receipt.source.mtime=101; await assert.rejects(()=>guardPC(args('win32')),/CHANGED/);
  reset(); delete receipt.jobId; assert.equal((await guardPC(args('win32'))).outputNumber,2);
  reset(); delete receipt.jobId; receipt.createdAt=100000; await assert.rejects(()=>guardPC(args('win32')),/UNVERIFIED/);
  reset();targetExists=false;assert.equal((await guardPC(args('win32'))).outputNumber,1);
  assert.equal(calls.length,0,'Guard must not write media or receipts');
  console.log('14 checks passed: reproduces live Windows failure, fixes Windows/Linux match, rejects wrong ID/library/path/status/sizes/identity, preserves legacy timing and first-pass dispatch.');
})().catch(e=>{console.error(e);process.exitCode=1});
