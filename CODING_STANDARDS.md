# Coding standards

Rules the reviewer applies to a diff, on top of the safety rules in `AGENTS.md`. Mechanical rules are enforced by `npm run check` and are listed here only so a finding can name them.

## Tests exercise behaviour

A test calls the real module, runs the real process or drives the real HTTP route, and asserts what a user, operator or caller can observe: return values, exit codes, files written, requests made, published status.

- A test that matches the text of implementation source (reading `server.mjs` and asserting a regular expression against it) proves only how the code is written. It stays green when the behaviour breaks and goes red when the code is rewritten. Recovery's `configChange` restart notice never reached Review from 1.11.0 until #76: its wiring was covered only by source-text tests, and the first test on the running worker found the gap.
- `npm run check` refuses new source-text reads in suite files (`tools/source-text-tests.mjs`). Existing ones are in its allowlist; a diff that rewrites one of those tests removes its entry.
- Loading a source file in order to execute it (for example a Tdarr flow plugin evaluated with mocks) is a behaviour test. When such a read has to be added, the finding is a judgement call: confirm that the test runs the code, then add the allowlist entry in the same diff.

## Red per behaviour

Every behaviour a diff adds or changes has a test that was seen **red** because of that behaviour, before the fix made it green.

- A red caused by a missing module, a missing export or a syntax error does not count: it shows that the code is absent, not that the test can detect the behaviour. Add a stub that exports the function and returns a wrong or empty result, and show the red against the stub.
- A test that already passes against the stub (a negative case such as "prints nothing" or "refuses X") is proven by a **mutation**: break the implementation on purpose, show that this test goes red, then restore it.
- A refactor or an existing behaviour without a new test is covered the same way: a mutation per behaviour, run against the tests that claim to cover it.
- Tests that skip outside Linux are proven red on Linux: locally in WSL2, or through the `Linux tests (manual)` workflow (`docs/DEVELOPMENT.md`).
- Evidence belongs in the pull request: per behaviour, the failing assertion that was seen (or the mutation and the test it turned red). A behaviour without that evidence is a finding.

## One meaning, every reader

When a diff changes how a file, setting or status field is interpreted, every reader of it changes in the same diff and has a test. The readers of Recovery's `config.json` and approval registry are listed in `docs/ARCHITECTURE.md` (*Readers of `config.json` and the approval registry*). For other files, search for every reader of the file name before you accept the diff.
