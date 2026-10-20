import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {recoveryStatusHealth} from './health-status.mjs';
import {readRecoveryRuntime,readRecoveryCaseState} from './recovery-snapshot.mjs';
import {createReplacement} from './radarr-replacement.mjs';

// Every reader in Review of a Recovery file must give the same verdict for the same file: "absent",
// "valid" or "invalid". One table of file contents per Recovery file runs against each reader of it.
// Before #220 another version, a missing cases list and a missing update time divided health and the overview;
// they are invalid to every reader now.
const fresh=()=>new Date().toISOString(),stale=()=>new Date(Date.now()-3600000).toISOString();
const json=value=>JSON.stringify(value);
// One Recovery case, so a valid status file shows up as a Recovery request in the overview.
const CASES=[{id:'c'.repeat(24),title:'Synthetic film',phase:'waiting_replacement'}];
const statusCases=[
 {name:'missing',write:null,verdict:'absent'},
 {name:'a directory',write:'directory',verdict:'invalid'},
 {name:'a symlink to a valid file',write:'symlink',verdict:'invalid'},
 {name:'larger than the limit',write:()=>json({version:1,updated:fresh(),cases:CASES,padding:'x'.repeat(2000001)}),verdict:'invalid'},
 {name:'not JSON',write:()=>'{"version":1,',verdict:'invalid'},
 {name:'JSON null',write:()=>'null',verdict:'invalid'},
 {name:'another version',write:()=>json({version:2,updated:fresh(),cases:CASES}),verdict:'invalid'},
 {name:'without cases',write:()=>json({version:1,updated:fresh()}),verdict:'invalid'},
 {name:'without an update time',write:()=>json({version:1,cases:CASES}),verdict:'invalid'},
 {name:'valid and fresh',write:()=>json({version:1,updated:fresh(),cases:CASES}),verdict:'valid'},
 {name:'valid and stale',write:()=>json({version:1,updated:stale(),cases:CASES}),verdict:'valid'},
];
const runtimeCases=[
 {name:'missing',write:null,verdict:'absent'},
 {name:'a directory',write:'directory',verdict:'invalid'},
 {name:'not JSON',write:()=>'{',verdict:'invalid'},
 {name:'another version',write:()=>json({version:2,mode:'verify',state:'running',restarts:0,lastExitCode:null,lastExitSignal:null,lastStartedAt:null,lastExitedAt:null,reason:null,updated:fresh()}),verdict:'invalid'},
 {name:'valid',write:()=>json({version:1,mode:'verify',state:'running',restarts:0,lastExitCode:null,lastExitSignal:null,lastStartedAt:null,lastExitedAt:null,reason:null,updated:fresh()}),verdict:'valid'},
];

async function installation(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'recovery-snapshot-'));
 const data=path.join(root,'data'),mediaRoot=path.join(root,'media','movies');
 await fs.mkdir(path.join(data,'recovery'),{recursive:true});await fs.mkdir(mediaRoot,{recursive:true});
 const files={status:path.join(root,'media','.tdarr-recovery-status.json'),runtime:path.join(data,'recovery','runtime-state.json')};
 return {root,data,mediaRoot,files,cleanup:()=>fs.rm(root,{recursive:true,force:true})};
}
async function place(file,c){
 if(c.write===null)return;
 if(c.write==='directory')return fs.mkdir(file);
 if(c.write==='symlink'){const target=file+'.target';await fs.writeFile(target,json({version:1,updated:fresh(),cases:CASES}));return fs.symlink(target,file);}
 await fs.writeFile(file,c.write());
}
function replacement(i){
 return createReplacement({data:i.data,getConfig:()=>({mediaRoot:i.mediaRoot,reviewRoot:path.join(i.root,'review')}),getConnection:async()=>({url:'http://127.0.0.1:9',apiKey:'synthetic',mediaRoot:'/radarr/movies',preferCzechEnglish:false}),
  safeFile:async()=>{throw Error('not used')},hash:()=>'synthetic',atomicJSON:async()=>{},tdarr:async()=>{throw Error('not used')},pauseDispatch:async()=>{},resume:async()=>{}});
}
const verdictOf=async run=>{try{return await run();}catch{return 'invalid';}};

const readers={
 status:{
  health:async i=>{const v=await recoveryStatusHealth(i.files.status);return !v.present?'absent':v.error?'invalid':'valid';},
  overview:i=>verdictOf(async()=>(await replacement(i).overview()).requests.some(r=>r.source==='recovery')?'valid':'absent'),
 },
 runtime:{
  runtime:async i=>{const v=await readRecoveryRuntime(i.files.runtime);return !v.present?'absent':v.state==='unreadable'?'invalid':'valid';},
  overview:async i=>{const v=(await replacement(i).overview()).recoveryRuntime;return !v.present?'absent':v.state==='unreadable'?'invalid':'valid';},
 },
};

for(const [file,cases] of [['status',statusCases],['runtime',runtimeCases]])for(const [reader,run] of Object.entries(readers[file])){
 test(`the ${file} file reader "${reader}" gives every case its verdict`,{skip:process.platform==='win32'&&'POSIX symlinks'},async()=>{
  for(const c of cases){
   const i=await installation();
   try{await place(i.files[file],c);const expected=typeof c.verdict==='string'?c.verdict:c.verdict[reader];assert.equal(await run(i),expected,c.name);}
   finally{await i.cleanup();}
  }
 });
}

// Recovery's case state has one reader in Review, the manual replacement's Hold handoff, which takes its verdict
// from the snapshot module: absent protects nothing, invalid blocks the handoff (radarr-replacement tests).
const stateCases=[
 {name:'missing',write:null,verdict:'absent'},
 {name:'a directory',write:'directory',verdict:'invalid'},
 {name:'not JSON',write:()=>'{"cases":',verdict:'invalid'},
 {name:'without cases',write:()=>json({version:1,jobs:{}}),verdict:'invalid'},
 {name:'cases as a list',write:()=>json({version:1,cases:[]}),verdict:'invalid'},
 {name:'valid',write:()=>json({version:1,jobs:{},cases:{}}),verdict:'valid'},
];
test('the case state reader gives every case its verdict',async()=>{
 for(const c of stateCases){
  const i=await installation(),file=path.join(i.data,'recovery','state.json');
  try{await place(file,c);const v=await readRecoveryCaseState(file);assert.equal(!v.present?'absent':v.error?'invalid':'valid',c.verdict,c.name);}
  finally{await i.cleanup();}
 }
});
