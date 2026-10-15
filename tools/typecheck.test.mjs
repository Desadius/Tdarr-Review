import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {TOOLS} from './typecheck.mjs';

const read=file=>fs.readFile(new URL('../'+file,import.meta.url),'utf8');

test('type-check tools are pinned exactly and stay out of package.json and the images',async()=>{
 for(const version of Object.values(TOOLS))assert.match(version,/^\d+\.\d+\.\d+$/);
 const pkg=JSON.parse(await read('package.json'));
 for(const field of ['dependencies','devDependencies','optionalDependencies','peerDependencies'])assert.equal(pkg[field],undefined,field);
 assert.equal(pkg.scripts.typecheck,'node tools/typecheck.mjs');
 assert.match(await read('.gitignore'),/^\.typecheck\/$/m);
 assert.doesNotMatch(await read('Dockerfile'),/typecheck|typescript|tsconfig/i);
 assert.match(await read('.github/workflows/test.yml'),/run: npm run typecheck/);
});

test('every file in the type check opts in with // @ts-check',async()=>{
 const config=JSON.parse(await read('tsconfig.typecheck.json'));
 assert.equal(config.compilerOptions.noEmit,true);assert.ok(config.files.length>=2);
 for(const file of config.files)assert.match(await read(file),/^\/\/ @ts-check\n/,file);
});
