# Tdarr Review

Tdarr Review lets a person inspect and explicitly approve Tdarr transcodes before the original film files in a media library are replaced, and optionally repairs corrupted originals.

## Language

**Review**:
The product a user installs, and its web application where a person compares a Tdarr result with its original and decides about it.
_Avoid_: Review container (once Recovery ships inside it)

**Recovery**:
The optional, opt-in part of Review that automatically repairs a confirmed corrupted original through Radarr (verification, Tdarr hold, quarantine, re-download).
_Avoid_: recovery worker container, tdarr-recovery (as a separate product), repair

**Recovery mode**:
One of three explicitly chosen states of Recovery: **Off** (does not run; the default), **Verify** (confirms corrupted originals and changes nothing outside itself except the protective steps of in-flight repairs) or **Repair** (may act on a confirmed corruption).
_Avoid_: enabled/disabled, dry run

**In-flight repair**:
A repair that has already changed the library, Tdarr or Radarr and has not finished yet. In Verify it is paused: only its protective steps continue.
_Avoid_: running case, pending case (pending means a frozen approval)

**Protective step**:
A step of an in-flight repair that puts the original back into the library or keeps Tdarr from transcoding it again. Removing a film from the library, requesting a download, handing a file to Tdarr and purging quarantine are not protective.
_Avoid_: safe step

**Transaction recovery**:
Completing or rolling back an interrupted replacement after a restart, from its durable journal. A different concept from Recovery; never shorten it to "recovery".
_Avoid_: recovery

**Diagnostic export**:
An explicitly downloaded report of one Review case's known and unverified state at a point in time, with private information omitted. It is separate from service refresh, publication, human approval and quarantine management.
_Avoid_: log dump, approval evidence, health certificate

**Review binding**:
The settings that decide which Tdarr library, files and technical data a saved review refers to: the media, review and source roots, review subfolders, Tdarr review root, Tdarr library, Tdarr address and database, and FFprobe. Changing any of them invalidates saved reviews and Approve decisions.
_Avoid_: identity (that is file identity)

**File identity**:
The device, inode, size and modification times that show a file on disk is still the exact file that was checked, reviewed or recorded as evidence. A file whose identity no longer matches is never treated as the one that was checked; an unreadable recorded identity matches nothing.
_Avoid_: fingerprint, stamp, Recovery case ID (a different value derived from the path and the file identity by `caseId()` in `recovery/policy.mjs`)
