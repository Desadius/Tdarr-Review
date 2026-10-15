# Preserve private Recovery authorization during updates

The worker reads `pending-approvals.json` from its data root (`/data/recovery/` inside the Review container since 2.0.0); private approvals are no longer bundled with code. The currently published 1.10.0 image does not include this migration utility. Select an explicitly approved new image/source version that includes it before following these steps. Source publication, image publication and deployment remain separate decisions.

To move an installation that already has `pending-approvals.json` in the separate Recovery container's `/data` to 2.0, follow [the 2.0 migration guide](MIGRATE-TO-2.0.md) instead: it copies the registry unchanged. A fresh installation with no historical approvals can omit the registry or copy the empty [example](../examples/recovery-approval-registry.example.json). This guide is for an existing private registry. Never replace it with an empty example or reconstruct authority from the copies in `state.json`.

## Before migration

Stop the Recovery worker and keep it stopped until migration and update verification finish. Wait for its current original decode to finish; uncertain mutating phases require inspection before update. Back up private data, configuration and existing application source/image. Identify the exact old registry and the persistent Recovery data directory. Both must be regular local files/directories with appropriate ownership; no symlinks or group/other-writable evidence files are accepted.

Migration validates the old registry, current config and stored approvals without contacting Tdarr/Radarr or opening movie files. It accepts the legacy `{config,cases}` shape or `version:1`. Frozen roots/library/review prefixes and every explicitly frozen setting must match. The only exception is a frozen `enabled: true` (approved for Repair), which also accepts `RECOVERY_MODE=verify`; a frozen `enabled: false` refuses `repair`. The utility accepts and refuses exactly the combinations the worker's start-up check does ([Recovery mode](CONFIGURATION.md#recovery-mode)). Completed imported legacy records with strong matching original identities stay historical metadata; they never become active authority.

## Offline command

The utility checks `config.json` exactly as the worker will start with it, so it needs the same `RECOVERY_MODE` (`verify` or `repair`) the worker will run with. A missing or invalid mode, or an `enabled` in `config.json` that disagrees with it, stops the migration before anything is written (see [Recovery mode](CONFIGURATION.md#recovery-mode)).

From a source checkout on Linux with Node 24, use explicit absolute paths:

```bash
RECOVERY_MODE=verify node tools/migrate-recovery-registry.mjs \
  --source /absolute/old-app/pending-approvals.json \
  --data /absolute/review/data/recovery
```

The Review image includes the same utility at `/tools/migrate-recovery-registry.mjs`. If the host has no Node runtime, a disposable container can run it with only data and the old registry mounted. Substitute the approved image and actual host paths; the container must already be stopped:

```bash
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --cpus 1 --memory 256m --pids-limit 64 \
  --tmpfs /tmp:rw,noexec,nosuid,size=32m \
  -e RECOVERY_MODE=verify \
  --mount type=bind,source=/absolute/review/data/recovery,target=/data \
  --mount type=bind,source=/absolute/old-app/pending-approvals.json,target=/legacy/pending-approvals.json,readonly \
  --entrypoint /usr/bin/node \
  ghcr.io/desadius/tdarr-review:sha-APPROVED_FULL_COMMIT \
  /tools/migrate-recovery-registry.mjs \
  --source /legacy/pending-approvals.json --data /data
```

The image runs as UID 99/GID 100. Its data mapping must permit that user to read config/state/source and create private backup/registry files. The throwaway container mounts only Recovery's data directory (Review's `/data/recovery` on the host) as its `/data`. It has no media/database mounts or external network and is removed when the command ends.

## Result and recovery

The first successful installation stores exact old registry/state backups and a checksum manifest in a unique private `registry-migration-*` directory under `/data` (directory `0700`, files `0600`). It installs the versioned registry atomically and exclusively, verifies it and reports counts/checksums/backup directory name without printing private evidence. Source/state content remains unchanged.

An identical valid existing registry is accepted as an idempotent retry. A different target, changed state/source during migration, unsupported evidence or a concurrently appearing target is rejected; no overwrite fallback is used. Failed attempts can leave their private backups for inspection. Preserve those backups and the original source until update verification succeeds. Do not reset state or copy an empty registry to work around a failure.

After migration, start the already stopped Review container with the same persistent `/data`, mappings and `RECOVERY_MODE`, then verify logs, expected pending cases and Review status. A registry error must be resolved before repairs proceed. Registry changes require a stopped worker and restart; no hot reload is performed.
