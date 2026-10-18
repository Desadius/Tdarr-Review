# Development and verification

Use Node 24. Linux remains the approval deployment target and provides the full suite, including directory `fsync` and Linux filesystem semantics. There are no npm dependencies to install.

```bash
npm run check
npm test
```

Tests that need Linux (directory `fsync`, POSIX permission/ctime assertions, symlink fixtures) skip on other systems. After the normal report, `npm test` lists every skipped test with its reason on stderr, so a green summary cannot hide tests that never ran. On Linux, including WSL2, nothing should be skipped.

The supervisor tests (`review/supervisor.test.mjs`) run real processes with stand-in children, so a test that reads an event it did not wait for would fail only under rare scheduling. `npm test` therefore runs them a second time through `review/supervisor-delayed.test.mjs`, which sets `SUPERVISOR_TEST_DELAY_MS=400`: Review's stand-in starts late and every stand-in pauses right after recording its start. Such a race then fails on every run. Each supervisor test must wait explicitly for every event it reads, including a child's start before signalling it; a stand-in records its start only after its signal handlers are installed. Set the variable yourself (`SUPERVISOR_TEST_DELAY_MS=1000 node --test review/supervisor.test.mjs`) to try other delays.

HTTP server fixtures share `review/test-helpers/server.mjs`. Create `serverHarness()`, register `t.after(() => fixture.close())`, then call `start()` after preparing synthetic settings, media and optional loopback mocks. The helper owns temporary data/media/review roots and an ephemeral loopback port, waits for readiness and stops the child before removing its root. Its optional child-only clock advances `Date.now()` and invokes an existing interval callback over IPC; with the clock on, intervals run only when the test ticks them, and production timers and authentication code are unchanged. Optional import hooks wrap real route exports to record dispatch, so duplicated route guards cannot hide a missing server guard. `auth-state` checks persisted session cleanup at startup, login and hourly maintenance; `routes` sends real HTTP requests through the guards. `review/test-helpers/review-fixture.mjs` builds on it with synthetic films A, B and C, a stand-in decoder and a loopback Tdarr mock whose routes can be held (`hold`), and drives review confirmation and approval over HTTP; `http-concurrency`, `decision-http` and `resume-retry` use it.

Supervisor fixtures share `review/test-supervisor-helpers.mjs`. Register `t.after(() => stop(run))` immediately after starting a fixture. `stop()` kills the process group, waits for the supervisor and inherited output pipes to close, and then removes only that run's temporary root. `review/supervisor-cleanup.test.mjs` checks passing and deliberately failing test processes with normal and delayed stand-ins, including that their processes have stopped and their temporary roots are gone.

Agents capturing red → green or mutation evidence, locally or in CI, follow [the verification procedure](agents/verification.md). Publish the evidence in a comment on the relevant PR; keep reusable procedures in repository documentation. For literal text replacements and multiline GitHub bodies, see [editing safely](agents/editing.md).

Frontend wiring tests in `review/app-runtime.test.mjs` execute the unmodified app and its browser import graph inside Node's module VM with a minimal DOM. They open real settings/quarantine/rejection dialogs, supply synthetic API responses, inspect both languages and record explicit action requests. They cover dynamic retention, known versus missing node metadata, coded errors with server-text fallback and verbatim rejection history/reasons without implicit review confirmation. The fixture models native dialog close and validation events; it is not a browser or assistive-technology audit. Error-module delivery is tested separately through the actual static route over loopback HTTP. Prepared comparison source reads remain only to execute code, with their reason documented beside the ratchet entry.

`npm run check` also refuses a new test that reads implementation source text (for example `fs.readFile(new URL('./server.mjs', import.meta.url))`) instead of exercising behaviour. Existing reads are listed in `SOURCE_TEXT_ALLOWLIST` in `tools/source-text-tests.mjs`; when you rewrite one of those tests, remove its entry, because the check also fails on an entry that no longer matches.

### Development in WSL2

The developer environment is WSL2 with Ubuntu, Node 24 and Docker Engine installed inside the distribution. Keep the clone in the Linux filesystem (for example `~/projects/Tdarr-Review`), not under `/mnt/c`: the Windows drive does not provide the POSIX modes and directory `fsync` semantics the Linux tests check. Everything below runs from the repository root in the WSL shell:

```bash
npm run check
npm test                 # complete suite, including the Linux-only tests
npm run test:docker      # the same suite in an isolated node:24 container, as in CI
docker build --platform linux/amd64 -t tdarr-review:smoke .
bash tools/docker-smoke.sh
```

Agents need two extra packages in the distribution. Install the GitHub CLI from GitHub's official apt repository ([instructions](https://github.com/cli/cli/blob/trunk/docs/install_linux.md#debian)), not from Ubuntu's archive: Ubuntu's `gh` 2.45 is broken. Codex sandboxes its commands with bubblewrap:

```bash
sudo apt install bubblewrap
```

`docker build` builds the Review image locally under the tag `tdarr-review:smoke`, which `tools/docker-smoke.sh` expects; see [Docker image smoke](#docker-image-smoke) for what the smoke test checks. Neither command publishes anything.

### Linux tests without a local Linux

When you are not on Linux, the **Linux tests (manual)** workflow (`.github/workflows/linux-tests.yml`) runs chosen suite files on GitHub's Linux runner without the Docker jobs. Push your branch, then dispatch it:

```bash
gh workflow run linux-tests.yml --ref <branch> -f files="recovery/worker.integration.test.mjs" -f name_pattern="verify mode"
gh run watch "$(gh run list --workflow linux-tests.yml --branch <branch> --limit 1 --json databaseId -q '.[0].databaseId')"
```

`files` takes space-separated suite files; only files that `npm test` runs are accepted. Empty `files` runs the whole suite. `name_pattern` is a regular expression passed to `--test-name-pattern`. The same selection runs locally with `TEST_FILES=… TEST_NAME_PATTERN=… node tools/test-select.mjs`. The workflow has read-only repository permissions and runs only the unit/regression suite; the pull-request CI still has to pass before merging.

### Isolated Docker suite

`npm run test:docker` runs `npm run check && npm test` in `node:24` for Linux amd64. It mounts only this repository read-only, uses a read-only container root with disposable `/tmp` scratch space (mounted with `exec`, because the HTTP fixtures run stand-in `ffprobe`/`ffmpeg` scripts that Review checks for execute permission), drops capabilities and disables the container network. It neither forwards host settings/credentials nor mounts a Docker socket, media or runtime data. Fixtures use synthetic temporary files and loopback mocks. The test container itself never fetches anything (`--pull=never`). When `node:24` is not present locally, the command first downloads it once on the host with `docker pull --platform linux/amd64 node:24` and says so; if that download fails, it stops before starting a container and names the command to retry. The disposable container is removed on exit, and failed checks/Docker errors return a nonzero status. Docker image smoke and generated-media integration checks remain separate commands below.

### Codex startup troubleshooting

If Codex reports `account/read failed during TUI bootstrap`, try manually restarting the Codex application and reopening the project. This is a maintainer-approved troubleshooting tip, not a confirmed diagnosis or guaranteed fix; no daemon restart command has been verified. This does not call for restarting Review or its containers. If it persists, consult [official troubleshooting guidance](https://learn.chatgpt.com/docs/reference/troubleshooting).

### Agent command allowlist

Claude Code and Codex run the same set of commands without asking:

- `gh pr view`, `list`, `checks`, `diff`, `create`, `comment`, `edit`
- `gh issue view`, `list`, `comment`, `edit`
- `gh label list`
- `gh run view`, `list`
- `git add`, `git commit`
- `git fetch origin`, `git push origin` (also with `-u`/`--set-upstream`)

Everything else keeps the normal approval prompt. `gh pr merge`, pushes to `main`, force pushes and remote branch deletion are refused outright: a human always merges. `gh issue close`, `rm`, `ssh`, `scp` and `rsync` always ask, even if broader approval was granted earlier in a session.

The lists live in two files that must change together:

- Claude Code: `permissions` in `.claude/settings.json` (project settings, read automatically). `gh` commands with `--repo`/`-R` always ask, so the allowlist cannot reach another repository. Personal additions belong in the ignored `.claude/settings.local.json`.
- Codex: `.codex/rules/tdarr-review.rules`. Codex loads project rules only when the project is trusted; trust each worktree path when Codex asks, or add `[projects."<path>"] trust_level = "trusted"` to `~/.codex/config.toml`. Rules you approve during a session go to `~/.codex/rules/default.rules`, not to the repository.

Codex's `prefix_rule` matches command prefixes only, so a forbidden option placed later in the command (`git push origin topic --force`) is not caught by the rules and relies on the normal sandbox prompt and on branch protection for `main`. `tools/agent-allowlist.test.mjs` compares the allowed command prefixes in both files and checks that label listing does not authorize label writes. Verify the rules after every change; the file's `match`/`not_match` examples are checked when the rules load:

```bash
codex execpolicy check --pretty --rules .codex/rules/tdarr-review.rules -- gh pr view 1        # allow
codex execpolicy check --pretty --rules .codex/rules/tdarr-review.rules -- gh pr merge 1       # forbidden
codex execpolicy check --pretty --rules .codex/rules/tdarr-review.rules -- ssh tower           # prompt
```

## Changelog fragments

A user-visible change adds `changelog.d/<issue>-<topic>.md` with one list item instead of editing `CHANGELOG.md` ([format](../changelog.d/README.md)). Pull requests that each add their own fragment merge in any order without a conflict. `npm run check` refuses a misnamed fragment, more than one list item, a merge-conflict marker or a relative link that does not exist (links are written relative to the repository root, as in `CHANGELOG.md`). `npm run changelog` prints the assembled Unreleased section; the release step is in [RELEASES.md](RELEASES.md).

## Type checking

`npm run typecheck` checks JSDoc types with TypeScript, without emitting code. It currently covers `review/core.mjs` (transaction journal, file identity, command and exchange options) and `recovery/policy.mjs` (decode results and their classification). A file joins the check by starting with `// @ts-check` and being listed in `tsconfig.typecheck.json`; `strict` is off until more modules are annotated.

TypeScript and `@types/node` are a maintainer-approved, development-only exception to the no-dependency rule. The script installs exactly the versions pinned in `tools/typecheck.mjs` into the git-ignored `.typecheck/` folder (no lockfile, install scripts disabled). They are not in `package.json` and never in the Docker images. CI runs the check before the test suite; it needs network access to the npm registry the first time.

To run the same complete suite with Node 24's built-in experimental coverage reporting:

```bash
npm run test:coverage
```

The command retains the same test discovery, sequential execution and failing-test exit status as `npm test`, adds no dependencies, and prints per-file line, branch and function coverage in the console. CI uses this command instead of a second plain unit-suite run. Only the explicit `--coverage` runner option is supported; unknown or repeated options fail instead of silently skipping tests. No minimum coverage is enforced until a representative Linux baseline has been measured and reviewed.

Treat the report as collected execution evidence, not proof of safety. Files absent from it are unmeasured. In particular, `recovery/worker.mjs` runs in subprocesses launched by the Linux integration fixtures rather than as a test entrypoint: confirm its actual collected coverage in the Linux report before proposing a worker threshold. Separate Docker smoke and generated-media/HTTP fixture commands are outside this coverage run. A report from a system that skips the Linux-only tests is unsuitable as the full Linux baseline. Prioritize uncovered branches in `review/core.mjs`, `review/radarr-replacement.mjs`, `review/cleanup.mjs` and `recovery/replacement-*.mjs` when reviewing the baseline. See [Node's coverage documentation](https://nodejs.org/docs/latest-v24.x/api/test.html#collecting-code-coverage).

Tests cover path containment, source changes, copy/exchange recovery, metadata/profile checks, job matching, plain-text API replies, batch concurrency, configuration, artwork proxy limits, rejection evidence, audio alignment/A-B playback, quarantine retention, release/history binding, deferred quota and shared status. Fixtures are disposable fictional records, not live credentials or production repair approvals.

Prepared-sample tests cover private atomic cache writes, restart reuse, source and renderer changes, size/count/expiry limits, background budget exhaustion, foreground priority and cancellation. Plan and settings fixtures verify ordered audio-language preferences, ambiguous track matching and saved manual pairs. Frontend fixtures verify cache-only loading without playback or review writes, polling cleanup, stale responses and progress updates that preserve the active workspace. AV regressions retain shared timestamps and fixed preview bounds, reject decoder errors and incomplete PCM samples, and limit the H.264 seek retry to its specific supported failure.

Recovery status tests cover fragmented/nonfinite progress, per-pass ETA, heartbeat versus cached Tdarr freshness, serialized/coalesced publication, timer cleanup and write failure recovery. Atomic-write fixtures check that repeated shared status refreshes retain readable `0644` permissions while worker state remains private at `0600`, including when an old temporary file has different permissions. Full-hash regressions record the public status immediately before real low-priority hash children start, checking confirmation/pre-quarantine stages and cleanup. A 5 MiB synthetic source changes one byte between sampled regions after confirmation. An exact-source stat shim preserves only the fixture's recorded mtime/ctime, isolating full-hash detection from the separate fingerprint guard; real file bytes, hashing and worker decisions still run. Linux worker integration fixtures execute the actual worker/journal with loopback-only Radarr/Tdarr mocks, temporary SQLite and a synthetic decoder. They verify two-pass cooldown diagnosis, one exact Hold, unchanged media/parent quarantine, no repeated decoding after restart, preserved active handoffs and manual handling of a changed movie-file identity. Because Recovery and Review share one container and UID, a complete repair case (confirmation, quarantine, search, replacement handoff and quarantine retention) also checks that the worker leaves the review-results root, Review's other data and its approval evidence byte-for-byte unchanged, and writes nothing outside its own data root, the shared status file, the original-language cache, quarantine and the repaired film. The synthetic decoder tests worker wiring; actual decoding behavior remains covered by the bundled FFmpeg tests and media integration checks.

Quota fixtures cover ranked capacity expiry, immutable evidence, exact Hold acknowledgement and read-only intent reconciliation. The actual worker resumes a job-based quota case using its original two decodes, while a header case remains held without re-decoding. Missing/malformed authorization stops before any API. Registry tests cover private file/mapping/evidence validation, semantic membership, completed non-authorizing legacy history, exact backups, exclusive/idempotent migration and races. The Review image smoke invokes the packaged migration utility with fictional data and confirms unchanged state and no API calls.

The integration test generates short media using FFmpeg and runs a local mock Tdarr API and isolated SQLite database:

```bash
FFMPEG=/path/to/ffmpeg FFPROBE=/path/to/ffprobe npm run test:integration
```

It must never point at real media or a real Tdarr/Radarr endpoint. The test server uses localhost port 18270. The approval subprocess deliberately receives an invalid decoder path so the test proves ordinary approval does not perform another complete decode.

Run the generated-media AV and preview-cache HTTP fixtures with the same decoder binaries:

```bash
FFMPEG=/path/to/ffmpeg FFPROBE=/path/to/ffprobe node tools/test-av-fixture.mjs
FFMPEG=/path/to/ffmpeg FFPROBE=/path/to/ffprobe node tools/test-av-http.mjs
FFMPEG=/path/to/ffmpeg FFPROBE=/path/to/ffprobe node tools/test-preview-cache-http.mjs
```

The cache HTTP fixture starts an isolated Review server with generated original/transcode files and a loopback Tdarr mock. It checks background preparation, cache-only misses/hits, on-demand requests, language preferences and manual selections, persistent reuse after restart, source-change rejection and unchanged review evidence. These media/HTTP fixtures are separate from `npm test` and also run in Docker smoke against the exact built Review image; they never approve production films or use production settings.

CI runs syntax and unit tests on Node 24 / Linux, executes the same isolated `test:docker` command, builds the actual Linux amd64 images, and runs isolated image smoke and Review integration tests. Pushes to `main`, version tags and pull requests are tested with read-only repository permissions and never publish images. Docker publication uses a separate manually dispatched workflow for an approved full commit SHA already in `main`; it repeats tests and smoke checks before obtaining registry credentials. Updating `latest` is an explicit option, disabled by default. See [the release process](RELEASES.md). No production media or live Tdarr/Radarr endpoint is used. A complete new Unraid installation and Community Applications approval remain separate checks.

## Docker image smoke

To exercise the built image locally on Linux or WSL2:

```bash
docker build --platform linux/amd64 -t tdarr-review:smoke .
bash tools/docker-smoke.sh
```

The smoke script creates uniquely named disposable containers and volumes and removes only those resources afterward. Review is tested with a new writable `/data` volume and a read-only container root, including login and the configured Host header. Generated-media AV timing, AV HTTP and preview-cache HTTP fixtures then exercise modules from that exact image, using only writable temporary files and loopback API mocks. The cache fixture has a 240-second process timeout; the AV fixtures retain 180 seconds. Every container starts through the image's own entrypoint, without `docker run --init`. The default container must run tini as PID 1, the supervisor under it and no Recovery process. A second container with `RECOVERY_MODE=verify` must first report the missing `config.json` as `refused` while Review stays healthy. After a fixture `config.json` and a restart, the actual worker must run under `ionice`/`nice` with `/data/recovery` as its data root and complete dry-run passes against empty fixture tables and a loopback-only mock started inside the container. `docker stop` must then end the container within 10 seconds with exit code 0, after Recovery logged the SIGTERM. A third container runs the packaged registry migration utility on the stopped data. Recovery's repair and original decoding policies are covered by unit tests, not by live downloads in the smoke test.

## Browser automation for coding agents

`.mcp.json` registers the [Playwright MCP server](https://github.com/microsoft/playwright-mcp) (pinned to `@playwright/mcp@0.0.83`) so Claude Code and other MCP clients can open the Review UI in a headless browser, take snapshots or screenshots and check both English and Czech layouts. Snapshots are written to the ignored `.playwright-mcp/` directory.

The server uses the Chromium at `/opt/pw-browsers/chromium`, which Claude Code cloud environments provide. Elsewhere, set `PLAYWRIGHT_MCP_EXECUTABLE_PATH` to a local Chromium or Chrome binary before starting the client. The browser runs without the Chromium sandbox because container environments do not support it; only open a locally started Review server with disposable test data, never a production installation, real media or a live Tdarr/Radarr endpoint.

`.mcp.json` also registers the [Context7 MCP server](https://github.com/upstash/context7) (pinned to `@upstash/context7-mcp@4.1.1`), which looks up current library and API documentation such as Node.js or Playwright. It only sends documentation queries to `context7.com`; never include configuration, credentials, paths or media details in a query. An API key is optional: set `CONTEXT7_API_KEY` in the environment (or the cloud environment's secrets) for higher rate limits, never in the repository. In Claude Code cloud environments `context7.com` must be allowed by the environment's network access settings. `NODE_USE_ENV_PROXY=1` makes the server use the configured HTTPS proxy.

## Source provenance

The application and worker were copied from the live installation on 11 October 2026. Runtime data, backups, SSH material, movie files and one-off historical repair runners were omitted. Public installation defaults are placeholders. No private pending registry is included in source/images; the persistent registry example is empty and synthetic fixtures are only for tests.

The public pending-evidence worker retains strict identity/history/evidence checks but uses membership in the explicitly configured frozen registry instead of the original installation's four hardcoded movie IDs. This packaging change is not deployed to the existing server by publishing the repository.

## Known limitations

- The interface supports English and Czech; other interface languages are not implemented. Audio-language preferences select preview tracks and are separate from the interface language.
- First public packaging is marked beta. Community Applications inclusion requires separate submission and catalog acceptance; see [packaging status](COMMUNITY-APPS.md).
- The Review image can run Recovery under its supervisor (`RECOVERY_MODE`), but the Unraid template and Compose file do not offer that yet; Compose still runs Recovery as a separate service. No multiple-writer deployment support.
- Tdarr API authentication support is not implemented; changed future API/schema versions require testing.
- Recovery configuration is a private JSON file, not part of Review's settings UI.
- Original-decode ETA is an estimate for the current pass only. Unknown duration, missing/stalled measurements and cached Tdarr jobs have no reliable percentage or ETA.
- Some older imported cases lack exact replacement/evidence fields and remain unresolved visibly instead of being called complete.
- No Plex refresh API. Plex scans the library through its existing configuration.
- Complete transcode flows, tools for every HDR format, MVC/3D and ISO processing are not installed by this repository.
- Automated health checks and image/audio samples do not prove subjective compression quality or complete lip synchronization.
