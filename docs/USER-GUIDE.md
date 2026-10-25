# User guide

This guide describes the current source. Choose English or Czech in the header; Czech is the initial default. Names below use the English interface, with Czech labels where helpful.

## Configure Review and Recovery

Open **Settings** and choose either **Configure Review** or **Configure Radarr**. Both open **Shared Review and Recovery settings**. Before the first managed activation, three steps guide connections, library mapping and Recovery limits. **Advanced options** contains database/report/executable paths, polling/stability/confirmation/decode timing, full-source hashing, terminal-header detection and the discovery cutoff. Preview-cache tuning remains separate.

1. Edit and choose **Save draft**. The shared server draft survives logout, language changes and restarts. It can be saved while services are offline; schema, frozen-registry and path-shape errors still reject it. Unsaved form values are local to the open dialog. A blank API-key input preserves the stored key; its value is never returned to the browser or saved in browser storage.
2. Choose **Test saved draft**. The read-only checks inspect connections, library bindings, paths and permissions. Save local edits before testing. Diagnostics never approve a repair, move media, request downloads or reconfigure Tdarr/Radarr.
3. Choose **Apply changes** explicitly. New Recovery operations stop being admitted; the current operation finishes and acknowledges the drain. Apply waits for Review's settings-safe state, revalidates, commits one complete configuration and restarts only Recovery. **Cancel pending apply** is available while waiting, draining or validating; there is no timeout force-kill. Closing the dialog does not cancel an accepted apply.

**What Apply clears.** Test also reports what applying the tested draft would clear, compared with the configuration Review runs with now. **Apply changes** is available only after a Test of the current saved draft, and sends that report with the request.

| Changed Review settings | Apply clears |
| --- | --- |
| Only the installation name, the public Review address, Radarr settings or Recovery-only settings (or nothing) | Nothing |
| The FFmpeg program | Only the prepared samples; saved reviews and **Approve** decisions stay |
| Anything else: paths and source paths, review subfolders, the Tdarr address, database or library, the FFprobe program | Saved reviews, **Approve** decisions, the film list and prepared samples (the number of films is shown) |

When Apply starts, Review compares again. If applying would now clear more than the Test showed, Apply stops before changing anything and asks for a new Test. Films reviewed between Test and Apply are cleared as well, and the history records both the counts Test showed and the counts Apply cleared.

The dialog distinguishes **Saved draft**, **Active configuration** generation, actual Recovery mode/runtime and the apply stage. RECOVERY_MODE is informational here and remains an environment variable: Off never starts Recovery as a side effect of setup. A Review-only installation can leave optional Radarr/Recovery unconfigured in Off. Verify/Repair require their complete configuration. Review stays available if the new worker refuses startup; correct the draft and apply again. The active generation is not automatically rolled back to old paths or endpoints. Interrupted requests never resume automatically after a container restart; committed generations remain authoritative, and ambiguous activation keeps Recovery stopped until resolved.

Tdarr's remote source root, Review's local media root and Radarr's remote film root can differ. Recovery selects one of Review's source aliases. Manual Review replacement quarantine and automatic Recovery quarantine are independent. Imported duplicate connections/mappings require explicit choices; selecting a historical key happens on the server. Out-of-band file edits require reload and acknowledgement. A concurrent-edit conflict preserves your visible form but requires explicit reload/reconciliation; do not blindly overwrite another browser's draft.

New installations default to errors arising from completion of setup. Select a custom local date and explicitly acknowledge earlier history to inspect older jobs. Existing cutoffs are preserved. The private registry, approvedCaseIds and approvedImportRepairs remain file-only. Changes conflicting with actual frozen keys or disconnecting unfinished cases are refused; evidence/case migration is a separate procedure. The bounded **Change history** records time, action, result, changed field names and revisions, never credentials or registry contents.

Changing the public Review origin may prevent the old browser origin from polling the final stage. After a known commit the UI opens the new origin. If it cannot establish that stage, it preserves the last known apply status and offers **Open the configured address**; follow it to reconnect. It does not retry Apply or claim rollback.

## Review a film

In **Attention** (**Pozornost**), choose **Review** (**Posoudit**). The **Review** workspace loads the saved assessment of this exact original/result pair. Preparation and metadata, recovery and technical evidence remain available in the other detail tabs.

On a window at least 1200 CSS px wide the workspace uses the Kino layout: it fills the window and the comparison takes most of the height, with its time controls directly below. On a narrower window or at high browser zoom the compact layout is used. Switching between them only changes the layout; drafts, checks and the saved review are kept.

In the Kino layout a film strip at the bottom of the review lists the films of the overview (with the current search) and their states. Choose a film there, or move along the strip with the arrow keys, Home and End, to switch without closing the review. Unsaved changes of the film you leave stay as its draft in this browser tab and come back when you return to it (the strip marks it **Unsaved changes**); nothing is saved or confirmed by switching, and checks never carry over to another film. If the saved review changed meanwhile in another session, the older draft is not restored.
In the Kino layout the checks, the note and the decision buttons are in a panel beside the comparison. **Checks and decision** (**Kontroly a rozhodnutí**) opens or closes it, and **Focus on the picture** (**Soustředit se na obraz**) hides the panel and helper texts so the comparison gets more height. Both only change the layout and stay as you left them when you open another film; nothing is saved or confirmed by them. On narrower windows the panel stays below the comparison as before.

Ready status means the implemented matching and metadata checks permit a decision; approval also requires a completed saved manual review. It does not automatically state that compression looks good. Tdarr should already have completed the appropriate health check. Review does not perform another full decode during approval.

The guided in-app comparison is the default media-first workflow. It uses one shared track pair, three excerpt times and a clear phase sequence. Playback never marks anything confirmed. The older separate-step flow remains available for **Your player / TV** and external review.

| Step | What to do |
| --- | --- |
| **Guided comparison** | Choose matching tracks and three useful excerpt times. Default headphone routing plays Original in the left ear, Together (original left + result right), then result in the right ear. Across three excerpts this is nine phases, up to 108 seconds at 12 seconds per phase. Optional Sequential mode plays Original then result for each excerpt: six phases, up to 72 seconds. Ear swap is optional. |
| **Manual confirmations** | Review preparation, picture, audio and each synchronisation excerpt yourself. Select the explicit checkboxes; playback and completion never check them. HDR/Dolby Vision also needs separate confirmation of native playback on a named suitable device. |
| **Save observations** | One explicit action saves confirmations together with method, device, track pair, routing and excerpt times. Each synchronisation observation is bound to its actual excerpt time. Server revision checks protect concurrent edits; a conflict stops further writes and keeps remaining work as a draft. |
| **Decision** (**Rozhodnutí**) | Inspect the saved method, device and confirmations. Open the separate final approval dialog only when you are ready to replace the original. |

Use **Save observations** only after confirming each area yourself. If something is missing, the interface explains the requirements without saving. The server uses compare-and-swap revision checks. If a save conflicts after some observations were accepted, those records remain and the rest stay as an unsaved draft. Loading frames, downloading a file or playing/completing a clip never checks a box automatically. A preview, correlation estimate or technical score is not a substitute for your assessment.

## Save, defer and resume

**Save draft review** stores progress on the server for later reopening. The browser also keeps an unsaved draft within the current tab session, tied to the same file snapshot and server revision. Unsaved changes do not qualify for approval. In the guided workflow, the single explicit save records the confirmations and all three excerpt-scoped synchronisation observations together.

Use **Defer review** (**Odložit posouzení**) when something remains uncertain. Enter a note with the reason and next task, such as checking the final dialogue on the TV. Deferral saves progress, keeps both files and appears in the film list. Approval remains blocked while deferred, even if the checkboxes had already been completed. Reopen the film and explicitly save continued progress to resume.

Each saved picture/audio/synchronisation observation retains its method, device, selected track pair, comparison mode/routing, excerpt times and server timestamp. Choosing a later section does not relabel an earlier saved observation. External observations may have no section timestamp; this is displayed explicitly. These are records of your confirmations, not evidence that the entire film was watched.

Changing the track pair or guided comparison context invalidates affected picture, audio and synchronisation checks. Changing review method or device clears all checks. A changed file snapshot requires a new review. If another window saves a newer revision, choose **Load saved state** rather than overwriting it; an already-open approval confirmation must be reconsidered against the current saved revision.

## Use your own player or TV

Choose **Your player / TV** if you have already checked this exact Review result or prefer external playback. Name the device/player with at least two characters after trimming surrounding whitespace, select the matching audio pair and use the separate-step decision flow. Review loads track information but does not generate browser clips in this mode. The three synchronisation checkpoints still require explicit saves.

HDR/Dolby Vision requires a separate confirmation on a suitable named device even when the other tools are used in Review. This requirement comes from the current video metadata, not from a browser playback result. Watching only the original or a different historical copy does not confirm the current result. Check native HDR, multichannel sound and subtitle rendering in a player that supports them.

## Compare picture and sound

Picture comparison requests a PNG from both files at the same time. Zoom/pan helps inspect compression. HDR previews use a consistent conversion to SDR; compare native HDR playback on a suitable display separately. Different edits may show different frames at the same timestamp.

Fit, Stretch and Fill are local browser preferences applied equally to both images. The floating toolbar can be docked or hidden; keyboard shortcuts act only while the player is focused. Space/K toggles playback, arrows seek, M mutes, F toggles fullscreen, H hides/restores controls, ? opens help, brackets select excerpts, R repeats, and S stops. Escape closes help or focus/fullscreen mode before returning focus to manual confirmations. Native range controls remain available for seeking and volume.

Guided comparison prepares bounded 12-second excerpts from both files. In Guided ears, each excerpt has three phases: Original in the left ear, Together with original left and result right, then result in the right ear. Three excerpts make nine phases, up to 108 seconds of sampled audio. Optional Sequential mode has two phases per excerpt and totals up to 72 seconds. Ear swap reverses headphone routing. The workspace shares the selected pair, excerpt times and routing across its media tools. It visibly pauses when video is waiting, errors, or the browser suspends media; resuming or retrying is explicit. It does not silently normalize audio or align offsets.

The preview converts supported HDR to SDR. It cannot demonstrate native HDR fidelity, the original resolution, surround sound or codec transparency. The start/middle/end presets help find sections; choose visible speech or a useful sound event rather than assuming a percentage proves those scenes were checked.

Audio comparison explicitly selects an original and converted stream. Choose the same language and version: main dialogue, dubbing and commentary are not interchangeable. Waveforms and cross-correlation estimate alignment for that selected pair and section. Even zero offset between tracks does not establish lip synchronisation; both copies could have the same offset against their pictures.

Guided audio uses mono PCM at 48 kHz. It does not independently normalise the signals or align offsets automatically. It is an audition aid, not a multichannel listening test.

Technical data still shows the evidence score: job matching (10), proven full Tdarr health check (25), video parameters (15), duration (15), tracks (15), chapter count (5), and sampled audio alignment (15). Failed and unknown markers remain visible; unknown contributes zero. A score of 100 does not complete the review or guarantee visual quality or lip synchronisation.

## Why a film is blocked

If a replacement was interrupted and Review cannot prove that it is safe to roll back, **Attention** shows a panel "An unfinished exchange needs manual inspection" with the film, the phase and the reason. Approvals, rejections and batches stay blocked until the exchange record is inspected by hand ([Operations](OPERATIONS.md#unresolved-exchange-transaction)). The panel offers no repair action.

Review only offers approval for a result produced by one of the supported transcode profiles. The rules are intentionally strict: a result that does not match them may have lost picture, HDR metadata, audio or subtitles, so the film is shown as blocked and the original stays untouched. The blocked reason names the check that failed.

| Check | Rule | Example message |
| --- | --- | --- |
| Video tracks | The original and the result each have exactly one video track (cover art is ignored). | *The result does not have exactly one video track. Video tracks: 2* |
| Original codec | The original is `h264`, `hevc`, `vc1` or `mpeg2video`. | *The original's codec is not supported (allowed: h264, hevc, vc1 and mpeg2video): av1* |
| Result codec | The result is HEVC. | *The result is not HEVC: h264* |
| Pixel format | The result is 10-bit `yuv420p10le`. | *The result does not use the 10-bit pixel format yuv420p10le: yuv420p* |
| Resolution | The result has exactly the original's width and height; nothing is scaled or cropped. | *The result's resolution differs from the original (result / original): 1280×720 / 1920×1080* |
| Profile marker | An HEVC original needs a result tagged by an allowed profile: `TDARR_HDR_PROFILE` = `tdarr-hdr10-crf21-v1`, `tdarr-hdr10plus-crf21-v1`, `tdarr-dv81-crf21-v1`, `tdarr-dv81-hdr10plus-crf21-v1` or `tdarr-dv7-video-copy-v1`, or `TDARR_SDR_PROFILE` = `tdarr-hevc-sdr-crf21-v1`. A `vc1`/`mpeg2video` original needs the legacy SDR profile (`tdarr-legacy-sdr-crf21-v1`, progressive 1080p SDR only). An original that already carries an HDR profile marker has been converted before and is blocked. | *The HEVC result was not produced by an allowed HDR profile.* |
| Profile metadata | Each profile then compares its own metadata: HDR10 mastering/content light levels, HDR10+ and Dolby Vision presence, SDR colour properties, frame rate and field order. | Message of the failed profile check |
| Audio | The result has at least one audio track. | *The result contains no audio.* |
| Audio and subtitles | Every audio and subtitle track in the result exists in the original with the same codec, channel count and language. Tracks may be removed (they are listed as removed in the technical data), but not added or changed. | *Audio or subtitles do not match the original.* |
| Chapters | The result has the same number of chapters as the original. | *The chapter count does not match.* |
| Duration | Both durations can be read. A difference of more than 0.01 % does not block the film but requires explicit acceptance at approval. | *The movie duration cannot be verified.* |

If a film is blocked by one of these rules, check the Tdarr flow and plugin settings for that film rather than the review itself. Reject the result if it cannot be fixed; the original remains in the library.

## Approve

While a film is being replaced (alone or in a batch), you can keep reviewing other films: open them, compare picture and sound and save your checks, notes and approvals. The film being replaced, and films still waiting in the batch, show that they are locked until their replacement finishes. If you confirm **Approve and replace** for another film meanwhile, it is queued and replaced after the running replacement ends, one film at a time; repeating the confirmation adds nothing. A queued film is locked like the one being replaced. Before its turn its files and review are checked again; if they changed, it is not replaced and both files stay. Rejections and batches still wait until the running replacement ends. After a restart, queued replacements are not started by themselves: Attention lists them as interrupted, and you confirm them again if you still want them.

Decision offers two separate actions:

- **Approve** (**Schválit**) records your decision for exactly this pair of files and this saved review, and returns to the overview. Nothing is copied, moved or deleted and no replacement is scheduled. The film shows **Approved · waiting for replacement** (**Schváleno · čeká na nahrazení**) and survives a restart. Saving the review again or any change of the files makes the approval stale; the film then needs a new decision.
- **Approve and replace** (**Schválit a nahradit**) opens the replacement confirmation described below. Cancelling that dialog or closing the detail records nothing.

A film with an allowed duration difference is decided individually with **Approve and replace** only.

A completed server-saved review enables the approval buttons in Decision, provided the file and operational checks also allow approval. Review checks the current snapshot, checklist version and review revision on the server; a direct request cannot bypass the review gate. Inspect the separate final confirmation: approval replaces the original and removes its former version.

Review revalidates file identities, prevents concurrent actions, pauses new Tdarr dispatch and checks that the same film is not being processed. It copies the result into the original directory, verifies SHA-256, then exchanges the files through a durable transaction. It rescans the affected Tdarr entry and resumes nodes it recorded as initially unpaused. A manual node pause applied during the action can be undone by that resume; see [the maintenance pause procedure](OPERATIONS.md#manual-tdarr-node-pauses-during-a-review-action). The confirmed review is recorded with the decision history.

Plex uses the resulting file in its existing library directory. If your server does not automatically detect the change, run a Plex library scan. There is no Plex API integration in this release.

Batch selection (**Select**) includes only films explicitly approved with **Approve** for their current review; a completed but undecided review needs its own decision first. **Replace selected approved films** asks for explicit confirmation; the server checks the approvals when the batch starts and, as before, each film's snapshot and review revision before its replacement. Each film in the overview shows its review state with text and an icon: ready to review, review in progress, review completed, review deferred, duration difference (approve individually) or technically blocked. In selection mode ("Select") the bar states how many shown films can be selected, and every film that cannot be selected has a "Why can't I select it?" disclosure naming the missing condition or blocker, with "Open review" when the film's own review resolves it. Opening an explanation never changes a review or a decision. Whole-batch preflight checks every file snapshot and review revision before starting any film; one incomplete, stale or blocked selection prevents the start. A batch confirmation does not supply missing individual checks. The server then processes films sequentially and rechecks identities per film. Ordinary per-film errors are recorded; an uncertain transaction or un-restored node pause stops further work. Closing the browser does not stop the batch. After an application restart, an unfinished batch is not blindly replayed.

## Reject or recheck

Rejection does not require completing the checklist. It requires a separate reason, recorded before removing only the Review result. The original is kept. Historical rejections without a recorded reason cannot be reconstructed.

Some duration mismatches can be rechecked/remuxed or explicitly assessed individually. The completed checklist does not bypass the duration rule: a permitted exception requires its own explicit final acceptance and a check of the beginning, ending and synchronisation. It is not applied indiscriminately to batch approvals. Do not use it to hide a different edit or missing content.

### Files changed since queueing

If the original or the result changed after the film was queued, the film is blocked and **Review** opens a verification step instead of the checklist:

- **Only the metadata change time (ctime) changed**: choose **Verify the files and start a new review** (**Ověřit soubory a začít nové posouzení**). Review checks that the Tdarr job is still the same, that FFprobe reports the same technical data, and that neither file changes while it runs. This does not prove equal content, so earlier confirmations and decisions never carry over: after success the review starts again from the first step. If anything differs, the film stays blocked with the reason.
- **Only the device changed** (a remount): **Recheck files** compares the remaining file details.
- **Anything else** (size, content time, inode): it cannot be verified in Review. Both files are kept; inspect them by hand.

Each successful verification is written to the event log as `item.reverified` with the previous snapshot and what changed.

After a completed approval/rejection, Review removes its matching receipt and empty directories. It does not recursively delete unrelated contents or follow symlinks.

## Ask Radarr for a replacement

Configure Radarr first. In the film's recovery panel, enter the reason and confirm the request. Review preserves both the original and current result in quarantine, excludes the original release title and requests the same or higher permitted quality. This temporarily removes that copy from the library so Radarr can consider an equal-quality replacement.

A confirmed faulty original that Recovery could not bind to its Radarr release (**Faulty original without a release binding**) has no Review result to reject. Its case offers **Request another copy through Radarr** on the Recovery tab instead: the same request, but only the original moves to quarantine. The offer disappears when the original changes or a request for the case is open; see [Operations](OPERATIONS.md#faulty-original-without-a-release-binding).

The optional automatic Recovery worker is stricter: it must independently confirm a recognised decoding error in the **original** twice before requesting a replacement. Permissions, network, disk I/O, timeout and generic encoder errors are not sufficient. An unacceptable transcode or uncertain waveform correlation does not itself prove that the original is damaged.

If automatic Recovery finds no suitable release, it can preserve a quarantined original link/copy back in the library, hold that edition out of Tdarr and search again after six hours. Review displays the exclusion, next search and a Radarr link for independent searching. The manual Review-request workflow does not currently perform that same automatic restore/search loop.

When Recovery returns the original as a hardlink, the library path and quarantine path name the same file (`nlink = 2`). If a Review result exists for that edition, it is **Blocked** with **The file is not a regular file or has multiple hard links.** (**Soubor není běžný soubor nebo má více pevných odkazů.**). This is the expected file protection: the preserved edition remains excluded from Tdarr, and Review requires one hardlink for both files before approval. A completed manual checklist cannot bypass it. An exclusive-copy fallback has separate files and does not fail this particular hardlink check; it still remains held by Recovery and all other Review checks apply.

Keep the quarantine and recorded library link/copy intact. Recovery validates both before removing only its recorded library path when a suitable release is found; the protected original stays in quarantine. Let that recovery continue or inspect its case if it reports an error. A distinct imported replacement can enter its own Tdarr/Review workflow. Do not remove the quarantine link, fabricate identity evidence or release the faulty edition's Hold merely to enable approval.

Do not interpret `replacement_imported` as approved. Watch the Tdarr state, complete the new result's own Review checklist, then approve it. Quarantine becomes eligible for cleanup seven days after that explicit identified approval.

In **Verify**, an in-flight repair is paused and the Recovery detail says which step waits and whether the original is in the library or in quarantine. If a paused replacement request keeps the original outside the library for more than 24 hours, the case appears under **Needs attention** (**Vyžaduje zásah**) with a red notice: a replacement download probably hangs in Radarr. Remove that download in Radarr; Recovery then returns the original to the library on its next poll ([Operations](OPERATIONS.md#original-outside-the-library-for-over-24-hours)).

## Recovery cases that need attention

Each case under **Needs attention** (**Vyžaduje zásah**) says what happened, where the film is now and what you can do. The server works this out from fresh reads; the page only shows it.

### Return a preserved original

A `manual` Recovery case can offer **Restore only the original** (**Vrátit pouze původní soubor**) when Review can prove that the exact recorded original is still in quarantine, its original library path is empty, the same Radarr movie has no file or queued download, and Tdarr is not processing that source. Review asks you to confirm the original alone. Recovery previously marked it faulty, so it may still be damaged; restoring it does not mark it healthy, approve it, release a Tdarr Hold, change a Radarr profile or extend the quarantine deadline. Any changed file, uncertain history, busy worker, unreadable service, or occupied path blocks the action.

When Recovery is running, Review waits for its current operation to finish, stops that worker cleanly, installs and verifies the original at its exact empty path, then starts Recovery in the same Verify or Repair mode. Off stays Off. Across filesystems, Review keeps the quarantined source until a synced exclusive copy at the destination has been verified. Review never overwrites a newer library file or moves a Review result.

The panel shows progress and the saved outcome, including after a refresh or container restart. If the filesystem or worker outcome cannot be proven, Review keeps the operation blocked and the Recovery startup fence in place. Use **Reconcile the saved result** (**Ověřit uložený výsledek**) only after checking the displayed state; it verifies the existing journal and files and never repeats the move. Do not delete the restore journal or fence to clear the warning. When downgrading to an image without the restore protocol, keep Recovery Off and leave any pending restore journal or fence intact until returning to a compatible image; see [original-restore compatibility](ARCHITECTURE.md#reviews-explicit-original-restore).

- **Where the film is now** lists the library copy, the preserved copy in quarantine, a Review result waiting for assessment, the Tdarr state and the Radarr download. Each line is *verified* or *not verified*. A line that cannot be read is shown as not verified; that is never treated as proof of a fault or as permission to act.
- **What you can do** shows the recommended action first, on the card and in the first tab of the detail, then the other valid actions. Each says what it changes: **Refresh status** only reads Radarr, Tdarr and the library again; **Open the film in Radarr** and **Assess the result in Review** change nothing; **Request another copy through Radarr** starts work and **Return the original and transcode from quarantine** moves files, each after its own confirmation. The server checks every action again when you confirm it.
- **What blocks the next step** names what an administrator has to do, or why Review offers no action for this case yet.

For an import-blocked or failed-download case, Review can also show a Radarr diagnosis after you choose **Refresh status**. It checks the exact Recovery case and movie, then reads the movie and a complete bounded page of its queue from the effective Radarr connection. The result is one of: a language or quality mismatch, a pending download, an import problem, an unclear cause, or unavailable. A generic download failure remains unclear unless Radarr supplies explicit import evidence. Until that manual read succeeds, the diagnosis is unverified; opening the page does not contact Radarr. Review links to the exact movie only when Radarr confirms it, and the queue link opens the general Activity/Queue page. Use Radarr for full status messages and to resolve the issue. Review does not import, search, retry or remove anything.

### Hand a replacement to Tdarr

When Recovery has imported a replacement but Tdarr has no entry for it, Recovery does not try again. Review then reads Tdarr itself, and the case appears under **Needs attention** as **The replacement did not reach Tdarr**. It offers **Hand the replacement to Tdarr** (**Předat náhradu Tdarru**) when all of these hold:
- the file in the library is exactly the imported replacement and has not changed for 10 minutes;
- no Tdarr worker is processing it and Tdarr's history has no job for it since the import;
- the Tdarr library ID is set in the settings and Recovery is not in Verify mode.

A Hold in Tdarr always blocks the action, whether another case set it to protect the file or its origin is unknown. Review never releases a Hold; release it in Tdarr.

After its own confirmation, Tdarr rescans exactly that file and queues it by its own rules. Nothing in the library moves, the quarantine is kept, and the transcoded result still needs your approval. If Tdarr does not list the file afterwards, the handoff is shown as not confirmed. Check Tdarr; a new attempt asks you to confirm that you did.

A case Recovery gave up on during its own handoff is a manual case for an administrator. Review does not hand it over, because an approval would not start its quarantine cleanup.

### A failed or skipped transcode

When Tdarr ends the transcode of an imported replacement as *Transcode error*, or skips it as *Not required*, the case under **Needs attention** says what Review found. Review reads the Tdarr job report of the newest error job for that exact file and shows only the cause category. For decode damage it also shows the recognized decoder message, with numbers and addresses masked. Paths and the full report are never shown.

The cause category decides what you can do:
- **Decode damage** (the file cannot be decoded): no retry is offered. Recovery's own scan of the library opens its own case for the damaged file.
- **Operational problem** (permission, disk space, memory, I/O or network): a retry is offered.
- **Cause not recognized**: a retry is offered, and the case says that the cause was not recognized.
- **Report not readable**: the result is not verified and no retry is offered.

**Retry the transcode** (**Zkusit převod znovu**) queues the same file in Tdarr again, once for each replacement. It is offered only when all of these hold:
- the file in the library is exactly the recorded replacement, as a plain file with a single link;
- Tdarr still shows *Transcode error* for it, and the newest job for the file is that error job and ended after the import;
- no Tdarr worker is processing the file;
- the Tdarr library ID is set, Recovery's status can be read and Recovery is not in Verify mode;
- no other Review action is running.

Review first records its intent, then queues the file and reads Tdarr back. Only a read-back *Queued* or *Transcoding* state confirms the retry. If Tdarr does not confirm it, the retry is shown as uncertain. A new attempt then asks you to confirm that you checked Tdarr.

A retry does not count toward Recovery's daily repair limit. If the retried transcode fails too, no further retry is offered and the case says so; inspect the file in Tdarr. Nothing in the library moves and the quarantine is kept.

**Not required** cases get no retry, because Tdarr would skip the file again by the same rules. When Tdarr reports *Not required* for that exact file, and its history has a *Not required* decision after the import, the case offers **Assess the installed copy** (**Posoudit nainstalovanou kopii**) for the replacement itself. The assessment says that the copy was not transcoded. Approving it starts quarantine retention like any other installed copy. Restoring the original over the current copy is never offered.

### Assess an installed copy

Sometimes the transcoded result is already in the library, for example because it was approved before Review kept approval evidence, or because it was replaced outside Review. There is no Review pair to compare, so the quarantine never enters retention. When Review can verify all of the following, the case offers **Assess the installed copy** (**Posoudit nainstalovanou kopii**):

- Recovery imported the replacement and has no approval for it yet;
- the library holds one plain file in its place that is not the imported replacement itself;
- Tdarr reports *Transcode success* for that file and its history has a successful transcode of it after the import;
- no Review result waits for it and no other action is running.

If anything cannot be read, the action is not offered and the case says what blocks it. The assessment is also offered for a replacement that Tdarr skipped as *Not required*; see [A failed or skipped transcode](#a-failed-or-skipped-transcode).

The **Comparison** tab of the case then shows the assessment:
- **Only the copy now in the library is assessed.** The full original is not available for comparison: the replacement's source is gone, and the faulty original in quarantine is not used for comparison.
- **Approval does not prove that the transcode is faithful to the original,** only that the copy is acceptable to you.
- **Play the file in your own player.** Name the device, confirm the picture, the sound and the sync at the start, middle and end (and HDR for an HDR file), write a note and save. Opening or playing the file confirms nothing.

**Approve the current copy** (**Schválit aktuální kopii**) is available only for a saved, complete assessment, and asks for its own confirmation. The server then checks every condition again and writes the same approval evidence a Review approval writes. Recovery starts the usual quarantine retention at its next check. Nothing is transcoded, downloaded, copied or moved. If the file in the library changes, the saved assessment no longer applies. Such a case never offers to return the obsolete original over the current copy. If you do not accept the copy, leave the case open.

**Verify the status of all cases** (**Ověřit stav všech případů**) refreshes every case that needs attention the same read-only way. **Refresh list** only reloads the list. Neither changes a file, Tdarr, Radarr or a quarantine deadline.

A case whose remaining work continues in a verified follow-up case is listed once, as the follow-up; the earlier case moves to **Done** with a link. It returns to **Needs attention** if that link no longer holds.

## Recovery worker status

The **Recovery** view shows the worker's runtime state separately from its film cases. In the unified container, Recovery runs alongside Review; stopping or updating that container affects both.

| State | Meaning |
| --- | --- |
| **Off** | The supervisor does not start Recovery, or this installation has no runtime-state file. This alone needs no attention. |
| **Running** | The worker process has started. This does not prove that a case completed or that a replacement was approved. |
| **Restarting** | The worker exited unexpectedly and the supervisor is waiting before starting it again. |
| **Refused** | Startup checks stopped the worker. Correct the reported configuration or registry problem before restarting the container. |
| **Stopped** | Recovery stopped because Review exited or the container is shutting down. |

The reason explains the state: `crash` means an unexpected exit, `crash-loop` means repeated crashes, `review-exited` means Review stopped and `shutdown` means the container received a stop signal. Refusal reasons include `missing-config`, `mode-conflict`, `invalid-mode`, `registry-refused` and `unknown-refusal`. A refused worker, a crash loop or an unreadable runtime-state file needs operator attention. Check the container log for diagnosis; the UI never displays configuration values or arbitrary worker stderr through this status.

Before restarting or updating, wait for an original decode or a mutating Recovery phase to finish. Review shows a warning while such work is reported. If case information is stale or unavailable, refresh it and check the worker log before treating it as idle. An old runtime timestamp alone does not mean the worker stopped: runtime state is written on state changes, while film progress has its own freshness checks.

Transaction recovery handles Review's unfinished file-exchange transactions separately from Recovery. Those transactions still require inspection and block further changes. Recovery warnings also appear in the container health log without making Review unhealthy; see [Container health](OPERATIONS.md#container-health).

## Statistics

Savings are logical byte differences supported by completed jobs/transactions and current matching file sizes. The Review-approved figure is a subset of the library figure. Pending savings are potential savings, not already reclaimed space. Tdarr's global reported figure is separate and must not be added to overlapping Review/library totals.

Array free space can differ because of retained quarantine, pending cache files, hardlinks, filesystem allocation, parity/storage activity and unrelated writes. Missing history can undercount savings. Keep transaction/history files if you want the statistics to remain reproducible.
