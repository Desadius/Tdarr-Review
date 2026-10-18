# Change history

This records the implemented application features. Versions before 1.10.0 were deployed snapshots and are not published Git tags.

## Unreleased

- The overview labels each film's review state (ready, in progress, completed, deferred, duration difference, technically blocked) with text and an icon, and selection mode explains why a film cannot be selected for batch approval, with a link to its review and the number of selectable films (English and Czech). A disabled selection no longer comes without a reason.

- Recovery recognizes four DTS core decoder errors (`Residual encoded channels are present without core`, `Invalid isolated sample location`, `Invalid bit allocation index`, `Failed to decode block code(s)`) and the Matroska `exceeds containing master element` structure error as candidates for its independent two-pass original check, with signatures free of process addresses. A Matroska structure error counts even with FFmpeg exit 0. Tdarr jobs skipped earlier as `not_confirmed_decode_error_v3` are reconsidered once; still-unrecognized ones become `not_confirmed_decode_error_v4`. Two matching decodes of the unchanged original and an exact Radarr binding remain required, and operational failures still win.

- Restoring a manual Radarr replacement no longer reports success when the original or the Review result is in quarantine without a recorded file identity. Previously that file was silently left in quarantine while the rest of the restore completed and the request showed as restored; now nothing moves, Radarr is not changed and the request needs attention with the unreadable-identity reason.

- A recorded file identity that cannot be read now never counts as a match and is reported with its own reason. Previously some malformed recorded values (four fields, an empty or non-numeric ctime or device) matched: quarantine retention could purge a quarantined original, Recovery could restore or remove a preserved copy, an interrupted replacement could be rolled back and a missing value produced a raw `TypeError`. Such cases now stay in place: an interrupted replacement stays pending with `Neplatná identita souboru v záznamu výměny.` (approvals stay blocked), replacement and Recovery cases show attention with `FILE_IDENTITY_INVALID`, and a changed review item is blocked with an unreadable-identity reason (English and Czech). Identity bytes, case IDs and the handling of valid identities are unchanged; every file identity is now produced and compared by one module.

- AV samples of open-GOP H.264 sources no longer fail with `mmco: unref short failure` at a clip time just past a keyframe: this decoder diagnostic now qualifies for the existing single retry with 30 seconds of preroll, and the retry must pass the same strict checks. Older cached samples are re-prepared after the update (#134).

- Test and Apply validate the manual Review quarantine's directory, permissions and filesystem/mount boundaries whenever Radarr is configured, including Recovery Off. Diagnostics create no directories; an unavailable quarantine is refused before activating a generation.

- Add guided shared Review/Recovery settings in English and Czech: persistent offline drafts, explicit diagnostics and Apply/Cancel, complete atomic configuration generations, safe Recovery drain/restart, migration choices, protected frozen/in-flight mappings and bounded private audit history. Recovery mode remains controlled by RECOVERY_MODE; saving never starts repairs.

- Preserve optional full-file hash progress in Recovery live status; exercise confirmation, changed-source refusal and public progress against the running worker.
- Explain missing review-step requirements when Save and continue is activated, including HDR devices, manual confirmations, track pairs, saved synchronisation checks and temporary blocks (English/Czech).

- Include diagnostic acceptance rules in the preview renderer identity so updates cannot reuse samples prepared under an older diagnostic policy.
- The rejection archive `rejection-decisions.jsonl` no longer follows a symlink: like the decision audit, a symlink, directory or named pipe in its place is refused, so the rejection fails and keeps the review copy instead of appending to another file or blocking (#125).
- The `Publish Docker images (manual)` workflow can move `latest` to an already published image by its verified digest (`promote_digest`) without rebuilding. It checks that the image exists in GHCR and that its revision label is the approved `main` commit, and leaves the version and `sha-<commit>` tags unchanged ([Releases](docs/RELEASES.md#move-latest-to-a-verified-image-without-rebuilding)).
- **Recovery refuses a `config.json` with a missing setting or an unusable value** (`RECOVERY_REFUSED invalid-config`), at start-up and in the restart notice for a later edit. Until now, for example, `"stableMinutes": "10 min"` or a missing `stableMinutes` silently disabled the source stability wait, and `"detectTerminalHeaders": "false"` enabled the check. The refusal names the setting and its rule, never its value; unknown keys are still ignored. The accepted values are listed in [Configuration](docs/CONFIGURATION.md#configjson), and [a read-only check](docs/CONFIGURATION.md#check-a-configjson-before-an-update) tests a file against the new rules before you update. The shipped example and a typical 1.11 configuration pass.

## 2.0.0 — 2026-10-15

Review and Recovery become one container. Installations that ran the separate Recovery container follow [the 2.0 migration guide](docs/MIGRATE-TO-2.0.md), which copies the old Recovery data and keeps frozen approval evidence unchanged.

### Breaking changes

- The separate `ghcr.io/desadius/tdarr-recovery` image is discontinued; no 2.0 version of it is published. The Review image contains Recovery.
- **Compose:** the `recovery` service and the `recovery` profile are removed; `compose.yaml` has one `review` service. `docker compose --profile recovery …` no longer finds the service, and `--remove-orphans` would remove an old Recovery container that is still running. Remove it deliberately as the migration guide describes.
- **Compose:** `.env` no longer uses `RECOVERY_IMAGE_TAG`, `RECOVERY_DATA_HOST` or `TDARR_REPORTS_HOST`. New: `RECOVERY_MODE` (`off`, `verify`, `repair`; default `off`).
- Recovery's data directory moves to `/data/recovery/` inside Review's data directory (`config.json`, `state.json`, `pending-approvals.json`, caches).
- Recovery uses Review's mappings. The example configuration now uses `/media/movies`, quarantine `/media/.tdarr-corrupt` and reports `/tdarr/JobReports` instead of `/storage/...` and `/reports`. Existing frozen paths are never rewritten: keep them with an extra `/storage` (and, if frozen, `/reports`) mapping to the same host folders.
- `RECOVERY_MODE` is the only Recovery switch; `enabled` in `config.json` is deprecated and must match it if present. An approval registry that froze `enabled: false` refuses `repair`; one that froze `enabled: true` allows both modes.
- Resource limits of the template and Compose rise to `--cpus=2 --memory=2g --pids-limit=256`, shared by Review and Recovery. Unraid does not change Extra Parameters of an installed container; raise them when you edit it.

### Documentation

- Add [the 2.0 migration guide](docs/MIGRATE-TO-2.0.md): stop and back up while idle, copy the old Recovery data to `/data/recovery/`, keep `/storage` paths with a mapping, map `/reports` or point `reports` at `/tdarr/JobReports`, derive `RECOVERY_MODE` from the old `enabled` (including a mode pinned by the registry), remove the old container, verify health, runtime state and status file, delete old data later, and roll back, recreating the old Recovery container from its kept Unraid template or the listed 1.11 settings. It includes a command that lists which keys the registry freezes without printing values.
- Installation, configuration, operations, Community Applications, architecture, release and registry migration documents and the Czech overview describe the single container.

### Review: Recovery runtime status

- Show Recovery's supervisor state (**Off**, **Running**, **Restarting**, **Refused**, **Stopped**) and reason in Review, separately from film cases and unfinished file-exchange transactions. Missing runtime state shows **Off** without attention; invalid or unreadable state is reported without exposing configuration or stderr.
- Add `recovery-original-outside-library` attention when a replacement request paused by Verify has kept the original outside the library for more than 24 hours. The Recovery view moves the case to **Needs attention** and tells the user to remove the stuck download in Radarr, after which Recovery returns the original on its next poll (English and Czech). The health check result does not change.
- Add refused-worker, crash-loop and unreadable-runtime attention to the operational health summary while keeping container health tied to Review availability. Warn before restarting or updating the unified container while Recovery reports original decoding or a mutating phase.

### Recovery worker

- Fix: a registry approved for Repair (frozen `enabled: true`) no longer refuses `RECOVERY_MODE=verify`, because Verify is strictly narrower. A registry frozen to Verify still refuses Repair, and every other frozen key still needs an exact match. The start-up check, the per-poll pending-approval check, the `configChange` validation and the offline migration utility use one shared rule. The status file reports the modes the registry allows as `registryAllowedModes`.
- Verify now pauses non-protective steps of in-flight repairs: kept-source removal and replacement requests, Tdarr handoff, and quarantine purge. Protective restoration with its existing conditions and read-only observation continue. Review shows the paused step and original location/time in English and Czech; Repair resumes from fresh checks.
- The Recovery mode now comes only from the `RECOVERY_MODE` environment variable: `verify` confirms corrupted originals and continues only protective steps of in-flight repairs (the former `enabled: false`), `repair` may act on a confirmed corruption (the former `enabled: true`). Set it from your current `enabled` value when updating.
- `enabled` in `config.json` is deprecated. A matching value is still accepted. A conflicting one, a missing or invalid mode, a missing, unreadable or invalid `config.json`, and an approval registry that refuses the configuration stop the worker before any API contact with exit code 78 and a final `RECOVERY_REFUSED <reason>` log line that never contains configuration values. A running worker reports a `config.json` edit whose `enabled` conflicts with the mode as invalid.
- The offline registry migration utility checks `config.json` with the same `RECOVERY_MODE` as the worker; run it with the mode the worker will use.
- Fix: the running worker now actually publishes the `configChange` restart notice introduced in 1.11.0. Its live status publisher dropped the field, so Review never showed the notice for edits made while the worker ran.

### Container image

- The Review image now contains Recovery and the offline registry migration utility (`/tools/migrate-recovery-registry.mjs`). Its entrypoint is tini, which runs the supervisor; the supervisor starts Review and, when `RECOVERY_MODE` is `verify` or `repair`, the Recovery worker at the lowest CPU and I/O priority with its data in `/data/recovery/`. Unset or `off`, the default, behaves as before: only Review runs. The read-only root, dropped capabilities and UID 99:100 are unchanged.

### Development and tests

- Docker smoke builds and tests only the Review image: tini and the supervisor at the default entrypoint, no Recovery process by default, the actual worker under `ionice`/`nice` in `verify`, a missing Recovery config reported as `refused` while Review stays healthy, the packaged migration utility, and a container stop within 10 seconds. `npm test` fails when the image would miss a module that the migration utility, the supervisor or the worker imports.
- `npm test` ends with a list of every skipped test and its reason, so a green run on Windows no longer hides the Linux-only tests that did not run.
- Add the manually dispatched `Linux tests (manual)` workflow, which runs chosen suite files (optionally filtered by test name) on Linux without the Docker jobs, and `tools/test-select.mjs` behind it.
- `npm run check` refuses new tests that read implementation source text instead of exercising behaviour; existing ones are allowlisted until they are rewritten.
- Add `CODING_STANDARDS.md` for reviewers (behaviour tests, a red per behaviour, every reader of a changed file) and a list of the readers of Recovery's `config.json` and approval registry in `docs/ARCHITECTURE.md`.
- Rename the domain glossary `CONTEXT.md` to `GLOSSARY.md`, following the agent skills' new convention.
- Development moves to WSL2: `AGENTS.md` and `docs/DEVELOPMENT.md` describe Linux tests, the local image build, Docker smoke and `test:docker` there, and the Windows-only instructions are removed. `npm run test:docker` downloads `node:24` once on the host when it is missing instead of failing, and stops with the command to retry when the download fails.
- `tools/test-select.test.mjs` no longer fails when `FORCE_COLOR` colours the test reporter output.

## 1.11.0 — 2026-10-13

### Review: workflow and interface

- Show the Tdarr nodes Review will resume, with the film and time each was paused for, and let you keep a node you paused yourself paused (with confirmation), so a maintenance pause set during an action is no longer undone. Retry a failed node restore from a server timer with backoff (15 s doubling to 10 min, reset after any successful restore) instead of on every `/api/items` poll, so reading the dashboard no longer changes Tdarr state.
- A film blocked by the strict video rules says which check failed (video track count, original codec, result codec, pixel format or resolution). The user guide explains every blocking rule.
- The Recovery view shows when Recovery's `config.json` was edited and needs a restart, in red when the next start would fail, and the progress of an optional full-file hash in the case list and detail.
- API errors carry a stable `code` (with optional `params`) next to the Czech `error` text. The UI shows them in the selected language from a shared Czech/English message table, including review-session and sample-identity errors; 19 of those previously had no English text. Missing English translations for file-identity, review-save and preview errors were added.
- The quarantine dialog and Radarr settings show the retention period reported by the server instead of a fixed "7 days".

### Review: safety, records and operations

- Append every finished approval and Radarr replacement request to a durable `decision-audit.jsonl` in `/data` (fsynced, rotated at 10 MiB into timestamped archives that are never deleted), in addition to the 150-entry history.
- Write one JSON line per approval, rejection, replacement request, batch, settings change, node pause/resume/keep, unresolved transaction and request error to the container log, never including keys, tokens or review evidence.
- The container health check reads a loopback-only `/health` summary and also requires the UI (`/`, `/app.js`). Pending exchange transactions, node restores and a stale Recovery status are written to Docker's health log without marking the container unhealthy.
- Centralize the concurrency policies: a mutating request is reserved before reading its body or running preflight, so competing approvals, batches, settings changes, restores and previews are refused with HTTP 409. Recovery-safe settings/preview access and review-session revision queues are preserved; discovery scans no longer write state during foreground work.
- Prune expired login sessions and finished login rate-limit windows at start-up, on login and hourly.
- Report the application version from the image build (or `package.json`) instead of a literal.

### Recovery worker

- Detect edits to `config.json` after start-up: log that a restart is required and report `configChange` in the shared status file. An edit is checked against the same approval-registry rules as start-up, so a change that would stop the next start (such as a changed frozen library value) is reported invalid with the rule, never the value. The running worker still applies configuration only at start-up.
- Optional setting `fullSourceHash` (default off): compare a full SHA-256 of the original at confirmation and again before Recovery changes anything in Radarr or Tdarr for the repair, at idle I/O and CPU priority with progress in the status file. Sampling stays the default.

### Development and tests

- Split `review/server.mjs` into route modules (`review/routes/`) and `review/public/app.js` into UI modules, without behaviour changes; both receive one explicit state context.
- Add `npm run typecheck` (pinned development-only TypeScript, CI only) for JSDoc types in `review/core.mjs` and `recovery/policy.mjs`; nothing is added to `package.json` dependencies or the images.
- Add `npm run test:coverage` (Node 24 built-in coverage in CI) and `npm run test:docker` (full Linux suite from Windows with a read-only repository and no network); Windows runs report POSIX-only tests as explicit skips.
- Add HTTP concurrency tests against the real server, a check that every authored server error has an English translation, a version-consistency check in `npm run check`, and regression tests for every change above.
- Document and test that a Recovery-returned hardlinked original stays blocked in Review while its quarantine protection is kept; document manual Tdarr pauses during a Review action.
- Remove the unused `sourceRelative()` helper with hard-coded installation prefixes.
- Add shared agent configuration for the issue tracker, triage labels and domain docs (`AGENTS.md`, `docs/agents/`).

## 1.10.5 — 2026-10-13

- Prepare the existing picture/audio/synchronization samples for waiting Review films in advance, with persistent private cache and bounded low-priority background work.
- Load prepared samples inside the review steps without auto-playing audio, saving manual confirmations or creating technical-score evidence. Other times and track pairs remain on-demand requests.
- Add ordered preferred/fallback audio languages, unambiguous main-track matching and an explicit optional other-language fallback. Saved manual pairs override suggestions.
- Expose preparation progress and configurable cache size, film count and expiry. Pause/preempt background decoding for foreground requests and media mutations; stop background work at the cache budget rather than cycling evictions.
- Mark each dashboard film's sample readiness with a distinct icon/color/text badge and active progress count/bar in both layouts. Keep sample readiness separate from manual review completion and preserve focus during unchanged polls.
- Retry a narrow H.264 seek failure once from an earlier decoder position while preserving the exact selected interval and all strict preview checks.
- Remove obsolete renderer artifacts from the owned cache on startup so updates cannot consume the budget with samples that are no longer reusable; retain valid prepared artifacts.
- Bound Compact and Detail AV previews with 3 Mb/s and 10 Mb/s VBV ceilings respectively, preserving the selected dimensions, 12-second interval and shared audio/video timing.
- Tolerate only the exact Matroska keyframe-cue warning after successful extraction and output validation; retain decoder errors and reject incomplete PCM waveform samples.
- Keep the shared Recovery status snapshot readable across atomic refreshes, including access through SMB, while retaining private permissions for worker state and settings.
- Stop the Recovery worker cleanly on SIGTERM/SIGINT (exit code 0 instead of 137 after the Docker stop timeout): an idle wait ends at once, and a check already in progress finishes its step before the worker exits.

## 1.10.4 — 2026-10-13

- Compare synchronized videos in one larger picture with a draggable divider; retain the side-by-side option.
- Add optional playback-only movement between 25% and 75%, keyboard/touch control, and pause-safe cleanup. Manual movement disables automatic movement.
- Offer bounded 960×540 and 1920×1080 preview profiles, preserving display aspect ratio and existing audio timing. These remain SDR/mono previews; native frames and external HDR/surround checks are still available.
- Keep manual review confirmations separate from playback and preserve the existing approval and source-identity checks.

## 1.10.3 — 2026-10-12

- Handle absent historical follow-up fields safely when opening recovery details and quarantine links.
- Separate unavailable/stale observations from actionable recovery failures, and use the exact follow-up case's own observation time.
- Display legacy replacement status through its exact stored Radarr path and unique Tdarr library row. This read-only association supplies no approval or cleanup authority and never manufactures fingerprints.
- Show Radarr's actual blocked-import messages, separate download progress from import/transcode/approval, and suppress obsolete downloader warnings after a confirmed handoff.
- Display the rolling daily-quota release time for frozen approved cases without changing authorization or repair limits.
- Explain each quarantine copy's retained state, deadline and exact recovery link; distinguish logical file sizes from physical disk usage.
- Distinguish a metadata-only timestamp mismatch from other installed-copy changes while retaining the same strict quarantine protection.
- Provide an optional Tdarr flow function requiring Review for Recovery replacements, including historical cases. Ordinary SDR routing remains unchanged; unavailable/stale Recovery status fails closed before original replacement.
- Keep existing assessment/revision, authentication, source identity, paired-file and retention checks. No migration or historical approval reconstruction is performed.

## 1.10.2 — 2026-10-12

Published as [v1.10.2](https://github.com/Desadius/Tdarr-Review/releases/tag/v1.10.2), with tested public `1.10.2` and `latest` images. Source publication, registry image publication and installation are separate operations.

- Add a five-step review workspace with manual confirmations beside the picture, audio and AV tools; preview playback never completes a check.
- Save review progress and deferral on the server. Record the selected track pair and server-timed observations for picture, audio and separate start/middle/end synchronisation checks.
- Require the completed current-snapshot review and its current revision for approval, including whole-batch preflight. Concurrent saves use revision checks; changed files, devices or track pairs invalidate the affected confirmations.
- Support reviews already performed in an external player/TV, with a named device and separate HDR/Dolby Vision confirmation.
- Add playable 12-second H.264/mono AAC AV comparisons with shared seek, sound switching and frame stepping; native HDR and surround playback remain external checks.
- Add English/Czech interface selection, including workflow controls, confirmation dialogs and known status messages.
- Validate with 297 Linux tests, AV fixture/HTTP checks, approval HTTP integration and reopening a saved review on a healthy local deployment.

## 1.10.1 — 2026-10-12

- Continue observing manual Review replacement requests after Radarr import, using the exact replacement path and original Tdarr library binding.
- Expose current Tdarr state, observation time, separate observation/retention errors and approval-based quarantine cleanup state without publishing private paths.
- Keep Tdarr success distinct from explicit Review approval and seven-day retention evidence.
- Resume automatically diagnosed daily-quota cases after capacity clears using frozen source/history evidence. Hold the exact bad edition during the wait and avoid repeating full decodes, including terminal-header cases.
- Persist frozen repair authorization in `/data/pending-approvals.json`, separate from source/images. Validate it before APIs; provide an offline backup and exclusive migration utility. Completed legacy metadata remains non-authorizing history.
- Publish measured original-decode progress for each verification pass, bounded heartbeat updates and an ETA when duration/rate are known. Separate decoder measurements, worker liveness and cached Tdarr observation times.
- Recognize reproducible DTS-HD XLL band-data failures. Reconsider old unrecognized job reports once; a failed converted-file check alone never authorizes a replacement download.
- Link an imported replacement to its exact follow-up Recovery case in Review, including measured progress, retry time and a direct case link. Flag ctime-only historical differences for display without relaxing repair identity checks. Do not transfer approval or quarantine cleanup authority across cases.
- Diagnose a distinct failed replacement during its movie cooldown. Only repeated unchanged-source decoding evidence may hold the exact edition while preserving it in the library; cooldown and daily download limits still apply. Resume with verified frozen evidence, without another decode.
- Reconcile automatic Recovery handoffs after interruption using the exact file/library state. Preserve active, queued and terminal jobs; uncertain writes are never blindly replayed.
- Show completed original diagnostics, disabled repair actions and held replacements explicitly in Review. Neither a progress stream ending nor a completed diagnostic approves a conversion.
- Separate read-only source CI from manual Docker publication for an approved main commit. Updating `latest` is disabled by default; deployment is a separate step.

## 1.10.0 — 2026-10-11

- Separate attention dashboard, library, recoveries, history, savings and settings.
- Unified film detail with overview, comparisons, recovery and technical data.
- Authenticated Radarr poster proxy with exact movie matching, bounded cache and fallback artwork.
- Structured UI capability checks; stale data and incomplete states do not enable unsafe decisions.
- Shared Recovery → Radarr → Tdarr lifecycle, including deferred daily limits, replacement imports, quarantine and status timestamps.
- Replacement filename changes no longer trigger checks against an obsolete original path.
- Interrupted Review handoffs verify actual Tdarr state instead of blindly queueing another job.
- Sequential original-left/transcode-right headphone comparison of the same 12-second segment.
- Seven-day quarantine cleanup after identified replacement approval, with persistent evidence and identity checks.
- Recorded reasons for rejection and replacement requests.
- Evidence-based assessment score and audio alignment visualization.

## 1.8–1.9 — compatibility and recovery

- Exact source/job matching and optional receipts, including TS/M2TS → MKV extension changes.
- Conservative Radarr replacement request preserving both original and Review copy.
- Repeated original decoding confirmation and precise bad-release exclusion in the optional Recovery worker.
- Rust engine compatibility and read-only database/API fallback for Review.

## 1.7 — statistics

- Dedupe verified file savings, Review-approved subset and pending potential.
- Separate Tdarr-reported global size difference; do not add overlapping totals.

## 1.5–1.6 — comparison and configuration

- Side-by-side PNG frames with synchronized viewing and consistent HDR-to-SDR preview.
- Configurable paths, origins, Tdarr connection and library matching.

## 1.3 — approval workflow

- Normal approval no longer performs another full video/audio decode.
- Copy/hash progress and stage-specific ETA.

## 1.1 — batch approval and API responses

- Sequential batch approval with whole-batch preflight and conflict exclusion.
- Tdarr plain-text `OK` responses no longer cause JSON parse failures.
- Restore only node pauses owned by Review; preserve interrupted transaction evidence.

## Repository preparation — 2026-10-11

- Publish current source, installation examples, documentation and isolated regression tests.
- Exclude production state, credentials, one-off migration runner and real film repair approvals.
- Approved pending repairs use an explicit frozen registry rather than deployment-specific movie IDs; the shipped registry is empty.
- Container builds and GitHub CI were supplied with the source snapshot.

## Docker and Community Applications packaging — 2026-10-11

- MIT license for the project's own code, templates and documentation; upstream runtime notices retained.
- Linux amd64 Review and optional Recovery images, with bundled Node/SQLite/FFmpeg, writable state provisioning and source/revision labels.
- Container health check respects the configured browser origin and saved settings.
- Isolated image startup, login, approval integration and disabled Recovery smoke checks gate GHCR publication.
- Unraid Community Applications profile, beta template, project icon and submission guide. Submission received and auto-approved; the app will appear after the next catalog build publishes.
