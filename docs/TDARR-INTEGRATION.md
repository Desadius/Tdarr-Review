# Connect an existing Tdarr flow

This repository supplies the Review application and the optional Recovery worker. It does **not** export the entire personal encoding flow or install a universal HDR/codec policy. Keep your existing tested encoding, audio-language and health-check policy.

For the separate TV staging template, see [TV Review flow template v1](TV-FLOW.md). Strict review accepts only the template's v2 receipt, emitted after full decode, preservation and staged-copy verification. The template remains an offline definition: no Tdarr instance import or production flow edit was performed. Its receipt contract changed from v1 to v2; existing v1 jobs remain discoverable but never qualify for strict review. Production import and pilot work remain separate decisions.

Šablona TV workflowu zůstává pouze offline návrhem a nebyla importována ani upravena v Tdarru. Přísné posouzení přijímá pouze její v2 důkaz po dokončeném dekódování, kontrole zachování stop a ověření kopie. Stávající v1 úlohy zůstávají viditelné pro objevování, ale nikdy nesplní podmínku přísného posouzení. Import do produkčního Tdarru ani pilot na originálních médiích nejsou součástí této změny; případný pilot se řeší samostatně v úkolu #270.

Required behavior: preserve the original in the Plex library, write the finished result to the separate Review tree, retain the relative film/file path, and run the intended Tdarr health check. Avoid a Tdarr step that replaces/deletes the original before Review approves it.

## Suggested flow placement

```mermaid
flowchart TD
  I[Input File] --> G[Review Guard]
  G -->|1: no pending result| E[Existing eligibility and encoder flow]
  G -->|2: verified result already waiting| END[End without another encode]
  E --> H[Tdarr health check and your validation]
  H --> O[Write/copy final result to Review path]
  O --> R[Review Receipt]
  R --> END
```

The examples under `examples/tdarr/` contain custom-function bodies adapted from the deployed integration. Edit the documented constants before using them. Use the code in the Tdarr **Custom Function** flow node; they are not Community plugin definitions or full flow JSON exports.

Guard runs before encoding. It captures source identity, detects destination collisions, and refuses to overwrite an existing result without verified receipt/history. Output 2 means the existing matching successful result is already awaiting Review, so skip encoding.

Receipt runs **after the final file is present at the configured Review path**. It checks the captured source is unchanged, records output identity and the actual Tdarr job ID. Running it before a copy/move to Review will fail. Use matching configuration in both examples, including Windows path translators and server library ID.

Server paths stored in Tdarr job history must stay server paths. On mapped Windows nodes, Tdarr can translate path literals in custom function inputs. The example constructs the history root from path components to avoid accidentally comparing a translated SMB path against server database paths.

## Receipt format

Place `Film.mkv.tdarr-receipt.json` alongside `Film.mkv`:

```json
{
  "version": 1,
  "relative": "Film/Film.mkv",
  "outputRelative": "Film/Film.mkv",
  "source": {"size": 1000, "mtime": 1700000000000, "sample": "sample SHA-256"},
  "output": {"size": 500, "mtime": 1700000000000, "sample": "sample SHA-256"},
  "jobId": "exact successful Tdarr job ID",
  "createdAt": 1700000000000
}
```

The example numbers are illustrative, not a valid real receipt. Receipt size and rounded mtime must match the current files. Review correlates library, source path, exact job ID when available, success and actual input/output sizes. Without a receipt, only unambiguous matching successful job evidence is accepted; ambiguous history is not guessed from the newest timestamp.

For TS/M2TS → MKV, `relative` remains the original TS/M2TS path and `outputRelative` is its MKV destination. Review requires an exact receipt for extension changes and refuses an already-existing MKV destination.

## Picture/profile compatibility

Review has validators for the deployed SDR/HEVC/HDR marker conventions, Dolby Vision 8.1, HDR10+, dual HDR and unchanged DV7 cases. These modules verify the corresponding implemented policies; they are not permission to blindly reencode every HDR film. A flow using a different marker convention may be blocked until adapted.

Do not convert DV7 FEL to a format that drops the enhancement layer while claiming full preservation. Do not treat MVC/stereo 3D or ISO images as ordinary 2D MKV. Such handling belongs to the encoding policy and remains outside this repository's automatic setup.

Original-language preservation must be part of the Tdarr audio/subtitle selection policy. CZ/EN-only filtering can remove a film's original dialogue. The optional Recovery metadata cache identifies original language via Radarr/TMDB; it is not itself a track filter or proof of the language actually spoken in a stream.

## Tdarr API compatibility

The integration uses existing `/api/v2/` routes for node state, pause updates, rescans, file updates and collection reads. It accepts plain-text `OK` mutation responses. After an uncertain Review replacement handoff, the application reads the exact file/library state before deciding whether another action is needed.

The deployed Rust engine was verified with the current API and SQLite schema. The API calls currently **do not attach a Tdarr authentication key**. An authenticated Tdarr API, or a future changed schema, requires an implementation/compatibility update. The Docker runtime's pinned image supplies Node/FFmpeg; it does not determine which engine your separate Tdarr server runs.


## Require review for Recovery replacements

The optional `examples/tdarr/recovery-review-route.cjs` custom Function routes Recovery replacement movies to the existing Review copy/receipt branch (output 2), while ordinary SDR follows the existing direct-install branch (output 1). Keep the earlier Review guard: the route uses its frozen original path in `variables.user.reviewSource.path`. This example assumes the media share is `/media`, the library is `/media/movies`, and Recovery publishes `/media/.tdarr-recovery-status.json`; adapt the constructed path segments for another layout. Paths are constructed in segments to avoid double translation on mapped Windows nodes.

Run this function after all validation and before any original-file replacement. Preserve its existing HDR/special-case verification checks. Require the status share to be readable on every node. An unavailable, malformed or stale snapshot fails closed before installing the result. Imported Recovery cases match the exact movie directory conservatively, including historical cases that lack a replacement filename. The association only controls routing; it supplies no approval or quarantine cleanup authority. Completed historical direct installs are not recreated as pending Review results. Jobs already running may retain their previous flow snapshot, so check for active Recovery jobs before enabling the change.
