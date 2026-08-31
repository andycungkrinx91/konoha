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
4. **Step 4: Execution (Jonin / Anbu)** — Frontend UI construction (`jonin`) or Backend/DevOps engineering (`anbu`).
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
3. **Bridge Extension Sync**:
   - The Antigravity extension tracks the live `master` branch into `~/.antigravity-ide/extensions/andycungkrinx91.konoha-bridge-master-universal/`.
4. **Rule Synchronization**:
   - Whenever a new rule or invariant is introduced, ensure it is added to `src/agent_manager.js`, `src/cursor_manager.js`, `src/opencode_manager.js`, `src/codex_manager.js`, `.agents/skills/konoha/SKILL.md`, and `src/templates/skills/konoha/SKILL.md`.
5. **Database Migration**:
   - Run `node bin/cli.js migrate` to re-seed all skills and reference documents into the SQLite FTS5 database (`~/.konoha/skills.db`).
6. **Cross-Client Initialization**:
   - Run `node bin/cli.js init --yes --force` to deploy updated MCP configurations, subagent instructions, and RTK rules across all 6 clients.
7. **Automated Verification & Quality Gate**:
   - Ensure `python3 tests/test_docs_currency.py` and **all discovered tests pass** with 0 failures before release.

