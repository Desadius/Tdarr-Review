# Repository verification — 2026-10-11

The prepared source passed JavaScript syntax checks and **149 regression tests** on Linux, Node 24.15.0. Test data was copied to an isolated temporary directory and APIs were mocked. No production approval, film replacement, Radarr download or container restart was used for these tests.

The isolated HTTP integration test passed authentication/origin checks, plain-text Tdarr `OK` responses, competing single/batch requests, all-selection preflight, sequential batch replacement, changed-source preservation, rejection of only the result, history recording and restoration of owned node pauses. It generated disposable short media using Jellyfin FFmpeg 7.1.4.

Documentation links and JSON examples were checked. A scan found no known private SSH material, production API credentials, personal server IP, personal library ID or local Windows user paths in the prepared files.

These initial results verify the source and example contracts. Image verification completed afterward, as recorded below. A fresh Unraid template installation, authenticated Tdarr API support and future Tdarr versions remain separate checks.

## Public Docker images

[GitHub Actions run 38158144901](https://github.com/Desadius/Tdarr-Review/actions/runs/38158144901) passed all 149 tests and both actual Linux amd64 image builds before publication. Source revision: `cab3774c4f42b200da294ee9adc5ec06a39a05fc`.

- Review default entrypoint starts as UID 99/GID 100 with a fresh named `/data` volume, read-only container root, dropped capabilities and no external network. Login, SQLite, bundled FFmpeg/FFprobe, writable state and the health check passed. A browser origin with a different host/port is explicitly exercised.
- The complete isolated Review HTTP integration test passed inside that actual image, including synthetic approvals and source-change preservation.
- Recovery's actual configured `ionice → nice → node` command completed one disabled pass against empty fixture tables and a loopback mock. No repair API was called and sentinel media retained its identity and bytes.
- Temporary containers and named volumes were cleaned. No production mounts, movie replacement, Radarr download or production restart was used.

Published and anonymously verified on 11 October 2026:

| Image | Digest |
| --- | --- |
| `ghcr.io/desadius/tdarr-review:latest` | `sha256:4e48ae6fa210397fead52085349692fedd0feff17fa0a488fa0e8481152b13de` |
| `ghcr.io/desadius/tdarr-recovery:latest` | `sha256:db591f9c7e632af0179405454fd4b91fd69778131c2aa1a77c4a660d2eee6dc1` |

Anonymous checks fetched and hashed each manifest and image configuration, confirmed Linux amd64, and matched the revision/digests pushed by CI. This was a manifest/config accessibility check, not a full fresh download of every layer to a new Unraid host. The initial compressed image layers total about 1.5 GB because the pinned upstream Tdarr runtime is retained.

The Community Applications portal accepted the repository's MIT license and profile and found one valid Docker application with no template errors or warnings. The image pullability check also passed. Final submission was received and auto-approved on 11 October 2026; the portal states that inclusion follows the next published catalog build. The template remains marked beta.
