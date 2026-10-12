# Interactive audio/video comparison

In a film's detail, open **Review** and follow **Preparation → Picture → Audio → Synchronisation → Decision**. Video comparison is embedded in Picture and Synchronisation: choose matching audio tracks and a start time, then **Compare video and audio**. Review prepares two actual 12-second clips of the same section. Left/right headphone A/B remains available in the Audio step.

## Wipe comparison and playback

The videos occupy one larger comparison surface with a **50% wipe** initially. Move the divider directly with a pointer, or use its range control with the keyboard, to reveal different portions of the original and transcode while they play. The wipe changes only what is visible; it does not change the selected files, clip time, sound selection or saved review confirmations.

**Automatic wipe** is off by default. When enabled, it sweeps between 25% and 75% and back to 25%, only while playback is running. Pausing stops its movement; the manual control remains available. Automatic wiping is a viewing aid and never checks a box or completes a review step.

Both videos share play/pause and a seek slider. Switch the audible copy during playback; only one plays audio at a time. Click a waveform to seek, or step while paused. Sound switching, seeking and frame stepping work independently of the wipe. Frame stepping uses average source frame rate and is approximate for variable-frame-rate video. A browser-player resynchronisation is shown explicitly.

Beginning/middle/end presets select approximately 2%, 50% and 95% of the available start-time range. Choose useful dialogue or visible sound-effect scenes yourself; a preset is not evidence that a region was checked. Confirm and save each synchronisation checkpoint at its own selected time. Playback or an automatic wipe never supplies those manual confirmations.

## Choose the preview profile

The profile is an explicit selection; both files use the same selected settings. Picture starts with **Detail**, while Synchronisation starts with **Compact**.

| Profile | Video settings | Intended use |
| --- | --- | --- |
| **Detail** | Fit within 1920 × 1080, H.264 `veryfast`, CRF 16 | A larger moving-image comparison with more retained detail than the compact preview |
| **Compact** | Fit within 960 × 540, H.264 `veryfast`, CRF 24 | Lighter preparation for dialogue/action synchronisation checks |

The fit limits both width and height, including portrait sources, preserves display aspect ratio and does not enlarge smaller content or crop it. Sample aspect ratio is accounted for when rasterising to square display pixels, so anamorphic sources retain their intended display shape. Audio is mono AAC in both profiles.

These are newly encoded previews, not native playback or lossless copies of either file. CRF controls the preview encode's quality rather than a guaranteed file size; see the [FFmpeg libx264 documentation](https://ffmpeg.org/ffmpeg-codecs.html#libx264_002c-libx264rgb). Detail can still hide or introduce compression differences, and 4K content is reduced to the bounded preview size. For fine compression detail, **full-resolution PNG frames at 1:1** remain available without an additional lossy video encode. Inspect motion and picture together, but validate native-resolution playback externally when that is needed for your decision.

PQ HDR receives the same SDR tone mapping on each side. Unsupported transfer functions, including HLG, produce an explicit error. Neither profile demonstrates native HDR/Dolby Vision fidelity, the spatial mix or codec transparency. Use a suitable external player/display for those checks, and record the required HDR/device confirmation in the review.

## Timing and waveform evidence

The waveform and correlation use source PCM envelopes in 10 ms bins, without independent loudness normalisation or automatic alignment. Correlation measures the difference between matching audio tracks, not whether the source itself is in sync with the picture. Ambiguous or silent samples do not produce a definitive offset. Original and transcoded waveforms share a cursor.

The preview subtracts the same container origin and requested time from audio and video timestamps. It never separately resets each stream with `STARTPTS`. Decoder priming, frame granularity and browser buffering limit precision. A shared playback position, wipe or zero correlation offset is not proof of correct lip synchronisation; assess speech or a visible sound event against the picture.

## Resource and identity limits

Both profiles retain the **12-second window, 90-second preparation timeout and 20 MiB output limit per video**. The two clips are prepared serially under the existing preview lock, with two decoder/encoder threads and one filter thread, plus bounded waveform extraction. Only one preview request runs at a time. Detail may take longer or reach the limits on complex/grainy material; the app reports the failure. It does not silently downgrade the profile or add a bitrate cap to disguise the quality change. Choose Compact explicitly for a lighter timing check, use full-resolution frames for detail, or review the files externally.

Preparation uses the authenticated endpoint, validates audio indexes and a complete 12-second window, and checks file snapshots before and after generation. No film is modified. Clips live in browser Blob URLs and are revoked when the comparison is destroyed or a new selection invalidates it. The server does not store clip files. Wipe controls operate on these already prepared clips and do not generate additional media or server I/O.

## Validation

`node tools/test.mjs` includes preview-argument/timestamp and player-control regressions. `tools/test-av-fixture.mjs` uses disposable generated media with a 5-second container origin and deliberately delayed audio. `tools/test-av-http.mjs` checks login, stale identity, invalid track/time, playable clips, waveforms and unchanged source hashes using a mock Tdarr. `tools/demo-av-preview.mjs` is an optional temporary UI smoke server using generated media only; do not expose it as a permanent service.
