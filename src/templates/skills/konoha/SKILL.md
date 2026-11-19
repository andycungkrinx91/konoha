---
name: konoha
description: Guidelines and instructions for maintaining, extending, and debugging the Konoha MCP Tools Orchestrator, MCP middleware, and multi-archetype website builder across 8 coding clients (Antigravity IDE/CLI, Cursor, Claude Code, OpenCode, Command Code, Codex, Pi/pi.dev, OMP).
tags:
  - konoha
  - orchestrator
  - mcp
  - maintenance
  - engineering
  - website-builder
  - fts5
---

# 🍃 Konoha Maintenance & Engineering Skill (v2.2.23)

Core operational guide for maintaining, extending, and debugging the **Konoha MCP Tools Orchestrator**, native Tree-sitter + FTS5 + Granite/MiniLM code-intelligence engine, and multi-agent coordination server.

Konoha serves ALL 56 canonical tools through standard MCP protocols across 8 supported AI coding clients (Antigravity, Cursor, Claude Code, OpenCode, Command Code, Codex, Pi, OMP). All 56 canonical MCP tools (plus 2 hidden deprecated compatibility aliases, 58 total in manifest) are formally declared in `src/mcp_tool_manifest.json` and dispatched via `src/mcp/tool_dispatch.js` across 9 specialists:
- Deep Research (@chunin): Web research, documentation lookup, and evidence synthesis.
- Code Exploration (@genin): Read-only codebase exploration, symbol search, and architecture review.
- Architecture & Quality Gates (@kage): Architecture decisions, security audits, and delivery review gate.
- MCP Router & Orchestrator (@sannin): Request classification, triage, and multi-agent coordination.
- UI & Frontend (@jonin): Component architecture, design match, and taste-skill frontend builds.
- Backend & DevOps (@anbu): Backend services, bug fixing, DevOps, and infrastructure deployment.
- Technical Writing & Scribe (@tokubetsu-jonin): Publication-grade documentation, diagrams, and reports.
- Security Specialist (@akatsuki): Red-team penetration testing in sandboxes and blue-team defensive hardening.
- Generative 3D Specialist (@yamanaka): Autonomous 3D asset synthesis, Manifold-3D geometry validation, and live Blender refinement.

---

## 🔒 Non-Negotiable Rules

Full set with the guard file behind each rule: `get_skill("konoha/invariants")`.

1. **Tool boundaries** — repository discovery through `code_search`/`code_symbol`/`code_impact`; skills through Konoha MCP (`find_skill`/`get_skill`); file I/O through the bounded tools (`read_file_range`, `read_file_head`, `token_efficient_grep`); every shell command behind RTK (`rtk <command>`).
2. **Client configs are global-only and append-only** — never write `.omp`, `.codex`, `.cursor`, `.claude`, `.agents`, or `.gitignore` rules into a user project. Config lives under `~/.<client>`, is backed up under `~/.konoha/backups/configs/<client>/<scope>/`, and is merged by `src/config_merger.js`.
3. **No filesystem mirrors** — Konoha does not maintain filesystem mirrors of client skills. Deployment is targeted diff-and-patch from `src/templates/skills`; the only tracked duplicate is this repo's `.agents/skills/`, held byte-identical by `tests/test_skill_tree_parity.js`.
4. **Delivery gate** — `rtk npx aislop scan --changes` must report 100/100 with 0 errors and 0 warnings; Kage review needs `confidence >= 98` and `ai_slop_clean: true`. On `master`, all discovered tests pass before a release commit.
5. **Source files stay under 700 lines** (`scripts/lint.js`).
6. **Version sync is single-source** — the 18 managed targets move only through `scripts/bump_version.js`; read the count from `--check`, never hardcode it in prose or code.
7. **A delivery verdict needs all three local cross-platform CI environments** (Linux sandbox, Windows VM, macOS container). The obsolete `andycungkrinx91.konoha-bridge-master-universal` extension is gone; every IDE uses direct MCP config.
8. **Security predicates fail closed** — red-skill isolation, lab-DB isolation, Socket suppressions, and the no-dynamic-execution ban are never widened "to be tolerant".
9. **Token Savings Flow Logic Preservation Invariant** — never modify or disrupt the token savings telemetry flow. `src/tools_savings_logger.js` derives baseline bytes from the real `SUM(byte_size)` of the FTS5 candidates it retrieved, so the reported 83%–98% savings are measured, not asserted.

## 📚 Load On Demand

| Need | Call |
|---|---|
| Canonical repository rules the runtime enforces | `get_skill("konoha/contract")` |
| All 29 cardinal invariants, with the guard file for each | `get_skill("konoha/invariants")` |
| Code-intel, guardrail, and subagent-spawn contracts | `get_skill("konoha/codeintel-contracts")` |
| Traps that already shipped as bugs once (v2.2.17 → 2.2.23) | `get_skill("konoha/history")` |
| LangGraph StateGraph, worktree parallelism, HITL gates | `get_skill("konoha/workflow")` |
| Architecture map, benchmark evidence, test inventory | `konoha/architecture`, `konoha/benchmark`, `konoha/test` |
| Tool block, per-agent usage, task format, docs conventions | `konoha/mcp-tools-block`, `konoha/peragent-usage`, `konoha/task-format`, `konoha/docs` |

## 🚀 Quick Verification Commands

```bash
# Verify version consistency across all 18 managed targets
rtk node scripts/bump_version.js --check
rtk node tests/test_version_consistency.js

# Verify Draw.io zero geometric collisions
rtk node tests/test_diagram_sync.js

# Verify animated WebP assets
rtk node tests/test_all_assets_webp.js

# Verify LangGraph.js workflow activation (file keeps its historical v2217 name)
rtk node tests/test_langgraph_v2217.js

# Verify the runtime is free of dynamic execution and the emitted hooks still guard
rtk node tests/test_no_dynamic_execution.js

# Verify supply-chain posture (no lodash, patch intact, exact pins, frozen publish install)
rtk node tests/test_dependency_posture.js
rtk node tests/test_xlsx_populate_lodash_lite.js
rtk node tests/test_document_engine_security.js
rtk node tests/test_dependency_audit.js

# Verify cross-platform install, upgrade, schema, and runtime-mirror integrity
rtk node tests/test_install_layout_integrity.js
rtk node tests/test_install_lifecycle_and_db_preservation.js
rtk node tests/test_install_migrate_embed_functions.js
rtk node tests/test_pnpm_config_migration.js
rtk node tests/test_upgrade_failure_reporting.js
rtk node tests/test_upgrade_timeout_budgets.js
rtk node tests/test_upgrade_version_verification.js
rtk node tests/test_upgrade_cyber_pack_purge.js
rtk node tests/test_config_backup_and_append_only.js
rtk node tests/test_config_centralization.js
rtk node tests/test_global_install.js
rtk node tests/test_global_skill_sync_8_clients.js
rtk node tests/test_schema_migrations_and_lifecycle.js

# Verify MCP argument boundaries, skill URI resolution, and red-skill precedence
rtk node tests/test_mcp_argument_parsing.js
rtk node tests/test_skill_uri_resolution.js
rtk node tests/test_skill_retrieval_precedence.js

# Verify the first-run login fix end to end (Playwright; boots the web app)
rtk pnpm run test:e2e

# 3 local cross-platform CI test environments (Linux, Windows, macOS)
rtk pnpm test:sandbox -- --shard=1/8
rtk pnpm ci:act && rtk pnpm ci:act:shard
# Windows (inside dockur/windows guest): docker\windows-vm\oem\run-ci.cmd -Shard 1/8
# macOS (Apple silicon): KONOHA_SANDBOX_RUNTIME=container pnpm test:sandbox -- --shard=1/8

# Static analysis & Zero-AI-Slop audit
rtk node scripts/lint.js
rtk npx aislop scan --changes
```
