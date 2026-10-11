# Repository verification — 2026-10-11

The prepared source passed JavaScript syntax checks and **149 regression tests** on Linux, Node 24.15.0. Test data was copied to an isolated temporary directory and APIs were mocked. No production approval, film replacement, Radarr download or container restart was used for these tests.

The isolated HTTP integration test passed authentication/origin checks, plain-text Tdarr `OK` responses, competing single/batch requests, all-selection preflight, sequential batch replacement, changed-source preservation, rejection of only the result, history recording and restoration of owned node pauses. It generated disposable short media using Jellyfin FFmpeg 7.1.4.

Documentation links and JSON examples were checked. A scan found no known private SSH material, production API credentials, personal server IP, personal library ID or local Windows user paths in the prepared files.

This is verification of the published source and example contracts. A clean image build/new Unraid installation, authenticated Tdarr API support and future Tdarr versions are separate checks; they are not claimed by these results.
