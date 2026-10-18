# User guide

This guide describes the current source. Choose English or Czech in the header; Czech is the initial default. Names below use the English interface, with Czech labels where helpful.

## Configure Review and Recovery

Open **Settings** and choose either **Configure Review** or **Configure Radarr**. Both open **Shared Review and Recovery settings**. Before the first managed activation, three steps guide connections, library mapping and Recovery limits. **Advanced options** contains database/report/executable paths, polling/stability/confirmation/decode timing, full-source hashing, terminal-header detection and the discovery cutoff. Preview-cache tuning remains separate.

1. Edit and choose **Save draft**. The shared server draft survives logout, language changes and restarts. It can be saved while services are offline; schema, frozen-registry and path-shape errors still reject it. Unsaved form values are local to the open dialog. A blank API-key input preserves the stored key; its value is never returned to the browser or saved in browser storage.
2. Choose **Test saved draft**. The read-only checks inspect connections, library bindings, paths and permissions. Save local edits before testing. Diagnostics never approve a repair, move media, request downloads or reconfigure Tdarr/Radarr.
3. Choose **Apply changes** explicitly. New Recovery operations stop being admitted; the current operation finishes and acknowledges the drain. Apply waits for Review's settings-safe state, revalidates, commits one complete configuration and restarts only Recovery. **Cancel pending apply** is available while waiting, draining or validating; there is no timeout force-kill. Closing the dialog does not cancel an accepted apply.

The dialog distinguishes **Saved draft**, **Active configuration** generation, actual Recovery mode/runtime and the apply stage. RECOVERY_MODE is informational here and remains an environment variable: Off never starts Recovery as a side effect of setup. A Review-only installation can leave optional Radarr/Recovery unconfigured in Off. Verify/Repair require their complete configuration. Review stays available if the new worker refuses startup; correct the draft and apply again. The active generation is not automatically rolled back to old paths or endpoints. Interrupted requests never resume automatically after a container restart; committed generations remain authoritative, and ambiguous activation keeps Recovery stopped until resolved.

Tdarr's remote source root, Review's local media root and Radarr's remote film root can differ. Recovery selects one of Review's source aliases. Manual Review replacement quarantine and automatic Recovery quarantine are independent. Imported duplicate connections/mappings require explicit choices; selecting a historical key happens on the server. Out-of-band file edits require reload and acknowledgement. A concurrent-edit conflict preserves your visible form but requires explicit reload/reconciliation; do not blindly overwrite another browser's draft.

New installations default to errors arising from completion of setup. Select a custom local date and explicitly acknowledge earlier history to inspect older jobs. Existing cutoffs are preserved. The private registry, approvedCaseIds and approvedImportRepairs remain file-only. Changes conflicting with actual frozen keys or disconnecting unfinished cases are refused; evidence/case migration is a separate procedure. The bounded **Change history** records time, action, result, changed field names and revisions, never credentials or registry contents.

Changing the public Review origin may prevent the old browser origin from polling the final stage. After a known commit the UI opens the new origin. If it cannot establish that stage, it preserves the last known apply status and offers **Open the configured address**; follow it to reconnect. It does not retry Apply or claim rollback.

## Review a film

In **Attention** (**Pozornost**), choose **Review** (**Posoudit**). The **Review** workspace loads the saved assessment of this exact original/result pair. Preparation and metadata, recovery and technical evidence remain available in the other detail tabs.

On a window at least 1200 CSS px wide the workspace uses the Kino layout: it fills the window, the five steps form a bar at the top and the comparison takes most of the height, with its time controls directly below. On a narrower window or at high browser zoom the compact layout with the step list is used. Switching between them only changes the layout; drafts, checks and the saved review are kept.

In the Kino layout the checks, the note and the decision buttons are in a panel beside the comparison. **Checks and decision** (**Kontroly a rozhodnutí**) opens or closes it, and **Focus on the picture** (**Soustředit se na obraz**) hides the panel and helper texts so the comparison gets more height. Both only change the layout and stay as you left them when you open another film; nothing is saved or confirmed by them. On narrower windows the panel stays below the comparison as before.

Ready status means the implemented matching and metadata checks permit a decision; approval also requires a completed saved manual review. It does not automatically state that compression looks good. Tdarr should already have completed the appropriate health check. Review does not perform another full decode during approval.

Work through the five steps. Confirmations appear alongside the tools during comparison; the final screen does not replace these checks.

| Step | What to do |
| --- | --- |
| **Preparation** (**Podklady**) | Choose **Tools in Review** or **Your player / TV**, select matching original/result audio tracks and check the files, sizes and durations. Confirm that you are comparing the correct original and this result. |
| **Picture** (**Obraz**) | Compare video and sound for moving content, or switch to full-resolution static frames and 1:1 viewing for details. Confirm that the picture is acceptable. For HDR/Dolby Vision, also confirm native playback on a named suitable device. |
| **Audio** (**Zvuk**) | Listen to the selected pair, using the waveforms or headphone A/B as needed. Confirm that this pair is acceptable; it does not confirm every audio track. |
| **Synchronisation** (**Synchronizace**) | Select a useful dialogue/action section near the start, middle and end. For each section, assess sound against picture, check the corresponding box and choose **Save start check**, **Save middle check** or **Save end check**. Save all three before continuing. |
| **Decision** (**Rozhodnutí**) | Inspect the saved method, device, confirmations and section times. Open the separate final approval dialog only when you are ready to replace the original. |

Use **Save and continue** (**Uložit a pokračovat**) after confirming each step. If something is missing, activate the same button to see the specific requirements in an accessible message. It lists only the missing conditions for that step, including a named device for HDR/Dolby Vision, manual confirmations, valid audio tracks or individually saved synchronisation checkpoints. It also explains temporary action, changed-file or revision blocks. This explanatory activation does not save or advance the review. Previously reached steps can be reopened. Loading frames, downloading a file or playing a clip never checks a box automatically. A preview, correlation estimate or technical score is not a substitute for your assessment.

## Save, defer and resume

**Save draft review** stores progress on the server for later reopening. The browser also keeps an unsaved draft within the current tab session, tied to the same file snapshot and server revision. Unsaved changes do not qualify for approval. In the synchronisation step, a general progress save does not replace the three individual checkpoint saves.

Use **Defer review** (**Odložit posouzení**) when something remains uncertain. Enter a note with the reason and next task, such as checking the final dialogue on the TV. Deferral saves progress, keeps both files and appears in the film list. Approval remains blocked while deferred, even if the checkboxes had already been completed. Reopen the film and explicitly save continued progress to resume.

Each saved picture/audio/synchronisation observation retains its method, device, selected track pair, section time and server timestamp. Choosing a later section does not relabel an earlier saved observation. External observations may have no section timestamp; this is displayed explicitly. These are records of your confirmations, not evidence that the entire film was watched.

Changing the track pair clears audio and all three synchronisation checks. Changing review method or device clears all checks. A changed file snapshot requires a new review. If another window saves a newer revision, choose **Load saved state** rather than overwriting it; an already-open approval confirmation must be reconsidered against the current saved revision.

## Use your own player or TV

Choose **Your player / TV** in Preparation if you have already checked this exact Review result or prefer external playback. Name the device/player with at least two characters after trimming surrounding whitespace, select the matching audio pair and confirm the same five steps. Review loads track information but does not generate browser clips in this mode. The three synchronisation checkpoints still require separate explicit saves.

HDR/Dolby Vision requires a separate confirmation on a suitable named device even when the other tools are used in Review. This requirement comes from the current video metadata, not from a browser playback result. Watching only the original or a different historical copy does not confirm the current result. Check native HDR, multichannel sound and subtitle rendering in a player that supports them.

## Compare picture and sound

Picture comparison requests a PNG from both files at the same time. Zoom/pan helps inspect compression. HDR previews use a consistent conversion to SDR; compare native HDR playback on a suitable display separately. Different edits may show different frames at the same timestamp.

The **Video and audio** tool prepares actual 12-second H.264/mono AAC clips of both files. Picture starts with a Detail preview bounded to 1920 × 1080; Synchronisation starts with the lighter Compact preview bounded to 960 × 540. Both are newly encoded samples rather than native-quality copies. The default **Wipe comparison** uses one larger picture with a movable divider: original on the left, conversion on the right. Drag it, use its range control, or explicitly enable automatic movement between 25% and 75% while playing. Pausing stops the movement and manual input disables automatic movement. **Side by side** remains available. Shared play/pause and seek controls, a waveform cursor and sound switching help compare the same section. Only one copy is audible at a time. Step while paused to examine a visible event; frame stepping uses the original's average frame rate and is approximate for variable-frame-rate video. The player reports when it resynchronises the two browser players.

The preview converts supported HDR to SDR. It cannot demonstrate native HDR fidelity, the original resolution, surround sound or codec transparency. The start/middle/end presets help find sections; choose visible speech or a useful sound event rather than assuming a percentage proves those scenes were checked.

Audio comparison explicitly selects an original and converted stream. Choose the same language and version: main dialogue, dubbing and commentary are not interchangeable. Waveforms and cross-correlation estimate alignment for that selected pair and section. Even zero offset between tracks does not establish lip synchronisation; both copies could have the same offset against their pictures.

Headphone A/B prepares the same 12-second window as mono PCM at 48 kHz. It plays the original into the **left** ear, then the conversion into the **right** ear, with a gap and shared playback gain. It does not independently normalise the signals or align them automatically. It is an audition aid, not a multichannel listening test.

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

A completed server-saved review enables the approval button in Decision, provided the file and operational checks also allow approval. Review checks the current snapshot, checklist version and review revision on the server; a direct request cannot bypass the review gate. Inspect the separate final confirmation: approval replaces the original and removes its former version.

Review revalidates file identities, prevents concurrent actions, pauses new Tdarr dispatch and checks that the same film is not being processed. It copies the result into the original directory, verifies SHA-256, then exchanges the files through a durable transaction. It rescans the affected Tdarr entry and resumes nodes it recorded as initially unpaused. A manual node pause applied during the action can be undone by that resume; see [the maintenance pause procedure](OPERATIONS.md#manual-tdarr-node-pauses-during-a-review-action). The confirmed review is recorded with the decision history.

Plex uses the resulting file in its existing library directory. If your server does not automatically detect the change, run a Plex library scan. There is no Plex API integration in this release.

Batch selection includes only normally approvable results with individually completed current reviews. Each film in the overview shows its review state with text and an icon: ready to review, review in progress, review completed, review deferred, duration difference (approve individually) or technically blocked. In selection mode ("Select") the bar states how many shown films can be selected, and every film that cannot be selected has a "Why can't I select it?" disclosure naming the missing condition or blocker, with "Open review" when the film's own review resolves it. Opening an explanation never changes a review or a decision. Whole-batch preflight checks every file snapshot and review revision before starting any film; one incomplete, stale or blocked selection prevents the start. A batch confirmation does not supply missing individual checks. The server then processes films sequentially and rechecks identities per film. Ordinary per-film errors are recorded; an uncertain transaction or un-restored node pause stops further work. Closing the browser does not stop the batch. After an application restart, an unfinished batch is not blindly replayed.

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

The optional automatic Recovery worker is stricter: it must independently confirm a recognised decoding error in the **original** twice before requesting a replacement. Permissions, network, disk I/O, timeout and generic encoder errors are not sufficient. An unacceptable transcode or uncertain waveform correlation does not itself prove that the original is damaged.

If automatic Recovery finds no suitable release, it can preserve a quarantined original link/copy back in the library, hold that edition out of Tdarr and search again after six hours. Review displays the exclusion, next search and a Radarr link for independent searching. The manual Review-request workflow does not currently perform that same automatic restore/search loop.

When Recovery returns the original as a hardlink, the library path and quarantine path name the same file (`nlink = 2`). If a Review result exists for that edition, it is **Blocked** with **The file is not a regular file or has multiple hard links.** (**Soubor není běžný soubor nebo má více pevných odkazů.**). This is the expected file protection: the preserved edition remains excluded from Tdarr, and Review requires one hardlink for both files before approval. A completed manual checklist cannot bypass it. An exclusive-copy fallback has separate files and does not fail this particular hardlink check; it still remains held by Recovery and all other Review checks apply.

Keep the quarantine and recorded library link/copy intact. Recovery validates both before removing only its recorded library path when a suitable release is found; the protected original stays in quarantine. Let that recovery continue or inspect its case if it reports an error. A distinct imported replacement can enter its own Tdarr/Review workflow. Do not remove the quarantine link, fabricate identity evidence or release the faulty edition's Hold merely to enable approval.

Do not interpret `replacement_imported` as approved. Watch the Tdarr state, complete the new result's own Review checklist, then approve it. Quarantine becomes eligible for cleanup seven days after that explicit identified approval.

In **Verify**, an in-flight repair is paused and the Recovery detail says which step waits and whether the original is in the library or in quarantine. If a paused replacement request keeps the original outside the library for more than 24 hours, the case appears under **Needs attention** (**Vyžaduje zásah**) with a red notice: a replacement download probably hangs in Radarr. Remove that download in Radarr; Recovery then returns the original to the library on its next poll ([Operations](OPERATIONS.md#original-outside-the-library-for-over-24-hours)).

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
