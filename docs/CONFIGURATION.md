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
| Recovery | `/storage/movies/Film/Film.mkv` |
| Radarr | `/media/Film/Film.mkv` |

These paths differ because of container mappings. Do not copy one consumer's root into another consumer's setting without checking its mapping. For Windows nodes, configure Tdarr path translators separately; Review itself runs on Linux.

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

The worker reads `/data/config.json`. Unlike Review, it currently has no configuration UI or general schema validator; use the supplied complete example and verify values before enabling it.

The worker reads `config.json` only when it starts. Edits, including `enabled`, limits and `approvedImportRepairs`, take effect after the Recovery container is restarted. While the worker runs it checks the file once per poll: if the content differs from what it loaded, it logs that a restart is required and adds `configChange` (`detectedAt`, `restartRequired`, `valid`, `error`) to the shared `.tdarr-recovery-status.json`. `valid: false` means the edited file is not a JSON object and the next start would fail; fix it before restarting. The running worker keeps using the configuration it started with and never applies an edit in the middle of a case. Restart only while the worker is idle (see [Operations](OPERATIONS.md)).

| Setting | Default example / purpose |
| --- | --- |
| `enabled` | `false`: verify only; `true`: allow confirmed repairs |
| `tdarrUrl`, `radarrUrl`, `radarrApiKey` | API connections; keep the key private |
| `libraryId`, `sourceRoot` | Production Tdarr library and server path |
| `mediaRoot`, `radarrRoot`, `reviewRoot` | Roots in the worker, Radarr and worker respectively |
| `reviewPrefixes` | Result prefixes to check before taking away a source |
| `quarantineRoot` | Worker path outside the media library, on the same mounted tree |
| `database`, `reports`, `ffmpeg` | Read-only Tdarr SQLite/reports and decoder executable |
| `stableMinutes` | `10`: minimum time since source modification |
| `decodeTimeoutHours` | `12`: timeout is an operational failure, never corruption proof |
| `confirmDelaySeconds` | `30`: delay between independent original checks |
| `maxRepairsPerDay` | `3`: rolling 24-hour circuit breaker |
| `movieCooldownDays` | `30`: prevent repeated repairs for the same movie |
| `pollSeconds` | `300`: delay after each worker pass |
| `since` | Earliest eligible completed error time, Unix milliseconds |
| `detectTerminalHeaders` | Recognize the narrow terminal-overwritten MKV header case |
| `approvedCaseIds`, `approvedImportRepairs` | Advanced historical exceptions; shipped empty |

`/data/pending-approvals.json` is the private, versioned frozen-evidence registry. It is separate from source and images and is not populated from UI clicks. A fresh installation with no stored approvals may omit it or use the empty [example](../examples/recovery-approval-registry.example.json). Normal future errors use two live original decodes and do not require frozen authorization. Do not use synthetic fixtures as real authorization.

Existing private registries must be [migrated offline before an update](MIGRATE-RECOVERY-REGISTRY.md). Invalid, unreadable, symlinked, changed or missing historical authority stops the worker before APIs. Nonempty registries bind the library, worker/source/Radarr/quarantine/review roots and review prefixes to the current configuration. Every explicitly frozen setting, including limits or `enabled` if present, must still match. Change authorization deliberately with the worker stopped, then restart; the registry is loaded once and frozen in memory.

Completed imported legacy approval metadata can remain in state without being a current registry member only when its original source/movie/import/binding tuple and frozen mappings remain consistent. It never becomes current authorization and is not activated by the pending repair loop. A changed current member or legacy record in another phase fails validation.

## Shared files

Recovery writes `.tdarr-recovery-status.json` in the **parent** of its media root. Review reads it from the parent of its media root. Both paths must map to the same host file. Review needs configured Radarr connection details to build links for the shared records.

Recovery also writes `.tdarr-original-languages.json` inside the film root using Radarr's TMDB-linked original-language metadata. This repository does not install the complete transcode/language-selection flow; make that flow explicitly consume the cache if required.

Approval evidence is stored in `.tdarr-approvals` beside the library. Mount the media parent in both containers if using recovery/quarantine. Keep quarantine outside Plex's movie root.
