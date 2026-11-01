# A remounted file is recognised by size, modification time and a content sample

Unraid's user share (`/mnt/user`, a FUSE file system) gives every file a new device and inode number after a reboot of the server, while its size and modification time stay the same. Before this decision every such file looked different after a reboot: an approved replacement blocked its quarantine retention with "Approved replacement changed", a confirmed original lost its manual replacement, and review items were blocked as changed. Only a lone device change was accepted, and only by a review recheck.

`compareIdentity` in `recovery/file-identity.mjs` now names a difference in the device or inode number, or both, with the same size and modification time `remounted` (`device-changed` when only the device differs, as before), and `remounted-ctime-changed` when the ctime changed too. Size and modification time are the fields that say what the file holds; device and inode only say where the file system numbers it. A caller that accepts a remount confirms the content with a recorded content sample (SHA-256 over 1 MiB at the start, middle and end, `recovery/content-sample.mjs`, the same bytes as Recovery's `sampleSHA256`) wherever one was recorded. New approval evidence records `installedSample` for the installed copy. A record made before samples were kept is accepted by the unchanged size and modification time alone, because the alternative leaves every existing installation with false alarms after each reboot that only a manual reset clears.

We rejected accepting a remount by size and modification time alone everywhere (a file rewritten in place with the same length and an older timestamp restored would pass), and rejected a full-file hash on every check (hours of reading on large films, for every case on every pass).

## Where a remount is accepted

- Quarantine retention (`retainCase`) and its read-only diagnosis: the approved copy (with `installedSample` when recorded; a remount with a ctime change only with it) and the quarantined original (with the case's `sampleSHA256` when the recorded identity is the confirmed original).
- Review's record of a quarantined file the user deleted.
- The source-only manual replacement of a confirmed original (`sourceCandidate`): only with a matching `sampleSHA256`; a case without a sample stays refused.
- The Tdarr handoff, the transcode retry and the installed-copy assessment of an imported replacement: no sample was recorded for the replacement, so size and modification time decide.
- The location detail of the Recovery attention overview (display only).
- The recheck of a changed review item: a device or inode change offers "Znovu ověřit soubory", which probes both files again; a remount with a ctime change stays blocked as changed.

## Consequences

- Places that act on a file without a fresh check after it stay exact: Review's approval transactions (`review/core.mjs`), the safe restore (`review/recovery-safe-restore.mjs`), the quarantine restore of the manual replacement, Recovery's waiting-source and deferred checks, the follow-up link and the TV paths. They keep `same` or `ctime-changed` only and may be widened later under this ADR, one by one, with their own tests.
- Recovery case IDs stay hashed from the identity recorded when the case started; this decision changes no case ID.
- The format of a file identity and of every stored record is unchanged. `installedSample` is an added field that older versions ignore.
