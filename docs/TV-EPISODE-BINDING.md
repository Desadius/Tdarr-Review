# TV episode binding foundation

`review/episode-binding.mjs` exports the pure synchronous function `resolveEpisodeBinding(input)`. The manual Sonarr inspector calls it with a request-scoped namespace and selected-series snapshot; results remain descriptive metadata and are not persisted. The inspector is separate from discovery, approvals, Recovery and replacement transactions. TV processing remains unavailable. See the [manual inspector guide](SONARR-INSPECTOR.md).

## Input boundary

The caller supplies:

```js
resolveEpisodeBinding({
  instanceKey: 'caller-owned-instance-namespace',
  seriesId: 12,
  filePath: '/tv/Example/Season 01/Example.mkv',
  episodeFiles: [/* complete EpisodeFile records for the selected series */],
  episodes: [/* complete Episode records for the selected series */],
});
```

Records follow the [official Sonarr v3 API schema](https://github.com/Sonarr/Sonarr/blob/develop/src/Sonarr.Api.V3/openapi.json). Episodes carry `episodeFileId`; joining those records to the file table supplies membership. A zero file ID means an episode has no associated file. The implementation also accepts explicit null for that unbound state. A file's own ID, episode IDs and series IDs must be positive safe integers, with no string coercion.

The caller owns the instance namespace, complete reads and freshness. This function cannot detect a consistently incomplete or old snapshot. The manual adapter checks the saved settings revision before and after its requests, but cannot prove Sonarr returned a fresh or internally complete snapshot. A future processing adapter must reconcile changes between reads and verify actual files before using a binding. Do not derive a persistent namespace from a URL, API key or title; this inspector uses a fresh ephemeral namespace and persists no identity.

`filePath` and record paths must already be expressed in the same namespace. Comparison is byte-for-byte, including Windows paths; there is no separator conversion, case folding, filename parsing or fuzzy matching. A matching string is not a filesystem safety check or proof that Sonarr and Review see the same file. Path translation belongs to the multi-library integration under #239.

## Results

| Status | Meaning |
| --- | --- |
| `mapped` | One exact file record and at least one explicitly linked episode in the supplied consistent snapshot. |
| `unmapped` | No exact selected-series file, or no episode linked to it. |
| `ambiguous` | Duplicate paths or conflicting reused file/episode IDs prevent a unique binding. |
| `invalid` | Malformed input or contradictory series/file links. |

A mapped result has `binding: {instanceKey, seriesId, episodeFileId, episodeIds}`. Episode IDs and their display records are sorted numerically. One multi-episode file produces one binding containing every linked episode ID. The tuple is descriptive; it does not replace the filesystem **file identity** defined in `GLOSSARY.md`.

The result separately projects file path, relative path, season and scene name, and episode season/number, absolute number, scene absolute/season/number, scene-numbering uncertainty and air dates. Missing optional display fields become null. Season zero is retained; numbering schemes never supply identity. Unknown fields and nested payloads are not copied into the result. Returned arrays and records do not retain mutable input references. Internal paths and release metadata still need an appropriate public projection before any future UI/export use.

Supplied `hasFile` and embedded file data must agree with explicit links. Missing optional embedded data does not establish or disprove a binding. Unbound episodes remain outside membership. Malformed supplied records are rejected conservatively; cross-series records cannot hide conflicting IDs or links merely by being filtered out.

## Integration limits

No result from this module grants technical validation, individual observation, sampled coverage, approval, retention, dispatch or replacement authority. The manual Sonarr inspector has a separate point-in-time Tdarr result-association check; it requires an exact job ID and supported receipt but still does not prove technical health or approval. Any future TV workflow must independently establish the evidence and explicit review policy it needs. Changed imports, ambiguous mappings and changed cohort membership must invalidate the relevant authorisation.

Movie IDs, paths and state are unchanged. The manual inspector contacts only the explicitly configured Sonarr endpoint and does not verify an installed Sonarr version. API references describe the v3 contract. Persistent bindings, multi-library routing, previews, cohort review, TV transactions and Sonarr Recovery remain follow-up work under #238.
