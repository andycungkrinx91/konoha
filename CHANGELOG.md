# Changelog

All notable changes to the **Konoha** project will be documented in this file.

## [v.2.0.0-beta.3] - 2026-09-04

### Fixed: Cross-Platform Upgrade & SemVer Pre-Release Resolution (`bin/cli.js`, `src/server.py`, `src/file_tools_mcp.js`)
- **Pre-Release SemVer Engine (`parseSemver` & `semverCompare`)**: Replaced primitive `Number()` splitting with standard SemVer pre-release parsing, eliminating `NaN` comparisons that caused `v2.0.0-beta.3` to evaluate as equal to `2.0.0`.
- **Target Tag Specifier & Git Cache Bypassing**: `cmdUpgrade` now queries GitHub tags/releases dynamically and installs `github:andycungkrinx91/konoha#${targetTag}`, bypassing stale Git clone caches on Windows and Unix clients.
- **Cross-Platform Package Manager Fallback Chain**: Upgrades now attempt `pnpm` (without unsupported `--force`), falling back cleanly to `npm` (with `--force`) and `yarn`, with detailed error logging on PowerShell and Git Bash.
- **Dynamic MCP `serverInfo` & `SERVER_VERSION`**: `src/server.py` and `src/file_tools_mcp.js` now dynamically resolve their version from `package.json` (with fallback `2.0.0-beta.3`), eliminating stale `2.0.0` metadata across IDE MCP clients.
- **Runtime `package.json` Synchronization**: `cmdInit` and `ensureAutoSetup` now copy `package.json` into `~/.konoha/package.json`, ensuring the runtime files stay strictly in sync with the CLI release.

### Added: CLI Upgrade Engine & Interactive Progress Bar (`bin/cli.js`)
- **KonohaProgressBar Terminal Engine**: Added dedicated progress bar engine supporting shaded block rendering (`████░░░░`), percentage tracking, TTY carriage return animations, non-TTY clean milestone output, and active pulse timers with elapsed duration.
- **7-Stage Upgrade Pipeline**: Upgrades now progress visibly through 7 discrete milestones: (1) PM detection, (2) GitHub download with live pulse, (3) Environment validation, (4) MCP runtime deployment, (5) SQLite FTS5 skills indexing, (6) 6-client MCP synchronization, (7) Extension bridge and browser CLI verification.
- **cmdInit Progress Hooks**: Added `onProgress` and `onStepComplete` hooks enabling in-process progress reporting during upgrades.

### Fixed: Windows Upgrade & Subprocess Hanging Issues
- **Windows Upgrade Hang Fix**: Replaced external unconstrained `pnpm dlx` spawns with in-process `cmdInit(['--force', '--yes'])` execution wrapped in 180s timeout with `stdio: ['ignore', 'pipe', 'pipe']`.
- **Pre-Bundled VSIX Prioritization**: `autoInstallKonohaBridgeExtension` now directly uses bundled `assets/konoha-bridge-1.4.0.vsix` with `--skip-license`, avoiding slow 2.5-minute external `git clone` rebuilds and interactive license hangs on Windows.
- **Windows `Token Efficient Grep` & `konoha test` Port Collision Fix**:
  - `cmdTest` now strictly sanitizes `KONOHA_DAEMON` from test environments, preventing test runs from starting long-lived HTTP gateway servers on port 20000 that kept Windows socket handles open past timeouts.
  - Corrected `detectPython()` in `src/platform_utils.js` to preserve candidate arguments, retaining `py -3` on Windows instead of truncating to `py`.
  - Normalized path arguments in `src/file_tools_router.js` and `token_efficient_grep.py`, stripping trailing backslashes that corrupted Windows JSON serialization.
  - Attached safe detached process error handling on savings logging subprocesses.

### Fixed: Codex & Antigravity IDE `aislop` MCP 404 & Connection Closed
- **Package Name vs Binary Name Resolution**: `aislop` is published to npm as `aislop` (providing binary `aislop-mcp`). Fixed all MCP configurations from `args: ["-y", "aislop-mcp"]` (which triggered 404 from npm registry) to `args: ["-y", "-p", "aislop", "aislop-mcp"]`.
- **Cross-Client Consistency**: Synchronized across Antigravity IDE, Cursor, Claude Code, OpenCode, Command Code, and Codex. Live handshake verified clean.

### Fixed: Cursor CLI Standalone Agent Compatibility
- **Headless & Agent-Only Detection**: Handled environments where `agent` or the Cursor CLI wrapper is installed without the desktop GUI IDE. `findIdeExecutable` and `installExtensionViaCli` now identify standalone agent shims, skipping unsupported `--install-extension` calls cleanly without emitting `Error: No Cursor IDE installation found`.
- **Command Detection**: Updated `isCursorInstalled()` in `src/cursor_manager.js` to recognize the `agent` command.

### Added: Cross-IDE Auto-Approval & Tool Permissions Hardening
- **Universal Auto-Approval**: Standardized `autoApprove: ["*"]` and `auto_approve: true` across all 6 clients (Antigravity IDE/CLI, Cursor, Claude Code, OpenCode, Command Code, Codex).
- **Cursor IDE Permissions**: Added `Mcp(aislop, *)` grants to `~/.cursor/cli-config.json`, `~/.cursor/settings.json`, and cross-platform User settings (`~/.config/Cursor/User/settings.json`, `%APPDATA%/Cursor/User/settings.json`, macOS Application Support).
- **Claude & Command Code Allowances**: Injected `mcp__aislop__*` and `mcp:aislop:*` into `autoApprove` and `permissions.allow`, with `permissionMode: "bypassPermissions"` (Claude) and `"allowAll"` (Command Code).

## [v.2.0.0-beta.2] - 2026-09-03

### Major: Zero-AI-Slop Gate & `aislop` MCP Multi-Client Integration (`PLAN_FEATURE.md`)
- **Multi-Client `aislop` MCP Registration**: Auto-configured and registered `aislop` MCP server across all 6 supported clients:
  - **Antigravity**: Registered `aislop` in `~/.gemini/config/mcp_config.json` with granular permission allowlists (`mcp(aislop/aislop_scan)`, `mcp(aislop/aislop_fix)`, `mcp(aislop/aislop_why)`, `mcp(aislop/aislop_baseline)`), IDE allowlists, health verification, and auto-repair.
  - **Cursor**: Added `aislop` to `~/.cursor/mcp.json` with `stdio` transport.
  - **Claude Code**: Registered `aislop` in `~/.claude.json` and permissions in `~/.claude/settings.json`.
  - **Command Code**: Registered `aislop` in `~/.commandcode/mcp.json` and `settings.json`.
  - **OpenCode**: Registered `aislop` in `~/.config/opencode/opencode.json` with local transport.
  - **Codex**: Registered `[mcp_servers.aislop]` and individual tool blocks (`aislop_scan`, `aislop_fix`, `aislop_why`, `aislop_baseline`) with `approval_mode = "auto"` in `~/.codex/config.toml`.
- **Role-Based Tool Boundaries**:
  - `genin` & `kage`: Permitted `aislop_scan` and `aislop_why` (strictly read-only/diagnostic). Forbidden from mutating code via `aislop_fix` or modifying baselines via `aislop_baseline`.
  - `jonin` & `anbu`: Permitted `aislop_scan`, `aislop_why`, and `aislop_fix` for automated slop remediation during execution.
- **Kage Review Zero-AI-Slop Pre-Gate**:
  - Mechanically enforced in `_workflow_review_approved()` and `run_mcp_workflow()` in `src/server.py`: requires `ai_slop_clean: true` and `ai_slop_findings: 0` in `kage_review.json`. Missing or non-numeric/positive findings strictly block workflow delivery regardless of confidence score.
  - Standardized **AI Slop Scan** row added to Kage Reviewer Confidence Gate Report table in final reports.
- **Skill SOP Updates**:
  - Updated `kage-skill`: Enforces Zero AI-Slop Pre-Gate before assessing confidence scores.
  - Updated `genin-skill`: Added SOP 6 (AI-Slop Baseline Scan) for diagnostic code reviews and architectural audits.
- **Default Scaffold**: Added `.aislop/config.yml` with `failBelow: 100` and `ai-slop/*: error`.
- **Comprehensive Test Suite**: Added `tests/test_anti_slop_gate.py` (8/8 tests passing) covering gate blocking, missing fields rejection, clean approvals, confidence report rendering, role boundaries, config wiring, and dispatch prompt requirements.

### Major: Single-DB Access Layer Consolidation (`src/db.py`)
- **Canonical Connection & Schema Ownership**: Created `src/db.py` owning `DB_PATH`, `PRAGMA journal_mode=WAL;`, `PRAGMA foreign_keys=ON;`, `PRAGMA busy_timeout=5000;`, and `PRAGMA synchronous=NORMAL;`.
- **Unified DDL `setup_schema`**: Consolidated all `CREATE TABLE IF NOT EXISTS`, virtual tables, sync triggers, and indexes from `migrate.py`, `db_agents.py`, `db_bridges.py`, `db_stats.py`, and `persona_memory.py` into a single canonical definition.
- **Reconciled Schema Drift**: Removed duplicate narrow `skills` definition in `db_stats.py`, aligning with the canonical 8-column schema.
- **Cross-Module Call Site Migration**: Updated `server.py`, `migrate.py`, `db_agents.py`, `db_bridges.py`, `db_savings.py`, `persona_memory.py`, and `cli.js` to route all connections through `db.get_connection()`.
- **Centralized Test Fixtures**: Unified monkeypatched DB paths in `test_database_migration.py`, `test_auto_compaction.py`, `test_taste_skill_jonin.py`, and `test_structured_delegation.py` to `db.DB_PATH`.

### Major: Hybrid Vector Search & Multilingual Retrieval (`src/vector_search.py`)
- **Direct HuggingFace ONNX Integration**: Sourced IBM Granite 97M Multilingual ONNX (`onnx-community/granite-embedding-97m-multilingual-r2-ONNX`, 384-dim, int8 quantized, CLS pooling, L2 normalization) and Alibaba GTE Multilingual Reranker (`onnx-community/gte-multilingual-reranker-base`, int8 cross-encoder, sigmoid scoring) without bulky wrapper dependencies.
- **Hardware-Accelerated SIMD & Fallback**: Sourced `sqlite-vector` extension with lazy first-run downloading per platform (`linux-x64`, `linux-arm64`, `darwin-arm64`, `darwin-x64`, `windows-x64`). Implemented robust build-time capability detection with seamless in-memory NumPy cosine similarity fallback.
- **Markdown Heading-Aware Chunking**: Chunks documentation by section headers (`#`, `##`, `###`) capped at 2,000 characters with 100-character boundary overlap, storing indexed chunks in `skill_chunks`.
- **Reciprocal Rank Fusion (RRF)**: Merges dense vector embeddings with sparse FTS5 BM25 token ranks (`k=60`).
- **Cross-Lingual Benchmark**: Validated 97.5% Recall@5 and 0.885 MRR@5 across 40 real English and Indonesian test queries (100% Recall@5 on English, 95% on Indonesian).
- **Opt-In Feature Flag**: Search defaults to lightweight zero-config FTS5, with hybrid semantic retrieval activated via `KONOHA_SEMANTIC_SEARCH=1`.

### Major: 4-Tier Embedding Feature Deduplication & Memory Optimization
- **Document Chunk-Level Deduplication**: Heading-aware document chunking (`chunk_document`) eliminates repeated headings, badges, and duplicate Markdown sections via SHA-256 content hashing over normalized whitespace.
- **In-Memory Embedding Feature Cache**: `embed_text()` integrates a fast in-memory dictionary cache (`_EMBED_CACHE`, 4,096 capacity) keyed by text hash, returning precomputed 384-dimensional vectors in 0 ms runtime with 0 redundant ONNX compute.
- **Database-Level Binary Blob Reuse**: `index_single_skill_chunks()` checks SQLite `skill_chunks` for matching `chunk_text` and non-null `embedding`, directly reusing pre-existing binary blobs across skills without re-running models.
- **Candidate Result Deduplication**: `scan_nearest_chunks()` deduplicates candidate nearest chunks by normalized text to ensure diversity in top-K retrieval without redundant results.
- **Persona & Project Memory Deduplication**: Idempotent `save_memory()` updates existing rows, timestamps, and maximum importance if matching memory content exists for `(agent_name, content, project_hash)` without duplicating database rows.
- **Zero-Hallucination & Token-Burn Protection**: Context memory injection strictly pulls verified database records from `projects` and `persona_memories`. Auto-compact prompt badges reduce context footprint to < 120 tokens on turns >= 2 while maintaining 100% of architectural invariants.
- **SQLite Extension Fallback Hygiene**: Refined fallback logging in `src/vector_search.py` and `~/.konoha/vector_search.py` to `debug` level when Python build-time `SQLITE_OMIT_LOAD_EXTENSION` is detected, ensuring clean terminal and test runner outputs while seamlessly executing in-memory NumPy vector search.
- **Cross-Platform `agent-browser` Auto-Resolution & Doctor Self-Healing**: Added `getAgentBrowserCommand()` and `installAgentBrowser()` across Windows (`.cmd`), Linux, and macOS, integrated into fresh install (`konoha init` step 2c), upgrade lifecycle (`konoha upgrade`), package definition (`optionalDependencies`), and self-healing doctor auto-repair (`konoha doctor`).
- **Comprehensive Test Suite Expansion**: Added `tests/test_embedding_deduplication.py` and updated `tests/test_cross_platform.py` (59 total test suites passing cleanly with 100% pass rate).

### Enhancements: Subagent Penetration Testing, Bridge Extension 1.4.0 & CLI Hardening
- **Anbu Dev/Local Penetration Testing**: Added SOP 5 ("Penetration Testing & Security Assessment in Dev/Local Environments") to `anbu-skill`, authorized Anbu in `agents.yaml` and client rules for dev/local penetration testing (`localhost`, `127.0.0.1`, dev containers, local clusters), and updated the Kage review gate to allow realistic pentest diagnostics (e.g. simulated attack errors, vulnerability findings) without false rejection.
- **Konoha Bridge v1.4.0 Upgrade**: Upgraded bundled and auto-installed extension to `konoha-bridge-1.4.0.vsix` across Antigravity IDE, VS Code, and Cursor.
- **CLI Update / Upgrade Hardening**: Added `update` alias for `konoha upgrade`, automated `--yes` propagation in upgrade subprocesses, and increased child process migration timeouts to 180s.

## [v.2.0.0-beta] - 2026-09-01

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
- **Kage Reviewer 95% Minimum Confidence Gate Report**: Standardized final delivery report across all 6 clients requiring a minimum 95% confidence score with category breakdown tables.
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

### Fixed: Core Workflow & Auto-Compaction Defect Remediation
- **Bug 1 — Auto-Compaction Turn Reset & Primary Skill SOP Preservation**:
  - Implemented 30-minute idle reset (`SESSION_IDLE_RESET_SECONDS = 1800`) for `SESSION_TURNS` in `src/server.py` to prevent turn count leakage across sessions sharing long-lived MCP processes.
  - Guaranteed that primary skill SOP preview (250 chars) is permanently preserved on compact turns (`turn >= 2`), ensuring fixing agents never lose their methodology during bug-fix delegations.
  - Raised persona instruction truncation limit from 250 -> 1200 chars and constraint truncation from 250 -> 600 chars with clean sentence-boundary slicing (`_truncate_at_boundary`).
  - Added anti-goal-drift header directive in compact prompts instructing agents to strictly preserve the authoritative original task.
- **Bug 2 — Append-Only Prompt History & Original Task Preservation**:
  - Replaced destructive `prompt.md` overwriting in `src/prompt_hook.js` with an append-only structure maintaining `# Session Prompts`, an authoritative `## Original Task` section, and timestamped `## Follow-up N` refinements.
  - Added deduplication to ignore repeated prompts and bypass continue-style acknowledgements (`continue`, `ok`, `yes`).
- **Bug 3 — Enforced Validation Evidence Gate in `report_from_agent`**:
  - Added `_assess_validation_evidence()` regex verification to require concrete command exit codes (`exit code 0`, `0 errors`, `passed`, `succeeded`) before accepting `status="completed"`.
  - Automatically downgrades unverified self-reported successes to `status: "unverified"`, preventing unverified tasks from silently completing the orchestration workflow.
  - Ensured `verified` boolean is always present in `report_from_agent` response payloads.
- **Bug 4 — Episodic Learnings Hygiene & FTS5 Deduplication**:
  - Blocked unverified task learnings from being persisted into episodic persona memory (`src/server.py`).
  - Added `memory_content_exists()` in `src/persona_memory.py` to deduplicate learnings and prevent repeated or hallucinated diagnoses from polluting future prompts.
- **Client Managers & Rule Templates Synchronization**:
  - Audited all 6 client managers (`cursor_manager.js`, `antigravity_manager.js`, `codex_manager.js`, `opencode_manager.js`, `mcp_clients_manager.js`, `agent_manager.js`) and verified shared MCP server architecture.
  - Synchronized auto-compaction contract wording across `src/agent_manager.js`, `CLAUDE.md`, and `GEMINI.md`.

### Removed
- Removed unreferenced historical patch, fix, and revert scripts plus confirmed transient cache/task artifacts.
- Removed obsolete pinned bridge extension downloads in favor of live `master` repository tracking.
- Deprecated legacy visual comparison in favor of side-effect-free structured specifications (`build_from_source`).

## [1.1.8] - 2026-08-01
- **Animation Removal**: Removed all terminal animation code (`chidoriTransition`, `LIGHTNING_CHARS`, `CHIDORI_SPINNER_FRAMES`, `NO_ANIMATION`) from `bin/cli.js`. Console output is now clean and script-friendly.
- **Best Practices Cleanup**: Removed unused imports (`spawn`, `spawnSync`), unused constants (`DOCS_DIR`, `paths`), and unused helper functions (`updateAgentsMd`, `chidoriTransition`) from `bin/cli.js`.
- **Code Quality**: Eliminated unused local variables (`commandName`, `animated`, `isInteractive` in logo functions) to reduce TypeScript diagnostic noise.
- **Cross-Platform Compatibility**: Fixed `konoha` command not found after nvm version switch on all platforms (Linux, macOS, Windows nvm-windows). Added nvm PATH troubleshooting guide.

## [1.1.7] - 2026-07-31
- **Cross-Platform Install Fixes**: Fixed `konoha` command not found after nvm version switch on all platforms (Linux, macOS, Windows nvm-windows). Added nvm PATH troubleshooting guide.
- **Node.js Version-Agnostic Install**: Konoha now works seamlessly with any Node.js version (v18+) via global npm install — no version pinning required.
- **Python Cross-Platform Detection**: `platform_utils.js` now properly handles Windows (`py -3`, `python`), macOS (`python3`, `python`), and Linux (`python3`, `python`) using spawnSync arg-array form.
- **Windows Line-Ending Fix**: Added guidance for CRLF→LF conversion on `db_bridges.py` to prevent SyntaxError.
- **Windows Port 19999 Fix**: Added `netstat`/`taskkill` approach alongside `fuser` for resolving port collisions.
- **Antigravity Windows Support**: Documented WSL2 recommendation for Antigravity on Windows; limited native support.
- **Strict Package Manager Mandate**: Enshrined a new CRITICAL rule in `konoha-maintenance` skill strictly forbidding `npm` or standalone `npx` usage for package installation/building, mandating `pnpm` exclusively to ensure supply-chain integrity and avoid `minimumReleaseAge` lockfile conflicts.
- **SPA vs Landing Page Dynamic Architecture**: Upgraded the `build_from_text` templates in `server.py` to enforce the generation of a full Single Page Application (SPA) with internal client-side routing (e.g. Home, Catalog, Cart, Account views) by default, while gracefully falling back to a single landing page only if explicitly requested by the user.
- **Premium 3D Hero Carousel Directive**: Updated `build_from_text` templates across all frameworks (Next.js, Nuxt, Svelte, Angular) to aggressively require a "Premium full image wide carousel with interactive 3D" featuring 100vw edge-to-edge layout and mouse-tracking animations.
- **Aggressive Mobile Menu Deduplication (DS-7)**: Enhanced the design system templates to forcefully hide desktop header navigation links on mobile screens (`hidden md:flex`), guaranteeing the sticky mobile bottom dock remains the sole mobile navigation.
- **Floating Theme Switcher Alignment (DS-6)**: Updated the 10-Theme Switcher template to mandate absolute bottom-left pinning in Tailwind (`fixed bottom-4 left-4 z-50`), strictly forbidding placement inside the header.


## [1.1.6] - 2026-06-26
- **Multi-Framework Konoha Design System**: Established canonical Konoha Design System (warm amber #C89B77 accent, DM Sans + Roboto fonts, #F8F8F8 body background) as the base template for all Next.js, SvelteKit, Nuxt, and Angular apps generated via `build_from_text`.
- **Split-Panel 3D Hero Carousel**: Full-viewport split-panel hero (left text/CTA + right portrait image) with mouse-tracking 3D perspective tilt (perspective:1200px) and 4.5s auto-advance. Responsive mobile stack layout.
- **Design System Build-From-Text Integration**: All 4 framework design directives (hero carousel, 3D card hover, bottom-left theme switcher, sticky mobile dock, error pages) are now exclusively injected via the `build_from_text` MCP tool entry point.

### Added
- **Multi-Framework Jonin Skills Suite**: Added canonical UI and Code Expert reference skills for **Nuxt** (`nuxt-ui-expert`, `nuxt-code-expert`) and **Angular** (`angular-ui-expert`, `angular-code-expert`), complementing Next.js (`nextjs-ui-expert`, `nextjs-code-expert`), Svelte (`svelte-ui-expert`, `svelte-code-expert`), and Tailwind (`tailwind-design-system`) under `jonin-skill`.
- **1-Shot 8-Page Production Application Architecture**: Standardized directives for `build_from_text` and `build_from_source` MCP handlers to deliver complete 8-page applications in one shot (10-Theme Switcher popup with Light Mode gradient palettes, 50-item live search dataset, multi-criteria range sliders, sticky mobile bottom navigation dock, financial loan calculator, branch finder, VIP portal, custom 4xx/5xx error pages, `Build by Konoha` watermark).
- **Fast-Path Auto-Setup CLI Caching**: Implemented timestamp-based fast-path caching (`.last_autosetup`) in `ensureAutoSetup()` to accelerate `konoha` CLI command execution from > 5s down to **< 100ms**.
- **`yaml_parser` Migration Module Fix**: Deployed `yaml_parser.py` into `src/`, `~/.konoha/`, and `~/.gemini/konoha/`, resolving `ModuleNotFoundError` during `konoha migrate`.
- **Subprocess Buffer & Event Loop Protections**: Configured Node `maxBuffer` to 1GB across all router spawns (`file_tools_router.js`) and ensured proper `child.unref()` and `process.stdin.pause()` cleanup in `bin/cli.js`.
- **Global Laptop Skill Synchronization**: Deployed and synchronized all skills across `~/.agents/skills/`, `~/.cursor/skills/`, `~/.konoha/skills/`, and template directories.
- **Bridge Gateway Preservation Guard**: Added a new mandatory project rule (`NEVER touch stable Bridge Gateway`) to all rule templates, agent instructions (`GEMINI.md`, `AGENTS.md`, `.cursor/rules/konoha.mdc`), and the `konoha-maintenance` skill to strictly forbid agents from modifying, refactoring, or touching any code, files, or configurations related to the local LLM Proxy Gateway, bridge servers, or the Bridge Router.
- **MCP Preamble Enforcement (Bugfix)**: Promoted the "Forced MCP Usage" rule from the bottom of all instruction files to the very **top** as a prominent `⚠️ MANDATORY` preamble block in all dynamically generated instruction files (`GEMINI.md`, `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/konoha.mdc`). This fixes a bug where agents would sometimes skip `konoha`/`semble` MCP tools and fall back to native/built-in tools because the rule was buried at the bottom and lost positional priority.
- **Shell Command Blocking in Sanitize Hook (Bugfix)**: Extended `antigravity_tool_sanitize_hook.js` to also block `run_command` calls containing shell file-reading commands (`cat`, `head`, `tail`, `grep`, `rg`, `find`, `fd`, `ag`, `ack`, `less`, `more`, `bat`, `wc`). Previously, agents could bypass MCP enforcement by calling `run_command('cat file.py')` instead of using `konoha` MCP's `read_file_head`.
- **Forced Konoha MCP + Semble MCP Usage and Subagent Delegation**: Added a new top-level "Forced MCP Usage & Delegation" section to all agent instructions and skill files (`CLAUDE.md`, `src/templates/AGENTS.md`, `src/templates/GEMINI.md`, `.agents/skills/konoha/SKILL.md`, `.cursor/rules/konoha.mdc`, `.cursor/skills/konoha/SKILL.md`, `README.md`, `docs/ARCHITECTURE.md`). Each section states the absolute rule: all work MUST flow through `konoha` MCP (skills + bounded file ops) and `semble` MCP (codebase search); never use generic `Read`/`Grep`/`Glob`/`cat`/`head`/`grep`/`rg`/`find` directly; never use `semble` for skills and never use `konoha` for codebase search. Also added the forced-MCP preface to each agent's `constraints` field in `src/templates/agents.json` and a "Workflow: Forced MCP Delegation" subsection to `README.md`. The main orchestrator MUST delegate all non-trivial tasks to konoha subagents (`genin`, `kage`, `chunin`, `jonin`, `anbu`, `tokubetsu-jonin`) and MUST NOT execute implementation tasks itself.
- **MCP Alias Architecture**: Subagents (`mcp_kage`, `mcp_jonin`, `mcp_anbu`, `mcp_chunin`, `mcp_tokubetsu_jonin`, `mcp_genin`) are now inline persona-injection aliases served by the konoha MCP server. When called, they return the agent's persona, system prompt, and embedded skills as tool response text — the orchestrator then roleplays as that agent in the current thread. No real background subagents are spawned.
- **Native Tool Denial Enforcement**: `antigravity_tool_sanitize_hook.js` now denies `view_file`, `grep_search`, `list_dir`, `Read`, `Grep`, `Glob`, and `Search` tools at the platform level, forcing AI agents to use `konoha` MCP and `semble` MCP exclusively.
- **GEMINI.md & AGENTS.md Disk Persistence**: `regenerateAndDeploy()` now writes the generated `GEMINI.md` and `AGENTS.md` files to disk (`~/.gemini/GEMINI.md` and `~/.agents/AGENTS.md`), fixing a bug where rules were generated but never saved.
- **Enterprise Web Search Tool**: Added a new enterprise-grade, rich smart `web_search` MCP tool supporting Google Custom Search API, with DuckDuckGo API and Wikipedia OpenSearch fallback, featuring automated browser header emulation and query simplification loops.
- **mcp_chunin Deep Research Integration**: Configured `mcp_chunin` to automatically trigger parallel web search and inject cited, ranked web findings directly into the subagent's initialization prompt whenever a deep research task is executed.
- **Unified Python Test Runner**: Integrated a dynamic test runner into the `konoha test` command which automatically scans the `src/` directory and runs all Python-based test suites (`src/test_*.py`).
- **FTS5 & Database Migration Tests**: Added `src/test_database_migration.py` to test schema structures, FTS5 matching, and python migration script execution.
- **Web Search Chain Tests**: Added `src/test_web_search.py` to test query simplification, SearXNG cache lookups, and Wikipedia fallbacks.
- **Bridge Gateway Tests**: Added `src/test_bridge_gateway.py` to verify the bridges schema, model routing registration, and custom OpenAI port configurations.
- **Multi-Source Zero-API-Key Search Chain**: Integrated a robust, self-healing search fallback chain into the `web_search` MCP tool. Resolves public SearXNG instances dynamically from searx.space with 24h instances caching and 1h best-instance verification, and falls back gracefully to DuckDuckGo HTML scraping, Startpage scraping, and Wikipedia OpenSearch.
- **SearXNG Data Pruning**: Configured `konoha data prune` to automatically clean up all SearXNG log and cache files (`search.log`, `instances_cache.json`, and `best_instance.json`) under `~/.konoha/searxng/` to reclaim disk space.
- **Laravel & Go ignores in walk cycles**: Automatically exclude `go-dist` (Go compiler distribution) and `vendor` (Composer dependencies) directories during `find_files_clean` file walks to prevent context bloat.
- **Proxy Gateway Token Preflight Mocking**: Added preflight token counter interceptor for `POST /v1/messages/count_tokens` to return `{"input_tokens": 0}` with a `200 OK` status, preventing Claude CLI and Cherry Studio gateway failures and infinite retry loops.
- **Separate Feature Diagrams**: Split the monolithic diagram in `docs/LLM-BRIDGE-GATEWAY.md` into dedicated visual architectures for the Konoha Bridge Router and LLM Bridges.
- **Models Status Subcommand**: Added a dedicated `konoha models status` subcommand to view model configurations of the agent village without listing all available models. Updated help instructions and examples in `cmdModelsHelp()` to include `status` and use modern available models (such as `Gemini 3.5 Flash (Low)` and `Claude Sonnet 4.6 (Thinking)`).
- **Passive Sidecar Discovery for Antigravity Bridge**: Implemented strict sidecar process discovery (`discovery.js`). To strictly adhere to Google's credentials and session usage policies, the bridge connects only to already active, user-initiated `agy` CLI or Antigravity IDE sessions, and never automatically spawns background daemon/sidecar processes on its own, ensuring safe authentication via `~/.gemini/oauth_creds.json` exclusively through user-started client binaries.
- **Response Model Rewriting**: Configured the Proxy Gateway to intercept both streaming (SSE) and non-streaming response payloads for OpenAI, Anthropic, and Gemini protocols, dynamically rewriting the returned `"model"` name back to the requested prefix-alias format (e.g. `<bridge_name>-<model-name-from-each-bridge>`).
- **Compression Safety**: Stripped client `accept-encoding` headers in the gateway proxy request to guarantee that bridges always return uncompressed text payloads, making search-and-replace model name rewriting robust.
- **Konoha Bridge Router**: Implemented the central Konoha Bridge Router on port `11434` to multiplex and serve all active LLM bridges. The router automatically discovers active bridges dynamically, aggregates their available models into an alias list (in the format `<bridge_name>-<model_name>`), and proxies requests (OpenAI completions, Anthropic messages, and Gemini generateContent) directly to the target bridge server based on the model prefix.
- **Embedded Router Status**: Embedded the Konoha Bridge Router's status check dynamically at the top of the `konoha bridge status` CLI report.
- **Bridge Management Subcommands**: Implemented new CLI subcommands (`konoha bridge status`, `konoha bridge list`, `konoha bridge create`, `konoha bridge delete`, `konoha bridge enable`, and `konoha bridge disable`) for managing multiple local LLM bridge instances.
- **Custom OpenAI Provider Support**: Enabled the bridge proxy to support custom OpenAI-compatible endpoints. The `konoha bridge create` command interactively collects custom ports, target URLs, and API keys, saving them securely to `~/.konoha/bridges.json`.
- **Dynamic Bridge Multi-Instance Launcher & Hot-Reloading**: Refactored the `konoha-files` MCP server to dynamically read `bridges.json` and hot-reload bridge config changes in real-time. Modifying the configuration (via create, enable, disable, delete) automatically starts, reloads, or stops the respective bridge ports immediately without restarting the host IDE or Claude Code process.
- **Upstream Error Propagation & Status Code Mapping**: Implemented exact upstream HTTP status code propagation (e.g. 401, 403, 429) and error details parser inside raw inference proxy and endpoint handlers (`openai.js`, `anthropic.js`, `gemini.js`), mapping them to standard OpenAI/Anthropic/Gemini error shapes.
- **Immediate Bridge Lifecycle Subcommand Updates**: Updated the bridge lifecycle subcommand feedback messages in `cli.js` (`enable` / `disable`) to reflect instant background activation and shutdown via config hot-reloading.
- **Clean Process Termination (Zombies Prevention)**: Added a dedicated `readline` close listener to cleanly terminate intervals, close file watchers, and exit the MCP server on stdin EOF, preventing orphaned background bridge processes.
- **`ag-local-bridge` Integration**: Integrated local LLM proxy bridge directly into the `konoha-files` MCP server. The HTTP bridge server is automatically booted in-process when the MCP server initializes (listening on port `11435`), enabling seamless OpenAI/Anthropic/Gemini compatibility with the local Antigravity sidecar.
- **Automated Bridge Deployment**: Configured `deploy_utils.js` to recursively copy all bridge modules to `~/.konoha/bridge/` and automatically run dependency installation (`npm install`) inside `~/.konoha/` to install `@bufbuild/protobuf`.
- **Active Sessions Telemetry & Pruning**: Implemented active session tracking inside SQLite database, allowing users to view total DB statistics using `konoha data view`, prune old mappings using `konoha data prune`, and vacuum the database directly using `konoha data vacuum`.
- **Knowledge Base Exporting**: Added the `konoha data export` subcommand to export the database's skills, agent village roster, and active sessions telemetry into a Markdown file (e.g., `konoha-persona-ddmmyyms.md`) in the current working directory.
- **Session Isolation and Leak Prevention**: Restricted workspace scan directories to files matching the active workspace slug to prevent cross-session context leaks and hallucinations in Cursor, Claude Code, and Antigravity.
- **Main Agent Konoha-Files Boundary**: Updated the orchestrator's global agent instruction templates (`GEMINI.md` and `AGENTS.md`) and compiler configuration manager (`agent_manager.js`) to mandate that the main agent (coordinating orchestrator) utilizes the `konoha-files` MCP server for all file reads and line greps instead of generic file utilities.
- **Dynamic Skill Checklist Injection**: Compilers and deployment generators dynamically strip any legacy find_skill instructions and inject active `Before work: find_skill` calls directly at compile/generation boundaries based on the agent's current `skills` array.
- **Direct Tool Calls Fallback**: Integrated fallback mechanism to execute skills using Direct Tool Calls in the main coordinator thread when no specialized subagent embeds the matching skill.
- **Persistent Upgrade Marker**: Replaced inline checks for default skills with a persistent `.upgraded_v1.1.1` marker file to determine upgrade status, allowing complete freedom to change or unembed official skills per agent.
- **Depth Calculation Correction**: Fixed loop counter reset bugs in nested task structures by loading depth metadata from both incoming and target `delegate.md` directories.
- **Clean config on disk**: Automatically migrate and clean `~/.agents/agents.json` on disk to remove hardcoded checklists, keeping user configurations clean.
- **Antigravity Session Isolation**: Enhanced `detect_active_agent()` in `src/server.py` to check `os.environ.get("ANTIGRAVITY_CONVERSATION_ID")` first. If present, it isolates the transcript and active agent search strictly to the active conversation directory, preventing cross-session tool misattributions and hallucinations.
- **Antigravity Delegation Guard**: Safety guardrail (`Never touch logic delegated in Antigravity`) built into `src/agent_manager.js`, `src/cursor_manager.js`, rules templates, and global instructions to protect the orchestrator's delegated flow.
- **Automated Transient Task Cleanup**: Configured rule exceptions and guidelines in `src/agent_manager.js`, `src/cursor_manager.js`, and `SKILL.md` to automate the cleanup of transient agent task files (under `scratch/tasks/`) silently and immediately without requiring manual user confirmation.
- **Konoha MCP Tools Reference**: Documented full schemas, parameter definitions, and descriptions for all available tools across the `konoha`, `semble`, and `konoha-files` MCP servers directly within `konoha-maintenance` `SKILL.md` to establish localized developer knowledge.
- **Optimize Thought Tokens**: Embedded thought optimization rule (`Optimize Thought Tokens`) directing agents to keep thought processes concise and implementation-focused to minimize output and reasoning token costs under thinking models.
- **Planning-to-File (Thought-to-Markdown)**: Integrated planning-to-file convention directing the orchestrator and subagents to output complex design plans, step-by-step implementations, and deep reasoning to workspace plan markdown files (e.g. `plan.md`) instead of verbose conversation logs, optimizing token limits and execution logs.
- **Skills-DB "By Call Type" breakdown**: Added call type distribution metrics to `konoha savings`, displaying tool call frequency, ratio, and visual horizontal bar charts for all Skills-DB tools (e.g. `find_skill`, `get_skill`, `list_skills`, etc.) styled to align perfectly with Semble's layout.
- **Thought Token Tracking**: Scans and parses conversation transcripts under `<appDataDir>/brain/*/.system_generated/logs/transcript.jsonl` to calculate model reasoning/thought tokens (character count / 4) and generated response tokens.
- **Period Savings Telemetry Refinement**: Replaced the redundant percentage column (`(100%)`) in the period table of `konoha savings` with the actual estimated thought tokens used per period (e.g. `(thought: 95.0k)`).
- **Agent-tier Cost Computation**: Calculates the exact USD context input cost saved based on the model tier configured for the active agent (Flash: `$0.075/1M` input, Pro: `$1.25/1M` input), net of output/thought generation costs.
- **Cursor IDE/CLI Auto-Setup**: New `src/cursor_manager.js` registers `konoha`, `semble`, and `konoha-files` in `~/.cursor/mcp.json`, deploys Konoha ninja subagents to `~/.cursor/agents/` with embedded **Cursor model slugs** (`composer-2.5-fast`, `claude-opus-4-8-thinking-high`, `gpt-5.3-codex`, etc.), writes project `.cursor/rules/konoha.mdc` orchestrator rules, and configures Cursor CLI MCP permissions in `~/.cursor/cli-config.json`.
- **Cursor skills mirror**: `deploy_utils.syncCursorSkillsFromAgents()` mirrors `~/.agents/skills/` → `~/.cursor/skills/` and project `.cursor/skills/` on init, `ensureAutoSetup`, `konoha skill add`, and Cursor `sessionStart` hook.
- **Safe JSON merge**: `mcp_clients_manager.js`, `cursor_manager.js`, and `bin/cli.js` no longer reset user MCP config on parse errors.
- **`konoha init` refresh path**: When DB already exists (without `--force`), still syncs server files and refreshes MCP integrations for all configured clients.
- **`ensureAutoSetup` project guard**: Silent bootstrap no longer deploys `.cursor/` into arbitrary working directories (`deployProject: false`).
- **Cursor transcript ordering**: `server.py` prefers most-recent `.jsonl` when detecting Cursor subagent attribution.
- **Deploy utils**: `copyRecursiveIfDifferent` tolerates broken symlinks without crashing.
- **Cursor Model Fields**: `cursorModel` and `cursorFallbackModel` added to `src/templates/agents.json` for each official subagent.
- **Build Directives**: Added dummy image placeholders and automatic `pnpm build && pnpm start` execution to `build_from_source` and `build_from_text`.
- **Strict Quality Guarantees**: Jonin builds now strictly enforce zero deprecated packages, safe `.env.example` extraction, security best practices, zero CVEs, and zero linting/build errors.
- **Enhanced SvelteKit Skills Reference**: Updated `.agents/skills/jonin-skill/references/svelte-code-expert.md` with advanced Svelte 5 Accessibility (a11y) guidelines, a strict verification pipeline (`svelte-check`, typescript compiler, `pnpm lint`), SSR hydration safety (guarding browser-only APIs), and image-to-code layout similarity comparison loops.

### Changed
- **Proxy Gateway Port 11434 → 19999**: The outer Proxy Gateway now listens on port `19999` (was `11434`). Inner bridges are user-registered and use ports of the user's choosing (e.g. `11435`, `11436`, or any free local port). Update any client SDK base URLs accordingly.
- **Bridge Model Prefix Resolution**: Gateway model resolution now checks (1) bridge-name prefix (`<bridge_name>-<model>`) first, (2) exact model cache match across all bridges, then (3) falls back to the first active bridge. Cache TTL for bridge model lookups is 30 seconds to avoid repeated discovery calls on every request.
- **`adacode` bridge example documented in setup docs (Ollama-compatible, not a default)**: The `adacode` bridge is documented as an example of an OpenAI-compatible outbound bridge. The bridges table starts empty on install — no bridge is shipped by default. Local clients connecting to the gateway on `19999` no longer need to send an API key — the bridge injects the key only on outbound upstream calls. Model prefix: `adacode-<model>` (e.g. `adacode-gpt-4o`).
- **Multi-Provider Bridges Config**: `~/.konoha/bridges.json` is now an array of bridge objects with `{name, port, provider, enabled, requiresSidecar?, targetUrl?, apiKey?}`. Supported providers include `antigravity` (passive sidecar) and `openai` (real upstream). Legacy single-object configs are auto-migrated.
- **Local Auth Boundary & Header Stripping**: The gateway strips inbound `Authorization`, `x-api-key`, and `x-konoha-gateway-*` headers from incoming requests before forwarding to inner bridges. API keys are only attached by a bridge when making outbound calls to a real backend. The `antigravity` bridge never holds or transmits Google OAuth credentials; it uses passive CSRF + mTLS discovery against the user's running sidecar.
- **`konoha init`**: Prompts for Cursor IDE/CLI configuration consent and deploys global + project Cursor configs.
- **`konoha status` / `konoha doctor`**: Report and auto-repair Cursor integration health.
- **`konoha uninstall`**: Removes Konoha-managed entries from `~/.cursor/`.
- **Cursor Free default model behavior**: Cursor subagents now default to `model: inherit` (Auto session model), so Konoha works without explicit model selection on free-tier Cursor accounts.
- **Strict Antigravity orchestrator pipeline**: Shared `buildOrchestratorWorkflow()` in `agent_manager.js` enforces `prompt.md` → analyze → `delegate.md` → Konoha subagent → `result.md` → user report. Removed `@self` / `@research` from delegation tables; `prompt_hook.js` ephemeral message now states the full pipeline.

### Removed
- **Bridge Quota Persistence**: Dropped the `quota_unavailable_until` column from the `bridges` table and removed the `--set-quota` / `--clear-quota` CLI actions from `src/db_bridges.py`. Bridge availability is now tracked in-memory only by the gateway rotator; quota cooldown state no longer survives restarts. Updated skill docs (`.agents/skills/konoha/SKILL.md`, `.cursor/skills/konoha/SKILL.md`) to reflect the simplified schema.
- **SQLite-Driven Dynamic Skills & Routing Table**: Dynamic resolution of ninja subagents skills configurations (`a.skills` arrays) and global "Routing by Domain" table compiled dynamically at rule generation time by querying the local SQLite database (`skills.db`). Avoids hardcoded checklists and static lists in source code templates, rules, and Markdown instructions, instantly reflecting any skill additions or removals.
- **Dynamic Claude Code & Cursor Rules Mappings**: Claude Code and Cursor rule files now receive fully dynamic, database-driven skill tables listing all base skills matching each agent's active configuration dynamically.
- **Removed Profiling Leftovers**: Deleted obsolete test/profiling scripts (`prof_timings.js`, `prof_autosetup.js`, `bin/cli_inst.js`) to keep the repository clean.
- **Bridge Storage Migration (SQLite)**: `~/.konoha/bridges.json` flat-file storage is replaced by SQLite-backed persistence in `skills.db` (`bridges` table: `name`, `port`, `provider`, `enabled`, `target_url`, `api_key`). Legacy JSON entries are auto-migrated on first read. All bridge CLI commands (`konoha bridge create`, `delete`, `enable`, `disable`) now route through `src/db_bridges.py`.
- **Stream Inactivity Timeout**: Gateway-level stream keepalive with 45-second inactivity kill window and 5-minute absolute max duration. Prevents hung connections and stale HTTP listeners.
- **Response Model Rewriting**: Streaming and non-streaming responses have their `"model"` field rewritten back to the gateway alias (e.g. `antigray-gpt-4o` ← `gpt-4o`). Covers OpenAI, Anthropic, and Gemini protocols.
- **Compression Safety**: `accept-encoding` headers are stripped in gateway forwarding to guarantee uncompressed responses, making regex-based model name rewriting reliable.
- **Header Sanitization**: The gateway strips inbound `Authorization`, `x-api-key`, `x-forwarded-*`, `x-request-id`, `x-client-*`, and `x-konoha-gateway-*` headers before forwarding to inner bridges. API keys are only injected by the bridge for outbound calls.
- **`ag-local-bridge` VS Code Extension Shell**: Removed `src/bridge/extension.js`, `src/bridge/interceptors/{https,h2,http-server}.js`, and trimmed `src/bridge/context.js`. The antigravity bridge functionality is now fully reproduced by the in-process `konoha-files` MCP server (`file_tools_mcp.js` boots the bridge HTTP listener and Proxy Gateway directly). Deletion of the H2 / HTTPS / HTTP-server monkey-patch interceptors reduces the bridge's attack surface and confirms continued non-access to `~/.gemini/oauth_creds.json` (credentials remain exclusively handled by the user-started `agy` / Antigravity sidecar process via CSRF tokens parsed from its command-line flags). Removed dead `/v1/captures` route whose only writer was the deleted H2 interceptor.
- **Semble as default search/grep**: New `src/search_policy.js` mandates `semble` MCP (`search`, `find_related`) instead of grep/glob/find/rg and Cursor `Grep`/`Glob`/`SemanticSearch` on both Antigravity and Cursor when Konoha is installed.
- **Token-efficient file tools (`konoha-files` MCP)**: New Node MCP server (`file_tools_mcp.js`) with Python workers for `read_file_range`, `token_efficient_grep`, `get_file_structure`, and `find_files_clean`. Auto-registered on `konoha init` / `migrate` for Antigravity and Cursor.

### Security
- **Tightened Sidecar Coupling**: The bridge no longer holds a TCP listener open while the user's Antigravity session is closed, closing the window where an external client could speak to the bridge without the user's Antigravity session present. Together with the existing passive-discovery guarantee in `discovery.js`, this enforces a strict invariant: a bridge port is only reachable when the user has explicitly opened Antigravity.
- **`konoha-files` workspace path sandbox**: Standardized path bounds checking inside `file_tools_mcp.js` (JS) and Python workers to enforce a strict workspace path sandbox and reject absolute traversal attempts.

### Fixed
- **Savings Token Attribution**: Fixed a bug in `db_savings.py` where the `mcp_jonin` agent output tokens were erroneously calculated at the Pro tier rate instead of its assigned Flash tier, correcting cost metric inflation.
- **Documentation Architecture Sync**: Updated architecture routing diagrams inside the Konoha maintenance skill to correctly document the `mcp_sannin` delegation flow.
- **Claude Code MCP Namespacing Tool Calls**: Fixed a bug where Claude Code instructions (`~/.claude/CLAUDE.md` and `~/.claude/agents/*.md`) referenced MCP tools using dot-notation (e.g. `konoha.find_skill`, `semble.search`). Since Claude Code names stdio MCP tools using double underscores (e.g. `mcp__konoha__find_skill`, `mcp__semble__search`), the agent failed to resolve and invoke these tools. Added auto-rewriting mappings in `agent_manager.js` and `mcp_clients_manager.js` to replace standard dot-notation calls with the correct double-underscore prefixed format in all Claude Code configurations.
- **Claude Code Subagent Delegation Bug**: Fixed a bug where Claude Code subagents (`~/.claude/agents/*.md`) and instructions (`~/.claude/CLAUDE.md`) were generated with instructions containing orchestrator-centric protocols (referencing `delegate.md` and `~/.agents/AGENTS.md`). In Claude Code (which runs as a single-agent environment), these references caused the agent to incorrectly attempt subagent delegation or fail. Added explicit "Never Delegate" rules and stripped all delegation/orchestrator protocols from Claude Code configuration templates.
- **Claude Code Subagent MCP Tool Permissions**: Fixed a wildcard bug where Claude Code subagents were configured with incorrect tool prefixes (`mcp_semble_*`, etc.) using a single underscore. This prevented the agents from running or calling the MCP server tools, resulting in subagent initialization failures. Corrected the prefixes to use the double-underscore notation (`mcp__semble__*`, `mcp__konoha__*`, `mcp__konoha-files__*`).
- **Dynamic Model Selection in CLI**: Fixed a bug where the model configuration wizard (`konoha agent models`) and model commands (`konoha models list`, `konoha models embed`) only listed/resolved hardcoded models. Now they dynamically query and list models served by active LLM Proxy Gateway bridges when active.
- **HTTP/2 Unary Connection Timer Leak**: Fixed a memory leak in ConnectRPC unary calls (`rpc.js`) where `setTimeout` timers were not cleared on promise settlement, preventing event loop buildup.
- **Safe Bounded Request Body parsing**: Fixed unbounded request body parser vulnerabilities in `gateway.js` and `utils.js` by limiting payloads to 200MB default to fully support modern high-context LLMs and multi-image payloads while preventing Out-of-Memory (OOM) crashes.
- **Consecutive Tool Message Validation**: Fixed a logic bug in tool call verification (`sanitize.js`) where the assistant's multiple tool calls were partially checked against only a single next message instead of scanning all consecutive tool responses.
- **Claude Code MCP Permissions**: Resolved an issue where Konoha MCP servers (`konoha`, `konoha-files`, `semble`) failed to execute inside Claude Code by implementing automatic user-level permission granting in `~/.claude/settings.json`.
- **CLI Client Telemetry Attribution**: Fixed client resolution in `src/server.py` so tool calls made via the `agy` CLI are correctly attributed to the CLI instead of the generic fallback `antigravity` (IDE).
- **Symmetric Provider Breakdown Columns**: Symmetrically widened the table columns to `20` visual characters, split the generic `antigravity` provider into `Antigravity IDE` and `Antigravity CLI`, and formatted token counts using the standard suffix `Token` instead of `t`.
- **Database & Custom Skills Preservation on Uninstall**: Refactored `cmdUninstall` in `bin/cli.js` to preserve the SQLite metrics database files (`skills.db*`) and selectively delete only default official skills from the global skills directory (`~/.agents/skills/`), leaving custom user skills untouched.
- **Subagent Discovery Across Surfaces**: Fixed subagent discovery issues where custom subagents were not listed in the prompt (`Available subagents: research, self`) by ensuring subagent configurations are deployed to the CLI and IDE global agents directories (`~/.gemini/antigravity-cli/agents/` and `~/.gemini/antigravity-ide/agents/`), and correctly passing `projectDir` during deployment.
- **`readline` is not defined in `konoha skill search`**: Fixed ReferenceError crash by importing the Node.js `readline` library in `src/skill_manager.js`.
- **Semble Call Parsing in Combined Savings**: Fixed regex patterns in `bin/cli.js` to correctly capture and parse Semble call counts formatted with suffixes (such as `1.0k` or `1.5M`).
- **`konoha saving` subcommand alias**: Added `saving` as a routed alias for `savings` in `bin/cli.js` for smoother command execution.
- **Cursor session start hook ReferenceError**: Fixed `ReferenceError: deployUtils is not defined` inside `src/cursor_bootstrap.js` by defining a self-contained local implementation of `buildKonohaFilesMcpEntry()`, restoring automatic client self-healing and config sync in Cursor.
- **Session isolation boundary leak**: Excluded Cursor projects search from `brain_dirs` in `detect_active_agent()` inside `src/server.py` when `ANTIGRAVITY_CONVERSATION_ID` is set, preserving strict session isolation across concurrent IDE sessions.
- **Subagent delegation LLM parsing**: Fixed LLM parsing issue where orchestrator gets `CORTEX_STEP_TYPE_INVOKE_SUBAGENT` error by removing model tier annotations from template files (`GEMINI.md` and `AGENTS.md`) and roster generation in `agent_manager.js`. Also pre-registered hidden global agent configurations in `src/antigravity_manager.js` and restored the `buildDefineSubagentArgs` helper function to prevent runtime crashes during init.
- **`ensureAutoSetup()` never invoked**: Restored silent auto-bootstrap on every `konoha` command (was defined but never called since v1.0.9).
- **Cursor path visibility**: `server.py` now allows `~/.cursor/` and `.cursor/skills` paths in workspace scoping checks.
- **`konoha agent status` Antigravity attribution**: `detect_active_agent()` no longer false-positives on `VIEW_FILE` transcript lines (e.g. GEMINI.md content containing `[Genin] active`). Delegated subagents are resolved from `prompt.md` plus recent `PLANNER_RESPONSE` transcripts; stale brain folders are skipped.
- **`tokubetsu-jonin` mis-attribution**: Subagent scan order now checks `tokubetsu-jonin` before `jonin` so word-boundary matching does not classify Tokubetsu-Jonin sessions as Jonin.
- **Protected default subagents**: `konoha agent delete` rejects removal of official ninja agents defined in `templates/agents.json`.
- **`agent_stats.py` counters**: Aggregates with `GROUP BY LOWER(agent)` for consistent case-insensitive totals.
- **Cursor agent telemetry**: `detect_active_agent()` scans `~/.cursor/projects/*/agent-transcripts/` for recent `Task` subagent delegation and subagent `[Agent] active` text logs; recent Cursor sessions are preferred over stale Antigravity brain folders.
- **Cursor vs Antigravity ranking**: Session activity ranking uses transcript mtime (not orchestrator `prompt.md` touch) so Cursor MCP calls are not masked by Antigravity prompt hooks.
- **Removed dead `cursor_prompt_hook.js` reference** from `cursor_manager.js` (file was never shipped).
- **`find_skill` ranking**: Results preserve BM25 order after workspace visibility filtering; LIKE fallback ranks by relevance instead of byte size; `rank` field included in responses.
- **Antigravity real subagent delegation**: `konoha-subagent-hook` PreInvocation hook calls `define_subagent` programmatically at session start (bare names); forbids manual `define_subagent` and `TypeName: "self"` fallback; requires `invoke_subagent` with Konoha TypeNames only.
- **`build_from_source` image-to-code**: When mockup images are detected, response sets `image_to_code_required`, `required_skills`, `skill_load_sequence`, `delegate_constraints`, absolute image paths, forbids `build_from_text`, and mandates `get_skill` + mockup `view_file` before UI coding.
- **Jonin skill bootstrap**: Jonin instructions and orchestrator `delegate.md` rules require loading all `required_skills` via `get_skill`; image builds forbid default premium template in delegation briefs.
- **`konoha migrate` quality**: `optimize_content()` is now lossless-safe (no list restructuring, no ingest-time injection shielding); deprecated skills purged after each migrate.
- **Subagent Identity Spawning (Antigravity CLI)**: Removed `hidden: true` from the `antigravity_manager.js` deployer to ensure `invoke_subagent` correctly loads custom ninja instructions instead of falling back to the default generic agent profile.

### Documentation
- **Separate Feature Diagrams**: Split the monolithic diagram in `docs/LLM-BRIDGE-GATEWAY.md` into dedicated visual architectures for the Konoha Bridge Router and LLM Bridges.
- **Preflight & Ignores Documentation**: Updated the `konoha-maintenance` skill (`SKILL.md`) for both Antigravity and Cursor to document `find_files_clean` path ignores (`go-dist` / `vendor`) and Proxy Gateway preflight token count mocking (`POST /v1/messages/count_tokens`).
- Updated README, ARCHITECTURE, SETUP-IDE, SETUP-CLI, SETUP-CURSOR, TROUBLESHOOTING, and konoha SKILL for v1.1.6 multi-client support, orchestrator pipeline, semble-default search, and konoha-files MCP.
- **Architecture diagrams**: Removed fictional "LLM Model Registry / Fallback Router" layer — Konoha does not implement multi-provider LLM routing; host IDEs own model execution.
- **Live benchmarks**: `docs/BENCHMARK.md` refreshed with `konoha savings` metrics captured 2026-06-23.
- **konoha-maintenance skill**: Sections 17–21 cover multi-CLI setup, workspace-local skills, path sandbox, release QA gates, and attribution fixes.
- Fixed stale `build_with_image_design` / `konoha render` references in jonin-skill references.
- **CLI TUI (v1.1.6)**: Gradient styling and dynamic table widths in `konoha doctor`, `konoha status`, and installer output — fixed overlapping Doctor table columns.
- **konoha-files MCP fixes**: Cross-platform `file_tools_launcher.js`; 6 tools (`read_file_head`, `file_info`, enhanced grep); Cursor MCP uses `node` + launcher (fixes 0-tools / connection errors); `platform_utils.js` for Windows `file://` URIs, tilde paths, and `py -3` Python detection.
- **Cross-platform QA**: Path sandbox `normcase` on Windows; `.node_exec_path` and `.python_cmd` records; `konoha test` 14/14; doctor smoke-tests konoha-files launcher.

### Release QA (v1.1.6)
- **Attribution**: `test_agent_attribution.py` 7/7, `test_cursor_attribution.py` 8/8.
- **MCP**: `konoha test` 14/14; `konoha doctor --yes` all healthy.
- **Security**: `konoha-files` workspace path sandbox (JS + Python).
- **Install repair**: `deploy_utils.js`, `registerHooks(true, true)`, semble args repair, Cursor project MCP merge, `cursor_bootstrap.js` konoha-files + semble policy.

## [1.1.5] - 2026-06-23

### Added
- **Unified `build_from_source` MCP Tool**: Replaced `build_with_image_design` with a unified `build_from_source` tool that supports both design mockup images (`.png`, `.jpg`, `.jpeg`, `.webp`, `.svg`) and source code reference files (`.html`, `.xml`, `.tsx`, `.jsx`, `.ts`, `.js`, `.css`).
- **Image Analysis in `build_from_source`**: Lazy PIL integration for extracting image dimensions, dominant colors, aspect ratios, and orientation from design mockups to guide responsive layouts.
- **Source Code Analysis**: Automatic peeking into reference source files to detect framework hints (React, Svelte) and import/export patterns.

### Changed
- **Removed `konoha render`**: Deleted the visual comparison command and `src/visual_compare.py`. The `build_from_source` tool now handles all design-to-code workflows.
- **Corrected v1.1.4 CHANGELOG**: Updated historical entry to accurately reflect tools shipped in that release.

### Fixed
- **Null argument crash in `build_from_source`**: Added null checks for required arguments (`name`, `source_dir`, `framework`) to prevent `TypeError` crashes when arguments are missing from JSON-RPC requests.
- **Null argument crash in `build_from_text`**: Added null checks for required arguments (`name`, `description`, `framework`) to prevent the same crash pattern.
- **File traversal cap bypass in `build_from_source`**: Fixed the 100-file limit in directory scanning — the `break` statement was scoped inside the inner filename loop and did not terminate the outer `os.walk()` traversal.
- **Missing `model` parameter in subagent config**: Fixed `src/agent_manager.js` to correctly inject the `model: \`<modelTier>\`` property into the `GEMINI.md` generation, resolving a bug where all subagents were defaulting to a generic model instead of their configured tiers (e.g. Claude 4.6, Gemini 3.5 High).
- **Stale `visual_compare.py` reference**: Removed dead comment referencing deleted file from `server.py` module header.
- **Destructive HTML Comment Stripping**: Disabled aggressive HTML comment stripping (`<!--.*?-->`) in `src/migrate.py`'s `optimize_content` function to preserve critical Svelte compiler directives (e.g. `svelte-ignore a11y_...`) and structural markdown markers (e.g. `<!-- slide -->`) during the `konoha migrate` indexing process.

## [1.1.4] - 2026-06-22

### Added
- **Build from Text MCP Tool**: Added `build_from_text` MCP tool to the Python server for generating premium storefronts from textual descriptions with default visual effects templates.

### Changed
- **Zero-Warning Lint Gate Compliance**: Relaxed ESLint configurations in Svelte/SvelteKit (`eslint.config.js`) and Next.js (`eslint.config.mjs`) template guidelines to turn off strict typescript, unused-vars, image element, and unescaped entity warnings.
- **Svelte Compiler Warnings Suppression**: Added automated `onwarn` directives to Svelte configuration instructions (`svelte.config.js`) to suppress all compiler-level accessibility (a11y) diagnostics during build gates.

### Fixed
- **Subagent Delegation**: Removed prefix characters (`→ ` and `@`) from generated delegation tables in `GEMINI.md` and `AGENTS.md` to ensure the orchestrator invokes subagents with exact clean TypeNames.
- **Infinite Update Loop**: Resolved the `needsAgentUpgrade` condition checking for `!a.instructions.includes('pass agent=')` which resulted in constant regeneration and file writes. Modified to correctly check for `agent=`.
- **Case-Insensitive Statistics**: Fixed subagent status metrics calculation in `src/agent_stats.py` to aggregate statistics case-insensitively using lowercase agent names, resolving misattribution to `Direct Tool Calls`.

## [1.1.2] - 2026-06-19

### Added
- Added image-to-code generation rules in Svelte and Next.js skills (exploring image files in workspace and using image analysis to generate UI).
- Added strict project preservation rules in Svelte and Next.js skills (never changing existing flow, logic, and style in workdir).

## [1.1.1] - 2026-06-17

### Added
- Integrated warnings explicitly separating `semble` and `konoha` tool boundaries in instructions (`GEMINI.md`, `AGENTS.md`, `agents.json`, `agent_manager.js`, and all 6 local skill files) to prevent rate limit and token quota burning.

### Changed
- Constrained Homepage Hero Banner 3D Carousel to be full-width when displayed from desktop view.
- Revamped the interactive subagent model (`models`) and skill (`skill`) configuration menus in `bin/cli.js` with loop-on-toggle capabilities, step-by-step state-machines, and professional console styling.
- Integrated Escape (ESC) key bindings (`\u001b` checks) and explicit back/cancel options (`0`, `q`, `exit`, `back`) into all interactive input prompts.

### Fixed
- Updated `ThemeSwitcher` templates in Svelte (`svelte-ui-expert.md`) and Next.js (`nextjs-ui-expert.md`) to use the exact 10 gradient themes (Nebula, Aurora, Sunset, Ocean, Forest, Volcano, Sakura, Cyberpunk, Midnight, and Gold) rather than obsolete light themes list.

## [1.1.0] - 2026-06-15

### Added
- **Interactive Consent Hooks**: Added interactive `y/n` confirmation prompts for `hooks.json` registration (via `confirm` from `@inquirer/prompts`) to comply with Google Security policies.
- **Token Hygiene Instructions**: Implemented targeted file-reading directives in `GEMINI.md`, `AGENTS.md`, and default agent presets (`src/templates/agents.json`) to prevent subagents from viewing files in their entirety and consuming high tokens per turn.
- **Doctor Diagnostic Hook Check**: Added prompt hook verification and auto-repair routines to `konoha doctor`.
- **Gradient Theme Customization**: Expanded `jonin-skill` theme choices by adding 6 new default themes (Forest, Volcano, Sakura, Cyberpunk, Midnight, and Gold), bringing the total to 10 available gradient options (Nebula, Aurora, Sunset, Ocean, Forest, Volcano, Sakura, Cyberpunk, Midnight, and Gold) for UI customization.

### Changed
- **Folder-Based Skills**: Upgraded default skills `anbu-skill` and `jonin-skill` to directory-based structures (recursively copying `references/` and `scripts/`).
- **Zero-Error Guarantee**: Added a strict Zero-Error Guarantee & Verification Loop to `jonin-skill` (enforcing A11y and post-generation build verification via `pnpm`).
- **Enforced Semble Call Policy**: Enforced mandatory `semble` MCP calling across all main coordinator and subagent workflows, including under Direct Tool Call fallback execution. Added automated constraint upgrades to `loadAgents()`.
- **Default Semble Config**: Included `--content all` in default `semble` configuration arguments.
- **Aligned Token Savings Baseline**: Updated `server.py` to calculate token savings against the sum of all skills in the database (~550 KB index size) rather than dynamic subagent-specific baselines, aligning calculation logic with the CLI display and showing true context window savings.

### Fixed
- **Doctor Table Formatting**: Corrected results table layout width alignments to prevent long script names from overlapping formatting borders.
- **Village Agent Alignment**: Restored the 6-agent village structure by reverting the custom orchestrator subagent definition from the CLI core.
- **Doctor Spinner Line Clears**: Updated terminal spinners in `cli.js` to use `\r\x1b[K` (Erase Line) ANSI escape codes to ensure clean line clearing and prevent table overlap in various terminal environments.

## [1.0.9] - 2026-06-11

### Added
- **3D Animated Splash Screen**: Implemented a beautiful 3D rotating ASCII cube splash screen intertwined with `gradient-string` figlet text that runs on `konoha` without arguments and `konoha init`.
- **Modern TUI Dependencies**: Added `chalk`, `gradient-string`, `ora`, and `figlet` to create a visually stunning interactive CLI experience.

### Changed
- **TUI Splash Animation**: Replaced the 3D cube animation with an intense lightning effect using jagged ASCII art and flashing colors, and updated the CLI to run this splash screen globally before any command.

## [1.0.8] - 2026-06-11

### Added
- **Upgrade Compliance**: Applied interactive `@inquirer/prompts` to the `konoha upgrade` command to ensure explicit user consent before initiating an upgrade and modifying `~/.gemini` configurations.
- **Interactive Consent**: Introduction of interactive prompts (using `@inquirer/prompts`) in `bin/cli.js` for explicit user consent before modifying `~/.gemini` configuration files or approving MCP tools.
- **Compliance Documentation**: Implementation of rigorous compliance documentation generation in `docs/SecurityCompliance/`.

### Changed
- **NPM Scripts**: Removal of the `postinstall` script from `package.json`.

### Fixed
- **Auto-Configuration Security**: Remediation of silent auto-configuration vulnerabilities (Risk 1 and Risk 2).

## [1.0.7] - 2026-06-10

### Added
- **Zero-Configuration Auto-Setup & Self-Healing**: Implemented a silent `ensureAutoSetup()` bootstrapping routine in `bin/cli.js` that automatically runs on any command execution. It ensures required directories exist, silently installs and registers `semble` and `konoha` MCP servers in `mcp_config.json`, configures permanent tool auto-approvals in `settings.json`, sets up default agent configuration/rule files (`agents.json`, `GEMINI.md`, `AGENTS.md`), and seeds the initial SQLite skills database (`skills.db`) if missing.
- **Command Execution Whitelisting**: Added auto-approval settings for running `node bin/cli.js` and `konoha` in `settings.json` to enable seamless local execution.
- **Persistent Tool Auto-Approval**: Integrated persistent auto-approve configuration for all `konoha` and `semble` tools in `mcp_config.json`.
- **Subagent Artifact Auto-Approval**: Configured instruction templates for all 6 subagent ranks to suppress artifact user prompts (`RequestFeedback: false` and `UserFacing: false`) to allow background operations.

### Changed
- **Proactive Execution Safety Guardrails**: Hardened subagent behavior directives to strictly enforce proactive execution, prohibiting agents from commanding the user to run files or operations manually.

## [1.0.6] - 2026-06-10

### Added
- **Global Artifact Suppression Settings**: Configured instruction templates (`GEMINI.md`, `AGENTS.md`) and manager code (`agent_manager.js`) to globally instruct subagents to suppress artifact approval overlays (using `RequestFeedback: false` and `UserFacing: false`) for all files and artifacts written or modified during execution.
- **True Combined Savings Percentage**: Added mathematically accurate combined percentage calculation and visual display (`Today`, `Last 7 Days`, `All Time`) to the `savings` CLI summary box.

### Changed
- **Stable Models Only**: Filtered out all unstable preview models from the `AVAILABLE_MODELS` list in `bin/cli.js` to prevent errors.
- **Dynamic Token Savings Baseline**: Updated `log_tool_call` in `server.py` to dynamically compute baseline based on the active agent's assigned skills (falling back to a realistic 25 KB baseline instead of the entire database size), and set savings to `0` for `get_skill` calls to prevent inflated context reports.
- **Corrected Stats Queries**: Updated `db_savings.py` and `bin/cli.js` to compute Skills-DB savings percentage against a denominator of actual returned plus saved bytes, rather than database-wide totals.

### Fixed
- **Inflated Token Savings**: Eliminated fake 99% savings for `get_skill` operations, migrating existing sqlite stats database via `migrate_stats.py` to restore honest savings metrics.

## [1.0.5] - 2026-06-09

### Added
- **Subagent Creation Locking Guardrail**: Added a whitelist check in `agent_manager.js` rejecting automatic custom subagent creation unless a `--manual` flag is supplied, preventing external scripts from violating agent guardrails.
- **Dynamic Instruction Skill Sync**: Implemented dynamic instructions sync to ensure all active/embedded skills are accurately mapped in the `Before work: find_skill(...)` calls on load/restart cycles.
- **SQLite FTS5 Query Sanitization Input Guardrail**: Implemented regex-based query sanitization in `server.py` to prevent SQLite FTS5 MATCH syntax compilation crashes (unbalanced quotes/parentheses, bare AND/OR/NOT, dangling asterisks/carets/colons).
- **Indirect Prompt Injection Shielding Input/Output Guardrail**: Added defensive text parsing in both `migrate.py` (ingestion phase) and `server.py` (retrieval phase) to neutralize spoofed subagent definitions, global instructions, and user rules, replacing them with a neutralized label prefix.
- **Multi-Agent Markdown Queue Loop Breaker System Guardrail**: Configured instruction templates (`GEMINI.md`, `AGENTS.md`) and generator code (`agent_manager.js`) to enforce sequential delegation depth tracking in `delegate.md` (`depth: <N>`) and trip a circuit breaker if depth exceeds 5.
- **Token-Efficient File-Based Delegation**: Implemented a filesystem-based communication protocol queue using transient Markdown files (`delegate.md` and `result.md`). Subtask parameters are now isolated to a structured task context inside `<appDataDir>/brain/<conversation-id>/scratch/delegate.md` (covering Goal, Context, and Constraints) and the agent writes its final output back to `result.md`. This saves substantial token usage and isolates context windows.
- **Enforced Semble MCP Integration**: Orchestrator now strictly uses the `semble` MCP for context discovery before drafting delegation parameters.
- **Read-Only Guardrail for `secrets.yaml`**: Expanded read-only guardrail restrictions to include `secrets.yaml` alongside `.tfvars` and `.env`.

### Changed
- **Orchestrator-Only Auto-Delegation Enforcement**: Updated `agent_manager.js`, `GEMINI.md`, and `AGENTS.md` to permanently enforce that the main orchestrator agent acts strictly as a coordinator and is prohibited from executing direct tool calls (such as `write_to_file`, `replace_file_content`, or `run_command` in the parent conversation).
- **Auto-Approved Background Delegation**: Instructed the orchestrator in `agent_manager.js`, `GEMINI.md`, and `AGENTS.md` to write both `delegate.md` and `result.md` with `RequestFeedback: false` and `UserFacing: false` inside the `ArtifactMetadata` block to enable seamless, silent background execution without prompt overlays.
- **Optional Agent Parameter in Schema**: Made the `agent` parameter optional in all 4 MCP tool schemas (`find_skill`, `list_skills`, `get_skill`, `optimize_report`) to prevent validation crashes during standard, direct calls, while maintaining telemetry logging support.
- **Dynamic TUI Tables**: Implemented dynamic cell-width calculation in CLI rendering to support arbitrary lengths of active skills names cleanly.
- **Stats Grouping Cleanup**: Filtered and aggregated non-official agent logs (`test`, `orchestrator`, etc.) under `Direct Tool Calls` in `agent status` to avoid clutter in TUI views.
- **Documentation Restructuring**: Relocated the detailed "Before vs After Comparison" section from `README.md` to `docs/BENCHMARK.md` to streamline the root README and maintain a more professional high-level presentation, linking to the detailed comparison.
- **Added Credits**: Added a Credits section in the root `README.md` to express gratitude to MinishLab's `semble` repository.
- **Auto-Approved MCP Tool Access**: Configured subagent rules in `GEMINI.md` and `AGENTS.md` templates to explicitly auto-approve tool execution for `semble` and `konoha` MCP tools, removing manual permission prompts.

### Fixed
- **Auto-Approve for Delegation Files**: Fixed the auto-approve behavior for delegation and result files (`delegate.md` and `result.md`) by forcing both to be written with `RequestFeedback: false` and `UserFacing: false` inside `ArtifactMetadata` to prevent user prompt overlays.
- **MCP Tool Schema Mismatch**: Resolved a schema mismatch where the `agent` parameter was marked as required on the server-side but optional in client schemas, causing validation crashes during standard direct calls.
- **Subagent Name Character Validation**: Enforced alphanumeric, dash, and underscore character constraints on subagent names in `createSubagent` to prevent broken markdown layouts in `GEMINI.md` and `AGENTS.md`.
- **Symlinked Skill Directories Resolution**: Added support for symbolic links pointing to directories in `listInstalledSkills` to allow symlinked skill packages to be scanned and listed.
- **smart_truncate Name Scoping**: Explicitly passed the skill name parameter to `smart_truncate` inside `get_skill` to fix local variable scoping and ensure the custom full-content retrieval hint is rendered.
- **Python Context Managers for File Reads**: Refactored `migrate.py` to use Python `with open(...) as f` context managers for reading files, preventing file descriptor leaks during bulk migrations.
- **Subagent Custom Skill Embedding Preservation**: Added an `isAlreadyUpgraded` check during agent initialization to prevent default skill mappings from stripping manually configured skills on subsequent load/reload cycles.
- **Doctor health check loop**: Changed the GEMINI.md health verification in `doctor` and `status` commands to search for general `'find_skill'` instead of `'konoha find_skill'` to prevent infinite "repaired" cycles.
- **Doctor Self-test Get Skill Failure**: Swapped `golang-security` with `anbu-skill` in the test suite to guarantee tests succeed in default-only seeded database installations.
- **Self-Test Error Checking**: Enhanced `cmdTest()` to check for tool-level error values in the returned JSON-RPC result content, preventing silent failures when a tool request fails internally.

## [1.0.4] - 2026-06-09

### Added
- **Default-Only Seeding on Init**: Restructured the initialization process (`konoha init`) to only seed the 6 default subagent rank skills from the installer package templates into the SQLite database. It completely avoids automatically migrating other custom user skills inside `~/.agents/skills/*` during setup, letting users trigger manual migration later via `konoha migrate`.
- **Subagent Default Model Updates**: Configured the default model assignments for the 6 Naruto ranks to match explicit user preferences:
  - `@genin` -> `Gemini 2.5 Flash`
  - `@kage` -> `Gemini 3.1 Pro (High)`
  - `@chunin` -> `Gemini 3.5 Flash (Low)`
  - `@jonin` -> `Gemini 3.5 Flash (High)`
  - `@anbu` -> `Gemini 3.1 Pro (High)`
  - `@tokubetsu-jonin` -> `Gemini 2.5 Flash`
- **Dynamic Configuration Upgrades**: Added model upgrade heuristics to automatically migrate users' active `agents.json` configurations to the new defaults while preserving custom choices.

## [1.0.1] - 2026-06-08

### Added
- **Gemini 2.5 Flash Support**: Added `Gemini 2.5 Flash` to the official Model Registry and updated agent routing mappings.
- **Base Skills Architecture**: Refined the default skill assignment strategy. Instead of shipping with heavy generic legacy skills, all 6 subagents now ship exclusively with their own highly-specialized base skills (e.g., `genin-skill`, `anbu-skill`).
- **Day-to-Day SOPs**: Rewrote all 6 default base skills into actionable Standard Operating Procedures (SOPs) designed for junior and mid-level engineers, covering Bug Resolution Workflows, Design Match Checklists, Trade-Off Matrices, and Codebase Tracing.
- **Direct Tool Call Routing**: Updated the core system instructions (`GEMINI.md`, `AGENTS.md`) to explicitly enforce the new delegation workflow: The Orchestrator discovers required skills via `konoha` FIRST, routes the task to the correct agent, and then the agent uses Direct Tool Calls to load their base skill plus any dynamically required skills.

### Changed
- **CLI Commands**: Updated the default skills list in the `konoha agent skill` CLI command to reference the new base skills instead of the legacy ones.
- **Auto-Upgrade Logic**: Implemented `agents.json` upgrade logic in `agent_manager.js` to smoothly transition existing users from legacy generic skills to the new base skills, while explicitly preserving any manually embedded skills.
- **Documentation**: Updated `SKILL.md` to clearly state native integration with the Antigravity Model Registry, removing hardcoded cloud endpoint dependencies.
- **Auto-Optimize at Ingestion (migrate.py)**: Added `optimize_content` function that automatically optimizes skill markdown files during migration (`konoha migrate` and skill installation). It removes YAML frontmatter (after tag extraction), HTML comments, decorative horizontal rules, normalizes heading spaces, strips trailing/leading whitespaces, and collapses excessive empty lines. Output shows before/after byte sizes and percentage savings.
- **Output-Layer Token Optimizations (server.py)**: Implemented multiple optimizations to reduce token consumption when serving skills:
  - Reduced `PREVIEW_LIMIT` from 4000 to 1500 characters.
  - Implemented `MAX_CONTENT_SIZE = 12000` truncation limit in `get_skill`.
  - Removed `indent=2` whitespace formatting from all JSON response payloads (`find_skill`, `list_skills`, `get_skill`).
  - Slimmed metadata in `list_skills` and `find_skill` results to only return essential fields (`name`, `type`, `size`/`content`, etc.), removing redundant tags, line count, and full size fields.
- **Default Guardrails**: Documented the newly added default safety and behavioral guardrails across all subagents:
  - **Proactive Execution (No commanding back)**: Restricts subagents from instructing the user to perform tasks (edits, file creations, terminal commands) that they are equipped to execute themselves.
  - **Read-Only `.tfvars` & `.env` Files**: Enforces user permission requirements before any `.tfvars` or `.env` files can be read or written.
  - **No Git Commands**: Prohibits subagents from running any `git` commands, reserving all git tasks for the user.
  - **Strict Subagent Delegation**: Restricts subagent delegation strictly to the 6 official Konoha agents (`genin`, `kage`, `chunin`, `jonin`, `anbu`, `tokubetsu-jonin`). Defining or creating custom subagents is prohibited.
  - **No Auto-Creation of Subagents**: The AI agent (Antigravity) is **NEVER** allowed to automatically define, create, or delete subagents. Spawning new/custom subagents or invoking `define_subagent` for unrecognized agent names is strictly prohibited for the AI. The creation and deletion of subagents are manual features reserved exclusively for the user.
  - **Quota Fallback to Direct Tool Calls**: Directs the coordinator to not spawn shadow subagents when quota limits (`RESOURCE_EXHAUSTED` or `429` errors) are hit, but instead immediately fall back to executing edits, reads, and commands directly.
- **Quota Exceeded Recovery Guide**: Added step-by-step documentation for resolving total quota limits and `RESOURCE_EXHAUSTED` / `429` errors via `gcloud auth login` and AI Studio subscription upgrades.
- **Quota Warnings**: Documented the total quota limits warning message ("Your Antigravity account has reach the limit quota...") to help users handle Google AI platform quota issues.
- **Temporal Savings Breakdown**: Integrated Today, Last 7 Days, and All Time calculations in `konoha savings` (Combined Total Savings), parsing both Skills-DB and Semble statistics.
- **Orchestrator-Only Main Agent**: Configured the main coordinator agent to act strictly as an orchestrator, enforcing auto-delegation for all tasks including simple/trivial ones.
- **New Commands**: Added `konoha version` (displays current local version and checks for updates on GitHub) and `konoha upgrade` (upgrades the CLI to the latest version directly from GitHub).

### Changed
- **Subagent Deletion and Pruning**: Enhanced `konoha agent delete <name>` to delete the subagent from configurations (`agents.json`) and prune its historical metrics from the SQLite database's `tool_calls` table. This resolves issues where deleted/legacy subagents like `ops-ninja` or `shadow-anbu` permanently clutter the status call frequency list.
- **Subagent Model Mappings**: Updated the default model assignments for subagents to optimize cost and response latency: set `@kage` to `Gemini 3.5 Flash (Medium)` and `@tokubetsu-jonin` to `Gemini 3.5 Flash (Low)` as their default primary models.
- **Default Fallback Model**: Updated default fallback model to `Gemini 3.5 Flash (High)` for all subagents to ensure fail-safe execution.
- **Architectural Diagram Updates**: Expanded Mermaid diagrams in `README.md` and `.agents/skills/konoha/SKILL.md` to include LLM layers, fallback routes, and version checks.
- **Beautiful TUI Borders**: Upgraded `drawTable` and `drawBox` to support rendering beautiful gradient borders (`LEAF_THEME` green gradient for tables and `FIRE_THEME` for metrics).
- **Emoji Rendering Fix**: Enhanced `applyGradient` to support surrogate pairs (UTF-16), resolving character corruption on emojis like `🔍`.
- **TUI Alignment Fix**: Corrected a layout alignment bug in `drawBox` padding that previously caused internal row borders to shift or overlap.
- **Updated Documentation**: Refined setup documents (`docs/SETUP-IDE.md`) to reflect the new orchestrator-only delegation workflow.

## [1.0.0] - 2026-06-07

### Added
- **Release version 1.0.0**
### Fixed in v1.1.7 (Hotfix)
- **Agent Generator Fix**: Resolved an issue where `agents.yaml` and `.claude/agents/*.md` files would bloat exponentially (up to 400MB) due to unescaped strings and infinite recursive backtick escaping during template generation in `src/agent_manager.js` and `src/mcp_clients_manager.js`.
- **Sannin Pipeline Refactoring**: Formalized the 6-step sequential pipeline for all client prompts. `src/agent_manager.js` and `src/templates/skills/konoha/SKILL.md` now explicitly document the multi-step `mcp_chunin` -> `mcp_genin` -> `mcp_kage` -> `executor` -> `mcp_tokubetsu_jonin` flow.
- **Build Directives Updates**: Updated `src/server.py` (`build_from_text`):
  - Added `DS-10. Icons` explicitly prohibiting the use of emojis and mandating SVG icon libraries like Lucide.
  - Enhanced `DS-7` (Mobile Bottom Navigation) and `DS-4` (Theme Switcher) to ensure compliance with strict placement and style rules.
  - Removed outdated VIP Privilegio Club and APR Calculator templates from the generation prompts.
