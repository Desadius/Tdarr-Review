# Separate source, image and deployment updates

Prepare and test a version before requesting publication approval. Record its changes and test results in the changelog and verification document.

Unreleased changes are fragments in `changelog.d/` (see [its README](../changelog.d/README.md)). When preparing a release, run `npm run changelog -- --release <version> <YYYY-MM-DD>`: it moves the Unreleased entries and all fragments under the new version heading in `CHANGELOG.md` and deletes the fragments. Upgrade-note fragments (`*.upgrade.md`) become its `### Before updating` section. Commit that change with the version bump; it is part of the source publication and needs the same approval.

To review what changed since the previous release, start from its release commit. Each one is titled `Prepare the <version> release`, also where no `v<version>` tag exists (2.0.0): `git log --oneline --no-merges --grep '^Prepare the .* release$' origin/main` lists them, and `git log --first-parent <commit>..origin/main` lists the merged pull requests since.

`package.json` holds the version. When preparing a release, set the same value as the `ARG APP_VERSION` default in `Dockerfile` and as `REVIEW_IMAGE_TAG` in `.env.example`, and in `README.md` and `docs/INSTALL-UNRAID.md` (the release line, every `tdarr-review:<version>` image tag and `REVIEW_IMAGE_TAG=<version>`); `npm run check` fails while any of them disagrees and names the line. Review reports the version from the image's `APP_VERSION` (set from the build argument) or, in a source checkout, from `package.json`. Other version numbers in the documentation are prose and are updated by hand; documents about an older version (for example the 2.0 migration guide) keep theirs.

Since 2.0.0 there is one image, `ghcr.io/desadius/tdarr-review`, which contains Recovery. The separate Recovery image and the Compose `recovery` service are discontinued; release notes and the update step point users of the former two-container setup to [the 2.0 migration guide](MIGRATE-TO-2.0.md).

1. **Publish source after approval.** Push the selected source commit to `main`. The `Tests and Docker smoke` workflow checks JavaScript, runs regression tests, builds the image and exercises disposable fixtures. It has no registry write permission. A push or `v*` tag does not publish a Docker image.
2. **Publish Docker images after separate approval.** In GitHub Actions select `Publish Docker images (manual)`, run it from `main`, and enter the approved full lowercase 40-character commit SHA. The workflow rejects a commit outside `main` history, checks out that exact source, reruns tests and builds/smoke-tests the image. It then publishes `sha-<commit>` and the version from `package.json`. Keep `publish_latest` disabled unless moving `latest` was explicitly approved. This workflow does not deploy to Unraid.
3. **Update the running container after approval.** Complete [the idle and backup checks](OPERATIONS.md#update-an-existing-deployment), select the approved image tag or digest and update the Review container. An installation that still runs the separate Recovery container moves with [the 2.0 migration guide](MIGRATE-TO-2.0.md). Verify the visible version, login, replacement records and existing transaction state. Do not approve a real movie as an installation test.

Example manual image publication using GitHub CLI, **only after image publication approval**:

```bash
gh workflow run publish.yml --ref main \
  -f commit=FULL_APPROVED_40_CHARACTER_COMMIT_SHA \
  -f publish_latest=false
```

Set `publish_latest=true` only when that update is part of the approval. Publishing the image makes it available to others; it does not imply permission to restart an existing installation.

### Move latest to a verified image without rebuilding

A publication rebuilds the image, so running it again with `publish_latest=true` after the installation was verified would point `latest` (and the version tag) at a new build with a different digest. To move only `latest` to exactly the image that was verified, **only after approval to move `latest`**, enter the verified digest as `promote_digest`:

```bash
gh workflow run publish.yml --ref main \
  -f commit=FULL_APPROVED_40_CHARACTER_COMMIT_SHA \
  -f promote_digest=sha256:VERIFIED_DIGEST \
  -f publish_latest=true
```

Take the digest from the running installation, not from the `sha-<commit>` tag, which a repeated publication moves: `docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' ghcr.io/desadius/tdarr-review:2.0.0 | grep '^ghcr.io/desadius/tdarr-review@'` prints it after the `@`. The promotion job builds and tests nothing. It refuses before any registry write when `publish_latest` is not set or the commit is not in `main` history, and `tools/promote-latest.mjs` then refuses when the digest is malformed, missing from GHCR or cannot be inspected (the registry's error is shown), or when the image's `org.opencontainers.image.revision` label (set from `VCS_REF`) is not the given commit. Any earlier `main` commit is accepted, so the same step moves `latest` back to an older verified image. It then copies the manifest to `latest` with `docker buildx imagetools create --prefer-index=false`, so the digest stays the same, and checks that `latest` resolves to it. The version tag and `sha-<commit>` are not changed. The step summary names the digest of `latest` before and after.

The workflow uses GitHub's [manual dispatch inputs and job-level permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax). Dispatch inputs are passed through environment variables and validated before use in commands. A failed test or image smoke check prevents registry login and publication.

## Release pull request description

The release pull request is where the maintainer approves publication, so its description carries the exact steps. Copy this part, with the version filled in and nothing else changed; it is the single source for these steps, so earlier release pull requests are not templates.

````markdown
## After merge: publish the image without `latest` (only with your approval)

1. Approve the **merge commit on `main`**; its `package.json` version becomes the image tag `<version>`. Get its full SHA:

   ```bash
   git fetch origin && git rev-parse origin/main   # full lowercase 40-character SHA
   ```

2. **GitHub UI:** Actions → **Publish Docker images (manual)** → *Run workflow*: *Use workflow from* **Branch: main**; **commit** the SHA from step 1; **publish_latest** unchecked; **promote_digest** empty (a value runs the promotion job instead of a build). **GitHub CLI**, the same:

   ```bash
   gh workflow run publish.yml --ref main \
     -f commit=<FULL_40_CHAR_MERGE_SHA> \
     -f publish_latest=false
   ```

   It publishes only `ghcr.io/desadius/tdarr-review:<version>` and `:sha-<commit>`; `latest` is unchanged.

3. Optionally note the digest GHCR assigned: `docker buildx imagetools inspect ghcr.io/desadius/tdarr-review:<version> | grep '^Digest:'`.

## Later: promote the verified image to `latest`

After the installation runs `<version>` and is verified, read the digest of the image the running container uses (`CONTAINER` is its name):

```bash
docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' \
  "$(docker inspect --format '{{.Image}}' CONTAINER)" | grep '^ghcr.io/desadius/tdarr-review@'
```

It should equal the digest from step 3. Then, only after approval to move `latest`:

```bash
gh workflow run publish.yml --ref main \
  -f commit=<FULL_40_CHAR_MERGE_SHA> \
  -f promote_digest=sha256:<digest> \
  -f publish_latest=true
```

Separate steps not done by the pull request: the `v<version>` tag / GitHub release and updating the installation.
````

Above that part the description lists the version decision (and any change that could be breaking), the `### Before updating` section from `CHANGELOG.md` when there is one, what was tested and the assumptions.
