import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const worker=fileURLToPath(new URL('./sonarr-source-worker.mjs',import.meta.url));
const linuxOnly={skip:process.platform!=='linux'?'Source worker verifies the Linux container path namespace':false};
async function run(mediaRoot,relative){
 const output=execFileSync(process.execPath,[worker],{input:JSON.stringify({mediaRoot,relative}),encoding:'utf8',timeout:5000});
 return JSON.parse(output);
}

test('the fixed child reports only metadata for one safe synthetic file',linuxOnly,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sonarr-source-worker-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'Show','Season 01'),{recursive:true});const file=path.join(root,'Show','Season 01','S01E01.mkv');await fs.writeFile(file,'synthetic-media-bytes');await fs.writeFile(path.join(root,'Show','Season 01','S01E01.txt'),'synthetic');
 assert.deepEqual(await run(root,'Show/Season 01/S01E01.mkv'),{status:'present',size:21,modifiedAt:Math.round((await fs.stat(file)).mtimeMs)});
 assert.deepEqual(await run(root,'Show/Season 01/Missing.mkv'),{status:'missing'});
 assert.deepEqual(await run(root,'Show/Season 01/S01E01.txt'),{status:'unsupported'});
});

test('the fixed child rejects symlinked roots and source components',linuxOnly,async t=>{
 const parent=await fs.mkdtemp(path.join(os.tmpdir(),'sonarr-source-link-'));t.after(()=>fs.rm(parent,{recursive:true,force:true}));
 const root=path.join(parent,'root'),outside=path.join(parent,'outside');await fs.mkdir(path.join(root,'Show'),{recursive:true});await fs.mkdir(outside);await fs.writeFile(path.join(outside,'E01.mkv'),'synthetic');
 await fs.symlink(outside,path.join(root,'Alias'));
 assert.deepEqual(await run(root,'Alias/E01.mkv'),{status:'unsafe'});
 const linkRoot=path.join(parent,'root-link');await fs.symlink(root,linkRoot);
 assert.deepEqual(await run(linkRoot,'Show/E01.mkv'),{status:'unsafe'});
});

test('the fixed child rejects hard links without returning path or identity data',linuxOnly,async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sonarr-source-hardlink-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'Show'));await fs.writeFile(path.join(root,'Show','one.mkv'),'synthetic');await fs.link(path.join(root,'Show','one.mkv'),path.join(root,'Show','two.mkv'));
 const output=await run(root,'Show/one.mkv');assert.deepEqual(output,{status:'unsafe'});
 assert.equal(JSON.stringify(output).includes(root),false);assert.equal(Object.hasOwn(output,'fp'),false);assert.equal(Object.hasOwn(output,'ino'),false);
});
