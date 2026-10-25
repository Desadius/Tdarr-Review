import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

async function commandRules(){
 const claude=JSON.parse(await fs.readFile(new URL('../.claude/settings.json',import.meta.url),'utf8'));
 const source=await fs.readFile(new URL('../.codex/rules/tdarr-review.rules',import.meta.url),'utf8');
 // Execute this repository's data-only prefix_rule calls with a collector.
 // Their named-argument syntax differs from JavaScript object literals only
 // in delimiters and assignment. The actual patterns, not a duplicate list,
 // supply the command prefixes compared with Claude's configuration.
 const rules=[];
 const script=source.replace(/^#.*$/gm,'').replace(/prefix_rule\(/g,'prefix_rule({').replace(/\)\s*(?=prefix_rule|$)/g,'});\n').replace(/\b(pattern|decision|justification|match|not_match)\s*=/g,'$1:');
 vm.runInNewContext(script,{prefix_rule:rule=>rules.push(rule)},{timeout:1000});
 const expand=pattern=>pattern.reduce((rows,part)=>rows.flatMap(row=>(Array.isArray(part)?part:[part]).map(word=>[...row,word])),[[]]);
 const codex=decision=>rules.filter(rule=>rule.decision===decision).flatMap(rule=>expand(rule.pattern).map(words=>words.join(' ')));
 return {claude:claude.permissions,codex};
}

async function allowedCommands(){
 const {claude,codex}=await commandRules();
 return {claude:claude.allow.map(value=>value.slice(5,-1).replace(/ \*$/,'')).sort(),codex:codex('allow').sort()};
}

test('Claude and Codex allow the same repository command prefixes',async()=>{
 const {claude,codex}=await allowedCommands();assert.deepEqual(codex,claude);
});

test('both agents allow read-only label listing without allowing label edits',async()=>{
 const values=await allowedCommands();
 for(const [agent,commands] of Object.entries(values)){
  assert.ok(commands.includes('gh label list'),agent+' permits label listing');
  assert.deepEqual(commands.filter(value=>value.startsWith('gh label')),['gh label list'],agent+' keeps label writes outside the allowlist');
 }
});

test('both agents allow worktree removal but refuse it when forced',async()=>{
 const {claude,codex}=await commandRules();const values=await allowedCommands();
 for(const commands of Object.values(values)) for(const command of ['git worktree remove','git worktree prune']) assert.ok(commands.includes(command),command);
 assert.deepEqual(codex('forbidden').filter(value=>value.startsWith('git worktree')).sort(),['git worktree remove --force','git worktree remove -f']);
 const denied=claude.deny.map(value=>new RegExp('^'+value.slice(5,-1).replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*')+'$'));
 for(const command of ['git worktree remove --force ../x','git worktree remove ../x --force','git worktree remove -f ../x','git worktree remove ../x -f']) assert.ok(denied.some(rule=>rule.test(command)),command);
 assert.ok(!denied.some(rule=>rule.test('git worktree remove ../Tdarr-Review-fix-topic')),'a path containing -f stays allowed');
});
