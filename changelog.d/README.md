# Unreleased changelog fragments

A pull request with a user-visible change adds one file here instead of editing `CHANGELOG.md`, so parallel pull requests never conflict on the same lines.

- Name: `<issue>-<topic>.md`, for example `174-changelog-fragments.md` (lowercase letters, digits and hyphens).
- Content: exactly one Markdown list item starting with `- `, written like the entries in `CHANGELOG.md`. It may wrap onto indented lines.
- Links are relative to the repository root, as they will appear in `CHANGELOG.md` (for example `[guide](docs/USER-GUIDE.md)`).

`npm run check` validates the fragments. `npm run changelog` prints the assembled Unreleased section. At release time, `npm run changelog -- --release <version> <YYYY-MM-DD>` moves the Unreleased entries and all fragments under the release heading and deletes the fragments (see [docs/RELEASES.md](../docs/RELEASES.md)).
