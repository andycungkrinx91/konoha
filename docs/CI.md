# Cross-Platform CI

## What runs

The `Cross-Platform` workflow (`.github/workflows/cross-platform.yml`) runs the repo
checks on **ubuntu-latest, windows-latest, and macos-latest** for every push to
`master`, every pull request, and on manual dispatch (`workflow_dispatch`). It never
publishes anything — the tag-only `publish.yml` and `release-assets.yml` workflows
still own releases.

There are two jobs per OS (Node 24, pnpm 12.16.1, setup reused exactly from
`publish.yml`).

`checks` — cheap, once per OS, no seed and no Playwright browsers:

1. `pnpm install --frozen-lockfile`
2. `pnpm lint`
3. Fresh-install smoke test — `node bin/cli.js init --yes --no-project`, then
   `node bin/cli.js migrate --skip-embeddings`, then `node bin/cli.js version`, with a
   throwaway `HOME`/`USERPROFILE`. The CLI entry point is invoked directly (`bin:
   konoha -> bin/cli.js`) so no global install or PATH resolution is involved.
   `--skip-embeddings` keeps the gate about the CLI: embedding coverage is asserted
   by the suite job, and an unbounded Hugging Face download here would turn a
   network hiccup into a fake cross-platform failure.

`test` — eight shards per OS, `KONOHA_TEST_SHARD=<shard>/8`:

1. `pnpm install --frozen-lockfile`
2. `pnpm --filter konoha-web build` — before the seed, because `konoha init` builds the
   UI on demand when no build of the current version exists; with the repo build
   present the seed copies it instead of running a second SvelteKit build.
3. Restore the golden seed cache, build it only on a miss (`node tests/run_all.js
   --seed-only` with `KONOHA_SEED_DIR`), then save it explicitly.
4. Playwright browsers (cached) and the ffmpeg `libwebp_anim` check.
5. `pnpm test` — this shard's slice of the suite via `tests/run_all.js`, in the
   harness's own parallel mode (`KONOHA_TEST_PARALLEL=1`, concurrency 4), reusing
   the restored seed. No `continue-on-error`: a failing suite turns the workflow red.

`fail-fast` is off: one OS or shard failing never cancels the others, so every run
reports a per-OS, per-shard result. A `concurrency` group cancels superseded runs on
the same branch. Permissions are `contents: read` only.

### Ubuntu leg and distro compatibility

The Linux leg follows `ubuntu-latest`, which migrated to Ubuntu 26.04 in September 2026.
That is safe for this repo because nothing in the dependency graph is compiled against
the host: the four `.node` artifacts under `node_modules` are prebuilt `linux-x64-gnu`
napi binaries (rolldown, lightningcss ×2, Tailwind's oxide) published against an older
glibc, and a binary built against an older glibc runs on a newer one. Playwright 1.64.1
maps `ubuntu26.04` explicitly, so `playwright install --with-deps` resolves the right
apt set rather than guessing. Every external command the suites spawn — `git`, `ffmpeg`,
`python3`, `unzip`, `tar`, poppler's `pdfinfo`/`pdftotext`/`pdffonts` — ships in the
runner image on 22.04, 24.04 and 26.04 alike.

The compatibility direction matters: green on 26.04 does not prove a developer machine
on 22.04. It holds today because no addon is compiled at install time; the day one is,
its artifact would require the runner's glibc and break older hosts. If 22.04 support
ever becomes a promise, add one unsharded `ubuntu-22.04` leg rather than a ninth shard
per release — a run is already 27 jobs against a 20-job plan cap.

## Duration budget

Targets, wall clock per run: ubuntu < 10 min, macOS < 20 min, Windows < 40 min.

Only one of the two terms in that budget has been measured. Suite work has, on this
repo's 16-core host with a warm seed: the eight shards run back to back took 941 s of
wall clock in total, every shard green, and the slowest single shard took 175 s
(`[SHARD] 5/8`, 35 suites). In CI the shards run on eight runners, so the wall clock for
the step is the slowest shard, not the sum.

The split pays for itself beyond the per-job limit. One job running the whole discovered
list through this harness took 1720 s (288 suites: 285 passed, 3 failed — the run that
motivated this work). The gate tree is that list minus the six Yamanaka suites, which
carry 338 s of measured suite time, so one job over the gate tree is roughly 1380 s.
The eight shards summed to 941 s, because each gets its own four workers and its own
short tail instead of queueing behind the whole list.

That is why the count is 8. The pre-implementation model — round-robin over the measured
per-suite durations, 4 greedy workers per shard — predicted a worst shard of 240 s at
N=8, 316 s at N=6 and 406 s at N=4, from 6245 s of gate suite time. The measurement came
in under it; the model was conservative because those per-suite durations were taken
under contention.

The other term — install, seed restore, Playwright, web build, ffmpeg — has **not** been
measured on a runner, and it is what decides the verdict on a cold cache. Locally those
steps are fast (a seed cache hit is 0.4 s, the web build is seconds), but a hosted runner
is slower and the seed restore pulls ~400 MB out of the cache. Treat it as a minute or
two, not as a number.

A run is 3 `checks` jobs plus 24 shard jobs. A plan capped at 20 concurrent jobs therefore
queues the surplus, and a queued job's wall clock includes the wait — so on such a plan the
per-OS numbers above are job durations, not run durations. The cap has not been observed
on this repository; if a run looks slower than the sum of its steps, read the queue time
before reading it as a regression.

| OS | Target | Slowest shard (Linux, measured) | Fixed cost | Verdict |
| --- | --- | --- | --- | --- |
| ubuntu-latest | < 10 min | 175 s (measured) | unmeasured | headroom is large; confirm on the first run |
| macos-latest | < 20 min | unverified | unmeasured | unverified |
| windows-latest | < 40 min | 1013 s (shard 8, measured) | unmeasured | under target if fixed cost stays small; one shard observed |

Why the count is uniform rather than smaller on macOS and Windows: their multipliers
are unmeasured, and Windows is the platform this work exists for. Sizing it down on the
strength of a number nobody has taken would be guesswork, and the only cost of the
larger count is runner minutes, which is not the constraint.

**A cache miss adds the seed build to every shard.** The seed is content-addressed by
`src`/`bin`/`scripts`, so a PR touching any of them misses, and each shard pays its own
~241 s build — in parallel, so wall clock grows by that much once rather than 8 times.
Removing it needs the seed to stop depending on `src`, which it does not yet.

Sharding is round-robin over the alphabetically discovered list
(`tests/helpers/shard.js`), not contiguous chunks: discovery order is alphabetical and
the slow suites are not spread evenly through it, so contiguous slices hand one shard
most of the long ones. Round-robin needs no duration data, so a fresh checkout shards
identically to the machine that measured it.

Two properties are enforced at runtime, because both used to fail open — a run could go
green having executed nothing:

- A `--shard` / `KONOHA_TEST_SHARD` value that does not parse, or whose index is out of
  range, exits 2 with the reason. It used to be ignored and the full suite ran.
- A shard that selects zero suites exits 2 and says so. It used to exit 0.

That the eight shards partition the suite list exactly once is asserted in
`tests/test_test_sharding.js`, together with the size balance and both refusal paths
above (the refusals are checked by spawning the real harness, so a helper that is
correct but unused would not pass).

## The Windows leg, first measurement

One real `windows-latest` run of shard 8 (`35 of 283 suites`, warm seed, `[SEED] Seed check:
0.2s`) reported **2681 s of summed suite time and 1013 s of wall clock**, against 811 s and
103.7 s for the same suites on this host. That is 3.3x on suite work and 9.8x on the shard.

The slowdown is not uniform and it is not explained by subprocess count: correlating each
suite's spawn calls against its Windows/Linux ratio gives r = 0.05, so "suites that shell out
are the slow ones" is not a usable model. The spread runs from 0.26x (`test_workflow_loop.js`,
faster on Windows) to 15.7x (`test_all_assets_webp.js`). The fastest suites cluster at
29-32 s on Windows against 3-25 s on Linux, which looks like a per-suite floor rather than
scaled work; what produces it has not been identified, and guessing at it would be worse than
leaving it open.

At most 343 s of the 1013 s is outside every reported number: 2681/4 = 670 s is what the
durations imply for four workers, and the rest is work no suite is charged for. Some of it is
unavoidable tail, but the bulk is the seed snapshot — the timer starts after
`createSuiteSnapshot()`, so the ~400 MB copy is harness overhead. Windows has no `cp`, so
`copySeedDir` falls through to `fs.cpSync` and copies ~8k files per suite, 35 times per shard.
A single-threaded `cpSync` of that tree measured 10.2 s on the local Windows VM; four of them
competing for one disk is the plausible shape of the rest, but that is inference, not a
measurement taken under CI's concurrency.

Two things follow. Shard 8 is not known to be the worst Windows shard — only one has been
observed — so do not rebalance on it. And 1013 s of suite work still sits under the 40-minute
target with room for a cold seed, but the headroom is smaller than the Linux numbers suggest.

## Golden seed cache

Every suite runs against a throwaway copy of one golden seed — a full `konoha init`
HOME. Building it is the single most expensive fixed cost in the job, and it used to be
paid by whichever suite started first while the other three workers sat idle:

| Leg | Seed build, cold |
| --- | --- |
| Linux (16-core host, measured) | 241 s |
| Windows (VM, measured) | 262 s |

The workflow now builds the seed in its own step and caches it:

- Key: `konoha-seed-<os>-<hashFiles(package.json, pnpm-lock.yaml, src/**, bin/**, scripts/**)>`.
  That is exactly the tree `tests/run_all.js` stamps into `.auto_setup_state.json`
  (`sourceFingerprint`), so a cache hit is provably a seed this commit accepts; anything
  else is a miss and rebuilds.
- `KONOHA_SEED_DIR` names the restored directory. When set it is authoritative: the
  harness will not fall back to an unrelated seed in the temp dir, so a cache miss
  cannot silently reuse stale state and leave the cache path empty.
- `--seed-only` builds the seed and exits, so the cache step does not also run the suite.
  The suite step logs `[SEED] Seed check: Ns` before the first suite, which is how you
  tell a cache hit from a rebuild in the job log.
- Save is explicit (`actions/cache/save`) rather than the restore action's post-step:
  the post-step is skipped on a red job, and a failing suite would otherwise re-pay the
  build on every following run.
- A `KONOHA_SEED_DIR` that points at a non-empty directory which is not a seed is
  refused with a non-zero exit, not deleted — the guard is what makes it safe to hand a
  cache path to a process that may decide to rebuild.

Cache hit measured at 0.4 s versus 241 s to rebuild. Cached size is roughly 400 MB per
OS against the 10 GB per-repo cache budget.

`.konoha/node_modules` inside the seed is a link to the checkout's `node_modules`. `cp -a`
preserves it in one syscall; Windows has no `cp`, and `fs.cpSync` would have to recreate the
symlink, which there needs Developer Mode or elevation. When that fails the walk covers the
whole dependency tree — ~21k files, ~400 MB — once per suite. The harness therefore excludes
that one path from the `cpSync` fallback and rebuilds it as a junction, which needs no
privilege on Windows, after the copy.

## Audit history — run 42951648986 (branch 08ae0d0b vs master 513669d3)

This section is kept as the record of what the first run found and how each failure
was classified. Every row below is now green; see
[Root causes fixed](#root-causes-fixed) for what changed.

- Baseline is `master 513669d3` (PR #4 re-init purge + PR #6 harness seed-copy fix
  merged). The old `ERR_FS_CP_EINVAL` block at `tests/run_all.js:100` (Defect C) is
  dissolved — the harness runs every suite on both trees.
- Per-suite audit by local reproduction via `node tests/run_all.js <basename>` on a
  branch worktree and a master worktree. Branch: 15 PASS / 19 FAIL across 34 suites.
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
  locally; bare CI runners lack that cache, so the workflow installs browsers.
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

## Root causes fixed

Each red row was fixed at its cause. No suite was greened by relaxing an
expectation, and no `continue-on-error` was added anywhere.

- **Portable environment (test_client_parity_without_9router)** — the assertion
  compared two sandboxed runs and tripped on the sandbox-baked `PATH` inside the
  `konoha` stdio entry, not on 9router. The test now normalizes `env.PATH` before
  the comparison, so it measures what it claims: the Claude Code registration is
  identical whether or not 9router is installed.
- **Skill retrieval (test_fts5_fallback, test_skill_retrieval_precedence)** —
  `src/mcp/skills_common.js` gained `isSkillRowVisible`. Retrieval treats a
  registered SQLite row as served, while `isPathVisible` stays the
  discovery-only filesystem guard, so per-project scoping survives and
  `migrate`-registered rows are no longer dropped.
- **Persona memory (test_persona_memory)** — `appendSessionFilter` returns an
  empty clause when `allSessions` is set without a project hash, instead of
  emitting `AND session_id = ?` with no bound parameter.
- **Prompt budget (test_remediation_contract, test_structured_delegation,
  test_taste_skill_jonin)** — `src/mcp/memory_subagent_runner.js` dropped the
  duplicated base-personality block and tightened the taste-skill brief. The
  8000-byte ceiling was not raised; the worst agent prompt is now 7962 B and
  still carries every remediation stage.
- **Contracts and aliases (test_cli_removed_aliases_router, test_lightweight_contracts,
  test_no_hardcoded_homedir, test_i_have_adhd_skill, test_maintenance_skill_contract)** —
  removed the dead `update` alias from the router and the help table, replaced a
  hardcoded Windows home path with a generic comment, dropped the stale
  `i-have-adhd` mappings from `kage` and `yamanaka` so the skill maps to exactly
  the six output-discipline agents, and documented that Konoha keeps no
  filesystem mirrors of client skills.
- **Docs (test_docs_index, test_diagram_sync, test_docs_currency,
  test_documentation_diagrams, test_tool_count_repo_wide_sync,
  test_cli_implied_flags)** — `docs/CI.md` is linked from `docs/README.md`, the
  README states the 48-tool count and the master extension path, the three
  mermaid blocks are back, and `embed`/`reinstall` implications are documented.
- **Manual PDF build (test_manifest_invariants)** — `marked` is a managed root
  dependency resolved through the lockfile, not a vendored UMD copy.
- **`test_web_ui` teardown exit 1 (`src/doctor_3d.js`)** — diagnostics called the
  async `resolveLatestDccMcpVersion()` without awaiting it, so its `fetch` stayed
  alive behind a 20 s `AbortSignal.timeout`. Under parallel load the timeout fired
  after the suite printed its final `✓` and the unhandled rejection killed the
  process with `DOMException [TimeoutError]`. Diagnostics is synchronous by
  design, so `blender_installer` now exports a cache-only
  `getCachedDccMcpVersion()` and doctor starts no network request.
- **Red-team suite (test_akatsuki_tool_registry)** — every workflow call went in
  without sandbox options, so `_verifyRedTeamPrerequisites` →
  `validateLabPrerequisites` declined with `DECLINE_NO_ENGINE` on runners that
  have neither LXC nor Docker, and the assertions read `tools_blocked` off a
  blocked result. The suite now injects a mocked engine, runner, lab status and
  cleanup result the way `test_akatsuki_init` does, so it asserts the planner and
  the gate instead of the host.
- **Animated WebP (test_document_animation_webp)** — the encoder probe ran
  `spawnSync('which', ['ffmpeg'])`, which does not exist on Windows, so every
  export fell back to a static PNG and the default-format assertion failed. The
  probe is now `ffmpeg -hide_banner -encoders` matched against `libwebp_anim` and
  `gif`, and the workflow provisions an ffmpeg build carrying `libwebp_anim` and
  verifies the encoder before the suite runs. On macOS that provisioning first
  ran `brew install ffmpeg`, and homebrew-core's `ffmpeg` formula is configured
  without `--enable-libwebp`, so the binary it installed still had no
  `libwebp_anim` encoder; the step installs `ffmpeg-full` instead and appends its
  keg-only bin directory to `PATH`.
- **pnpm resolution (test_agent_browser_provisioning)** — superseded. That suite
  and the `agent-browser` provisioning chain it exercised are deleted; QA now runs
  on the target project's own Playwright, so there is no CLI to resolve and no
  package-manager search path to get wrong. See `CHANGELOG.md` `[Unreleased]`.
- **Cursor rtk rule (test_fresh_install_cross_platform_sync)** —
  `deployCursorRtkRule` returned early with `rtk-not-installed` before copying the
  rule template, so `~/.cursor/rules/rtk.mdc` never landed on a machine without
  the `rtk` binary even though the template is static. Only the `rtk init`
  enrichment is conditional now.
- **Claude rtk rule (test_fresh_install_cross_platform_sync)** — same bug as the Cursor
  one, one client later: `deployClaudeCodeRtkRule` returned `rtk-not-installed` before
  copying the static template, so `~/.claude/rules/rtk.md` only existed on hosts that
  already had `rtk` on `PATH`. The same gate sat in the Codex, OpenCode, OMP and
  CommandCode deploy paths. The container sandbox has no `rtk`, which is what surfaced
  it: the templates now deploy unconditionally, and only the `rtk init` enrichment stays
  conditional. `test_rtk_cross_client` asserted `initRtkHook()` succeeds with no binary on
  `PATH`; it now asserts the `rtk-not-installed` reason instead.
- **3D model catalog (test_yamanaka_web_api)** — the suite asserted a non-null
  `client_default_model` without controlling where discovery looks. `discoverClientModels`
  reads the host's `~/.codex`, `~/.claude`, `~/.cursor` and similar configs, so the
  assertion held on a laptop that had a client configured and failed on any clean runner.
  The suite now pins `HOME` to a temp directory with one seeded `.codex/config.toml`, so
  the endpoint is asserted against a known catalog instead of the developer's machine.
  Pinning `HOME` alone was still not enough on Windows: `os.homedir()` reads
  `USERPROFILE` there and ignores `HOME`, so the seeded config was never opened and
  `client_default_model` came back `null`. Both variables are pinned now.
- **Worktree list spelling (test_worktree_isolation)** — the suite matched the
  dispatched worktree path against `git worktree list --porcelain` with a
  separator-normalized substring test. On win32 git re-spells the recorded path, so
  the 8.3 `RUNNER~1` short name in
  `C:\Users\RUNNER~1\AppData\Local\Temp\konoha-worktrees\...` did not appear in
  the listing as written and the assertion failed for a worktree git had registered
  correctly. Both sides now resolve through `fs.realpathSync.native` before comparing,
  and the message prints the paths git actually listed.
- **Blender archive digest (test_yamanaka_compute_and_installer)** — Blender 5.3
  publishes a single `blender-<version>.sha256` sidecar listing every archive, not the
  per-file `<archive>.sha256` the installer fetched, so the install aborted with
  `HTTP 404` before the download. `resolveExpectedDigest` reads the version-wide sidecar
  and falls back to the per-file one; a missing sidecar is reported as unsigned rather
  than failing an otherwise valid archive.
- **Agentic session failure shape (test_yamanaka_compute_and_installer)** — the early
  failure returns in `executeLiveAgenticBlenderSession` (`circuit_open`,
  `missing_base_glb`, `blender_missing`) carried `actions: []` but no `steps_executed`,
  so a caller reading the step count got `undefined`. The suite only reaches those paths
  on a host without Blender, which is every CI runner. They now report `steps_executed: 0`.
- **Lightweight contracts (test_lightweight_contracts)** — the suite asserted
  sizes of `~/.cursor`, `~/.codex` and `~/.omp` files inside the checkout, but
  those are git-ignored per-machine output of `konoha init`. It now deploys the
  artifacts into a temp `HOME` and measures them there, and asserts the `<1800`
  byte budget on `buildLightweightContract({ client })` for every client.

The engine gate (`src/workflow/akatsuki/lab.js`) still fails closed on a host with
neither LXC nor Docker. That is product behavior, so the suite supplies a mocked
engine instead of weakening the gate.

## How to read a failure

Open the failed run from the Checks tab of the pull request (or Actions →
Cross-Platform), pick the failed job, and expand the failed step. Job names carry the
OS and, for the suite, the shard: `<os> checks` and `<os> shard <n>/8`.

- `checks`: Install dependencies, Lint, Fresh-install smoke test. A lint failure names
  the file and rule; a smoke-test failure names the CLI command that exited non-zero.
- `shard <n>/8`: the setup steps (seed, Playwright, web build, ffmpeg) then
  `Test (shard)`. A failure there names the failing suite file and the harness log
  shows the first failing assertion. The first line of that step's log,
  `[SHARD] <n>/8: <k> of <total> suites`, says what this shard was responsible for,
  which is what distinguishes "this suite broke" from "this shard got the wrong list".

## How to re-run

- From the Actions tab: Cross-Platform → Run workflow (manual dispatch), or
  re-run a failed job from the run page (Re-run failed jobs).
- From a pull request: the workflow runs automatically on every push to the PR
  branch. Pushing an empty commit re-runs it; prefer re-running failed jobs from
  the run page instead.

## Local parity with act

`act` runs the workflow on the dev machine, so a red step is visible before the push.

```bash
go install github.com/nektos/act@v0.2.97
export PATH="$(go env GOPATH)/bin:$PATH"
act --version                 # act version 0.2.97

pnpm ci:act                   # ubuntu checks job: lint + fresh-install smoke
pnpm ci:act:shard             # ubuntu suite job, shard 1 of 8 (the long one)
act -W .github/workflows/cross-platform.yml --matrix os:ubuntu-latest -n   # dry run
```

`.actrc` pins the runner image, so no flags are needed:

```
-P ubuntu-latest=catthehacker/ubuntu:act-latest
```

The image is multi-arch, so act uses the host architecture and an arm64 machine runs
arm64 natively. Add `--container-architecture linux/amd64` only to reproduce an
amd64-specific failure; it makes arm64 hosts pay emulation on every step.

Fidelity limits, read before trusting a green local run:

- `catthehacker/ubuntu:act-latest` tracks Ubuntu 26.04 "resolute" (verified in
  `/etc/apt/sources.list.d/ubuntu.sources`), and `ubuntu-latest` has since migrated to
  26.04 too, so the distro now matches rather than lags. That is not the same as matching
  the runner image: `catthehacker` is a plain Ubuntu with a runner bolted on, not the
  ~20 GB image GitHub maintains, so a tool GitHub preinstalls can still be missing
  locally. A distro-only failure is a fidelity gap, not a suite defect — reproduce it on
  GitHub before chasing it.
- Windows and macOS matrix legs are **not** covered by act. The Windows leg has its own
  local mirror (see "Local Windows VM" below); the macOS leg remains GitHub-only.
  That is why `ci:act` passes `--matrix os:ubuntu-latest` — the other two legs would fail
  on unresolvable platform images, not on a real defect.
- `ci:act` runs only the `checks` job: it is the cheap half. `ci:act:shard` runs one suite
  shard, which pulls the seed, the browsers and the web build and is the slow half — pick
  the shard with `--matrix shard:<n>`.
- The macOS leg is the one with no local equivalent, so reproduce a macOS-only failure by
  reasoning about what differs, not by rerunning Linux. The class that has actually bitten
  this repo: `HOME` and `TMPDIR` on a GitHub macOS runner are under `/var/folders/...`,
  which is a symlink to `/private/var/folders/...`. Any code that string-compares a
  resolved path against an unresolved root, or hashes a path string as a cache key, behaves
  differently there. APFS is also case-insensitive by default. To exercise that locally:

  ```bash
  R=$(mktemp -d) && mkdir -p "$R/real" && ln -s "$R/real" "$R/link"
  HOME="$R/link" USERPROFILE="$R/link" node tests/<suite>.js
  ```

  Passing on Linux does not prove a macOS path bug fixed; the symlinked-`HOME` run is the
  cheap proxy, and a GitHub macOS run is the only real confirmation.
- `runner.temp` maps to the act container's `/tmp`, so `PLAYWRIGHT_BROWSERS_PATH` resolves
  inside the container.
- The workflow's ffmpeg and Playwright `--with-deps` steps need `sudo`. The medium
  `act-latest` image provides it; the micro image does not.
- act copies the repo into the container instead of bind-mounting it, so a run leaves the
  working tree clean (`git status --porcelain` unchanged). Do not add `--bind`.

A full local run of this leg passed on 2026-11-11 with 284 suites discovered, so a red ubuntu
step now means a real regression rather than a harness or resolver problem. The runner
discovers `tests/test_*.js`, `tests/*.test.js`, and `tests/verify_*.js`, so the count moves as
suites are added; the tree that was green in the container sandbox on 2026-11-12
discovered 287; the seed-cache contract suite and the sharding suite added since, minus the
six unreleased Yamanaka suites now held back, make the current tree 283.

### When `Install Playwright browsers` dies on apt

Symptom, in the `--with-deps` step:

```
Temporary failure resolving 'azure.archive.ubuntu.com'
E: Failed to fetch https://security.ubuntu.com/ubuntu/pool/universe/f/fonts-ipafont/...
E: Unable to fetch some archives
Failed to install browsers
Error: Installation process exited with code: 100
```

That is the container's DNS or the apt mirror, not the suite: Playwright shells out to
`apt-get`, so nothing in this repo can retry it. The image's `/etc/resolv.conf` inherits the
Docker daemon's resolver list; a dead entry (`10.0.0.2` on a host whose network moved) costs
20 s per lookup and drops the rest on timeout. Check and fix it outside the repo:

```bash
docker run --rm catthehacker/ubuntu:act-latest getent hosts archive.ubuntu.com   # 20 s or FAIL = bad resolver
docker run --rm --dns 1.1.1.1 catthehacker/ubuntu:act-latest getent hosts archive.ubuntu.com  # < 1 s = resolver is the cause
```

Then pin a working resolver for act in `~/.config/act/actrc` (a project `.actrc` may not set
`--container-options`, act warns and ignores it):

```
--container-options --dns=1.1.1.1
```

Re-run `pnpm ci:act`. Add `--pull=false` once the image is local to skip the manifest fetch.

## Container sandbox (rule 12)

The suite mutates `HOME`, `/tmp`, the Konoha database, and `node_modules`. Running it on the
host leaks that state between runs, which is how "passes locally, fails in CI" starts. The
sandbox runs the same commands inside a container instead:

```bash
pnpm test:sandbox            # install + lint + full suite + fresh-install smoke
pnpm test:sandbox -- --lint  # fast path: install + lint only
pnpm test:sandbox -- --no-build   # reuse the last built image
```

**This is the gate on Linux, not an option.** A developer machine usually has a real
`konoha` installed globally, a populated `~/.konoha`, and a client config the harness would
otherwise inherit; the sandbox keeps all three out of the run, and a green result then means
the same thing on every OS. The suite refuses to start on a host at all — see the guard below — so
`pnpm test:sandbox` is the only way to run it; `docs/QA-AUTOMATION.md` states which gate each command is.

The guard is code, not a convention: `tests/run_all.js` calls `assertMaintenanceSandbox()` before
discovery and exits 1 unless `KONOHA_SANDBOX_CONTAINER=1` (set by `scripts/sandbox.js`) or `CI=true`
(an ephemeral runner) is present. It reads this process's environment, so `rtk node tests/run_all.js`
refuses exactly like `node tests/run_all.js` — RTK rewrites argv and cannot reach the decision. Setting
`HOME` to a temp directory is not a substitute either; the runner already does that per suite.

The engine is Docker by default. `KONOHA_SANDBOX_RUNTIME=container` (or
`--runtime container`) runs the same image and the same argv through
[Apple's `container`](https://github.com/apple/container) instead, which is how a Mac
runs this gate without Docker Desktop; `tests/test_sandbox_runtime.js` pins both plans.
The two are never substituted for each other silently — an unreachable engine exits 1
with the command that fixes it, and an uninstalled one names its installer.

What it guarantees:

- The repo is bind-mounted **read-only** at `/src`; the entrypoint copies it to `/work`,
  excluding `.git`, `node_modules`, and `apps/web/build`. Host `node_modules` never enters
  the image, and no container file can land in the working tree.
- `HOME`, `KONOHA_DB_PATH`, and the pnpm store are container-local. The harness's
  `mkdtemp` sandboxes land in the container's `/tmp`, so the host `/tmp` and the real
  `$HOME` stay clean. The Playwright browsers live in a named volume, but
  `playwright install --with-deps` runs on every start because the OS libraries it
  installs are container-local — the browser download itself is skipped.
- `KONOHA_TEST_SANDBOX=1` is set, which keeps `reconcileGlobalCommand()` from writing a
  global shim inside the container.
- The image asserts `ffmpeg` exposes `libwebp_anim` at build time, the same invariant the
  workflow checks. Debian bookworm's `ffmpeg` has it today; if that ever changes, the
  build fails loudly and the fix is adding the deb-multimedia repo to
  `docker/sandbox.Dockerfile`.

Resetting the caches:

```bash
docker volume rm konoha-sandbox-pnpm-store konoha-sandbox-ms-playwright
```

CI does not call this: the GitHub runner is already a clean room, and running the sandbox
there would need Docker-in-Docker.

### On macOS: `container` versus the native run

`container` boots a **Linux** guest on Apple silicon, so it reproduces this gate — the
read-only bind mount, the container-local `HOME`, the arm64 image build, the `libwebp_anim`
assertion — but it cannot reproduce macOS host behaviour. Path canonicalization
(`/var` → `/private/var`), case-insensitive APFS, and the `.dmg` Blender branch only surface
when the suite runs natively on macOS, which is what the `macos-latest` CI leg does.

So the macOS host semantics come from the `macos-latest` leg, and the clean room comes from
either engine locally:

```bash
KONOHA_SANDBOX_RUNTIME=container pnpm test:sandbox   # clean room, no Docker Desktop
pnpm test:sandbox                                    # the same, on Docker Desktop
```

A bare `pnpm test` on a Mac workstation is refused by the maintenance guard like on any other
host. `CI=true pnpm test` is the ephemeral-runner path the `macos-latest` leg uses, not a local
convenience: it deliberately skips the clean room, so a green result there is not the gate.

Prerequisites for the second: macOS 26 on Apple silicon, the signed installer from the
[release page](https://github.com/apple/container/releases), and
`container system start` once per boot. Named volumes are created on first use and are
never pruned automatically; `container volume list` shows them.

Each `container` run is a VM capped at 1 GiB by default, so the script passes
`--memory 4g` for the suite's four workers plus Chromium; raise it with
`KONOHA_SANDBOX_MEMORY=16g` on a larger host. Docker needs no such flag because a
container inherits the daemon VM's memory. Both paths share one environment contract — Node 24,
pnpm 12.16.1, `PLAYWRIGHT_BROWSERS_PATH`, and ffmpeg with `libwebp_anim`.

## Local macOS

The `macos-latest` leg has two steps a `pnpm test:sandbox` run on this host does not cover, and
both are the kind that only fail on a fresh Mac: the web build (`apps/web/build` is gitignored but
`tests/test_manifest_invariants.js` requires `index.js`) and an `ffmpeg` that exposes
`libwebp_anim` (Homebrew's `ffmpeg` is built without `--enable-libwebp`; `ffmpeg-full` is
the keg-only variant that has it). Replay the leg in order:

```bash
pnpm install --frozen-lockfile
PLAYWRIGHT_BROWSERS_PATH="$TMPDIR/ms-playwright" pnpm exec playwright install chromium
pnpm --filter konoha-web build
brew install ffmpeg-full                      # skip if `ffmpeg -encoders | grep libwebp_anim` matches
export PATH="$(brew --prefix ffmpeg-full)/bin:$PATH"
node -e "const{spawnSync}=require('child_process');const r=spawnSync('ffmpeg',['-hide_banner','-encoders'],{encoding:'utf8'});if(!r.stdout?.includes('libwebp_anim'))process.exit(1);console.log('ffmpeg exposes libwebp_anim')"
pnpm lint
KONOHA_TEST_PARALLEL=1 PLAYWRIGHT_BROWSERS_PATH="$TMPDIR/ms-playwright" pnpm test
```

Then the fresh-install smoke with an isolated home, exactly as the workflow runs it:

```bash
export HOME="$TMPDIR/konoha-smoke-home" USERPROFILE="$HOME"
node bin/cli.js init --yes --no-project
node bin/cli.js migrate --skip-embeddings
node bin/cli.js version
```

The suite is the part that finds macOS host semantics — `/var/folders/...` resolving to
`/private/var/...`, case-insensitive APFS, the `.dmg` Blender branch. Those only appear in the
`macos-latest` leg, which runs with `CI=true` on an ephemeral runner; replay it with
`CI=true` here, understanding that this bypasses the clean room rather than reproducing the
gate. The [container sandbox](#on-macos-container-versus-the-native-run) is the clean room, and
the two answer different questions.

## Local Windows VM

`act` covers the ubuntu leg only. Windows containers are not an option on a Linux Docker
daemon (they share the Windows kernel and fail with *image operating system "windows" cannot
be used on this platform*), so the Windows leg runs in a full guest under QEMU/KVM via
[dockur/windows](https://github.com/dockur/windows).

Prerequisites: Docker, `/dev/kvm` readable and writable by the invoking user, ~8 GB free
RAM while the guest runs, and ~80 GB free disk (7.9 GB ISO + 64 GB sparse disk).

```bash
printf 'WINDOWS_VM_PASSWORD=%s\n' '<guest-credential>' > docker/windows-vm/.env   # untracked
docker compose -f docker/windows-vm/compose.yml up -d
docker compose -f docker/windows-vm/compose.yml logs -f   # install progress, ~15-25 min first boot
docker compose -f docker/windows-vm/compose.yml down     # guest keeps its disk
```

`compose.yml` carries no credential: it reads `docker/windows-vm/.env` (gitignored) with
`required: true`, so `docker compose` fails closed with a clear message when that file is
missing. The value only gates RDP/console login to the local guest.

- Viewer: <http://127.0.0.1:8006>. RDP: `127.0.0.1:3390`, user `Docker`. Both ports bind to
  loopback only — the guest is never reachable from the LAN.
- `VERSION: "11"` (Windows 11 Pro) is the interactive default, chosen over the exact
  `windows-latest` image (Server 2025) for desktop tooling. The job steps, Node/pnpm
  versions, and suite are identical; only the OS edition differs. Set `VERSION: "2025"` to
  match the runner exactly when chasing an OS-edition-specific failure.
- The guest disk lives in `~/.cache/konoha-windows-vm/storage` (override with
  `WINDOWS_VM_STORAGE`), never in the checkout.
- dockur lowers `RAM_SIZE` when the host cannot spare it and says so in the log
  (`your configured RAM_SIZE of 8 GB is too high ... adjusted`). The guest then installs
  and tests in 3 GB, which is slower but works; close other memory hogs for a clean run.
- `docker/windows-vm/oem/install.bat` runs once during the final install step and provisions
  what the runner image provides: Node 24, pnpm 12.16.1, Git for Windows, and an ffmpeg
  build with `libwebp_anim`. Its log is `C:\OEM\provision.log`; it writes
  `C:\OEM\provision.ok` only when every tool landed. The OEM script is baked into the
  setup media at install time, so editing it does not change an existing guest —
  `run-ci.cmd` therefore re-runs it from the share whenever the marker is missing, and
  fails with the log path only if that retry still does not produce one.

dockur copies the whole `docker/windows-vm/oem/` folder to `C:\OEM` when it builds the
setup media, so the launcher is available both on the share and inside the guest:

```cmd
C:\OEM\run-ci.cmd
Z:\docker\windows-vm\oem\run-ci.cmd
```

Prefer the share copy: it is the one you can edit without rebuilding the VM.

`Z:` is a per-logon SMB mapping and is gone after every guest reboot, so `run-ci.cmd`
probes for it and refuses with a mapping hint instead of failing halfway through a step.
`launch.bat` is the double-click wrapper: it maps `Z:` first and then calls `run-ci.cmd`
with the arguments it was given.

Once a run is green through the earlier steps, re-testing a handful of suites should not
cost another full `windows-ci.ps1` pass. `retest.cmd` re-mirrors the share and runs only
the suites you name, writing `docker/windows-vm/logs/retest.log`:

```cmd
pushd \\host.lan\Data\docker\windows-vm\oem
retest.cmd test_queue_worker.js test_subagent_delegation_integrity.js
```

`scripts/windows-ci.ps1` robocopies the shared checkout to `C:\konoha` (pnpm's store links
and file watching do not work on a Windows network share), then runs install → Playwright
browsers → web build → ffmpeg assert → lint → full suite → fresh-install smoke, with the
same env the workflow sets. Each step's exit code is recorded and the script exits non-zero
if any failed; the transcript lands in `docker/windows-vm/logs/` on the host. It also points
`KONOHA_SEED_DIR` at `C:\konoha-seed`, mirroring the CI cache: outside the repo mirror so a
re-run reuses the ~4 minute seed instead of rebuilding it.

Operational notes for the local Windows leg:

- PowerShell block-buffers a piped child's stdout, so a step prints nothing until it flushes.
  Judge liveness from the VM (CPU, guest clock across two screenshots), never from log size.
- A transcript is named `windows-ci-<stamp>.log` from a fresh `Get-Date` per invocation, and
  `Start-Transcript -Force` truncates it, so a new filename does mean a new run. Runs are
  also failed if the script never reaches its last step (`run interrupted before completion`
  in the summary), so a Ctrl-C cannot be mistaken for a pass.
- The first suite run in a fresh guest builds the golden seed with a full `konoha init`,
  which took 262 s on this VM in the run that measured it — the "20 minutes" in earlier
  notes was the whole step, not the init. Point `KONOHA_SEED_DIR` at a prepared seed to
  skip it entirely. `tests/run_all.js` logs `[SEED] Building golden seed …` and either
  `[SEED] Golden seed ready (Ns)` or a `[SEED] init did not produce a complete seed in Ns`
  error, so the phase is visible instead of looking like a hang.
- `pnpm test` on Windows can emit `NativeCommandError` lines from `pnpm.ps1` when
  `scripts/rtk_exec.js` reports RTK unavailable. They are noise — the step's real signal is
  the exit code and the final `Test Summary` line.
- Playwright's CDN download needs `PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT`; the default 30 s
  socket timeout is routinely exceeded on this link. `scripts/windows-ci.ps1` sets 180 s.
- A step can look hung while the product has already finished: `execSync`'s `timeout` kills
  the `cmd.exe` wrapper, not its grandchildren, so a stray `winget` keeps the step's stdout
  pipe open and `Tee-Object` waits for EOF forever. Run 7 stalled this way right after `init`
  printed its summary. `bin/lib/extension.js` now runs the `winget` fallback with
  `stdio: 'ignore'`; if a step ever stalls with a frozen log, check `Get-Process winget` in
  the guest before suspecting the suite.
- The same download also drops with `read ECONNRESET` mid-transfer on this link. Playwright
  retries it in-process, so a couple of `ECONNRESET` lines can still end in a successful
  step; only the step's exit code decides.
- When the guest link is bad enough that the browser install never completes, fetch the
  archives on the host and let the script copy them in. Playwright unpacks a win64 build to
  `<dir>/chrome-win64/` (or `<dir>/chrome-headless-shell-win64/`) and marks it with
  `INSTALLATION_COMPLETE` and `DEPENDENCIES_VALIDATED`; reproduce that layout under a
  plain directory in the share and the install step becomes a no-op.
- `playwright install chromium` needs three artifacts, and skipping any one of them sends
  the step back to the network. Stage all three:

  ```sh
  rev=1248; ver=156.0.8078.4          # from the "Downloading ..." lines in the step log
  base=https://cdn.playwright.dev

  fetch() {  # fetch <url> <dest-dir> <inner-dir>
    curl -fsSL "$1" -o /tmp/pw.zip
    mkdir -p ".tmp-playwright/$2"
    unzip -q -o /tmp/pw.zip -d ".tmp-playwright/$2"
    touch ".tmp-playwright/$2/"{INSTALLATION_COMPLETE,DEPENDENCIES_VALIDATED}
  }

  fetch "$base/builds/cft/$ver/win64/chrome-win64.zip" \
        "chromium-$rev" chromium
  fetch "$base/builds/cft/$ver/win64/chrome-headless-shell-win64.zip" \
        "chromium_headless_shell-$rev" chromium_headless_shell
  fetch "$base/dbazure/download/playwright/builds/ffmpeg/1013/ffmpeg-win64.zip" \
        ffmpeg-1013 ffmpeg
  ```

  The `chromium_headless_shell-*` and `ffmpeg-1013` downloads are easy to miss: they appear
  only after `chromium-*` is satisfied, so a half-staged share looks like it works and then
  fails on the next artifact.

  `.tmp-playwright/` is gitignored, and `scripts/windows-ci.ps1` only imports it when the
  directory holds something, so an empty share still exercises the real network path.
- Abort a run with `taskkill /F /T /IM node.exe` (and `powershell.exe`) in the guest, or
  with `docker/windows-vm/oem/kill-ci.cmd` after a fresh share mapping — a newly written
  host file is invisible through the guest's stale SMB directory cache, so the `.cmd` only
  resolves once the share has been remapped or the session restarted. Closing the console
  window or pressing Ctrl-C leaves the PowerShell step and its `node` children running:
  they keep writing to `C:\konoha`, and the next launch then fails with `EPERM` on
  `.svelte-kit/output` because two runs delete each other's build directory.

Coverage gaps, by design:

- The six `tests/test_yamanaka_*.js` suites are not run anywhere: Yamanaka 3D is
  unreleased, so its suites are not part of the gate on this guest, on GitHub Actions,
  or in `pnpm test`. The harness names every one it held back in the run banner, so the
  log states what was not covered, and naming a suite on the command line still runs it:
  `node tests/run_all.js test_yamanaka_langgraph_pipeline`. Nothing is deleted.
- The F42 Akatsuki lab declines to run in the guest: `src/workflow/akatsuki/lab.js` requires
  Docker on Windows, and the guest has no Docker. That is a fail-closed decline, not a suite
  failure.
- `tests/e2e/*.spec.js` are not part of `pnpm test` (`tests/run_all.js` reads the directory
  non-recursively), so the local mirror does not run them either — same as CI.

## Trust rule

This workflow is only trusted once it has been seen **both green and red**. A red
run proves it can fail; a green run on all three OSes proves the checks pass there.
The harness seed-copy fix (PR #6) has landed on master, so a red test step is a real
suite signal — not a harness block. The audit table above is the historical red
baseline; every row in it has since been fixed at its cause, so a fresh run is
expected green on all three OSes. A new red row means a real regression.
