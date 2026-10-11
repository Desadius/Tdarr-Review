# Repository verification — 2026-10-12

## 1.10.1 candidate — not published or deployed

The complete expanded **262 regression tests** passed on Linux / Node 24.15.0. Earlier local snapshots passed 158, 203 and 252 tests. The current batch adds persistent registry validation/migration and automatic daily-quota resumption to measured original-decode status, confirmed faulty replacement deferral and handoff recovery. Manual replacement lifecycle tests exercise all supported Tdarr states, exact path/library binding, missing/changed/malformed records, transient errors, stale download/search state, public-field filtering and real approval-evidence-based retention transitions. Imported observations make only database reads; tests verify that they do not rescan or requeue a file. Tdarr success alone does not create approval or retention evidence.

Progress tests distinguish worker heartbeat, decoder measurements and cached database freshness; they cover fragmented/nonfinite output, unknown duration, per-pass ETA, coalesced/serialized writes, timer cleanup and publication failure. FFmpeg progress completion cannot create health or approval evidence. Read-only Recovery details refresh automatically while approval/restoration decision snapshots stay frozen.

Eight Linux worker integration tests use the actual worker/journal, temporary SQLite, loopback-only API mocks and a synthetic decoder. They prove repeated original errors are diagnosed during the movie cooldown, the exact edition is held once, original/parent quarantine remain unchanged, a later pass does not repeat decoding, an already active handoff is not reset, a changed movie-file binding becomes manual, and an older handoff cannot release a newer protected Hold. A clean decode counts as diagnostic completion only if the source identity/sample remain unchanged afterward. Job-based daily deferrals resume after capacity clears with exactly the original two decodes, header cases do not repeat decoding while waiting, and missing/malformed approval authority stops before APIs. The synthetic decoder verifies orchestration; it is not a new codec-compatibility test or evidence about production films.

Thirty registry tests cover bounded private reads, source/evidence/mapping validation, deep freezing and semantic membership; missing/changed members, unsupported schemas and symlinks fail. Imported legacy metadata remains non-authorizing history only under its strong original tuple and frozen mappings. Migration tests cover exact private backups, exclusive/idempotent installation and concurrent target/state changes. Sixteen daily-deferral tests cover evidence/Hold/identity checks, correct ranked quota expiry, disabled automation and lost-response reconciliation.

Both final candidate Linux amd64 images were built from the current local source using the pinned runtime. Actual Review startup with a fresh `/data` volume, UID 99/GID 100, read-only root, private login and configured browser Host passed. The full isolated HTTP approval/batch/source-change integration test passed inside the candidate Review image. The candidate Recovery image completed its configured disabled fixture pass and preserved synthetic media identity/bytes. Its packaged offline migration utility installed a fictional registry, retried idempotently, preserved state, set private permissions and made no API calls. Containers had no external network, no published ports and no production data mounts; CPU and memory were bounded.

All owned temporary containers, volumes, candidate image tags and the unique source staging directory were removed. The existing production Review container retained its start time and was not restarted. No real movie approval, replacement, Radarr download or image publication was performed.

Both workflows passed actionlint 1.7.12 and Bash syntax validation. An isolated Git fixture accepted exact current/historical main commits and rejected side-branch commits, nonexistent/short SHAs and injected command text. CI has no registry write permission; image publication requires manual dispatch for a selected main commit and defaults to leaving `latest` unchanged. Documentation links, JSON examples, JavaScript syntax and diff formatting passed; the source scan found none of the known deployment credentials/identifiers.

Ten additional regressions cover the DTS-HD XLL marker, one-time reconsideration of previously unrecognized reports, actual worker confirmation and cooldown Hold, clean-original and manual-decision guards, exact parent/child linkage, public evidence filtering and stale follow-up presentation. A synthetic failed replacement links back to its imported parent while preserving the parent journal and quarantine unchanged. A failed Tdarr report alone never authorizes a repair. A ctime-only historical difference can link display with an explicit flag; its actual-worker regression still requires fresh full-identity evidence, preserves the parent journal and never imports historical authorization.

Publication of this local batch was explicitly postponed. GitHub-hosted CI, GHCR publication and production deployment for 1.10.1 remain pending separate approval. Version 1.10.0 publication evidence below is retained for the existing release. Existing historical manual cases are not automatically migrated by these tests or source changes.

## Initial 1.10.0 source

The prepared source passed JavaScript syntax checks and **149 regression tests** on Linux, Node 24.15.0. Test data was copied to an isolated temporary directory and APIs were mocked. No production approval, film replacement, Radarr download or container restart was used for these tests.

The isolated HTTP integration test passed authentication/origin checks, plain-text Tdarr `OK` responses, competing single/batch requests, all-selection preflight, sequential batch replacement, changed-source preservation, rejection of only the result, history recording and restoration of owned node pauses. It generated disposable short media using Jellyfin FFmpeg 7.1.4.

Documentation links and JSON examples were checked. A scan found no known private SSH material, production API credentials, personal server IP, personal library ID or local Windows user paths in the prepared files.

These initial results verify the source and example contracts. Image verification completed afterward, as recorded below. A fresh Unraid template installation, authenticated Tdarr API support and future Tdarr versions remain separate checks.

## Public Docker images

[GitHub Actions run 38158144901](https://github.com/Desadius/Tdarr-Review/actions/runs/38158144901) passed all 149 tests and both actual Linux amd64 image builds before publication. Source revision: `cab3774c4f42b200da294ee9adc5ec06a39a05fc`.

- Review default entrypoint starts as UID 99/GID 100 with a fresh named `/data` volume, read-only container root, dropped capabilities and no external network. Login, SQLite, bundled FFmpeg/FFprobe, writable state and the health check passed. A browser origin with a different host/port is explicitly exercised.
- The complete isolated Review HTTP integration test passed inside that actual image, including synthetic approvals and source-change preservation.
- Recovery's actual configured `ionice → nice → node` command completed one disabled pass against empty fixture tables and a loopback mock. No repair API was called and sentinel media retained its identity and bytes.
- Temporary containers and named volumes were cleaned. No production mounts, movie replacement, Radarr download or production restart was used.

Published and anonymously verified on 11 October 2026:

| Image | Digest |
| --- | --- |
| `ghcr.io/desadius/tdarr-review:latest` | `sha256:4e48ae6fa210397fead52085349692fedd0feff17fa0a488fa0e8481152b13de` |
| `ghcr.io/desadius/tdarr-recovery:latest` | `sha256:db591f9c7e632af0179405454fd4b91fd69778131c2aa1a77c4a660d2eee6dc1` |

Anonymous checks fetched and hashed each manifest and image configuration, confirmed Linux amd64, and matched the revision/digests pushed by CI. This was a manifest/config accessibility check, not a full fresh download of every layer to a new Unraid host. The initial compressed image layers total about 1.5 GB because the pinned upstream Tdarr runtime is retained.

The Community Applications portal accepted the repository's MIT license and profile and found one valid Docker application with no template errors or warnings. The image pullability check also passed. Final submission was received and auto-approved on 11 October 2026; the portal states that inclusion follows the next published catalog build. The template remains marked beta.
