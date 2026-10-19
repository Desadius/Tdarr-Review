import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {changelogProblems} from './changelog.mjs';
import {versionMismatches,moduleVersionLiterals,docVersionMismatches} from './version-consistency.mjs';
import {sourceTextViolations} from './source-text-tests.mjs';
async function walk(root){
  for(const entry of await fs.readdir(root,{withFileTypes:true})){
    const file=path.join(root,entry.name);
    if(entry.isDirectory())await walk(file);
    else if(/\.(?:mjs|cjs|js)$/.test(file)){
      const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});
      if(result.status!==0)process.exit(result.status??1);
    }
  }
}
for(const directory of ['review','recovery','tools'])await walk(directory);
console.log('JavaScript syntax checked.');
const mismatches=[...await versionMismatches(),...await moduleVersionLiterals(),...await docVersionMismatches()];
if(mismatches.length){for(const line of mismatches)console.error('Version mismatch: '+line);process.exit(1);}
console.log('Versions agree with package.json.');
const fragments=await changelogProblems();
if(fragments.length){for(const line of fragments)console.error('Changelog fragment: '+line);process.exit(1);}
console.log('Changelog fragments are valid.');
const sourceText=await sourceTextViolations();
if(sourceText.length){for(const line of sourceText)console.error('Source-text test: '+line);process.exit(1);}
console.log('No new tests read implementation source text.');
