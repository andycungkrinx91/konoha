---
name: konoha-maintenance
description: Maintainer-only guide for developing, extending, and debugging the Konoha MCP Tools Orchestrator and its shipped runtime skill. Excluded from client/global skill sync.
tags:
  - konoha
  - maintenance
  - engineering
  - internal
---

# Konoha Maintenance (Developer-Only)

Repo-maintainer guidance for the Konoha MCP Tools Orchestrator and shipped `konoha` runtime skill. This skill lives in `.agents/dev-skills/` (not `src/templates/skills/`) so deploy/sync cannot ship it.

## Runtime vs Maintenance Split

- **Shipped runtime skill:** `src/templates/skills/konoha/` with references `contract.md`, `task-format.md`, `mcp-tools-block.md`, `peragent-usage.md` (runtime-required; do not remove).
- **Maintenance-only (this skill):** references below; keep them out of template/canonical skill trees.

## Maintainer Workflow

1. **Discover before editing** — `code_search` / `code_symbol` / `code_impact` against the absolute repo root; skills through Konoha MCP (`find_skill` / `get_skill`), never raw `cat`/`grep`.
2. **Every shell command behind RTK** — `rtk node tests/…`, `rtk git …`, `rtk grep -n …`. RTK is mandatory in this repo, not optional.
3. **Messages use `konoha/task-format`** — `**Feedback` / `**Task` / `**Rules` in; `**Result` / `**Evidence` / `**Blockers` / `**Next` out. The shipped skill serves it; do not fork the format.
4. **Edit shipped content only in `src/templates/skills`**, then keep `.agents/skills` byte-identical. Deployed client copies are regenerated, never hand-edited.

## Load Maintenance References

| Need | Reference |
|---|---|
| 35 cardinal invariants + guard files | [invariants](references/invariants.md) |
| Past shipped traps (v2.2.17 → 2.2.25) | [history](references/history.md) |
| LangGraph StateGraph / worktrees / HITL | [workflow](references/workflow.md) |
| Architecture map | [architecture](references/architecture.md) |
| Benchmark evidence | [benchmark](references/benchmark.md) |
| Test inventory | [test](references/test.md) |
| Code-intel/guardrail/spawn contracts | [codeintel-contracts](references/codeintel-contracts.md) |
| Docs conventions | [docs](references/docs.md) |
| `src/` boundary audit + modularization plan (issue #25) | [architecture/SRC-BOUNDARY-AUDIT-2026-11-21.md](../../../../docs/architecture/SRC-BOUNDARY-AUDIT-2026-11-21.md) |

After changing shipped templates, keep `.agents/skills` parity with `src/templates/skills` for shipped skills and prove maintenance skill is excluded from sync.