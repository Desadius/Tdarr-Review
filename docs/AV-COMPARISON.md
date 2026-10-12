# Interactive audio/video comparison

In a film's Review detail, open **Assess** and follow **Preparation → Picture → Audio → Synchronization → Decision**. Video comparison is embedded in the Picture and Synchronization steps: choose matching tracks and a start time, then **Compare video and audio**. Review prepares two actual 12-second H.264/AAC videos. Both players share play/pause and a seek slider. Switch the audible copy during playback; only one plays audio at a time. Click a waveform to seek, or step while paused. The beginning/middle/end presets select approximately 2%, 50% and 95% of the available start-time range; choose useful dialog or visible sound-effect scenes yourself. Presets do not prove those regions were checked. Save each synchronization confirmation with its own selected time. Existing left/right headphone A/B is embedded in the Audio step.

The waveform and correlation use source PCM envelopes in 10 ms bins, without independent loudness normalisation or automatic alignment. Correlation measures the difference between matching audio tracks, not whether the source itself is in sync with the picture. Ambiguous or silent samples do not produce a definitive offset. Original and transcoded waveforms share a cursor.

The preview subtracts the same container start and requested time from audio and video timestamps. It never separately resets each stream with STARTPTS. Decoder priming, frame granularity and browser player buffering limit precision; a player resynchronisation is shown. Frame stepping uses average source frame rate and is approximate for VFR. This is not an automatic approval or a replacement for playback-device validation.

Previews are up to 960 px wide, mono AAC and H.264. PQ HDR uses identical SDR tone mapping on each side. Unsupported transfer functions (including HLG) are rejected with an explicit explanation. These clips are not for evaluating original HDR fidelity, surround sound or codec transparency.

Preparation runs serially under the existing preview lock, two decoder threads, a maximum 90 seconds and 20 MiB per video, plus bounded waveform extraction. It uses the existing authenticated endpoint with snapshot checks before and after preparation and validates audio stream indexes and a complete 12-second window. No film is modified. Videos live in browser Blob URLs, revoked when the dialog closes or a new selection invalidates the clip. The server does not store clip files.

## Validation

`node tools/test.mjs` includes argument/timestamp and player-control regressions. `tools/test-av-fixture.mjs` uses disposable generated media with a 5-second container origin and deliberately delayed audio. `tools/test-av-http.mjs` checks login, stale identity, invalid track/time, playable clips, waveforms and unchanged source hashes using a mock Tdarr. `tools/demo-av-preview.mjs` is an optional temporary UI smoke server using generated media only; do not expose it as a permanent service.
