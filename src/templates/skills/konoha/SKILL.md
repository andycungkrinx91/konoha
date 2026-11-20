---
name: konoha
description: Runtime guide for the Konoha MCP Tools Orchestrator across 8 coding clients (Antigravity IDE/CLI, Cursor, [CC], OpenCode, Command Code, Codex, Pi/pi.dev, OMP) — contract, task format, tool block, and per-agent usage.
tags:
  - konoha
  - orchestrator
  - mcp
  - engineering
  - website-builder
  - fts5
---

# 🍃 Konoha MCP Tools Orchestrator Skill (v2.2.25)

Runtime guide for the **Konoha MCP Tools Orchestrator**, native Tree-sitter + FTS5 + Granite/MiniLM code-intelligence engine, and multi-agent coordination server.

Konoha serves ALL 56 canonical tools through standard MCP protocols across 8 supported AI coding clients (Antigravity, Cursor, [CC], OpenCode, Command Code, Codex, Pi, OMP). All 56 canonical MCP tools (plus 2 hidden deprecated compatibility aliases, 58 total in manifest) are formally declared in `src/mcp_tool_manifest.json` and dispatched via `src/mcp/tool_dispatch.js` across 9 specialists:
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

## 🔒 Working Rules

1. **Tool boundaries** — repository discovery through `code_search`/`code_symbol`/`code_impact`; skills through Konoha MCP (`find_skill`/`get_skill`); file I/O through the bounded tools (`read_file_range`, `read_file_head`, `token_efficient_grep`); every shell command behind RTK (`rtk <command>`).
2. **Client configs are global-only and append-only** — config lives under `~/.<client>`, is backed up under `~/.konoha/backups/configs/<client>/<scope>/`, and is merged by `src/config_merger.js`. Never write `.omp`, `.codex`, `.cursor`, `.claude`, `.agents`, or `.gitignore` rules into a user project.
3. **Message format** — every human and agent message uses `konoha/task-format`: `**Feedback` / `**Task` / `**Rules` in, `**Result` / `**Evidence` / `**Blockers` / `**Next` out.
4. **HITL gates fail closed** — Gate 1 (`pending_plan_approval`) and Gate 2 (`pending_human_signoff`) render the picker on every client and submit the human's reply verbatim via `sannin({ task_dir, choice, refinement })`.
5. **Resume safety** — on every new or resumed session, re-read the contract, repeat skill discovery, and restore the Konoha/RTK workflow before acting.

## 📚 Load On Demand

| Need | Call |
|---|---|
| Canonical repository rules the runtime enforces | `get_skill("konoha/contract")` |
| Feedback/Task/Rules and Result/Evidence/Blockers/Next envelopes | `get_skill("konoha/task-format")` |
| MCP tool block every subagent must follow | `get_skill("konoha/mcp-tools-block")` |
| Per-agent tool permissions, worktrees, compact skill loading | `get_skill("konoha/peragent-usage")` |

Maintenance, architecture, invariants, benchmark evidence, and test inventory are maintainer-only: they live in the repository at `.agents/dev-skills/konoha-maintenance/` and are not shipped to client skill directories.

## 🚀 Quick Commands

```bash
rtk konoha doctor            # runtime, schema, and client health
rtk konoha version           # installed version
rtk konoha migrate           # reindex skills and docs into SQLite FTS5
rtk konoha ui start          # local web UI
```
