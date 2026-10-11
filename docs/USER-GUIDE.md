# User guide

## Review a film

In **Pozornost** (Attention), open **Posoudit** (Assess). The detail combines overview, comparison, recovery and technical information. Ready status means the implemented matching and metadata checks permit approval; it is not an automatic statement that compression looks good.

Inspect the video on your normal playback devices. Tdarr should already have completed the appropriate health check. Review does not perform another full decode during approval.

The evidence score sums passed markers: job matching (10), proven full Tdarr health check (25), video parameters (15), duration (15), tracks (15), chapter count (5), and sampled audio alignment (15). Failed and unknown markers remain visible; unknown contributes zero. A score of 100 is not a guarantee of visual quality or lip synchronization.

## Compare picture and sound

Picture comparison requests a PNG from both files at the same time. Preset points cover several positions in the film. Zoom/pan helps inspect compression. HDR previews use a consistent conversion to SDR; compare native HDR playback on a suitable display separately. Different edits may show different frames at the same timestamp.

Audio comparison explicitly selects an original and converted audio stream. Waveforms and cross-correlation estimate their alignment for the sampled section. A reliable offset is evidence about that selected pair and section; it does not check every track or whether speech matches lips.

Headphone A/B prepares the same 12-second window as mono PCM at 48 kHz. It plays the original into the **left** ear, then the conversion into the **right** ear, with a gap and shared playback gain. It does not independently normalize the two signals. This is an audition aid, not a full multichannel listening test.

## Approve

Choose approval and inspect the final confirmation. Review revalidates the snapshot and file identities, prevents concurrent actions, pauses new Tdarr dispatch and checks the same film is not being processed. It copies the result into the original directory, verifies SHA-256, then exchanges the files through a durable transaction. It rescans the affected Tdarr entry and restores only node pauses it owns.

Plex uses the resulting file in its existing library directory. If your server does not automatically detect the change, run a Plex library scan. There is no Plex API integration in this release.

Batch approval preflights the whole selection, then processes films sequentially. Ordinary per-film errors are recorded; an uncertain transaction or un-restored node pause stops further work. Closing the browser does not stop the server-side batch. After an application restart, an unfinished batch is not blindly replayed.

## Reject or recheck

Rejection requires a reason and records it before removing the Review result. The original is kept. Historical rejections without a recorded reason cannot be reconstructed.

Some duration mismatches can be rechecked/remuxed or explicitly assessed individually. A duration exception is not applied indiscriminately to batch approvals. Do not use it to hide a different edit or missing content.

After a completed approval/rejection, Review removes its matching receipt and empty directories. It does not recursively delete unrelated contents or follow symlinks.

## Ask Radarr for a replacement

Configure Radarr first. In the film's recovery panel, enter the reason and confirm the request. Review preserves both the original and current result in quarantine, excludes the original release title and requests the same or higher permitted quality. This temporarily removes that copy from the library so Radarr can consider an equal-quality replacement.

The optional automatic Recovery worker is stricter: it must independently confirm a recognized decoding error in the **original** twice before requesting a replacement. Permissions, network, disk I/O, timeout and generic encoder errors are not sufficient.

If automatic Recovery finds no suitable release, it can preserve a quarantined original link/copy back in the library, hold that edition out of Tdarr and search again after six hours. Review displays the exclusion, next search and a Radarr link for independent searching. The manual Review-request workflow does not currently perform that same automatic restore/search loop.

Do not interpret `replacement_imported` as approved. Watch the Tdarr state, assess the new result in Review, then approve it. Quarantine becomes eligible for cleanup seven days after that explicit identified approval.

## Statistics

Savings are logical byte differences supported by completed jobs/transactions and current matching file sizes. The Review-approved figure is a subset of the library figure. Pending savings are potential savings, not already reclaimed space. Tdarr's global reported figure is separate and must not be added to overlapping Review/library totals.

Array free space can differ because of retained quarantine, pending cache files, hardlinks, filesystem allocation, parity/storage activity and unrelated writes. Missing history can undercount savings. Keep transaction/history files if you want the statistics to remain reproducible.
