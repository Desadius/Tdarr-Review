# Add TV paths

This guide prepares an optional, inactive TV path plan in Review. The current foundation checks configured paths and access. It does not discover TV episodes, identify which episode a result belongs to, or authorize replacements. TV processing cannot be enabled until the separate safety safeguards are complete. An absent TV plan does not block movie review.

The optional `libraries` field remains in the shared settings generation. Older builds may not understand TV path plans, so make a private backup of settings and the container template before applying a generation that includes one. Do not start an older build with the TV-extended `shared-settings.json`. Any rollback must preserve current state and journals; restore a configuration compatible with the older build only after Review is quiescent and the saved state has been manually reviewed. There is no safe automatic rollback for this change.

## Understand the paths

The shared settings document may include a top-level `libraries` object with an optional `tv` plan:

```json
{
  "libraries": {
    "tv": {
      "enabled": false,
      "mediaRoot": "/media/tvshows",
      "reviewRoot": "/review",
      "libraryId": "",
      "sourceRoots": [],
      "tdarrReviewRoot": "",
      "reviewPrefixes": ["TV"],
      "sonarrRoot": "",
      "quarantineRoot": "/media/.tdarr-tv-quarantine",
      "reports": "/tdarr/JobReports"
    }
  }
}
```

These values are paths as each service sees them. `enabled` remains `false`; the setting is reserved and does not turn on TV processing. Tdarr on Windows may use paths such as `Z:/TV`, while Review sees `/media/tvshows` and Sonarr may see `/tv`. They are different namespaces. Matching strings or a shared host folder do not prove file identity or episode identity.

The common `/media` parent bind may already make both `/media/movies` and `/media/tvshows` visible. Check the actual contents and access using the container's configured UID 99 and GID 100. If a folder exists on the host but is missing inside Review, that is a Docker mount/access issue. If it is visible but the TV plan is empty, that is missing TV configuration. Resolve these as separate findings.

One shared mount is simplest where its full host scope is intended. Otherwise use narrow independent mounts and set the TV plan to their container destinations. The Compose file includes commented optional bind examples. Every host folder must be intentionally selected; do not broaden access just to make a path check pass.

## Path roles

| Role | Purpose and access |
| --- | --- |
| `mediaRoot` | TV originals inside Review; readable for diagnostics. Any future rename requires a fresh identity and access check. |
| `sourceRoots` | Source path or paths as Tdarr sees them; they do not establish an episode identity mapping. |
| `reviewRoot` | Completed TV results inside Review, separate from originals and writable only if a future approved workflow requires it. |
| `tdarrReviewRoot` | Result root as Tdarr sees it. |
| `reviewPrefixes` | Result prefixes used only for TV. Keep `TV` separate from the movie prefix `PROD-Movies`; never reuse the movie prefix for TV. |
| `libraryId` | Tdarr TV library identifier, if known. It does not prove a result's episode identity. |
| `sonarrRoot` | TV root as Sonarr sees it. |
| `quarantineRoot` | Dedicated TV quarantine path, outside the TV originals root and on a compatible mounted filesystem. |
| `reports` | Tdarr reports path for the TV plan. Keep Tdarr DB2, including WAL/SHM, and reports read-only. |

The current movie result mapping `/review` may already expose `/review/PROD-Movies` and `/review/TV`. `/review/movies` in examples is not a required migration target. Preserve existing result paths and transactions while planning any future change.

## Prepare and check

1. Export or privately back up current Review settings and the Unraid container template. Keep the backup outside source control.
2. Inspect existing host and container paths using the real configured UID 99/GID 100. Confirm which folders are actually mounted and whether they are readable or writable for their intended role.
3. Record the current Tdarr, Review and Sonarr paths, their host mappings, the TV result prefix, quarantine location, report directory and DB2 directory. Confirm DB2 and its WAL/SHM sidecars remain read-only.
4. Preview each proposed mapping and check for overlap with movie originals, movie results, existing TV results, quarantine, application data and reports. Do not move or rename existing results as part of this path draft.
5. Save the optional TV paths as a draft with processing disabled. Use **Check library paths** to inspect the saved revision. This GET-only check reads path metadata and permissions; it creates no files and makes no Tdarr or Sonarr API calls. It cannot guarantee a future write or transaction, and it cannot prove that paths refer to the same episode.
6. Resolve each reported issue by checking the actual mount and configured path. A folder visible under `/media` can still have no corresponding TV configuration. A configured path can also be missing because its Docker bind is absent.
7. Keep TV processing inactive. Episode identity, source/result matching and every future write or replacement require their own safeguards and fresh access checks.

Changing a bind in Unraid or Compose requires a manually reviewed container recreation coordinated with active work. Do not recreate the container during an approval, transaction, pending replacement, session or other active operation. A mapping edit requires manual review; this guide does not authorize deployment. Obtain separate explicit deployment authorization before changing a production container.

Keep the existing movie paths, pending transactions and review sessions intact. Never use root, `chmod 777`, recursive `chmod` or recursive `chown` to make paths pass. Adjust only the specific host directories and permissions that are needed, after reviewing their owners and purpose.
