# Separate source, image and deployment updates

Prepare and test a version before requesting publication approval. Record its changes and test results in the changelog and verification document.

1. **Publish source after approval.** Push the selected source commit to `main`. The `Tests and Docker smoke` workflow checks JavaScript, runs regression tests, builds both images and exercises disposable fixtures. It has no registry write permission. A push or `v*` tag does not publish a Docker image.
2. **Publish Docker images after separate approval.** In GitHub Actions select `Publish Docker images (manual)`, run it from `main`, and enter the approved full lowercase 40-character commit SHA. The workflow rejects a commit outside `main` history, checks out that exact source, reruns tests and builds/smoke-tests both images. It then publishes `sha-<commit>` and the version from `package.json`. Keep `publish_latest` disabled unless moving `latest` was explicitly approved. This workflow does not deploy to Unraid.
3. **Update the running containers after approval.** Complete [the idle and backup checks](OPERATIONS.md#update-an-existing-deployment), select the approved image tag or digest and update only the affected service. Verify the visible version, login, replacement records and existing transaction state. Do not approve a real movie as an installation test.

Example manual image publication using GitHub CLI, **only after image publication approval**:

```bash
gh workflow run publish.yml --ref main \
  -f commit=FULL_APPROVED_40_CHARACTER_COMMIT_SHA \
  -f publish_latest=false
```

Set `publish_latest=true` only when that update is part of the approval. Publishing the image makes it available to others; it does not imply permission to restart an existing installation.

The workflow uses GitHub's [manual dispatch inputs and job-level permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax). Dispatch inputs are passed through environment variables and validated before use in commands. A failed test or image smoke check prevents registry login and publication.
