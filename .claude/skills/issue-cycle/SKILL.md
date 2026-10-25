---
name: issue-cycle
description: Run one cycle of work on open Tdarr Review issues as Claude Code. Use with /loop 30m /issue-cycle from the control session in the Linux clone.
---

Run one cycle of `docs/agents/orchestration.md` as Claude Code (branch prefix `claude/`). That file is the only source for the cycle; follow it with `AGENTS.md` and `docs/agents/issue-tracker.md`.

- The control session's checkout stays on `main` and is not edited; work happens in worktrees beside it.
- Delegate with the `implementer`, `reviewer` and `cleanup` agents and the built-in `Explore` agent, at most three per cycle.
- Remember the open question set you already asked; do not ask it again until it is answered.
- If nothing changed, reply with one line.
