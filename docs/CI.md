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
   `node bin/cli.js migrate --skip-embeddings`, then `node bin/cli.js version`, with a
   throwaway `HOME`/`USERPROFILE`. The CLI entry point is invoked directly (`bin:
   konoha -> bin/cli.js`) so no global install or PATH resolution is involved.
   `--skip-embeddings` keeps the gate about the CLI: embedding coverage is asserted
   by step 3, and an unbounded Hugging Face download here would turn a network
   hiccup into a fake cross-platform failure.

`fail-fast` is off: one OS failing never cancels the other two, so every run reports
a per-OS result. A `concurrency` group cancels superseded runs on the same branch.
Permissions are `contents: read` only.

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

## Local parity with act

`act` runs the workflow on the dev machine, so a red step is visible before the push.

```bash
go install github.com/nektos/act@v0.2.97
export PATH="$(go env GOPATH)/bin:$PATH"
act --version                 # act version 0.2.97

pnpm ci:act                   # full ubuntu job: install -> lint -> test -> smoke
act -j test --matrix os:ubuntu-latest -n   # dry run: validates workflow syntax, creates no container
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
  `/etc/apt/sources.list.d/ubuntu.sources`); GitHub `ubuntu-latest` is 24.04. A distro-only
  failure is a fidelity gap, not a suite defect — reproduce it on GitHub before chasing it.
- Windows and macOS matrix legs are **not** covered by act. The Windows leg has its own
  local mirror (see "Local Windows VM" below); the macOS leg remains GitHub-only.
  That is why `ci:act` passes `--matrix os:ubuntu-latest` — the other two legs would fail
  on unresolvable platform images, not on a real defect.
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
suites are added; the current tree discovers 286, all green in the container sandbox on
2026-11-12.

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

So a Mac needs both, and neither is a substitute for the other:

```bash
pnpm test                              # native: the macOS semantics CI asserts
KONOHA_SANDBOX_RUNTIME=container pnpm test:sandbox   # clean room, no Docker Desktop
```

Prerequisites for the second: macOS 26 on Apple silicon, the signed installer from the
[release page](https://github.com/apple/container/releases), and
`container system start` once per boot. Named volumes are created on first use and are
never pruned automatically; `container volume list` shows them. Both paths share one environment contract — Node 24,
pnpm 12.16.1, `PLAYWRIGHT_BROWSERS_PATH`, and ffmpeg with `libwebp_anim`.

## Local Windows VM

`act` covers the ubuntu leg only. Windows containers are not an option on a Linux Docker
daemon (they share the Windows kernel and fail with *image operating system "windows" cannot
be used on this platform*), so the Windows leg runs in a full guest under QEMU/KVM via
[dockur/windows](https://github.com/dockur/windows).

Prerequisites: Docker, `/dev/kvm` readable and writable by the invoking user, ~8 GB free
RAM while the guest runs, and ~80 GB free disk (7.9 GB ISO + 64 GB sparse disk).

```bash
docker compose -f docker/windows-vm/compose.yml up -d
docker compose -f docker/windows-vm/compose.yml logs -f   # install progress, ~15-25 min first boot
docker compose -f docker/windows-vm/compose.yml down     # guest keeps its disk
```

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
if any failed; the transcript lands in `docker/windows-vm/logs/` on the host.

Operational notes for the local Windows leg:

- PowerShell block-buffers a piped child's stdout, so a step prints nothing until it flushes.
  Judge liveness from the VM (CPU, guest clock across two screenshots), never from log size.
- A transcript is named `windows-ci-<stamp>.log` from a fresh `Get-Date` per invocation, and
  `Start-Transcript -Force` truncates it, so a new filename does mean a new run. Runs are
  also failed if the script never reaches its last step (`run interrupted before completion`
  in the summary), so a Ctrl-C cannot be mistaken for a pass.
- The first suite run in a fresh guest builds the golden seed with a full `konoha init`, which
  takes roughly 20 minutes on this VM versus ~3.5 minutes on Linux; later runs reuse it.
  `tests/run_all.js` logs `[SEED] Building golden seed …` and either
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

- Yamanaka 3D workflow suites are skipped locally via `KONOHA_TEST_EXCLUDE=test_yamanaka_`.
  The runner banner lists every skipped file, so the log states exactly what was not
  covered. They still run on GitHub Actions and nothing is deleted from the repo.
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
