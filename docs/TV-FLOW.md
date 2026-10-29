# TV Review flow template v1

`templates/tdarr/tv-flow-v1.json` is a versioned, conservative Tdarr Flow definition for a TV episode staging path. It is a usable encoding graph, not a deployed or imported flow. No Tdarr instance import or library run was performed, so do not assume import compatibility with a particular server or Community plugin checkout.

The template contains only the stock `inputFile`, FFmpeg command, file-ratio, `Fail Flow`, and reviewed `Custom JS Function` nodes. It does not copy the personal movie flow's custom scripts or use Radarr, TMDB, release repair, source replacement, deletion, or Tdarr library-write nodes. The Custom JS code is embedded in the JSON and mirrored in `templates/tdarr/tv-flow-helper.cjs`; tests require them to stay identical.

## What was adapted from the existing movie workflow

| Existing workflow concern | TV template treatment |
| --- | --- |
| Movie/Radarr source selection and movie-only metadata | Removed; the TV library supplies the current input and the helper accepts only a validated episode-relative path. |
| Private Custom JS steps and their embedded constants | Removed; the versioned template embeds only the reviewed helper shipped beside it. |
| Movie destination, replacement and cleanup steps | Removed; the template stages a new file exclusively under the configured Review TV prefix and writes a sibling receipt. |
| Generic FFmpeg encode and sanity checks | Rebuilt with stock Flow nodes for software HEVC, Matroska, and duration/size gates, followed by strict decode and preservation checks. |

The original movie flow, its settings, and its schedules are not changed by this template. This table describes the offline adaptation only; it does not certify a Tdarr import or a live TV run.

## Supported profile and fail-closed cases

The helper runs only on Linux Tdarr nodes. Its path writes use descriptor-relative `/proc/self/fd` paths and Linux `O_NOFOLLOW`/`O_EXCL` flags. It accepts one progressive video stream in an MKV file with known SDR color metadata, 8-bit `yuv420p`, known sample/display aspect ratios, and a frame rate from 10 through 60 fps. When ffprobe omits `bits_per_raw_sample`, the helper recognizes 8-bit only from the explicitly allowlisted `yuv420p` pixel format; an explicit contradictory bit-depth value is rejected. The encode targets software HEVC. Existing HEVC sources are not force-reencoded. HDR, Dolby Vision, HDR10+, 3D, interlaced, high-bit-depth, non-4:2:0, unknown-color, unknown-timing, non-MKV and unusual stream layouts fail to Tdarr's error table for manual handling.

The audio and subtitle stream count and order, codec, language when present, channels, channel layout, and default/forced flags must match. Chapter count, title, and start/end times must match within a small timestamp tolerance. The supported codecs are deliberately allowlisted; unknown, data, attachment, or other stream types fail closed. The helper does not infer the language actually spoken. Keep Czech dialogue first for children's animation in the maintained source policy; this template preserves the existing track order and default/forced flags and applies no language filter.

After Tdarr's FFmpeg command completes, the final helper runs a full bounded FFmpeg decode over the encoded file. It uses the inherited, already-open file descriptor, forces Matroska demuxing, permits only the local-file protocol, maps all video and audio streams, uses `-xerror`/`-err_detect explode`, and requires a natural exit code of zero with no error-level output. A timeout, process error, changed source/cache identity, unrecognized metadata, or preservation mismatch prevents staging and receipt creation.

## Bindings before any isolated use

Keep the TV Tdarr library paused and unassigned. Disable its watcher, startup scan, schedule, and automatic processing. Configure exactly one worker for a manually controlled synthetic or copied pilot in an isolated Tdarr instance. A running pilot is a separate decision and is not authorized by this template.

Create these Tdarr **library variables** before assigning the flow:

| Variable | Required value |
| --- | --- |
| `tvSourceRoot` | The exact TV source root visible to the Tdarr node. It must be disjoint from Review output and cache roots. |
| `tvReviewRoot` | One output-prefix directory as seen by Tdarr. It must map to exactly one configured Review `tv.reviewPrefixes` entry beneath Review's `tv.reviewRoot`; the helper writes the original Series/Season/episode-relative path beneath it. |
| `tvCacheRoot` | A dedicated worker cache directory under `tvReviewRoot`, on bounded storage. The Tdarr `args.workDir` and FFmpeg working output must remain inside this directory. |

Review's TV `mediaRoot`, Tdarr `sourceRoots`, `tdarrReviewRoot`, `reviewRoot`, and `reviewPrefixes` are separate path namespaces. Confirm their mapping independently. The Review prefix directory paired with `tvReviewRoot` must be writable by the Tdarr node, while the original source mount must be read-only. The helper only opens the source read-only; a read-only mount also prevents unrelated plugin or engine behavior from writing there.

The helper refuses missing or overlapping root bindings, symlinked roots or parent directories, a pre-existing result or receipt, and a worker path outside the configured cache. It opens each directory component without following links, holds the file handles while it checks identity, and creates the staged episode and receipt exclusively under the Review prefix. If the job fails after the result was staged but before the receipt was durable, leave the unverified result for manual review; do not overwrite it or treat it as accepted.

Configure the node cache/backpressure limit outside this flow as well. The helper verifies that the work directory is under `tvCacheRoot`; it does not set a filesystem quota or cap the node's queue. Keep only the intended temporary work area and staged results on the bounded Review-owned storage.

## Maintainer setup checklist

- [ ] Keep the existing movie library, movie flow, and their schedules unchanged.
- [ ] Keep the new TV library paused and unassigned; disable its watcher, startup scan, schedule, and automatic processing.
- [ ] Verify the source mount is read-only and the source, Review output prefix, and cache are disjoint as required above.
- [ ] Set an external cache quota and Tdarr backpressure/worker limit; the flow does not create either limit.
- [ ] Review the current Review TV prefix and source-root mapping before any isolated use; the receipt does not configure Sonarr or authorize replacement.
- [ ] Test against a copied, disposable synthetic episode in an isolated Tdarr instance. This does not establish behavior on originals or authorize a pilot.
- [ ] Treat unsupported metadata, decode errors, or missing exact-job receipts as manual-review failures; do not enable the library to clear them.

## Graph and review handoff

The graph performs a software HEVC encode in Matroska without forced container conformance, checks duration and size as sanity gates, then runs strict decode, preservation checks, exclusive staging and receipt creation. The ratio gates are not proof of health; the full decode and metadata comparisons are required. A helper or ratio-gate refusal goes to `Fail Flow`.

The final helper writes `<episode>.mkv.tdarr-receipt.json` beside the staged result. Discovery accepts the legacy v1 receipt for read-only association. The current template emits v2: it retains the same relative path, file sample and exact job ID, and adds typed strict proof only after stream/flag/chapter preservation, full natural decode, source identity recheck and durable staged-copy verification. Review validates the v2 job ID and exact source/result identities again. A v1 receipt remains discoverable but cannot enter strict review; neither receipt version grants approval or permits cleanup by itself.

Importing or updating this template changes the custom-function receipt contract from v1 to v2. Existing jobs and v1 receipts remain read-only discovery records. Review has not imported this flow into a Tdarr instance or verified a deployed Tdarr/Community plugin version; new jobs must use the reviewed helper embedded in the v2 template before they can be considered by strict review.

## Verification and limits

Repository tests execute the helper on synthetic files and pass its generated receipt through Review's existing exact-job matcher. `tools/test-tv-flow-real-decode.mjs` generates short synthetic media, transcodes it, runs the same strict decoder and verifies the result/receipt; run it only in the isolated Review image with its bundled FFmpeg. No real media, production API, Tdarr import, TV-library activation, or pilot is part of these checks.

The template does not claim complete HDR/FEL preservation. Such sources and any unknown profile fail to manual review. It does not prove Czech speech content, episode identity by title, or that an arbitrary future plugin preserves data. Keep this graph closed to reviewed nodes, and review every plugin/version or setting change against this guide and its synthetic tests before use.

## Tdarr interface references

- [Flow plugin basics](https://docs.tdarr.io/docs/plugins/flow-plugins/basics/) documents `args` and library-variable templating.
- [Custom JS Function](https://docs.tdarr.io/docs/plugins/flow-plugins/index/tools/Custom%20JS%20Function/) and its [official plugin source](https://github.com/HaveAGitGat/Tdarr_Plugins/blob/master/FlowPluginsTs/CommunityFlowPlugins/tools/customFunction/1.0.0/index.ts) document the `module.exports = async (args) => …` code body and output shape.
- The [official job interface](https://github.com/HaveAGitGat/Tdarr_Plugins/blob/master/FlowPluginsTs/FlowHelpers/1.0.0/interfaces/synced/jobInterface.ts) names the current job ID field `jobId`.
- [Set Video Encoder](https://docs.tdarr.io/docs/plugins/flow-plugins/index/ffmpegCommand/Set%20Video%20Encoder/), [Set Container](https://docs.tdarr.io/docs/plugins/flow-plugins/index/ffmpegCommand/Set%20Container/), and [Fail Flow](https://docs.tdarr.io/docs/plugins/flow-plugins/index/tools/Fail%20Flow/) describe the stock nodes and their documented outputs.
- [FFmpeg Execute source](https://github.com/HaveAGitGat/Tdarr_Plugins/blob/master/FlowPluginsTs/CommunityFlowPlugins/ffmpegCommand/ffmpegCommandExecute/1.0.0/index.ts) documents the worker output location and natural FFmpeg exit handling.
