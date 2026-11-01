# 🍃 Konoha System Architecture & MCP Server Specifications (v2.2.17)

Technical specification of the Konoha MCP Server architecture, 47 canonical tools, transport mechanisms, runtime state, and universal website builder invariants.

---

## 🏛️ System Architecture Overview

Konoha is a production-grade Model Context Protocol (MCP) orchestrator and multi-agent coordination server. It serves ALL 47 canonical tools through standard MCP protocols, reducing token consumption by 83%–98% across 8 AI coding clients:
- **Antigravity IDE/CLI** (`~/.gemini/config/mcp_config.json`, hooks)
- **Cursor IDE/CLI** (`~/.cursor/mcp.json`, `.cursor/rules/`)
- **Claude Code** (`~/.claude.json`)
- **OpenCode** (`~/.config/opencode/opencode.json`)
- **Command Code** (`~/.commandcode/mcp.json`)
- **Codex** (`~/.codex/config.toml`, `~/.codex/AGENTS.md`)
- **Pi (pi.dev)** (`~/.pi/agent/mcp.json` via the `pi-mcp-adapter` extension)
- **OMP** (`~/.omp/agent/mcp.json`, `~/.omp/agent/AGENTS.md`)

---

## 🛠️ Canonical MCP Tools & Server Boundaries

All 47 canonical MCP tools are formally declared in `src/mcp_tool_manifest.json` and dispatched via `src/mcp/tool_dispatch.js`:

| Category | Tools | Primary Purpose |
|---|---|---|
| **Orchestration & Workflow** | `sannin`, `check_readiness`, `get_resolved_task_dir`, `report_from_agent`, `get_task_evidence`, `get_slop_findings`, `qa_codify`, `qa_e2e_run` | Request triage, LangGraph StateGraph execution, test codification, E2E runner. |
| **Skill & Knowledge RAG** | `find_skill`, `get_skill`, `list_skills`, `use_skills`, `migrate_skills`, `optimize_report` | SQLite FTS5 RAG search, on-demand skill retrieval, token footprint analysis. |
| **Bounded File Operations** | `read_file_head`, `read_file_range`, `token_efficient_grep`, `file_info`, `get_file_structure`, `find_files_clean` | Bounded file I/O, token-capped grepping, symbol outline preview. |
| **Specialist Subagents** | `kage`, `jonin`, `anbu`, `chunin`, `tokubetsu_jonin`, `genin`, `akatsuki` | Direct invocation of specialist personas for focused tasks. |
| **Security & Auditing** | `akatsuki_init`, `anti_slop`, `aislop_scan`, `aislop_why`, `aislop_fix`, `aislop_baseline`, `docs_ai_detector`, `website_ai_detector` | Dual-mode red/blue security, Zero-AI-Slop audit, automated repairs, AI detection. |
| **Document Engineering** | `document_create`, `spreadsheet_create`, `presentation_create`, `diagram_create`, `animation_export` | Native DOCX/PDF, XLSX, PPTX, SVG diagrams, and animated WebP exports. |
| **Web & Research** | `web_search`, `build_from_text`, `build_from_source` | Live web research and website scaffolding specification generators. |
| **Memory & Context** | `get_project_context`, `save_project_context`, `query_project_memory`, `save_persona_memory`, `query_persona_memory`, `list_persona_memories`, `delete_persona_memory`, `get_soul` | Project invariants, flow-bounded persona memories, and soul archetypes. |

### Strict Tool Boundaries
1. **Repository Code Search**: ALWAYS use Semble MCP (`semble.search`, `semble.find_related`) with absolute repository path. NEVER use native grep/find/cat or Konoha skill tools for code exploration.
2. **Skill Discovery**: ALWAYS use Konoha MCP (`konoha.find_skill`, `konoha.get_skill`). NEVER search for skills with Semble.
3. **File Inspection**: ALWAYS use Konoha bounded tools (`read_file_range`, `read_file_head`, `token_efficient_grep`). Never execute raw shell `cat` or `grep`.
4. **Shell Execution**: ALWAYS prefix shell commands with `rtk <command>`.

---

## 📡 Transports & Communications

- **stdio**: Primary low-latency JSON-RPC transport for local IDE/CLI clients (Cursor, Claude Code, Antigravity, OpenCode, Command Code, Codex, Pi, OMP).
- **SSE (Server-Sent Events)**: Web UI streaming events and real-time log dispatching.
- **WebSocket (`port 1404`)**: Real-time bidirectional telemetry, status streaming, and remote client coordination.

---

## 🎨 Universal Konoha Website Builder Invariants

When scaffolding or generating websites from text (`konoha.build_from_text`) or design mockups (`konoha.build_from_source`), the following design invariants are mandatory across all supported frameworks (**Next.js, SvelteKit, Nuxt, Angular**):

### 1. Far-Left Brand Logo & Zero Mobile Header Hamburger
- **Far-Left Brand Logo**: The brand logo MUST always be placed on the far LEFT (`justify-start` / `flex items-center gap-3`) of the navigation header. Never center or push right.
- **Zero Mobile Hamburger Menu**: In mobile view (`lg:hidden`), **NEVER show a top menu toggle or hamburger button in the header**. Mobile navigation is powered exclusively by the fixed bottom Mobile Dock.

### 2. Floating Bottom-Left 10-Theme Light Mode Switcher FAB
- **Placement**: Fixed floating in the bottom-left corner (`fixed bottom-6 left-6 z-50`, like a customer chat/FAB button) on both desktop and mobile viewports.
- **Pure Light Mode**: 10 curated Light Mode gradient themes (`byakugan`, `chidori`, `konoha-leaf`, `rasengan`, `sharingan`, `hokage-gold`, `anbu-shadow`, `sage-mode`, `sound-village`, `akatsuki`). Zero forced dark mode.
- **SSR Hydration Safety**: Strict mounted state guards before accessing `localStorage` or rendering theme DOM to guarantee zero hydration mismatch errors.

### 3. Archetype-Adaptive Sticky Mobile Bottom Navigation Dock
- **Placement**: Fixed mobile navigation dock (`fixed bottom-0 left-0 right-0 z-40 lg:hidden backdrop-blur-lg bg-white/90 border-t border-[var(--theme-border)] pb-safe`).
- **Adaptive Routes**:
  - *Admin / Metric Infra Dashboard*: Overview, Analytics, Nodes/Users, Alerts, Settings, Themes
  - *Portfolio / Personal*: Home, Projects, Experience, Skills, Contact, Themes
  - *SaaS / Landing Page*: Home, Features, Pricing, Testimonials, Themes
  - *E-Commerce*: Home, Shop, Categories, Wishlist, Cart, Themes

### 4. Admin & Infra Dashboard Left Sidebar Invariant
- **Desktop Sidebar**: Fixed Left Sidebar (`hidden lg:flex w-64 flex-col border-r border-[var(--theme-border)] bg-white/95 min-h-screen sticky top-0`) with brand logo at top-left, menu items with badges, and user profile badge.
- **Mobile View**: Seamlessly handled by the Mobile Dock with zero broken header menu toggles.

### 5. Hero Banner Carousel
- Full-width interactive hero banner with a minimum of 4 high-definition slides, 5000ms autoplay interval with hover pause, chevron controls, and dot indicators.

### 6. Human-Built Code Fingerprints
- **No Generator Meta Tags**: Never emit `<meta name="generator">` or build-tool identifiers.
- **No AI Comments**: Shipped code must contain zero comments referencing AI tools, models, or prompt engineering.
- **Phosphor Icons Standard**: Always install `@phosphor-icons/react` or `@phosphor-icons/svelte`. NEVER install Lucide.
- **Mandatory Package Scripts**: Every generated project's `package.json` must define `"dev"`, `"lint"`, `"build"`, and `"start"` (plus `"check"` for SvelteKit), passing cleanly with 0 errors and 0 warnings.
