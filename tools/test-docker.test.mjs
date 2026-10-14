import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {dockerTestArguments,runDockerTests} from './test-docker.mjs';

test('Docker suite uses only a read-only repository, disposable scratch space and no network',()=>{
  const root=path.resolve('fictional repository with spaces'),args=dockerTestArguments(root);
  const value=name=>args[args.indexOf(name)+1];
  assert.equal(value('--volume'),`${root}:/workspace:ro`);
  assert.equal(value('--workdir'),'/workspace');assert.equal(value('--network'),'none');
  assert(args.includes('--read-only'));assert(args.includes('--rm'));assert(args.includes('--pull=never'));
  assert.equal(value('--platform'),'linux/amd64');assert.equal(value('--cap-drop'),'ALL');
  assert.equal(value('--security-opt'),'no-new-privileges');assert.equal(value('--tmpfs'),'/tmp:rw,exec,nosuid,nodev');
  assert.equal(value('--env'),'NPM_CONFIG_CACHE=/tmp/npm-cache');
  assert.equal(args.filter(v=>v==='--volume').length,1,'no Docker socket, media or runtime-data mounts');
  assert.equal(args.filter(v=>v==='--env').length,1,'no host configuration or credentials forwarded');
  assert.deepEqual(args.slice(-4),['node:24','sh','-c','npm run check && npm test']);
});

// Fake Docker: `image inspect` succeeds only when the test image is present, `pull` and `run` return the given statuses.
function fakeDocker({present=true,pull=0,run=0}={}){
  const calls=[];
  const spawn=(command,args,options)=>{
    calls.push({command,args,options});
    if(args[0]==='image')return {status:present?0:1};
    return {status:args[0]==='pull'?pull:run};
  };
  return {calls,spawn};
}

test('Docker runner passes an argument array without a host shell and preserves failed checks',()=>{
  const root=path.resolve('fictional repository');
  for(const status of [0,1,125]){
    const docker=fakeDocker({run:status});
    assert.equal(runDockerTests({root,spawn:docker.spawn,report:()=>{}}),status);
    const run=docker.calls.at(-1);
    assert.equal(run.command,'docker');assert.deepEqual(run.args,dockerTestArguments(root));assert.deepEqual(run.options,{stdio:'inherit',shell:false});
  }
  assert.equal(runDockerTests({spawn:(command,args)=>args[0]==='image'?{status:0}:{status:null,signal:'SIGTERM'}}),1);
});

test('a present test image is used as is, without contacting a registry',()=>{
  const docker=fakeDocker({present:true}),messages=[];
  assert.equal(runDockerTests({spawn:docker.spawn,report:message=>messages.push(message)}),0);
  assert.deepEqual(docker.calls.map(call=>call.args.slice(0,2)),[['image','inspect'],['run','--rm']]);
  assert.deepEqual(docker.calls[0].args,['image','inspect','--format','{{.Id}}','node:24']);
  assert.equal(docker.calls[0].options.shell,false);
  assert.deepEqual(messages,[]);
});

test('a missing test image is downloaded once on the host before the network-less run',()=>{
  const docker=fakeDocker({present:false}),messages=[];
  assert.equal(runDockerTests({spawn:docker.spawn,report:message=>messages.push(message)}),0);
  assert.deepEqual(docker.calls.map(call=>call.args[0]),['image','pull','run']);
  assert.deepEqual(docker.calls[1].args,['pull','--platform','linux/amd64','node:24']);
  assert.deepEqual(docker.calls[1].options,{stdio:'inherit',shell:false});
  assert(docker.calls[2].args.includes('--pull=never'));
  assert.equal(messages.length,1);assert.match(messages[0],/node:24 is not present locally.*downloading/);
});

test('a failed download stops before any test container and names the command to retry',()=>{
  const docker=fakeDocker({present:false,pull:1}),messages=[];
  assert.equal(runDockerTests({spawn:docker.spawn,report:message=>messages.push(message)}),1);
  assert.deepEqual(docker.calls.map(call=>call.args[0]),['image','pull']);
  assert.match(messages.at(-1),/docker pull --platform linux\/amd64 node:24/);
});

test('missing Docker fails with an actionable prerequisite message',()=>{
  const messages=[];
  assert.equal(runDockerTests({spawn:()=>({error:new Error('ENOENT')}),report:message=>messages.push(message)}),1);
  assert.equal(messages.length,1);assert.match(messages[0],/Unable to start Docker: ENOENT.*Linux containers.*docs\/DEVELOPMENT\.md/);
});
