# Konoha Architectural Gap Analysis

**Document Version:** 1.1.0 (Konoha v2.2.19)  
**Date:** 2026-11-08  
**Status:** Canonical Analysis

---

## 1. Executive Summary

This analysis evaluates Konoha's architecture to identify genuine architectural gaps. Guided by the principle **"Never add architecture to solve a problem that the existing architecture can solve"**, all improvements target existing subsystems rather than introducing parallel layers.

Every gap below states the code that exists today. Where a gap has since been closed, the row says so and names the implementation; it is not re-opened as future work.

---

## 2. Evaluation Decision Matrix

| Proposed Improvement Area | Existing Capability? | Current Owner | Sufficiency Assessment | Recommended Action |
|---|---|---|---|---|
| **Symlink-Safe Workspace Isolation** | YES | `src/file_tools/common.js` | **Closed.** Path checks resolve physical targets with `fs.realpathSync` (lines ~119, ~204, ~248) before applying the workspace boundary, so a symlink pointing outside the workspace is rejected. | **NO ACTION**: keep the realpath resolution. Regression coverage belongs in the file-tools test suite. |
| **SDLC Remediation Depth Bounding** | PARTIAL | `src/mcp/langgraph/edges/router.js`, `src/mcp/langgraph/nodes/remediate.js` | The graph bounds retries: `node_remediate` marks `gateVerdict = 'circuit_open'` when its breaker trips, and `reviewRouter`/`remediateRouter` then route to `node_error` (closed circuit, turn ends). There is **no** `MAX_REMEDIATION_DEPTH = 3` counter and no `FAILED_REVIEW_EXHAUSTED` task state in the source. | **IMPROVE EXISTING**: if a persisted per-task cap is wanted, add the counter to `sdlc_tasks` in `src/workflow/kage-reviewer/sdlc_manager.js`. Do not add a second loop controller beside the graph breaker. |
| **FTS5 Query Sanitization & Exact Match** | YES | `sanitizeFts5Query` in `src/db.js`, used by `querySkillsByKeyword` in `src/mcp/skills_search.js` | Sanitization is in place: typographic quotes normalized, unbalanced quotes/parens neutralized, bare `*` stripped, dangling operators lowercased, `NEAR(...)` rewritten. Ranking uses weighted `bm25(skills_fts, 10.0, 5.0, 8.0, 1.0)`. There is **no** tiered `"exact phrase"*` boost layer. | **IMPROVE EXISTING (optional)**: prepend a quoted exact-phrase tier inside `sanitizeFts5Query` when the query matches a known skill name. Note the function lives in `src/db.js`, not `src/mcp/skills.js` (`src/mcp/skills.js` is now a facade over `skills_common` / `skills_search` / `skills_retrieval`). |
| **New Parallel Memory Engine** | NO | N/A | Existing `project_memory` + `persona_memories` tables in SQLite already satisfy persistence requirements. | **REJECT**: a parallel memory system would violate the single-concept rule. |
| **New Parallel Retrieval Engine** | NO | N/A | FTS5 + ONNX vector search + MS MARCO reranker already provides hybrid RRF retrieval. | **REJECT**: avoid duplication; tune existing hybrid weights. |

---

## 3. Targeted Improvement Plans

### Gap 1: Physical Realpath Workspace Boundary Protection — CLOSED

* **Does this capability already exist?** Yes, in `src/file_tools/common.js` (`isPathAllowed`, `isIdeInstallationDirectory`).
* **Where does it live?** `src/file_tools/common.js`.
* **What problem remained?** A malicious repository symlink (`symlink -> /etc/passwd` or `~/.ssh/`) would pass a textual `path.resolve` prefix check while pointing outside the workspace.
* **Status:** `fs.realpathSync` runs on the expanded and workspace paths before the boundary comparison, normalizing Windows separators. Textual prefix checks alone no longer decide access.
* **Measurable outcome:** symlink-based workspace traversal is resolved to its real target and rejected.

---

### Gap 2: SDLC Remediation Loop Termination Bound — PARTIAL

* **Does this capability already exist?** Partially, in `src/mcp/langgraph/nodes/remediate.js` and `src/mcp/langgraph/edges/router.js`.
* **Where does it live?** Those two files; task persistence in `src/workflow/kage-reviewer/sdlc_manager.js`.
* **What problem remains?** The graph terminates a runaway loop by tripping its per-thread breaker and routing to `node_error`. A *persisted* per-task attempt count does not exist, so an operator inspecting `sdlc_tasks` cannot see how many remediation rounds a task consumed before the circuit opened.
* **Can existing implementation be improved?** Yes: store `remediation_count` on `sdlc_tasks`, increment it in `remediate.js`, and record the terminal state through `sdlc_manager.js`. Do not introduce a second, independent depth limiter.
* **Measurable outcome:** remediation attempts are visible and bounded per task in the database, not only in graph memory.

---

### Gap 3: FTS5 Exact-Keyword Reranking Fallback — PARTIAL

* **Does this capability already exist?** Yes for sanitization and ranking; no for an exact-name boost tier.
* **Where does it live?** `sanitizeFts5Query` in `src/db.js`; `querySkillsByKeyword` in `src/mcp/skills_search.js` (`bm25(skills_fts, 10.0, 5.0, 8.0, 1.0)`).
* **What problem remains?** Hyphenated names such as `tokubetsu-jonin-skill` sanitize to plain terms. Ranking is field-weighted BM25 with no guaranteed exact-name priority, so a longer skill whose body mentions the terms can outrank the skill actually named.
* **Can existing implementation be improved?** Yes: add a tiered query (`"exact name"* OR term1* OR term2*`) in `sanitizeFts5Query`, keeping the existing weighted BM25 ordering as the tiebreaker. Skill-name subpath resolution on the retrieval side already handles `<skill>/<file>` and `<skill>/references/<file>` through `_findSubpathInMirror` in `src/mcp/skills_common.js`.
* **Measurable outcome:** higher precision and Recall@1 for queries that exactly name a skill.
