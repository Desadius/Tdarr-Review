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
| `library.mjs` | Posters, statistics, quarantine listing, Radarr settings, requests and restore |
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

- `recovery/recovery-mode.mjs` (`readRecoveryConfig`) is the single parser of `config.json` together with `RECOVERY_MODE`. A refusal exits with code 78 and a final `RECOVERY_REFUSED <reason>` line.
- `recovery/worker.mjs` reads both at start-up, before any state, registry or API access: `config.json` through `readRecoveryConfig`, the registry through `loadApprovalRegistry` in `recovery/approval-registry.mjs`.
- `recovery/config-watch.mjs` (`startupValidator`) re-runs the same start-up checks on every later edit of `config.json`. The result is published as `configChange` by `recovery/live-status.mjs` and shown by Review (`review/radarr-replacement.mjs`).
- `tools/migrate-recovery-registry.mjs` is the offline migration utility. It reads `config.json` with the same `RECOVERY_MODE` through `readRecoveryConfig` and installs the registry through `migrateApprovalRegistry`. The Recovery image ships it at `/tools/`, and `Dockerfile.recovery` copies the `recovery/` modules it imports into `/recovery/` by hand: a new import needs a new entry there.
- `tools/docker-smoke.mjs` writes a synthetic `config.json` to start the built image.

## Supervisor

`review/supervisor.mjs` is the entrypoint that runs Review and Recovery in one container ([ADR 0001](adr/0001-recovery-runs-inside-review.md)). It always starts Review (`review/server.mjs`). When the Recovery mode (`RECOVERY_MODE`) is `off` or unset, it never starts Recovery. Any other value starts the Recovery worker (`recovery/worker.mjs`) through `ionice -c 2 -n 7` and `nice -n 19`, with `DATA_ROOT` set to `<DATA_ROOT>/recovery` and the mode passed on unchanged. The worker itself refuses a value other than `verify` or `repair`, so the supervisor never decides that repairs are allowed.

- **Crash.** Recovery exiting for any reason other than a refusal or a stop is restarted after 10 s, doubling with each consecutive crash up to 5 minutes. From the fifth consecutive crash the state file reports `crash-loop`. A run that lasts 10 minutes resets the count. Review is never signalled or restarted because of Recovery, and a Recovery command that cannot be spawned counts as a crash.
- **Refusal.** Exit code 78 with a last stderr line `RECOVERY_REFUSED <reason>` (see [Readers of `config.json`](#readers-of-configjson-and-the-approval-registry)) is not restarted. Recovery's stderr still reaches the container log; only a reason matching `[a-z0-9-]{1,64}` is copied into the state file, anything else is recorded as `unknown-refusal`.
- **Review exits.** The supervisor cancels a pending restart, sends Recovery SIGTERM, sends SIGKILL if it is still running 8 seconds later (within Docker's default 10-second stop timeout), and exits with Review's status (128 + signal number when Review died of a signal, 127 when Review could not be started).
- **SIGTERM/SIGINT.** The first signal is forwarded to both children; a repeated one is not forwarded again, so Review's own shutdown handler is never cut short. The supervisor exits with Review's status after both have exited, with the same 8-second limit for Recovery. The handlers are in place before the first state write, because the supervisor runs as PID 1, which ignores signals without a handler. An interrupted original decode is retried, never counted as corruption evidence.

### Recovery runtime state file

The supervisor publishes `<DATA_ROOT>/recovery/runtime-state.json` (mode 0600) at start and on every change. Each write goes to a temporary file that is synced and renamed over the old one, followed by a directory `fsync`, so a reader never sees a partial file. A write failure is logged and never affects Review. The file holds exactly these fields and never contains configuration values, keys or other stderr text:

| Field | Value |
| --- | --- |
| `version` | `1`. A change of meaning or removal of a field needs a new version. |
| `mode` | `off`, `verify`, `repair`, or `invalid` for any other `RECOVERY_MODE` value. |
| `state` | `off` (mode is off; Recovery is never started), `running`, `restarting` (waiting for the next start after a crash), `refused` (exit 78; not restarted until the container restarts) or `stopped` (stopped because Review exited or the container is stopping; `off` and `refused` stay as they are). |
| `restarts` | Number of restarts since the supervisor started. |
| `lastExitCode` | Exit code of the last Recovery exit, or `null` (never exited, killed by a signal, or could not be spawned). |
| `lastExitSignal` | Signal name such as `SIGKILL` that ended the last Recovery run, or `null`. |
| `lastStartedAt`, `lastExitedAt` | ISO 8601 times of the last start and exit, or `null`. |
| `reason` | `null`, or a reason code: `crash` (restarting after a crash), `crash-loop` (five or more consecutive crashes, reported while restarting and running until a run lasts 10 minutes), the refusal reason (for example `missing-config`, `mode-conflict`, `invalid-mode`, `registry-refused`, or `unknown-refusal`), `review-exited` or `shutdown`. |
| `updated` | ISO 8601 time of this write. |

## Shared lifecycle

Recovery atomically publishes a versioned, allowlisted status file. It includes deferred limits, verification, quarantine, release exclusion, search/download, import and the replacement's Tdarr database state. It does not publish keys or unrestricted quarantine paths.

The worker normally waits five minutes between passes. During an original decode it publishes a heartbeat every 30 seconds and coalesces measured FFmpeg progress at most every 15 seconds. Duration comes from a bounded metadata probe; unknown duration gives indeterminate progress. Each of the two passes has its own media position, elapsed time and rate-based ETA. Progress is capped below 100% until the actual exit/stderr/identity evidence is evaluated; FFmpeg `progress=end` is not health evidence.

Worker heartbeat, last decoder measurement and last Tdarr database observation have separate timestamps. A heartbeat does not refresh the timestamp of a cached imported record. Review preserves these per-case timestamps and labels snapshots older than 12 minutes as stale. Database `Queued`/`Transcoding` status is not a per-worker percentage. Status publication failure is reported separately and cannot change a source's decoding classification.

## Quarantine retention

Seven days are counted from a verified Review approval of the identified replacement, not from download, import, job success or original quarantine time. Cleanup validates approval evidence, installed file identity, the recorded quarantine identity, containment, regular files, no symlinks and appropriate hardlink count.

Only recorded eligible files are removed; unrelated quarantine contents are not recursively deleted. Unapproved replacements, unknown identities and historical cases missing evidence stay preserved. They can therefore consume space until reviewed deliberately.

## Access boundaries

All application APIs require a Review session. Mutations check browser origin. Session cookies are HttpOnly and SameSite Strict. The provided containers drop capabilities, run as an unprivileged UID, use a read-only root filesystem, and do not mount the Docker socket.

Media write access is necessary for replacement. Mounting the media parent for quarantine gives the application access to that mounted share, not only one film directory. Keep the service on a trusted LAN; this version is not hardened or independently audited for direct public Internet exposure. See [Security](../SECURITY.md).
