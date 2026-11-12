# 🍃 Konoha System Architecture & MCP Server Specifications (v2.2.21)

Technical specification of the Konoha MCP Server architecture, 48 canonical tools, transport mechanisms, runtime state, parallel worktree isolation, Real-Time Idle `@advisor`, and dynamic website builder invariants.

---

## 🏛️ System Architecture Overview

Konoha is a production-grade Model Context Protocol (MCP) orchestrator and multi-agent coordination server. It serves ALL 48 canonical tools through standard MCP protocols, reducing token consumption by 83%–98% across 8 AI coding clients:
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

All 48 canonical MCP tools (plus 2 hidden deprecated compatibility aliases, 50 total in manifest) are formally declared in `src/mcp_tool_manifest.json` and dispatched via `src/mcp/tool_dispatch.js`:

| Category | Tools | Primary Purpose |
|---|---|---|
| **Orchestration & Workflow** | `sannin`, `check_readiness`, `get_resolved_task_dir`, `report_from_agent`, `get_task_evidence`, `get_slop_findings`, `qa_codify`, `qa_e2e_run` | Request triage, LangGraph StateGraph execution, Real-Time Idle `@advisor` inspection, test codification, E2E runner. |
| **Skill & Knowledge RAG** | `find_skill`, `get_skill`, `list_skills`, `use_skills`, `migrate_skills`, `optimize_report` | SQLite FTS5 RAG search, compact multi-skill digest (`<= 6,400 bytes`), on-demand skill retrieval, token footprint analysis. |
| **Bounded File Operations** | `read_file_head`, `read_file_range`, `token_efficient_grep`, `file_info`, `get_file_structure`, `find_files_clean` | Bounded file I/O, token-capped grepping, symbol outline preview. |
| **Specialist Subagents** | `kage`, `jonin`, `anbu`, `chunin`, `tokubetsu_jonin`, `genin`, `akatsuki`, `yamanaka` | Direct invocation of the 8 specialist personas (`@sannin` is router-only). |
| **Security & Auditing** | `akatsuki_init`, `anti_slop`, `aislop_scan`, `aislop_why`, `aislop_fix`, `aislop_baseline`, `docs_ai_detector`, `website_ai_detector` | Dual-mode red/blue security, Zero-AI-Slop audit, automated repairs, AI detection. |
| **Document Engineering** | `document_create`, `spreadsheet_create`, `presentation_create`, `diagram_create`, `animation_export` | Native DOCX/PDF, XLSX, PPTX, SVG diagrams, and animated WebP exports. |
| **Web & Research** | `web_search`, `build_from_text`, `build_from_source` | Live web research and dynamic website scaffolding specification generators. |
| **Memory & Context** | `get_project_context`, `save_project_context`, `query_project_memory`, `save_persona_memory`, `query_persona_memory`, `list_persona_memories`, `delete_persona_memory`, `get_soul` | Project invariants, flow-bounded persona memories, and soul archetypes. |

### Strict Tool Boundaries
1. **Repository Code Search**: ALWAYS use Semble MCP (`semble.search`, `semble.find_related`) with absolute repository path. NEVER use native grep/find/cat or Konoha skill tools for code exploration.
2. **Skill Discovery**: ALWAYS use Konoha MCP (`konoha.find_skill`, `konoha.get_skill`, `konoha.use_skills`). NEVER search for skills with Semble.
3. **File Inspection**: ALWAYS use Konoha bounded tools (`read_file_range`, `read_file_head`, `token_efficient_grep`). Never execute raw shell `cat` or `grep`.
4. **Shell Execution**: ALWAYS prefix shell commands with `rtk <command>`.

---

## 📡 Transports & Communications

- **stdio**: Primary low-latency JSON-RPC transport for local IDE/CLI clients (Cursor, Claude Code, Antigravity, OpenCode, Command Code, Codex, Pi, OMP).
- **SSE (Server-Sent Events)**: Web UI streaming events and real-time log dispatching.
- **WebSocket (`port 1404`)**: Real-time bidirectional telemetry, status streaming, and remote client coordination. Note: the Yamanaka 3D Studio menu in the Web UI is hidden (`SHOW_3D_STUDIO_MENU = false`) and 3D controllers are lazy-loaded on demand with zero idle memory overhead.

---

## 🎨 Dynamic Konoha Website Builder Architecture (`v2.2.21`)

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
