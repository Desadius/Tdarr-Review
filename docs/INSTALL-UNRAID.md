# Install on Unraid

This guide describes **1.11.0**, targeting the versioned Linux amd64 image `ghcr.io/desadius/tdarr-review:1.11.0`. You can also build the source locally. The [Community Applications entry](https://ca.unraid.net/apps/tdarr-review-1qs5sdc0gn7hmk) uses the supplied [`templates/tdarr-review.xml`](../templates/tdarr-review.xml) with `latest`. Registry availability and catalog visibility are separate; see [publication status](COMMUNITY-APPS.md). Cloning this repository does not update an existing container.

## Updating to 1.11.0

Back up persistent `/data` and update only while no approval, batch, node restore or transaction recovery is running. Keep existing mappings, access key and settings. This release uses the same ports, mappings, permissions and Unraid template. New in `/data`: `decision-audit.jsonl` and its timestamped archives, a durable record of approvals and Radarr replacement requests; include them in backups. Review now lists the Tdarr nodes it will resume and lets you keep a node you paused yourself paused; the container health check reads `/health` and the UI, and reports pending work in Docker's health log without failing. Recovery adds the optional `fullSourceHash` setting (off by default) and reports edits to its `config.json` that need a restart. It does not reconstruct old approvals, reset assessments or relax quarantine identity checks.

Review and optional Recovery have separate image tags and can be updated independently: each version tolerates the other's status-file fields. Select `1.11.0` explicitly; updating source or publishing images does not deploy an existing installation.

The five-step assessment and current `reviewRevision` required since 1.10.2 remain mandatory for approval. The optional Recovery routing function is a separate Tdarr flow change; follow [the integration guide](TDARR-INTEGRATION.md#require-review-for-recovery-replacements).

## 1. Prepare paths and permissions

Choose four persistent locations: Review state, original media, Tdarr output awaiting approval, and the Tdarr DB2 directory. The example uses `/mnt/user/media/movies` for films and mounts its parent `/mnt/user/media` so quarantine can live outside the Plex library.

Do not point `REVIEW_HOST` at the original library. Tdarr must write results to this separate location and preserve the original. If you already have Review results, use that existing directory.

Example for new application/output directories:

```bash
mkdir -p /mnt/cache/appdata/tdarr-review/data
mkdir -p /mnt/cache/appdata/tdarr-recovery/data
mkdir -p /mnt/cache/tdarr-review-output
chown nobody:users /mnt/cache/appdata/tdarr-review/data \
  /mnt/cache/appdata/tdarr-recovery/data /mnt/cache/tdarr-review-output
chmod 770 /mnt/cache/appdata/tdarr-review/data \
  /mnt/cache/appdata/tdarr-recovery/data /mnt/cache/tdarr-review-output
```

Unraid commonly uses UID 99 / GID 100 (`nobody:users`). Verify your installation. Review needs write access to the media directories and results, including permission to rename files and create temporary files. Do not recursively change permissions on the whole library merely to install this application.

## 2. Clone and configure

```bash
git clone https://github.com/Desadius/Tdarr-Review.git
cd Tdarr-Review
cp .env.example .env
```

Edit `.env` in a text editor. Set `REVIEW_IMAGE_TAG=1.11.0` for this source release, your real paths and API address. Set `REVIEW_BIND_IP` to the server's LAN IP if you want LAN access. Set `PUBLIC_ORIGIN` to exactly the browser origin, for example `http://YOUR_UNRAID_IP:8270` (with your actual IP).

`TDARR_DB_HOST` must be the **directory** containing `SQL/database.db`, not just the database file. Its WAL/SHM sidecars must be available through the same read-only mapping. Locate this directory in your Tdarr server appdata before starting.

After the `1.11.0` image has been published, if Docker Compose is available on your Unraid installation:

```bash
docker compose pull review
docker compose up -d --no-build review
docker compose logs --tail 40 review
```

For the prepared source before image publication, or a local build at any time, use `docker compose build review` and `docker compose up -d review`. A locally built image does not establish that the same registry tag is public.

## 3. Unraid Docker template

Once catalog inclusion is confirmed, search **Apps** for **tdarr-review**, select Install and edit the paths and the two required URLs. Before catalog acceptance, you can import the supplied XML manually in your Unraid template directory:

```bash
mkdir -p /boot/config/plugins/dockerMan/templates-user
curl --fail --location --output /boot/config/plugins/dockerMan/templates-user/my-tdarr-review.xml \
  https://raw.githubusercontent.com/Desadius/Tdarr-Review/main/templates/tdarr-review.xml
```

Then select it in **Docker → Add Container**. Confirm the existing template file will not be overwritten if you already have an installation. The image must be publicly downloadable first. The template includes resource limits and writable state; prepare host directory permissions as in step 1. It does not install a Tdarr server or change its flows.

If using a local build rather than the registry image, build from the repository directory and replace Repository with `tdarr-review:local`:

```bash
docker build -t tdarr-review:local .
```

In **Docker → Add Container**, configure:

| Field | Value |
| --- | --- |
| Name | `tdarr-review` |
| Repository | `ghcr.io/desadius/tdarr-review:1.11.0` after publication, or `tdarr-review:local` |
| Network | `bridge` |
| WebUI | `http://[IP]:[PORT:8270]` |
| Port | Host `8270` → container `8270/TCP` |
| Variable `PUBLIC_ORIGIN` | Actual URL used in the browser |
| Variable `TDARR_URL` | Tdarr API address reachable from this container |
| Variable `MEDIA_ROOT` | `/media/movies` |
| Variable `REVIEW_ROOT` | `/review` |
| App state | Your state directory → `/data`, read/write |
| Media parent | Your media share → `/media`, read/write |
| Review output | Your results directory → `/review`, read/write |
| Tdarr DB2 | Your DB2 directory → `/tdarr`, read-only |

Suggested Extra Parameters:

```text
--user=99:100 --read-only --cap-drop=ALL --security-opt=no-new-privileges --cpus=1 --memory=1g --pids-limit=128 --tmpfs=/tmp:rw,noexec,nosuid,size=128m --restart=unless-stopped --log-opt=max-size=10m --log-opt=max-file=3
```

Enable Unraid Autostart for this container. Do not start a second Compose instance using the same state/media mappings if you use the Unraid template. The application is designed for one Review writer.

## 4. First login and settings

On first start, Review creates `/data/access-key` with restricted permissions. Read it privately from the mapped data directory and enter it on the login page. Do not paste it into an issue or commit it. Sessions last 30 days.

Choose **English** or **Čeština** in the header; the choice is saved in this browser. Open **Settings** (**Nastavení**). Fill in the source roots **as seen by the Tdarr server**, the Review path **as seen by Tdarr**, the library ID and optional prefixes. Use the connection/path test before saving. A saved `/data/settings.json` takes precedence over environment defaults on subsequent starts.

For the example layout:

```text
Review mediaRoot:       /media/movies
Review reviewRoot:      /review
Tdarr sourceRoots:     /media/movies
Tdarr tdarrReviewRoot: /pilot-review (or your actual Tdarr mapping)
reviewPrefixes:        PROD-Movies (only if results use this prefix)
database:              /tdarr/SQL/database.db
```

See [Configuration](CONFIGURATION.md) for aliases and extension-changing flows.

## 5. Verify before approval

Check that expected results match their originals. Use a disposable test film to complete **Preparation → Picture → Audio → Synchronisation → Decision**, confirming each check beside its tool and saving start/middle/end sync checks separately. Save a partial review, close it and reopen it to verify persistent progress. Confirm Tdarr health checks, audio/subtitle policy and paths. Approval requires the current completed server-saved review, snapshot and revision, including for every film in a batch. The final approval dialog copies a result back to the library and removes the replaced original after a verified transaction; it is a real media modification.

For external player/TV checks, name a device/player with at least two characters after trimming surrounding whitespace. HDR/Dolby Vision also requires its own confirmation on a suitable named device. Browser AV previews use H.264/mono AAC at up to 960 px and supported HDR is converted to SDR; they do not test native HDR or surround playback. Use **Defer review** with a note when more checks remain. See [the user guide](USER-GUIDE.md).

Plex sees the replacement at the original film path (or the verified MKV destination for a TS/M2TS source). Review does not call Plex's API. Use Plex's normal automatic/periodic scan or trigger a library scan yourself.

## 6. Optional Recovery

Copy `examples/recovery-config.example.json` to the directory named by `RECOVERY_DATA_HOST`, as `config.json`. Edit every relevant field, supply the Radarr key privately, and restrict the file to the container UID (`chmod 600`). Set a suitable `since` timestamp in Unix **milliseconds** instead of zero if you only want recent Tdarr errors considered.

Create the quarantine root before enabling repairs. For the example media mapping:

```bash
mkdir -p /mnt/user/media/.tdarr-corrupt
chown nobody:users /mnt/user/media/.tdarr-corrupt
chmod 770 /mnt/user/media/.tdarr-corrupt
```

Use the parent of your actual movie library if it differs. It must be writable by Recovery and outside Plex's movie root, but within the same mounted media tree.

Set `RECOVERY_MODE=verify` in the `.env` file next to `compose.yaml`. Compose refuses to start the `recovery` service without it.

```bash
docker compose --profile recovery pull recovery
docker compose --profile recovery up -d --no-build recovery
docker compose logs --tail 40 recovery
```

`RECOVERY_MODE=verify` confirms corrupted originals but makes no automatic external repairs. `dry_run` cases are not automatically replayed when you later switch to `repair`; inspect them deliberately. Do not switch to `repair` until the mappings and Radarr history are confirmed. The worker refuses to start (exit code 78, `RECOVERY_REFUSED <reason>` in its log) when the mode is missing or invalid, when `config.json` is missing or invalid, or when an `enabled` value left in `config.json` disagrees with the mode; see [Recovery mode](CONFIGURATION.md#recovery-mode). An existing configuration with `"enabled": false` needs `RECOVERY_MODE=verify`, one with `"enabled": true` needs `RECOVERY_MODE=repair`.

A fresh installation needs no frozen pending approvals. The empty `examples/recovery-approval-registry.example.json` may be copied privately to Recovery `/data/pending-approvals.json`; it does not authorize repairs. Existing installations with historical approvals must follow [the registry migration guide](MIGRATE-RECOVERY-REGISTRY.md) before replacing Recovery source/image.

For a local worker build, use `docker compose --profile recovery build recovery` first. The optional worker runs in a second container, with no HTTP port. Combining both processes in one container is not implemented in this release. Without this worker, normal Review approval and its manual Radarr integration still work.

## 7. Update an existing installation to 1.11.0

Keep the existing state, media, Review output and read-only Tdarr database mappings. Back up the mapped `/data` directory privately before the update; it contains access settings, history, journals and now server-saved review progress. Do not replace it with a fresh example directory. Run only one Review writer against those mappings.

After registry publication, pin `REVIEW_IMAGE_TAG=1.11.0` in the existing `.env`, or the explicit `ghcr.io/desadius/tdarr-review:1.11.0` Repository value in Unraid, then pull/recreate that same Review service. A source build can be installed independently. Optional Recovery uses its own image tag and update procedure.

Existing pending films start with an unfinished manual review when no matching version-1 session is saved. Past successful transcodes, technical scores and historical approvals do not fabricate new checklist confirmations. Verify container health, login, the five-step workspace and reopening saved/deferred progress before approving a real film. A local installation passed these checks for this release; that does not update your own installation automatically.
