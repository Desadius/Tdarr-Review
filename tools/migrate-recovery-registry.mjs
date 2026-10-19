import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {migrateApprovalRegistry} from '../recovery/approval-registry.mjs';
import {RecoveryRefusal} from '../recovery/recovery-mode.mjs';
import {readRecoveryConfiguration} from '../recovery/recovery-authority.mjs';

// Offline only. Stop Recovery before invoking this tool. It never calls an API,
// changes a movie, or derives authorization from the persisted case journal.
export async function main(args=process.argv.slice(2),env=process.env){
 const options={};
 for(let i=0;i<args.length;i+=2){
  if(!['--source','--data'].includes(args[i])||!args[i+1]||Object.hasOwn(options,args[i]))throw Error('Usage: node tools/migrate-recovery-registry.mjs --source /absolute/legacy/pending-approvals.json --data /absolute/recovery/data');
  options[args[i]]=args[i+1];
 }
 if(!options['--source']||!options['--data']||!path.isAbsolute(options['--data']))throw Error('Explicit --source and absolute --data are required. Stop Recovery first.');
 const data=options['--data'];
 // Avoid printing filesystem errors or raw private JSON on failure.
 // Validate against the configuration the worker would run with, including RECOVERY_MODE.
 const {cfg}=await readRecoveryConfiguration({data,mode:env.RECOVERY_MODE,checkActivation:false});
 const state=JSON.parse(await fs.readFile(path.join(data,'state.json'),'utf8'));
 return migrateApprovalRegistry({source:options['--source'],data,cfg,state});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(await main(),null,2));}
 catch(e){console.error(e.code==='RECOVERY_APPROVAL_REGISTRY'||e instanceof RecoveryRefusal?e.message:'Recovery registry migration failed; no registry overwrite was performed. Check the private files and permissions.');process.exitCode=1;}
}
