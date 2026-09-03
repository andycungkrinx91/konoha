---
name: konoha
description: Guidelines and instructions for maintaining, extending, and debugging the Konoha MCP Tools Orchestrator, MCP middleware, and multi-archetype website builder across 6 coding clients (Antigravity IDE/CLI, Cursor, Claude Code, OpenCode, Command Code, Codex).
---

# 🍃 Konoha Maintenance & Engineering Skill

Comprehensive operational guide for maintaining, extending, and debugging the **Konoha MCP Tools Orchestrator**, SQLite FTS5 indexer, and multi-archetype website generation engine.

---

## 🏛️ System Architecture Overview

Konoha operates as a high-efficiency MCP orchestrator designed to reduce context token consumption by 83–98% across 6 AI coding clients:
- **Antigravity IDE/CLI** (`~/.gemini/config/mcp_config.json`, hooks)
- **Cursor IDE/CLI** (`~/.cursor/mcp.json`, `.cursor/rules/`)
- **Claude Code** (`~/.claude.json`)
- **OpenCode** (`~/.config/opencode/opencode.json`)
- **Command Code** (`~/.commandcode/mcp.json`)
- **Codex** (`~/.codex/config.toml`, `~/.codex/AGENTS.md`)

Each client environment is configured with three core MCP servers:
1. **`konoha`**: On-demand skill retrieval, bounded file I/O, subagent routing, and workflow gate orchestration.
2. **`semble`**: AI-powered semantic code search and dependency mapping.
3. **`aislop`**: Zero-AI-slop code hygiene validation, rule reasoning, automated repairs, and Kage delivery gating (`ai_slop_findings: 0`, `ai_slop_clean: true`).

---

## 🎨 Universal Konoha Website Builder Invariants

When scaffolding or generating websites from text (`konoha.build_from_text`) or design mockups (`konoha.build_from_source`), the following design invariants are mandatory across all 4 supported frameworks (**Next.js 16, SvelteKit 2 / Svelte 5, Nuxt 3, Angular v19+**):

### 1. Far-Left Brand Logo & Zero Mobile Header Hamburger
- **Header Logo Placement**: Brand logo MUST always be placed on the far LEFT (`justify-start` / `flex items-center gap-3`) of the navigation header.
- **Zero Mobile Hamburger Menu**: In mobile view (`lg:hidden`), **NEVER render a hamburger menu or top menu toggle button in the header**. Mobile navigation is powered exclusively by the fixed bottom Mobile Dock!

### 2. Floating Bottom-Left 10-Theme Switcher FAB
- **Placement**: Fixed floating in the bottom-left corner (`fixed bottom-6 left-6 z-50`, like a customer chat/FAB button) on both desktop and mobile viewports.
- **Pure Light Mode**: 10 curated Light Mode gradient themes (`imperial-gold`, `nebula-indigo`, `aurora-emerald`, `sunset-amber`, `ocean-sapphire`, `forest-jade`, `volcano-crimson`, `sakura-rose`, `cyber-violet`, `midnight-slate`).
- **SSR Hydration Safety**: Strict `useMounted()` guard before accessing `localStorage` or rendering theme DOM to guarantee **0 hydration mismatch errors**.

### 3. Archetype-Adaptive Sticky Mobile Bottom Navigation Dock
- **Placement**: Fixed mobile navigation dock (`fixed bottom-0 left-0 right-0 z-40 lg:hidden backdrop-blur-lg bg-white/90 border-t border-[var(--theme-border)] pb-safe`).
- **Adaptive Routes**:
  - *Admin / Metric Infra Dashboard*: Overview, Analytics, Nodes/Users, Alerts, Settings, Themes
  - *Portfolio / Personal*: Home, Projects, Experience, Skills, Contact, Themes
  - *SaaS / Landing Page*: Home, Features, Pricing, Testimonials, Themes
  - *Company Profile*: Home, About, Services, Case Studies, Contact, Themes
  - *E-Commerce*: Home, Shop, Categories, Wishlist, Cart, Themes
  - *Documentation*: Docs, Guides, API, Search, Themes

### 4. Admin & Infra Dashboard Left Sidebar Invariant
- **Desktop Sidebar**: Fixed Left Sidebar (`hidden lg:flex w-64 flex-col border-r border-[var(--theme-border)] bg-white/95 min-h-screen sticky top-0`) with brand logo at top-left, menu items with badges, and user profile badge.
- **Mobile View**: Seamlessly handled by the Mobile Dock with zero broken header menu toggles.

### 5. Hero Banner Carousel
- **Hero Carousel**: Full-width interactive hero banner with a minimum of 4 high-definition slides, 5000ms autoplay interval with hover pause, chevron controls, and dot indicators.

### 6. SSR & Hydration Safety Standards
- **Next.js 16**: `'use client'` + `useMounted()` state guard.
- **SvelteKit 2 / Svelte 5**: `$effect(() => { ... })` and `onMount` browser guards.
- **Nuxt 3**: `onMounted()` / `<ClientOnly>` safety wrappers.
- **Angular v19+**: `afterNextRender` / `isPlatformBrowser(inject(PLATFORM_ID))` guards.

### 7. Zero Errors & Zero Warnings Quality Gate
- Scaffolding MUST include required packages: `lucide-react` / `lucide-svelte` / `lucide-vue-next` / `lucide-angular`, `clsx`, `tailwind-merge`.
- Do not claim completion until `pnpm run build` and `pnpm run lint` pass cleanly with **0 errors and 0 warnings**.

---

### 8. Mandatory Package.json Scripts Invariant (pnpm lint, pnpm build, pnpm start)
- **Required Lifecycle Scripts**: Every generated or scaffolded project across all 4 frameworks MUST always define working scripts in `package.json` for:
  - `"dev"`: Local development server (`next dev`, `vite dev`, `nuxt dev`, `ng serve`)
  - `"lint"`: Formatting & lint check (`next lint`, `eslint .`, `ng lint`)
  - `"build"`: Production application build (`next build`, `vite build`, `nuxt build`, `ng build`)
  - `"start"`: Production preview/server runtime (`next start`, `vite preview`, `nuxt preview`, `ng serve`)
  - (For SvelteKit): `"check"`: Type check verification (`svelte-kit sync && svelte-check --tsconfig ./tsconfig.json`)
- **Execution Verification**: Executing `pnpm lint`, `pnpm build`, and `pnpm start` must all be fully operational without missing script errors.

---

## 🔄 6-Step Sequential Orchestration Pipeline

1. **Step 1: Deep Research (Chunin)** — Research web documentation, APIs, and external evidence.
2. **Step 2: Code Exploration (Genin)** — Read-only exploration, symbol mapping, and dependency tracing via `Semble MCP`.
3. **Step 3: Architecture & Planning (Kage)** — Architectural review, task decomposition, and risk analysis.
4. **Step 4: Execution (Jonin / Anbu)** — Frontend UI construction (`jonin`) or Backend/DevOps engineering and dev/local penetration testing (`anbu`).
5. **Step 5: Documentation & Refinement (Tokubetsu-Jonin)** — Technical documentation, API specs, and diagrams.
6. **Step 6: Final Report (Sannin)** — Synthesis and structured final delivery.

---

## 🛠️ Maintenance & Release Checklist

1. **Tool & MCP Boundaries**:
   - Always use **Konoha MCP** for skill discovery/loading and bounded file operations.
   - Always use **Semble MCP** for project codebase search and discovery.
   - Use **RTK** for shell commands when installed.
2. **Filesystem Mirrors**:
   - **Konoha does not maintain filesystem mirrors** (e.g. no `.cursor/skills/` mirrors); skill content is served on-demand via SQLite FTS5 index.
3. **Bridge Extension Sync & CLI Distribution**:
   - On fresh installation (`konoha init`) and upgrade (`konoha upgrade`), `https://github.com/andycungkrinx91/konoha-bridge` is cloned from live `master`, packaged into `konoha-bridge-1.4.0.vsix` via `@vscode/vsce package`, and auto-installed via CLI across supported IDEs (`antigravity --install-extension`, `code --install-extension`, `cursor --install-extension`). When Antigravity IDE is present, an atomic directory sync into `~/.antigravity-ide/extensions/andycungkrinx91.konoha-bridge-master-universal/` is also performed with `extensions.json` registration. Fallback VSIX is bundled in `assets/konoha-bridge-1.4.0.vsix`.
4. **Rule Synchronization**:
   - Whenever a new rule or invariant is introduced, ensure it is added to `src/agent_manager.js`, `src/cursor_manager.js`, `src/opencode_manager.js`, `src/codex_manager.js`, `.agents/skills/konoha/SKILL.md`, and `src/templates/skills/konoha/SKILL.md`.
5. **Database Migration**:
   - Run `node bin/cli.js migrate` to re-seed all skills and reference documents into the SQLite FTS5 database (`~/.konoha/skills.db`).
6. **Cross-Client Initialization**:
   - Run `node bin/cli.js init --yes --force` to deploy updated MCP configurations, subagent instructions, and RTK rules across all 6 clients.
7. **Automated Verification & Quality Gate**:
   - Ensure `python3 tests/test_docs_currency.py` and **all discovered tests pass** with 0 failures before release.
8. **Auto-Compaction & Idle-Reset Invariants**:
   - `SESSION_TURNS` in `src/server.py` implements a 30-minute idle reset (`SESSION_IDLE_RESET_SECONDS = 30 * 60`) preventing cross-session turn leakage.
   - On compact turns (`turn >= 2`), the primary skill SOP preview (250 chars) is ALWAYS included (`skills_content`) so fix agents never lose their methodology.
   - Persona instructions are truncated at sentence boundaries to 1200 chars; agent constraints to 600 chars (never hard-cut mid-step).
   - Compact prompts include the anti-goal-drift directive enforcing original task authority.
9. **Prompt History & Append-Only Hook**:
   - `src/prompt_hook.js` is strictly append-only. New inputs are recorded as timestamped `## Follow-up N` sections under `# Session Prompts`.
   - `## Original Task` remains permanently authoritative; short follow-ups (e.g. new console errors) must never replace or erase the original task.
10. **Evidence-Based Validation Gate in `report_from_agent`**:
    - `report_from_agent` enforces regex assessment (`_assess_validation_evidence`) checking for real passing command markers (`exit code 0`, `passed`, `0 errors`).
11. **Zero-AI-Slop Pre-Gate & `aislop` MCP Integration**:
    - Multi-client registration of `aislop` MCP across all 6 clients (`antigravity`, `cursor`, `claude`, `commandcode`, `opencode`, `codex`).
    - Role boundaries: Genin and Kage are strictly read-only (`aislop_scan`, `aislop_why`); execution agents Jonin and Anbu have access to `aislop_fix` to remediate slop.
    - Kage Review Pre-Gate: requires `ai_slop_clean: true` and `ai_slop_findings: 0` in `kage_review.json` before any confidence scoring or workflow delivery.
12. **Authorized Penetration Testing & Security Diagnostics in Dev/Local Environments**:
    - Anbu is authorized to conduct penetration testing and vulnerability assessments in local/development targets (`localhost`, `127.0.0.1`, dev containers, local clusters).
    - Workflow review gate utilizes pentest-aware validation (`_is_pentest_task`, `_is_clean_validation`) allowing diagnostic exploit checks and HTTP error responses without false rejection, while strictly prohibiting unhandled fatal crash exceptions.
    - Reports without verifiable evidence are automatically downgraded to `status: "unverified"`.
11. **Learnings & Memory Hygiene**:
    - Unverified task learnings are never persisted to episodic memory.
    - `memory_content_exists()` in `src/persona_memory.py` prevents duplicate or corrupted memories from polluting subsequent agent contexts.
12. **Strict Changelog Preservation Invariant (NEVER REMOVE OLD CHANGELOGS)**:
    - Under NO circumstances should past version entries or historical release notes in `CHANGELOG.md` ever be pruned, truncated, or removed.
    - When updating `CHANGELOG.md`, always prepend the new version section (`## [version] - YYYY-MM-DD`) at the top of the file, permanently preserving the entire historical record back to `## [1.0.0]` without exception.
13. **Claude Code Permission Syntax Specification**:
    - `~/.claude/settings.json` permissions allow rules strictly require the prefix `mcp__<server>__*` for MCP tools and `Bash(...)` for command permissions.
    - Bare commands (`rtk`), foreign syntax (`command(...)`, `mcp(...)`), colon wildcards (`mcp:konoha:*`), and unscoped wildcards (`*`) are invalid in allow rules and must be automatically sanitized by `registerClaudeCodePermissions`.
14. **OpenCode V1 Schema Invariant**:
    - OpenCode v1.18+ strictly requires the singular `"permission"` dictionary (`read: "allow"`, `edit: "allow"`, `bash: "allow"`, etc.).
    - The plural `"permissions"` and root `"autoApprove"` keys are V2 schema properties rejected by OpenCode V1 and must never be generated in `opencode.json` or `settings.json`.
15. **Windows Workspace Isolation & IDE Installation Directory Guard**:
    - In Windows Antigravity IDE/CLI, child processes inherit the IDE binary folder as `cwd` when `rootUri` is not passed during MCP handshake.
    - `file_tools_router.js`, `_common.py`, and `server.py` enforce `isIdeInstallationDirectory` / `is_ide_installation_dir`. Any attempt to inspect or scan IDE binary folders (`Antigravity IDE.exe`, `dxcompiler.dll`, `resources.pak`, `vulkan-1.dll`, etc.) is strictly forbidden.
    - `detectWorkspaceRoot()` auto-resolves the active project directory from `WORKSPACE_ROOT`, `KONOHA_WORKSPACE`, session metadata (`last_conversations.json`, `projects.json`), and transcripts, falling back safely to user home instead of IDE program folders.
16. **Single Database Access Layer & Hybrid Multilingual Vector Search Invariants**:
    - `src/db.py` is the single canonical source of truth for `DB_PATH`, SQLite WAL mode, foreign keys, busy timeout (`5000ms`), and unified DDL schema (`setup_schema`). Never declare separate local DB paths or duplicate table definitions.
    - `src/vector_search.py` provides semantic search using IBM Granite 97M Multilingual ONNX (384-dim, CLS pooling, L2 normalization) and Alibaba GTE Multilingual reranker (cross-encoder sigmoid scoring).
    - `sqlite-vector` extension is lazily downloaded per platform on first run; extension loading failure falls back gracefully to in-memory NumPy cosine scan and FTS5.
    - Cross-lingual retrieval guarantees that queries in Indonesian or English match English skill docs (97.5% Recall@5).
    - Hybrid search in `src/server.py:find_skill` is gated behind `KONOHA_SEMANTIC_SEARCH=1` (default-off for zero-config lightweight operation).
17. **4-Tier Embedding Feature Deduplication & Cache Architecture**:
    - `chunk_document()` deduplicates Markdown document sections via SHA-256 content hashing of normalized whitespace.
    - `embed_text()` integrates an in-memory dictionary cache (`_EMBED_CACHE`, 4,096 capacity) keyed by text hash, serving precomputed 384-dim embeddings in 0 ms with 0 ONNX compute.
    - `index_single_skill_chunks()` checks `skill_chunks` for pre-existing embedding blobs matching `chunk_text`, reusing them across skills.
    - `scan_nearest_chunks()` deduplicates candidate nearest chunks to preserve diversity and quality in top-K results.
18. **Persona & Project Context Memory Deduplication & Token-Burn Guard**:
    - Idempotent `save_memory()` updates existing rows, timestamps, and maximum importance if matching memory content exists for `(agent_name, content, project_hash)` without duplicating database rows.
    - Context memory formatting strictly pulls verified database records from `projects` and `persona_memories` (Zero Hallucination).
    - Auto-compact prompt badges reduce context footprint to < 120 tokens on turns >= 2 while maintaining 100% of architectural invariants.
19. **Cross-Platform `agent-browser` Lifecycle & Self-Healing Diagnostics**:
    - `getAgentBrowserCommand()` and `installAgentBrowser()` provide seamless cross-platform binary resolution across Windows (`agent-browser.cmd`), Linux, and macOS.
    - Automated global installer cascades across `npm`, `pnpm`, and `yarn`.
    - Integrated into `konoha init` (Step 2c), `konoha upgrade`, package definition (`optionalDependencies`), and self-healing doctor auto-repair (`konoha doctor` with `REPAIRED` status).
