import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {listTestFiles,testRunnerFlags} from './test-options.mjs';
// Runs chosen suite files on demand (the "Linux tests (manual)" workflow). Only files npm test runs are accepted.
export function selectedRunnerArgs({files='',namePattern='',available}){
  const chosen=files.split(/\s+/).filter(Boolean);
  for(const file of chosen)if(!available.includes(file))throw Error('Not a test file of npm test: '+file);
  return [...testRunnerFlags([]),...(namePattern?['--test-name-pattern='+namePattern]:[]),...(chosen.length?chosen:available)];
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  let args;
  try{args=selectedRunnerArgs({files:process.env.TEST_FILES,namePattern:process.env.TEST_NAME_PATTERN,available:await listTestFiles()});}
  catch(error){console.error(error.message);process.exit(2);}
  const result=spawnSync(process.execPath,args,{stdio:'inherit'});
  if(result.error)throw result.error;
  process.exit(result.status??1);
}
