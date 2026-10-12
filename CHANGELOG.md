# Change history

This records the implemented application features. Versions before 1.10.0 were deployed snapshots and are not published Git tags.

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
