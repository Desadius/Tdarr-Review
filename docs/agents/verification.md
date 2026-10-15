# Verification evidence

Use this procedure when proving the behaviours required by [CODING_STANDARDS.md](../../CODING_STANDARDS.md). Commands and environment requirements live in [DEVELOPMENT.md](../DEVELOPMENT.md).

## Red → green and mutations

1. Identify each changed behaviour and the test that observes it. Record the tested commit, command, platform and any skips. A skipped test provides no red or green evidence.
2. Capture the actual failing assertion before the fix. Missing imports, exports and syntax errors do not prove behaviour. For negative cases, existing behaviour and refactors, deliberately break one behaviour and run its targeted tests. Confirm they fail for that reason; an unrelated failure does not count.
3. Keep mutation scripts and raw output in temporary storage outside the repository. Save the original bytes before changing a file and restore them in a `finally` block or shell trap, including on failure. Apply one mutation at a time, check that the intended replacement occurred exactly once, and inspect the diff after restoration. Preserve pre-existing work.
4. Run the targeted tests green against the restored implementation, then the required final checks. Before committing, confirm no mutation, temporary runner or generated report remains in the diff.

Distinguish historical implementation reds from later mutation replays. Report only observed output; do not reconstruct earlier assertions or describe a mutation replay as a historical red.

## Linux and CI mutations

Prefer local WSL2/Linux for Linux-only tests. When CI is needed, use a disposable branch and worktree based on the exact PR commit; keep deliberate regressions off the PR branch. Push the disposable branch and dispatch the existing `Linux tests (manual)` workflow against it with the suite files and test-name pattern described in [DEVELOPMENT.md](../DEVELOPMENT.md#linux-tests-without-a-local-linux). Workflow dispatch requires the workflow to exist on the default branch.

Record the run URL and tested SHA, check the actual assertion in the logs, and verify the selected test ran rather than skipped. If a workflow is not yet on `main`, a temporary push-triggered workflow on the disposable branch can run the selected synthetic tests with read-only permissions. Keep its scope limited to testing; follow `AGENTS.md` for publication and production approvals.

After collecting evidence, remove the disposable remote branch and worktree. Verify the restored PR commit passes its normal CI checks. Expected red mutation runs are evidence, not passing PR validation.

## Where evidence lives

Post red → green tables, mutation matrices and captured assertion excerpts as a **comment on the relevant PR**, using `gh pr comment <number> --body-file <file>`. Link that comment from the PR description. Include behaviour, test/command, observed red or mutation, restored green result, commit/platform and CI run links where applicable. For documentation-only changes, report documentation checks and required suite results without inventing a behavioural red.

Keep these per-PR reports out of tracked files, including `docs/verification/`. Repository docs hold reusable procedures; regression tests remain in the normal test suites. When migrating an existing report, post its full contents to the original PR and verify the comment before deleting the tracked file. Preserve provenance and links, and distinguish historical results from new runs.
