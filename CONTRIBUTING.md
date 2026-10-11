# Contributing

Open an issue describing the expected behavior, application/runtime versions and sanitized error. Include container paths only as needed; omit API keys, access keys, personal journals and movie downloads.

For a code change, preserve file identity checks, origin/authentication enforcement, durable transactions, conservative recovery and the distinction between import, transcode success and explicit approval. Add a regression test for a meaningful changed behavior, using synthetic files and local fake APIs.

Run `npm run check` and `npm test` on Linux / Node 24. Approval-flow changes also need the isolated integration test. Do not use real movie replacement as a test fixture.

The project's own code, templates and documentation use the [MIT license](LICENSE). Contributions must be compatible with it. Do not include third-party material without its required attribution and license notices; upstream runtime components retain their own licenses.
