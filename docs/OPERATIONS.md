# Operations and troubleshooting

## Persistent data and backups

Back up Review `/data`, Recovery `/data` if used, both source/configuration versions and the media-parent approval records. Review state includes its access key, sessions, history, transactions and Radarr requests. It is private operational data, not repository content.

Back up during an idle period. Keep media and quarantined originals protected by your normal storage backup policy. A Git commit of the application is not a backup of the movies or its transactional state.

## Update an existing deployment

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

Check worker logs and its private `state.json` for `lastError`. Verify both services map the same media parent and Radarr is configured in Review. The normal publication cadence is one worker pass, roughly five minutes when idle. A full original decode can delay publication; a 12-minute warning is not by itself proof that the worker is dead.

## Quarantine keeps growing

Check that the exact replacement was approved through Review and that its approval/installed identity evidence exists. Download/import alone is insufficient. Seven days must elapse. Changed identities, extra hardlinks and historical cases lacking evidence stop automatic cleanup. Do not manually remove private evidence to force a cleanup.

## Thread and resource limits

Review comparison extraction and Recovery decoding use conservative decoder thread settings. CPU limits do not guarantee an exact OS thread count: FFmpeg may create auxiliary threads. The supplied optional worker uses two CPU quota units plus low scheduler/I/O priority. Encoding worker/pool choices remain in your Tdarr flow and node configuration; do not apply powerful-PC settings to a smaller Unraid server indiscriminately.
