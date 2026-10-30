---
name: konoha
description: Guidelines and instructions for maintaining, extending, and debugging the Konoha MCP Tools Orchestrator, MCP middleware, and multi-archetype website builder across 8 coding clients (Antigravity IDE/CLI, Cursor, Claude Code, OpenCode, Command Code, Codex, Pi/pi.dev, OMP).
tags:
  - konoha
  - orchestrator
  - mcp
  - maintenance
  - engineering
  - website-builder
  - fts5
---

# 🍃 Konoha Maintenance & Engineering Skill

Operational guide for maintaining, extending, and debugging the **Konoha MCP Tools Orchestrator**, SQLite FTS5 indexer, and multi-archetype website generation engine.

---

## 🏛️ System Architecture Overview

Konoha operates as a high-efficiency MCP orchestrator designed to reduce context token consumption by 83–98% across 8 AI coding clients:
- **Antigravity IDE/CLI** (`~/.gemini/config/mcp_config.json`, hooks)
- **Cursor IDE/CLI** (`~/.cursor/mcp.json`, `.cursor/rules/`)
- **Claude Code** (`~/.claude.json`)
- **OpenCode** (`~/.config/opencode/opencode.json`)
- **Command Code** (`~/.commandcode/mcp.json`)
- **Codex** (`~/.codex/config.toml`, `~/.codex/AGENTS.md`)
- **Pi (pi.dev)** (`~/.pi/agent/mcp.json` via the `pi-mcp-adapter` extension)
- **OMP** (`~/.omp/agent/mcp.json`, `~/.omp/agent/AGENTS.md`)

Each client environment is configured with three core MCP servers:
1. **`konoha`**: All 47 canonical MCP tools. The server serves ALL 47 canonical tools for on-demand skill retrieval, bounded file I/O, subagent routing, and workflow gate orchestration across 8 specialists:
   - MCP Router & Orchestrator (@sannin): Request classification, triage, and multi-agent coordination.
   - Code Exploration (@genin): Read-only codebase exploration, symbol search, and architecture review.
   - Architecture & Quality Gates (@kage): Architecture decisions, security audits, and delivery review gate.
   - Deep Research (@chunin): Web research, documentation lookup, and evidence synthesis.
   - UI & Frontend (@jonin): Component architecture, design match, and taste-skill frontend builds.
   - Backend & DevOps (@anbu): Backend services, bug fixing, DevOps, and infrastructure deployment.
   - Technical Writing & Scribe (@tokubetsu-jonin): Publication-grade documentation, diagrams, and reports.
   - Security Specialist (@akatsuki): Red-team penetration testing in sandboxes and blue-team defensive hardening.
2. **`semble`**: AI-powered semantic code search and dependency mapping via Semble MCP.
3. **`aislop`**: Zero-AI-slop code hygiene validation, rule reasoning, automated repairs, and Kage delivery gating (`ai_slop_findings: 0`, `ai_slop_clean: true`).

---

## 🌐 Universal Polyglot & Multi-Framework Architecture

Konoha natively supports all programming languages (TypeScript, JavaScript, Python, Go, Rust, C/C++, Java/Kotlin, PHP, Ruby, C#, Elixir, Zig, Shell) and all frameworks across web, backend, mobile, desktop, and cloud infrastructure with automated RTK toolchains.

---

## 🎨 Universal Konoha Website Builder Invariants

When scaffolding or generating websites from text (`konoha.build_from_text`) or design mockups (`konoha.build_from_source`), the following design invariants are mandatory across all supported frameworks (**Next.js, SvelteKit, Nuxt, Angular, Astro, Remix, Vue, React, Solid**):

### 1. Far-Left Brand Logo & Zero Mobile Header Hamburger
- **Header Logo Placement**: Brand logo MUST always be placed on the far LEFT (`justify-start` / `flex items-center gap-3`) of the navigation header.
- **Zero Mobile Hamburger Menu**: In mobile view (`lg:hidden`), never render a hamburger menu or top menu toggle button in the header. Mobile navigation is powered exclusively by the fixed bottom Mobile Dock.

### 2. Floating Bottom-Left 10-Theme Switcher FAB
- **Placement**: Fixed floating in the bottom-left corner (`fixed bottom-6 left-6 z-50`, like a customer chat/FAB button) on both desktop and mobile viewports.
- **Pure Light Mode**: 10 curated Light Mode gradient themes (`byakugan`, `chidori`, `konoha-leaf`, `rasengan`, `sharingan`, `hokage-gold`, `anbu-shadow`, `sage-mode`, `sound-village`, `akatsuki`).
- **SSR Hydration Safety**: Strict mounted state guards before accessing `localStorage` or rendering theme DOM to guarantee zero hydration mismatch errors.

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
- Full-width interactive hero banner with a minimum of 4 high-definition slides, 5000ms autoplay interval with hover pause, chevron controls, and dot indicators.

### 6. SSR & Hydration Safety Standards
- **Next.js**: `'use client'` + mounted guard.
- **SvelteKit / Svelte 5**: `$effect` and `onMount` browser guards.
- **Nuxt**: `onMounted` / `<ClientOnly>` safety wrappers.
- **Angular**: `afterNextRender` / `isPlatformBrowser` guards.

### 7. Zero Errors & Zero Warnings Quality Gate
- Scaffolding MUST include the framework's Phosphor Icons package (`@phosphor-icons/react` / `@phosphor-icons/svelte` / `@phosphor-icons/web`) or hand-exported inline SVG icon components. Never install Lucide icon packages.
- Shipped builds must pass `pnpm run build` and `pnpm run lint` cleanly with **0 errors and 0 warnings**.

### 8. Human-Built Fingerprint Standards
These standards apply to every build mode (`build_from_text`, clone-url flows, `build_from_source`) across all frameworks:
- **No generator meta tags**: Never emit `<meta name="generator">` or any build-tool version identifier in HTML output.
- **No AI-tool comments**: Shipped HTML/CSS/JS must contain no comments referencing AI tools, model names, or tool attributions.
- **Custom assets**: Hand-craft favicon, OG image, and 404/error page with project-branded names.
- **Styling fingerprints**:
  - *Next.js*: Fully custom Tailwind theme primitives under `components/primitives`, never generic scaffolding kits.
  - *SvelteKit*: Scoped `<style>` blocks + hand-written global stylesheet; no unrequested UI abstractions.
  - *Nuxt*: Custom hand-written Tailwind theme or CSS/SCSS.
  - *Angular*: Hand-written SCSS.

### 9. Mandatory Package.json Scripts Invariant (pnpm lint, pnpm build, pnpm start)
Every generated project MUST define working scripts in `package.json` for:
- `"dev"`: Local development server
- `"lint"`: Formatting & lint check
- `"build"`: Production application build
- `"start"`: Production preview/server runtime
- `"check"` (for SvelteKit): Type check verification

---

## 🔄 Master Master-Pipeline & Execution Engine

### 1. Dual-Track Execution Engine
- **Direct Request Fast-Track (Branch B)**: Single-turn website builds (`build_from_text`, `build_from_source`, `build_with_image_design`) bypass multi-stage pipeline and invoke Jonin directly with Taste-Skill directives.
- **Standard Master Pipeline (Branch A)**: Multi-step engineering tasks route sequentially through the village pipeline on git `master`.

### 2. Canonical 8 Phases & Subagent Mapping
- **Phase 1: Task Triage & Planning** (`sannin`) — Intent classification, task directory initialization, and workflow setup.
- **Phase 2: Research & Intel** (`chunin`) — Web research, documentation lookup, and evidence synthesis.
- **Phase 3: Codebase Exploration** (`genin`) — Read-only codebase exploration, symbol search, and dependency mapping.
- **Phase 4: Planning & Architecture** (`kage`) — Architecture design and plan generation awaiting **HITL Gate 1 Approval**.
- **Phase 5: Execution** (`jonin`, `anbu`, `akatsuki`) — Specialized implementation (UI via Jonin, backend/DevOps via Anbu, security via Akatsuki).
- **Phase 6: Quality Gate & Slop Remediation** (`kage`, `anbu`, `jonin`) — `aislop_scan` validation and automated remediation loops.
- **Phase 7: Technical Documentation** (`tokubetsu_jonin`) — Publication-grade documentation, API specs, and runbooks.
- **Phase 8: Review Gate & Handover** (`kage`, `sannin`) — Presentation of final report and human sign-off (**HITL Gate 2 Sign-Off**).

### 3. Authoritative Two-Stage HITL Gates
- **Gate 1 (`pending_plan_approval`)**: After Kage drafts `plan.md`. The orchestrator must stop and present: `1. Compact and approve / 2. Reject and Regenerate PLAN`.
- **Gate 2 (`pending_human_signoff`)**: After Kage approves implementation and Tokubetsu-Jonin delivers documentation. The orchestrator must present: `1. Compact and approve / 2. Remediation`. Fail closed; never bypass.

### 4. Structured MCP Tool Arguments Architecture
Communication across subagents is strictly handled via structured MCP tool arguments (`task`, `context`, `constraints`, `skills`). Workflow state artifacts (`status.json`, `plan.md`, `findings.md`, `final_docs.md`, `kage_review.json`) live exclusively in the isolated task directory returned by `konoha.get_resolved_task_dir` — never in the project workspace root.

---

## 🛠️ Maintenance, Quality Gate & Release Governance

### 1. Tool & MCP Server Boundaries
- Never invoke raw shell `cat` or `grep` for codebase exploration. Use Konoha bounded tools (`read_file_range`, `read_file_head`, `token_efficient_grep`, `find_files_clean`, `file_info`) and Semble MCP (`search`, `find_related`).
- Shell executions must be prefixed with `rtk <command>` for token suppression and command filtering.
- **Filesystem Mirrors Invariant**: Konoha does not maintain filesystem mirrors across client folders. All skills reside centrally in SQLite FTS5 database and template directories.
- **OpenAI Proxy Gateway**: The OpenAI proxy gateway runs standalone on port 19999; the obsolete `andycungkrinx91.konoha-bridge-master-universal` extension directory is completely eliminated in favor of direct MCP configuration.

### 2. Subagent Roster & Role Isolation
- Eight official subagent roles: `@sannin`, `@genin`, `@kage`, `@chunin`, `@jonin`, `@anbu`, `@tokubetsu-jonin`, `@akatsuki`.
- Role-conditional tool permissions: `aislop_scan` and `aislop_why` for read-only roles (`genin`, `kage`); `aislop_fix` permitted only for active implementation roles (`jonin`, `anbu`). Genin must never have file-mutation tools.

### 3. Upstream Parity & Quality Gates
- **Taste-Skill**: Pinned to upstream release, driving Jonin typography dials, layout ratios, and pure light themes.
- **Anti-Slop**: Pinned to upstream release across all 5 subagent rules (`code`, `ui`, `copywriting`, `human`, `layoutmobile`).
- **Kage Delivery Gate**: Strict delivery gate requiring `AISLOP_TARGET_SCORE = 100`, `MINIMUM_CONFIDENCE >= 98`, and `remediation_loop <= 7`. Zero errors and zero warnings are required before claiming completion.

### 4. Token Savings Flow Logic Preservation Invariant
- Never modify or disrupt the token savings telemetry flow logic. In `src/tools_savings_logger.js`, baseline bytes for `find_skill` / `find_skills` are dynamically computed from the actual `SUM(byte_size)` of retrieved skill candidates in SQLite FTS5 matching, authentically reflecting 83%–98% context savings.

### 5. Task & Session Isolation
- Tasks use deterministic 12-character `flow_hash` session isolation. Parallel workstreams run without cross-session contamination.
- SQLite database migrations run via `migrate.js` with WAL mode and foreign-key integrity.

### 6. Multi-Client Synchronization
- Konoha MCP server declarations and contract instructions remain 100% synchronized across all 8 clients: Antigravity, Cursor, Claude Code, OpenCode, Command Code, Codex, Pi, and OMP.

### 7. Release & Verification Governance
- **Explicit Authorization Required**: When maintaining or updating Konoha on branch `master`, never create release commits, tags, or trigger publishing workflows without explicit user confirmation.
- **Mandatory Verification**: Every release verification requires `bump_version.js --check`, `pnpm run check`, `pnpm run lint`, full test execution, and ensuring all discovered tests pass with 0 failures before release.
