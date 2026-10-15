# Community Applications packaging

**Submitted and auto-approved on 11 October 2026 as Desadius' Repository.** The [tdarr-review catalog entry](https://ca.unraid.net/apps/tdarr-review-1qs5sdc0gn7hmk) was visible on 12 October 2026. Catalog description refreshes and Docker image publication are separate operations.

Both Docker images of that release (Review and the since discontinued separate Recovery image) were built, tested and published on 11 October 2026. Anonymous access to their manifests and image configurations was verified; their digests match the images tested and pushed by [CI](https://github.com/Desadius/Tdarr-Review/actions/runs/38158144901). The Community Applications scanner found one valid Docker app with no template warnings and confirmed that its image is publicly pullable. The repository owner authorized the final submission and acceptance of the portal's terms.

## Included files

| File | Purpose |
| --- | --- |
| [`../templates/tdarr-review.xml`](../templates/tdarr-review.xml) | Main Review application template, marked beta |
| [`../ca_profile.xml`](../ca_profile.xml) | Repository and maintainer profile |
| [`../assets/icon.svg`](../assets/icon.svg) | Original project icon |
| [`../LICENSE`](../LICENSE) | MIT license for the project's own code, templates and documentation |

The template references the public `ghcr.io/desadius/tdarr-review:latest` image, for **Linux amd64**. It installs one Review container, which since 2.0.0 also contains optional Recovery. Recovery is Off by default and selected with the **Recovery mode** dropdown (`RECOVERY_MODE`: `off`, `verify`, `repair`); see [Installation on Unraid](INSTALL-UNRAID.md#6-optional-recovery). No separate Recovery image or catalog entry exists. First public image revision: `cab3774c4f42b200da294ee9adc5ec06a39a05fc`; see [verification](VERIFICATION.md) for digests and test scope.

For an existing listed application, publish tested source and Docker images and update `latest` when releasing to template users. The 2.0.0 update keeps the same image name, ports and paths, adds the `RECOVERY_MODE` variable and raises the resource limits to two CPUs, 2 GiB and 256 processes. Unraid does not add new template variables or change Extra Parameters of an installed container by itself: existing users add **Recovery mode** and raise the limits when they edit the container, as described in [Installation on Unraid](INSTALL-UNRAID.md#updating-to-200), and users of the former Recovery container follow [the 2.0 migration guide](MIGRATE-TO-2.0.md). No new application submission is needed; the tested image must be published to `latest` for template users. The template/profile descriptions now mention guided assessment and Czech/English interfaces; they do not require a new application submission. Existing installations update their container image through Unraid. Updating a catalog description does not restart installed containers, and pushing Git source alone does not publish an image.

The MIT license does not replace licenses belonging to the Tdarr runtime, Node.js, FFmpeg or other bundled third-party components.

## Validate before submitting

1. Confirm the selected image is publicly pullable. The first published images have passed anonymous manifest/config checks. A public GitHub repository does not automatically establish its GHCR package visibility.
2. Confirm the public repository is active, the root license is present, and all raw template/profile/icon and support URLs resolve.
3. Install the template on an amd64 Unraid test installation. Test first login, connection/path checks, a disposable approval, host-port changes, restart, update and persistence. Do not reuse the same `/data` directory in two running Review containers.
4. Open [Submit a Repository](https://ca.unraid.net/submit/new), sign in with an Unraid account and enter `https://github.com/Desadius/Tdarr-Review`.
5. Run **Validate**, then **Scan**. Resolve findings and inspect the listing preview. Repeat these steps after meaningful XML changes.
6. Submit for review. Only describe the app as available in Community Applications after it is accepted and visible in the catalog.

GHCR publication can use GitHub Actions `GITHUB_TOKEN` with `packages: write`. The first package publication defaults to private. A package administrator changes this in **Package settings → Danger Zone → Change visibility → Public**. GitHub documents no package visibility update endpoint in its REST package API; do not assume a publishing workflow changes visibility. See [Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry) and [package visibility](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility).

## Template configuration

Set both required URLs for your own installation:

- `PUBLIC_ORIGIN`: exact browser origin, such as `http://YOUR_UNRAID_IP:8270`; use your selected host port.
- `TDARR_URL`: Tdarr server API URL reachable from Review, such as `http://YOUR_UNRAID_IP:8266`.

Both fields are deliberately blank in the template. No personal server address is embedded. The default `WebUI` uses Unraid's `[IP]` and `[PORT:8270]` substitutions. If you use HTTPS or a reverse proxy, set `PUBLIC_ORIGIN` to that actual origin and launch it through the proxy.

| Container path | Access | Host directory |
| --- | --- | --- |
| `/data` | Read/write | Persistent Review state, key, settings and journals; Recovery's configuration and state in `/data/recovery/` |
| `/media` | Read/write | Media parent containing the movie library and space for quarantine outside Plex |
| `/review` | Read/write | Completed results awaiting approval, separate from originals |
| `/tdarr` | Read-only | Tdarr DB2 directory containing `SQL/database.db` and sidecars |

`RECOVERY_MODE` defaults to `off`; `verify` and `repair` also need `/data/recovery/config.json`, and a change applies after a container restart. No Recovery-only path is required. The defaults expect movies at `/media/movies`. Adjust the media-root variable if your folder differs. Configure Tdarr's own source roots and result-root aliases in Review Settings after login. Saved settings take precedence over environment defaults. Use the path/connection test before approving anything.

The template preserves the Compose restrictions: UID 99/GID 100, read-only container root, all capabilities dropped, no new privileges, two CPUs, 2 GiB RAM, 256 processes (shared by Review and Recovery), a 128 MiB `/tmp` tmpfs with `noexec,nosuid`, and bounded Docker logs. It does not request privileged mode, host networking or a Docker socket. If your file owner differs, change `--user=99:100` in Extra Parameters to the UID/GID that can access the chosen mappings; do not recursively change the entire media library's ownership.

The normal Unraid port mapping makes the UI reachable on the published host port. Compose defaults to localhost binding; choose the address/network exposure deliberately when installing the Unraid template. Keep access credentials private. Review writes to the media library only through an approval or a separately requested recovery operation; install against disposable media first.

Enable Unraid Autostart. Do not also launch the Compose Review service against these same state and media paths. See [Installation on Unraid](INSTALL-UNRAID.md) for directory preparation and first login.

## Maintainer metadata

GitHub Issues is the support destination: <https://github.com/Desadius/Tdarr-Review/issues>. The current official field reference explicitly accepts an issues URL in `<Support>`. The root profile uses the same support landing page in optional `<Forum>`; an Unraid forum thread is not asserted to exist.

The submission requires a public active repository, an OSI-approved root license, valid Docker XML and a nonempty root `ca_profile.xml` `<Profile>`. The template is marked `<Beta>true</Beta>` because this is the first packaged public installation path. Remove the beta marker only after fresh-install/update validation supports doing so.

Official references:

- [Submission requirements and workflow](https://ca.unraid.net/submit/new)
- [Docker repository XML](https://ca.unraid.net/submit/help/repository-xml)
- [Repository profile XML](https://ca.unraid.net/submit/help/repository-info-xml)
- [Public XML field reference](https://ca.unraid.net/submit/help/xml-field-reference)
- [Builder guide](https://ca.unraid.net/submit/help/builders)
