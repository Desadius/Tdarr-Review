# Operations and troubleshooting

## Persistent data and backups

Back up Review `/data`, Recovery `/data` if used, both source/configuration versions and the media-parent approval records. Review state includes its access key, sessions, history, transactions and Radarr requests. It is private operational data, not repository content.

Back up during an idle period. Keep media and quarantined originals protected by your normal storage backup policy. A Git commit of the application is not a backup of the movies or its transactional state.

## Update an existing deployment

Source publication, Docker image publication and updating a running deployment are separate decisions. Pushing a commit or version tag runs tests only. Use [the release process](RELEASES.md) for approved image publication; installing it still requires the idle checks below.

1. Inspect authenticated `/api/items` or the UI. Wait for `active`, `batchRunning`, `restorePending` and unresolved exchange transactions (`recovery`) to clear. These exchange transactions are distinct from the background movie-replacement list. A non-zero `restorePending` means Review could not yet unpause the Tdarr nodes it paused; the server retries on its own with backoff (15 s, doubling to at most 10 minutes) while no action is running. Reading `/api/items` does not trigger the retry.
2. Check that the background worker is not in a mutating phase. A long decode is read-only but restarting it leaves an interrupted case requiring deliberate inspection.
   On SIGTERM (`docker stop`) the worker leaves an idle wait at once and exits with code 0. If a check is in progress it first finishes that step; when the step outlasts the stop timeout, Docker kills the worker (exit code 137) and the case becomes manual on the next start. Stop the worker while it is idle rather than raising the timeout to cover a multi-hour decode.
3. Back up code/images and private persistent data. Record the previous Git commit.
   If an older Recovery installation stores a private pending registry in its application directory, [migrate that registry](MIGRATE-RECOVERY-REGISTRY.md) with the worker stopped before replacing its source/image. Preserving state alone does not preserve authorization.
4. Stop only the affected service, pull/build the chosen commit, and start it with the same data/mappings.
5. Verify login, API state, expected results and replacement records. Do not approve a real film simply to test an update.

With the supplied Compose example, after the idle checks and backup:

```bash
docker compose stop review
git pull --ff-only
docker compose pull review
docker compose up -d --no-build review
docker compose logs --tail 40 review
```

For a source build, replace `pull` with `build` and omit `--no-build`. For a Docker template installation, use Unraid's normal update flow after the idle/backup checks. An immutable `sha-<commit>` tag can be recorded in Repository (or `REVIEW_IMAGE_TAG` for Compose) to pin or roll back the application. Do not run an additional container against the same `/data` as a workaround. Rollback uses the previous image/source, with existing transaction evidence retained; verify schema compatibility before restoring old state.

## Web UI unavailable after restart

Verify the container exists, its status, its mapped port, Unraid Autostart and startup logs. Check data-directory ownership, valid settings JSON and runtime support for `node:sqlite`. Do not reset data/delete transaction journals merely to make the UI load.

## Login or forbidden request

Use the persisted access key and exact configured `publicOrigin`. A different IP, hostname, port or reverse-proxy origin can fail mutation origin checks. Login expiration requires login again; it is not permission to disable protection. If using a proxy, configure it deliberately and verify origin/cookie behavior. Direct Internet exposure is outside this release's tested scope.

## Approval is slow

Review copies the result into the destination filesystem and reads it again for SHA-256 verification. Large films, array/parity writes, mover, hashing and other I/O can dominate the time even when CPU load is low. Some stages provide byte progress and ETA; metadata/durable sync and short organizational steps do not have a reliable percentage.

Normal approval does not repeat the entire audio/video decode. Comparison samples and profile-specific metadata checks are separate operations and can still take time.

## Manual Tdarr node pauses during a Review action

Before a replacement, Review records the names of nodes that are currently unpaused, then pauses them to prevent new dispatch. Nodes that were already paused are not recorded and are left paused when Review resumes dispatch.

For a recorded node, resuming checks only its name and current `nodePaused` flag. If it is paused, Review sets that flag to `false`. It cannot distinguish its own pause from a manual pause made in Tdarr after the Review action started. That later manual pause can therefore be undone when the action finishes. There is no per-node confirmation or timestamp-based ownership check.

Pause maintenance nodes in Tdarr **before** starting a Review replacement or replacement request. If the action is already running, wait for Review to become idle and for `restorePending` to reach zero, then apply the maintenance pause and verify it in Tdarr. A failed resume remains pending and is retried by a server timer with backoff (15 s, doubling to at most 10 minutes) while no action is running, including after a Review restart once unresolved exchange transactions are clear; reading `/api/items` does not trigger it. Stopping Review or closing the browser during an action does not make a later manual pause safe from that retry; retain the pending state and finish reconciliation before applying the maintenance pause.

## Error or ambiguous state

Inspect the film's detail and durable journal. Preserve `.tdarr-review-*.old`, `.tmp` files and incomplete JSON transactions. A timeout is not proof that a remote mutation failed; verify actual Tdarr/Radarr state before retrying. Review's replacement handoff avoids duplicate queueing when it can prove the same file is already queued or processed.

`manual` means an identity, mapping or mutation could not be verified. It does not mean a quarantined file should be deleted. `Not required` means Tdarr skipped the encoding decision, not that the file is healthy or already optimized.

## Recovery configuration was edited

Recovery applies `/data/config.json` only at start-up. After an edit the worker logs `config.json changed since start-up; restart the worker to apply it` and the shared status file shows `configChange.restartRequired: true`. If `configChange.valid` is `false`, correct the file first: a restart with invalid JSON stops the worker. Then restart the Recovery container while it is idle, as described in step 2 of *Update an existing deployment*. Reverting the edit clears the notice without a restart.

## Review event log

Review writes one JSON line per operator-relevant event to standard output, next to its plain-text messages. Each line has `time`, `source: "review"` and `event`:

| Event | Fields |
| --- | --- |
| `action.started`, `action.finished` | `action` (`approve`, `reject`, `replace`), `id`, `title`; when finished also `outcome`, `message`, `warning`, `reason`, `jobId`, `requestId`, `elapsedSeconds`, `savedBytes` |
| `batch.started`, `batch.finished`, `batch.interrupted` | `batchId`, `total`, `finished`, `failed`, `outcome`, `message` |
| `node.paused`, `nodes.resume` | Tdarr node names paused for an action; nodes Review tried to resume and those still `pending` |
| `transaction.unresolved`, `transactions.unresolved` | Exchange transactions that need manual inspection |
| `settings.saved`, `preview-settings.saved`, `radarr-settings.saved`, `quarantine.restored` | The saved non-secret values or the restored request |
| `request.error` | `method`, `route` (without query), `status`, `message` |

Fields whose name contains `key`, `token`, `secret`, `password`, `cookie`, `authorization` or `session` are never written, so access keys, Radarr API keys, login sessions and review evidence stay out of the log. To reconstruct an incident:

```bash
docker logs tdarr-review 2>&1 | grep '"source":"review"'
```

## Container health

The Review container health check reads `GET /health`, which answers only requests from loopback inside the container (other clients get 404) and needs no login. It returns `pendingTransactions`, `restorePending`, the shared Recovery status (`present`, `updated`, `stale` after 12 minutes) and an `attention` list (`pending-transaction`, `node-restore-pending`, `recovery-status-stale`). The check prints `OK` or `Attention: …` with the summary into Docker's health log:

```bash
docker inspect --format '{{json .State.Health.Log}}' tdarr-review
```

These conditions are reported, not treated as failures: the container stays healthy so that a restart policy or auto-heal tool does not restart Review during a pending transaction or node restore. The check fails only when the server does not answer. A missing Recovery status file (Recovery not installed) is not flagged.

## Recovery status is stale

Check worker logs and its private `state.json` for `lastError` or `statusPublicationError`. Verify both services map the same media parent and Radarr is configured in Review. Idle publication is roughly five minutes. During a full original decode the worker publishes a 30-second heartbeat and measured progress at most every 15 seconds. Review displays the current pass, media position, elapsed time and an ETA when duration/rate are available. With no known duration the bar stays indeterminate. The decoder measurement time and worker heartbeat are shown separately; a responding worker can still be waiting for I/O. A stale/no-advance warning is not proof of film damage.

Manual replacement requests created in Review continue checking the imported file's exact Tdarr record and library. A fresh status timestamp means that observation ran, not that Tdarr approved the film. Observation and quarantine retention errors are reported separately. Quarantine deletion still requires explicit Review approval evidence and the seven-day retention period.

## A replacement also fails decoding

The movie cooldown no longer prevents read-only diagnosis of the new edition. Recovery requires two matching recognized errors, unchanged source identity/sample and exact current Radarr history before holding it. `deferred_cooldown` means the confirmed bad edition remains in Plex and is held in Tdarr; the next permitted repair time appears in Review. It does not authorize another download during the cooldown or change an older quarantine's approval/retention state. After the cooldown and daily limit expire, verified frozen evidence can continue the normal recovery path without repeating the decode.

`defer_cooldown_intent` after interruption is reconciled only if the exact acknowledged Hold and original binding are still present; unknown results are not replayed. Changed source/history, a released Hold or incomplete historical evidence goes to `manual`. Existing manual cases are not automatically migrated or reactivated by installing this version.

`no_action` with a healthy result means a full original decode completed cleanly; it is a diagnostic completion, not Review approval. Operational/ambiguous results remain visible for inspection and never trigger replacement downloads. `dry_run` means decoding confirmed an error but external repair changes are disabled.

## Daily-limit cases do not continue

New automatic `deferred_limit` cases record the exact confirmed evidence, source/history/mapping and permanent Hold. The next allowed attempt is shown in Review. Each pass checks the quota and frozen identity; after capacity clears it continues the existing repair without another full decode. Terminal-header cases use the same path. Interrupted accepted Hold writes are reconciled through reads; unknown results or changed identities require manual inspection.

Older automatic deferrals without the new frozen journal become `manual` rather than being decoded repeatedly or restarted from an inferred identity. Explicitly authorized historical pending cases keep their independent registry-driven behavior. Do not edit `state.jobs` or erase evidence to force a retry.

## Quarantine keeps growing

Check that the exact replacement was approved through Review and that its approval/installed identity evidence exists. Download/import alone is insufficient. Seven days must elapse. Changed identities, extra hardlinks and historical cases lacking evidence stop automatic cleanup. Do not manually remove private evidence to force a cleanup.

## Thread and resource limits

Review comparison extraction and Recovery decoding use conservative decoder thread settings. CPU limits do not guarantee an exact OS thread count: FFmpeg may create auxiliary threads. The supplied optional worker uses two CPU quota units plus low scheduler/I/O priority. Encoding worker/pool choices remain in your Tdarr flow and node configuration; do not apply powerful-PC settings to a smaller Unraid server indiscriminately.

## A newly imported replacement also fails

The prepared 1.10.1 worker recognizes `Read past end of XLL band data` as a decoder candidate. A failed Tdarr report is only a trigger: Recovery independently checks the unchanged original twice and verifies its current Radarr import/grab binding before any external repair. Operational errors or a clean/ambiguous original check never authorize a download. Full audio is retained; the worker does not bypass DTS-HD validation by decoding only its DTS core.

Reports previously recorded as `not_confirmed_decode_error_v2` are reconsidered once under the expanded classifier. Existing case IDs, manual decisions, newer superseding jobs and preserved-source Holds are respected. Remaining unrecognized reports are recorded as `not_confirmed_decode_error_v3`. Do not erase job cursors to force a retry.

Review links the imported parent to a follow-up case only when source path/size and Radarr movie/file identities match exactly and uniquely. The fingerprint must match completely, or differ only in ctime while device/inode/size/mtime remain identical. A ctime difference is explicitly shown as a display-only association; it never rewrites identity or permits reuse of old repair evidence. Open **Navazující kontrola náhrady** to see the next case, its own observed time, per-pass progress and next attempt. A parent's fresh Tdarr snapshot cannot make a stale child observation fresh. Missing historical binding evidence leaves the cases separate. The link is read-only; it grants no new authorization and does not transfer approval or cleanup evidence between quarantines.

A confirmed bad replacement remains held in Plex during the movie cooldown; the daily quota still applies. Only after those limits clear and the frozen evidence/history/source remain valid can its own repair continue. Older originals remain preserved until their applicable approval evidence permits cleanup.
