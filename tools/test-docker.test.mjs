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
  assert.equal(value('--security-opt'),'no-new-privileges');assert.equal(value('--tmpfs'),'/tmp:rw,nosuid,nodev');
  assert.equal(value('--env'),'NPM_CONFIG_CACHE=/tmp/npm-cache');
  assert.equal(args.filter(v=>v==='--volume').length,1,'no Docker socket, media or runtime-data mounts');
  assert.equal(args.filter(v=>v==='--env').length,1,'no host configuration or credentials forwarded');
  assert.deepEqual(args.slice(-4),['node:24','sh','-c','npm run check && npm test']);
});

test('Docker runner passes an argument array without a host shell and preserves failed checks',()=>{
  const root=path.resolve('fictional repository'),calls=[];
  for(const status of [0,1,125]){
    assert.equal(runDockerTests({root,spawn:(command,args,options)=>{calls.push({command,args,options});return {status}}}),status);
  }
  for(const call of calls){assert.equal(call.command,'docker');assert.deepEqual(call.args,dockerTestArguments(root));assert.deepEqual(call.options,{stdio:'inherit',shell:false})}
  assert.equal(runDockerTests({spawn:()=>({status:null,signal:'SIGTERM'})}),1);
});

test('missing Docker fails with an actionable prerequisite message',()=>{
  const messages=[];
  assert.equal(runDockerTests({spawn:()=>({error:new Error('ENOENT')}),report:message=>messages.push(message)}),1);
  assert.equal(messages.length,1);assert.match(messages[0],/Linux containers.*preload node:24/);
});
