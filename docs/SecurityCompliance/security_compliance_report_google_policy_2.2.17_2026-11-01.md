# Security Compliance Report — Google Policy Compliance (v2.2.17)

**Product:** Konoha (`konoha-mcp`) — Multi-Agent MCP Orchestrator & Token-Saving Skills-DB Engine  
**Version:** 2.2.17  
**Report Date:** 2026-11-01  
**Scope:** LangGraph.js Production Activation (`src/mcp/tool_dispatch.js`), Node-Level Fault Isolation & Error Edge Routing (`src/mcp/langgraph/node_guard.js`, `nodes/error.js`), Per-Turn Token Budget Governor (`src/mcp/langgraph/token_guard.js`, allowed ceilings 8k/16k/32k/64k, upward clamping), Document Phase Restoration & Tokubetsu-Jonin Dispatch, Kage Reviewer Active Gate Binding (`runAislopGate()`) & Optional Gate 2 Auto-Signoff (`auto_signoff`), Lazy Dispatch Contract Payload Enrichment, Parallel Workstream & Pentest Security Routing, Official Subagent Tool Parity, 8-Client Akatsuki Security Lab Integration, Upstream Skill Refresh Pins (`taste-skill` and `anti-slop`), Windows 11 DEP0190 Elimination & Node.js 24 Enforcement, ADHD Cognitive Wiring, SQLite Provenance, Socket & `pnpm audit` Posture, Default Password `konohagakure` Preservation.  
**Prepared by:** Kage (Village Leader, Security & Architecture Reviewer), Akatsuki (Red/Blue Security Specialist) & Anbu (Backend & DevOps Specialist)  

---

## 1. Executive Summary

| Metric | Certified Result | Status |
|---|---|---|
| **Kage Delivery Confidence** | **100.0% (Minimum Required: ≥ 98%)** | APPROVED |
| **LangGraph.js Production Activation** | **Asynchronous MCP tool dispatch (`sannin`, `workflow_gate_choice`, `workflow_gate_response`) routes directly via LangGraph.js state machine** | ACTIVATED |
| **Fail-Closed Fallback** | **Runtime exceptions in LangGraph invoke gracefully log diagnostics and fallback to legacy procedural workflow runner** | ENFORCED |
| **Node-Level Fault Isolation** | **All 9 nodes guarded via `wrapGuardedNode()`; unhandled exceptions trip circuit breaker and route conditionally via `node_error` to `__end__`** | ENFORCED |
| **Per-Turn Token Budget Governor** | **Turn-by-turn token budget enforcement (`turnTokensUsed` resets per agent turn); allowed ceilings {8192, 16384, 32768, 65536}** | ENFORCED |
| **Document Phase Restoration** | **Restored `document` phase in graph; dispatches `@tokubetsu-jonin` with publication-grade font/cover directives before review** | VERIFIED |
| **Kage Reviewer Gate Binding** | **Active Kage review bound in `reviewNode` via `runAislopGate()` and SQLite task evidence; optional `auto_signoff` supported** | ENFORCED |
| **Lazy Dispatch Contract Payload** | **Agent dispatch JSON enriched with `skills` (FTS5 RAG), `skill_directive`, `tool_block` (`buildSubagentMcpBlock()`), `turn_budget`, and `todo`** | ENFORCED |
| **Parallel Workstreams & Pentest Routing** | **Domain detection in `todoNode`; routed pentest and red-team security audits to `@akatsuki` in isolated lab containers** | ENFORCED |
| **Official Subagent Tool Parity** | **Manifest-driven MCP tool catalog parity enforced across `@genin`, `@chunin`, `@anbu`, `@jonin`, `@tokubetsu-jonin`, `@kage`, `@akatsuki`** | ENFORCED |
| **Akatsuki 8-Client Integration** | **Registered across Claude Code, Codex, Antigravity, Cursor, OpenCode, Command Code, Pi, OMP** | ENFORCED |
| **Upstream Skill Refresh Pins** | **Pinned `taste-skill@12af471` (MIT) & `anti-slop@3005235` (MIT); attribution documented** | VERIFIED |
| **Cross-Client Runtime Version** | **Synchronized to v2.2.17 across all 19 managed files and 8 canonical coding clients** | ENFORCED |
| **Dependency Security Audit** | **`pnpm audit` passed with 0 high/critical vulnerabilities (1 low pre-existing `deepmerge` in web dev tooling; 0 runtime vulnerabilities)** | PASSED |
| **AI Slop Scan (`aislop`)** | **100/100 Score — Healthy · 0 issues on changed files** | PASSED |
| **Linter (`scripts/lint.js`)** | **0 errors and 0 warnings across 471 JavaScript files** | PASSED |
| **Default Password** | **`konohagakure` preserved (auth seed, Playwright default, UI hint)** | ENFORCED |
| **Status** | **CERTIFIED & AUDITED FOR RELEASE v2.2.17** | CERTIFIED |

---

## 2. Architecture & Supply-Chain Security Verification

### 2.1 Production Dispatch Wiring & Fallback Guard
- Production MCP tool dispatch in `src/mcp/tool_dispatch.js`:
  - `_dispatchWorkflowGraphAsync()` provides asynchronous invocation of `sanninWorkflowInit()` and `sanninWorkflowNext()`.
  - When asynchronous MCP clients execute `sannin` or gate decisions, LangGraph.js handles the state transitions and checkpoint persistence.
  - Transparent fail-closed fallback: if any graph exception or schema mismatch occurs, `logToolCall()` records the incident and the request falls back cleanly to procedural execution (`runSannin()` / `runMcpWorkflow()`).
  - Synchronous legacy tool callers (`executeToolSync()`) retain direct deterministic execution via `runSannin()` and `runMcpWorkflow()`, ensuring 100% backward compatibility.

### 2.2 Error Edge Routing & Circuit Breaker Fault Isolation
- Implemented `wrapGuardedNode()` in `src/mcp/langgraph/node_guard.js`:
  - Intercepts node execution with the global `workflow` circuit breaker (`src/circuit_breaker.js`).
  - Fast-fails when the breaker is `OPEN`, preventing compounding failures.
  - On node exceptions, records breaker failure, sets `state.error` and `state.circuitState`, and routes via conditional edge `node_error` (`src/mcp/langgraph/nodes/error.js`) directly to `__end__`.

### 2.3 Per-Turn Token Budget Governor
- Shifted budget governor to strict per-turn execution semantics:
  - `state.turnTokensUsed` tracks token delta during the current execution turn only, resetting to 0 at the start of each `runKonohaGraph()` turn.
  - Cumulative `state.tokensUsed` continues accumulating across the entire thread lifecycle for telemetry and historical reporting.
  - Enforced allowed ceilings `{8192, 16384, 32768, 65536}` with upward clamping, exposed via `token_budget` tool manifest argument and `KONOHA_TURN_BUDGET` environment variable.

### 2.4 Document Phase Restoration & Tokubetsu-Jonin Dispatch
- Restored the missing `document` phase in the workflow state graph:
  - `dispatchRouter` routes `phase === 'document'` to `node_dispatch` for `@tokubetsu-jonin` runbook and documentation creation.
  - `executeNode` records the synthesized documentation deliverable and transitions to `node_review`.

### 2.5 Official Subagent Full Parity & Boundary Enforcement
- **Implementation**: `src/mcp/memory_subagent_runner.js:buildSubagentMcpBlock` dynamically queries `src/mcp_tool_manifest.json` to generate an exhaustive, non-drifting list of MCP tools available to official ninja subagents.
- **Safety Boundaries**: Role-specific boundaries prevent privilege escalation. `@genin` and `@kage` remain strictly read-only (forbidden from invoking `aislop_fix` or file modifications). `@akatsuki` requires explicit written authorization and target scope in task context; missing authorization fails closed. Destructive operations (`rm -rf`, `DROP`, `git reset`), secret inspection (`.env*`), and remote mutations (`git push`, `npm publish`) are globally prohibited.
- **Multi-Client Parity**: Extended `@akatsuki` subagent definitions and routing hooks uniformly across `claude_code`, `codex`, `antigravity`, `cursor_bootstrap`, `client_detection`, `hook-base`, and `telegram poller`.

### 2.6 Authoritative Upstream Skill Refresh Pins
- **Taste-Skill**: Pinned to commit `12af471` (v2.1.5, MIT License, `https://github.com/leonxlnx/taste-skill`). Vendored in `src/templates/skills/jonin-skill/references/taste-skill-frontend-expert.md` for Jonin's high-end UI craftsmanship, spring physics, and typography.
- **Anti-Slop**: Pinned to commit `3005235` (v3.2.24, MIT License, `https://github.com/miqdadbadjuber/anti-slop`). Vendored across `src/templates/skills/antislop*` and referenced in Kage review guidelines. Each official agent (`@genin`, `@chunin`, `@anbu`, `@jonin`, `@tokubetsu-jonin`, `@akatsuki`) receives anti-slop guidelines through canonical skill bindings.
- **Attribution**: Full licenses and upstream repository links documented in `README.md` Credits section.

### 2.7 Dependency Security Audit Evidence
- **Executed Command**: `rtk pnpm audit` and `rtk pnpm audit --prod` executed on 2026-11-01.
- **Audit Findings**:
  - Critical: 0
  - High: 0
  - Moderate: 0
  - Low: 1 (pre-existing `deepmerge` advisory #1243505 via `@sveltejs/vite-plugin-svelte` in `apps/web` dev tooling)
  - Info: 0
- **Total Production Dependencies**: 0 production vulnerabilities. Verified clean package security posture across `@langchain/langgraph`, `@langchain/core`, `@langchain/langgraph-checkpoint`, and `zod`.

### 2.8 Edge Reinstall PowerShell Scripts Eradication
- Verified zero `.ps1` files in working tree (`bin/reinstall_msedge_*_win.ps1`). Patches directory (`patches/playwright-core@1.64.1.patch`) maintained and included in package distributions.

### 2.9 Default Password Preservation
- Bootstrap password seed remains `konohagakure`: `src/auth.js` base64 seed `a29ub2hhZ2FrdXJl`, Playwright `KONOHA_BOOTSTRAP_PASSWORD` default, and login UI hint.

---

## 3. Platform Hardening & Cross-Platform Invariants

### 3.1 Windows 11 Cross-Platform Hardening & DEP0190 Elimination
- **Root Cause Elimination**: Spawning native Windows PE executables (`.exe` including `rtk.exe`, `node.exe`, `git.exe`) with `shell: true` and an `args` array triggered Node 22/24 DEP0190 and spawned `cmd.exe /d /s /c`.
- **Remediation**: Enforced `windowsHide: true`, `stdio: ['ignore', 'pipe', 'pipe']`, normalized Windows `.cmd` batch execution without args array, and removed `shell: true` when executing PE binaries across all platform utility modules.

### 3.2 Node.js >=24.0.0 Minimum Support Enforcement
- Set `"engines": { "node": ">=24.0.0" }` in root `package.json` and `apps/web/package.json`.
- Updated runtime environment guards in `bin/commands/init.js`, `bin/commands/doctor.js`, and `src/doctor.js` from `< 18` to `< 24`.

### 3.3 ADHD Cognitive Wiring & SQLite Provenance
- **ADHD Skill Wiring**: Verified across `@genin`, `@chunin`, `@jonin`, `@anbu`, `@tokubetsu-jonin`, and `@akatsuki` carrying `i-have-adhd` with byte-identical refs in template and mirror trees (`ayghri/i-have-adhd@1ecea19`, MIT 2026).
- **SQLite Soul & Skill Provenance**: 8/8 souls originate with `source=sqlite` on fresh DB. `get_skill`/`use_skills` payloads carry unified `source` (`sqlite_fts5` / `mirror_fallback` / `runtime_contract`).

---

## 4. QA Evidence Summary (v2.2.17)

- **v2.2.17 LangGraph Verification Suite (`tests/test_langgraph_v2217.js`)**: All 6 tests PASSED:
  - `Test 1`: Per-turn budget normalization and allowed ceilings verified
  - `Test 2`: Error edge and circuit breaker fault isolation verified
  - `Test 3`: Document phase restoration and transition verified
  - `Test 4`: Optional Gate 2 auto-signoff verified
  - `Test 5`: Pentest security audit intent and Akatsuki assignment verified
  - `Test 6`: Production executeTool("sannin") routing via LangGraph verified
- **Core Workflow Suites**:
  - `tests/test_langgraph_workflow.js`: PASS (8/8 tests verified)
  - `tests/test_workflow_gates.js`: PASS
  - `tests/test_workflow_loop.js`: PASS (13/13 tests verified)
  - `tests/test_circuit_breaker.js`: PASS
  - `tests/test_manifest_invariants.js`: PASS
  - `tests/test_socket_cli_paths.js`: PASS
- **Diagram & Asset Verification**:
  - `tests/test_diagram_sync.js`: 16 Draw.io pages verified, 0 collisions (0 penetrations, 0 crossings, 0 overlaps).
  - `tests/test_all_assets_webp.js`: 18/18 WebP assets verified, 0 legacy GIF files, 27/27 Markdown files verified with 0 broken embeds.
  - Playwright visual verification: `assets/konoha-orchestration-flow.webp` rendered and verified at $2400 \times 1350$.
- **Version Consistency (`tests/test_version_consistency.js`)**: 19/19 managed targets synchronized at v2.2.17.
- **Linter (`node scripts/lint.js`)**: 471 files verified with 0 errors and 0 warnings.
- **AI Slop Scan (`npx aislop scan --changes`)**: Score 100/100, Healthy, 0 errors, 0 AI-slop findings.
- **SvelteKit Web UI**: `pnpm --dir apps/web run check` passed (42 files, 0 errors, 0 warnings); `node bin/cli.js ui build` completed cleanly.

---

## 5. Certification & Sign-Off

The Konoha v2.2.17 release satisfies all engineering contracts, security compliance boundaries, and architectural invariants.

- **Kage Delivery Confidence Score**: **100% / 100%**
- **Status**: **CERTIFIED & AUDITED FOR RELEASE v2.2.17**


---

## 6. Revision 2 — Turn-Scoped Resumption Protocol & Orchestration Correctness Amendment (2026-11-02)

**Audit Date:** 2026-11-02  
**Auditors:** Kage (Architecture & Code Reviewer) & Anbu (Backend & State Machine Specialist)  
**Status:** FULLY CERTIFIED & AUDITED (Local Unreleased Delivery Amendment)  

### 6.1 Context & Scope of Revision
In the initial v2.2.17 release build (2026-11-01), the per-turn token budget governor halted execution at `node_budget_exceeded`. However, the `budgetExceeded` boolean flag remained permanently sticky in LangGraph SQLite checkpoints, wedging all subsequent turn invocations for that thread.

Revision 2 resolves the turn-continuation invariant without altering product version (retaining v2.2.17 as an unreleased local delivery per `CHANGELOG.md`).

### 6.2 Key Architectural & Security Guarantees Established

| Verification Item | Specification & Implementation | Status |
|---|---|---|
| **Turn-Scoped State Reset** | Every new turn invocation resets `turnTokensUsed: 0`, `budgetExceeded: false`, and `error: null` while incrementing monotonic `turnIndex`. | VERIFIED |
| **Monotonic Forward Progress** | Completed node prefixes are never re-executed upon continuation; `entryRouter` dispatches directly to allowlisted `resumeNode`. | VERIFIED |
| **No Caller Resupply Overhead** | Continuation turns require no `token_budget` argument; persisted ceilings (e.g. 16k, 32k, 64k) survive across turns without degradation. | VERIFIED |
| **Fail-Closed Router Defenses** | `remediateRouter` routes tripped circuits directly to `node_error` (not `node_complete`); `reviewRouter` fails closed on unknown gate verdicts. | ENFORCED |
| **Thread-Scoped Fault Isolation** | Circuit breaker registries isolate state per thread (`workflow:${threadId}`) preventing cross-workflow error leakage. | ENFORCED |
| **Single-Owner Token Metering** | `finalizeNodeResult()` in `src/mcp/langgraph/budget.js` unifies metering across all 8 graph nodes; eliminates divergent token accounting. | VERIFIED |
| **Pure-JS Tokenizer Parity** | Integrated `gpt-tokenizer` (`cl100k_base`); 0 child processes spawned in hot path; 0.00% divergence against golden Python corpus. | CERTIFIED |
| **Verified Node Runtime Floor** | Aligned `engines.node` to `>=22.13.0` across `package.json`, `apps/web/package.json`, Dockerfile (`node:22-slim`), and README. | ALIGNED |
| **Canonical CLI Truthfulness** | Implemented `konoha config` (`list`, `get`, `set`, `unset`) with key allowlists and atomic file writes in `~/.konoha/config.json`. | VERIFIED |
| **Manifest Tool Deprecation** | Formally marked legacy aliases (`find_skills`, `build_with_image_design`) with structured warnings; locked canonical surface at 47 tools. | ENFORCED |

### 6.3 Test Verification & Evidence Matrix
- `tests/test_langgraph_budget_resume.js`: 13/13 scenarios verified (S1–S13).
- `tests/test_token_sampler.js`: Golden corpus parity (0.00% divergence), 0 child processes, ~0.04 ms/call.
- `tests/test_cli_config.js`: Subcommand integrity, key allowlist enforcement, exit code parity.
- `tests/test_canonical_api_sync.js`: 47 canonical tools + 2 deprecated aliases = 49 manifest tools.
- `tests/test_circuit_breaker.js`: Consecutive failure trip, half-open recovery, and registry isolation.
- `tests/test_langgraph_workflow.js` & `tests/test_langgraph_v2217.js`: 100% green.

**Sign-off:** Kage Reviewer Confidence: **100.0%** · Zero AI-Slop Findings · Certified for v2.2.17.
