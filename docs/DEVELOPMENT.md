# Development and verification

Use Linux and Node 24 for the full suite. Directory `fsync` and Linux path/filesystem semantics are part of the implementation; Windows is useful for editing and syntax checks, not the approval deployment target. There are no npm dependencies to install.

```bash
npm run check
npm test
```

Tests cover path containment, source changes, copy/exchange recovery, metadata/profile checks, job matching, plain-text API replies, batch concurrency, configuration, artwork proxy limits, rejection evidence, audio alignment/A-B playback, quarantine retention, release/history binding, deferred quota and shared status. Fixtures are disposable fictional records, not live credentials or production repair approvals.

Recovery status tests cover fragmented/nonfinite progress, per-pass ETA, heartbeat versus cached Tdarr freshness, serialized/coalesced publication, timer cleanup and write failure recovery. Linux worker integration fixtures execute the actual worker/journal with loopback-only Radarr/Tdarr mocks, temporary SQLite and a synthetic decoder. They verify two-pass cooldown diagnosis, one exact Hold, unchanged media/parent quarantine, no repeated decoding after restart, preserved active handoffs and manual handling of a changed movie-file identity. The synthetic decoder tests worker wiring; actual decoding behavior remains covered by the bundled FFmpeg tests and media integration checks.

Quota fixtures cover ranked capacity expiry, immutable evidence, exact Hold acknowledgement and read-only intent reconciliation. The actual worker resumes a job-based quota case using its original two decodes, while a header case remains held without re-decoding. Missing/malformed authorization stops before any API. Registry tests cover private file/mapping/evidence validation, semantic membership, completed non-authorizing legacy history, exact backups, exclusive/idempotent migration and races. The actual Recovery image smoke invokes its packaged migration utility with fictional data and confirms unchanged state and no API calls.

The integration test generates short media using FFmpeg and runs a local mock Tdarr API and isolated SQLite database:

```bash
FFMPEG=/path/to/ffmpeg FFPROBE=/path/to/ffprobe npm run test:integration
```

It must never point at real media or a real Tdarr/Radarr endpoint. The test server uses localhost port 18270. The approval subprocess deliberately receives an invalid decoder path so the test proves ordinary approval does not perform another complete decode.

CI runs syntax and unit tests on Node 24 / Linux, builds the actual Linux amd64 images, and runs isolated image smoke and Review integration tests. Pushes to `main`, version tags and pull requests are tested with read-only repository permissions and never publish images. Docker publication uses a separate manually dispatched workflow for an approved full commit SHA already in `main`; it repeats tests and smoke checks before obtaining registry credentials. Updating `latest` is an explicit option, disabled by default. See [the release process](RELEASES.md). No production media or live Tdarr/Radarr endpoint is used. A complete new Unraid installation and Community Applications approval remain separate checks.

To exercise built images locally on Linux:

```bash
docker build --platform linux/amd64 -t tdarr-review:smoke .
docker build --platform linux/amd64 -f Dockerfile.recovery -t tdarr-recovery:smoke .
bash tools/docker-smoke.sh
```

The smoke script creates uniquely named disposable containers and volumes and removes only those resources afterward. Review is tested with a new writable `/data` volume and a read-only container root, including login and the configured Host header. Generated-media AV timing and HTTP fixtures then exercise modules from that exact image, using only writable temporary files and loopback API mocks. Recovery runs a single disabled pass with empty fixture tables and a loopback-only mock. Its repair and original decoding policies are covered by unit tests, not by live downloads in the smoke test.

## Browser automation for coding agents

`.mcp.json` registers the [Playwright MCP server](https://github.com/microsoft/playwright-mcp) (pinned to `@playwright/mcp@0.0.83`) so Claude Code and other MCP clients can open the Review UI in a headless browser, take snapshots or screenshots and check both English and Czech layouts. Snapshots are written to the ignored `.playwright-mcp/` directory.

The server uses the Chromium at `/opt/pw-browsers/chromium`, which Claude Code cloud environments provide. Elsewhere, set `PLAYWRIGHT_MCP_EXECUTABLE_PATH` to a local Chromium or Chrome binary before starting the client. The browser runs without the Chromium sandbox because container environments do not support it; only open a locally started Review server with disposable test data, never a production installation, real media or a live Tdarr/Radarr endpoint.

## Source provenance

The application and worker were copied from the live installation on 11 October 2026. Runtime data, backups, SSH material, movie files and one-off historical repair runners were omitted. Public installation defaults are placeholders. No private pending registry is included in source/images; the persistent registry example is empty and synthetic fixtures are only for tests.

The public pending-evidence worker retains strict identity/history/evidence checks but uses membership in the explicitly configured frozen registry instead of the original installation's four hardcoded movie IDs. This packaging change is not deployed to the existing server by publishing the repository.

## Known limitations

- Czech UI; no language selector yet.
- First public packaging is marked beta. Community Applications inclusion requires separate submission and catalog acceptance; see [packaging status](COMMUNITY-APPS.md).
- Review and optional Recovery run as separate single processes/containers. No shared supervisor or multiple-writer deployment support.
- Tdarr API authentication support is not implemented; changed future API/schema versions require testing.
- Recovery configuration is a private JSON file, not part of Review's settings UI.
- Original-decode ETA is an estimate for the current pass only. Unknown duration, missing/stalled measurements and cached Tdarr jobs have no reliable percentage or ETA.
- Some older imported cases lack exact replacement/evidence fields and remain unresolved visibly instead of being called complete.
- No Plex refresh API. Plex scans the library through its existing configuration.
- Complete transcode flows, tools for every HDR format, MVC/3D and ISO processing are not installed by this repository.
- Automated health checks and image/audio samples do not prove subjective compression quality or complete lip synchronization.
