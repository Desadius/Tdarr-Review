# Move a two-container installation to 2.0

Up to 1.11.0, optional Recovery ran in a second container (the `tdarr-recovery` image, the Compose `recovery` service and its own data directory). From 2.0.0 the Review image contains Recovery, and the `RECOVERY_MODE` setting (`off`, `verify`, `repair`; default `off`) decides whether it runs ([ADR 0001](adr/0001-recovery-runs-inside-review.md)). The `tdarr-recovery` image and the Compose `recovery` service are discontinued.

This guide moves an installation that ran both containers to the single Review container. It never rewrites frozen approval evidence: the old Recovery paths keep working through an extra mapping, and the old data is copied, not moved, so rolling back means starting the old containers again.

If you never ran the Recovery container, skip this guide: update Review as usual ([Installation](INSTALL-UNRAID.md#7-update-an-existing-installation)) and leave `RECOVERY_MODE` at `off`.

Every path, host and tag below is an example. Replace them with your own, and never paste API keys, the access key or the contents of `config.json` or `pending-approvals.json` into an issue. The examples use:

| Placeholder | Meaning |
| --- | --- |
| `/mnt/cache/appdata/tdarr-review/data` | Host directory mapped to Review `/data` (`REVIEW_DATA_HOST`) |
| `/mnt/cache/appdata/tdarr-recovery/data` | Host directory of the old Recovery `/data` (`RECOVERY_DATA_HOST`) |
| `/mnt/user/media` | Media parent, mapped to Review `/media` and to old Recovery `/storage` (`MEDIA_HOST`) |
| `/mnt/cache/appdata/tdarr/server/Tdarr/DB2` | Tdarr DB2 directory, mapped read-only to `/tdarr` (`TDARR_DB_HOST`) |
| `tdarr-review`, `tdarr-recovery` | Container names; Compose names them after the project and service |
| `2.0.0` | The approved 2.0 image tag; until it is published, a locally built image |

## 1. Back up and stop both containers while idle

Wait until both applications are idle:

- Review: no approval, batch, node restore or unfinished file-exchange transaction ([Operations](OPERATIONS.md#update-an-existing-deployment), step 1).
- Recovery: no case in an original decode or a mutating phase in Review's **Recovery** view, and nothing in progress in `docker logs --tail 40 tdarr-recovery`. A long decode is read-only, but stopping it means starting it again later.

Stop both containers, Recovery first, so nothing changes while you copy:

```bash
docker stop tdarr-recovery
docker stop tdarr-review
```

Back up both data directories and your settings. Keep these copies until the migration is verified:

```bash
mkdir -p /mnt/user/backups/tdarr-review-1.11
cp -a /mnt/cache/appdata/tdarr-review/data /mnt/user/backups/tdarr-review-1.11/review-data
cp -a /mnt/cache/appdata/tdarr-recovery/data /mnt/user/backups/tdarr-review-1.11/recovery-data
```

Compose users also keep a copy of `.env` and note the current source commit (`git rev-parse HEAD`). Unraid users keep the Review template (**Docker → tdarr-review → Edit**, or `/boot/config/plugins/dockerMan/templates-user/my-tdarr-review.xml`).

If the old Recovery still keeps a private registry in its application directory instead of `/data/pending-approvals.json`, [migrate that registry](MIGRATE-RECOVERY-REGISTRY.md) first, with the 1.11.0 tools, and only then continue.

### Check what the old configuration and registry freeze

The next steps depend on four facts: which old paths `config.json` uses, whether `pending-approvals.json` has frozen cases, which keys it freezes, and whether it freezes `enabled`. This command prints only key names, counts and the two `true`/`false` values, never paths, URLs, keys or evidence. It runs in a throwaway container from the Review image you already have, with the old data mounted read-only and no network:

```bash
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --user 99:100 \
  --mount type=bind,source=/mnt/cache/appdata/tdarr-recovery/data,target=/old,readonly \
  --entrypoint /usr/bin/node ghcr.io/desadius/tdarr-review:1.11.0 -e '
const fs=require("fs"),path=require("path"),dir=process.argv[1];
const read=name=>{try{return JSON.parse(fs.readFileSync(path.join(dir,name),"utf8"));}catch(e){return e.code==="ENOENT"?null:{unreadable:e.code||"invalid JSON"};}};
const oldPaths=o=>Object.keys(o).filter(k=>typeof o[k]==="string"&&/^\/(storage|reports)(\/|$)/.test(o[k])).sort().join(", ")||"none";
const flag=o=>typeof o.enabled==="boolean"?String(o.enabled):"absent";
const c=read("config.json"),r=read("pending-approvals.json");
if(!c)console.log("config.json: missing");
else if(c.unreadable)console.log("config.json: unreadable ("+c.unreadable+")");
else{console.log("config.json enabled: "+flag(c));console.log("config.json keys using /storage or /reports: "+oldPaths(c));}
if(!r)console.log("registry: none");
else if(r.unreadable)console.log("registry: unreadable ("+r.unreadable+")");
else{const f=r.config||{};
 console.log("registry frozen cases: "+(Array.isArray(r.cases)?r.cases.length:"invalid"));
 console.log("registry frozen keys: "+(Object.keys(f).sort().join(", ")||"none"));
 console.log("registry frozen enabled: "+(Object.hasOwn(f,"enabled")?flag(f):"not frozen"));
 console.log("registry frozen keys using /storage or /reports: "+oldPaths(f));}
' /old
```

Write the output down. A typical 1.11 installation shows `mediaRoot, quarantineRoot, reports` using the old paths. A non-empty registry usually freezes `libraryId`, the roots, `reviewPrefixes`, often `enabled` and some limits such as `maxRepairsPerDay` or `stableMinutes`.

## 2. Copy the old Recovery data into `/data/recovery/`

Recovery now keeps its `config.json`, `state.json`, `pending-approvals.json` and caches in `recovery/` inside Review's data directory. Copy the old directory there; do not move it, link it or replace it with a symlink. The registry is refused when it is a symlink, has a second hard link or is writable by group or others, and `cp -a` keeps its single link and `0600` mode:

```bash
ls -A /mnt/cache/appdata/tdarr-review/data/recovery 2>/dev/null
mkdir -p /mnt/cache/appdata/tdarr-review/data/recovery
cp -a /mnt/cache/appdata/tdarr-recovery/data/. /mnt/cache/appdata/tdarr-review/data/recovery/
chown -R 99:100 /mnt/cache/appdata/tdarr-review/data/recovery
chmod 700 /mnt/cache/appdata/tdarr-review/data/recovery
diff -rq -x runtime-state.json /mnt/cache/appdata/tdarr-recovery/data /mnt/cache/appdata/tdarr-review/data/recovery
```

The first command must print nothing, or only `runtime-state.json` if a 2.0 Review already started once. `diff -rq` must print nothing; it skips that `runtime-state.json`, which the old directory never had. Leave `config.json` unchanged for now: every frozen key must still match it, and its `enabled` is accepted while it matches the mode chosen in step 4.

## 3. Keep the old paths with an extra mapping

The old Recovery container saw the media parent as `/storage` and the Tdarr job reports as `/reports`. The 2.0 defaults are `/media/movies`, `/media/.tdarr-corrupt` and `/tdarr/JobReports`, but **never rewrite a frozen path** to reach them: a changed frozen value refuses Recovery's start (`registry-refused`), and the frozen evidence would no longer describe your library.

- **`/storage`.** If `config.json` or a non-empty registry uses `/storage` (step 1), add a path mapping: container path `/storage`, host path the **same** media parent as `/media` (`/mnt/user/media`), read/write. Recovery then writes quarantine and its status file `.tdarr-recovery-status.json` to the same host files as before, where Review reads them.
- **`/reports`.** A 1.11 `config.json` has `"reports": "/reports"`, and Review has no `/reports` mapping, so **one of these two is required**; without either, Recovery cannot read any Tdarr job report:
  - add a read-only mapping from the old reports host folder (the 1.11 `TDARR_REPORTS_HOST`) to `/reports`. This is the only choice when the registry freezes `reports` (step 1 lists it under *registry frozen keys*);
  - or, only when the registry does not freeze `reports` and the reports folder is `JobReports` inside the DB2 directory, which Review already mounts at `/tdarr`, set `"reports": "/tdarr/JobReports"` in `/data/recovery/config.json`.

Unraid: **Docker → tdarr-review → Edit → Add another Path, Port, Variable, Label or Device**, Config Type **Path**, Container Path `/storage`, Host Path `/mnt/user/media`, Access Mode **Read/Write**. Add `/reports` the same way with **Read Only** unless you changed `reports` in `config.json`.

Compose: `compose.yaml` has one `review` service. Add the mappings in a `compose.override.yaml` next to it, which Compose merges automatically:

```yaml
services:
  review:
    volumes:
      - "${MEDIA_HOST:?Set MEDIA_HOST}:/storage"
      # Unless config.json now uses "reports": "/tdarr/JobReports":
      - "/mnt/cache/appdata/tdarr/server/Tdarr/DB2/JobReports:/reports:ro"
```

## 4. Set `RECOVERY_MODE` from the old `enabled`

| Old `enabled` | `RECOVERY_MODE` |
| --- | --- |
| `false` (or absent) | `verify` |
| `true` | `repair` |

**A frozen `enabled` limits the modes.** The start-up check compares every frozen key with the configuration Recovery runs with, and `enabled` now comes from `RECOVERY_MODE`. If step 1 printed `registry frozen enabled: true`, the registry was approved for Repair and both `repair` and `verify` start, because Verify is strictly narrower. With `false`, only `verify` starts; `repair` is refused with `RECOVERY_REFUSED registry-refused`, even with an unchanged `config.json`. The status file's `registryAllowedModes` shows the allowed modes before a later switch ([Recovery mode](CONFIGURATION.md#recovery-mode)).

Frozen limits (`maxRepairsPerDay`, `stableMinutes` or any other frozen key) cannot be changed through `config.json` either; an edit is reported invalid in the Recovery view and refused at the next start.

Also update the Review container itself:

- **Unraid:** in **Edit**, set Repository to `ghcr.io/desadius/tdarr-review:2.0.0`. If the template has no **Recovery mode** field, add a **Variable** with key `RECOVERY_MODE` and the value from the table. In Extra Parameters, raise the limits to `--cpus=2 --memory=2g --pids-limit=256`, because Review and an original decode now share them. Do not apply yet; continue with step 5.
- **Compose:** update the source (`git pull --ff-only`) only after step 5. In `.env`, set `REVIEW_IMAGE_TAG=2.0.0` and `RECOVERY_MODE=...`, and remove `RECOVERY_IMAGE_TAG`, `RECOVERY_DATA_HOST` and `TDARR_REPORTS_HOST`, which 2.0 no longer reads. The new `compose.yaml` carries the higher limits.

## 5. Remove the old Recovery container

Two Recovery instances must never act on one library. Remove the stopped old container; its host data stays where it is:

```bash
docker rm tdarr-recovery
```

Unraid: **keep its template** (`/boot/config/plugins/dockerMan/templates-user/my-tdarr-recovery.xml`, or whatever name it was saved under) until step 7. A rollback recreates the container from it ([step 8](#8-roll-back)). Removing a container on Unraid keeps its template unless you delete it.

Compose users run this from the **old** checkout, before `git pull`, because the new `compose.yaml` has no `recovery` service:

```bash
docker compose --profile recovery rm --stop --force recovery
```

Check that nothing named after the old image remains: `docker ps -a --filter ancestor=ghcr.io/desadius/tdarr-recovery` must list no container.

## 6. Start and verify

Unraid: **Apply** the edited template. Compose:

```bash
git pull --ff-only
docker compose pull review
docker compose up -d --no-build review
```

Then verify, in this order:

1. **Health.** `docker inspect --format '{{.State.Health.Status}}' tdarr-review` becomes `healthy`. The health log (`docker inspect --format '{{json .State.Health.Log}}' tdarr-review`) prints `OK` or `Attention: …`. `recovery-refused`, `recovery-crash-loop` or `recovery-runtime-unreadable` needs attention; Recovery problems never make the container unhealthy ([Container health](OPERATIONS.md#container-health)). `recovery-status-stale` can show until the worker's first pass publishes its status.
2. **Runtime state file.** `/mnt/cache/appdata/tdarr-review/data/recovery/runtime-state.json` holds no configuration values or keys and may be read directly. Expect your `mode` and `"state": "running"`. `"state": "refused"` names the cause in `reason`, also in the log (`docker logs tdarr-review 2>&1 | grep RECOVERY_REFUSED`); see [Recovery mode](CONFIGURATION.md#recovery-mode). The **Recovery** view in Review shows the same state.
3. **Recovery process.** `docker top tdarr-review -o pid,ni,args` lists `worker.mjs` at niceness 19 beside `supervisor.mjs` and `server.mjs`.
4. **Status file.** The shared status file is updated again: `ls -l --time-style=full-iso /mnt/user/media/.tdarr-recovery-status.json` shows a fresh time after the first pass (about five minutes), and the **Recovery** view lists the same cases as before the migration, no longer marked stale.
5. **Review.** Log in with the existing access key, check the dashboard, saved reviews and history. Do not approve a real film as a test.

If Recovery is refused, stop the container, fix the cause and start it again. Do not edit frozen values, empty the registry or reset `state.json` to make it start.

## 7. Delete the old Recovery data later

Keep `/mnt/cache/appdata/tdarr-recovery/data` and the backups from step 1 until the new installation has run through at least one full Recovery pass and you no longer need to roll back. Then delete them deliberately, together with the old Recovery template on Unraid (**Docker → Add Container**, select the template under *User templates* and delete it, or remove its `my-*.xml` file). Keep the `/storage` (and `/reports`) mapping for as long as the registry or `config.json` uses those paths.

## 8. Roll back

Roll back only while both applications are idle, as in step 1.

1. Stop the 2.0 container. Never run the old Recovery container while a 2.0 Review runs with `RECOVERY_MODE` set to `verify` or `repair`.
2. Unraid: set Repository back to `ghcr.io/desadius/tdarr-review:1.11.0`; the added variable and mappings are ignored by 1.11.0. Compose: `git checkout v1.11.0` and restore the saved `.env`.
3. Start Review (Unraid: **Apply**; Compose: `docker compose up -d --no-build review`).
4. Recreate and start the old Recovery container, which step 5 removed, with its untouched data directory:
   - **Unraid:** **Docker → Add Container**, select the saved Recovery template under *User templates* and **Apply**. If the template is gone, add the container by hand with the settings of the 1.11 Compose `recovery` service: Repository `ghcr.io/desadius/tdarr-recovery:1.11.0`; variable `RECOVERY_MODE` (`verify` for `enabled: false`, `repair` for `true`); paths `/data` → the old Recovery data directory (`/mnt/cache/appdata/tdarr-recovery/data`, read/write), `/storage` → the media parent (`/mnt/user/media`, read/write), `/review` → the results folder Review maps to `/review` (read-only), `/tdarr` → the Tdarr DB2 directory (read-only) and `/reports` → the Tdarr job reports folder (read-only); Extra Parameters `--user=99:100 --read-only --tmpfs=/tmp:rw,noexec,nosuid,size=64m --cap-drop=ALL --security-opt=no-new-privileges --cpus=2 --memory=1g --pids-limit=128`; no port.
   - **Compose:** the 1.11 `compose.yaml` from item 2 defines the service again: `docker compose --profile recovery up -d --no-build recovery`.

The old directory holds the Recovery state from the moment you stopped it in step 1. If the 2.0 Recovery has since moved a case past confirmation (Hold, quarantine, release exclusion, search or import), that old state no longer matches the library. Do not roll back Recovery then; keep the 2.0 container and inspect the case, or ask for help in an [issue](https://github.com/Desadius/Tdarr-Review/issues) without private values. Review's own `/data` stays compatible: 1.11.0 ignores the `recovery/` directory.
