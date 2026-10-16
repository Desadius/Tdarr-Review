import fs from 'node:fs/promises';
import path from 'node:path';
import {listTestFiles} from './test-options.mjs';
// Ratchet: tests exercise behaviour instead of matching implementation source text (CODING_STANDARDS.md).
// Each entry lists, once per read, the source files a suite file still reads. Shrink it as tests are rewritten.
export const SOURCE_TEXT_ALLOWLIST={
 // This suite executes app.js and its real import graph in a browser-module VM.
 'review/app-runtime.test.mjs':['public/app.js'],
 'review/app-version.test.mjs':['server.mjs','routes/items.mjs'],
 'review/audio-listen.test.mjs':['public/comparison.js'],
 'review/error-codes.test.mjs':['public/app.js','routes/static.mjs'],
 'review/i18n.test.mjs':['public/quarantine.js','public/settings-dialogs.js','public/app.js'],
 'review/prepared-frontend.test.mjs':['public/comparison.js'],
 'review/radarr-replacement.test.mjs':['routes/library.mjs'],
 'review/recovery-route.test.cjs':['../examples/tdarr/recovery-review-route.cjs'],
 'review/rejection-audit.test.mjs':['public/app.js','public/ui-kit.js'],
 'review/tdarr-guard.test.cjs':['examples/tdarr/review-guard.cjs'],
 'review/test-artwork.mjs':['server.mjs','routes/library.mjs','routes/static.mjs'],
 'recovery/full-hash.test.mjs':['worker.mjs','waiting-source.mjs']
};
export function sourceTextReads(text){
  const reads=[];
  for(const call of text.matchAll(/readFile(?:Sync)?\(/g)){
    const args=text.slice(call.index+call[0].length).split(/;|\n|readFile/)[0];
    const literal=[...args.matchAll(/(['"`])([^'"`\n]+?\.[mc]?js)\1/g)][0];
    if(literal)reads.push(literal[2].replace(/^\.\//,''));
  }
  return reads;
}
export async function sourceTextViolations(root='.',allowed=SOURCE_TEXT_ALLOWLIST){
  const violations=[],files=await listTestFiles(root);
  for(const file of [...new Set([...files,...Object.keys(allowed)])].sort()){
    const remaining=[...(allowed[file]||[])];
    const reads=files.includes(file)?sourceTextReads(await fs.readFile(path.join(root,file),'utf8')):[];
    for(const target of reads){
      const index=remaining.indexOf(target);
      if(index>=0)remaining.splice(index,1);
      else violations.push(file+' reads the source text of '+target+'; test its behaviour instead (CODING_STANDARDS.md).');
    }
    for(const target of remaining)violations.push(file+' no longer reads '+target+'; remove it from SOURCE_TEXT_ALLOWLIST in tools/source-text-tests.mjs.');
  }
  return violations;
}
