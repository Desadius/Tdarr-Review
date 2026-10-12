const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const code=fs.readFileSync(require('node:path').join(__dirname,'../examples/tdarr/recovery-review-route.cjs'),'utf8');
async function run({source='/media/movies/Movie (2026)/new.mkv',cases=[],updated=new Date().toISOString(),version=1,user={},fail=false}={}){
 let readPath;
 const fake={stat:async p=>{readPath=p;if(fail)throw Error('offline');return{isFile:()=>true,size:100}},readFile:async()=>JSON.stringify({version,updated,cases})};
 const sandbox={module:{exports:{}},require:n=>{assert.equal(n,'fs/promises');return fake},Date};vm.runInNewContext(code,sandbox);
 const args={inputFileObj:{_id:'encoded'},variables:{user:{reviewSource:{path:source},...user}},jobLog:()=>{}};
 const result=await sandbox.module.exports(args);return{result,readPath,args};
}
test('normal SDR retains direct route while Recovery movies require Review, including historical cases',async()=>{
 assert.equal((await run()).result.outputNumber,1);
 for(const replacementTitle of [undefined,'another-edition.mkv'])assert.equal((await run({cases:[{title:'Movie (2026)',source:'recovery',phase:'replacement_imported',replacementTitle}]})).result.outputNumber,2);
 assert.equal((await run({cases:[{title:'Other',source:'recovery',phase:'replacement_imported'}]})).result.outputNumber,1);
});
test('Linux and Windows derive the correct shared status file from original identity',async()=>{
 assert.equal((await run()).readPath,'/media/.tdarr-recovery-status.json');
 assert.equal((await run({source:'\\\\UNRAID\\media\\movies\\Movie (2026)\\new.mkv'})).readPath,'//UNRAID/media/.tdarr-recovery-status.json');
});
test('missing, stale, future, malformed and unsafe identity fail closed',async()=>{
 for(const options of [{fail:true},{version:2},{updated:'invalid'},{updated:new Date(Date.now()-13*60000).toISOString()},{updated:new Date(Date.now()+5*60000).toISOString()},{source:''},{source:'/media/movies/../new.mkv'}])await assert.rejects(run(options));
});
test('existing special review routes and verification gates remain intact',async()=>{
 assert.equal((await run({user:{hdr10:{}},fail:true})).result.outputNumber,2);
 await assert.rejects(run({user:{hevcSDR:{verified:false}}}),/verification missing/);
 assert.equal((await run({user:{hevcSDR:{verified:true}},fail:true})).result.outputNumber,2);
});
