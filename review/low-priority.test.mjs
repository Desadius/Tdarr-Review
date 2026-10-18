import test from 'node:test';
import assert from 'node:assert/strict';
import {LOW_PRIORITY,lowPriorityCommand} from './low-priority.mjs';
import {spawnPreview} from './preview-process.mjs';

const linux={skip:process.platform!=='linux'?'Requires Linux ionice and nice':false};
const output=child=>new Promise((resolve,reject)=>{let out='';child.stdout.on('data',b=>out+=b);child.once('error',reject);child.once('close',code=>code===0?resolve(out.trim()):reject(Error('exit '+code)));});

test('a lowered command runs through ionice best-effort 7 and nice 19; otherwise it is unchanged',()=>{
 assert.deepEqual(LOW_PRIORITY,['/usr/bin/ionice','-c','2','-n','7','/usr/bin/nice','-n','19']);
 assert.deepEqual(lowPriorityCommand('/usr/bin/ffprobe',['-v','error','a.mkv'],true),['/usr/bin/ionice',['-c','2','-n','7','/usr/bin/nice','-n','19','/usr/bin/ffprobe','-v','error','a.mkv']]);
 assert.deepEqual(lowPriorityCommand('/usr/bin/ffprobe',['-v','error','a.mkv'],false),['/usr/bin/ffprobe',['-v','error','a.mkv']]);
});

test('background previews run at CPU niceness 19 and best-effort I/O priority 7',linux,async()=>{
 assert.equal(await output(spawnPreview('/usr/bin/nice',[],{background:true})),'19');
 assert.equal(await output(spawnPreview('/usr/bin/ionice',[],{background:true})),'best-effort: prio 7');
});

test('on-demand previews keep the server priority',linux,async()=>{
 assert.equal(await output(spawnPreview('/usr/bin/nice',[])),String((await import('node:os')).getPriority()));
});
