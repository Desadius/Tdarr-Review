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

There are no npm dependencies to install. Use Linux and Node 24.

```bash
npm run check   # JavaScript syntax check
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

## Releases and deployment

Source publication, Docker image publication and updating a running installation are three separate steps, each needing the maintainer's explicit approval (`docs/RELEASES.md`). Agents must not:

- run the `Publish Docker images (manual)` workflow, push tags or move `latest`;
- deploy to or restart any Unraid/server installation;
- bump the version in `package.json` unless asked.

When a change is user-visible, add an entry to `CHANGELOG.md` under an unreleased heading and update the relevant document in `docs/`.

## Working alongside other agents

- Work on your own branch (for example `codex/<topic>` or `claude/<topic>`) and propose changes through a pull request into `main`. Do not push directly to `main`.
- Do not work on a branch another agent is currently using. To continue someone else's work, start from their branch or PR only when the maintainer asks.
- Keep pull requests focused on one change and describe what was tested.

## Style

- ES modules (`.mjs`) by default; keep existing `.cjs` files as they are.
- Follow the surrounding code style; avoid adding dependencies.
- UI text exists in English and Czech: update both message sets (see `docs/UI-LANGUAGES.md`) when changing interface strings.
- Code, comments and documentation are written in English; `docs/README-CS.md` is the Czech overview.
