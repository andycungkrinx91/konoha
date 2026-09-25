# Konoha Architecture Canonical Naming Specification

**Document Version:** 1.0.0 (Konoha v2.0.1)  
**Date:** 2026-09-25  
**Status:** Authoritative Standard  

---

## 1. Guiding Principle

> **One concept. One name. One implementation. One interface. One source of truth.**

Every concept across the Konoha ecosystem must have exactly one canonical identifier.

---

## 2. Canonical Vocabulary Standards

### 2.1 Agent Identifiers & Roster

The Konoha agent hierarchy defines strictly seven ninja specialists and one router. Hyphenated kebab-case is canonical for agent identifiers; snake_case is reserved strictly where MCP tool schemas prohibit hyphens.

| Agent Name | Canonical Role | Canonical Skill | Canonical MCP Tool |
|---|---|---|---|
| `sannin` | Router & Planner | `sannin-skill` | `sannin` |
| `genin` | Scout & Code Explorer | `genin-skill` | `genin` |
| `kage` | Village Leader & Architect | `kage-skill` | `kage` |
| `chunin` | Intel Ninja & Web Researcher | `chunin-skill` | `chunin` |
| `jonin` | Elite Frontend & 3D Builder | `jonin-skill` | `jonin` |
| `anbu` | Backend & DevOps Specialist | `anbu-skill` | `anbu` |
| `tokubetsu-jonin` | Technical Scribe & Documenter | `tokubetsu-jonin-skill` | `tokubetsu_jonin` |

* **Invariant:** Never introduce shadow agents or alternative agent aliases (`deep-code-explorer`, `code-architect`, etc.).

---

### 2.2 Canonical MCP Tools (Canonical Roster)

All MCP tools served by the `konoha` server follow strict canonical snake_case naming without redundant aliases.

#### Bounded File Tools
- `read_file_head(path, max_lines)`
- `read_file_range(path, start_line, end_line)`
- `file_info(path)`
- `token_efficient_grep(path, pattern, max_results)`
- `get_file_structure(directory, max_depth)`
- `find_files_clean(directory, pattern, limit)`

#### Skill Intelligence & Retrieval
- `find_skill(keyword, limit?)` — Canonical skill search (replaces plural alias `find_skills`)
- `list_skills(limit?)` — Canonical skill listing
- `get_skill(name)` — Canonical skill loader
- `optimize_report(query)` — Canonical skill-to-prompt optimizer
- `migrate_skills(clean?, rebuild_embeddings?)` — Canonical migration trigger

#### UI & Website Architecture
- `build_from_source(name, source_dir, framework, taste_dials?)` — Canonical image/source build (replaces `build_with_image_design`)
- `build_from_text(name, description, framework, taste_dials?)` — Canonical text-to-UI specification

#### Agent Delegation & Task Execution
- `sannin(task, context, constraints, skills, taste_dials?, project_path?)`
- `genin(...)`
- `kage(...)`
- `chunin(...)`
- `jonin(...)`
- `anbu(...)`
- `tokubetsu_jonin(...)`
- `report_from_agent(task_id, learnings, artifacts?, status?)`
- `get_resolved_task_dir(task_id)` (isolated fallback only)

#### Project Context & Memory
- `get_project_context(project_path)`
- `save_project_context(project_path, context_data)`
- `query_project_memory(project_path, query, limit?)`

#### Persona Memory
- `save_persona_memory(key, category, content, importance?)`
- `query_persona_memory(query, category?, limit?)`
- `list_persona_memories(category?, limit?)`
- `delete_persona_memory(id)`

#### SDLC Governance & Quality Gates
- `check_readiness(task_id, criteria?)`
- `get_task_evidence(task_id)`
- `get_slop_findings(task_id?, compact?)`
- `website_ai_detector(url_or_content)`
- `docs_ai_detector(file_path_or_content)`

#### Zero-API-Key Web Search
- `web_search(query, category?)`

---

### 2.3 Workflow Phases & Lifecycle States

The standard 8-phase Konoha workflow is canonical:

```text
Phase 1: Route (Sannin)
    ↓
Phase 2: Explore (Genin)
    ↓
Phase 3: Plan (Kage)
    ↓
Phase 4: Research (Chunin)
    ↓
Phase 5: Execute (Jonin / Anbu)
    ↓
Phase 6: Document (Tokubetsu-Jonin)
    ↓
Phase 7: Review (Kage)
    ↓
Phase 8: Synthesize (Sannin)
```

#### Canonical Task States:
- `PENDING`: Task initialized.
- `IN_PROGRESS`: Assigned agent executing.
- `REVIEW_REQUIRED`: Implementation complete, pending Kage verification.
- `REMEDIATING`: Review failed, returned to implementing agent with rejection feedback.
- `COMPLETED`: 100% Zero-AI-Slop and ≥ 98% confidence verified.
- `FAILED`: Unrecoverable exception or circuit breaker tripped.

---

### 2.4 Filesystem & Storage Paths

All persistent state and databases live strictly in standardized paths:

- **Database:** `~/.konoha/konoha.db` (canonical SQLite FTS5 database).
- **Global Config:** `~/.konoha/mcp_config.json`.
- **Global Agents:** `~/.agents/agents.yaml`.
- **Global Skills:** `~/.agents/skills/<agent-skill>/`.
- **Temporary Fallback Tasks:** `~/.konoha/tmp/<client>/<session>/scratch/tasks/<task_id>/`.
- **Web UI Application:** `apps/web/` (SvelteKit 3).
- **IDE Extensions:** `~/.antigravity-ide/extensions/andycungkrinx91.konoha-bridge-master-universal/` (Antigravity strictly exclusive).

---

### 2.5 Coding Client Identifiers

The canonical client identifier keys used across configuration, contracts, and APIs:

| Key | Canonical Display Name | Configuration Path |
|---|---|---|
| `antigravity` | Antigravity IDE/CLI | `~/.gemini/antigravity-cli/`, `~/.gemini/antigravity-ide/` |
| `cursor` | Cursor IDE/CLI | `~/.cursor/mcp.json`, `~/.cursor/rules/` |
| `claude` | Claude Code | `~/.claude.json`, `~/.claude.yaml` |
| `opencode` | OpenCode | `~/.config/opencode/opencode.json` |
| `commandcode` | Command Code | `~/.commandcode/mcp.json` |
| `codex` | OpenAI Codex | `~/.codex/config.json` |
| `pi` | Pi (pi.dev) | `~/.pi/agent/AGENTS.md` |
