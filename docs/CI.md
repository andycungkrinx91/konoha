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

## Known state — run 42951648986 audit (branch 08ae0d0b vs master 513669d3)

- Baseline is now `master 513669d3` (PR #4 re-init purge + PR #6 harness
  seed-copy fix merged). The old `ERR_FS_CP_EINVAL` block at
  `tests/run_all.js:100` (Defect C) is dissolved — the harness runs every suite
  on both trees. The workflow header comment claiming otherwise is stale and
  gets fixed in Phase 1.
- Phase 0 per-suite audit, local reproduction via
  `node tests/run_all.js <basename>` in `/tmp/konoha-audit` (branch) and
  `/tmp/konoha-master` (master). Branch: 15 PASS / 19 FAIL across 34 suites.
  Master: 16 PASS / 19 FAIL across 35 logs (34 shared + 1 master-only).
- Split: 14 double-green, 18 double-red (pre-existing clean-checkout defects),
  1 branch-only red (`test_docs_index` — branch adds `docs/CI.md` without
  linking it from `docs/README.md`), 1 branch-PASS / master-FAIL
  (`test_yamanaka_compute_and_installer` — live Blender 5.3.0 sha256 URL 404s
  on the master run), 1 master-only new PASS (`test_reinit_migration_purge`,
  added by PR #4, absent on branch so the runner reports 0 discovered).
- Cause A (browser path): `tests/run_all.js:130` forwards external
  `PLAYWRIGHT_BROWSERS_PATH`, defaulting to `~/.cache/ms-playwright`
  (`:116-122`). The host cache holds chromium builds, so browser suites pass
  locally; bare CI runners lack that cache, so Phase 1 must install browsers.
- Cause D (engine gate): `src/workflow/akatsuki/lab.js:34-38` requires LXC on
  Linux and Docker on macOS/Windows with no silent fallback; `:424-430`
  declines with `DECLINE_NO_ENGINE`. The host has both (`lxc` at
  `/snap/bin/lxc`, `docker` at `/usr/bin/docker`); GitHub ubuntu ships Docker
  but not LXC and macOS ships neither, with no skip path — fail-closed by
  design.

| suite | branch 08ae0d0b | master 513669d3 | class | first failure |
| --- | --- | --- | --- | --- |
| test_agent_browser_provisioning | PASS | PASS | double-green | — |
| test_akatsuki_security_centralization | PASS | PASS | double-green | — |
| test_akatsuki_skill_authz_db_isolation | PASS | PASS | double-green | — |
| test_akatsuki_tool_registry | PASS | PASS | double-green | — |
| test_document_animation_webp | PASS | PASS | double-green | — |
| test_document_tools | PASS | PASS | double-green | — |
| test_fresh_install_cross_platform_sync | PASS | PASS | double-green | — |
| test_jonin_motion_3d_benchmark | PASS | PASS | double-green | — |
| test_rtk_cross_client | PASS | PASS | double-green | — |
| test_soul_skill_provenance | PASS | PASS | double-green | — |
| test_token_regression_gate | PASS | PASS | double-green | — |
| test_yamanaka_langgraph_pipeline | PASS | PASS | double-green | — |
| test_yamanaka_refine_fork | PASS | PASS | double-green | — |
| test_yamanaka_web_api | PASS | PASS | double-green | — |
| test_cli_implied_flags | FAIL | FAIL | double-red | README must document that embed implies --rebuild-embeddings |
| test_cli_removed_aliases_router | FAIL | FAIL | double-red | Router in bin/cli.js must NOT contain removed label: case 'update': |
| test_client_parity_without_9router | FAIL | FAIL | double-red | konoha server block differs between modes |
| test_diagram_sync | FAIL | FAIL | double-red | README.md intro must state 48 canonical tools |
| test_docs_currency | FAIL | FAIL | double-red | README must document master extension path |
| test_documentation_diagrams | FAIL | FAIL | double-red | README.md expected 3 mermaid blocks, found 1 |
| test_fts5_fallback | FAIL | FAIL | double-red | optimizeReport must find skill via fallback search |
| test_i_have_adhd_skill | FAIL | FAIL | double-red | agents.yaml: kage must NOT list i-have-adhd |
| test_lightweight_contracts | FAIL | FAIL | double-red | .cursor/rules/konoha.mdc must exist on disk |
| test_maintenance_skill_contract | FAIL | FAIL | double-red | src/templates/skills/konoha/SKILL.md missing: Konoha does not maintain filesystem mirrors |
| test_manifest_invariants | FAIL | FAIL | double-red | Unexpected root devDependencies (only the allowlisted test tooling is permitted): marked |
| test_no_hardcoded_homedir | FAIL | FAIL | double-red | Found hardcoded homedir violations: bin/lib/extension.js C:\Users\First |
| test_persona_memory | FAIL | FAIL | double-red | Web UI query with allSessions: true finds memories across sessions |
| test_project_skills_auto_migrate.test | FAIL | FAIL | double-red | Expected at least 1 match, got found:0 for test-project-ops |
| test_remediation_contract | FAIL | FAIL | double-red | jonin prompt is missing "Fixing remediation" |
| test_skill_retrieval_precedence | FAIL | FAIL | double-red | Primary skill must be retrieved: Skill 'sqlite-primary-skill' not found |
| test_structured_delegation | FAIL | FAIL | double-red | resJonin.instructions.includes('Taste-Skill Design Engine') |
| test_tool_count_repo_wide_sync | FAIL | FAIL | double-red | [README.md] Missing expected count text: "The unified `konoha` server exposes 48 canonical tools" |
| test_docs_index | FAIL | PASS | branch-only red | group 1: live file not linked from docs/README.md: docs/CI.md |
| test_yamanaka_compute_and_installer | PASS | FAIL | master-only red (network) | HTTP 404 fetching blender-5.3.0-linux-x64.tar.xz.sha256 |
| test_reinit_migration_purge | N/A (absent on branch, 0 discovered) | PASS | master-only new (PR #4) | — |

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
The harness seed-copy fix (PR #6) has landed on master, so a red test step is now
a real suite signal — not a harness block. The table above is the current red
baseline; Phase 2–3 work it down to green.
