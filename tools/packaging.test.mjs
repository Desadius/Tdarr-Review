import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {OLD_RECOVERY_IMAGE} from './old-recovery-image.mjs';

const read=file=>fs.readFile(new URL('../'+file,import.meta.url),'utf8');

// Unraid template <Config .../> elements as attribute maps, with the element text as value.
function templateConfigs(xml){
 return [...xml.matchAll(/<Config\s([^>]*?)(?:\/>|>([^<]*)<\/Config>)/g)].map(([,attributes,value])=>({
  ...Object.fromEntries([...attributes.matchAll(/(\w+)="([^"]*)"/g)].map(([,key,text])=>[key,text])),value:value??null,
 }));
}

// Top-level service names and the indented block of one service in compose.yaml.
const composeServices=yaml=>[...yaml.replace(/^services:\n/m,'').matchAll(/^ {2}([\w-]+):\s*$/gm)].map(match=>match[1]);
function composeService(yaml,name){
 const start=yaml.indexOf('\n  '+name+':\n');assert.notEqual(start,-1,'service '+name);
 const rest=yaml.slice(start+1);const end=rest.slice(1).search(/^ {2}\S/m);
 return end===-1?rest:rest.slice(0,end+1);
}

test('the Unraid template offers RECOVERY_MODE off, verify or repair, default off',async()=>{
 const xml=await read('templates/tdarr-review.xml');
 const mode=templateConfigs(xml).filter(config=>config.Target==='RECOVERY_MODE');
 assert.equal(mode.length,1);
 assert.equal(mode[0].Type,'Variable');
 // Unraid renders pipe-separated defaults as a dropdown whose first entry is preselected.
 assert.equal(mode[0].Default,'off|verify|repair');
 assert.equal(mode[0].value,'off');
 assert.equal(mode[0].Required,'false');
});

test('the Unraid template sizes limits for Review and Recovery and adds no new required path',async()=>{
 const xml=await read('templates/tdarr-review.xml');
 const extra=/<ExtraParams>([^<]*)<\/ExtraParams>/.exec(xml)?.[1]??'';
 for(const flag of ['--cpus=2','--memory=2g','--pids-limit=256'])assert.ok(extra.split(/\s+/).includes(flag),flag);
 assert.deepEqual(templateConfigs(xml).filter(config=>config.Type==='Path').map(config=>config.Target).sort(),['/data','/media','/review','/tdarr']);
});

test('Compose has one review service with RECOVERY_MODE and the same limits',async()=>{
 const yaml=await read('compose.yaml');
 assert.deepEqual(composeServices(yaml),['review']);
 assert.doesNotMatch(yaml,/profiles:/);
 const review=composeService(yaml,'review');
 assert.match(review,/^ {6}RECOVERY_MODE: "\$\{RECOVERY_MODE:-off\}"$/m);
 assert.match(review,/^ {4}cpus: 2$/m);
 assert.match(review,/^ {4}mem_limit: 2g$/m);
 assert.match(review,/^ {4}pids_limit: 256$/m);
});

test('build, CI, version checks and templates name no separate Recovery image or Dockerfile',async()=>{
 await assert.rejects(fs.access(new URL('../Dockerfile.recovery',import.meta.url)),{code:'ENOENT'});
 const list=async directory=>(await fs.readdir(new URL('../'+directory+'/',import.meta.url))).map(name=>directory+'/'+name);
 const files=['Dockerfile','.dockerignore','compose.yaml','.env.example','package.json','tsconfig.typecheck.json',
  ...await list('templates'),...await list('.github/workflows'),
  // The pattern's own definition necessarily contains the old names.
  ...(await list('tools')).filter(file=>/\.(mjs|sh)$/.test(file)&&!file.endsWith('.test.mjs')&&file!=='tools/old-recovery-image.mjs')];
 for(const file of files)assert.doesNotMatch(await read(file),OLD_RECOVERY_IMAGE,file);
});

test('the example Recovery config uses Review mappings, has no enabled key and passes the start-up checks',async t=>{
 const {resolveRecoveryConfig}=await import('../recovery/recovery-mode.mjs');
 const {loadApprovalRegistry}=await import('../recovery/approval-registry.mjs');
 const text=await read('examples/recovery-config.example.json'),example=JSON.parse(text);
 assert.equal(Object.hasOwn(example,'enabled'),false,'RECOVERY_MODE is the only switch');
 assert.equal(example.mediaRoot,'/media/movies');
 assert.equal(example.quarantineRoot,'/media/.tdarr-corrupt');
 assert.equal(example.reports,'/tdarr/JobReports');
 // Every container path lies inside a mapping the Review template already has.
 for(const key of ['mediaRoot','reviewRoot','quarantineRoot','database','reports'])assert.match(example[key],/^\/(media|review|tdarr)(\/|$)/,key);
 const data=await fs.mkdtemp(path.join(os.tmpdir(),'recovery-example-'));
 t.after(()=>fs.rm(data,{recursive:true,force:true}));
 for(const mode of ['verify','repair']){
  const {cfg}=resolveRecoveryConfig({mode,text});
  assert.equal(cfg.enabled,mode==='repair');
  const registry=await loadApprovalRegistry({data,cfg,state:{version:1,jobs:{},cases:{}}});
  assert.deepEqual(registry.cases,[]);
 }
});
