// Unreleased changelog entries live in changelog.d/, one fragment per change, so parallel pull
// requests never edit the same lines of CHANGELOG.md. A release moves them into CHANGELOG.md.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const FRAGMENT=/^(\d+)-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const NAME_RULE='name must be <issue>-<topic>.md, for example 174-changelog-fragments.md';
const UNRELEASED='## Unreleased\n';

/** Fragments in issue order, then by name. A missing directory has none. */
export async function readFragments(root='.'){
 let names;try{names=await fs.readdir(path.join(root,'changelog.d'))}catch(e){if(e.code==='ENOENT')return [];throw e}
 const fragments=[];
 for(const name of names){const m=FRAGMENT.exec(name);if(m)fragments.push({name,issue:Number(m[1]),text:await fs.readFile(path.join(root,'changelog.d',name),'utf8')})}
 return fragments.sort((a,b)=>a.issue-b.issue||(a.name<b.name?-1:a.name>b.name?1:0));
}

/** Problems with the fragments as "changelog.d/<file>: <reason>", sorted by file name. */
export async function changelogProblems(root='.'){
 let names;try{names=await fs.readdir(path.join(root,'changelog.d'))}catch(e){if(e.code==='ENOENT')return [];throw e}
 const problems=[];
 for(const name of [...names].sort()){
  if(name==='README.md')continue;
  const where='changelog.d/'+name;
  if(!FRAGMENT.test(name)){problems.push(where+': '+NAME_RULE);continue}
  const text=await fs.readFile(path.join(root,'changelog.d',name),'utf8');
  if(/^(?:<{7}|={7}|>{7})/m.test(text)){problems.push(where+': contains a merge conflict marker');continue}
  const entry=text.trim();
  if(!entry.startsWith('- ')){problems.push(where+': a fragment is one Markdown list item starting with "- "');continue}
  if(entry.split('\n').slice(1).some(line=>/^[-*] /.test(line))){problems.push(where+': a fragment holds exactly one list item');continue}
  for(const [,target] of entry.matchAll(/\]\(([^)\s]+)\)/g)){
   if(/^[a-z]+:/i.test(target)||target.startsWith('#'))continue;
   const file=target.split('#')[0];
   try{await fs.access(path.join(root,file))}catch{problems.push(where+': link target '+file+' does not exist (links are relative to the repository root, as in CHANGELOG.md)')}
  }
 }
 return problems;
}

function unreleasedBounds(changelog){
 const start=changelog.indexOf(UNRELEASED);if(start<0)throw Error('CHANGELOG.md has no "## Unreleased" heading');
 const next=changelog.indexOf('\n## ',start+UNRELEASED.length);
 return {start,body:start+UNRELEASED.length,end:next<0?changelog.length:next+1};
}

/** Entries already written under Unreleased, then the fragments. */
export function unreleasedEntries(changelog,fragments){
 const {body,end}=unreleasedBounds(changelog);
 const existing=changelog.slice(body,end).split(/\n(?=- )/).map(text=>text.trim()).filter(text=>text.startsWith('- '));
 return [...existing,...fragments.map(fragment=>fragment.text.trim())];
}

/** Release step: entries go under "## <version> — <date>", the fragments are deleted. */
export async function release(root,{version,date}){
 if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version||''))throw Error('Invalid version: '+version);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||Number.isNaN(Date.parse(date+'T00:00:00Z')))throw Error('Invalid date: '+date+' (use YYYY-MM-DD)');
 const problems=await changelogProblems(root);if(problems.length)throw Error(problems.join('\n'));
 const file=path.join(root,'CHANGELOG.md'),changelog=await fs.readFile(file,'utf8');
 if(changelog.includes('\n## '+version+' '))throw Error('Version '+version+' is already in CHANGELOG.md');
 const fragments=await readFragments(root),entries=unreleasedEntries(changelog,fragments);
 if(!entries.length)throw Error('There is nothing to release');
 const {body,end}=unreleasedBounds(changelog);
 await fs.writeFile(file,changelog.slice(0,body)+'\n## '+version+' — '+date+'\n\n'+entries.join('\n\n')+'\n\n'+changelog.slice(end));
 for(const fragment of fragments)await fs.unlink(path.join(root,'changelog.d',fragment.name));
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.resolve(fileURLToPath(new URL('..',import.meta.url))),args=process.argv.slice(2);
 if(args[0]==='--release'){await release(root,{version:args[1],date:args[2]});console.log('CHANGELOG.md updated; fragments removed.');}
 else{
  const problems=await changelogProblems(root);if(problems.length){for(const line of problems)console.error(line);process.exit(1)}
  console.log(UNRELEASED+'\n'+unreleasedEntries(await fs.readFile(path.join(root,'CHANGELOG.md'),'utf8'),await readFragments(root)).join('\n\n'));
 }
}
