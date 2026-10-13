# Repository verification — 2026-10-13

## 1.10.5 — prepared samples and clean Recovery stop

Release source `8bea743` passed `npm run check` and all 382 Linux regression tests in CI without failures or skips, followed by the Docker build and smoke checks of both images with disposable fixtures and no external network. New worker tests run the real Recovery worker without `--once`: SIGTERM during the idle wait exits with code 0 within seconds and leaves the journal unchanged, and SIGTERM during an original decode lets both passes finish before exiting, so no case is left interrupted.

The Recovery image was built from `8bea743` on the existing Linux deployment. Its 37 application files matched the release source, and user, read-only root filesystem and mappings matched the previous container. Before each restart there were no ffmpeg processes and no case in an active phase. The previous build still needed 63 s and exit code 137 to stop; the new worker stopped in about 2 s with exit code 0, then completed its next cycle without error and refreshed the shared status file. Review was running the earlier `05e8179` build, whose Review sources are identical in this release. No production film was approved or replaced as a test.

## 1.10.4 — shared picture and movable divider

The candidate passed 329 Linux regression tests without failures or skips, the real FFmpeg timing/geometry fixtures, AV HTTP checks and packaged single/batch approval integration. New fixtures cover anamorphic sample aspect ratios, bounded portrait previews and 1920×1080 detail output. The original five-second container origin and deliberate 300 ms audio delay remain covered.

Browser checks exercised pointer dragging, keyboard movement, an automatic 25%→75%→25% sweep, pause freezing, switching back to side-by-side and video playback. Both video elements retained identical full-stage coordinates and sizes in the wipe view; no console errors were observed. Manual movement disables the sweep, and neither playback nor the sweep confirms an assessment.

The candidate was installed on the existing Linux deployment and its served modules matched the local source. Health, environment, mounts, user and resource restrictions matched the previous container. The disposable demo and stopped rollback container were removed, with private backups and the prior image retained. No production film was approved or replaced as a test. Native HDR/surround quality and a fresh Unraid installation remain outside these preview checks.

## 1.10.2 — guided review and video comparison

The release candidate passed 297 Linux regression tests with no failures or skipped tests. Packaged HTTP integration rejects incomplete assessments, outdated review revisions and mixed incomplete batches before file replacement, records the completed assessment in history and retains the existing identity, concurrency and transaction protections.

Generated-media FFmpeg verification uses a five-second container start and a deliberately delayed audio track. The preview retained the delay (300 ms in the source, 320 ms at the decoded AAC onset) within the stated preview precision. AV HTTP tests cover login, stale snapshots, invalid tracks/times, playable H.264/AAC clips, waveforms and unchanged original hashes. These two tests are also part of Docker smoke for the exact images before registry publication.

Browser checks exercised embedded video playback, shared tracks, distinct saved synchronization times, invalidation of old previews on time changes, draft restoration and deferral reasons. Returning to a deferred Synchronization step loads track metadata before creating its player; concurrent refresh does not start duplicate metadata requests. Loading or playing a sample does not create manual confirmation.

The candidate was installed on the existing Linux amd64 deployment and reported healthy. Its environment, mounts, user and resource restrictions matched the previous deployment. Temporary generated-media test containers and stopped rollback containers from this change were removed; private backups and prior images were retained. No production film was approved or replaced as a test. This is not a fresh Unraid installation test or proof that every playback device supports the previews.

The [manual publication workflow](https://github.com/Desadius/Tdarr-Review/actions/runs/38257884442) completed successfully for source `544f928f24b1e70c9cdf90450e064d6b82a84558`. It rebuilt and tested both exact images, including the AV fixtures, before publication. Anonymous manifest/config checks confirmed Linux amd64, version `1.10.2`, that source revision, and identical `1.10.2`, `latest` and `sha-<revision>` manifests for each app:

| Image | Published manifest digest |
| --- | --- |
| `ghcr.io/desadius/tdarr-review:1.10.2` | `sha256:6db437173b22f34820705c2d565429c1e6660aaa4667d7827e6ffaf398540f43` |
| `ghcr.io/desadius/tdarr-recovery:1.10.2` | `sha256:723b4a92b78526596d8ce42d01fecd5010a0151894fac3c928165ee1a799bff0` |

The existing Review installation was then switched from the temporary local image to the published `1.10.2` image. Health, served modules, environment, mounts, user and resource restrictions were verified; Recovery was not restarted. The Community Apps validator confirms the repository is already enabled and needs no new submission. A later documentation-only commit may update this publication record without changing the tagged image source.

## 1.10.1 — verification before publication

The complete expanded **262 regression tests** passed on Linux / Node 24.15.0. Earlier local snapshots passed 158, 203 and 252 tests. The current batch adds persistent registry validation/migration and automatic daily-quota resumption to measured original-decode status, confirmed faulty replacement deferral and handoff recovery. Manual replacement lifecycle tests exercise all supported Tdarr states, exact path/library binding, missing/changed/malformed records, transient errors, stale download/search state, public-field filtering and real approval-evidence-based retention transitions. Imported observations make only database reads; tests verify that they do not rescan or requeue a file. Tdarr success alone does not create approval or retention evidence.

Progress tests distinguish worker heartbeat, decoder measurements and cached database freshness; they cover fragmented/nonfinite output, unknown duration, per-pass ETA, coalesced/serialized writes, timer cleanup and publication failure. FFmpeg progress completion cannot create health or approval evidence. Read-only Recovery details refresh automatically while approval/restoration decision snapshots stay frozen.

Eight Linux worker integration tests use the actual worker/journal, temporary SQLite, loopback-only API mocks and a synthetic decoder. They prove repeated original errors are diagnosed during the movie cooldown, the exact edition is held once, original/parent quarantine remain unchanged, a later pass does not repeat decoding, an already active handoff is not reset, a changed movie-file binding becomes manual, and an older handoff cannot release a newer protected Hold. A clean decode counts as diagnostic completion only if the source identity/sample remain unchanged afterward. Job-based daily deferrals resume after capacity clears with exactly the original two decodes, header cases do not repeat decoding while waiting, and missing/malformed approval authority stops before APIs. The synthetic decoder verifies orchestration; it is not a new codec-compatibility test or evidence about production films.

Thirty registry tests cover bounded private reads, source/evidence/mapping validation, deep freezing and semantic membership; missing/changed members, unsupported schemas and symlinks fail. Imported legacy metadata remains non-authorizing history only under its strong original tuple and frozen mappings. Migration tests cover exact private backups, exclusive/idempotent installation and concurrent target/state changes. Sixteen daily-deferral tests cover evidence/Hold/identity checks, correct ranked quota expiry, disabled automation and lost-response reconciliation.

Both final candidate Linux amd64 images were built from the current local source using the pinned runtime. Actual Review startup with a fresh `/data` volume, UID 99/GID 100, read-only root, private login and configured browser Host passed. The full isolated HTTP approval/batch/source-change integration test passed inside the candidate Review image. The candidate Recovery image completed its configured disabled fixture pass and preserved synthetic media identity/bytes. Its packaged offline migration utility installed a fictional registry, retried idempotently, preserved state, set private permissions and made no API calls. Containers had no external network, no published ports and no production data mounts; CPU and memory were bounded.

All owned temporary containers, volumes, candidate image tags and the unique source staging directory were removed. The existing production Review container retained its start time and was not restarted. No real movie approval, replacement, Radarr download or image publication was performed.

Both workflows passed actionlint 1.7.12 and Bash syntax validation. An isolated Git fixture accepted exact current/historical main commits and rejected side-branch commits, nonexistent/short SHAs and injected command text. CI has no registry write permission; image publication requires manual dispatch for a selected main commit and defaults to leaving `latest` unchanged. Documentation links, JSON examples, JavaScript syntax and diff formatting passed; the source scan found none of the known deployment credentials/identifiers.

Ten additional regressions cover the DTS-HD XLL marker, one-time reconsideration of previously unrecognized reports, actual worker confirmation and cooldown Hold, clean-original and manual-decision guards, exact parent/child linkage, public evidence filtering and stale follow-up presentation. A synthetic failed replacement links back to its imported parent while preserving the parent journal and quarantine unchanged. A failed Tdarr report alone never authorizes a repair. A ctime-only historical difference can link display with an explicit flag; its actual-worker regression still requires fresh full-identity evidence, preserves the parent journal and never imports historical authorization.

The owner authorized source publication, versioned image publication and production deployment on 12 October 2026. These operations are verified separately; the results above describe prepublication local tests. Version 1.10.0 publication evidence below is retained for the existing release. Existing historical manual cases are not automatically migrated by these tests or source changes.

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


## 1.10.3 audit

The release audit covers read-only historical replacement association, stale/follow-up observations, blocked imports, frozen-approval quota timing, quarantine explanations and the optional Recovery-to-Review routing function. Legacy journal fields do not create fingerprints, approvals or cleanup permission. The strict installed/quarantined-file identity checks remain unchanged, including metadata-only mismatches.

The final source passed 318 Linux regression tests without failures or skips. Both actual candidate images passed fresh-data/login/runtime smoke checks, approval/batch HTTP integration and packaged private-registry migration/worker checks. All disposable fixtures remain independent of production media and credentials. Browser checks passed for the separate unverified filter, downloader percentages/ETA, blocked-import advice, quarantine deadlines and links, legacy details with missing follow-up fields, and Czech/English labels.

One browser-only failure was found during the audit: opening a historical detail with absent follow-up fields could throw. It was fixed with a null-safe, unique-child link policy and a regression test; the repaired quarantine link was exercised again in the browser. A stale downloader warning after import was also removed from both status projection and presentation.

A successful conversion is still not an approval. No historical cleanup is automatically authorized, and no production movie is approved as a release test. Full-file content equivalence for older ctime-only changes is not proven by this release; those quarantine copies remain protected.
