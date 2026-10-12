# User guide

This guide describes **1.10.2**. Choose English or Czech in the header; Czech is the initial default. Names below use the English interface, with Czech labels where helpful.

## Review a film

In **Attention** (**Pozornost**), choose **Review** (**Posoudit**). The **Review** workspace loads the saved assessment of this exact original/result pair. Preparation and metadata, recovery and technical evidence remain available in the other detail tabs.

Ready status means the implemented matching and metadata checks permit a decision; approval also requires a completed saved manual review. It does not automatically state that compression looks good. Tdarr should already have completed the appropriate health check. Review does not perform another full decode during approval.

Work through the five steps. Confirmations appear alongside the tools during comparison; the final screen does not replace these checks.

| Step | What to do |
| --- | --- |
| **Preparation** (**Podklady**) | Choose **Tools in Review** or **Your player / TV**, select matching original/result audio tracks and check the files, sizes and durations. Confirm that you are comparing the correct original and this result. |
| **Picture** (**Obraz**) | Compare video and sound for moving content, or switch to full-resolution static frames and 1:1 viewing for details. Confirm that the picture is acceptable. For HDR/Dolby Vision, also confirm native playback on a named suitable device. |
| **Audio** (**Zvuk**) | Listen to the selected pair, using the waveforms or headphone A/B as needed. Confirm that this pair is acceptable; it does not confirm every audio track. |
| **Synchronisation** (**Synchronizace**) | Select a useful dialogue/action section near the start, middle and end. For each section, assess sound against picture, check the corresponding box and choose **Save start check**, **Save middle check** or **Save end check**. Save all three before continuing. |
| **Decision** (**Rozhodnutí**) | Inspect the saved method, device, confirmations and section times. Open the separate final approval dialog only when you are ready to replace the original. |

Use **Save and continue** (**Uložit a pokračovat**) after confirming each step. Previously reached steps can be reopened. Loading frames, downloading a file or playing a clip never checks a box automatically. A preview, correlation estimate or technical score is not a substitute for your assessment.

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

The **Video and audio** tool prepares actual 12-second H.264/mono AAC clips of both files, at most 960 px wide. Shared play/pause and seek controls, a waveform cursor and sound switching help compare the same section. Only one copy is audible at a time. Step while paused to examine a visible event; frame stepping uses the original's average frame rate and is approximate for variable-frame-rate video. The player reports when it resynchronises the two browser players.

The preview converts supported HDR to SDR. It cannot demonstrate native HDR fidelity, the original resolution, surround sound or codec transparency. The start/middle/end presets help find sections; choose visible speech or a useful sound event rather than assuming a percentage proves those scenes were checked.

Audio comparison explicitly selects an original and converted stream. Choose the same language and version: main dialogue, dubbing and commentary are not interchangeable. Waveforms and cross-correlation estimate alignment for that selected pair and section. Even zero offset between tracks does not establish lip synchronisation; both copies could have the same offset against their pictures.

Headphone A/B prepares the same 12-second window as mono PCM at 48 kHz. It plays the original into the **left** ear, then the conversion into the **right** ear, with a gap and shared playback gain. It does not independently normalise the signals or align them automatically. It is an audition aid, not a multichannel listening test.

Technical data still shows the evidence score: job matching (10), proven full Tdarr health check (25), video parameters (15), duration (15), tracks (15), chapter count (5), and sampled audio alignment (15). Failed and unknown markers remain visible; unknown contributes zero. A score of 100 does not complete the review or guarantee visual quality or lip synchronisation.

## Approve

A completed server-saved review enables the approval button in Decision, provided the file and operational checks also allow approval. Review checks the current snapshot, checklist version and review revision on the server; a direct request cannot bypass the review gate. Inspect the separate final confirmation: approval replaces the original and removes its former version.

Review revalidates file identities, prevents concurrent actions, pauses new Tdarr dispatch and checks that the same film is not being processed. It copies the result into the original directory, verifies SHA-256, then exchanges the files through a durable transaction. It rescans the affected Tdarr entry and restores only node pauses it owns. The confirmed review is recorded with the decision history.

Plex uses the resulting file in its existing library directory. If your server does not automatically detect the change, run a Plex library scan. There is no Plex API integration in this release.

Batch selection includes only normally approvable results with individually completed current reviews. Whole-batch preflight checks every file snapshot and review revision before starting any film; one incomplete, stale or blocked selection prevents the start. A batch confirmation does not supply missing individual checks. The server then processes films sequentially and rechecks identities per film. Ordinary per-film errors are recorded; an uncertain transaction or un-restored node pause stops further work. Closing the browser does not stop the batch. After an application restart, an unfinished batch is not blindly replayed.

## Reject or recheck

Rejection does not require completing the checklist. It requires a separate reason, recorded before removing only the Review result. The original is kept. Historical rejections without a recorded reason cannot be reconstructed.

Some duration mismatches can be rechecked/remuxed or explicitly assessed individually. The completed checklist does not bypass the duration rule: a permitted exception requires its own explicit final acceptance and a check of the beginning, ending and synchronisation. It is not applied indiscriminately to batch approvals. Do not use it to hide a different edit or missing content.

After a completed approval/rejection, Review removes its matching receipt and empty directories. It does not recursively delete unrelated contents or follow symlinks.

## Ask Radarr for a replacement

Configure Radarr first. In the film's recovery panel, enter the reason and confirm the request. Review preserves both the original and current result in quarantine, excludes the original release title and requests the same or higher permitted quality. This temporarily removes that copy from the library so Radarr can consider an equal-quality replacement.

The optional automatic Recovery worker is stricter: it must independently confirm a recognised decoding error in the **original** twice before requesting a replacement. Permissions, network, disk I/O, timeout and generic encoder errors are not sufficient. An unacceptable transcode or uncertain waveform correlation does not itself prove that the original is damaged.

If automatic Recovery finds no suitable release, it can preserve a quarantined original link/copy back in the library, hold that edition out of Tdarr and search again after six hours. Review displays the exclusion, next search and a Radarr link for independent searching. The manual Review-request workflow does not currently perform that same automatic restore/search loop.

Do not interpret `replacement_imported` as approved. Watch the Tdarr state, complete the new result's own Review checklist, then approve it. Quarantine becomes eligible for cleanup seven days after that explicit identified approval.

## Statistics

Savings are logical byte differences supported by completed jobs/transactions and current matching file sizes. The Review-approved figure is a subset of the library figure. Pending savings are potential savings, not already reclaimed space. Tdarr's global reported figure is separate and must not be added to overlapping Review/library totals.

Array free space can differ because of retained quarantine, pending cache files, hardlinks, filesystem allocation, parity/storage activity and unrelated writes. Missing history can undercount savings. Keep transaction/history files if you want the statistics to remain reproducible.
