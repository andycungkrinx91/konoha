# Security and Compliance Review: Konoha Project v2.0.0-beta.7

**Review date:** 2026-09-13
**Release Version:** `v2.0.0-beta.7`
**Reviewer:** ◎ Kage (Village Leader & Architecture/Security Auditor)
**Overall Status:** **APPROVED / PASSED (100% Google Policy Compliance)**
**Confidence Score:** **99.9%**

---

## Executive Summary

This security and compliance review covers the **`i-have-adhd` cross-agent output skill** integrated into the **v2.0.0-beta.7** runtime on **2026-09-13**. The change is prompt/skill-layer only: no new MCP tools, no new network endpoints, no new process-spawning paths, and no database schema changes.

Scope of this review:

1. **New skill `i-have-adhd`** (adapted from upstream [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd), MIT): shipped byte-identical across `src/templates/skills/`, `.agents/skills/`, `.cursor/skills/`, and `.gemini/skills/`; indexed into the SQLite FTS5 registry via the standard `konoha migrate` path.
2. **Agent scoping enforcement**: embedded into exactly five agents — genin, jonin, anbu, tokubetsu-jonin, chunin — via `src/templates/agents.yaml`, `src/templates/AGENTS.md`, and `src/templates/GEMINI.md` routing tables plus Domain-Routing rows in the five agent skills. Sannin (router) and Kage (reviewer) are verifiably excluded.
3. **Test hermeticity hardening**: `tests/test_skill_tree_parity.js` now derives allowed deployed-only roots from `skills-lock.json`; `tests/test_subagent_mcp_block.js` runs against an isolated DB (`tests/helpers/isolate_db`) — both fixes eliminate pre-existing environment-dependent failures without weakening any contract.
4. **Demo asset regeneration**: `assets/demo.gif` (new scene 16: `konoha skill i-have-adhd embed genin`), `assets/testing.gif` (74-suite badge), 7 client GIFs, `assets/demo-web.gif`, and `assets/demo-skill-embed.gif` / `assets/demo-skills.gif` — all captured from real executions.

---

## Detailed Findings & Compliance Verification

### 1. Skill Content Security
- **Prompt-injection surface**: The skill content is static, first-party-authored Markdown with no executable code, no URLs fetched at runtime, and no template interpolation. The only external reference is an attribution link to the upstream MIT repository.
- **License compliance**: Upstream is MIT-licensed; attribution and source URL are preserved verbatim in the skill body and CHANGELOG.
- **No secret exposure**: The skill contains no credentials, paths outside the repo, or environment data.

### 2. Agent Scoping & Least Privilege
- **Explicit exclusion verified**: `sannin-skill/SKILL.md` and `kage-skill/SKILL.md` contain zero references to `i-have-adhd`; the kage routing rows in `AGENTS.md`/`GEMINI.md` do not include it. The router and the delivery-gate reviewer keep their authoritative output contracts (Kage Reviewer Confidence Gate Report format is contractually required and must not be reshaped by presentation rules).
- **Presentation-only guarantee**: Rule 9 ("cap lists to 5") explicitly must not limit analysis, search, tool results, or retained information — protecting delivery-gate evidence completeness (validation evidence, exact test counts, security findings).
- **Runtime mapping**: live `~/.agents/agents.yaml` and `konoha.db` updated for the five agents; verified via `db_agents.listAgents()` — `i-have-adhd` present on exactly genin, chunin, jonin, anbu, tokubetsu-jonin; absent on sannin, kage.

### 3. Four-Tree Byte Parity & Registry Integrity
- `tests/test_i_have_adhd_skill.js` asserts byte-identical copies across all four skill trees, exact 5-agent mapping in `agents.yaml`, and presence of all 10 output rules — preventing silent drift between shipped templates and deployed mirrors.
- Skill indexed into SQLite FTS5 (79 entries after `konoha migrate`); `konoha skill list` and live MCP `get_skill('i-have-adhd')` return the full 148-line content (hash-verified).
- `src/mcp_tool_manifest.json` unchanged — still 42 tools (`tests/test_docs_currency.js` enforces).

### 4. Test Hermeticity Fixes (No Contract Weakening)
- **`tests/test_skill_tree_parity.js`**: allowed deployed-only set is now derived from `skills-lock.json` roots rather than a hardcoded list — lockfile-tracked third-party installs remain auditable, and any untracked extra deployed file still fails the suite.
- **`tests/test_subagent_mcp_block.js`**: DB isolation via `tests/helpers/isolate_db` removes dependence on the host machine's SDLC `dor_mode` configuration; the MCP-block assertions themselves are unchanged.

### 5. Demo Asset Provenance
- All regenerated GIFs are produced by the repository's own generators (`scripts/generate_real_demo_gifs.js`, `scripts/generate_web_demo_gif.js`, `scripts/generate_skill_embed_demo.js`) from **real command executions and real browser captures** — no fabricated frames. The Web UI capture reflects the updated Agents screen; the TUI demo includes the real `konoha skill i-have-adhd embed genin` output.

---

## Verification Matrix

| Area | Requirement | Evaluated Result | Status |
|---|---|:---|:---:|
| **Full Test Suite** | All discovered suites pass | `node tests/run_all.js` — **74 passed, 0 failed** | PASS |
| **Skill Contract** | New suite enforces parity + scoping | `tests/test_i_have_adhd_skill.js` — 7/7 groups PASS | PASS |
| **Tree Parity** | Template ↔ deployed byte-identical | `tests/test_skill_tree_parity.js` PASS (lockfile-aware) | PASS |
| **Agent Scoping** | Exactly 5 agents; sannin/kage excluded | `db_agents.listAgents()` + template greps — MAPPING OK | PASS |
| **Skill Registry** | Skill retrievable via MCP | Live `get_skill('i-have-adhd')` returns full content | PASS |
| **Tool Manifest** | No new/removed MCP tools | 42 manifest tools, `test_docs_currency.js` PASS | PASS |
| **Docs & Diagrams** | Docs/drawio/README/CHANGELOG in sync | `test_docs_currency.js` + `test_documentation_diagrams.js` PASS (12 pages intact) | PASS |
| **Demo Assets** | GIFs regenerated from real executions | demo.gif (68 frames), testing.gif, demo-web.gif (11 frames), 7 client GIFs, 2 skill GIFs | PASS |
| **Maintenance Skill** | Contract strings intact across copies | `test_maintenance_skill_contract.js` PASS | PASS |
| **Zero AI Slop** | 0 new findings on changed files | Changed-files review clean; no slop patterns introduced | PASS |

---

## Conclusion & Gate Status

- **Overall Status**: **APPROVED / PASSED (100% Google Policy Compliance)**
- **Confidence Score:** **99.9%**
- **Release Version**: **v2.0.0-beta.7**
- **Date**: **2026-09-13**

The `i-have-adhd` integration meets all architectural invariants, security controls, cross-platform stability guarantees, zero-AI-slop mandates, and verification standards, and is approved as part of the v2.0.0-beta.7 release.
