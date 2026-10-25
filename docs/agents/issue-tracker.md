# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body-file <file>`. For multiline text and escaping, follow [editing.md](editing.md).
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

## Claiming an issue (Codex and Claude share this repo)

Several agents work here and all post as the same GitHub user, so the comment author does not tell them apart.

1. Right before claiming, run `gh issue view <number> --json comments,labels,assignees`. Skip the issue if it has the `in progress` label **or** an active claim comment from another agent. An explicit release by that agent ends its claim; if ownership is unclear, ask the maintainer.
2. Every agent, including Claude and Codex, claims with **both** the `in progress` label (`gh issue edit <number> --add-label "in progress"`) and a comment naming the agent and branch: `<Agent> is working on this issue (branch <agent>/<topic>). Other agents: please skip it.` Assignment (`--add-assignee @me`) is optional and does not replace either part. If either write fails, complete the claim before starting implementation. Re-read labels and comments after claiming to catch a concurrent claim; resolve a collision before proceeding.
3. Work on your own branch in a separate worktree as required by `AGENTS.md`, and open a PR into `main`. The PR description must contain `Closes #N` for the issue it resolves (one reference per resolved issue); an issue comment or mention alone is not a closing reference. The maintainer handles merges and issue closure. After `gh pr create`, comment `PR: #<number>` on the issue. Keep the claim while the PR is active; after the merge, clean up as in [orchestration.md](orchestration.md#clean-up-after-a-merge). If abandoning the work, comment that the claim is released and remove `in progress` only if no other agent owns it.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Claim using the shared procedure above; assignment is optional.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line), an assignee, the `in progress` label or an active claim comment; first in map order wins. Re-read the candidate immediately before claiming as above.
- **Claim**: follow the shared claiming procedure above, including the label and agent-named comment.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
