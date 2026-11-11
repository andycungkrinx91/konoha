# Cross-Platform CI

## What runs

The `Cross-Platform` workflow (`.github/workflows/cross-platform.yml`) runs the repo
checks on **ubuntu-latest, windows-latest, and macos-latest** for every push to
`master`, every pull request, and on manual dispatch (`workflow_dispatch`). It never
publishes anything — the tag-only `publish.yml` and `release-assets.yml` workflows
still own releases.

Each OS runs the same job (Node 24, pnpm 12.16.1, setup reused exactly from
`publish.yml`):

1. `pnpm install --frozen-lockfile`
2. `pnpm lint`
3. `pnpm test` — the full suite via `tests/run_all.js`, in the harness's own parallel
   mode (`KONOHA_TEST_PARALLEL=1`, concurrency 4). No `continue-on-error`: a failing
   suite turns the workflow red.
4. Fresh-install smoke test — `node bin/cli.js init --yes --no-project`, then
   `node bin/cli.js migrate`, then `node bin/cli.js version`, with a throwaway
   `HOME`/`USERPROFILE`. The CLI entry point is invoked directly (`bin: konoha ->
   bin/cli.js`) so no global install or PATH resolution is involved.

`fail-fast` is off: one OS failing never cancels the other two, so every run reports
a per-OS result. A `concurrency` group cancels superseded runs on the same branch.
Permissions are `contents: read` only.

## Known state — read this before panicking about a red run

- **The `pnpm test` step is currently red on all three OSes.** The test harness itself
  is blocked at suite 1 by `ERR_FS_CP_EINVAL` (`tests/run_all.js:100`, golden-seed
  copy; pre-existing since 2.2.18, Defect C in the v2.2.20 release review). PR #6
  (`fix/harness-seed-copy-einval`) fixes it and is unmerged. The workflow surfaces
  that failure honestly; it does not hide it. The workflow turns green once the
  harness fix lands. The smoke-test step is skipped whenever the test step fails
  (standard fail-fast step ordering), so a red test step also means no smoke signal
  from that run.
- **F42** (`tests/test_akatsuki_skill_authz_db_isolation.js:543`, "an allowed red
  workflow audits the identity the gate resolved, not an option echo") fails closed
  (`blocked` vs `completed`) when no container engine is present:
  `validateLabPrerequisites` declines with `DECLINE_NO_ENGINE`. The engine required
  is LXC on Linux and Docker on Windows/macOS. GitHub's ubuntu runners ship Docker
  but not LXC; macOS runners ship neither. The harness has no skip path for this case
  (the test sets `skip_container_exec` but not `skip_container_precheck`), and the
  fail-closed behaviour is by design — so F42 is a known environment-dependent
  failure, not a product bug. It is reported, never counted as a pass, and never
  faked green.
- **`konoha doctor` is not part of this workflow.** Plain `doctor` runs its full
  self-test (the whole suite) whenever repairs occur, and a fresh home auto-repairs
  on first run — so it would duplicate the suite above for hours and go red for the
  same harness reason. Its diagnostics stay covered by the release-review process
  (fresh-install review on every new tag). Re-add it once the harness is green.

## How to read a failure

Open the failed run from the Checks tab of the pull request (or Actions →
Cross-Platform), pick the failed OS job, and expand the failed step. The step names
are the checklist: Install dependencies, Lint, Test (full suite), Fresh-install
smoke test. A failure in `Test (full suite)` names the failing suite file; the
harness log shows the first failing assertion. A failure in the smoke test names the
CLI command that exited non-zero.

## How to re-run

- From the Actions tab: Cross-Platform → Run workflow (manual dispatch), or
  re-run a failed job from the run page (Re-run failed jobs).
- From a pull request: the workflow runs automatically on every push to the PR
  branch. Pushing an empty commit re-runs it; prefer re-running failed jobs from
  the run page instead.

## Trust rule

This workflow is only trusted once it has been seen **both green and red**. A red
run proves it can fail; a green run on all three OSes proves the checks pass there.
Until the harness fix (PR #6) is merged, expect red on the test step — that red run
is the proof the workflow fails honestly.
