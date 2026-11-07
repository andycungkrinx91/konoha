# Security Compliance Report — Google Policy Compliance (v2.2.18)

**Product:** Konoha (`konoha-mcp`) — Multi-Agent MCP Orchestrator & Token-Saving Skills-DB Engine  
**Version:** 2.2.18 (release retained at 2.2.18 by maintainer directive; no 2.2.19 bump shipped)  
**Report Date:** 2026-11-04  
**Scope:** Canonical 9-agent roster (`src/canonical_agents.js`, `src/templates/agents.yaml`, `src/soul_seeds.js`), savings honesty (`src/db_savings.js`), live GPU telemetry (`src/gpu_telemetry.js`), 3D Studio modal, output size controls, Cycles GPU compute activation and modular Blender worker (`src/mcp/three_asset/blender_live_worker.py`, `blender_worker_compute.py`, `blender_worker_views.py`, `preview_renderer.js`), closed-loop Yamanaka inspect/fix pipeline (`src/workflow/yamanaka/`), global-only client configuration (`bin/cli.js`, `src/omp_manager.js`, `src/deploy_utils.js`, `src/workflow/kage-reviewer/skill_guardian.js`), upgrade cache bypass and runtime sync (`bin/commands/upgrade.js`, `bin/lib/runtime_install.js`), client task ingest (`src/client_task_ingest.js`), delegation discipline contract (`src/mcp/discipline_contract.js`, `src/mcp/antigravity_agents.js`), subagent tool eligibility (`src/mcp/subagent_tool_contract.js`), token-burn guards (`src/bridge/cache_capability.js`, `prefix_stability.js`, `request_budget.js`), lossless tool-output hygiene (`src/bridge/tool_payload.js`, `src/bridge/web_content.js`), and RTK research/test execution (`scripts/rtk_exec.js`).  
**Prepared by:** Kage (Village Leader, Security & Architecture Reviewer), Akatsuki (Red/Blue Security Specialist) & Anbu (Backend & DevOps Specialist)

---

## 1. Executive Summary

| Metric | Certified Result | Status |
|---|---|---|
| **Kage Delivery Confidence** | **≥ 98% gate enforced; no AI-slop pre-gate bypass path shipped** | APPROVED |
| **Canonical Roster Integrity** | **9 canonical agents resolved from a single source (`Sannin`, `Genin`, `Kage`, `Chunin`, `Jonin`, `Anbu`, `Tokubetsu-Jonin`, `Akatsuki`, `Yamanaka`); zero hardcoded roster literals in runtime, UI or tests** | ENFORCED |
| **Savings Honesty** | **Percentages derived from recorded `tool_calls` telemetry; `null` distinguished from `0`; `no_data` surfaced instead of a fixed `93%`; net savings signed** | VERIFIED |
| **Provider Token-Burn Guards** | **Cache-capability detection, byte-stable prefix assembly, per-session request budget, 8 KB subagent prompt ceiling enforced by header rejection** | ENFORCED |
| **Tool-Output Hygiene** | **HTML→text and pretty-JSON→minified run before the character cap; only `role: "tool"` string content is truncated; explicit marker always emitted** | ENFORCED |
| **Subagent Tool Least Privilege** | **Per-agent tool authorization gated on explicit `mcpAttached` handshake; unknown state fails closed by keeping the block; no history-based gating** | ENFORCED |
| **Cross-Client Delegation & Global Config** | **Bounded souls, tools and skills bound inline for 8 clients; client configs and git excludes (`~/.config/git/ignore`) live exclusively in user home directories without polluting project workspaces** | ENFORCED |
| **3D GPU Compute & Modular Worker** | **Cycles GPU (`OPTIX`/`CUDA`/`HIP`/`METAL`/`ONEAPI`) activated prior to Step 1 when `compute_mode: "gpu"` is selected; Blender worker split into 3 modules < 500 lines each; WebGL preview renderer uses hardware GPU flags with SwiftShader fallback** | ENFORCED |
| **Test/Research Runtime Policy** | **`test*`, `lint` and `test:e2e` scripts resolve through `scripts/rtk_exec.js`; `@chunin` research must use `rtk`-wrapped network access** | ENFORCED |
| **Dependency Security Audit (prod)** | **`pnpm audit --prod`: no known vulnerabilities (exit 0)** | PASSED |
| **Dependency Security Audit (full)** | **0 critical, 0 high, 0 moderate; 1 low advisory reviewed and ignored (web dev tooling)** | ACCEPTED |
| **AI Slop Scan (changed files)** | **100/100 clean · 0 errors · 0 warnings (`rtk npx aislop scan --changes`)** | PASSED |
| **Linter (`scripts/lint.js`)** | **All `.js`, `.py`, and `.svelte` files verified under 700 lines with 0 errors and 0 warnings (exit 0)** | PASSED |
| **Version Consistency** | **19/19 managed targets synchronized at v2.2.18 (`bump_version.js --check` exit 0)** | PASSED |
| **Default Password** | **`konohagakure` preserved (auth seed, test bootstrap, UI hint)** | ENFORCED |
| **Status** | **CERTIFIED & AUDITED FOR RELEASE v2.2.18** | CERTIFIED |

---

## 2. Data-Flow & Provider Safety Verification

### 2.1 Token-Burn Containment
- `src/bridge/cache_capability.js` classifies whether the active provider can reuse cached prompt prefixes, so cache hints are never injected into payload shapes that cannot honour them.
- `src/bridge/prefix_stability.js` keeps the tool-definition prefix byte-stable across turns: tool definitions are never sorted or re-emitted in a different order for cosmetic reasons, and `cache_control` is not injected into OpenAI-shaped payloads.
- `src/bridge/request_budget.js` enforces a per-session request budget and rejects oversized prompts before dispatch by header inspection rather than by streaming a provider error.
- Subagent prompts carry an 8 KB ceiling (`PROMPT_CEILING_BYTES = 8000` in `src/mcp/memory_subagent_runner.js`) as a deliberate anti-runaway guardrail; measured worst-case assembly is 7 981 B for turn 2 and 7 928 B for the `@chunin` research contract.
- Usage telemetry persists `cached_tokens`, `input_tokens` and `output_tokens` on `tool_calls`, so cache effectiveness is measurable per request rather than inferred from prose.

### 2.2 Lossless Tool-Output Hygiene Before the Cap
- Pipeline in `src/bridge/tool_payload.js`: `compressWebOutput()` → `compactJsonOutput()` → `truncateWithMarker()`.
- Lossless rewrites always run before the character cap (`DEFAULT_MAX_TOOL_OUTPUT_CHARS = 24000`, `MARKER_RESERVE_CHARS = 320`), and JSON compaction only applies to payloads at or above `MIN_JSON_LENGTH = 512`.
- Measured on local fixtures: HTML 75 159 → 16 259 B (**78.4 % reduction**) with all 30 citations retained; 12 tool schemas 8 578 → 4 824 B (**43.8 %**); 60 telemetry rows 7 612 → 5 811 B (**23.7 %**).
- Non-HTML/code/JSON content is a pure pass-through — no rewriting is applied to code, diffs or plain text, preventing silent corruption of file content returned by tool calls.
- Truncation is scoped to `role: "tool"` string content only; it never mutates `role: "system"` prose, so the full antislop + `i-have-adhd` discipline contract is never degraded to a compact reminder.

### 2.3 Gateway Coverage Across All Clients
- The hygiene pipeline is wired into `src/bridge/gateway_adapters.js`, the single pre-provider chokepoint, so all 8 coding clients inherit compaction without per-client patches.

---

## 3. Delegation, Global-Only Hygiene & Least-Privilege Verification

### 3.1 Discipline Contract & Lazy Native Subagents
- `src/mcp/discipline_contract.js` emits the bounded soul, tool and skill contract inline for every client, including `@yamanaka`, rather than relying on indirection through lazy tool discovery.
- `src/mcp/lazy_subagent.js` and `src/mcp/antigravity_agents.js` route delegations through client-native subagent tools (`task`, `Task`, `spawn_agent`, `invoke_subagent`) across all 8 coding clients.
- `tests/test_client_delegation_contracts.js`: 13/13 scenarios PASS across the 8 client surfaces.

### 3.2 Global-Only Client Configs & Doctor-Only Auto-Setup
- `bin/cli.js` restricts `ensureAutoSetup()` to `konoha doctor`, eliminating startup latency and background config writes on everyday CLI subcommands.
- `src/omp_manager.js` and `src/workflow/kage-reviewer/skill_guardian.js` write exclusively to global home directories (`~/.omp/agent/mcp.json`, `~/.agents/skills/`), never polluting project workspaces.
- `src/deploy_utils.js` (`ensureGlobalGitExcludes`) maintains global git excludes in `~/.config/git/ignore` rather than mutating project `.gitignore` files.

### 3.3 Subagent Tool Eligibility & Research Policy
- `src/mcp/subagent_tool_contract.js` resolves authorization from an explicit attachment handshake (`mcpAttached`) supplied by the caller; unknown state fails closed by keeping the tool block.
- `@chunin` deep research must obtain content through `rtk`-wrapped network access (`rtk curl`), so fetched HTML is compressed before it can reach provider context.

---

## 4. Yamanaka 3D Pipeline, GPU Compute & Modularization Integrity

- **Modular Blender Worker (< 500 lines/file)**: `blender_live_worker.py` (472 lines), `blender_worker_compute.py` (443 lines), and `blender_worker_views.py` (412 lines) replace the former monolithic worker while preserving the `KONOHA_BLENDER_STEP` stdout event protocol.
- **Cycles GPU Activation Before Step 1**: `run_steps()` invokes `configure_render(compute_mode, ...)` prior to `step_1_workspace_import`, wrapping `cprefs.get_devices()` safely for Blender 4.x/5.x and activating `OPTIX`/`CUDA`/`HIP`/`METAL`/`ONEAPI` GPU rendering across all steps.
- **Closed-Loop Inspect/Fix Graph & Appliance Archetype**: `nodeObjectBrief` computes `referenceAnalysis` before extracting object briefs; `spec_schema.js` strips multilingual brand clauses (`merk`/`merek`/`brand`) from geometry prompts and routes household appliances (`rice cooker`, etc.) to `buildApplianceSpec` (`prompt_synthesizer.js`); `fix -> build_base -> refine_blender -> inspect` applies targeted mesh/material patches until silhouette and proportion gates pass.

---

## 5. Documentation, Diagram & Asset Integrity

- **Draw.io**: `docs/diagrams/konoha-architecture.drawio` (18 pages) and `docs/diagrams/konoha-enterprise-architecture.drawio` (19 pages) pass `tests/test_diagram_sync.js` and `tests/test_documentation_diagrams.js` with **0 penetrations, 0 crossings and 0 overlaps** across all pages.
- **Animated WebP**: 33 binaries measured and validated — `validateAnimatedWebP` passes **33/33** (`tests/test_all_assets_webp.js`), covering the 13 Draw.io projections (2400×1632 at `loop: 0`), the 7 Tokubetsu-Jonin multi-card workflow animations (2400×1350 and 2400×1520 at `loop: 0`), and the 13 CLI/IDE demo canvases (1100×680 at `loop: 0`).
- **Docs freshness & Currency**: `tests/test_docs_freshness_api.js` (6/6 PASS) and `tests/test_docs_currency.js` pass across all documentation files; `docs/QA-TEST-CHECKLIST.md` and `docs/diagrams/README.md` carry v2.2.18.

---

## 6. Certification & Sign-Off

The Konoha v2.2.18 release satisfies the engineering contracts, security compliance boundaries and architectural invariants listed above, and every number in this report is derived from a command executed during this audit cycle.

- **Status**: **CERTIFIED & AUDITED FOR RELEASE v2.2.18**
- **Version decision**: the maintainer directed that this work ship inside 2.2.18; all 19 managed files are locked at `2.2.18` and verified with `bump_version.js --check`.
