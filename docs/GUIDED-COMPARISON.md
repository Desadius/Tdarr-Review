# Guided comparison

The in-app guided comparison is the default media-first review workflow. Select the original and result audio tracks, choose three excerpt times, then start the run. One shared context keeps the selected pair, times, routing and active phase together.

## Playback modes

Each excerpt is bounded to 12 seconds. The default Guided ears mode plays three phases for each excerpt: Original in the left ear; Together, with original left and result right; then result in the right ear. Across three excerpts this is nine phases and at most 108 seconds of sampled audio. Sequential mode plays Original and then result for each excerpt, for six phases and at most 72 seconds. Ear swap reverses the left/right routing.

The player can pause visibly while video is waiting, after an error, or when the browser suspends its media context. Resume or retry is explicit. The workflow does not silently normalize audio or align offsets.

## Confirmations and saving

Preparation, picture, audio, and each of the three synchronisation excerpts require explicit human confirmation. Playback, clip completion and technical readiness do not set checkboxes. Use **Save observations** to save the confirmations in one user action. The server binds observations to the selected file pair, tracks, method, routing and excerpt times, validates the comparison metadata and uses revision compare-and-swap. If one of the sequential writes conflicts, earlier accepted records remain; unsaved confirmations stay available as a draft. Saving a review never approves or replaces a film. Approval remains a separate explicit decision with its existing server checks.

Changing the pair or comparison context invalidates affected guided checks. Existing records are not silently rewritten when the playhead or excerpt selection changes. The external-player/TV route keeps its separate-step flow; it requires a named device/player of at least two characters after trimming. HDR/Dolby Vision confirmation still requires native playback on a named suitable device, even when in-app tools are used.

Use **Save draft review** to keep incomplete work or **Defer review** with a note to record what remains uncertain. Neither action supplies missing confirmations or enables approval.

## Controls and display limits

The floating toolbar can be docked or hidden. Keyboard shortcuts work only while the player is focused and do not take over editable controls. Space/K toggles playback, left/right arrows seek, M toggles mute, F toggles fullscreen, H hides/restores controls, ? opens help, brackets select excerpts, R repeats the current excerpt, S stops, and Escape closes help or exits fullscreen/focus mode before returning focus to the manual confirmations. Native range controls remain available for seeking and volume.

Fit, Stretch and Fill are local browser preferences applied equally to both images. 1:1 frames display native source pixels; stepping is approximate for variable-frame-rate material. Video samples are bounded SDR previews and audio is mono at 48 kHz. They do not establish native HDR fidelity, surround sound, original-resolution playback quality or codec transparency. HDR/Dolby Vision therefore still requires a separate native-device confirmation.

## Design basis

The [Web Audio specification](https://www.w3.org/TR/webaudio-1.0/#dom-audiobuffersourcenode-start) defines start scheduling against `AudioContext.currentTime` with explicit buffer offsets. The implementation schedules both copies on that clock and restarts the same interval for every phase; browser video remains subject to buffering and the visible drift guard. The ear-separated sequence is a practical comparison requested by this project, not a validated listening-test standard or a whole-film quality certificate.

[W3C character-key guidance](https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html) permits character shortcuts scoped to component focus. The player uses that approach, with native form controls retaining their usual keys. [W3C focus visibility guidance](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) identifies overlapping fixed controls as a focus hazard. Reserved scroll space, docking and explicit hide/restore are the design choices used here; these choices are not a general accessibility-conformance claim.
