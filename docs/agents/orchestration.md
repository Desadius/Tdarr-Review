# Agent issue cycle and subagent orchestration

Claude Code and Codex work on open issues in `Desadius/Tdarr-Review` in recurring cycles under this protocol. It is the single source for the cycle; scheduler prompts (Codex automation, Claude Code `/issue-cycle`) point here instead of repeating it. Claiming, closing references and PR rules are in [issue-tracker.md](issue-tracker.md); evidence is in [verification.md](verification.md).

A subagent is a worker with its own context and the same project access as the parent; its role instructions guide its work but do not enforce filesystem, network, account, or tool permissions.

## Run one cycle

1. **Inventory once.** Read `origin/main`, open issues, open PRs, active claims and dependencies once per cycle. Afterwards refresh only facts that may have changed; do not reread unchanged sources, diffs or full logs.
2. **Clean up merged work.** For each of your own PRs that GitHub reports as `MERGED` since the last cycle, run the [post-merge cleanup](#clean-up-after-a-merge).
3. **Finish your own work first.** Your work is an issue with your claim comment and an open PR from your branch prefix (`claude/*` or `codex/*`). Handle failing CI caused by your change, review comments and conflicts with `main`. Then check the remaining acceptance criteria of parent issues: a merged partial foundation does not complete the whole feature.
4. **Pick new work.** Only then choose the next free `ready-for-agent` issue that is not claimed, blocked by an open issue or unmerged PR, or dependent on your unmerged PR. Prefer slices that are usable on their own. Respect other agents' claims, dependencies and requested grilling. Triage of `needs-triage` and `needs-info` issues is not part of the cycle; it runs on request.
5. **Ask once.** Collect every question that needs a maintainer decision into one set. While waiting, do not repeat it; continue with independent authorized work.
6. **Delegate and accept.** Follow [Delegate a task](#delegate-a-task). Open the PR with `Closes #N`, assumptions in the description and evidence in a comment. Never merge.
7. **Report only what matters.** A cycle with no change, or one only waiting for an answer, an agent or non-actionable CI, ends with one line at most. Report completion, a significant change, an error or a decision the maintainer must make.

The maintainer merges pull requests, closes issues and handles other agents' work. Production access, deployment, releases and version bumps need an explicit request in the current conversation (`AGENTS.md`).

## Delegate a task

The parent keeps priorities, architecture, safety decisions and acceptance. Routine exploration, implementation, required tests, one independent review and CI watching go to lower-cost workers.

1. Give each worker a short assignment with the issue and objective, owned scope, safety boundaries, acceptance criteria, required checks, and delivery format.
2. Use one implementation worker by default. Use two only when their work is independent, each has a separate branch or worktree, their file ownership does not overlap, and neither depends on an unfinished decision from the other. The cap of three spawned threads per cycle counts explorers, reviewers and cleanup workers too; it does not set the number of implementation workers.
3. Have the worker implement the change and run its targeted checks plus the required final checks. Tests remain required. The parent makes safety decisions, checks acceptance, and coordinates the PR.
4. Request one independent review after implementation and normally one focused correction cycle. Escalate a safety or scope conflict to the maintainer; do not repeat review cycles without a concrete finding to resolve.
5. Collect one bounded report of 300–500 tokens with these fields: `ISSUE`, `STATUS`, `BRANCH`, `COMMIT`, `FILES`, `IMPLEMENTED`, `TESTS`, `RISKS`, `BLOCKERS`, and `NEXT`. State observed results and limits; omit empty progress narration.

If delegation would add unresolved dependencies or overlapping edits, keep the work in the parent task. Do not claim that a role setting provides isolation or access control.

## Clean up after a merge

Each agent cleans up only after its own PRs, and only those GitHub reports as `MERGED`. GitHub deletes the merged head branch itself (`delete_branch_on_merge`); agents never delete remote branches. Run the commands from the main clone, not from inside the worktree being removed.

1. Read the PR: `gh pr view <number> --json state,headRefName,headRefOid,closingIssuesReferences`. Continue only when `state` is `MERGED` and `headRefName` starts with your own prefix.
2. Remove the worktree with `git worktree remove <path>` only when `git -C <path> status --porcelain` is empty and its `HEAD` equals `headRefOid`. Never use `--force`. Then run `git worktree prune`.
3. Delete the local branch with `git branch -D <branch>` only when `git rev-parse <branch>` equals `headRefOid`; this also covers squash merges.
4. For each closed issue in `closingIssuesReferences`, remove `in progress` with `gh issue edit <number> --remove-label "in progress"` unless another agent's active claim remains.
5. On any mismatch (unmerged PR, dirty worktree, unpushed or different commits, someone else's branch), change nothing for that PR and report the reason.

## Claude Code: roles and models

The cycle runs in one dedicated control session started from the Linux clone in WSL2, with worktrees beside it: `/loop 30m /issue-cycle`. The skill in `.claude/skills/issue-cycle/` only points to this protocol. The parent session keeps its configured model.

| Role | Definition | Model | Use |
|---|---|---|---|
| explorer | built-in `Explore` agent | its default | Read-only mapping of a bounded code area |
| implementer | `.claude/agents/implementer.md` | `sonnet`, medium effort | One bounded change with its tests and checks |
| reviewer | `.claude/agents/reviewer.md` | `sonnet`, high effort, no edit tools | Independent review of one change |
| cleanup | `.claude/agents/cleanup.md` | `haiku`, low effort | Post-merge cleanup above |

## Codex: roles and models

`.codex/config.toml` enables subagents with `gpt-6-luna` as the default worker model and a cap of three threads; roles live in `.codex/agents/` (`explorer`, `implementer`, `reviewer`, `cleanup`). The cycle runs as a Codex Desktop heartbeat automation targeting one thread.

Keep the parent on its configured model. Use a lower-cost model for a worker only when the installed Codex version lists that model and accepts the role's model setting. Keep role instructions narrow: name the owned outcome, safety boundaries, and delivery format, while leaving enforcement to the configured sandbox and approval policy.

Use project-level custom role files only after the installed CLI confirms role discovery and a bounded delegation run. Until then, give the available default worker capability an explicit task scope and report any model or role-selection limit. When custom role configuration is needed, use the [Codex subagent configuration guide](https://learn.chatgpt.com/docs/agent-configuration/subagents) and [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference), then verify the local CLI can discover and run the roles before adding active project config.

This repository's strict CLI probe discovered the configured `explorer` role and received its unique instruction acknowledgement. A separate shell-dependent smoke stopped before the fixture test because the local PowerShell helper failed to start. When the CLI reports a shell setup failure, record it and use the supported Codex Desktop execution environment for repository work; role instructions and discovery do not prove shell execution or enforce the sandbox.
