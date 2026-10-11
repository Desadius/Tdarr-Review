# Tdarr Review

Review and approve Tdarr transcodes before replacing the files in your media library. Includes image and audio comparison, batch approval, recorded rejection reasons, savings statistics, and optional Radarr replacement recovery.

The application currently uses a **Czech interface**. It is a community project, independent of Tdarr, Radarr and Plex.

Release version: **1.10.1**. Use the explicit `1.10.1` image tag for this release; source/image publication and installation are separate operations. The initial source was collected from the deployed installation on 11 October 2026. Personal configuration, credentials, journals, film files and one-off repair approvals are excluded.

## What is included

- Review dashboard, library, history, savings and configuration pages.
- Individual or sequential batch approval, with source identity checks and a persistent replacement journal.
- PNG image comparison at the same requested time, audio waveforms/alignment, and 12-second headphone A/B samples: original on the left, transcode on the right, played sequentially.
- Evidence score that distinguishes verified, failed and unknown checks. It is not a probability that a film is flawless.
- Optional Radarr replacement request, preserving originals in quarantine and restricting the replacement profile to the same or higher quality.
- Optional Recovery worker: repeated confirmation of known original decoding errors, precise release exclusion, replacement tracking and shared status in Review.
- Quarantine retention: seven days **after explicit Review approval of the identified replacement**, with identity checks before deletion.

Review does not automatically approve films, and it does not repeat a complete video/audio decode during normal approval. Tdarr performs the health check; the viewer judges the result.

## Documentation

| Document | Contents |
| --- | --- |
| [Installation on Unraid](docs/INSTALL-UNRAID.md) | Docker image, mappings, permissions, login and first configuration |
| [Community Applications](docs/COMMUNITY-APPS.md) | Unraid template, maintainer submission and catalog status |
| [Configuration](docs/CONFIGURATION.md) | Paths, database, Radarr and Recovery settings |
| [User guide](docs/USER-GUIDE.md) | Approval, comparison, rejection, recovery and statistics |
| [Tdarr integration](docs/TDARR-INTEGRATION.md) | Flow placement, health checks and receipt format |
| [Architecture and safety](docs/ARCHITECTURE.md) | Replacement transaction, lifecycle and quarantine |
| [Operations](docs/OPERATIONS.md) | Updates, backup, restart and troubleshooting |
| [Release process](docs/RELEASES.md) | Separate source publication, Docker publication and deployment |
| [Development and verification](docs/DEVELOPMENT.md) | Tests, fixtures and compatibility limits |
| [Český přehled](docs/README-CS.md) | Rychlý rozcestník v češtině |
| [Change history](CHANGELOG.md) | Features and fixes implemented so far |

## Quick start

On a Linux server with Docker Compose:

```bash
git clone https://github.com/Desadius/Tdarr-Review.git
cd Tdarr-Review
cp .env.example .env
# Edit .env, create its host directories and set write permissions first.
docker compose pull review
docker compose up -d --no-build review
```

Follow [the installation guide](docs/INSTALL-UNRAID.md) before enabling file replacement. The public image is `ghcr.io/desadius/tdarr-review:1.10.1` for Linux amd64; optional Recovery uses `ghcr.io/desadius/tdarr-recovery:1.10.1`. Builds and isolated image tests passed, and anonymous registry access was verified; [packaging status](docs/COMMUNITY-APPS.md) records the remaining catalog steps. You can also build from source with `docker compose build review`. The default bind address is localhost. Set it to your server's LAN address and set `PUBLIC_ORIGIN` to the exact address used in your browser.

## Project layout

```text
review/       Web application and regression tests
recovery/     Optional background worker and tests
examples/     Configuration and Tdarr custom-function examples
docs/         Installation, user and operator documentation
tools/        Syntax and test runners
Dockerfile    Review image using the deployed Tdarr runtime
compose.yaml  Review, plus opt-in Recovery profile
```

Linux is required for the file replacement implementation, including directory synchronization. The supplied runtime has Node 24.15.0 and Jellyfin FFmpeg 7.1.4. The application was used with the Rust Tdarr engine and its existing API/database schema; future Tdarr releases and authenticated Tdarr API installations require separate compatibility verification.

The project's own code, templates and documentation use the [MIT license](LICENSE). Upstream runtime components retain their own licenses; see [NOTICE](NOTICE).
