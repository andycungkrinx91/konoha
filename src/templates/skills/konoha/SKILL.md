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

# 🍃 Konoha Maintenance & Engineering Skill (v2.2.18)

Core operational guide for maintaining, extending, and debugging the **Konoha MCP Tools Orchestrator**, SQLite FTS5 indexer, and multi-agent coordination server.

Konoha serves ALL 48 canonical tools through standard MCP protocols across 8 supported AI coding clients (Antigravity, Cursor, Claude Code, OpenCode, Command Code, Codex, Pi, OMP). All 48 canonical MCP tools (plus 2 hidden deprecated compatibility aliases, 50 total in manifest) are formally declared in `src/mcp_tool_manifest.json` and dispatched via `src/mcp/tool_dispatch.js` across 9 specialists:
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

## ⚡ Modular Domain References (Token-Optimized)

To prevent token burn and provide surgically accurate guidance, maintenance instructions are modularized. **Load only the specific reference required for your task**:

| Domain | Reference Path | On-Demand Loading Command | Core Coverage |
|---|---|---|---|
| **Workflow & StateGraph** | `references/workflow.md` | `konoha.get_skill("konoha/workflow")` | LangGraph.js cyclic StateGraph, parallel worktree dispatch, Real-Time Idle `@advisor` (`<= 1,000` tokens/turn), per-turn token budget governor, circuit breaker `node_error`, Gate 1 & Gate 2 HITL + Post-Approval Compaction. |
| **System Architecture** | `references/architecture.md` | `konoha.get_skill("konoha/architecture")` | Canonical MCP tools manifest, transports (stdio/SSE/WS 1404), runtime state & flow hash, dynamic Astra/Fable-inspired website builder invariants, Dark & Light Mode, and `Build by konoha` signature. |
| **Subagents & Roles** | `references/peragent-usage.md` | `konoha.get_skill("konoha/peragent-usage")` | 9-ninja specialist subagents roster (8 spawnable specialists + `@sannin` router-only), parallel git worktree isolation, persona contracts, ADHD cognitive output formatting (`i-have-adhd`), and `antislop*` discipline. |
| **Testing & Verification** | `references/test.md` | `konoha.get_skill("konoha/test")` | QA runbooks, unit/integration suites (`tests/run_all.js`), Draw.io zero-collision checks, WebP asset tests, linter, `aislop` code hygiene gate. |
| **Benchmark & Token Economy** | `references/benchmark.md` | `konoha.get_skill("konoha/benchmark")` | Context reduction (83%–98%), dynamic baseline byte calculation in `tools_savings_logger.js`, SQLite FTS5 search performance, KV-cache prefix optimization. |
| **Documentation Standards** | `references/docs.md` | `konoha.get_skill("konoha/docs")` | Reader-first zero-AI standards, security compliance report forward-porting, README & CHANGELOG sync, visual WebP generation. |

---

## 🔒 Cardinal Maintenance Invariants

1. **Tool Boundaries & Global-Only Configs**:
   - Repository code search: ALWAYS use Semble MCP (`semble.search`, `semble.find_related`).
   - Skill lookup: ALWAYS use Konoha MCP (`konoha.find_skill`, `konoha.get_skill`).
   - Bounded file I/O: ALWAYS use Konoha bounded tools (`read_file_range`, `read_file_head`, `token_efficient_grep`).
   - Shell commands: ALWAYS prefix with RTK (`rtk <command>`).
   - Global-Only & Append-Only Client Configs: Never write `.omp`, `.codex`, `.cursor`, `.claude`, `.agents`, or `.gitignore` rules (such as `/PLAN.md` or `.omp/.`) into user project directories; all client configs live under user home (`~/.omp`, `~/.codex`, `~/.cursor`, `~/.config/git/ignore`, etc.) and use automatic date-stamped backups (`~/.konoha/backups/configs/<client>/<scope>/`) + syntax-aware append-only merging (`src/config_backup_manager.js`, `src/config_merger.js`) with ownership tracking (`~/.konoha/backups/ownership_manifest.json`). Konoha never deletes external `agents/` or `conversations/` directories.
   - Ownership-Aware Rsync-Like Global Skill Sync & Targeted Diff-and-Patch (`src/global_skill_sync.js`): All 17 canonical Konoha skills (including cross-framework Motion references `motion-nextjs`, `motion-nuxt`, `motion-svelte`, `motion-angular`, `framer-motion-animator`) and `SOUL.md` are automatically synchronized across all 8 client global skill directories (`~/.agents/skills`, `~/.gemini/antigravity-cli/skills`, `~/.gemini/skills`, `~/.cursor/skills`, `~/.claude/skills`, `~/.config/opencode/skills`, `~/.commandcode/skills`, `~/.codex/skills`, `~/.pi/agent/skills`, `~/.omp/agent/skills`). Fresh installs skip pre-existing user files (`--ignore-existing`), and upgrades apply targeted line diff-and-patch updates (`computeLineDiffPatch` / `applyTargetedTextPatch`) while preserving user customizations.
   - Scoped Execution & External Skill RAG Integration: Hooks and tool blockers activate only inside Konoha-managed contexts (`/konoha <prompt>` or `/<subagent-name> <prompt>`). External global and project-level skills across all 8 harnesses are indexed in-place into the existing SQLite Project Knowledge RAG (`~/.konoha/konoha.db`) with strict project isolation (`isPathVisible`) so project skills never leak across workspaces.
   - Extension Isolation: The obsolete `andycungkrinx91.konoha-bridge-master-universal` extension directory is eliminated; all IDEs use direct MCP configuration.
2. **Quality & Security Delivery Gate**:
   - Shipped code must pass `rtk npx aislop scan --changes` with score **100/100 Healthy**, 0 errors, and 0 warnings.
   - Final Kage review requires `confidence >= 98%`, `ai_slop_clean: true`, and zero security findings.
3. **Source File Line Limit**: Keep all `.js`, `.py`, and `.svelte` source files strictly under 700 lines (`scripts/lint.js`).
4. **Draw.io Zero Collision Rule**: Never introduce overlapping cells or bounding-box collisions in Draw.io diagram pages (`tests/test_diagram_sync.js`).
5. **Single-Source Version Synchronization**: Keep all 19 managed repository targets strictly synchronized via `scripts/bump_version.js`.
6. **Release Governance**: When maintaining or updating Konoha on branch `master`, ensure all discovered tests pass before release commits.
7. **Token Savings Flow Logic Preservation Invariant**: Never modify or disrupt the token savings telemetry flow logic. In `src/tools_savings_logger.js`, baseline bytes for `find_skill` / `find_skills` are dynamically computed from the actual `SUM(byte_size)` of retrieved skill candidates in SQLite FTS5 matching, authentically reflecting 83%–98% context savings.

---

## 🚀 Quick Verification Commands

```bash
# Verify version consistency across all 19 targets
rtk node tests/test_version_consistency.js

# Verify Draw.io zero geometric collisions
rtk node tests/test_diagram_sync.js

# Verify animated WebP assets
rtk node tests/test_all_assets_webp.js

# Verify LangGraph.js v2.2.18 activation
rtk node tests/test_langgraph_v2217.js

# Static analysis & Zero-AI-Slop audit
rtk node scripts/lint.js
rtk npx aislop scan --changes
```
