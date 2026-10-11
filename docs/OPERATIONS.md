# Operations and troubleshooting

## Persistent data and backups

Back up Review `/data`, Recovery `/data` if used, both source/configuration versions and the media-parent approval records. Review state includes its access key, sessions, history, transactions and Radarr requests. It is private operational data, not repository content.

Back up during an idle period. Keep media and quarantined originals protected by your normal storage backup policy. A Git commit of the application is not a backup of the movies or its transactional state.

## Update an existing deployment

Source publication, Docker image publication and updating a running deployment are separate decisions. Pushing a commit or version tag runs tests only. Use [the release process](RELEASES.md) for approved image publication; installing it still requires the idle checks below.

1. Inspect authenticated `/api/items` or the UI. Wait for `active`, `batchRunning`, `restorePending` and unresolved exchange transactions (`recovery`) to clear. These exchange transactions are distinct from the background movie-replacement list.
2. Check that the background worker is not in a mutating phase. A long decode is read-only but restarting it leaves an interrupted case requiring deliberate inspection.
3. Back up code/images and private persistent data. Record the previous Git commit.
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

## Error or ambiguous state

Inspect the film's detail and durable journal. Preserve `.tdarr-review-*.old`, `.tmp` files and incomplete JSON transactions. A timeout is not proof that a remote mutation failed; verify actual Tdarr/Radarr state before retrying. Review's replacement handoff avoids duplicate queueing when it can prove the same file is already queued or processed.

`manual` means an identity, mapping or mutation could not be verified. It does not mean a quarantined file should be deleted. `Not required` means Tdarr skipped the encoding decision, not that the file is healthy or already optimized.

## Recovery status is stale

Check worker logs and its private `state.json` for `lastError` or `statusPublicationError`. Verify both services map the same media parent and Radarr is configured in Review. Idle publication is roughly five minutes. During a full original decode the worker publishes a 30-second heartbeat and measured progress at most every 15 seconds. Review displays the current pass, media position, elapsed time and an ETA when duration/rate are available. With no known duration the bar stays indeterminate. The decoder measurement time and worker heartbeat are shown separately; a responding worker can still be waiting for I/O. A stale/no-advance warning is not proof of film damage.

Manual replacement requests created in Review continue checking the imported file's exact Tdarr record and library. A fresh status timestamp means that observation ran, not that Tdarr approved the film. Observation and quarantine retention errors are reported separately. Quarantine deletion still requires explicit Review approval evidence and the seven-day retention period.

## A replacement also fails decoding

The movie cooldown no longer prevents read-only diagnosis of the new edition. Recovery requires two matching recognized errors, unchanged source identity/sample and exact current Radarr history before holding it. `deferred_cooldown` means the confirmed bad edition remains in Plex and is held in Tdarr; the next permitted repair time appears in Review. It does not authorize another download during the cooldown or change an older quarantine's approval/retention state. After the cooldown and daily limit expire, verified frozen evidence can continue the normal recovery path without repeating the decode.

`defer_cooldown_intent` after interruption is reconciled only if the exact acknowledged Hold and original binding are still present; unknown results are not replayed. Changed source/history, a released Hold or incomplete historical evidence goes to `manual`. Existing manual cases are not automatically migrated or reactivated by installing this version.

`no_action` with a healthy result means a full original decode completed cleanly; it is a diagnostic completion, not Review approval. Operational/ambiguous results remain visible for inspection and never trigger replacement downloads. `dry_run` means decoding confirmed an error but external repair changes are disabled.

## Quarantine keeps growing

Check that the exact replacement was approved through Review and that its approval/installed identity evidence exists. Download/import alone is insufficient. Seven days must elapse. Changed identities, extra hardlinks and historical cases lacking evidence stop automatic cleanup. Do not manually remove private evidence to force a cleanup.

## Thread and resource limits

Review comparison extraction and Recovery decoding use conservative decoder thread settings. CPU limits do not guarantee an exact OS thread count: FFmpeg may create auxiliary threads. The supplied optional worker uses two CPU quota units plus low scheduler/I/O priority. Encoding worker/pool choices remain in your Tdarr flow and node configuration; do not apply powerful-PC settings to a smaller Unraid server indiscriminately.
