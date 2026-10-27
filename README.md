# Tdarr Review

Review and approve Tdarr transcodes before replacing the files in your media library. Compare picture, sound and audio/video synchronisation in one five-step review, save your progress, then approve individually or in a batch. Includes recorded rejection reasons, savings statistics and optional Radarr replacement recovery.

Choose **English** or **Čeština** in the interface; Czech is the initial default. This is a community project, independent of Tdarr, Radarr and Plex.

Release version: **[2.3.0](https://github.com/Desadius/Tdarr-Review/releases/tag/v2.3.0)**. Use the explicit Linux amd64 `2.3.0` image tag for this source release. Moving `latest` is a separate publication choice. Source publication, image publication and updating a running installation remain separate operations. Personal configuration, credentials, journals, film files and one-off repair approvals are excluded from the repository and images.

## What is included

- Review dashboard, library, history, savings and configuration pages.
- One review workspace: **Preparation → Picture → Audio → Synchronisation → Decision**, with manual confirmations beside the comparison tools in each step.
- Server-saved progress and deferral with a note; individual start, middle and end synchronisation observations retain their selected tracks and times.
- External player/TV review and a separate HDR/Dolby Vision confirmation on a named suitable device.
- PNG frames with 1:1 viewing, waveforms/alignment, 12-second headphone A/B and playable AV clips with a movable wipe or side-by-side view.
- Server-enforced completed review, current file snapshot and review revision for individual and batch approval; persistent replacement journals and file identity checks.
- Technical assessment that distinguishes verified, failed and unknown evidence. It is not a probability that a film is flawless.
- Optional Radarr replacement request, preserving originals in quarantine and restricting the replacement profile to the same or higher quality.
- Optional Recovery inside the same container, Off by default (`RECOVERY_MODE` `off`, `verify` or `repair`): repeated confirmation of known original decoding errors, precise release exclusion, replacement tracking and shared status in Review.
- Quarantine retention: seven days **after explicit Review approval of the identified replacement**, with identity checks before deletion.

Loading or playing a preview never checks a review box. Browser AV clips use H.264 and mono AAC, with Detail previews bounded to 1920 × 1080 and Compact previews to 960 × 540. Supported HDR is converted to SDR; native quality, HDR and surround playback require a suitable external device. Review does not automatically approve films or repeat a complete video/audio decode during normal approval. Tdarr performs the health check; the viewer judges the result.

## Documentation

| Document | Contents |
| --- | --- |
| [Prepared samples](docs/PREPARED-SAMPLES.md) | Background preparation, language preferences and bounded cache |
| [Installation on Unraid](docs/INSTALL-UNRAID.md) | Docker image, mappings, permissions, login and first configuration |
| [Community Applications](docs/COMMUNITY-APPS.md) | Unraid template, maintainer submission and catalog status |
| [Configuration](docs/CONFIGURATION.md) | Paths, database, Radarr and Recovery settings |
| [User guide](docs/USER-GUIDE.md) | Guided review, comparison, saved progress, approval and recovery |
| [Review workflow](docs/REVIEW-WORKFLOW-DESIGN.md) | Implemented checklist, observations, revisions and approval gates |
| [Interface languages](docs/UI-LANGUAGES.md) | English/Czech selection and preserved review progress |
| [Tdarr integration](docs/TDARR-INTEGRATION.md) | Flow placement, health checks and receipt format |
| [Architecture and safety](docs/ARCHITECTURE.md) | Replacement transaction, lifecycle and quarantine |
| [Operations](docs/OPERATIONS.md) | Updates, backup, restart and troubleshooting |
| [Migration to 2.0](docs/MIGRATE-TO-2.0.md) | Moving a two-container installation to one container |
| [Release process](docs/RELEASES.md) | Separate source publication, Docker publication and deployment |
| [Development and verification](docs/DEVELOPMENT.md) | Tests, fixtures and compatibility limits |
| [Český přehled](docs/README-CS.md) | Rychlý rozcestník v češtině |
| [Change history](CHANGELOG.md) | Features and fixes implemented so far |

## Quick start

On a Linux server with Docker Compose, install the published image:

```bash
git clone https://github.com/Desadius/Tdarr-Review.git
cd Tdarr-Review
cp .env.example .env
# Edit .env, create its host directories and set write permissions first.
# Set REVIEW_IMAGE_TAG=2.3.0 for this release.
docker compose pull review
docker compose up -d --no-build review
```

Follow [the installation guide](docs/INSTALL-UNRAID.md) before enabling file replacement. The Linux amd64 image is `ghcr.io/desadius/tdarr-review:2.3.0`. It contains optional Recovery, Off by default and controlled by `RECOVERY_MODE` (`off`, `verify`, `repair`); the separate Recovery image and the Compose `recovery` service are discontinued. Installations that run the separate Recovery container of 1.11.0 move with [the 2.0 migration guide](docs/MIGRATE-TO-2.0.md). To build locally instead, use `docker compose build review` and `docker compose up -d review`. The default bind address is localhost. Set it to your server's LAN address and set `PUBLIC_ORIGIN` to the exact address used in your browser.

The 2.3.0 changes make **Needs attention** cases actionable: an explained transcode failure with one eligible retry, deferral with a note, and a redacted diagnostic export for an administrator. They also add read-only TV preparation: TV library paths, exact Sonarr episode binding, manual inspection, a versioned Tdarr TV flow template and opt-in read-only TV result discovery. TV results cannot be approved or installed yet. Manual assessment and approval protections remain unchanged. Before updating an existing installation, read [Before updating](CHANGELOG.md#before-updating) in the changelog.

## Project layout

```text
review/       Web application and regression tests
recovery/     Optional background worker and tests
examples/     Configuration and Tdarr custom-function examples
docs/         Installation, user and operator documentation
tools/        Syntax and test runners
Dockerfile    Review image using the deployed Tdarr runtime
compose.yaml  One Review service; Recovery is selected with RECOVERY_MODE
```

Linux is required for the file replacement implementation, including directory synchronization. The supplied runtime has Node 24.15.0 and Jellyfin FFmpeg 7.1.4. The application was used with the Rust Tdarr engine and its existing API/database schema; future Tdarr releases and authenticated Tdarr API installations require separate compatibility verification.

The project's own code, templates and documentation use the [MIT license](LICENSE). Upstream runtime components retain their own licenses; see [NOTICE](NOTICE).
