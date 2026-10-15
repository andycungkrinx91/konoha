# Konoha Architecture Canonical Naming Specification

**Document Version:** 1.0.0 (Konoha v2.0.2)  
**Date:** 2026-10-02  
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
- `anti_slop(code?, path?)` — Canonical deterministic rule-based anti-slop verification pre-gate
- `check_readiness(task_id, criteria?)`
- `get_task_evidence(task_id)`
- `get_slop_findings(task_id?, compact?)`
- `website_ai_detector(url_or_content)`
- `docs_ai_detector(file_path_or_content)`

#### QA Automation
- `qa_codify(flow_definition, output_path?)` — Playwright spec compilation from flow JSON
- `qa_e2e_run(spec_path, headless?)` — Bounded E2E execution with <2,000 char output cap

#### Native Document Engineering & Animated WebP
- `document_create(output_path?, title, classification?, author?, sections, cover_model?, gradient_theme?, target_zero_gpt?)` — Word (.docx), PDF, and Markdown deliverable generation
- `spreadsheet_create(output_path?, sheets, palette?)` — Multi-tab XLSX spreadsheets with KPI cards and formula computation
- `presentation_create(output_path?, title, subtitle?, slides, gradient_theme?, layout?)` — 16:9 widescreen PPTX generation
- `diagram_create(output_path?, nodes, edges, orientation?, gradient_theme?)` — Dual orientation SVG diagram generation (horizontal LR or vertical TB)
- `animation_export(input_path, output_path?, format?, duration_sec?, fps?)` — Canonical Animated WebP (.webp) diagram animation export

#### Zero-API-Key Web Search
- `web_search(query, category?)`

---

### 2.3 Document Engineering Formats & Presets

- **Canonical Animation Output:** `webp` (Animated WebP encoded via Playwright + FFmpeg `libwebp` with `-loop 0 -q:v 75`).
- **Compatibility Animation Output:** `gif` (Supported when caller explicitly requests `format: 'gif'`).
- **Static Image Fallback:** `png` (High-DPI static screenshot fallback when ffmpeg is unavailable).
- **Cover Art Models:**
  1. `diamond_cascade`: Modern geometric diamonds with dynamic linear gradients and bottom 15% metadata positioning.
  2. `minimal_clean`: Stark editorial Swiss layout with generous whitespace, subtle grid lines, and crisp typography.
  3. `cyber_circuit`: Tech-forward nodal circuit trace lines, subtle glowing accents, and dark blueprint grid.
  4. `modern_abstract`: Fluid wave curves and organic gradient shapes.
- **Curated Gradient Themes (10 Presets):**
  - Theme 1: `#3B82F6, #14B8A6, #8B5CF6, #F97316` (Ocean Electric)
  - Theme 2: `#EAB308, #EC4899, #84CC16, #06B6D4` (Neon Citrus)
  - Theme 3: `#6366F1, #F43F5E, #3B82F6, #EAB308` (Sunset Violet)
  - Theme 4: `#8B5CF6, #06B6D4, #F97316, #EC4899` (Cosmic Pulse)
  - Theme 5: `#14B8A6, #84CC16, #6366F1, #F43F5E` (Emerald Aurora)
  - Theme 6: `#F97316, #EAB308, #3B82F6, #EC4899` (Solar Flare)
  - Theme 7: `#06B6D4, #8B5CF6, #14B8A6, #6366F1` (Cyber Teal)
  - Theme 8: `#EC4899, #F43F5E, #EAB308, #84CC16` (Crimson Bloom)
  - Theme 9: `#3B82F6, #6366F1, #06B6D4, #F43F5E` (Deep Indigo)
  - Theme 10: `#84CC16, #14B8A6, #EAB308, #8B5CF6` (Lime Forest)

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
