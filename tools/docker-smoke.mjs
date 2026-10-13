import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';

// No production mounts, published ports, real API keys or external network.
const decoder='/app/Tdarr_Node/assets/app/ffmpeg/linux_x64/';
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
async function runtime(){
  assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
  assert.ok(Number(process.versions.node.split('.')[0])>=24);assert.equal(process.getuid(),99);assert.equal(process.getgid(),100);
  const db=new DatabaseSync(':memory:');assert.equal(db.prepare('SELECT 1 AS value').get().value,1);db.close();
  for(const name of ['ffmpeg','ffprobe'])await run(decoder+name,['-version'],{quiet:true});
  await assert.rejects(fs.writeFile('/image-smoke-must-be-readonly','fixture'),{code:'EROFS'});
}
async function review(){
  await runtime();
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
  let ready=false,lastProbe='no response';
  for(let i=0;i<100;i++){try{const response=await request('/',{signal:AbortSignal.timeout(1000)});lastProbe='HTTP '+response.status;if(response.status===200){ready=true;break;}}catch(e){lastProbe=e.code||e.name||'request error';}await new Promise(r=>setTimeout(r,100));}
  assert.ok(ready,'Review default entrypoint did not start; last probe: '+lastProbe);
  assert.equal((await request('/api/items')).status,401);
  const key=await fs.readFile('/data/access-key','utf8');
  assert.ok(key.trim().length>=24);
  const keyStat=await fs.stat('/data/access-key');assert.equal(keyStat.uid,99);assert.equal(keyStat.mode&0o777,0o600);
  const login=await request('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:key.trim()})});
  assert.equal(login.status,200,'Private fixture login failed');
  const cookie=login.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
  assert.equal((await request('/api/settings',{headers:{cookie}})).status,200);
  await run(process.execPath,['/review-app/healthcheck.mjs'],{quiet:true});
  await fs.writeFile('/data/smoke-write-test','disposable');await fs.unlink('/data/smoke-write-test');
  console.log('Review: default entrypoint, fresh /data, private login and bundled runtime passed.');
}
async function recovery(){
  await runtime();
  const root='/data/smoke-fixture',media=root+'/media/movies',sentinel=media+'/Unchanged/fixture.mkv';
  await fs.mkdir(path.dirname(sentinel),{recursive:true});
  await fs.mkdir(root+'/reports',{recursive:true});
  await fs.mkdir(root+'/review',{recursive:true});
  await fs.mkdir(root+'/media/.tdarr-corrupt',{recursive:true});
  await fs.writeFile(sentinel,'Disposable sentinel; never decoded or replaced.');
  const before=await fs.stat(sentinel),contents=await fs.readFile(sentinel);
  const db=new DatabaseSync(root+'/database.db');
  db.exec('CREATE TABLE jobsjsondb (json_data TEXT); CREATE TABLE filejsondb (json_data TEXT)');db.close();
  const requests=[];
  const mock=http.createServer((req,res)=>{
    requests.push({method:req.method,url:req.url});
    res.setHeader('content-type','application/json');
    if(req.method==='GET'&&req.url==='/api/v3/movie'){res.end('[]');return;}
    res.writeHead(500);res.end('{"error":"Unexpected fixture request"}');
  });
  await new Promise(r=>mock.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+mock.address().port;
  const cfg={enabled:false,radarrUrl:base,tdarrUrl:base,radarrApiKey:'disposable-fixture-key',libraryId:'smoke-library',sourceRoot:'/media/movies',mediaRoot:media,radarrRoot:'/media',reviewRoot:root+'/review',reviewPrefixes:[],quarantineRoot:root+'/media/.tdarr-corrupt',database:root+'/database.db',reports:root+'/reports',ffmpeg:decoder+'ffmpeg',stableMinutes:0,decodeTimeoutHours:1,confirmDelaySeconds:1,maxRepairsPerDay:3,movieCooldownDays:30,pollSeconds:300,detectTerminalHeaders:true,since:0,approvedCaseIds:[],approvedImportRepairs:{}};
  await fs.writeFile('/data/config.json',JSON.stringify(cfg),{mode:0o600});
  try{
    // Use the actual configured entrypoint/CMD, passed by the host inspection.
    // The fixture parent only supplies loopback APIs and disposable data.
    const entry=JSON.parse(process.env.SMOKE_ENTRYPOINT),cmd=JSON.parse(process.env.SMOKE_CMD);
    assert.deepEqual(entry,['/usr/bin/ionice']);
    assert.deepEqual(cmd,['-c','2','-n','7','/usr/bin/nice','-n','19','/usr/bin/node','/app-recovery/worker.mjs']);
    await run(entry[0],[...entry.slice(1),...cmd,'--once'],{timeout:30000});
    const state=JSON.parse(await fs.readFile('/data/state.json','utf8'));
    assert.equal(state.lastError,null);assert.equal(state.languageMetadataError,undefined);
    assert.deepEqual(state.cases,{});assert.deepEqual(state.jobs,{});
    assert.deepEqual(requests,[{method:'GET',url:'/api/v3/movie'}]);
    // Exercise the migration utility shipped in the actual Recovery image.
    // Worker has exited; evidence is fictional, APIs remain loopback-only.
    const legacy='/tmp/recovery-registry-fixture.json';await fs.writeFile(legacy,JSON.stringify({config:{},cases:[]}),{mode:0o600});
    const beforeMigration=await fs.readFile('/data/state.json');
    const migration=JSON.parse(await run(process.execPath,['/tools/migrate-recovery-registry.mjs','--source',legacy,'--data','/data'],{quiet:true}));
    assert.equal(migration.caseCount,0);assert.equal(migration.alreadyInstalled,false);
    const again=JSON.parse(await run(process.execPath,['/tools/migrate-recovery-registry.mjs','--source',legacy,'--data','/data'],{quiet:true}));assert.equal(again.alreadyInstalled,true);
    assert.deepEqual(await fs.readFile('/data/state.json'),beforeMigration);assert.deepEqual(requests,[{method:'GET',url:'/api/v3/movie'}]);
    assert.equal((await fs.stat('/data/pending-approvals.json')).mode&0o777,0o600);
    console.log('Recovery: packaged offline registry migration, private persistent evidence and idempotent retry passed.');
    const after=await fs.stat(sentinel);assert.deepEqual(await fs.readFile(sentinel),contents);
    for(const k of ['dev','ino','size','mtimeMs','ctimeMs'])assert.equal(after[k],before[k],`Sentinel changed: ${k}`);
    assert.deepEqual(await fs.readdir(path.dirname(sentinel)),['fixture.mkv']);
    assert.deepEqual(await fs.readdir(root+'/media/.tdarr-corrupt'),[]);
    assert.deepEqual(JSON.parse(await fs.readFile(root+'/media/.tdarr-recovery-status.json','utf8')).cases,[]);
    console.log('Recovery: configured ionice/nice/node entrypoint, one dry-run tick and unchanged media passed.');
  }finally{await new Promise(r=>mock.close(r));}
}
async function host(){
  const prefix=process.env.SMOKE_PREFIX||'tdarr-review-smoke-'+process.pid;
  assert.match(prefix,/^tdarr-review-smoke-[A-Za-z0-9-]+$/);
  const names={review:prefix+'-review',integration:prefix+'-integration',recovery:prefix+'-recovery'},volumes=[prefix+'-review-data',prefix+'-recovery-data'];
  const script=fileURLToPath(import.meta.url),label='org.tdarr-review.smoke';
  const common=['--label',label+'='+prefix,'--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','1g','--cpus','1','--pids-limit','128','--tmpfs','/tmp:rw,noexec,nosuid,size=128m'];
  // Docker's copy API rejects a readonly rootfs even for a writable tmpfs.
  // Write only the disposable tmpfs file through the unprivileged process.
  const copyScript=async name=>run('docker',['exec','-i',name,'/usr/bin/node','-e',"require('node:fs').writeFileSync('/tmp/docker-smoke.mjs', require('node:fs').readFileSync(0))"],{input:await fs.readFile(script),quiet:true});
  const existingContainers=(await run('docker',['ps','-a','--format','{{.Names}}'],{quiet:true})).trim().split('\n');
  const existingVolumes=(await run('docker',['volume','ls','--format','{{.Name}}'],{quiet:true})).trim().split('\n');
  assert.ok(Object.values(names).every(n=>!existingContainers.includes(n))&&volumes.every(v=>!existingVolumes.includes(v)),'Disposable resource name already exists');
  try{
    for(const v of volumes)await run('docker',['volume','create','--label',label+'='+prefix,v],{quiet:true});
    const info=JSON.parse(await run('docker',['image','inspect','tdarr-recovery:smoke'],{quiet:true}))[0];
    assert.equal(info.Os,'linux');assert.equal(info.Architecture,'amd64');
    await run('docker',['run','-d','--name',names.review,...common,'--mount',`type=volume,source=${volumes[0]},target=/data`,'-e','PUBLIC_ORIGIN=http://review.example.invalid:48270','-e','TDARR_URL=http://127.0.0.1:1','tdarr-review:smoke'],{quiet:true});
    await copyScript(names.review);
    await run('docker',['exec',names.review,'/usr/bin/node','/tmp/docker-smoke.mjs','inside-review']);
    for(const fixture of ['test-av-fixture.mjs','test-av-http.mjs','test-preview-cache-http.mjs']){
      // Exercise modules from this exact image; copy only the disposable test driver into tmpfs.
      const contents=(await fs.readFile(new URL(fixture,import.meta.url),'utf8')).replaceAll("'../review/","'/review-app/");
      await run('docker',['exec','-i',names.review,'/usr/bin/node','-e',"require('node:fs').writeFileSync('/tmp/av-smoke.mjs', require('node:fs').readFileSync(0))"],{input:contents,quiet:true});
      await run('docker',['exec','-e','FFMPEG='+decoder+'ffmpeg','-e','FFPROBE='+decoder+'ffprobe',names.review,'/usr/bin/node','/tmp/av-smoke.mjs'],{timeout:fixture==='test-preview-cache-http.mjs'?240000:180000});
    }
    await run('docker',['run','--rm','--name',names.integration,...common,'-e','FFMPEG='+decoder+'ffmpeg','-e','FFPROBE='+decoder+'ffprobe','--entrypoint','/usr/bin/node','tdarr-review:smoke','/review-app/integration.mjs'],{timeout:180000});
    // Start a fixture process so exec can write into its disposable tmpfs;
    // the application entrypoint is then spawned by the fixture script.
    await run('docker',['run','-d','--name',names.recovery,...common,'--mount',`type=volume,source=${volumes[1]},target=/data`,'-e','SMOKE_ENTRYPOINT='+JSON.stringify(info.Config.Entrypoint),'-e','SMOKE_CMD='+JSON.stringify(info.Config.Cmd),'--entrypoint','/usr/bin/node','tdarr-recovery:smoke','-e',"setInterval(()=>{},1000)"],{quiet:true});
    await copyScript(names.recovery);
    await run('docker',['exec',names.recovery,'/usr/bin/node','/tmp/docker-smoke.mjs','inside-recovery'],{timeout:60000});
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
const mode=process.argv[2];
if(mode==='inside-review')await review();else if(mode==='inside-recovery')await recovery();else if(!mode)await host();else throw Error('Unknown smoke mode');
