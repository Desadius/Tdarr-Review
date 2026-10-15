# Install on Unraid

This guide describes **2.0.0**, targeting the versioned Linux amd64 image `ghcr.io/desadius/tdarr-review:2.0.0`. You can also build the source locally. The previous release 1.11.0 has [its own guide](https://github.com/Desadius/Tdarr-Review/blob/v1.11.0/docs/INSTALL-UNRAID.md). The [Community Applications entry](https://ca.unraid.net/apps/tdarr-review-1qs5sdc0gn7hmk) uses the supplied [`templates/tdarr-review.xml`](../templates/tdarr-review.xml) with `latest`. Registry availability and catalog visibility are separate; see [publication status](COMMUNITY-APPS.md). Cloning this repository does not update an existing container.

## Updating to 2.0.0

2.0.0 installs as **one container**. The Review image contains optional Recovery, which is **Off** by default and controlled by `RECOVERY_MODE` (`off`, `verify`, `repair`) in the template or `.env`. The separate Recovery image, the Compose `recovery` service and the Recovery data directory are discontinued; Recovery keeps its files in `/data/recovery/`. The resource limits rise to two CPUs, 2 GiB and 256 processes, because Review and an original decode share them.

- **You ran only Review:** back up `/data`, update only while no approval, batch, node restore or transaction recovery is running, and keep the existing mappings, access key and settings. Raise the limits in Extra Parameters as in [step 3](#3-unraid-docker-template). Nothing else changes; Recovery stays Off.
- **You also ran the Recovery container:** follow [the 2.0 migration guide](MIGRATE-TO-2.0.md). It copies the old Recovery data, keeps frozen approval paths through an extra `/storage` mapping and removes the old container, so two Recovery instances never act on one library.

Select `2.0.0` explicitly; updating source or publishing images does not deploy an existing installation.

The five-step assessment and current `reviewRevision` required since 1.10.2 remain mandatory for approval. The optional Recovery routing function is a separate Tdarr flow change; follow [the integration guide](TDARR-INTEGRATION.md#require-review-for-recovery-replacements).

## 1. Prepare paths and permissions

Choose four persistent locations: Review state, original media, Tdarr output awaiting approval, and the Tdarr DB2 directory. The example uses `/mnt/user/media/movies` for films and mounts its parent `/mnt/user/media` so quarantine can live outside the Plex library.

Do not point `REVIEW_HOST` at the original library. Tdarr must write results to this separate location and preserve the original. If you already have Review results, use that existing directory.

Example for new application/output directories:

```bash
mkdir -p /mnt/cache/appdata/tdarr-review/data
mkdir -p /mnt/cache/tdarr-review-output
chown nobody:users /mnt/cache/appdata/tdarr-review/data /mnt/cache/tdarr-review-output
chmod 770 /mnt/cache/appdata/tdarr-review/data /mnt/cache/tdarr-review-output
```

Unraid commonly uses UID 99 / GID 100 (`nobody:users`). Verify your installation. Review needs write access to the media directories and results, including permission to rename files and create temporary files. Do not recursively change permissions on the whole library merely to install this application.

## 2. Clone and configure

```bash
git clone https://github.com/Desadius/Tdarr-Review.git
cd Tdarr-Review
cp .env.example .env
```

Edit `.env` in a text editor. Set `REVIEW_IMAGE_TAG=2.0.0` for this source release, your real paths and API address. Set `REVIEW_BIND_IP` to the server's LAN IP if you want LAN access. Set `PUBLIC_ORIGIN` to exactly the browser origin, for example `http://YOUR_UNRAID_IP:8270` (with your actual IP).

`TDARR_DB_HOST` must be the **directory** containing `SQL/database.db`, not just the database file. Its WAL/SHM sidecars must be available through the same read-only mapping. Locate this directory in your Tdarr server appdata before starting.

After the `2.0.0` image has been published, if Docker Compose is available on your Unraid installation:

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
| Repository | `ghcr.io/desadius/tdarr-review:2.0.0` after publication, or `tdarr-review:local` |
| Network | `bridge` |
| WebUI | `http://[IP]:[PORT:8270]` |
| Port | Host `8270` → container `8270/TCP` |
| Variable `PUBLIC_ORIGIN` | Actual URL used in the browser |
| Variable `TDARR_URL` | Tdarr API address reachable from this container |
| Variable `MEDIA_ROOT` | `/media/movies` |
| Variable `REVIEW_ROOT` | `/review` |
| Variable `RECOVERY_MODE` | `off` (default), `verify` or `repair`; see [Optional Recovery](#6-optional-recovery) |
| App state | Your state directory → `/data`, read/write |
| Media parent | Your media share → `/media`, read/write |
| Review output | Your results directory → `/review`, read/write |
| Tdarr DB2 | Your DB2 directory → `/tdarr`, read-only |

Suggested Extra Parameters:

```text
--user=99:100 --read-only --cap-drop=ALL --security-opt=no-new-privileges --cpus=2 --memory=2g --pids-limit=256 --tmpfs=/tmp:rw,noexec,nosuid,size=128m --restart=unless-stopped --log-opt=max-size=10m --log-opt=max-file=3
```

Enable Unraid Autostart for this container. Do not start a second Compose instance using the same state/media mappings if you use the Unraid template. The application is designed for one Review writer. The limits cover Review and, when enabled, Recovery's original decodes in the same container.

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

Recovery runs inside the Review container and is **Off** until you set `RECOVERY_MODE` to `verify` or `repair` (the **Recovery mode** dropdown in the template, or `RECOVERY_MODE` in `.env` for Compose). With `off`, nothing about Recovery runs and Review works as before, including its manual Radarr integration. A mode change applies after a container restart.

Copy `examples/recovery-config.example.json` into Review's data directory as `recovery/config.json` (host path for the example: `/mnt/cache/appdata/tdarr-review/data/recovery/config.json`). Its defaults use the mappings Review already has: library `/media/movies`, quarantine `/media/.tdarr-corrupt`, reports `/tdarr/JobReports` and the database `/tdarr/SQL/database.db`. Edit every relevant field, supply the Radarr key privately, and restrict the directory and file to the container UID:

```bash
mkdir -p /mnt/cache/appdata/tdarr-review/data/recovery
cp examples/recovery-config.example.json /mnt/cache/appdata/tdarr-review/data/recovery/config.json
chown -R nobody:users /mnt/cache/appdata/tdarr-review/data/recovery
chmod 700 /mnt/cache/appdata/tdarr-review/data/recovery
chmod 600 /mnt/cache/appdata/tdarr-review/data/recovery/config.json
```

Set a suitable `since` timestamp in Unix **milliseconds** instead of zero if you only want recent Tdarr errors considered. Do not add `enabled`; `RECOVERY_MODE` is the only switch.

Create the quarantine root before enabling repairs. For the example media mapping:

```bash
mkdir -p /mnt/user/media/.tdarr-corrupt
chown nobody:users /mnt/user/media/.tdarr-corrupt
chmod 770 /mnt/user/media/.tdarr-corrupt
```

Use the parent of your actual movie library if it differs. It must be writable by the container and outside Plex's movie root, but within the same mounted media tree.

Start with `RECOVERY_MODE=verify` and restart the container. Verify confirms corrupted originals but makes no automatic external repairs. `dry_run` cases are not automatically replayed when you later switch to `repair`; inspect them deliberately. Do not switch to `repair` until the mappings and Radarr history are confirmed. Review's **Recovery** view shows whether Recovery is **Off**, **Running**, **Restarting**, **Refused** or **Stopped**. It is refused (exit code 78, `RECOVERY_REFUSED <reason>` in `docker logs tdarr-review`) when the mode is invalid, when `config.json` is missing or invalid, when an `enabled` value left in `config.json` disagrees with the mode, or when the approval registry refuses the configuration; see [Recovery mode](CONFIGURATION.md#recovery-mode). A refusal never stops Review or makes the container unhealthy.

A fresh installation needs no frozen pending approvals. The empty `examples/recovery-approval-registry.example.json` may be copied privately to `/data/recovery/pending-approvals.json`; it does not authorize repairs. An installation that ran the separate Recovery container up to 1.11.0 follows [the 2.0 migration guide](MIGRATE-TO-2.0.md) instead; its private registry is copied unchanged.

## 7. Update an existing installation

Keep the existing state, media, Review output and read-only Tdarr database mappings. Back up the mapped `/data` directory privately before the update; it contains access settings, history, journals and now server-saved review progress. Do not replace it with a fresh example directory. Run only one Review writer against those mappings.

After registry publication, pin `REVIEW_IMAGE_TAG=2.0.0` in the existing `.env`, or the explicit `ghcr.io/desadius/tdarr-review:2.0.0` Repository value in Unraid, then pull/recreate that same Review service. A source build can be installed independently. Recovery is part of the same image and updates with it; an installation that still runs the separate Recovery container follows [the 2.0 migration guide](MIGRATE-TO-2.0.md).

Existing pending films start with an unfinished manual review when no matching version-1 session is saved. Past successful transcodes, technical scores and historical approvals do not fabricate new checklist confirmations. Verify container health, login, the five-step workspace and reopening saved/deferred progress before approving a real film. Updating the source or image does not update your own installation automatically.
