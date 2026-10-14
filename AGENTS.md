# Agent instructions

Shared instructions for every AI coding agent working in this repository (Codex, Claude Code and others). `CLAUDE.md` points here, so keep one source of truth in this file.

Tdarr Review lets a person review and approve Tdarr transcodes before the original film files in a media library are replaced. Mistakes can destroy someone's original media, so safety rules below take priority over speed or convenience.

## Project layout

- `review/` — web application (`server.mjs`, route modules in `review/routes/`, `core.mjs`, UI modules in `review/public/`) and its regression tests (`*.test.mjs`, `*.test.cjs`, `test.mjs`).
- `recovery/` — optional background worker and its tests.
- `tools/` — syntax checker, test runner, Docker smoke and demo scripts.
- `docs/` — installation, user, architecture, operations, release and verification documentation.
- `examples/`, `templates/`, `fixtures/` — sample configuration, Unraid template and synthetic test data.

Read `docs/ARCHITECTURE.md` before changing replacement, quarantine, journal or recovery code, and `docs/REVIEW-WORKFLOW-DESIGN.md` before changing the review checklist or approval gates.

## Build and test

There are no npm dependencies to install. Use Node 24. Tests that need Linux (directory `fsync`, POSIX modes) skip on other systems, and `npm test` lists them at the end; run them through the `Linux tests (manual)` workflow (`docs/DEVELOPMENT.md`, *Linux tests without Docker*).

```bash
npm run check   # syntax, version and source-text-test checks
npm run typecheck   # JSDoc type check (installs pinned dev-only TypeScript into .typecheck/)
npm test        # full unit/regression suite (review + recovery)
```

Approval-flow changes also need the isolated integration test, which generates short synthetic media and uses a local mock Tdarr API on port 18270:

```bash
FFMPEG=/path/to/ffmpeg FFPROBE=/path/to/ffprobe npm run test:integration
```

Run `npm run check` and `npm test` before every commit you propose. CI (`.github/workflows/test.yml`) runs the same checks plus the Docker image smoke test on every pull request.

## Safety rules (do not relax)

- Preserve file identity checks, origin/authentication enforcement, durable transactions (including directory `fsync`), conservative recovery and quarantine retention.
- Keep the distinction between import, transcode success and explicit human approval. Nothing may approve a film automatically, and loading or playing a preview must never tick a review confirmation.
- Never point tests or scripts at real media, a real Tdarr/Radarr endpoint or production data. Use synthetic files, loopback mocks and temporary directories only.
- Never commit credentials, API keys, `.env`, journals, databases, settings or media files (see `.gitignore`).
- Add a regression test for every meaningful behaviour change.

## Production

The production installation is the maintainer's Unraid server, reachable over SSH. Connection details are private and are not part of this repository.

- Ask the maintainer before every access to production, even a read-only one.
- When reading, never print configuration values, secrets or the contents of the approval registry. Report only what the maintainer asked for.
- Never change anything on production (files, containers, configuration) unless the maintainer explicitly asks for that change in the current conversation.

## Releases and deployment

Source publication, Docker image publication and updating a running installation are three separate steps, each needing the maintainer's explicit approval (`docs/RELEASES.md`). Agents must not:

- run the `Publish Docker images (manual)` workflow, push tags or move `latest`;
- deploy to or restart any Unraid/server installation;
- bump the version in `package.json` unless asked.

When a change is user-visible, add an entry to `CHANGELOG.md` under an unreleased heading and update the relevant document in `docs/`.

## Working alongside other agents

- Work on your own branch (for example `codex/<topic>` or `claude/<topic>`) and propose changes through a pull request into `main`. Do not push directly to `main`.
- Keep the main checkout on `main`. Create every branch (implementation, documentation, a PR from a grilling session) in a new git worktree beside it, for example `git worktree add ../Tdarr-Review-<topic> -b claude/<topic> origin/main`, and remove that worktree with `git worktree remove` once its PR is merged.
- Do not work on a branch another agent is currently using. To continue someone else's work, start from their branch or PR only when the maintainer asks.
- Keep pull requests focused on one change and describe what was tested.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `Desadius/Tdarr-Review` (use the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `GLOSSARY.md` plus `docs/adr/`, created lazily. See `docs/agents/domain.md`.

## Style

- ES modules (`.mjs`) by default; keep existing `.cjs` files as they are.
- Avoid adding dependencies.
- UI text exists in English and Czech: update both message sets (see `docs/UI-LANGUAGES.md`) when changing interface strings.
- Code, comments and documentation are written in English; `docs/README-CS.md` is the Czech overview.
