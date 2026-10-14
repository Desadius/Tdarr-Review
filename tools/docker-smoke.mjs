import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

// No production mounts, published ports, real API keys or external network.
const decoder='/app/Tdarr_Node/assets/app/ffmpeg/linux_x64/';
const worker='/recovery/worker.mjs',runtimeState='/data/recovery/runtime-state.json';
// The loopback Radarr stand-in of the Recovery fixture; started inside the container under test.
const mockPort=18271;
const fixtureRoot='/data/smoke-fixture',media=fixtureRoot+'/media/movies',sentinel=media+'/Unchanged/fixture.mkv';
function run(exe,args,{input,timeout=120000,quiet=false,includeStderr=false}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(exe,args,{stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='',expired=false;
    const timer=setTimeout(()=>{expired=true;child.kill('SIGKILL');},timeout);
    child.stdout.on('data',b=>{stdout=(stdout+b).slice(-65536);});
    child.stderr.on('data',b=>{stderr=(stderr+b).slice(-65536);});
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('close',code=>{clearTimeout(timer);if(expired||code!==0)return reject(Error(`${exe} failed (${expired?'timeout':code}): ${stderr}`));const output=stdout+(includeStderr?stderr:'');if(!quiet&&output.trim())console.log(output.trim());resolve(output);});
    child.stdin.end(input);
  });
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function eventually(what,check,timeout=30000){
  const end=Date.now()+timeout;let last;
  for(;;){try{const value=await check();if(value)return value;}catch(e){last=e;}if(Date.now()>end)throw Error('Timed out waiting for '+what+(last?': '+last.message:''));await sleep(200);}
}
// Every process visible to the container user, from /proc. comm may contain spaces, so the
// fields are read after its closing parenthesis: field 4 is the parent PID and field 19 the niceness.
async function processes(){
  const list=[];
  for(const entry of await fs.readdir('/proc')){
    if(!/^\d+$/.test(entry))continue;
    try{
      const argv=(await fs.readFile(`/proc/${entry}/cmdline`,'utf8')).split('\0').filter(Boolean);
      const stat=await fs.readFile(`/proc/${entry}/stat`,'utf8'),fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');
      list.push({pid:Number(entry),ppid:Number(fields[1]),nice:Number(fields[16]),argv});
    }catch{}// A process that ended while listing.
  }
  return list;
}
const workers=list=>list.filter(p=>p.argv.includes(worker));
async function capabilities(pid){
  const status=await fs.readFile(`/proc/${pid}/status`,'utf8');
  return Object.fromEntries([...status.matchAll(/^(Cap(?:Eff|Prm|Bnd)):\s*(\w+)$/gm)].map(m=>[m[1],m[2]]));
}
async function runtime(){
  assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
  assert.ok(Number(process.versions.node.split('.')[0])>=24);assert.equal(process.getuid(),99);assert.equal(process.getgid(),100);
  const db=new DatabaseSync(':memory:');assert.equal(db.prepare('SELECT 1 AS value').get().value,1);db.close();
  for(const name of ['ffmpeg','ffprobe'])await run(decoder+name,['-version'],{quiet:true});
  await assert.rejects(fs.writeFile('/image-smoke-must-be-readonly','fixture'),{code:'EROFS'});
  const none={CapEff:'0000000000000000',CapPrm:'0000000000000000',CapBnd:'0000000000000000'};
  assert.deepEqual(await capabilities('self'),none,'Capabilities were not dropped');
}
// The container started through the image's own ENTRYPOINT/CMD: tini as PID 1 runs the supervisor,
// which runs Review. Docker's --init is not used, so tini must come from the image.
async function supervisorTree(){
  const list=await processes(),init=list.find(p=>p.pid===1);
  assert.deepEqual(init?.argv,['/usr/bin/tini','--','/usr/bin/node','/review-app/supervisor.mjs']);
  assert.deepEqual(await capabilities(1),await capabilities('self'));
  const supervisor=list.find(p=>p.ppid===1&&p.argv.join(' ')==='/usr/bin/node /review-app/supervisor.mjs');
  assert.ok(supervisor,'tini does not run the supervisor');
  assert.ok(list.some(p=>p.ppid===supervisor.pid&&p.argv.at(-1)==='/review-app/server.mjs'),'The supervisor does not run Review');
  return {list,supervisor};
}
const base='http://127.0.0.1:8270',origin='http://review.example.invalid:48270';
// Deliberately differ from the listener: reverse proxies/custom host ports
// must be honored without resolving or connecting to any external address.
// Node fetch/Undici rewrites Host to the physical URL. Use the HTTP API so
// the configured public Host is preserved while the socket stays loopback.
const request=(route,options={})=>new Promise((resolve,reject)=>{
  const req=http.request(base+route,{method:options.method||'GET',headers:{host:new URL(origin).host,origin,...options.headers},signal:options.signal||AbortSignal.timeout(2000)},res=>{
    res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,headers:{get(name){const value=res.headers[name.toLowerCase()];return Array.isArray(value)?value.join('; '):value??null;}}}));res.resume();
  });
  req.on('error',reject);req.end(options.body);
});
async function reviewReady(){
  let lastProbe='no response';
  await eventually('Review',async()=>{try{const response=await request('/',{signal:AbortSignal.timeout(1000)});lastProbe='HTTP '+response.status;return response.status===200;}catch(e){lastProbe=e.code||e.name||'request error';return false;}},10000)
    .catch(()=>{throw Error('Review default entrypoint did not start; last probe: '+lastProbe);});
  await run(process.execPath,['/review-app/healthcheck.mjs'],{quiet:true});
}
const readState=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const waitForRecovery=state=>eventually('Recovery '+state,async()=>{const s=await readState(runtimeState);return s.state===state&&s;});
async function review(){
  await runtime();
  await reviewReady();
  assert.equal((await request('/api/items')).status,401);
  const key=await fs.readFile('/data/access-key','utf8');
  assert.ok(key.trim().length>=24);
  const keyStat=await fs.stat('/data/access-key');assert.equal(keyStat.uid,99);assert.equal(keyStat.mode&0o777,0o600);
  const login=await request('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:key.trim()})});
  assert.equal(login.status,200,'Private fixture login failed');
  const cookie=login.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
  assert.equal((await request('/api/settings',{headers:{cookie}})).status,200);
  await fs.writeFile('/data/smoke-write-test','disposable');await fs.unlink('/data/smoke-write-test');
  console.log('Review: default entrypoint, fresh /data, private login and bundled runtime passed.');
  // RECOVERY_MODE is unset: the supervisor records off and never starts the worker.
  const {list}=await supervisorTree();
  assert.deepEqual(workers(list),[]);
  const state=await readState(runtimeState);
  assert.equal(state.mode,'off');assert.equal(state.state,'off');assert.equal(state.lastStartedAt,null);
  console.log('Review: tini runs the supervisor as PID 1; the default Recovery mode off starts no Recovery process.');
}
// RECOVERY_MODE=verify on a fresh volume: no config.json yet.
async function recoveryRefused(){
  await runtime();
  const state=await waitForRecovery('refused');
  assert.equal(state.mode,'verify');assert.equal(state.reason,'missing-config');assert.equal(state.lastExitCode,78);assert.equal(state.restarts,0);
  await reviewReady();
  const {list}=await supervisorTree();assert.deepEqual(workers(list),[]);
  console.log('Recovery: a missing config.json is reported as refused while Review stays healthy.');
  // Fixture for the next start. The worker reads its config only at start.
  await fs.mkdir(path.dirname(sentinel),{recursive:true});
  await fs.mkdir(fixtureRoot+'/reports',{recursive:true});
  await fs.mkdir(fixtureRoot+'/review',{recursive:true});
  await fs.mkdir(fixtureRoot+'/media/.tdarr-corrupt',{recursive:true});
  await fs.writeFile(sentinel,'Disposable sentinel; never decoded or replaced.');
  const db=new DatabaseSync(fixtureRoot+'/database.db');
  db.exec('CREATE TABLE jobsjsondb (json_data TEXT); CREATE TABLE filejsondb (json_data TEXT)');db.close();
  const radarr='http://127.0.0.1:'+mockPort;
  const cfg={radarrUrl:radarr,tdarrUrl:radarr,radarrApiKey:'disposable-fixture-key',libraryId:'smoke-library',sourceRoot:'/media/movies',mediaRoot:media,radarrRoot:'/media',reviewRoot:fixtureRoot+'/review',reviewPrefixes:[],quarantineRoot:fixtureRoot+'/media/.tdarr-corrupt',database:fixtureRoot+'/database.db',reports:fixtureRoot+'/reports',ffmpeg:decoder+'ffmpeg',stableMinutes:0,decodeTimeoutHours:1,confirmDelaySeconds:1,maxRepairsPerDay:3,movieCooldownDays:30,pollSeconds:1,detectTerminalHeaders:true,since:0,approvedCaseIds:[],approvedImportRepairs:{}};
  await fs.writeFile('/data/recovery/config.json',JSON.stringify(cfg),{mode:0o600});
  const before=await fs.stat(sentinel);
  await fs.writeFile(fixtureRoot+'/sentinel.json',JSON.stringify({dev:before.dev,ino:before.ino,size:before.size,mtimeMs:before.mtimeMs,ctimeMs:before.ctimeMs}));
}
// Restarted with the fixture config: the supervisor runs the actual worker under ionice/nice.
async function recoveryRunning(){
  await runtime();
  const requests=[];
  const mock=http.createServer((req,res)=>{
    requests.push({method:req.method,url:req.url});
    res.setHeader('content-type','application/json');
    if(req.method==='GET'&&req.url==='/api/v3/movie'){res.end('[]');return;}
    res.writeHead(500);res.end('{"error":"Unexpected fixture request"}');
  });
  await new Promise(r=>mock.listen(mockPort,'127.0.0.1',r));
  try{
    const {supervisor}=await supervisorTree();
    const running=await waitForRecovery('running');
    assert.equal(running.mode,'verify');assert.equal(running.reason,null);
    // ionice and nice replace themselves with node, so the worker is the supervisor's child once
    // both have run; until then the same process still shows ionice or nice with the worker path.
    const recovery=await eventually('the Recovery worker',async()=>(await processes()).find(p=>p.argv[1]===worker));
    assert.equal(recovery.ppid,supervisor.pid);assert.equal(recovery.argv.length,2);
    assert.equal(recovery.nice,19);
    assert.match(await run('/usr/bin/ionice',['-p',String(recovery.pid)],{quiet:true}),/^best-effort: prio 7$/m);
    const environment=(await fs.readFile(`/proc/${recovery.pid}/environ`,'utf8')).split('\0');
    assert.ok(environment.includes('DATA_ROOT=/data/recovery'));assert.ok(environment.includes('RECOVERY_MODE=verify'));
    // A pass that ran before the mock listened records a failed Radarr request, and the saved
    // state may still be from that pass; wait for one whose requests all reached the mock.
    const state=await eventually('a successful Recovery pass',async()=>{const s=await readState('/data/recovery/state.json');return requests.length>0&&s.lastError===null&&!('languageMetadataError' in s)&&s;});
    assert.deepEqual(state.cases,{});assert.deepEqual(state.jobs,{});
    assert.ok(requests.every(r=>r.method==='GET'&&r.url==='/api/v3/movie'),JSON.stringify(requests));
    const before=await readState(fixtureRoot+'/sentinel.json'),after=await fs.stat(sentinel);
    for(const k of Object.keys(before))assert.equal(after[k],before[k],`Sentinel changed: ${k}`);
    assert.deepEqual(await fs.readdir(path.dirname(sentinel)),['fixture.mkv']);
    assert.deepEqual(await fs.readdir(fixtureRoot+'/media/.tdarr-corrupt'),[]);
    assert.deepEqual(JSON.parse(await fs.readFile(fixtureRoot+'/media/.tdarr-recovery-status.json','utf8')).cases,[]);
    await reviewReady();
    console.log('Recovery: verify runs the actual worker under ionice/nice with /data/recovery as its data root; a dry-run pass left the media unchanged.');
  }finally{await new Promise(r=>mock.close(r));}
}
// The container has been stopped; this fixture container shares only its volume.
async function migration(){
  await runtime();
  const stopped=await readState(runtimeState);
  assert.equal(stopped.state,'stopped');assert.equal(stopped.reason,'shutdown');assert.equal(stopped.lastExitCode,0);assert.equal(stopped.lastExitSignal,null);
  // Exercise the migration utility shipped in the image. Evidence is fictional; no API is called.
  const legacy='/tmp/recovery-registry-fixture.json';await fs.writeFile(legacy,JSON.stringify({config:{},cases:[]}),{mode:0o600});
  const beforeMigration=await fs.readFile('/data/recovery/state.json');
  const migrate=()=>run(process.execPath,['/tools/migrate-recovery-registry.mjs','--source',legacy,'--data','/data/recovery'],{quiet:true});
  const first=JSON.parse(await migrate());
  assert.equal(first.caseCount,0);assert.equal(first.alreadyInstalled,false);
  assert.equal(JSON.parse(await migrate()).alreadyInstalled,true);
  assert.deepEqual(await fs.readFile('/data/recovery/state.json'),beforeMigration);
  assert.equal((await fs.stat('/data/recovery/pending-approvals.json')).mode&0o777,0o600);
  console.log('Recovery: packaged offline registry migration, private persistent evidence and idempotent retry passed.');
}
async function host(){
  const prefix=process.env.SMOKE_PREFIX||'tdarr-review-smoke-'+process.pid;
  assert.match(prefix,/^tdarr-review-smoke-[A-Za-z0-9-]+$/);
  const names={review:prefix+'-review',integration:prefix+'-integration',recovery:prefix+'-recovery',migration:prefix+'-migration'},volumes=[prefix+'-review-data',prefix+'-recovery-data'];
  const script=fileURLToPath(import.meta.url),label='org.tdarr-review.smoke',image='tdarr-review:smoke';
  const common=['--label',label+'='+prefix,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','1g','--cpus','1','--pids-limit','128','--tmpfs','/tmp:rw,noexec,nosuid,size=128m'];
  const reviewEnv=['-e','PUBLIC_ORIGIN=http://review.example.invalid:48270','-e','TDARR_URL=http://127.0.0.1:1'];
  // Docker's copy API rejects a readonly rootfs even for a writable tmpfs.
  // Write only the disposable tmpfs file through the unprivileged process.
  const copyScript=async name=>run('docker',['exec','-i',name,'/usr/bin/node','-e',"require('node:fs').writeFileSync('/tmp/docker-smoke.mjs', require('node:fs').readFileSync(0))"],{input:await fs.readFile(script),quiet:true});
  const inside=(name,mode,timeout=60000)=>run('docker',['exec',name,'/usr/bin/node','/tmp/docker-smoke.mjs',mode],{timeout});
  const existingContainers=(await run('docker',['ps','-a','--format','{{.Names}}'],{quiet:true})).trim().split('\n');
  const existingVolumes=(await run('docker',['volume','ls','--format','{{.Name}}'],{quiet:true})).trim().split('\n');
  assert.ok(Object.values(names).every(n=>!existingContainers.includes(n))&&volumes.every(v=>!existingVolumes.includes(v)),'Disposable resource name already exists');
  try{
    for(const v of volumes)await run('docker',['volume','create','--label',label+'='+prefix,v],{quiet:true});
    const info=JSON.parse(await run('docker',['image','inspect',image],{quiet:true}))[0];
    assert.equal(info.Os,'linux');assert.equal(info.Architecture,'amd64');
    assert.deepEqual(info.Config.Entrypoint,['/usr/bin/tini','--']);
    assert.deepEqual(info.Config.Cmd,['/usr/bin/node','/review-app/supervisor.mjs']);
    await run('docker',['run','-d','--name',names.review,...common,'--mount',`type=volume,source=${volumes[0]},target=/data`,...reviewEnv,image],{quiet:true});
    await copyScript(names.review);
    await inside(names.review,'inside-review');
    for(const fixture of ['test-av-fixture.mjs','test-av-http.mjs','test-preview-cache-http.mjs']){
      // Exercise modules from this exact image; copy only the disposable test driver into tmpfs.
      const contents=(await fs.readFile(new URL(fixture,import.meta.url),'utf8')).replaceAll("'../review/","'/review-app/");
      await run('docker',['exec','-i',names.review,'/usr/bin/node','-e',"require('node:fs').writeFileSync('/tmp/av-smoke.mjs', require('node:fs').readFileSync(0))"],{input:contents,quiet:true});
      await run('docker',['exec','-e','FFMPEG='+decoder+'ffmpeg','-e','FFPROBE='+decoder+'ffprobe',names.review,'/usr/bin/node','/tmp/av-smoke.mjs'],{timeout:fixture==='test-preview-cache-http.mjs'?240000:180000});
    }
    await run('docker',['run','--rm','--name',names.integration,...common,'-e','FFMPEG='+decoder+'ffmpeg','-e','FFPROBE='+decoder+'ffprobe','--entrypoint','/usr/bin/node',image,'/review-app/integration.mjs'],{timeout:180000});
    // Recovery in the same image, started through its own entrypoint with RECOVERY_MODE=verify.
    await run('docker',['run','-d','--name',names.recovery,...common,'--mount',`type=volume,source=${volumes[1]},target=/data`,...reviewEnv,'-e','RECOVERY_MODE=verify',image],{quiet:true});
    await copyScript(names.recovery);
    await inside(names.recovery,'inside-recovery-refused');
    // A restart starts the supervisor, and so the worker, again; tmpfs starts empty.
    await run('docker',['restart','--time','10',names.recovery],{quiet:true});
    await copyScript(names.recovery);
    await inside(names.recovery,'inside-recovery-running');
    // SIGTERM reaches tini, then the supervisor, then Review and Recovery. Docker kills the
    // container (exit 137) if it is still running after 10 s; Review exits 0 after a SIGTERM.
    const started=Date.now();
    await run('docker',['stop','--time','10',names.recovery],{quiet:true});
    const elapsed=Date.now()-started;
    const exit=JSON.parse(await run('docker',['inspect','--format','{{json .State}}',names.recovery],{quiet:true}));
    assert.equal(exit.ExitCode,0,'The container did not exit after SIGTERM by itself');assert.equal(exit.OOMKilled,false);
    assert.ok(elapsed<10000,`The container took ${elapsed} ms to stop`);
    assert.match(await run('docker',['logs','--since',new Date(started-1000).toISOString(),names.recovery],{quiet:true,includeStderr:true}),/Recovery: SIGTERM received/);
    console.log(`Recovery: SIGTERM through tini stopped Review and Recovery in ${elapsed} ms.`);
    await run('docker',['run','-d','--name',names.migration,...common,'--mount',`type=volume,source=${volumes[1]},target=/data`,'-e','RECOVERY_MODE=verify','--entrypoint','/usr/bin/node',image,'-e',"setInterval(()=>{},1000)"],{quiet:true});
    await copyScript(names.migration);
    await inside(names.migration,'inside-migration');
    console.log('Docker smoke passed. Tests used only fresh volumes, synthetic fixtures and container loopback.');
  }catch(e){
    for(const name of Object.values(names)){
      const owner=await run('docker',['inspect','--format',`{{index .Config.Labels "${label}"}}`,name],{quiet:true,timeout:30000}).catch(()=>null);
      if(owner?.trim()===prefix){console.error('Disposable smoke container logs: '+name);await run('docker',['logs','--tail','80',name],{includeStderr:true,timeout:30000}).catch(()=>{});}
    }
    throw e;
  }finally{
    for(const name of Object.values(names)){
      const owner=await run('docker',['inspect','--format',`{{index .Config.Labels "${label}"}}`,name],{quiet:true,timeout:30000}).catch(()=>null);
      if(owner?.trim()===prefix)await run('docker',['rm','-f',name],{quiet:true,timeout:30000}).catch(()=>{});
    }
    for(const v of volumes){
      const owner=await run('docker',['volume','inspect','--format',`{{index .Labels "${label}"}}`,v],{quiet:true,timeout:30000}).catch(()=>null);
      if(owner?.trim()===prefix)await run('docker',['volume','rm',v],{quiet:true,timeout:30000}).catch(()=>{});
    }
  }
}
const modes={'inside-review':review,'inside-recovery-refused':recoveryRefused,'inside-recovery-running':recoveryRunning,'inside-migration':migration};
const mode=process.argv[2];
if(modes[mode])await modes[mode]();else if(!mode)await host();else throw Error('Unknown smoke mode');
