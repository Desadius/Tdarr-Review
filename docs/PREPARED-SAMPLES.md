# Prepared review samples

Review can prepare its normal picture, audio and synchronization samples before a user opens a waiting film. Preparation is a viewing convenience; it does not perform, confirm or save a user's assessment.

## What is prepared

For each eligible waiting film, the default video section is prepared first, followed by its waveform, headphone A/B audio, synchronization video and static frames. Both original and converted copies use the same selected time and track pair.

- Picture: Detail H.264 video and native PNG frames at the existing default and preset times.
- Audio: waveform and the existing sequential left/right mono PCM A/B sample at the default and 2%, 50% and 95% presets.
- Synchronization: Compact H.264/AAC video at those same clip times.
- Static frames: default time and 10%, 30%, 50%, 70% and 90% presets; the shared default clip time is also available for shorter files.

All video/audio samples remain 12 seconds long. Exact duplicate requests are combined. Other times, profiles or track pairs are generated when requested and can then be reused. The [video comparison limits](AV-COMPARISON.md) and external HDR/surround checks still apply.

Opening Picture or Synchronization loads already prepared video without starting playback. Audio loads the cached waveform and PCM, but creates its audio player and plays only after a user click. If a sample is still preparing, the page displays progress and checks its status periodically; closing the detail or changing the selection stops that polling. Nothing checks a box, advances a step, creates a review revision or changes the technical score as a consequence of background preparation or automatic loading.

Both dashboard layouts show a separate sample badge on each film: green check for a complete ready plan, blue progress for active preparation, neutral waiting/disabled and amber partial/needs attention. The count is ready artifacts out of the current plan, not the number of manual checks. Static frames alone cannot mark a film's picture/audio samples fully ready. Badges use text and distinct icons as well as color; their tooltip describes the preparation issue when one exists.

## Language preference

Open **Settings → Sample preparation**. Enter the preferred languages in order, then the fallback languages in order. Defaults are Czech (`ces`), followed by English (`eng`) and Slovak (`slk`). Common Czech, English, Slovak and Japanese shortcuts are supplied; standard language codes are supported and recognized aliases are canonicalized.

The proposed pair must correspond to main audio on both files, with matching language, codec/channels and unambiguous track titles. Commentary and audio description are excluded from automatic suggestions. A language present only on one side permits the next language in the configured order. If a requested language exists on both sides but its pairing is ambiguous, select the tracks manually; the app does not hide that ambiguity by choosing a different language. An optional switch allows another unambiguous common main language when all configured languages are absent.

A valid saved manual pair overrides the language preferences. A proposed pair populates only an unconfirmed draft and remains visible for inspection. These preferences select previews only; they never remove, retag or transcode movie audio tracks.

## Storage, load and cleanup

Defaults: automatic preparation enabled, up to **5 waiting films**, **4 GiB** on disk and **7 days** per artifact. Change these in the same menu. The cache lives privately under the existing `/data/preview-cache` mapping; no new mount, port or permission is required. It survives ordinary restarts.

There is one rendering job at a time. Linux background decoding and metadata reads use `nice 19` and best-effort `ionice 7`; the existing decoder thread and output-size/time limits remain bounded. A foreground request has priority and can interrupt/requeue background work. Approval, rejection, restoration and settings changes pause the background worker before mutations. Cache-only reads do not take the foreground-preview mutation lock.

A specific H.264 seek failure can retry once with 30 seconds of decoder preroll instead of 2. It qualifies only when every decoder line is one of the H.264 diagnostics that decoding from a mid-GOP seek point produces: `top block unavailable for requested intra mode`, `Reference N >= M`, `error while decoding MB X Y` or `mmco: unref short failure` (open-GOP sources). The selected 12-second interval, shared video/audio timestamps, quality and resource limits remain the same. The second attempt must pass the same strict output/diagnostic checks. Permissions, cancellation, timeout, output-size, encoder and unrelated decoder errors do not qualify; a failed sample alone does not declare the source film corrupt.

After some seeks the selected audio track (for example DTS-HD MA) first decodes in another sample format, and FFmpeg stops the whole filter graph with `Changing audio frame properties on the fly is not supported` / `Error reinitializing filters!`. For any video codec, Review then tries an earlier input seek: 30 seconds of preroll, then 60 seconds. It qualifies only when the first diagnostic names the selected audio input and every further line belongs to the same shutdown cascade, with exit code 234. Only the input seek changes; the 12-second interval, selected tracks, container origin, filters and profile stay identical. A recovered sample must decode completely (frames, 12 seconds of audio) and both streams must start at the requested time; otherwise it fails. The original and the Review copy share one **180-second** deadline including validation, and each FFmpeg run gets at most 90 seconds of what remains. Cancellation stops the running attempt and starts no further one. When recovery is exhausted, the error names the side (original or Review result) and the review offers **Review in your own player**: the existing external-player method, whose switch clears confirmed checks and keeps the note. Producing or failing a sample never confirms a check or approves a film.

The count/byte/expiry limits are enforced only inside the owned cache. When background storage is full, it stops rather than repeatedly evicting and rebuilding prepared results. A foreground request can still generate a sample and may evict older cached entries. Oversized samples or a storage failure can be delivered without persistence. Files whose source snapshot, track/time/profile or renderer/settings binding changed cannot reuse the old result. On startup, obsolete renderer artifacts are removed from the owned cache while valid current artifacts and foreign files are preserved. Approval/rejection/replacement invalidates that film's cache; expired artifacts are pruned and still-needed expired defaults can be prepared again.

## Verification

The renderer identity includes diagnostic acceptance rules as well as extraction code. Updating those rules invalidates older cached samples on startup; ordinary restarts with unchanged renderer sources can reuse them.

Unit tests cover disk bounds, private/atomic writes, restart reuse, stale identities, priority/preemption, read-only cache loading, language ordering/ambiguity and manual confirmations. `tools/test-preview-cache-http.mjs` uses generated media and a local mock Tdarr to verify preparation, cached-only misses/hits, custom requests, persistent reuse after restart, source changes and unchanged assessment evidence. No production film is approved as a test.
