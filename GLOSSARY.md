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

**TV library**:
The optional second library Review knows about, with its own media, result and retained-original quarantine paths, Tdarr library and Sonarr root. Its items, reviews and decisions are separate from movie IDs and records.
_Avoid_: TV plan (that is only its saved settings), series library

**Discovery mode**:
The `libraries.tv.mode` value `discovery`. Review scans and shows TV results read-only; it never approves, rejects, installs or retains one.
_Avoid_: strict review

**Strict TV review**:
An explicit manual assessment and decision for one exactly bound supported TV source/result pair. Installation is a separate action and keeps the original in TV quarantine.
_Avoid_: automatic approval, batch review

**Retained TV original**:
The verified original copy kept in the dedicated TV quarantine after installation, with its durable transaction record.
_Avoid_: backup (which could imply temporary retention)

**Bound TV result**:
A TV result whose receipt names a successful Tdarr job in the TV library, whose source maps exactly through the TV source paths, whose files still match the receipt and for which Sonarr has exactly one episode file with its episodes. Nothing is guessed from names.
_Avoid_: matched, linked, approved

**Unbound TV result**:
A TV result missing any of that, shown with a fixed reason and eligible for nothing. When Sonarr could not verify the binding, the result is shown as binding not verified and is not treated as bound either.
_Avoid_: failed, rejected, orphan

