# Configuration reference

Review and Recovery settings are edited through the shared draft/apply UI ([user workflow](USER-GUIDE.md#configure-review-and-recovery)). Once activated, `/data/shared-settings.json` is the private complete-generation authority for both applications. Before the first managed activation, `/data/settings.json`, `/data/radarr.json` and `/data/recovery/config.json` retain their legacy startup behavior and are import inputs. The server validates origins, absolute paths and non-overlapping original/result roots. Files must remain regular files within the configured roots, without symlinks.

## Managed draft and activation

The UI shares Tdarr/Radarr connections and equivalent mappings across readers while preserving the meanings in the tables below. Recovery chooses one source root from Review sourceRoots; its quarantine is independent of Review's manual-replacement quarantine. Duplicate legacy credentials/mappings are never silently selected: the operator chooses the shared draft or original Recovery value before apply. All actual registry-frozen keys, including operational limits or arbitrary historical keys, remain protected. A mapping change cannot disconnect an in-flight repair or an unfinished manual replacement.

Apply invalidates only what the changed Review settings require ([What Apply clears](USER-GUIDE.md#configure-review-and-recovery)): the installation name, public origin, Radarr and Recovery-only settings clear nothing, the FFmpeg path clears prepared samples, and every other Review setting (the review binding, see `GLOSSARY.md`) clears saved reviews, Approve decisions and samples. A Review setting added later belongs to the review binding until it is classified in `review/settings-invalidation.mjs`.

The persisted draft and active generation are separate. Revisions include external import-file edits and prevent lost updates. Save permits unavailable services but enforces field allowlists, types/ranges, path shape and frozen constraints. Apply additionally performs read-only diagnostics, drains acknowledged Recovery work and waits for Review's existing mutation/scan/preview/statistics guards. Atomic rename plus directory sync installs one complete generation; no reader combines half-updated legacy files. The supervisor restarts only Recovery after commit. Failed/ambiguous activation keeps the new authority or interruption fence and stops Recovery; there is no automatic rollback or replay.

When Radarr is configured, Test and Apply also check Review's manual-replacement quarantine, even with Recovery Off. Its parent must exist, be writable and searchable, have no symlink components and share the originals' filesystem and Linux mount. An existing target must be a readable/writable/searchable directory without symlinks on that same filesystem/mount. A missing target with a valid parent is permitted; diagnostics never create it, and the existing replacement workflow creates it only when needed. This is separate from Recovery's quarantine setup during Apply.

History is bounded to 200 entries in the private settings authority. It exposes field names, results and revisions, not values or keys. Back up the entire private /data directory, including shared-settings.json, settings-activation.json and the unchanged private Recovery registry/state. Do not edit the managed authority by hand to bypass migration or approval checks. File-only historical exceptions remain private and subject to registry validation. This UI does not migrate cases or evidence.

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
| `apiKey` | Shared server-side credential in the managed generation (legacy input: `/data/radarr.json`); never returned to the UI. Blank preserves the stored key |
| `mediaRoot` | Film root **inside Radarr**, e.g. `/media` |
| `quarantineRoot` | Original quarantine **inside Review**, outside `mediaRoot` |
| `preferCzechEnglish` | Add CZ+EN preference without weakening existing release exclusions |

The manual replacement workflow clones the quality profile for that movie, retains existing rules and excludes the exact original release title. Availability is still determined by Radarr and its indexers; the preference does not guarantee the downloaded file actually contains both languages.

## Recovery configuration

### Recovery mode

The `RECOVERY_MODE` environment variable of the Review container is the only switch that decides what the worker may do. The mode is one of `off`, `verify` and `repair`, and `off` is the default ([ADR 0001](adr/0001-recovery-runs-inside-review.md)). `off`, or leaving it unset, means the supervisor never starts the worker, so the worker itself runs only in `verify` or `repair`. Set it in the Unraid template (**Recovery mode**) or in `.env` for Compose:

| `RECOVERY_MODE` | Behaviour |
| --- | --- |
| `verify` | Confirms corrupted originals with two independent decodes and stops new cases at `dry_run`. In-flight repairs pause; only their protective steps continue (see below) |
| `repair` | May act on a confirmed corruption within the limits below |

In Verify, an [in-flight repair](../GLOSSARY.md) may return its original from quarantine and apply the protective Tdarr Hold and confirming Radarr `RescanMovie`. This uses the existing conditions: Radarr has no movie file, its queue for the movie is empty, its search has finished, and the quarantine identity is unchanged. Recovery never cancels a download or restores across an active search or download.

Other steps wait: removing a kept original, requesting a replacement release or search, handing an imported file to Tdarr (including a pending handoff), and purging quarantine. Import and download observation continue. Review shows the step paused by Verify and whether the original is in the library or outside it, with its recorded time. Switching back to Repair resumes paused steps without another confirmation, after checking the current file, Radarr, Tdarr and approval state again. These paused steps never grant approval.

This does not change approval-registry compatibility: a mode switch that conflicts with frozen configuration still refuses startup. Do not rewrite frozen evidence to bypass it.

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

**A frozen `enabled` limits the modes.** The registry check compares every frozen key with the configuration the worker runs with, and `enabled` is derived from `RECOVERY_MODE`. Every key except `enabled` must match exactly. For `enabled` one exception applies, because Verify is strictly narrower than Repair (it pauses in-flight repairs and never runs frozen approvals): a registry with frozen `enabled: true` (approved for Repair) starts in both `repair` and `verify`. A registry with frozen `enabled: false` starts only in `verify`; `repair` is refused with `registry-refused` even when `config.json` is unchanged. Every reader of the registry applies the same rule: the start-up check, the per-poll check of pending approvals, the `configChange` validation and the [offline migration utility](MIGRATE-RECOVERY-REGISTRY.md). The shared status file reports the modes the registry allows as `registryAllowedModes`: `null` when the registry does not freeze `enabled` (no restriction), `["verify","repair"]` for frozen `true` and `["verify"]` for frozen `false`, so a switch that would be refused is visible before the restart. It contains only mode names, never other configuration values. The [2.0 migration guide](MIGRATE-TO-2.0.md#check-what-the-old-configuration-and-registry-freeze) shows how to list the frozen keys without printing values.

`enabled` in `config.json` is **deprecated**. A matching value (`false` with `verify`, `true` with `repair`) is accepted so existing configurations keep working; remove it when convenient. To migrate, set `RECOVERY_MODE=verify` where you had `"enabled": false` and `RECOVERY_MODE=repair` where you had `"enabled": true`. Changing the mode, like any configuration change, takes effect after a restart.

### config.json

For legacy startup, the worker reads `/data/recovery/config.json` (its data root is `/data/recovery/`). The shared settings UI now covers ordinary Recovery configuration, including all advanced options below. After managed activation the worker uses the complete active generation, with enabled derived from RECOVERY_MODE. Legacy files no longer override ordinary active settings. The private registry and historical exceptions remain file-only; if private exceptions are edited or revoked, strict Recovery startup refuses stale copied authority until an explicit legacy-file refresh and apply. The Review UI remains available to diagnose the issue.

At start-up every setting in the table below must be present (unless it is marked optional) and have a usable value, or the worker refuses with `RECOVERY_REFUSED invalid-config`. The log line names the setting and the rule, for example `(stableMinutes must be a number of 0 or more)`, never its value. A string where a number belongs (`"stableMinutes": "10 min"`, which used to disable the stability wait, or `"10"`), a negative limit, a delay longer than Node's longest timer (about 24.8 days, which would fire at once), a relative worker path, a trailing `/` on `sourceRoot` or `"detectTerminalHeaders": "false"` (which used to turn the check on) is refused instead of being misread. Keys the worker does not know are ignored. [Check a `config.json` before an update](#check-a-configjson-before-an-update) shows how to test a file without starting the worker.

**Legacy startup only:** the worker reads `config.json` when it starts. Edits, including limits and `approvedImportRepairs`, require the existing controlled restart procedure. **Managed settings:** save a draft, test it, then Apply; no container restart is required for ordinary edits, and saving alone changes neither running process. An explicit environment-mode change still requires restarting the container. While the worker runs it checks the file once per poll: if the content differs from what it loaded, it logs that a restart is required and adds `configChange` (`detectedAt`, `restartRequired`, `valid`, `error`) to the shared `.tdarr-recovery-status.json`. The same file always carries `registryAllowedModes`, the Recovery modes the approval registry allows (see [Recovery mode](#recovery-mode)). `valid: false` means the next start would fail: the file is not a JSON object, its `enabled` disagrees with `RECOVERY_MODE`, a setting is missing or has an unusable value, or the worker's start-up approval-registry check refuses it (for example a value frozen in `pending-approvals.json`, such as a library root, `libraryId` or a limit, was changed). `error` names the rule but never a value; fix the file before restarting. Settings outside these checks can still be wrong in ways only the running worker notices. The running worker keeps using the configuration it started with and never applies an edit in the middle of a case. Restart only while the worker is idle (see [Operations](OPERATIONS.md)).

| Setting | Accepted values | Default example / purpose |
| --- | --- | --- |
| `enabled` | Optional, `true` or `false` | Deprecated; use `RECOVERY_MODE`. If present it must match the mode |
| `tdarrUrl`, `radarrUrl`, `radarrApiKey` | Non-empty string | API connections; keep the key private |
| `libraryId` | Non-empty string | Production Tdarr library |
| `sourceRoot` | Non-empty string without a trailing `/` | Library path on the Tdarr server |
| `mediaRoot`, `reviewRoot` | Absolute path, not `/` itself | Roots in the worker |
| `radarrRoot` | Non-empty string without a trailing `/` | Root as Radarr sees it |
| `reviewPrefixes` | List of relative paths below `reviewRoot` (no leading or trailing `/`, no `.` or `..`), may be empty | Result prefixes to check before taking away a source |
| `quarantineRoot` | Absolute path, not `/` itself | Worker path outside the media library, on the same mounted tree |
| `database`, `reports`, `ffmpeg` | Absolute path, not `/` itself | Read-only Tdarr SQLite/reports and decoder executable |
| `ffprobe` | Optional, absolute path, not `/` itself | Probe executable; absent means the `ffprobe` beside `ffmpeg` |
| `stableMinutes` | Number, 0 or more | `10`: minimum time since source modification |
| `decodeTimeoutHours` | Number greater than 0, at most 596 | `12`: timeout is an operational failure, never corruption proof |
| `fullSourceHash` | Optional, `true` or `false` | `false`: identity is checked by fingerprint and three 1 MiB samples. `true` also reads the whole original for a SHA-256 once when the corruption is confirmed and again before Recovery changes anything in Radarr or Tdarr for the repair; a different hash stops the repair, and fingerprint and samples are still rechecked right before the quarantine rename. The hash runs at idle I/O and lowest CPU priority, reports progress as `fullHash` in the shared status file and in the Review Recovery view, and on a large film can take as long as reading the whole file twice. |
| `confirmDelaySeconds` | Number from 0 to 2147483 | `30`: delay between independent original checks |
| `maxRepairsPerDay` | Whole number, 1 or more | `3`: rolling 24-hour circuit breaker |
| `movieCooldownDays` | Number, 0 or more | `30`: prevent repeated repairs for the same movie |
| `pollSeconds` | Number from 0 to 2147483 | `300`: delay after each worker pass |
| `since` | Number, 0 or more | Earliest eligible completed error time, Unix milliseconds |
| `detectTerminalHeaders` | Optional, `true` or `false` | Recognize the narrow terminal-overwritten MKV header case |
| `approvedCaseIds` | Optional, list of non-empty strings | Advanced historical exception; shipped empty |
| `approvedImportRepairs` | Optional, object whose values are objects | Advanced historical exception; shipped empty |

`/data/recovery/pending-approvals.json` is the private, versioned frozen-evidence registry. It is separate from source and images and is not populated from UI clicks. A fresh installation with no stored approvals may omit it or use the empty [example](../examples/recovery-approval-registry.example.json). Normal future errors use two live original decodes and do not require frozen authorization. Do not use synthetic fixtures as real authorization.

Existing private registries must be [migrated offline before an update](MIGRATE-RECOVERY-REGISTRY.md). Invalid, unreadable, symlinked, changed or missing historical authority stops the worker before APIs. Nonempty registries bind the library, worker/source/Radarr/quarantine/review roots and review prefixes to the current configuration. Every explicitly frozen setting, including limits or `enabled` if present, must still match. Change authorization deliberately with the worker stopped, then restart; the registry is loaded once and frozen in memory.

Completed imported legacy approval metadata can remain in state without being a current registry member only when its original source/movie/import/binding tuple and frozen mappings remain consistent. It never becomes current authorization and is not activated by the pending repair loop. A changed current member or legacy record in another phase fails validation.

### Check a config.json before an update

A Review update can tighten the start-up checks of `config.json`. To learn before updating whether your file passes the checks of the new version, run them against a read-only copy in a throwaway container from the **new** image, without network and without starting Recovery. The output names only the mode, the refusal reason and the setting with its rule, never a value:

```bash
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --user 99:100 \
  --mount type=bind,source=/mnt/cache/appdata/tdarr-review/data/recovery/config.json,target=/check/config.json,readonly \
  --entrypoint /usr/bin/node ghcr.io/desadius/tdarr-review:NEW_VERSION --input-type=module -e '
import fs from "node:fs";
const {resolveRecoveryConfig}=await import("/recovery/recovery-authority.mjs");
let text;
try{text=fs.readFileSync(process.argv[1],"utf8");}catch(e){console.log("config.json: cannot be read ("+(e.code||"error")+")");process.exit(1);}
let failed=false;
for(const mode of ["verify","repair"]){
 try{resolveRecoveryConfig({mode,text});console.log(mode+": passes");}
 catch(e){failed=true;console.log(mode+": "+(e.reason?e.reason+" "+e.message.replace(/^Recovery refused to start: /,""):"cannot be checked"));}
}
process.exit(failed?1:0);
' /check/config.json
```

Replace `NEW_VERSION` with the version (or `sha-<commit>` tag) you are about to install, and the source path with your Review data directory. Before an image is published, the same command runs from a source checkout of that version: from the checkout's root, replace `--entrypoint /usr/bin/node ghcr.io/desadius/tdarr-review:NEW_VERSION` with `--entrypoint /usr/local/bin/node node:24` and add `--mount type=bind,source="$PWD/recovery",target=/recovery,readonly`. Only the line for the `RECOVERY_MODE` you run matters; with a deprecated `enabled` in the file, the other mode reports `mode-conflict`. The approval registry is checked separately at start-up ([Recovery mode](#recovery-mode)).

## Shared files

Recovery writes `.tdarr-recovery-status.json` in the **parent** of its media root. Review reads it from the parent of its media root. Both paths must map to the same host file; with the defaults both are `/media/.tdarr-recovery-status.json`. Review needs configured Radarr connection details to build links for the shared records.

Recovery also writes `.tdarr-original-languages.json` inside the film root using Radarr's TMDB-linked original-language metadata. This repository does not install the complete transcode/language-selection flow; make that flow explicitly consume the cache if required.

Approval evidence is stored in `.tdarr-approvals` beside the library. Review and Recovery share the media parent mapping in the one container; an installation migrated with `/storage` maps that path to the same host folder as `/media`. Keep quarantine outside Plex's movie root.
