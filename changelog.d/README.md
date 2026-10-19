# Unreleased changelog fragments

A pull request with a user-visible change adds one file here instead of editing `CHANGELOG.md`, so parallel pull requests never conflict on the same lines.

- Name: `<issue>-<topic>.md`, for example `174-changelog-fragments.md` (lowercase letters, digits and hyphens).
- Content: exactly one Markdown list item starting with `- `, written like the entries in `CHANGELOG.md`. It may wrap onto indented lines.
- Links are relative to the repository root, as they will appear in `CHANGELOG.md` (for example `[guide](docs/USER-GUIDE.md)`).

## Upgrade notes

When a change also affects an **existing installation** at update time, add a second fragment `<issue>-<topic>.upgrade.md` beside the change fragment. It is one list item in the same format, opening with a bold instruction, for example `- **Check config.json with the new image first.** …`. Write one when the change:

- needs a check or action before updating (a configuration the new version refuses, a new mapping or variable);
- is one-way, or makes a return to the previous version behave differently;
- shows new states or attention on existing data right after the update;
- prepares, recalculates or rereads existing data after the update, with the extra load it causes.

A release puts these notes under `### Before updating`, ahead of the changes under `### Changes`.

`npm run check` validates the fragments. `npm run changelog` prints the assembled Unreleased section. At release time, `npm run changelog -- --release <version> <YYYY-MM-DD>` moves the Unreleased entries and all fragments under the release heading and deletes the fragments (see [docs/RELEASES.md](../docs/RELEASES.md)).
