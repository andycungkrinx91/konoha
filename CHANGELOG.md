# Changelog

All notable changes to the **Konoha** project will be documented in this file.

## [2.0.0] - 2026-08-29

### Major: 6-Client Cross-Platform AI Coding Ecosystem
- **Codex IDE & CLI Integration**: Added dedicated `src/codex_manager.js` providing native TOML parsing and serialization for `~/.codex/config.toml` to manage `[mcp_servers.konoha]` and `[mcp_servers.semble]`, deploys `~/.codex/AGENTS.md` runtime contracts, injects `~/.codex/rules/rtk.md`, and integrates full health checking and auto-repair in `konoha init`, `update`, `status`, and `doctor`.
- **Antigravity IDE & CLI Integration**: Centralized MCP server registration in `~/.gemini/config/mcp_config.json`, prompt capture hooks in `hooks.json`, and RTK rules in `~/.gemini/antigravity-cli/rules/rtk.md` & `~/.gemini/antigravity-ide/rules/rtk.md`.
- **Cursor IDE & CLI Integration**: Registered `konoha` and `semble` in `~/.cursor/mcp.json`, deployed global rules in `~/.cursor/rules/rtk.mdc`, project instructions in `.cursor/rules/konoha.mdc`, and verified Cursor subagent attribution without requiring filesystem skill mirrors.
- **Claude Code Integration**: Configured `~/.claude.json` with double-underscore tool namespacing (`mcp__konoha__*`, `mcp__semble__*`), deployed subagent personas to `~/.claude/agents/`, and deployed RTK rules to `~/.claude/rules/rtk.md`.
- **OpenCode IDE Integration**: Registered `mcp` servers in `~/.config/opencode/opencode.json`, deployed global `AGENTS.md` contracts, and configured `~/.config/opencode/rules/rtk.md`.
- **Command Code Integration**: Registered `mcpServers` in `~/.commandcode/mcp.json`, permissions in `~/.commandcode/settings.json`, global rules in `~/.commandcode/rules/konoha.md`, and RTK rules in `~/.commandcode/rules/rtk.md`.

### Major: MCP Tools Architecture & Structured Delegation
- **Unified 38-Tool MCP Manifest**: Standardized `src/mcp_tool_manifest.json` as the single auditable contract across Python (`server.py`) and Node.js (`file_tools_router.js`) implementations.
- **Structured Inline Subagent Execution**: Subagents (`sannin`, `jonin`, `anbu`, `kage`, `genin`, `chunin`, `tokubetsu_jonin`) execute inline through direct tool calls with structured parameters (`task`, `context`, `constraints`, `skills`, `taste_dials`, `project_path`), isolating legacy `delegate.md`/`result.md` scratch loops to fallback-only execution.
- **Workflow State & Evidence Hashing**: `src/server.py` records dispatch IDs, task IDs, result hashes, task-level completion, structured reports, and state tracking to prevent stale artifacts from advancing phases.
- **SQLite FTS5 On-Demand Indexing**: Full-text search over skills and reference manuals in `~/.konoha/skills.db` provides sub-millisecond retrieval (< 1ms) and reduces context token usage by 83–98%.
- **Side-Effect-Free Website Builders**: `build_from_text`, `build_from_source`, and `build_with_image_design` produce structured specifications containing canonical framework selection, numeric taste dials, required packages, and validation commands without creating transient files.

### Major: RTK (Rust Token Killer) Force-First Execution Invariant
- **Force-First Execution Invariant**: Enforced mandatory force-first command execution with `rtk <command>` across all 6 clients to compress noisy shell output by up to 90%.
- **Deterministic Direct Fallback**: When `rtk` is not installed, unsupported, or encounters unrecognized command syntax, execution immediately falls back to direct shell/bash (`sh` / `bash`) without hallucinating RTK wrapper presence.
- **Cross-Client RTK Rule Deployment**: Automatically deployed RTK rule templates to all 7 client rule locations on `konoha init`, `update`, and `doctor`.

### Major: Universal Website Archetypes & Layout Invariants
- **Multi-Framework Production Scaffolding**: Standardized official CLI initialization standards across 4 frameworks:
  - Next.js 16: `pnpm create next-app@latest` (React 19, Tailwind CSS v4, App Router)
  - Nuxt 3: `pnpm dlx nuxi@latest init <project-name>` (Vue 3 Composition API, Tailwind CSS)
  - Angular v19+: `pnpm dlx @angular/cli@latest new <project-name> --package-manager=pnpm` (Standalone Components, Signals)
  - SvelteKit 2: `pnpm dlx sv create <project-name>` (Svelte 5 Runes, Tailwind CSS)
- **Mandatory Default Konoha Design Invariants**:
  - **Far-Left Brand Logo**: Brand logo MUST always be placed on the far LEFT of the navigation header.
  - **Zero Mobile Hamburger Menu**: In mobile view (`lg:hidden`), mobile navigation is handled exclusively by the fixed bottom Mobile Dock.
  - **Floating Bottom-Left 10-Theme FAB Switcher**: Fixed in bottom-left corner (`fixed bottom-6 left-6 z-50`) with 10 Light Mode gradient themes and `useMounted()` SSR hydration guards.
  - **Archetype-Adaptive Mobile Dock**: Fixed bottom navigation dock adapting to archetype (E-commerce, Portfolio, Dashboard, SaaS, Company Profile, Docs).
  - **4-Slide Hero Autoplay Carousel**: 5000ms autoplay interval with hover pause, chevron controls, and dot indicators.
  - **Admin Left Sidebar Invariant**: Fixed Left Sidebar (`w-64`) on desktop for Admin and Metric Infra archetypes.
  - **Zero Errors & Zero Warnings**: Verification requires `pnpm run build`, `pnpm run lint`, and `pnpm run check` to complete with 0 errors and 0 warnings.

### Major: Verification, Test Suite & Quality Gates
- **52 Complete Test Suites**: Comprehensive JS & Python test runner (`node tests/run_all.js`) executing 52 test suites with 100% pass rate.
- **Kage Reviewer 90% Minimum Confidence Gate Report**: Standardized final delivery report across all 6 clients requiring a minimum 90% confidence score with category breakdown tables.
- **High-Efficiency Auto-Compaction Contract**: Automatically activated after turn 2 across all coding tools to preserve persistent project stack and invariants under 450 tokens.

### Added
- **Interactive Features Demo GIF**: Generated high-definition animated terminal demonstration at `assets/demo.gif` (and `assest/demo.gif`) showcasing all 6 core feature suites.
- **SearXNG Multi-Source Zero-API-Key Search**: Dynamic public SearXNG instance resolution from searx.space with 24h caching, 1h verification, and DuckDuckGo/Startpage/Wikipedia fallbacks.
- **Chunin Deep Research Integration**: Automatically triggers parallel web searches and injects cited, ranked findings into deep research tasks.
- **Persistent Project & Persona Memory**: Added `get_project_context`, `save_project_context`, `save_persona_memory`, `query_persona_memory`, and `list_persona_memories` MCP tools.
- **Diagnostic Self-Healing**: `konoha doctor` runs 9 automated environment diagnostics and repairs broken MCP configs, permissions, and RTK rules.
- **Antigravity Extension Git Tracking**: Extension tracks the live `master` branch into `~/.antigravity-ide/extensions/andycungkrinx91.konoha-bridge-master-universal/`.

### Fixed & Hardened
- **Security & Compliance Audit**: Added Google Policy Security & Compliance report (`docs/SecurityCompliance/security_compliance_report_google_policy_2.0.0_2026-08-29.md`).
- **Package Manager Mandate**: Strictly enforced `pnpm` exclusively across all scripts, builds, and package installs; prohibited standalone `npm` or unconstrained `npx`.
- **Destructive Command & Secret Safeguards**: Hardened guardrails against harmful shell commands (`rm -rf /`, `DROP DATABASE`), destructive git commands, and secret exposure (`.env*`, `secrets.yaml`).
- **Session Isolation Guard**: Isolated session telemetry and transcript scans to active `ANTIGRAVITY_CONVERSATION_ID` to prevent cross-session context pollution.
- **Subprocess Buffer & Event Loop Protections**: Configured Node `maxBuffer` to 1GB across all router spawns and ensured proper `child.unref()` and `process.stdin.pause()` cleanup.
- **Cross-Platform Compatibility**: Validated cross-platform execution on Linux, macOS, and Windows (PowerShell, WSL2, Git Bash).

### Removed
- Removed unreferenced historical patch, fix, and revert scripts plus confirmed transient cache/task artifacts.
- Removed obsolete pinned bridge extension downloads in favor of live `master` repository tracking.
- Deprecated legacy visual comparison in favor of side-effect-free structured specifications (`build_from_source`).
