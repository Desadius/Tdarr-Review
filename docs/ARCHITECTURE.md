# Architecture and safety

Review is a Node HTTP server with no third-party JavaScript runtime dependencies. It reads Tdarr SQLite data and falls back to the existing Tdarr collection API for supported schemas. It calls FFprobe/FFmpeg for metadata and requested comparison samples. The browser receives no Radarr API key.

```mermaid
flowchart LR
  A[Original library / Plex] --> T[Tdarr transcode and health check]
  T --> R[Separate Review result]
  R --> U[Human assessment]
  U -->|approve| C[Verified replacement transaction]
  C --> A
  T -->|original error candidate| W[Recovery: two independent checks]
  W -->|confirmed and bound to release| Q[Quarantine and Radarr search]
  Q --> N[New imported original]
  N --> T
  W --> S[Shared lifecycle snapshot]
  S --> U
```

## Replacement transaction

Review stores transaction phases durably before continuing. The destination copy is verified against the Review result before replacing the original. File identities and Tdarr activity are checked again. The temporary old version and result are removed only after installation succeeds. A successful approval publishes evidence for the exact imported source and installed replacement.

On restart, only a provably untouched original can be restored automatically. Installed or ambiguous transactions remain for inspection; their journal and temporary files must not be discarded. Concurrent approvals, rejections, settings changes and preview operations are guarded by the server, not just disabled buttons.

### Server layout

`review/server.mjs` loads configuration and state, recovers transactions, owns discovery (`scan`), the approval/rejection transaction (`perform`), node pausing/resuming and preview preparation, and runs the request pipeline. Every request first passes the Host check, the POST origin and JSON checks, login, authentication and, for a mutating request, the busy-policy reservation. Only then is it dispatched to the route modules in `review/routes/`:

| Module | Routes |
| --- | --- |
| `auth.mjs` | Login and session check |
| `items.mjs` | Item list, review sessions, approve, reject, batch, recheck, Radarr replacement request, review-file download |
| `previews.mjs` | Sample preparation settings and status, on-demand frames, audio and AV samples |
| `settings.mjs` | Tdarr connection and path settings |
| `library.mjs` | Posters, statistics, quarantine listing, Radarr settings, requests and restore, Recovery runtime diagnostics |
| `static.mjs` | The fixed set of UI files in `review/public/` |

Route modules receive one explicit server-state object (`ctx`). Its getters and setters read and write the server's own variables, so the busy flags, caches and settings that routes change are the same ones used by scanning, transactions and background preparation. A route returns `true` once it has answered; `review/routes.test.mjs` checks that every route is owned by exactly one module.

### Browser UI modules

The UI in `review/public/` is a set of ES modules loaded without a build step. `app.js` holds the page state (latest data, Radarr requests, selection, navigation) and renders the item list, detail dialog, confirmations and progress. It passes one context object (`api`, `error`, `load`, `loadRequests`, `openDetail` and getters for the current state) to the feature modules:

| Module | Content |
| --- | --- |
| `ui-kit.js` | DOM and formatting helpers without application state |
| `comparison.js` | Frame and audio/AV comparison dialogs and the A/B player |
| `settings-dialogs.js` | Review, sample-preparation and Radarr settings dialogs |
| `quarantine.js` | Quarantine listing |
| `statistics.js` | Savings statistics |
| `recovery-view.js` | Recovery progress and detail renderers |
| `review-workflow.js`, `review-model.js`, `av-player.js`, `i18n.js` | Review steps, display rules, AV player and translations (unchanged) |

Every module URL carries a `?v=` version so a release cannot mix cached old and new modules. A new UI file must also be listed in the static asset table in `review/routes/static.mjs`.

### Concurrent application actions

`review/busy-guards.mjs` defines the server's named concurrency policies. After authentication, a mutating request reserves foreground work before reading its body, draining background previews or awaiting preflight. The reservation transfers to the existing active/batch flag when an asynchronous action starts, and releases on every response/error. An interactive preview reserves work after its body distinguishes an on-demand render from a cache-only/track-list read. Competing mutations receive HTTP 409.

| Action | Additional blockers beyond foreground work | Deliberate allowance |
| --- | --- | --- |
| Approve, reject, batch, Radarr replacement | Unresolved replacement recovery and owned node pauses | Join an existing scan for fresh preflight; the request keeps its foreground reservation while waiting. |
| Quarantine restore, recheck | Scan, unresolved recovery and owned pauses | None. These change media bindings and must start from idle state. |
| Main settings save/test | Scan, statistics calculation, unresolved recovery and owned pauses | None. These may change the media/API configuration used by those operations. |
| Radarr settings save/test, preview cache settings | Scan | Remain available during unresolved recovery/owned pauses because they cannot replace media or resume Tdarr dispatch. |
| Interactive preview | Scan | May read media during unresolved recovery/owned pauses, with existing file identity validation. |
| Saved review write | Scan, unresolved recovery and owned pauses | Writes retain their revision-aware CAS queue; the queue does not exclude itself. |

Foreground work includes active transactions, batches, node-resume requests, previews, settings and review writes. A running node resume blocks settings and interactive previews even when unresolved pauses themselves are allowed. Discovery scans persist item metadata: during foreground mutations, read requests use the previous cache (or an empty list before the first scan), and approval/rejection/replacement preflight scans use their own reservation. Scans coalesce rather than starting competing scans. Background preparation/cleanup also waits for foreground work, scans, recovery and owned pauses.

Cache-only previews and track-list reads keep their existing read-only availability. Neither can record a manual review confirmation. HTTP regression tests start the real server with temporary synthetic files/SQLite and gated loopback Tdarr/Radarr/probe/renderer fixtures; they check every mutating route, competing approvals, settings and preview overlap, scan preflight, pause restoration and unresolved recovery. The HTTP fixture suite runs on the supported Linux platform with Node 24; portable policy tests also run on Windows.

## Shared settings generations

review/shared-settings.mjs owns the durable shared draft and complete active generation in /data/shared-settings.json. Legacy settings.json, radarr.json and recovery/config.json are import/CAS inputs after activation, not competing ordinary-settings authorities. Public projections allowlist editable fields and never return credentials or historical exception values. Process-lifetime ownership (Linux boot ID and process start ticks) protects writes across PID reuse; immutable unique candidates exclude concurrent writers without stale fixed-path lock replacement.

Authenticated /api/shared-settings routes stage drafts and expose revisions/history. review/settings-apply.mjs owns the explicit asynchronous apply: read-only diagnostics, Recovery admission drain/ack, Review safe-state barrier, revalidation, stop, atomic generation commit, complete in-memory activation/cache invalidation and Recovery-only restart. /status and /cancel remain available while waiting. A transient finalizing state covers terminal audit/barrier release. settings-activation.json is an interruption fence, never a persistent command. On interrupted/ambiguous activation, startup uses a complete committed generation and fails Recovery closed as needed; it does not resume apply or roll back endpoints.

Review, artwork and healthcheck read the active Review/Radarr snapshot. Recovery's managed-config adapter enforces mode first and then consumes the same generation before the existing registry/state checks. A private historical exception revocation refuses stale Recovery authority; Review's non-authorizing reader remains usable to correct settings. Off never starts a worker. Legacy startup remains unchanged until the first managed generation. No UI test, save, connection check or navigation grants film approval.

## Automatic original recovery

The worker serializes heavy checks. It requires stable regular media, no active matching Tdarr job/result, unambiguous Radarr file/history binding and repeated matching recognized errors. Metadata fingerprints and sampled hashes must remain consistent. Sampling detects changes but is not a full-file health checksum. With the opt-in `fullSourceHash` setting the worker also compares a full SHA-256 taken at confirmation with one taken immediately before the quarantine rename.

After confirmation, it holds the old edition, preserves it outside the library, confirms Radarr no longer sees the old file and verifies exact release exclusion. It observes the replacement import and hands it to Tdarr. Unknown/interrupted mutation phases become manual rather than being blindly replayed.

A distinct new replacement can be diagnosed during the per-movie cooldown. A reproducible recognized error in two actual decodes of the unchanged source permits only a journaled, acknowledged Hold of that exact Tdarr file/library. It stays in the media library, and no Radarr download, release exclusion, profile change or quarantine cleanup is initiated during the cooldown. The older case retains its own quarantine and approval evidence. At the deadline, Recovery verifies the frozen source/hash/history binding and Hold again, then proceeds only when the daily limit permits. Older incomplete evidence is not silently promoted to this new contract.

Automatic daily-quota deferrals have their own frozen journal and acknowledged Hold. Later passes verify the unchanged source, sample, current Radarr binding and configured roots/library before resuming with the existing two decode results. They do not return to ordinary job/header discovery and repeat heavy checks. Capacity uses the expiration that leaves fewer active mutations than the configured limit, including cases where the current count exceeds a reduced limit. Historical frozen approvals follow their separate pending loop.

Frozen repair authority is loaded solely from persistent `/data/pending-approvals.json` before restart handling or APIs. It is bounded, schema/mapping/evidence checked and deep-frozen; semantic membership ignores object-key order while preserving evidence-array order. Missing historical authority is never reconstructed from state. An offline exclusive migration preserves exact source/state backups. Completed imported legacy metadata with a consistent original tuple can remain read-only history, but it never authorizes another repair or joins the registry automatically.

Automatic replacement handoffs journal the exact imported path, fingerprint and movie-file ID. On retry, a verified existing Queued, Transcoding or terminal Tdarr record is preserved. Only an eligible Hold is released; a missing entry is scanned and read back before any queue decision. Pending transport results retain the handoff intent, while changed bindings or unsupported states require manual inspection. No remote plain-text `OK` is treated as sufficient evidence of completion.

If a newer Recovery case protects the same exact source fingerprint, an older pending handoff preserves its Hold. A missing protected record is not rescanned, since scanning could dispatch the known faulty edition again. This protection is bound to the source identity, so a genuinely different future import does not inherit the previous edition's Hold.

When no replacement is available, automatic Recovery may return the protected original via hardlink or exclusive copy while keeping the edition excluded from Tdarr. Before a later download, it validates both identities and removes only that recorded library link/copy. The quarantined original remains until the retention conditions are met.

The hardlink return deliberately gives the preserved source two directory entries (`nlink = 2`): one in quarantine and one in the library. Review's `safeFile()` requires `nlink === 1` for both the original and result, so any result paired with that hardlinked edition is blocked with the multiple-hardlinks reason. Manual review completion supplies no exception. An exclusive-copy fallback does not trigger this guard, but does not release Recovery's Tdarr Hold or supply approval evidence. After Recovery removes its recorded library path and Radarr imports a distinct replacement, that new source must pass the normal independent Review checks. Never weaken the hardlink guard or remove the preserved quarantine entry to make an old result approvable.

### Readers of `config.json` and the approval registry

Recovery's `config.json` and the persistent approval registry (`pending-approvals.json`) each have several readers. They must accept and refuse the same files, so a change to how one of them interprets either file needs the matching change, and a test, in every other reader:

- `recovery/recovery-mode.mjs` (`readRecoveryConfig`) is the legacy parser of `config.json` together with `RECOVERY_MODE`. After the mode and `enabled` it applies the value rules of `recovery/config-values.mjs` (every required setting present, each known setting of a usable type and range, unknown keys ignored). A refusal exits with code 78 and a final `RECOVERY_REFUSED <reason>` line.
- `recovery/frozen-config.mjs` holds the single rule for comparing the registry's frozen `config` with the running configuration: exact match for every key, except that a frozen `enabled: true` also accepts Verify. It also derives `registryAllowedModes` for the status file. Every reader below compares through it; none has its own comparison.
- `recovery/worker.mjs` reads configuration through `readRuntimeRecoveryConfig` in `recovery/managed-config.mjs` before any state/registry/API access: managed authority when present, otherwise legacy `config.json` through `readRecoveryConfig`; it then reads the registry through `loadApprovalRegistry` in `recovery/approval-registry.mjs`. Every poll, `processPending` in `recovery/pending-approved.mjs` compares the frozen `config` with the running one again before frozen approvals may run.
- `recovery/config-watch.mjs` (`startupValidator`) re-runs the same start-up checks on every later edit of `config.json`. For managed settings the worker compares the effective generation and rechecks startup/registry authority instead. The result is published as `configChange` by `recovery/live-status.mjs` and shown by Review (`review/radarr-replacement.mjs`).
- `tools/migrate-recovery-registry.mjs` is the offline migration utility. It reads the same effective managed-or-legacy configuration and `RECOVERY_MODE` through `readRuntimeRecoveryConfig` (without resuming activation) and installs the registry through `migrateApprovalRegistry`. The Review image ships it at `/tools/` beside the whole `recovery/` directory at `/recovery/`. `tools/image-layout.test.mjs` loads it from the files the `Dockerfile` copies, so a module missing from the image fails `npm test`.
- `tools/docker-smoke.mjs` writes a synthetic `config.json` to `/data/recovery/` to start the built image in `verify`.
- The inspection command in [the 2.0 migration guide](MIGRATE-TO-2.0.md#check-what-the-old-configuration-and-registry-freeze) reads both files of a 1.11 installation and prints only key names, counts and the `enabled` flags; `tools/docs.test.mjs` runs it. A change to the registry shape or to the meaning of `enabled` updates it too.
- `examples/recovery-config.example.json` uses Review's mappings (`/media`, `/review`, `/tdarr`); `tools/packaging.test.mjs` passes it through `resolveRecoveryConfig` and `loadApprovalRegistry` in both modes.

## Supervisor

`review/supervisor.mjs` is the entrypoint that runs Review and Recovery in one container ([ADR 0001](adr/0001-recovery-runs-inside-review.md)). The image runs it under [tini](https://github.com/krallin/tini) (`ENTRYPOINT ["/usr/bin/tini", "--"]`, a static binary pinned by checksum), so the container needs no `docker run --init`: tini is PID 1, passes SIGTERM to the supervisor and reaps orphaned processes. The image places Review at `/review-app/`, the Recovery modules at `/recovery/` (the supervisor starts `../recovery/worker.mjs` from `server.mjs`) and the registry migration utility at `/tools/`. The supervisor always starts Review (`review/server.mjs`). When the Recovery mode (`RECOVERY_MODE`) is `off` or unset, it never starts Recovery. Any other value starts the Recovery worker (`recovery/worker.mjs`) through `ionice -c 2 -n 7` and `nice -n 19`, with `DATA_ROOT` set to `<DATA_ROOT>/recovery` and the mode passed on unchanged. The worker itself refuses a value other than `verify` or `repair`, so the supervisor never decides that repairs are allowed.

- **Crash.** Recovery exiting for any reason other than a refusal or a stop is restarted after 10 s, doubling with each consecutive crash up to 5 minutes. From the fifth consecutive crash the state file reports `crash-loop`. A run that lasts 10 minutes resets the count. Review is never signalled or restarted because of Recovery, and a Recovery command that cannot be spawned counts as a crash.
- **Refusal.** Exit code 78 with a last stderr line `RECOVERY_REFUSED <reason>` (see [Readers of `config.json`](#readers-of-configjson-and-the-approval-registry)) is not restarted. Recovery's stderr still reaches the container log; only a reason matching `[a-z0-9-]{1,64}` is copied into the state file, anything else is recorded as `unknown-refusal`.
- **Review exits.** The supervisor cancels a pending restart, sends Recovery SIGTERM, sends SIGKILL if it is still running 8 seconds later (within Docker's default 10-second stop timeout), and exits with Review's status (128 + signal number when Review died of a signal, 127 when Review could not be started).
- **SIGTERM/SIGINT.** The first signal is forwarded to both children; a repeated one is not forwarded again, so Review's own shutdown handler is never cut short. The supervisor exits with Review's status after both have exited, with the same 8-second limit for Recovery. The handlers are in place before the first state write, because PID 1 ignores signals without a handler and the supervisor is PID 1 whenever it runs without tini. An interrupted original decode is retried, never counted as corruption evidence.

### Settings apply control

Review's settings coordinator uses `createRecoveryControlClient()` (`review/recovery-control.mjs`) over its inherited child-process IPC channel. The supervisor accepts commands only from its own Review child and sends worker commands over a separate IPC channel inherited through `ionice`/`nice`. There is no network control listener, Docker socket or persistent command file. Messages contain an allowlisted action, bounded request/correlation identifiers and a supervisor-instance session; configuration and API keys never travel over this protocol.

`requestDrain(id)` returns `draining` promptly. Worker admission closes between complete journaled operations, including individual case loops. The current operation finishes, state and status are flushed, and only then does the worker acknowledge `ready`. Verify mode is subject to the same admission gate, including protective restoration. `wait(id)` polls until a drain/start reaches a final state; `status(id)` reads its current state. `cancel(id)` before stopping resumes the old worker. `stopAfterDrain(id)` requires positive readiness and waits for orderly worker exit with no timeout or forced signal; disconnect still fails the caller. `restart(id)` starts only Recovery and returns `starting`, followed by `running` only after the worker validates its configuration, registry and restart reconciliation. Connectivity checks belong to the settings coordinator's pre-apply diagnostics. A refusal or exit before that startup acknowledgement becomes `failed`, with no automatic retry or rollback. Once startup succeeds, ordinary crash handling resumes.

Off remains off throughout this protocol. Requests exist only in supervisor memory; a new supervisor instance invalidates their session and never resumes an old drain or apply. An abandoned stopped request can be replaced by a new explicit request; the old identifier then expires. Durable generation commit and interrupted-activation detection belong to the settings coordinator/store adapter and must gate initial startup separately from this volatile protocol. Container shutdown retains its existing signal and grace-period policy.

### One container, shared mappings

Up to 1.11.0 Recovery ran in its own container with its own `/data`, the media parent at `/storage` and read-only `/review` and `/reports`. Since 2.0.0 it shares the Review container, its user (UID 99:100) and Review's mappings; there is no separate Recovery image or Compose service. Its data root is `/data/recovery/` (`config.json`, `state.json`, the private `pending-approvals.json` and caches). Recovery may write only there, to the shared status file `.tdarr-recovery-status.json` in the parent of its media root, to the original-language cache, to quarantine and through the library operations it already performs; never to `/review` or elsewhere in `/data`. With the container boundary gone, this is a convention guarded by tests, not by mounts ([ADR 0001](adr/0001-recovery-runs-inside-review.md)).

Frozen approval evidence is never rewritten to fit the new defaults. An installation migrated from the separate container keeps its frozen `/storage` roots by mapping `/storage` to the same host folder as `/media`, so Review and Recovery still address the same files and status file ([2.0 migration](MIGRATE-TO-2.0.md)).

### Recovery runtime state file

The supervisor publishes `<DATA_ROOT>/recovery/runtime-state.json` (mode 0600) at start and on every change. Each write goes to a temporary file that is synced and renamed over the old one, followed by a directory `fsync`, so a reader never sees a partial file. A write failure is logged and never affects Review. The file holds exactly these fields and never contains configuration values, keys or other stderr text:

| Field | Value |
| --- | --- |
| `version` | `1`. A change of meaning or removal of a field needs a new version. |
| `mode` | `off`, `verify`, `repair`, or `invalid` for any other `RECOVERY_MODE` value. |
| `state` | `off` (mode is off; Recovery is never started), `running`, `restarting` (waiting for the next start after a crash), `refused` (exit 78; no automatic restart) or `stopped` (Review exited, the container is stopping, settings drained the worker, or apply startup failed). During settings apply the control protocol's `starting`/`running` states supply explicit startup readiness; this informational file reports `running` at spawn. |
| `restarts` | Number of restarts since the supervisor started. |
| `lastExitCode` | Exit code of the last Recovery exit, or `null` (never exited, killed by a signal, or could not be spawned). |
| `lastExitSignal` | Signal name such as `SIGKILL` that ended the last Recovery run, or `null`. |
| `lastStartedAt`, `lastExitedAt` | ISO 8601 times of the last start and exit, or `null`. |
| `reason` | `null`, or a reason code: `crash` (restarting after a crash), `crash-loop` (five or more consecutive crashes, reported while restarting and running until a run lasts 10 minutes), the refusal reason (for example `missing-config`, `mode-conflict`, `invalid-mode`, `registry-refused`, or `unknown-refusal`), `review-exited`, `shutdown`, `settings-apply` (orderly drained stop), or `apply-start-failed` (worker exited during drain/apply without a refusal). |
| `updated` | ISO 8601 time of this write. |

## Shared lifecycle

Recovery atomically publishes a versioned, allowlisted status file. It includes deferred limits, verification, quarantine, release exclusion, search/download, import and the replacement's Tdarr database state. It does not publish keys or unrestricted quarantine paths.

The worker normally waits five minutes between passes. During an original decode it publishes a heartbeat every 30 seconds and coalesces measured FFmpeg progress at most every 15 seconds. Duration comes from a bounded metadata probe; unknown duration gives indeterminate progress. Each of the two passes has its own media position, elapsed time and rate-based ETA. Progress is capped below 100% until the actual exit/stderr/identity evidence is evaluated; FFmpeg `progress=end` is not health evidence.

Worker heartbeat, last decoder measurement and last Tdarr database observation have separate timestamps. A heartbeat does not refresh the timestamp of a cached imported record. Review preserves these per-case timestamps and labels snapshots older than 12 minutes as stale. Database `Queued`/`Transcoding` status is not a per-worker percentage. Status publication failure is reported separately and cannot change a source's decoding classification.

### Verify pause and original location

The waiting-source path gates only replacement requests/source removal on `cfg.enabled === false`; its protective restoration and read-only import observation continue. Import observation records current metadata while preserving a paused handoff phase. The worker gates Tdarr handoff and quarantine retention separately. No mutation plan or release selection is persisted for use after a pause; Repair re-enters the existing identity, queue/movie, Tdarr and approval checks.

The version-1 public case projection adds `verifyPausedStep` (`replacement_request`, `tdarr_handoff`, `quarantine_purge`, or `null`), `originalOutsideLibrary` (boolean, or `null` when location cannot be checked), `originalOutsideSince`, and `originalRestoredAt`. They are allowlisted by the live publisher, retained in linked followups and passed to Review's case API and Recovery view. No paths or configuration values are included. The pause marker is derived from the active mode and current phase, never repair authority. Location checks compare both the recorded library source and quarantine identities, including a restored copy/link. A differently named replacement does not imply the old original vanished; missing or changed quarantine is shown as unknown location.

New library removals and restorations record their location times in the private journal. For old quarantined cases that never recorded restoration, the original mutation start is the historical fallback; after an observed restoration, an unknown later removal time remains unknown. Snapshot publication does not advance these timestamps. Review derives one health attention from them (`recovery-original-outside-library`, a fresh status with a paused `replacement_request` whose original has been outside the library for more than `RECOVERY_ORIGINAL_OUTSIDE_MS`, 24 hours, in `review/public/review-model.js`, shared by the health summary and the Recovery view). They never change the health check result or approval.

## Quarantine retention

Seven days are counted from a verified Review approval of the identified replacement, not from download, import, job success or original quarantine time. Cleanup validates approval evidence, installed file identity, the recorded quarantine identity, containment, regular files, no symlinks and appropriate hardlink count.

Only recorded eligible files are removed; unrelated quarantine contents are not recursively deleted. Unapproved replacements, unknown identities and historical cases missing evidence stay preserved. They can therefore consume space until reviewed deliberately.

## Access boundaries

All application APIs require a Review session. Mutations check browser origin. Session cookies are HttpOnly and SameSite Strict. The provided containers drop capabilities, run as an unprivileged UID, use a read-only root filesystem, and do not mount the Docker socket.

Media write access is necessary for replacement. Mounting the media parent for quarantine gives the application access to that mounted share, not only one film directory. Keep the service on a trusted LAN; this version is not hardened or independently audited for direct public Internet exposure. See [Security](../SECURITY.md).
