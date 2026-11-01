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

# 🍃 Konoha Maintenance & Engineering Skill (v2.2.17)

Core operational guide for maintaining, extending, and debugging the **Konoha MCP Tools Orchestrator**, SQLite FTS5 indexer, and multi-agent coordination server.

Konoha serves ALL 47 canonical tools through standard MCP protocols across 8 supported AI coding clients (Antigravity, Cursor, Claude Code, OpenCode, Command Code, Codex, Pi, OMP). All 47 canonical MCP tools are formally declared in `src/mcp_tool_manifest.json` and dispatched via `src/mcp/tool_dispatch.js`.

---

## ⚡ Modular Domain References (Token-Optimized)

To prevent token burn and provide surgically accurate guidance, maintenance instructions are modularized. **Load only the specific reference required for your task**:

| Domain | Reference Path | On-Demand Loading Command | Core Coverage |
|---|---|---|---|
| **Workflow & StateGraph** | `references/workflow.md` | `konoha.get_skill("konoha/workflow")` | LangGraph.js cyclic StateGraph, node lifecycles, per-turn token budget governor (8k/16k/32k/64k), circuit breaker `node_error`, Gate 1 & Gate 2 HITL. |
| **System Architecture** | `references/architecture.md` | `konoha.get_skill("konoha/architecture")` | 47 canonical MCP tools manifest, transports (stdio/SSE/WS 1404), runtime state & flow hash, website builder layout invariants (far-left logo, no mobile hamburger, 10-theme light mode FAB). |
| **Subagents & Roles** | `references/peragent-usage.md` | `konoha.get_skill("konoha/peragent-usage")` | 8-ninja specialist subagents roster, persona contracts, strict tool access boundaries, ADHD cognitive output formatting, Akatsuki security profiles. |
| **Testing & Verification** | `references/test.md` | `konoha.get_skill("konoha/test")` | QA runbooks, unit/integration suites (`tests/run_all.js`), Draw.io zero-collision checks, WebP asset tests, linter, `aislop` code hygiene gate. |
| **Benchmark & Token Economy** | `references/benchmark.md` | `konoha.get_skill("konoha/benchmark")` | Context reduction (83%–98%), dynamic baseline byte calculation in `tools_savings_logger.js`, SQLite FTS5 search performance, KV-cache prefix optimization. |
| **Documentation Standards** | `references/docs.md` | `konoha.get_skill("konoha/docs")` | Reader-first zero-AI standards, security compliance report forward-porting, README & CHANGELOG sync, visual WebP generation. |

---

## 🔒 Cardinal Maintenance Invariants

1. **Tool Boundaries**:
   - Repository code search: ALWAYS use Semble MCP (`semble.search`, `semble.find_related`).
   - Skill lookup: ALWAYS use Konoha MCP (`konoha.find_skill`, `konoha.get_skill`).
   - Bounded file I/O: ALWAYS use Konoha bounded tools (`read_file_range`, `read_file_head`, `token_efficient_grep`).
   - Shell commands: ALWAYS prefix with `rtk <command>`.
2. **Quality & Security Delivery Gate**:
   - Shipped code must pass `rtk npx aislop scan --changes` with score **100/100 Healthy**, 0 errors, and 0 warnings.
   - Final Kage review requires `confidence >= 98%`, `ai_slop_clean: true`, and zero security findings.
3. **Source File Line Limit**: Keep all JavaScript source files strictly under 700 lines.
4. **Draw.io Zero Collision Rule**: Never introduce overlapping cells or bounding-box collisions in Draw.io diagram pages (`tests/test_diagram_sync.js`).
5. **Single-Source Version Synchronization**: Keep all 19 managed repository targets strictly synchronized via `scripts/bump_version.js`.

---

## 🚀 Quick Verification Commands

```bash
# Verify version consistency across all 19 targets
rtk node tests/test_version_consistency.js

# Verify Draw.io zero geometric collisions
rtk node tests/test_diagram_sync.js

# Verify animated WebP assets
rtk node tests/test_all_assets_webp.js

# Verify LangGraph.js v2.2.17 activation
rtk node tests/test_langgraph_v2217.js

# Static analysis & Zero-AI-Slop audit
rtk node scripts/lint.js
rtk npx aislop scan --changes
```
