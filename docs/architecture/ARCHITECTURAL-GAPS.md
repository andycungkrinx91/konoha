# Konoha Architectural Gap Analysis

**Document Version:** 1.0.0 (Konoha v2.0.1)  
**Date:** 2026-09-25  
**Status:** Canonical Analysis  

---

## 1. Executive Summary

This analysis evaluates Konoha's architecture to identify genuine architectural gaps following canonicalization. Guided by the principle **"Never add architecture to solve a problem that the existing architecture can solve"**, all improvements target existing subsystems rather than introducing parallel layers.

---

## 2. Evaluation Decision Matrix

| Proposed Improvement Area | Existing Capability? | Current Owner | Sufficiency Assessment | Recommended Action |
|---|---|---|---|---|
| **Symlink-Safe Workspace Isolation** | YES | `src/file_tools/common.js` | Normalizes paths via `path.resolve`, but should resolve physical symlinks via `fs.realpathSync` to prevent workspace escape. | **IMPROVE EXISTING**: Harden canonical path resolution in `src/file_tools/common.js`. |
| **SDLC Remediation Depth Bounding** | YES | `src/sdlc_manager.js` | Transitions failed reviews to `REMEDIATING`, but requires explicit hard cap (max 3 remediation iterations) to guarantee termination. | **IMPROVE EXISTING**: Enforce deterministic loop bounds in `src/sdlc_manager.js`. |
| **FTS5 Query Sanitization & Exact Match** | YES | `src/mcp/skills.js` | Escapes FTS5 operators, but hyphenated skill names should be tokenized with quoted exact-match fallback. | **IMPROVE EXISTING**: Enhance query builder in `src/mcp/skills.js`. |
| **New Parallel Memory Engine** | NO | N/A | Existing `project_memory.js` + `persona_memory.js` in SQLite already satisfy persistence requirements. | **REJECT**: Parallel memory system would violate single-concept rule. |
| **New Parallel Retrieval Engine** | NO | N/A | FTS5 + ONNX vector search + MS MARCO reranker already provides hybrid RRF retrieval. | **REJECT**: Avoid duplication; tune existing hybrid weights. |

---

## 3. Targeted Improvement Plans

### Gap 1: Physical Realpath Workspace Boundary Protection

* **Does this capability already exist?** Yes, in `src/file_tools/common.js` (`isPathAllowed`, `isIdeInstallationDirectory`).
* **Where does it live?** `src/file_tools/common.js`.
* **What problem remains?** If a malicious repository contains a symlink pointing outside the workspace (e.g. `symlink -> /etc/passwd` or `~/.ssh/`), checking `path.resolve(symlink)` alone may not detect the true target file destination if the link points outside the permitted workspace root.
* **Why is current implementation insufficient?** It inspects textual path prefixes before checking physical filesystem resolution.
* **Can existing implementation be improved?** Yes: by applying `fs.realpathSync` (with fallback for non-existent target paths on write) before boundary checking.
* **Measurable outcome:** 100% resistance to symlink-based workspace traversal attacks.

---

### Gap 2: SDLC Remediation Loop Termination Bound

* **Does this capability already exist?** Yes, in `src/sdlc_manager.js` (`recordReviewVerdict`, `recordRemediationAttempt`).
* **Where does it live?** `src/sdlc_manager.js`.
* **What problem remains?** If an implementing agent repeatedly fails review criteria (confidence < 98%), the remediation cycle could theoretically loop indefinitely if external tools do not bound turns.
* **Can existing implementation be improved?** Yes: track `remediation_count` directly in `sdlc_tasks` and immediately freeze task with `FAILED_REVIEW_EXHAUSTED` state when attempts exceed `MAX_REMEDIATION_DEPTH = 3`.
* **Measurable outcome:** Deterministic termination of failed review cycles.

---

### Gap 3: FTS5 Exact-Keyword Reranking Fallback

* **Does this capability already exist?** Yes, in `src/mcp/skills.js` and `src/db.js`.
* **Where does it live?** `src/mcp/skills.js` (`searchSkillsFts`).
* **What problem remains?** When users query skills containing hyphens or punctuation (e.g., `tokubetsu-jonin-skill`), FTS5 treats hyphens as minus/NOT operators unless sanitized. The current sanitizer removes punctuation, but exact-match ranking should boost exact skill name matches.
* **Can existing implementation be improved?** Yes: construct a tiered FTS query (`"exact phrase"* OR term1* OR term2*`) in `src/mcp/skills.js`.
* **Measurable outcome:** Higher precision and Recall@1 for specific skill queries.
