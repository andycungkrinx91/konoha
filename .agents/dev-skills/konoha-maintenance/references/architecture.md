# 🍃 Konoha System Architecture & MCP Server Specifications (v2.2.24)

Technical specification of the Konoha MCP Server architecture, 56 canonical tools, transport mechanisms, runtime state, parallel worktree isolation, Real-Time Idle `@advisor`, and dynamic website builder invariants.

---

## 🏛️ System Architecture Overview

Konoha is a production-grade Model Context Protocol (MCP) orchestrator and multi-agent coordination server. It serves ALL 56 canonical tools through standard MCP protocols, reducing token consumption by 83%–98% across 8 AI coding clients:
- **Antigravity IDE/CLI** (`~/.gemini/config/mcp_config.json`, hooks)
- **Cursor IDE/CLI** (`~/.cursor/mcp.json`, `~/.cursor/rules/`)
- **Claude Code** (`~/.claude.json`, `~/.claude/settings.json`)
- **OpenCode** (`~/.config/opencode/opencode.json`)
- **Command Code** (`~/.commandcode/mcp.json`)
- **Codex** (`~/.codex/config.toml`, `~/.codex/AGENTS.md`)
- **Pi (pi.dev)** (`~/.pi/agent/mcp.json` via the `pi-mcp-adapter` extension)
- **OMP** (`~/.omp/agent/mcp.json`, `~/.omp/agent/AGENTS.md`)

---

## 🛠️ Canonical MCP Tools & Server Boundaries

All 56 canonical MCP tools (plus 2 hidden deprecated compatibility aliases, 58 total in manifest) are formally declared in `src/mcp_tool_manifest.json` and dispatched via `src/mcp/tool_dispatch.js`:

| Category | Tools | Primary Purpose |
|---|---|---|
| **Orchestration & Workflow** | `sannin`, `check_readiness`, `get_resolved_task_dir`, `report_from_agent`, `get_task_evidence`, `get_slop_findings`, `qa_codify`, `qa_e2e_run` | Request triage, LangGraph StateGraph execution, Real-Time Idle `@advisor` inspection, test codification, E2E runner. |
| **Skill & Knowledge RAG** | `find_skill`, `get_skill`, `list_skills`, `use_skills`, `migrate_skills`, `optimize_report` | SQLite FTS5 RAG search merged with the project's own skill tree (`.agents/skills` + 16 siblings via `getSkillReadRoots`), compact multi-skill digest (`<= 6,400 bytes`), on-demand skill retrieval, token footprint analysis. `migrate_skills` adds ranking, not access. |
| **Bounded File Operations** | `read_file_head`, `read_file_range`, `token_efficient_grep`, `file_info`, `get_file_structure`, `find_files_clean` | Bounded file I/O, token-capped grepping, symbol outline preview. |
| **Native Code Intelligence** | `code_index`, `code_search`, `code_symbol`, `code_context`, `code_impact`, `code_related`, `code_status`, `code_remove` | In-process SQLite FTS5 code indexing, definition-first search, and symbol/impact graph. |
| **Specialist Subagents** | `kage`, `jonin`, `anbu`, `chunin`, `tokubetsu_jonin`, `genin`, `akatsuki`, `yamanaka` | Direct invocation of the 8 specialist personas (`@sannin` is router-only). |
| **Security & Auditing** | `akatsuki_init`, `anti_slop`, `docs_ai_detector`, `website_ai_detector` | Dual-mode red/blue security, Zero-AI-Slop audit, AI detection. |
| **Document Engineering** | `document_create`, `spreadsheet_create`, `presentation_create`, `diagram_create`, `animation_export` | Native DOCX/PDF, XLSX, PPTX, SVG diagrams, and animated WebP exports. |
| **Web & Research** | `web_search`, `build_from_text`, `build_from_source` | Live web research and dynamic website scaffolding specification generators. |
| **Memory & Context** | `get_project_context`, `save_project_context`, `query_project_memory`, `save_persona_memory`, `query_persona_memory`, `list_persona_memories`, `delete_persona_memory`, `get_soul` | Project invariants, flow-bounded persona memories, and soul archetypes. |

The `aislop_scan`, `aislop_why`, `aislop_fix`, and `aislop_baseline` tools are **not** Konoha tools. They are served by the separate Aislop MCP server, so they appear in no manifest row above and are absent from `src/mcp/tool_dispatch.js`; the 56-tool count is Konoha's own surface.

### Strict Tool Boundaries
1. **Repository Code Search**: ALWAYS use the native code intelligence tools (`code_search`, `code_symbol`, `code_impact`) with the absolute repository root. NEVER use native grep/find/cat or Konoha skill tools for code exploration.
2. **Skill Discovery**: ALWAYS use Konoha MCP (`konoha.find_skill`, `konoha.get_skill`, `konoha.use_skills`). NEVER search for skills with `code_search`.
3. **File Inspection**: ALWAYS use Konoha bounded tools (`read_file_range`, `read_file_head`, `token_efficient_grep`). Never execute raw shell `cat` or `grep`.
4. **Shell Execution**: ALWAYS prefix shell commands with `rtk <command>`.

### The Project Guardrail Is an Architecture Boundary, Not a Lint Rule

`src/project_konoha_mcp_guardrail.js` evaluates every tool call and every shell command before it runs, and it can refuse. A refusal is a **branchable decision**, not a dead end:

- **`GUARDRAIL_REMEDIATION`** maps each denial code to what the operator should do instead, so a denial never arrives as a bare "denied".
- **`--hitl`** opens a menu on the *controlling terminal* (`/dev/tty`; `CONIN$`/`CONOUT$` on Windows) when stdin is a pipe, and records a code+tool-scoped risk acceptance with a TTL capped at one hour. Hooks never prompt — they stay fail-closed, and `KONOHA_GUARD_NO_TTY=1` can only force a block, never grant one.
- **The exception store is an attack surface.** `.konoha/guardrail-exceptions.json` and `.konoha/guardrail-audit.jsonl` are writable only through `src/guardrail_exceptions.js`; any tool path that could write them is itself denied with a `NON_ACCEPTABLE_CODES` entry, which the menu refuses to accept. Some denials — secret write, destructive shell, retired IPC/MCP, store write — have no acceptable form at all.
- **Every client binds through one spelling.** `src/mcp/hitl_picker.js` keys `claudecode` and `antigravity`, serves the web picker from the MCP process itself (port `ui_port + 1`), and never preselects an option.

Guards: `tests/test_project_konoha_mcp_guardrail.js` tests 9-15, including a pty leg driven by `tests/helpers/pty_driver.py` that proves the CLI exits on its own.


### A Query Indexes What It Names, and Only on the Path That Can Afford It

`code_search` used to answer `root not indexed: <path>` for any directory named for the first time, which is the normal state of a sibling project. `src/code_intel/auto_index.js` stats the directory and runs a lexical-only pass (`embed: false`, `maxFiles: 5000`, `timeoutMs: 15000`); `code_index` adds vectors later.

- **Sync handlers index inline.** `resolveRoot` is one choke point, so `code_search`, `code_symbol`, `code_context`, `code_impact`, and `code_related` all inherit the behaviour.
- **Async handlers never take the blocking pass.** `prepareSearchSetupAsync` and `_resolveAnchorAsync` await `indexRepositoryAsync` (yields every four files) before the sync base runs, which is what keeps `tools/list` answerable during a first-use index.
- **`code_status` stays read-only.** It calls `store.getRoot`; indexing there would resurrect a root `code_remove` just cleared.

A row is not proof of an index. `ensureRoot` inserts `stale` with `indexed_at NULL` *before* the walk, so a pass that timed out or threw leaves behind exactly the row every later query would trust — turning the old loud error into an empty result set. `isUsableRoot` therefore requires `fresh`, or `stale` with a completion time, and retries anything else; a `stale` row that a completed walk left partial is surfaced as `index_incomplete: true` rather than passing for a small repo. Only a writer may create a row: `@genin` and `@advisor` are read-only by role, `checkGeninToolAccess` guards `code_index` but not `code_search`, so the first-use pass is skipped for them (`KONOHA_READONLY=1` or the detected agent) and the caller gets the actionable error. Concurrent first-use queries on one root share a single pass through a module-level in-flight map, because the indexer holds no lock of its own.

Guards: `tests/test_code_intel_tools.js` — the auto-index leg, an async leg that replaces `indexRepository` with a throwing stub, a never-finished-row leg, an `index_incomplete` leg, two read-only legs (`KONOHA_READONLY` and a detected `@genin`), and a dedupe leg that asserts three concurrent `code_search_async` calls reach the indexer once.
---

## 📡 Transports & Communications

- **stdio**: Primary low-latency JSON-RPC transport for local IDE/CLI clients (Cursor, Claude Code, Antigravity, OpenCode, Command Code, Codex, Pi, OMP).
- **SSE (Server-Sent Events)**: Web UI streaming events and real-time log dispatching.
- **WebSocket (`port 1404`)**: Real-time bidirectional telemetry, status streaming, and remote client coordination. Note: the Yamanaka 3D Studio menu in the Web UI is hidden (`SHOW_3D_STUDIO_MENU = false`) and 3D controllers are lazy-loaded on demand with zero idle memory overhead.

---

## 🎨 Dynamic Konoha Website Builder Architecture (`v2.2.24`)

When scaffolding or generating websites from text (`konoha.build_from_text`) or design mockups (`konoha.build_from_source`), `@jonin` executes a dynamic, context-driven design architecture across all supported frameworks (**Next.js, SvelteKit, Nuxt, Angular**):

### 1. Dynamic Astra/Fable-Inspired Composition (No Rigid Template)
- **Context-Driven Layouts**: Every generated interface derives hero composition, typography scale, section rhythm, and interactive surfaces from the design brief. There is no fixed hero, carousel, or floating theme-widget preset.
- **Brief-Derived Design**: `build_from_text`/`build_from_source` return a 9-field `design_brief` (product, industry, audience, primary_objective, user_outcome, information_architecture, interactions, visual_identity, technical_constraints) plus `inferred_domain_hints` across 16 domains. Art direction, IA, navigation pattern, theme count, and motion are derived from that brief — never from a fixed archetype map.
- **Theme Strategy**: Semantic CSS custom properties (`--bg-canvas`, `--bg-surface`, `--text-primary`, `--text-muted`, `--border-subtle`, `--accent-primary`) defined per project with WCAG AA contrast; single or dual theme as the brief decides.
- **Branding Scope**: Myōboku/Konoha branding applies only to the Konoha Web UI itself, never to generated client projects (which carry only the `Build by konoha` generator meta and footer signature).

### 2. Optional Figma & OpenDesign Dual-Mode Integration
- **Mode A (Exported Design Files)**: `build_from_source` ingests mockup images (`.png`, `.jpg`, `.webp`, `.svg`) and design documents (`.fig`, `.pen`, `.json` token exports) with 100% layout fidelity.
- **Mode B (Live MCP Sync)**: When `figma` or `opendesign` MCP servers are active, `@jonin` queries live frames and design tokens directly.

### 3. Real-Time Auto-Open Browser Monitor & Project Maintenance Skill
- **Live Browser Monitor (`src/workflow/jonin-builder/live_browser_monitor.js`)**: Automatically opens the user's system browser (`xdg-open`, `open`, `start`) during dev server verification and audits responsive viewports (`375x812`, `768x1024`, `1440x900`), zero console errors, and zero emojis.
- **Automatic Project Skill Generator (`src/workflow/jonin-builder/project_skill_generator.js`)**: Generates `<project_path>/.agents/skills/<project-slug>-frontend-maintenance/SKILL.md` after frontend generation and indexes it into `konoha.db` (`skills`, `skills_fts`, `skill_chunks`) isolated by `project_hash`.

### 4. Mandatory Konoha Brand Signature & Quality Gates
- **Generator Signature**: Every generated website MUST include `<meta name="generator" content="Build by konoha">` in `<head>` and render the exact visible text `Build by konoha` in `<footer>` (exempted from AI-fingerprint penalties in `src/workflow/jonin-builder/ai_detector.js`).
- **Zero-Emoji Policy**: Strictly zero emojis or emoticons in UI controls, headings, or body copy. Use crisp SVG vector icons (`@phosphor-icons/*` or `@radix-ui/react-icons`).
- **Mandatory Package Scripts**: Every generated project's `package.json` must define `"dev"`, `"lint"`, `"build"`, `"start"`, and `"test"` (plus `"check"` for SvelteKit), passing cleanly with 0 errors and 0 warnings.
