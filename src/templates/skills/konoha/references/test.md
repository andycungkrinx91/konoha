# 🍃 Konoha QA Testing & Verification SOPs (v2.2.22)

Operational runbook and testing matrix for verifying Konoha `v2.2.22` core engines, compact `use_skills`, parallel subagent spawning, Real-Time Idle `@advisor`, HITL post-approval compaction, Jonin dynamic frontend builder, Draw.io diagrams, and animated WebP assets.

---

## ▶️ How to Run

| Gate | Command | Scope |
|---|---|---|
| **1. Linux — Debian container sandbox (mandatory)** | `pnpm test:sandbox` (or `pnpm test:sandbox -- --shard=I/8`) | Builds `konoha-sandbox:local` (Debian Bookworm) and runs install, lint, the full suite (or shard `I/8`), and the fresh-install smoke inside it. Host `HOME`, `/tmp`, `node_modules`, and working tree stay untouched. `--lint` is the fast path, `--no-build` reuses the last image. |
| **1b. Linux — Ubuntu `act` CI workflow** | `pnpm ci:act` / `pnpm ci:act:shard` | `act` against `.github/workflows/cross-platform.yml` (`ubuntu-latest` → `catthehacker/ubuntu:act-latest` in `.actrc`). `ci:act` runs `checks` (lint + smoke); `ci:act:shard` runs suite shard 1 (pass `--matrix shard:<N>` for others). |
| **2. Windows — Local `dockur/windows` QEMU VM** | `docker/windows-vm/oem/run-ci.cmd [-Shard I/N]` / `retest.cmd` | Drives `scripts/windows-ci.ps1` inside the Windows 11 guest (`docker/windows-vm/compose.yml`), mirroring `windows-latest` step-for-step over local NTFS `C:\konoha` (install, Playwright, web build, `libwebp_anim`, lint, suite/shard, smoke). |
| **3. macOS — Apple `container` sandbox + native CI** | `KONOHA_SANDBOX_RUNTIME=container pnpm test:sandbox [-- --shard=I/8]` | Same image and mounts through [apple/container](https://github.com/apple/container) on Apple silicon (macOS 26, `container system start`), no Docker Desktop needed (`--memory 4g`, `KONOHA_SANDBOX_MEMORY` overrides). Boots a Linux guest, so macOS-native `/var` → `/private/var`, APFS, and `.dmg` behaviour is covered by `macos-latest` CI (`docs/CI.md`). |
| **Full suite directly on host** | refused | `tests/run_all.js` exits 1 before discovery unless `KONOHA_SANDBOX_CONTAINER=1` or `CI=true` is set. `rtk node tests/run_all.js` refuses identically — the guard reads the process environment, and RTK only rewrites argv. A single file by path still runs and is still not evidence. |

`tests/run_all.js` auto-discovers every `tests/test_*.js`, builds one golden seed, and copies it per suite with `HOME`, `USERPROFILE`, and `KONOHA_DB_PATH` redirected at that copy, so a suite never reads the developer's real config. A suite that needs the developer's environment is a defect in the suite, not a reason to relax it.

### The guard is enforced in-process, not by convention

`tests/run_all.js` calls `assertMaintenanceSandbox()` before it discovers a single suite. It refuses
unless the process carries `KONOHA_SANDBOX_CONTAINER=1` (set by `scripts/sandbox.js` on the container
argv) or runs on an ephemeral CI runner (`CI=true`). A host invocation exits 1 with the accepted
command named, so a maintenance run cannot half-execute against the developer's `~/.konoha`.

`rtk` does not lift the guard: it rewrites argv, and the check reads this process's environment. `rtk
node tests/run_all.js` refuses exactly like `node tests/run_all.js`. Pointing `HOME` at a temp directory
does not lift it either — an isolated `HOME` is what the runner already gives each suite, not evidence
that the run is sandboxed. `tests/test_sandbox_guard.js` and `tests/test_runner_isolation.js` pin all
three properties.

Linux, macOS, and Windows all go through the container. A host has a real `konoha` installed globally, a populated `~/.konoha`, and a client config; the sandbox mount is read-only, `HOME` is container-local, and `KONOHA_TEST_SANDBOX=1` stops `reconcileGlobalCommand()` from writing a shim, so a maintenance run cannot modify the install a developer actually uses. macOS keeps a second native pass because the container is a Linux guest and cannot reproduce APFS or `/var` canonicalization.

---

## 🧪 Comprehensive QA Verification Matrix (`v2.2.22`)

| Verification Target | Command | Expected Pass Criteria |
|---|---|---|
| **Version Consistency** | `rtk node tests/test_version_consistency.js` | 18/18 managed repository targets strictly verified at `v2.2.22`. |
| **Compact `use_skills` & Discipline Skills** | `rtk node tests/test_use_skills_compact.js` | 5-skill bundle `<= 6,400 bytes` (`genin=5093B`, `dedup=2818B`, `anbu=5239B`), all 8 specialists retain `i-have-adhd` & `antislop`. |
| **8 Subagents Spawn, Parallel & `/konoha`** | `rtk node tests/test_langgraph_parallel_and_konoha.js` | All 8 specialists spawn across all 8 clients, `@sannin` router-only, parallel workstreams & `/konoha` LangGraph routing verified. |
| **Real-Time Idle `@advisor` (`<= 1k` tok)** | `rtk node tests/test_advisor_realtime_monitor.js` | `0 tokens` when idle (`IDLE_OK`), `<= 1,000 tokens` cap, `evict_stale_results: true`, `INTERRUPT_CORRECTION` on drift/breach. |
| **HITL Compaction & Native TODOs** | `rtk node tests/test_hitl_compaction_and_todos.js` | Native TODO tools across all 8 clients, `walkthrough_todos.json` written, Gate 1 Option 1 compacts context. |
| **Jonin Dynamic Design & Watermark** | `rtk node tests/test_jonin_dynamic_design_and_watermark.js` | 3D Studio menu hidden (`SHOW_3D_STUDIO_MENU = false`), `Build by konoha` meta/footer verified with 0 AI-detector penalty, live browser monitor & project skill generator verified. |
| **Worktree Isolation & Merge Barrier** | `rtk node tests/test_worktree_isolation.js` | 16/16 worktree isolation, syntax gate, and parallel barrier tests pass. |
| **E2E Install, Upgrade & Token Bounds** | `rtk node tests/test_e2e_install_upgrade_reinstall.js` | Fresh install, upgrade, reinstall, and bounded payloads (`runSannin < 3KB`, `build_from_text < 25KB`) pass with 100% parity. |
| **Documentation Currency** | `rtk node tests/test_docs_currency.js` | Zero drift between exported code symbols and markdown documents. |
| **Draw.io Diagram Collisions** | `rtk node tests/test_diagram_sync.js` | All 18 drawio pages verified with strictly **0 geometric collisions** (0 penetrations, 0 crossings, 0 overlaps). |
| **Animated WebP Assets** | `rtk node tests/test_all_assets_webp.js` | All 33 WebPs valid, 0 legacy `.gif` files, 107 active markdown files with 0 broken embeds. |
| **Backend Static Linter** | `rtk node scripts/lint.js` | All JavaScript/Svelte files verified under 700 lines with **0 errors and 0 warnings**. |
| **Zero-AI-Slop Code Hygiene** | `rtk npx aislop scan --changes` | Score **100 / 100 Healthy**, 0 errors, 0 warnings, 0 fixable. |
| **MCP Orphan Guard** | `rtk node tests/test_mcp_orphan_guard.js` | 5/5 on POSIX: a reparented stdio server exits on the `ppid === 1` poll (T2), a superseded daemon exits on `bridge.pid` takeover (T3), a daemon starting behind a live owner exits (T4), and the idle budget exits a silent server (T1, T5). Windows never reparents, so T2 prints a skip there and the idle budget is the Windows exit (T1/T5 still run). |
| **Web UI Manual-Only + Single Instance** | `rtk node tests/test_ui_manual_only.js` | 29/29: the dispatcher exposes only `start`/`build`, no module in the init/upgrade/bootstrap path references autostart, and a second `start` on a live port exits non-zero with `already running`. Needs no seeded `HOME`. |

---

## 📐 Draw.io Zero-Collision Rule & Sync SOP

When editing `docs/diagrams/konoha-architecture.drawio` or `docs/diagrams/konoha-infrastructure-architecture.drawio`:
1. **Never alter existing `mxGeometry` coordinates** unless doing a dedicated layout refactor.
2. Edit the `value="..."` attribute of existing cells in-place to keep 0 geometric collisions.
3. Every cell MUST have a globally unique `id="..."`.
4. Validate immediately with `rtk node tests/test_diagram_sync.js`.
