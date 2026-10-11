# Install on Unraid

The examples build a local image. There is no prebuilt Tdarr Review image or Community Applications listing yet. Existing production containers are not changed by cloning this repository.

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

Edit `.env` in a text editor. Set your real paths and API address. Set `REVIEW_BIND_IP` to the server's LAN IP if you want LAN access. Set `PUBLIC_ORIGIN` to exactly the browser origin, for example `http://YOUR_UNRAID_IP:8270` (with your actual IP).

`TDARR_DB_HOST` must be the **directory** containing `SQL/database.db`, not just the database file. Its WAL/SHM sidecars must be available through the same read-only mapping. Locate this directory in your Tdarr server appdata before starting.

If Docker Compose is available on your Unraid installation:

```bash
docker compose build review
docker compose up -d review
docker compose logs --tail 40 review
```

## 3. Alternative: Unraid Docker template

Build from the repository directory:

```bash
docker build -t tdarr-review:local .
```

In **Docker → Add Container**, configure:

| Field | Value |
| --- | --- |
| Name | `tdarr-review` |
| Repository | `tdarr-review:local` |
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

Open **Nastavení** (Settings). Fill in the source roots **as seen by the Tdarr server**, the Review path **as seen by Tdarr**, the library ID and optional prefixes. Use the connection/path test before saving. A saved `/data/settings.json` takes precedence over environment defaults on subsequent starts.

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

Check that expected results are listed and match their originals. Compare a disposable test film first. Confirm Tdarr health checks, audio/subtitle policy and paths. Approval copies a result back to the original library and removes the replaced original after a verified transaction; it is a real media modification.

Plex sees the replacement at the original film path (or the verified MKV destination for a TS/M2TS source). Review does not call Plex's API. Use Plex's normal automatic/periodic scan or trigger a library scan yourself.

## 6. Optional Recovery

Copy `examples/recovery-config.example.json` to the directory named by `RECOVERY_DATA_HOST`, as `config.json`. Edit every relevant field, supply the Radarr key privately, and restrict the file to the container UID (`chmod 600`). Set a suitable `since` timestamp in Unix **milliseconds** instead of zero if you only want recent Tdarr errors considered.

```bash
docker compose --profile recovery build recovery
docker compose --profile recovery up -d recovery
docker compose logs --tail 40 recovery
```

The example starts with `enabled:false`. This allows verification but disables automatic external repairs. Dry-run cases are not automatically replayed when you later enable it; inspect them deliberately. Do not enable repairs until the mappings and Radarr history are confirmed.

The optional worker runs in a second container, with no HTTP port. Combining both processes in one container is not implemented in this release. Without this worker, normal Review approval and its manual Radarr integration still work.
