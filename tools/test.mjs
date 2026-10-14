import {spawnSync} from 'node:child_process';
import {listTestFiles,testRunnerFlags} from './test-options.mjs';
const flags=testRunnerFlags(process.argv.slice(2));
const files=await listTestFiles();
const result=spawnSync(process.execPath,[...flags,...files],{stdio:'inherit'});
if(result.error)throw result.error;
process.exit(result.status??1);
