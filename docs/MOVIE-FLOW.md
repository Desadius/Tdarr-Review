# Movie flow nodes

The maintainer's production movie flow (`PRODmovies1`, library PROD-Movies) lives in the Tdarr database, not in this repository. Nodes that carry review-critical logic are mirrored under `templates/tdarr/movie-flow/` so changes to them are reviewed and tested here. The files are exact copies of the Custom JS code in the flow; they are not imported into Tdarr automatically.

| File | Flow node | Purpose |
| --- | --- | --- |
| `templates/tdarr/movie-flow/HDRextraPost.cjs` | `HDRextraPost` "Restore HDR10+ or verify unchanged DV7 FEL" | After the x265 encode: restores HDR10+ metadata, or converts a Dolby Vision profile 7 dual-layer (FEL/MEL) film to DV 8.1 and proves the result. |

## DV7 to DV 8.1 restore

The encode drops the DV7 enhancement layer and re-encodes the base layer with x265. `HDRextraPost` then:

1. converts the original's RPU to profile 8.1 with `dovi_tool -m 2` and requires one RPU per encoded frame;
2. exports the encoded HEVC stream;
3. injects the 8.1 RPU with `dovi_tool inject-rpu`;
4. muxes the injected video with mkvmerge, using the encoded video's own packet timestamps (`--timestamps 0:<v2 file>`), and adds the encoded file's audio, subtitles, attachments, chapters and per-stream tags with an ffmpeg stream copy;
5. extracts every RPU from the result again and requires the same count and SHA-256;
6. compares every audio and subtitle packet of the encoded file and the result: identical payload, duration and size, timestamps within 1 ms.

Step 4 uses mkvmerge only for the video. When mkvmerge remuxes audio from an existing Matroska file it recomputes the timestamps from its own sample clock. On LOTR The Two Towers (2026-11-02) that moved 113,739 DTS packets by up to 3 ms and smoothed a 14 ms gap in an AC-3 track over 7 packets (up to 13 ms), even with a per-track timestamp file; step 6 refused every DV7 film. ffmpeg wrote the encoded file and copies its packets without retiming. The video timestamps are read as a stream into a typed array, because tool output used to be capped at the last 100,000 characters and a feature film's per-frame list is several megabytes. A 6/6 refusal names the stream, the packet and both timestamps, because Tdarr deletes the work directory (and the `dv7to81-*` diagnostic files in it) after a failed job.

DV7 results always go to Review; nothing in this node approves or replaces an original.

## Tests

- `review/movie-flow-dv7.test.mjs` runs the node against stub `ffmpeg`, `ffprobe`, `dovi_tool` and `mkvmerge` executables with a feature-length frame count, checks the mkvmerge and ffmpeg calls, and checks that a moved audio timestamp is refused with its packet. It needs Linux (shebang stubs) and is skipped elsewhere; see [DEVELOPMENT.md](DEVELOPMENT.md) for running Linux-only tests.
- `tools/test-movie-flow-dv7-sample.mjs` runs the node on a short copied DV7 sample and its encode with the real tools of a Tdarr node:

  ```bash
  FFMPEG=/path/to/ffmpeg DOVI_TOOL=/path/to/dovi_tool MKVMERGE=/path/to/mkvmerge \
    node tools/test-movie-flow-dv7-sample.mjs sample-dv7.mkv sample-encoded.mkv
  ```

  Cut the sample from the start of the film (an IDR frame) with a stream copy, encode it with the flow's x265 arguments, and never point the harness at a library file.

## Updating the production flow

A change to a mirrored node is deployed separately, with the maintainer's explicit approval for that write (see `AGENTS.md`):

1. read `PRODmovies1` fresh and confirm the node still matches the file in this repository;
2. save the current flow under a new backup flow id (for example `PRODmovies1bak<date><topic>`) and read the backup back;
3. replace only the node's `inputsDB.code` with the file's content, write the flow with Tdarr's `cruddb` `update`, and read it back: only that node may differ;
4. jobs already running keep the code they loaded when they started, so a running DV7 job must be requeued to use the change.
