# Configuration reference

Review settings are editable in the UI and stored in `/data/settings.json`. The server validates origins, absolute paths and non-overlapping original/result roots. Files must remain regular files within the configured roots, without symlinks.

## Review settings

| Setting | Meaning |
| --- | --- |
| `label` | Name displayed for this installation |
| `publicOrigin` | Exact `http(s)://host:port` used by the browser; required for origin checks |
| `tdarrUrl` | Tdarr API origin, reachable from the Review container |
| `mediaRoot` | Film root inside Review, usually `/media/movies` |
| `reviewRoot` | Separate result root inside Review, usually `/review` |
| `database` | SQLite path inside Review, usually `/tdarr/SQL/database.db` |
| `ffprobe`, `ffmpeg` | Absolute executable paths inside Review |
| `sourceRoots` | Tdarr server source roots; first is the production library, others may be aliases of the same files |
| `tdarrReviewRoot` | Result root as seen by Tdarr, for active-worker checks |
| `reviewPrefixes` | Top-level result directory names stripped for matching, e.g. `PROD-Movies` |
| `libraryId` | Tdarr library ID; explicit ID is needed for automated replacement handoff |

The provided image uses `/app/Tdarr_Node/assets/app/ffmpeg/linux_x64/ffmpeg` and its sibling `ffprobe`. The application requires `node:sqlite`; use Node 24, not an older Node runtime.

`PORT` and `DATA_ROOT` are startup environment variables. `PUBLIC_ORIGIN`, `TDARR_URL`, `MEDIA_ROOT`, `REVIEW_ROOT`, `TDARR_DB`, `FFMPEG` and `FFPROBE` provide initial defaults. They do not override a saved settings file.

Example path correspondence for **one physical source**:

| Consumer | Source path |
| --- | --- |
| Host | `/mnt/user/media/movies/Film/Film.mkv` |
| Tdarr server | `/media/movies/Film/Film.mkv` |
| Review | `/media/movies/Film/Film.mkv` |
| Recovery (inside Review) | `/media/movies/Film/Film.mkv` |
| Radarr | `/media/Film/Film.mkv` |

These paths differ because of container mappings. An installation migrated from the separate Recovery container may keep Recovery at `/storage/movies` through an extra mapping ([2.0 migration](MIGRATE-TO-2.0.md#3-keep-the-old-paths-with-an-extra-mapping)). Do not copy one consumer's root into another consumer's setting without checking its mapping. For Windows nodes, configure Tdarr path translators separately; Review itself runs on Linux.

## Radarr settings in Review

| Setting | Meaning |
| --- | --- |
| `url` | Radarr URL, including an optional base path |
| `apiKey` | Stored server-side in `/data/radarr.json`; not returned to the UI |
| `mediaRoot` | Film root **inside Radarr**, e.g. `/media` |
| `quarantineRoot` | Original quarantine **inside Review**, outside `mediaRoot` |
| `preferCzechEnglish` | Add CZ+EN preference without weakening existing release exclusions |

The manual replacement workflow clones the quality profile for that movie, retains existing rules and excludes the exact original release title. Availability is still determined by Radarr and its indexers; the preference does not guarantee the downloaded file actually contains both languages.

## Recovery configuration

### Recovery mode

The `RECOVERY_MODE` environment variable of the Review container is the only switch that decides what the worker may do. The mode is one of `off`, `verify` and `repair`, and `off` is the default ([ADR 0001](adr/0001-recovery-runs-inside-review.md)). `off`, or leaving it unset, means the supervisor never starts the worker, so the worker itself runs only in `verify` or `repair`. Set it in the Unraid template (**Recovery mode**) or in `.env` for Compose:

| `RECOVERY_MODE` | Behaviour |
| --- | --- |
| `verify` | Confirms corrupted originals with two independent decodes and stops at `dry_run`; changes nothing outside Recovery (no Tdarr Hold, quarantine, blocklist or search) |
| `repair` | May act on a confirmed corruption within the limits below |

The worker refuses to start before contacting any API, exits with code `78` and ends its log with `RECOVERY_REFUSED <reason>` when:

| Reason | Cause |
| --- | --- |
| `invalid-mode` | `RECOVERY_MODE` is missing or is not exactly `off`, `verify` or `repair`. The worker never assumes the default `off` itself (fail closed) |
| `mode-off` | `RECOVERY_MODE` is `off`; Recovery does not run |
| `mode-conflict` | `config.json` still contains `enabled` and it disagrees with the mode |
| `missing-config` | `/data/recovery/config.json` does not exist |
| `unreadable-config` | `/data/recovery/config.json` exists but cannot be read (for example its permissions or type) |
| `invalid-config` | `config.json` is not a JSON object, or `enabled` is present but not `true`/`false` |
| `registry-refused` | The private approval registry `pending-approvals.json` refuses the configuration or state; the log line before the reason names the rule, never a value |

The reason line never contains configuration keys or values. Any other non-zero exit is a crash.

A refused worker is not restarted: Review keeps running and shows **Refused** with the reason in its **Recovery** view and health attention (`recovery-refused`), never an unhealthy container. Look for `RECOVERY_REFUSED` in `docker logs tdarr-review` (or `docker compose logs review`), fix the cause and restart the container. A crash, unlike a refusal, is restarted with growing delays ([Supervisor](ARCHITECTURE.md#supervisor)).

**A registry that freezes `enabled` pins the mode.** The registry check compares every frozen key with the configuration the worker runs with, and `enabled` is derived from `RECOVERY_MODE`. A registry with frozen `enabled: true` therefore starts only in `repair`, one with `false` only in `verify`; the other mode is refused with `registry-refused` even when `config.json` is unchanged. The [2.0 migration guide](MIGRATE-TO-2.0.md#check-what-the-old-configuration-and-registry-freeze) shows how to list the frozen keys without printing values. A planned change ([#77](https://github.com/Desadius/Tdarr-Review/issues/77)) will let a registry approved for Repair also start in Verify.

`enabled` in `config.json` is **deprecated**. A matching value (`false` with `verify`, `true` with `repair`) is accepted so existing configurations keep working; remove it when convenient. To migrate, set `RECOVERY_MODE=verify` where you had `"enabled": false` and `RECOVERY_MODE=repair` where you had `"enabled": true`. Changing the mode, like any configuration change, takes effect after a restart.

### config.json

The worker reads `/data/recovery/config.json` (its data root is `/data/recovery/` inside the Review container). Unlike Review, it currently has no configuration UI or general schema validator; use the supplied complete example and verify values before switching to `repair`.

The worker reads `config.json` only when it starts. Edits, including limits and `approvedImportRepairs`, take effect after the Review container is restarted. While the worker runs it checks the file once per poll: if the content differs from what it loaded, it logs that a restart is required and adds `configChange` (`detectedAt`, `restartRequired`, `valid`, `error`) to the shared `.tdarr-recovery-status.json`. `valid: false` means the next start would fail: the file is not a JSON object, its `enabled` disagrees with `RECOVERY_MODE`, or the worker's start-up approval-registry check refuses it (for example a value frozen in `pending-approvals.json`, such as a library root, `libraryId` or a limit, was changed). `error` names the rule but never a value; fix the file before restarting. Settings outside these checks can still be wrong in ways only the running worker notices. The running worker keeps using the configuration it started with and never applies an edit in the middle of a case. Restart only while the worker is idle (see [Operations](OPERATIONS.md)).

| Setting | Default example / purpose |
| --- | --- |
| `enabled` | Deprecated; use `RECOVERY_MODE`. If present it must match the mode |
| `tdarrUrl`, `radarrUrl`, `radarrApiKey` | API connections; keep the key private |
| `libraryId`, `sourceRoot` | Production Tdarr library and server path |
| `mediaRoot`, `radarrRoot`, `reviewRoot` | Roots in the worker, Radarr and worker respectively |
| `reviewPrefixes` | Result prefixes to check before taking away a source |
| `quarantineRoot` | Worker path outside the media library, on the same mounted tree |
| `database`, `reports`, `ffmpeg` | Read-only Tdarr SQLite/reports and decoder executable |
| `stableMinutes` | `10`: minimum time since source modification |
| `decodeTimeoutHours` | `12`: timeout is an operational failure, never corruption proof |
| `fullSourceHash` | `false`: identity is checked by fingerprint and three 1 MiB samples. `true` also reads the whole original for a SHA-256 once when the corruption is confirmed and again before Recovery changes anything in Radarr or Tdarr for the repair; a different hash stops the repair, and fingerprint and samples are still rechecked right before the quarantine rename. The hash runs at idle I/O and lowest CPU priority, reports progress as `fullHash` in the shared status file and in the Review Recovery view, and on a large film can take as long as reading the whole file twice. |
| `confirmDelaySeconds` | `30`: delay between independent original checks |
| `maxRepairsPerDay` | `3`: rolling 24-hour circuit breaker |
| `movieCooldownDays` | `30`: prevent repeated repairs for the same movie |
| `pollSeconds` | `300`: delay after each worker pass |
| `since` | Earliest eligible completed error time, Unix milliseconds |
| `detectTerminalHeaders` | Recognize the narrow terminal-overwritten MKV header case |
| `approvedCaseIds`, `approvedImportRepairs` | Advanced historical exceptions; shipped empty |

`/data/recovery/pending-approvals.json` is the private, versioned frozen-evidence registry. It is separate from source and images and is not populated from UI clicks. A fresh installation with no stored approvals may omit it or use the empty [example](../examples/recovery-approval-registry.example.json). Normal future errors use two live original decodes and do not require frozen authorization. Do not use synthetic fixtures as real authorization.

Existing private registries must be [migrated offline before an update](MIGRATE-RECOVERY-REGISTRY.md). Invalid, unreadable, symlinked, changed or missing historical authority stops the worker before APIs. Nonempty registries bind the library, worker/source/Radarr/quarantine/review roots and review prefixes to the current configuration. Every explicitly frozen setting, including limits or `enabled` if present, must still match. Change authorization deliberately with the worker stopped, then restart; the registry is loaded once and frozen in memory.

Completed imported legacy approval metadata can remain in state without being a current registry member only when its original source/movie/import/binding tuple and frozen mappings remain consistent. It never becomes current authorization and is not activated by the pending repair loop. A changed current member or legacy record in another phase fails validation.

## Shared files

Recovery writes `.tdarr-recovery-status.json` in the **parent** of its media root. Review reads it from the parent of its media root. Both paths must map to the same host file; with the defaults both are `/media/.tdarr-recovery-status.json`. Review needs configured Radarr connection details to build links for the shared records.

Recovery also writes `.tdarr-original-languages.json` inside the film root using Radarr's TMDB-linked original-language metadata. This repository does not install the complete transcode/language-selection flow; make that flow explicitly consume the cache if required.

Approval evidence is stored in `.tdarr-approvals` beside the library. Review and Recovery share the media parent mapping in the one container; an installation migrated with `/storage` maps that path to the same host folder as `/media`. Keep quarantine outside Plex's movie root.
