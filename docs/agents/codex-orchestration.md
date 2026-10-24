# Codex subagent orchestration

Use this protocol when a repository task has a bounded part that can be delegated to a Codex subagent. A subagent is a worker with its own context and the same project access as the parent; its role instructions guide its work but do not enforce filesystem, network, account, or tool permissions.

## Run one cycle

1. Inventory the issue, working tree, active claims, and dependencies once. Refresh only the relevant facts when a claim or dependency may have changed.
2. Give each worker a short assignment with the issue and objective, owned scope, safety boundaries, acceptance criteria, required checks, and delivery format.
3. Use one implementation worker by default. Use two only when their work is independent, each has a separate branch or worktree, their file ownership does not overlap, and neither depends on an unfinished decision from the other.
4. Have the worker implement the change and run its targeted checks plus the required final checks. Tests remain required. The parent makes safety decisions, checks acceptance, and coordinates the PR.
5. Request one independent review after implementation and normally one focused correction cycle. Escalate a safety or scope conflict to the maintainer; do not repeat review cycles without a concrete finding to resolve.
6. Collect one bounded report of 300–500 tokens with these fields: `ISSUE`, `STATUS`, `BRANCH`, `COMMIT`, `FILES`, `IMPLEMENTED`, `TESTS`, `RISKS`, `BLOCKERS`, and `NEXT`. State observed results and limits; omit empty progress narration.

## Select roles and fall back

Keep the parent on its configured model. Use a lower-cost model for a worker only when the installed Codex version lists that model and accepts the role's model setting. Keep role instructions narrow: name the owned outcome, safety boundaries, and delivery format, while leaving enforcement to the configured sandbox and approval policy.

Use project-level custom role files only after the installed CLI confirms role discovery and a bounded delegation run. Until then, give the available default worker capability an explicit task scope and report any model or role-selection limit. The project cap of three counts all spawned threads, including explorers and reviewers; it does not set the number of implementation workers. Keep normal tasks to one implementation worker. Do not claim that a role setting provides isolation or access control. If delegation would add unresolved dependencies or overlapping edits, keep the work in the parent task.

When custom role configuration is needed, use the [Codex subagent configuration guide](https://learn.chatgpt.com/docs/agent-configuration/subagents) and [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference), then verify the local CLI can discover and run the roles before adding active project config. The protocol's default is one implementation worker per task.

This repository's strict CLI probe discovered the configured `explorer` role and received its unique instruction acknowledgement. A separate shell-dependent smoke stopped before the fixture test because the local PowerShell helper failed to start. When the CLI reports a shell setup failure, record it and use the supported Codex Desktop execution environment for repository work; role instructions and discovery do not prove shell execution or enforce the sandbox.
