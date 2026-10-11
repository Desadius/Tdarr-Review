# Development and verification

Use Linux and Node 24 for the full suite. Directory `fsync` and Linux path/filesystem semantics are part of the implementation; Windows is useful for editing and syntax checks, not the approval deployment target. There are no npm dependencies to install.

```bash
npm run check
npm test
```

Tests cover path containment, source changes, copy/exchange recovery, metadata/profile checks, job matching, plain-text API replies, batch concurrency, configuration, artwork proxy limits, rejection evidence, audio alignment/A-B playback, quarantine retention, release/history binding, deferred quota and shared status. Fixtures are disposable fictional records, not live credentials or production repair approvals.

The integration test generates short media using FFmpeg and runs a local mock Tdarr API and isolated SQLite database:

```bash
FFMPEG=/path/to/ffmpeg FFPROBE=/path/to/ffprobe npm run test:integration
```

It must never point at real media or a real Tdarr/Radarr endpoint. The test server uses localhost port 18270. The approval subprocess deliberately receives an invalid decoder path so the test proves ordinary approval does not perform another complete decode.

The published CI runs syntax and unit tests on Node 24 / Linux. It does not approve production movies or publish Docker images. Container build and a complete new Unraid installation should be verified separately before deploying a release.

## Source provenance

The application and worker were copied from the live installation on 11 October 2026. Runtime data, backups, SSH material, movie files and one-off historical repair runners were omitted. Public installation defaults are placeholders. The pending repair registry is empty; synthetic fixtures are only for tests.

The public pending-evidence worker retains strict identity/history/evidence checks but uses membership in the explicitly configured frozen registry instead of the original installation's four hardcoded movie IDs. This packaging change is not deployed to the existing server by publishing the repository.

## Known limitations

- Czech UI; no language selector yet.
- No selected open-source license, prebuilt image or Community Applications entry yet.
- Review and optional Recovery run as separate single processes/containers. No shared supervisor or multiple-writer deployment support.
- Tdarr API authentication support is not implemented; changed future API/schema versions require testing.
- Recovery configuration is a private JSON file, not part of Review's settings UI.
- Snapshot publication can be delayed by a long original decode. No live worker progress/ETA in that shared snapshot.
- Some older imported cases lack exact replacement/evidence fields and remain unresolved visibly instead of being called complete.
- No Plex refresh API. Plex scans the library through its existing configuration.
- Complete transcode flows, tools for every HDR format, MVC/3D and ISO processing are not installed by this repository.
- Automated health checks and image/audio samples do not prove subjective compression quality or complete lip synchronization.
