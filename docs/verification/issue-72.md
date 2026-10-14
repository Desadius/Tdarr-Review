# Issue #72: behavior and red/green evidence

The branch includes main commit 0ae7ba5 (#92), merged as 09f007b. No merge conflicts occurred.

## Evidence provenance

Historical implementation red runs and current mutation checks are distinguished below. A negative test that initially passed against a stub is not claimed as an implementation red. The replay was executed after merging main: each deliberate regression failed an observable assertion, and the original file was restored in a finally block. No mutations remain.

Historical UI red runs were reported by the UI implementation agent during the original task. The captured replay excerpts are newly observed execution output, not reconstructed historical transcripts.

## Historical implementation red runs

| Behavior | Test | Observed red | Fix |
| --- | --- | --- | --- |
| Refusal reason/attention | health-status: Recovery refusal includes its worker reason and only adds health attention | The reader stub returned Off/present:false instead of refused with missing-config. | Shared validated reader plus refusal attention. |
| Crash loop | health-status: Recovery crash-loop attention persists during restarts and running without failing Review health | attention was empty instead of recovery-crash-loop. | Reason-based attention, including running retries. |
| Unreadable runtime | health-status: an unreadable Recovery runtime snapshot raises attention without exposing file contents or failing health | attention was empty instead of recovery-runtime-unreadable. | Safe unreadable sentinel plus its attention code. |
| Overview runtime | radarr-replacement: Recovery overview reads supervisor runtime from Review data independently of Radarr configuration | recoveryRuntime was undefined instead of the Off snapshot. | Include the runtime reader result from Review data. |
| ISO timestamps | health-status: Recovery runtime timestamps accept ISO dates and reject parseable arbitrary text | Date.parse accepted private note 1 and the reader returned it. | Require ISO timestamp syntax. |
| Six runtime states/reasons EN/CS | recovery-frontend: Recovery runtime renders STATE and its reason in LANGUAGE (12 cases) | Expected state/reason text was absent. | State dictionary, safe reasons and translations. |
| Decode, mutation and active-hash warnings | recovery-frontend: original-check, mutation-phase and active-checksum cases | Expected warning view was absent. | Activity predicate plus localized warning renderer. |
| Inactive/invalid hashes | recovery-frontend: Recovery CASE checksum does not render an active interruption warning (8 cases) | A warning appeared where null was expected. | Restrict phase and validate progress/completion. |
| Shared-container config notice | recovery-frontend: Recovery configuration TYPE notice renders in LANGUAGE (4 cases) | Expected notice view was absent. | Notice renderer and Czech/English shared-container advice. |
| Runtime beside corrupt case data | health-http: authenticated runtime diagnostics remain available when the Recovery case file cannot be read | Authenticated diagnostics returned 404 instead of 200. | Independent authenticated runtime route. |
| Real-app fallback EN/CS | app-runtime: real Review app shows STATE runtime despite unreadable case status in LANGUAGE (4 cases) | Assertion: runtime must update independently of failed case data. | Authenticated fallback retaining case error, cache and timestamp. |

Missing-file/default, filtering, inactivity and real-consumer wiring were additionally proven by mutation; those checks are not presented as earlier implementation red runs.

## Current red replay and restored behavior

Test patterns below identify exact tests or parameterized families. Counts cover every selected state/language/phase case, not just the first excerpt.

| Behavior | Selected test(s) | Deliberately broken behavior | Red tests | Fix / restored behavior |
| --- | --- | --- | --- | --- |
| refusal attention | [health-status.test.mjs](../../review/health-status.test.mjs) — Recovery refusal includes | <code>remove  if(recoveryRuntime?.state==='refused')attention.push('recovery-refused');</code> | 1 | Add recovery-refused and retain the worker reason. |
| crash-loop attention | [health-status.test.mjs](../../review/health-status.test.mjs) — Recovery crash-loop attention | <code>remove  if(recoveryRuntime?.reason==='crash-loop')attention.push('recovery-crash-loop');</code> | 1 | Check crash-loop during restarting and running. |
| unreadable attention | [health-status.test.mjs](../../review/health-status.test.mjs) — an unreadable Recovery runtime | <code>remove  if(recoveryRuntime?.state==='unreadable')attention.push('recovery-runtime-unreadable');</code> | 1 | Add recovery-runtime-unreadable for the safe unreadable sentinel. |
| missing means Off | [health-status.test.mjs](../../review/health-status.test.mjs) — missing or Off Recovery runtime | <code>replace return {present:false,mode:'off',state:'off',reason:null}; with return {present:true,state:'unreadable',reason:null};</code> | 1 | Map ENOENT to Off, present:false and reason:null. |
| schema validation | [health-status.test.mjs](../../review/health-status.test.mjs) — Recovery runtime validates | <code>replace if(!v&#124;&#124;v.version!==1 with if(false &amp;&amp; (!v&#124;&#124;v.version!==1; replace .test(v.reason)))return unreadable(); with .test(v.reason))))return unreadable();</code> | 1 | Validate version, enums, counters, exits, timestamps and reason. |
| field allowlist | [health-status.test.mjs](../../review/health-status.test.mjs) — Recovery runtime validates | <code>replace return {present:true,...Object.fromEntries(FIELDS.map(key=&gt;[key,v[key]]))}; with return {present:true,...v};</code> | 1 | Publish only the documented fields, excluding apiKey/stderr extras. |
| file size bound | [health-status.test.mjs](../../review/health-status.test.mjs) — an unreadable Recovery runtime | <code>replace st.size&gt;16384 with false</code> | 1 | Keep the 16 KiB bound even for otherwise valid JSON. |
| ISO timestamps | [health-status.test.mjs](../../review/health-status.test.mjs) — Recovery runtime timestamps | <code>replace const time=value=&gt;typeof value==='string'&amp;&amp;/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z&#124;[+-]\d{2}:\d{2})$/.test(value)&amp;&amp;Number.isFinite(Date.parse(value)); with const time=value=&gt;typeof value==='string'&amp;&amp;Number.isFinite(Date.parse(value));</code> | 1 | Require ISO syntax as well as a finite date. |
| no runtime heartbeat expiry | [health-status.test.mjs](../../review/health-status.test.mjs) — missing or Off Recovery runtime | <code>replace   return {present:true,...Object.fromEntries with   if(Date.now()-Date.parse(v.updated)&gt;12*60000)return unreadable();   return {present:true,...Object.fromEntries</code> | 1 | Do not apply case heartbeat expiry to process runtime state. |
| attention does not fail healthcheck | [health-status.test.mjs](../../review/health-status.test.mjs) — Recovery refusal includes&#124;Recovery crash-loop attention&#124;an unreadable Recovery runtime | <code>replace try{const s=JSON.parse(health.text);return with try{const s=JSON.parse(health.text);if(s.attention?.length)return {ok:false,line:'mutated attention failure'};return</code> | 3 | Report attention without failing a healthy Review endpoint/UI. |
| overview runtime | [radarr-replacement.test.mjs](../../review/radarr-replacement.test.mjs) — Recovery overview reads supervisor | <code>remove ,recoveryRuntime:await readRecoveryRuntime(path.join(data,'recovery','runtime-state.json'))</code> | 1 | Include runtime read from Review data without requiring Radarr configuration. |
| six states in EN/CS | [recovery-frontend.test.mjs](../../review/recovery-frontend.test.mjs) — Recovery runtime renders | <code>replace const label=runtime?labels[state]&#124;&#124;labels.unreadable:'Načítám…'; with const label='';</code> | 12 | Render six state labels, modes and safe reasons in Czech/English. |
| safe UI reason codes | [recovery-frontend.test.mjs](../../review/recovery-frontend.test.mjs) — Recovery runtime suppresses | <code>replace typeof runtime?.reason==='string'&amp;&amp;/^[a-z0-9-]{1,64}$/.test(runtime.reason)? with typeof runtime?.reason==='string'?</code> | 1 | Display only bounded lowercase technical reason codes. |
| decode warning in EN/CS | [recovery-frontend.test.mjs](../../review/recovery-frontend.test.mjs) — Recovery original check renders | <code>replace if(!recoveryIsBusy(requests,runtime))return null; with return null;</code> | 2 | Render the shared-container warning during original verification. |
| thirteen mutation phases | [recovery-frontend.test.mjs](../../review/recovery-frontend.test.mjs) — Recovery (profile_&#124;holding&#124;quarantine&#124;block&#124;search_&#124;defer_&#124;replacement_&#124;restore_&#124;remove_) | <code>replace const RECOVERY_MUTATION_PHASES=new Set(['profile_intent','holding','quarantine_intent','quarantined','blocklist_intent','blocked','search_intent','defer_limit_intent','defer_cooldown_intent','replacement_queue_intent','restore_source_intent','remove_kept_source_intent','replacement_download_intent']); with const RECOVERY_MUTATION_PHASES=new Set([]);</code> | 13 | Include all thirteen journaled mutation phases even with old case data. |
| active hash warning | [recovery-frontend.test.mjs](../../review/recovery-frontend.test.mjs) — Recovery active .* checksum | <code>replace const hash=fullHashProgress(r); with const hash=null;</code> | 2 | Recognize valid incomplete confirmation/before_quarantine hashes. |
| inactive hash exclusions | [recovery-frontend.test.mjs](../../review/recovery-frontend.test.mjs) — checksum does not render | <code>remove if(!['candidate','confirmed'].includes(r.phase))return false;; replace return hash!==null&amp;&amp;hash.done!==null&amp;&amp;hash.total&gt;0&amp;&amp;hash.done&lt;hash.total; with return !!r.fullHash;</code> | 8 | Require an active phase, valid progress and positive size with done < total. |
| idle/source/runtime exclusions | [recovery-frontend.test.mjs](../../review/recovery-frontend.test.mjs) — idle cases&#124;other services&#124;inactive Recovery runtime | <code>remove if(!recoveryIsBusy(requests,runtime))return null;</code> | 7 | Warn only for running Recovery performing decode/mutation work. |
| shared-container config notice EN/CS | [recovery-frontend.test.mjs](../../review/recovery-frontend.test.mjs) — Recovery configuration | <code>replace const notice=recoveryConfigNotice(change);if(!notice)return null; with return null; const notice=recoveryConfigNotice(change);if(!notice)return null;</code> | 4 | Render valid/invalid configuration notices for the shared container in both languages. |
| real health consumer | [health-http.test.mjs](../../review/health-http.test.mjs) — real health endpoint | <code>remove ,recoveryRuntime:await readRecoveryRuntime(path.join(DATA,'recovery','runtime-state.json'))</code> | 1 | Pass runtime into the actual server health summary. |
| auth runtime independent of case errors | [health-http.test.mjs](../../review/health-http.test.mjs) — authenticated runtime diagnostics | <code>remove  if(url.pathname==='/api/recovery/runtime'&amp;&amp;req.method==='GET')return reply(res,200,await readRecoveryRuntime(path.join(ctx.DATA,'recovery','runtime-state.json')));</code> | 1 | Provide independent authenticated runtime diagnostics when case status fails. |
| real app assignment | [app-runtime.test.mjs](../../review/app-runtime.test.mjs) — real Review app shows API runtime | <code>remove recoveryRuntime=d.recoveryRuntime&#124;&#124;null;</code> | 2 | Store the overview runtime snapshot in app state. |
| real app runtime DOM | [app-runtime.test.mjs](../../review/app-runtime.test.mjs) — real Review app shows API runtime | <code>remove $('recoveryRuntime').replaceChildren(recoveryRuntimeView(recoveryRuntime));</code> | 2 | Render app state into the actual runtime DOM region. |
| real app warning DOM | [app-runtime.test.mjs](../../review/app-runtime.test.mjs) — real Review app shows API runtime | <code>remove $('recoveryRestartWarning').replaceChildren(...(restartWarning?[restartWarning]:[]));</code> | 2 | Populate and clear the actual warning DOM region. |
| Off clears old refusal | [app-runtime.test.mjs](../../review/app-runtime.test.mjs) — real Review app shows API runtime | <code>replace recoveryRuntime=d.recoveryRuntime&#124;&#124;null; with if(d.recoveryRuntime?.present!==false)recoveryRuntime=d.recoveryRuntime&#124;&#124;null;</code> | 2 | Apply Off snapshots and clear previous refusal text. |
| case-error fallback EN/CS | [app-runtime.test.mjs](../../review/app-runtime.test.mjs) — despite unreadable case status | <code>remove if(authenticated){try{recoveryRuntime=await api('/api/recovery/runtime')}catch{}}</code> | 4 | Fetch runtime after an overview error without refreshing the case snapshot. |
| expired auth skips fallback | [app-runtime.test.mjs](../../review/app-runtime.test.mjs) — skips the runtime fallback | <code>replace if(authenticated){try{recoveryRuntime=await api('/api/recovery/runtime')} with if(true){try{recoveryRuntime=await api('/api/recovery/runtime')}</code> | 1 | Keep the existing authenticated-session gate. |
| failed fallback preserves state/error | [app-runtime.test.mjs](../../review/app-runtime.test.mjs) — runtime fallback fails | <code>replace try{recoveryRuntime=await api('/api/recovery/runtime')} with try{recoveryRuntime=null;recoveryRuntime=await api('/api/recovery/runtime')}</code> | 2 | Update runtime only after successful fallback; retain the original overview error. |
| case freshness not renewed on failure | [app-runtime.test.mjs](../../review/app-runtime.test.mjs) — despite unreadable case status | <code>replace requestsError=e.message;if(authenticated) with requestsError=e.message;requestsReceived=Date.now();if(authenticated)</code> | 4 | Do not advance requestsReceived on failure. |
| case cache retained on failure | [app-runtime.test.mjs](../../review/app-runtime.test.mjs) — despite unreadable case status | <code>replace requestsError=e.message;if(authenticated) with requestsError=e.message;requests=[];if(authenticated)</code> | 4 | Do not discard cached requests on failure. |

## Captured red assertion excerpts

The full red output is retained locally in the temporary replay JSON. Each block below preserves the first assertion excerpt; all selected failing cases are counted above.

### refusal attention

    AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
      + actual - expected

      + []
      - [
      -   'recovery-refused'
      - ]

### crash-loop attention

    AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
      + actual - expected

      + []
      - [
      -   'recovery-crash-loop'
      - ]

### unreadable attention

    AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
      + actual - expected

      + []
      - [
      -   'recovery-runtime-unreadable'
      - ]

### missing means Off

    AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
      + actual - expected

        {
      +   present: true,
      -   mode: 'off',
      -   present: false,
          reason: null,
      +   state: 'unreadable'
      -   state: 'off'
        }

### schema validation

    AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
      + actual - expected

        {
      +   lastExitCode: undefined,
      +   lastExitSignal: undefined,
      +   lastExitedAt: undefined,
      +   lastStartedAt: undefined,
      +   mode: undefined,
          present: true,
      +   reason: undefined,
      +   restarts: undefined,
      +   state: undefined,
      +   updated: undefined,
      +   version: undefined
      -   reason: null,
      -   state: 'unreadable'
        }

### field allowlist

    AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
      + actual - expected
      ... Skipped lines

        {
      +   apiKey: 'SECRET',
          lastExitCode: 78,
          lastExitSignal: null,
          lastExitedAt: '2026-10-13T11:00:01.000Z',
          lastStartedAt: '2026-10-13T11:00:00.000Z',
          mode: 'repair',
      ...
          state: 'refused',
      +   stderr: 'SECRET',
          updated: '2026-10-13T11:00:01.000Z',
          version: 1
        }

### file size bound

    AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
      + actual - expected

        {
      +   lastExitCode: 78,
      +   lastExitSignal: null,
      +   lastExitedAt: '2026-10-13T11:00:01.000Z',
      +   lastStartedAt: '2026-10-13T11:00:00.000Z',
      +   mode: 'repair',
          present: true,
      +   reason: 'missing-config',
      +   restarts: 0,
      +   state: 'refused',
      +   updated: '2026-10-13T11:00:01.000Z',
      +   version: 1
      -   reason: null,
      -   state: 'unreadable'
        }

### ISO timestamps

    AssertionError [ERR_ASSERTION]: lastStartedAt
      + actual - expected

        {
      +   lastExitCode: 78,
      +   lastExitSignal: null,
      +   lastExitedAt: '2026-10-13T11:00:01.000Z',
      +   lastStartedAt: 'private note 1',
      +   mode: 'repair',
          present: true,
      +   reason: 'missing-config',
      +   restarts: 0,
      +   state: 'refused',
      +   updated: '2026-10-13T11:00:01.000Z',
      +   version: 1
      -   reason: null,
      -   state: 'unreadable'
        }

### no runtime heartbeat expiry

    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
      + actual - expected

      + 'unreadable'
      - 'off'

### attention does not fail healthcheck

    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

      false !== true

### overview runtime

    AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
      + actual - expected

      + undefined
      - {
      -   mode: 'off',
      -   present: false,
      -   reason: null,
      -   state: 'off'
      - }

### six states in EN/CS

    AssertionError [ERR_ASSERTION]: cs off
      + actual - expected

      + 'Stav Recovery: '
      - 'Stav Recovery: Off'
                        ^

### safe UI reason codes

    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
      + actual - expected

      + 'Recovery status: Startup refused · Repair Reason: API_KEY=private'
      - 'Recovery status: Startup refused · Repair'

### decode warning in EN/CS

    AssertionError [ERR_ASSERTION]: the active original check needs a warning

### thirteen mutation phases

    AssertionError [ERR_ASSERTION]: profile_intent changes library, Tdarr or Radarr state

### active hash warning

    AssertionError [ERR_ASSERTION]: reading the original still needs the interruption warning

### inactive hash exclusions

    AssertionError [ERR_ASSERTION]: complete cannot imply an active checksum
      + actual - expected

      + Element {
      +   attributes: {
      +     role: 'status'
      +   },
      +   children: [],
      +   className: 'alert',
      +   tagName: 'P',
      +   textContent: 'Restart nebo aktualizace kontejneru s Review přeruší Recovery. Počkej na dokončení kontroly originálu nebo změn prováděných Recovery. Přerušená kontrola není důkazem poškození.'
      + }
      - null

### idle/source/runtime exclusions

    AssertionError [ERR_ASSERTION]: candidate
      + actual - expected

      + Element {
      +   attributes: {
      +     role: 'status'
      +   },
      +   children: [],
      +   className: 'alert',
      +   tagName: 'P',
      +   textContent: 'Restart nebo aktualizace kontejneru s Review přeruší Recovery. Počkej na dokončení kontroly originálu nebo změn prováděných Recovery. Přerušená kontrola není důkazem poškození.'
      + }
      - null

### shared-container config notice EN/CS

    AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:

        assert.ok(view)

### real health consumer

    AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
      + actual - expected

      + undefined
      - {
      -   mode: 'off',
      -   present: false,
      -   reason: null,
      -   state: 'off'
      - }

### auth runtime independent of case errors

    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

      404 !== 200

### real app assignment

    AssertionError [ERR_ASSERTION]: The input did not match the regular expression /Stav Recovery: Běží · Repair/. Input:

      'Stav Recovery: Načítám…'

### real app runtime DOM

    AssertionError [ERR_ASSERTION]: The input did not match the regular expression /Stav Recovery: Běží · Repair/. Input:

      ''

### real app warning DOM

    AssertionError [ERR_ASSERTION]: The input did not match the regular expression /kontejneru s Review přeruší Recovery/. Input:

      ''

### Off clears old refusal

    AssertionError [ERR_ASSERTION]: The input did not match the regular expression /Stav Recovery: Off/. Input:

      'Stav Recovery: Spuštění odmítnuto · RepairDůvod: approval-registry-invalid'

### case-error fallback EN/CS

    AssertionError [ERR_ASSERTION]: runtime must update independently of failed case data

### expired auth skips fallback

    AssertionError [ERR_ASSERTION]: runtime fallback requires the existing authenticated session

      1 !== 0

### failed fallback preserves state/error

    AssertionError [ERR_ASSERTION]: failed runtime read retains the last supervised state
      + actual - expected

      + 'Recovery status: Loading…'
      - 'Recovery status: Running · Repair'
                          ^

### case freshness not renewed on failure

    AssertionError [ERR_ASSERTION]: failed overview must not renew case freshness
      + actual - expected

      + '1 případů · poslední načtení 14. 10. 2026 23:12:44'
      - '1 případů · poslední načtení 14. 10. 2026 23:11:44'

### case cache retained on failure

    AssertionError [ERR_ASSERTION]: last known cases must remain visible

## Final validation

- After all mutations were restored and main (#92) was merged, npm run check passed (syntax, version consistency and source-text test policy).
- npm run typecheck passed.
- npm test passed: 590 tests, 515 passed, 0 failed, 75 Windows/platform skips. The passing suite includes the actual HTTP consumer and the real-app VM wrapper, which executes nine consumer tests in a flagged child process.
- The temporary red replay detected all 30 deliberate regressions (87 failing test executions across the selected parameterized cases). The final green run used the restored implementation.

Only synthetic files, temporary data and loopback fixtures were used. Temporary replay/report tools were removed. No production installation or real media/API endpoint was accessed.
