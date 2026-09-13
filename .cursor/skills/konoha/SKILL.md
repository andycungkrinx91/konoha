---
name: konoha
description: Guidelines and instructions for maintaining, extending, and debugging the Konoha MCP Tools Orchestrator, MCP middleware, and multi-archetype website builder across 7 coding clients (Antigravity IDE/CLI, Cursor, Claude Code, OpenCode, Command Code, Codex, Pi/pi.dev).
---

# 🍃 Konoha Maintenance & Engineering Skill

Comprehensive operational guide for maintaining, extending, and debugging the **Konoha MCP Tools Orchestrator**, SQLite FTS5 indexer, and multi-archetype website generation engine.

---

## 🏛️ System Architecture Overview

Konoha operates as a high-efficiency MCP orchestrator designed to reduce context token consumption by 83–98% across 7 AI coding clients:
- **Antigravity IDE/CLI** (`~/.gemini/config/mcp_config.json`, hooks)
- **Cursor IDE/CLI** (`~/.cursor/mcp.json`, `.cursor/rules/`)
- **Claude Code** (`~/.claude.json`)
- **OpenCode** (`~/.config/opencode/opencode.json`)
- **Command Code** (`~/.commandcode/mcp.json`)
- **Codex** (`~/.codex/config.toml`, `~/.codex/AGENTS.md`)
- **Pi (pi.dev)** (`~/.pi/agent/mcp.json` via the `pi-mcp-adapter` extension)

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
- **Pure Light Mode**: 10 curated Light Mode gradient themes (`byakugan`, `chidori`, `konoha-leaf`, `rasengan`, `sharingan`, `hokage-gold`, `anbu-shadow`, `sage-mode`, `sound-village`, `akatsuki`).
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
- Scaffolding MUST include the framework's Phosphor Icons package (`@phosphor-icons/react` / `@phosphor-icons/svelte` / `@phosphor-icons/web`) or hand-exported inline SVG icon components. NEVER install any Lucide package (`lucide-react`, `lucide-svelte`, `lucide-vue-next`, `lucide-angular`) — Lucide is a named AI-scaffold fingerprint. Include `clsx` only when a class-merge helper is genuinely needed.
- Do not claim completion until `pnpm run build` and `pnpm run lint` pass cleanly with **0 errors and 0 warnings**.

### 7b. Human-Built Fingerprint Standards (PLAN_HUMAN_BUILT.md)
These standards apply to every build mode (`build_from_text`, clone-url flows, `build_from_source`) across all 4 frameworks so generated sites score "Human-Built" (0–20) on AI-website detectors instead of "AI-Assisted Build" (40+):
- **No generator meta tags**: NEVER emit `<meta name="generator">` or any build-tool/framework version identifier in HTML output — strip it in the head/layout config if the scaffold injects one.
- **No AI-tool comments**: shipped HTML/CSS/JS must contain no comments referencing AI tools, model names, "Generated by", scaffold commands, or tool attributions. Audit the production build output before delivery.
- **Custom assets**: hand-craft favicon, OG image, and 404/error page with non-generic filenames (never `hero.webp`, `og-image.png`, `icon-1.svg`, scaffold-default names) — name them after the project brand.
- **Icons**: Phosphor Icons or hand-exported inline SVGs only — never Lucide (see §7).
- **No platform attribution badges** or "Deployed on X" links; keep the Build by Konoha footer credit exactly as-is.
- **Hosting (advisory)**: when the user controls hosting, prefer self-hosted Node, Cloudflare Pages, or a VPS over Vercel/Netlify — Vercel/Netlify is itself scored as an AI-app-deployment signal.
- **Per-framework styling fingerprints**:
  - *Next.js*: hand-modified fully custom Tailwind theme (custom spacing/colors/radii/fonts, no stock scale); no shadcn/ui API shapes — own primitives under `components/primitives`, never `components/ui`.
  - *SvelteKit*: no Tailwind at all — scoped `<style>` blocks + one hand-written global stylesheet; no shadcn-svelte or Skeleton.
  - *Nuxt*: no `@nuxtjs/tailwindcss` defaults, no Nuxt UI / Nuxt UI Pro — fully custom hand-written Tailwind theme or hand-written CSS/SCSS; minimal `nuxt.config`.
  - *Angular*: hand-written SCSS instead of Tailwind (natural fit for the ecosystem).
- **Source fidelity exception**: in `build_from_source` (and clone-url replication), source fidelity wins — apply the fingerprint standards to anything NEW you introduce, and hand-export source icons as inline SVGs instead of adding an icon package dependency.

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
3. **Bridge Extension Sync & CLI Distribution (Antigravity IDE ONLY)**:
   - On fresh installation (`konoha init`) and upgrade (`konoha upgrade`), `https://github.com/andycungkrinx91/konoha-bridge` is cloned from live `master`, packaged into `konoha-bridge-1.4.0.vsix` via `@vscode/vsce package`, and installed ONLY into Antigravity IDE (`antigravity --install-extension`). The VSIX is NEVER installed into any other IDE (no `code --install-extension`, no `cursor --install-extension`). When Antigravity IDE is present, an atomic directory sync into `~/.antigravity-ide/extensions/andycungkrinx91.konoha-bridge-master-universal/` is also performed with `extensions.json` registration. Fallback VSIX is bundled in `assets/konoha-bridge-1.4.0.vsix`.
4. **Rule Synchronization**:
   - Whenever a new rule or invariant is introduced, ensure it is added to `src/agent_manager.js`, `src/cursor_manager.js`, `src/opencode_manager.js`, `src/codex_manager.js`, `.agents/skills/konoha/SKILL.md`, and `src/templates/skills/konoha/SKILL.md`.
5. **Database Migration**:
   - Run `node bin/cli.js migrate` to re-seed all skills and reference documents into the SQLite FTS5 database (`~/.konoha/konoha.db` — legacy `skills.db` is auto-migrated on first open).
6. **Cross-Client Initialization**:
   - Run `node bin/cli.js init --yes --force` to deploy updated MCP configurations, subagent instructions, and RTK rules across all 7 clients.
7. **Automated Verification & Quality Gate**:
   - Ensure `node tests/test_docs_currency.js` and **all discovered tests pass** with 0 failures before release.
8. **Auto-Compaction & Idle-Reset Invariants**:
   - `SESSION_TURNS` in `src/server.js` implements a 30-minute idle reset (`SESSION_IDLE_RESET_SECONDS = 30 * 60`) preventing cross-session turn leakage.
   - On compact turns (`turn >= 2`), the primary skill SOP preview (250 chars) is ALWAYS included (`skills_content`) so fix agents never lose their methodology.
   - Persona instructions are truncated at sentence boundaries to 1200 chars; agent constraints to 600 chars (never hard-cut mid-step).
   - Compact prompts include the anti-goal-drift directive enforcing original task authority.
9. **Prompt History & Append-Only Hook**:
   - `src/prompt_hook.js` is strictly append-only. New inputs are recorded as timestamped `## Follow-up N` sections under `# Session Prompts`.
   - `## Original Task` remains permanently authoritative; short follow-ups (e.g. new console errors) must never replace or erase the original task.
10. **Evidence-Based Validation Gate in `report_from_agent`**:
    - `report_from_agent` enforces regex assessment (`_assess_validation_evidence`) checking for real passing command markers (`exit code 0`, `passed`, `0 errors`).
11. **Zero-AI-Slop Pre-Gate & `aislop` MCP Integration**:
    - Multi-client registration of `aislop` MCP across all 7 clients (`antigravity`, `cursor`, `claude`, `commandcode`, `opencode`, `codex`, `pi`).
    - Role boundaries: Genin and Kage are strictly read-only (`aislop_scan`, `aislop_why`); execution agents Jonin and Anbu have access to `aislop_fix` to remediate slop.
    - Kage Review Pre-Gate & Minimum Confidence Gate: requires `ai_slop_clean: true` and `ai_slop_findings: 0` in `kage_review.json` before confidence scoring, and requires overall and per-category confidence Minimum Required: ≥ 97% to approve workflow delivery.
12. **Authorized Penetration Testing & Security Diagnostics in Dev/Local Environments**:
    - Anbu is authorized to conduct penetration testing and vulnerability assessments in local/development targets (`localhost`, `127.0.0.1`, dev containers, local clusters).
    - Workflow review gate utilizes pentest-aware validation (`isPentestTask`, `isCleanValidation` in `src/mcp/workflow.js`) allowing diagnostic exploit checks and HTTP error responses without false rejection, while strictly prohibiting unhandled fatal crash exceptions.
    - Reports without verifiable evidence are automatically downgraded to `status: "unverified"`.
11. **Learnings & Memory Hygiene**:
    - Unverified task learnings are never persisted to episodic memory.
    - `memoryContentExists()` in `src/persona_memory.js` prevents duplicate or corrupted memories from polluting subsequent agent contexts.
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
    - `src/file_tools_router.js` and `src/runtime_state.js` enforce `isIdeInstallationDirectory`. Any attempt to inspect or scan IDE binary folders (`Antigravity IDE.exe`, `dxcompiler.dll`, `resources.pak`, `vulkan-1.dll`, etc.) is strictly forbidden.
    - `detectWorkspaceRoot()` auto-resolves the active project directory from `WORKSPACE_ROOT`, `KONOHA_WORKSPACE`, session metadata (`last_conversations.json`, `projects.json`), and transcripts, falling back safely to user home instead of IDE program folders.
16. **Single Database Access Layer & Hybrid Multilingual Vector Search Invariants**:
    - `src/db.js` is the single canonical source of truth for `DB_PATH` (`~/.konoha/konoha.db`), SQLite WAL mode, foreign keys, busy timeout (`5000ms`), and unified DDL schema (`setupSchema`). Never declare separate local DB paths or duplicate table definitions.
    - `src/vector_search.js` provides semantic search using IBM Granite 97M Multilingual ONNX (`onnx-community/granite-embedding-97m-multilingual-r2-ONNX`, 384-dim, CLS pooling, L2 normalization) and BAAI/bge-reranker-base reranking, running natively via `@huggingface/transformers`.
    - The `sqlite-vector` extension is lazily loaded per connection; extension loading failure falls back gracefully to in-process cosine scan and FTS5.
    - Hybrid search is gated behind `KONOHA_SEMANTIC_SEARCH` (**enabled by default**; set `KONOHA_SEMANTIC_SEARCH=0` to disable for zero-config lightweight operation).
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
20. **Interactive CLI Progress Bar & 7-Stage Upgrade Pipeline**:
    - `KonohaProgressBar` in `bin/cli.js`: provides smooth interactive CLI animation with progress meter `[████████░░] 80% (stage/total) [Stage Name] | Live action text`, elapsed time counter, TTY carriage return (`\r\x1b[2K`), non-TTY fallback milestone logger, and background ticker timer unreferencing (`timer.unref()`) to prevent hanging parent processes on Windows and CI environments.
    - 7-Stage Upgrade Workflow in `cmdUpgrade`: Environment Verification & Diagnostics (1/7), Package Manager Update (2/7), Global CLI Symlinks (3/7), Skill & Agent Registry Sync (4/7), Core Configuration Regeneration (5/7), Client Integration & IDE Bridges (6/7), and Verification & Self-Healing (7/7).
    - `cmdInit(args, options = {})` accepts `onProgress(percent, label, action)` and `onStepComplete(percent, label)` callbacks for granular multi-step progress reporting during both upgrade and initialization.
21. **Cross-Platform Windows Subprocess & Gateway Isolation Invariants**:
    - `testEnv` isolation: always sanitize `delete testEnv.KONOHA_DAEMON` when running tests or MCP server child processes from `bin/cli.js test` or test scripts so the child process does not attempt to bind the local proxy gateway or conflict on port 20000.
    - Legacy Python launcher helpers: `src/platform_utils.js` retains `detectPythonOrDefault()` / `spawnPythonSync()` from the pre-beta.7 dual-runtime era; they remain exported for compatibility but sit on no active execution path (Pure Node.js, rule 33).
    - Path normalizer & trailing slash hygiene: `src/file_tools_router.js` and `src/file_tools/token_efficient_grep.js` normalize backslashes to forward slashes and strip trailing path separators (`/` and `\`) to prevent Windows command line quoting issues (e.g., `\"` escape corruption).
    - Detached error handlers: `src/file_tools_mcp.js` handles child process spawning errors gracefully with safe `error` and `exit` listeners.
    - Pre-bundled VSIX prioritization: `autoInstallKonohaBridgeExtension` checks for pre-bundled `.vsix` packages in `bin/lib/` before attempting remote `git clone` or network builds, preventing Windows terminal freezes and timeouts.
22. **`aislop` MCP Client Configuration & Package Resolution Contract**:
    - All 7 client configurations (`src/codex_manager.js`, `src/cursor_bootstrap.js`, `src/opencode_manager.js`, `src/mcp_clients_manager.js`, `src/pi_manager.js`, `bin/cli.js`) use `args: ["-y", "-p", "aislop", "aislop-mcp"]` with `npx` (or `npx.cmd` on Windows via `getNpxCommand()`).
    - Resolves npm 404 errors caused by non-existent standalone packages (`aislop-mcp`) by explicitly specifying the package name `aislop` via `-p` and the binary `aislop-mcp`.
    - Codex configuration (`~/.codex/config.toml`) uses `command = "npx"` and `args = ["-y", "-p", "aislop", "aislop-mcp"]` to maintain protocol handshake compatibility and eliminate connection closed errors during MCP startup.
23. **Cross-IDE Auto-Approval & Tool Permissions Matrix**:
    - **Antigravity IDE & CLI**: Configures `~/.gemini/config/mcp_config.json` with `autoApprove: ["*"]` and `auto_approve: true` across `konoha`, `semble`, and `aislop`. Injects `autoApprove: ["*"]`, `permissionMode: "allowAll"`, and explicit tool grants into `settings.json` in `antigravity-cli`, `antigravity-ide`, `config`, and root `~/.gemini`.
    - **Cursor IDE & CLI**: `src/cursor_manager.js` and `src/cursor_bootstrap.js` deploy `autoApprove: ["*"]` and `auto_approve: true` to `~/.cursor/mcp.json`. Injects `cursor.mcp.autoApprove: ["*"]`, `cursor.mcp.allowAll: true`, `cursor.agent.autoApprove: true`, and grants (`Mcp(konoha, *)`, `Mcp(semble, *)`, `Mcp(aislop, *)`) across `~/.cursor/cli-config.json`, `~/.cursor/settings.json`, and cross-platform User settings (`~/.config/Cursor/User/settings.json`, `%APPDATA%/Cursor/User/settings.json`, and macOS Application Support).
    - **Claude Code & Command Code**: Injects `mcp__konoha__*`, `mcp__semble__*`, and `mcp__aislop__*` into `autoApprove` and `permissions.allow`, with `permissionMode: "bypassPermissions"` (Claude) and `"allowAll"` (Command Code) in `settings.json`. A **workflow reminder** hook (`~/.konoha/workflow_reminder.js`) is registered on `UserPromptSubmit` + `SessionStart` (`resume|compact|clear`) for Claude Code, and on Command Code's `SessionStart` (startup/resume/clear — Command Code has no per-prompt event; the reminder emits the `hookSpecificOutput.additionalContext` JSON envelope), re-injecting the Konoha workflow into resumed/compacted sessions where the original contract would be buried in history.
    - **OpenCode & Codex**: OpenCode V1 enforces singular `permission: { read: "allow", edit: "allow", bash: "allow", ... }` and `permissionMode: "allowAll"`. Codex enforces `approval_mode = "auto"` across every tool definition for `konoha`, `semble`, and `aislop` in `~/.codex/config.toml`.
    - **Pi (pi.dev)**: MCP servers are provided by the `pi-mcp-adapter` extension (`pi install npm:pi-mcp-adapter`); server entries are merged into the Pi-owned global override `~/.pi/agent/mcp.json` (never shared/project configs). Pi's adapter routes all tools through its token-efficient `mcp` proxy by default, aligning with Konoha's token-reduction philosophy; per-tool approval is available via the adapter's `approveTools` glob settings. RTK is deployed via the official integration (`rtk init -g --agent pi`), which installs the `~/.pi/agent/extensions/rtk.ts` TypeScript extension that intercepts tool calls. The Konoha runtime contract + Pi Workflow Mandate are deployed as a managed block in `~/.pi/agent/AGENTS.md` (Pi's global context file) so Pi routes through the sannin workflow instead of free-running; Pi's duplicate-skill startup warnings are expected (global + project mirror resolution, project-first) and resolved via the contract's konoha-MCP-first directive.
    - **Hard Guardrail Enforcement (beta.7)**: The destructive-command, git-safety, secret-protection, and MCP read-bypass guardrails are enforced at the tool-call level by a shared self-contained engine — `src/guardrails.js` (`checkCommandGuardrails(command)` / `buildGuardrailCheckerSource()`), deployed flat to `~/.konoha/guardrails.js` (added to `filesToCopy`, `refreshFiles`, the dedicated hook deploy block, and the doctor `checkAndRepairFile` set in `bin/cli.js`). Enforcement points: Claude Code `registerClaudeCodeBashGuard()` writes `~/.local/bin/konoha-bash-guard.js` (PreToolUse `^Bash$` matcher, checker inlined via `JSON.stringify(buildGuardrailCheckerSource())` + `new Function`); Command Code `buildCommandCodeBlockerSource()` extends `konoha-native-blocker-cc.js` to guard `shell_command`/`bash`/`shell` tool calls (defensive command extraction from `tool_input.command`/`cmd`, `input.command`/`cmd`) in addition to `read_file`; Antigravity `src/antigravity_tool_sanitize_hook.js` DENY-3 runs the full shared check on `run_command` via `require('./guardrails')` (first-word blocklist fallback if the module is missing); Pi `buildPiBlockerExtensionSource()` embeds the checker in `konoha-blocker.ts` and enforces it on `bash`/`bash_command` tool calls. Codex/Cursor/OpenCode are prompt-only (no blocking hooks). The checker must stay SELF-CONTAINED (no outer-scope identifiers) — managers inline `buildGuardrailCheckerSource()` verbatim, and `JSON.stringify` output is safe inside template literals (never produces backticks or `${`).
24. **Command Normalization Invariant (`normalizeCommand`)**:
    - Multi-part launcher normalization: never pass a multi-token command string (e.g. `'py -3'`) directly to `child_process.spawnSync`/`spawn` — it is treated as a single binary filename and throws `ENOENT`.
    - Centralized normalization: use `normalizeCommand(command)` from `src/platform_utils.js`, which returns `{ executable, prefixArgs }`; prepend `prefixArgs` to child process arguments (this pattern is used by `src/codex_manager.js` for the Codex MCP entry).
    - Historical note: the dedicated Python helpers (`spawnPythonSync`/`spawnPython`) from the pre-beta.7 dual-runtime era were removed by the Pure Node.js migration (rule 33); normalize any newly added launcher command through `normalizeCommand` instead.
25. **Skill Embedding & Subagent Management Invariants (`konoha skill <skill> embed <agent>`)**:
    - Dual Syntax Support: Both `konoha skill <skillname> embed <agentname>` and `konoha skill embed <skillname> <agentname>` (as well as `unembed` counterparts) are fully supported.
    - Single-Argument Skill Add: `konoha skill add <skillname>` searches the public skills registry (skills.sh) for `<skillname>` and automatically installs it from its GitHub source repository, or scaffolds a custom local skill directory if offline/not found.
    - Non-Interactive Graceful Mode: `konoha agent skill <agentname>` outputs clean status tables in non-interactive / redirected stdin environments instead of aborting, and supports direct embedding via `konoha agent skill <agentname> <skillname>`.
    - SQLite & Cache Persistence: Agent skill mutations are persisted directly via `--bulk-import` to the SQLite database `~/.konoha/konoha.db` and synchronized to `~/.agents/agents.yaml`, with instant cache invalidation ensuring consistent multi-process reads.
26. **Windows Extended Path (`\\?\`) Normalization & Stdin IPC Transport Invariants**:
    - Universal Prefix Stripping: `stripWinExtendedPrefix(p)` in `src/platform_utils.js` strips `\\?\UNC\`, `\\?\`, `//?/UNC/`, `//?/`, `\??\UNC\`, and `\??\` before normalization or path comparison (also applied in `src/mcp/runtime_state.js:uriToPath`, which now preserves UNC hosts in `file://server/share` URIs).
    - Path Boundary Safety: `src/file_tools_router.js` normalizes backslashes to forward slashes and strips trailing path separators (`/` and `\`) to prevent Windows command line quoting issues, and enforces the workspace jail via `assertWithinAllowed`.
    - Documentation Skip Guard: `SKIP_DIR_NAMES` skips `references/`, `.turbo`, `.cache`, `site-packages`, and `third_party` to prevent scanning 4,700+ markdown files during code search.
27. **Token-Efficient Build Specifications & Savings Telemetry Invariants (83%–98% Target)**:
    - SOP Previews in Build Tools: `loadSkillContentForBuild()` in `src/mcp/build_spec.js` embeds concise SOP previews (≤400 chars) with on-demand pointers (`konoha.get_skill`) instead of dumping 90 KB raw markdown into `build_from_text` and `build_from_source`, keeping payloads under 16 KB (an 85.2% token reduction saving ~22,000 tokens per build request).
    - Compact JSON Serialization: Emits compact JSON (`JSON.stringify(spec)`) without redundant whitespace or multi-line formatting.
    - Telemetry Baselines: `log_tool_call()` credits build tools and subagent delegations (`sannin`, `kage`, `jonin`, `anbu`, `chunin`, `tokubetsu_jonin`, `genin`) against the 550KB skill library baseline, with directory baselines for `find_files_clean` (250KB) and `token_efficient_grep` (150KB), ensuring combined retrieval savings reliably report 92%–98%.
28. **Sub-Second CLI Fast Path & Transcript Caching Invariants**:
    - Auto-Setup Fast Path: `ensureAutoSetup()` caches verification state in `~/.konoha/.auto_setup_state.json` (version + `agents.yaml` mtime), returning in <2ms on existing healthy installations instead of re-copying files and re-syncing across 7 clients on every command invocation.
    - Mtime-Based Transcript Caching: `calculateAllModelTokens()` in `src/db_savings.js` caches all-time token metrics in `~/.konoha/transcript_cache.json` for transcript files older than 7 days, avoiding redundant disk I/O across hundreds of historical session logs and speeding up `konoha savings` from ~3.0s down to ~350ms.
    - Direct Semble Execution: `cmdSavings()` queries local `semble` first, avoiding slow `uvx --from ...@latest` network requests to PyPI.
    - GitHub Release Cache: `getLatestVersion()` caches GitHub tag/release queries in `.version_cache.json` for 1 hour.
29. **Progressive Migration Fallback Chain & Deferred Reference Indexing Invariants**:
    - Stage 5 Fallback Chain: `cmdInit` Stage 5 escalates through three attempts on migrate failure — (1) full migration, (2) unconditional retry with `--skip-embeddings` (never gated on whether the flag was already present), (3) `--skills-only --skip-embeddings` with a 120s timeout. The SQLite schema verification (`verifySkillDatabaseContract` + `sqlite_master` table check) is the sole completion gate; `process.exit(1)` is reserved for genuine schema failures, never timeouts.
    - `--skills-only` Migration Mode: `src/migrate.js --skills-only` migrates only `SKILL.md` entries (type='skill'), deferring `references/*.md` and root reference files with explicit `⏭ References deferred: N files skipped` output. Deferred references complete on the next `konoha migrate` or via on-demand indexing.
    - Migration Time Budget: `KONOHA_MIGRATE_TIME_BUDGET` (default 150s, `0` disables) enforces a wall-clock budget (`Date.now()` delta) on the migration loop. Required skills (`--require-skill`, e.g. `genin-skill`) are always sorted first so the budget can never defer them; budget exhaustion defers remaining skills with `⏭ Time budget reached` and exits 0.
    - Full Coverage: The same escalation applies to the auto-setup bootstrap (missing `konoha.db`), `cmdDoctor` database repair, and all three `cmdMigrate` branches. `konoha migrate` never hard-exits on timeout — it warns `Run "konoha migrate" again to finish remaining references.` and exits 0.
30. **Foreign-Key-Safe Skill Deletion & Client-Isolated Attribution Testing Invariants**:
    - Dependent-Rows-First Deletion: Any `DELETE FROM skills` (parent) must be preceded by deletion of dependent `skill_chunks` rows (`skill_chunks.skill_name REFERENCES skills(name)` with `PRAGMA foreign_keys=ON` in `src/db.js`). Both `src/migrate.js` and `src/server.js` enforce this at every delete site; never delete parent skill rows without cleaning chunks first, or `auto_migrate_project_skills` transactions abort with `FOREIGN KEY constraint failed`.
    - Attribution Test Isolation: Client-detection tests must set the `ACTIVE_CLIENT` environment override (e.g. `ACTIVE_CLIENT=cursor`) when spawning the deployed server, because `detect_active_client()` inspects the `/proc/<ppid>/cmdline` process hierarchy and classifies the test runner's parent client session as active — excluding the target client's transcripts from scanning.
31. **Unicode-Accurate TUI Width & Animated Spinner Invariants (v2.0.0-beta.6)**:
    - Terminal Cell Width Accounting: `getVisualLength()` in `bin/cli.js` counts emoji-presentation BMP symbols and East Asian Wide/Fullwidth ranges (CJK ideographs U+4E00-U+9FFF and U+3400-U+4DBF, Hangul U+AC00-U+D7A3, kana, fullwidth forms U+FF01-U+FF60) as **2 columns**, matching modern terminal renderers. Any new table-rendering code MUST use `getVisualLength()`/`truncateVisual()` instead of `String.length` — mixing them reintroduces column overlap.
    - ANSI-Safe Truncation: `truncateVisual()` strips ANSI escape sequences before measuring and cutting; never slice colored strings directly or dangling color codes bleed into adjacent columns.
    - Animated Spinner Contract: `startSpinner()` renders a 10-frame braille spinner (90ms interval) **only on TTY**; pipes, CI, and `NO_COLOR` automatically receive the static `>`-style output. Opt-out via `KONOHA_SPINNERS=0`. Spinner intervals are cleared deterministically on completion.
    - Worker `dev_root` Resolution: File tools workers under `src/file_tools_router.js` resolve the repo root from their location upward, covering both in-repo and deployed `~/.konoha` execution — preventing false "Path outside allowed roots" rejections. Workspace jail semantics for user-supplied paths remain unchanged.
32. **Defensive Subagent YAML Schema & CLI Latency Optimization Invariants (v2.0.0-beta.6)**:
    - Empty Scalar YAML Parsing: `yaml_utils.js` and `agent_manager.js` treat trailing unindented sibling keys as new top-level mapping keys rather than object values for preceding empty scalar keys (e.g. `instructions:` followed by `tools:` on the next line). Instructions must always evaluate to string (`""`), and defensive string normalization (`typeof inst === 'string' ? inst : ''`) protects all subagent inspection paths.
    - Memoized Reference Check: `needsReferenceLoadingUpgrade()` guards against infinite multi-client deployment loops by strictly checking `defInst.includes('exact reference names')`.
    - Direct YAML Fast-Path: `loadAgents()` uses in-process YAML parsing instead of expensive child-process spawning (`list-compact`), dropping CLI invocation latency from 7.7s down to 0.28s.
    - Global Binary Protection: `cmdUpgrade` never deletes the global binary before new installation, and executes post-upgrade global symlink reconciliation.
33. **Pure Node.js Single-Runtime & Protocol Stream Isolation Invariants (v2.0.0-beta.7)**:
    - 100% Pure Node.js Single-Runtime: Complete elimination of Python 3 runtime and dependencies. All 42 MCP tools, 18 CLI commands, 7 ninja subagents, and 7 client integrations run natively on Node.js (v18–v26). Zero Python processes are spawned at runtime, and zero `.py` files remain in active execution paths.
    - Native ONNX Embeddings & Vector Search: IBM Granite 97M Multilingual ONNX neural embeddings (`onnx-community/granite-embedding-97m-multilingual-r2-ONNX` via `@huggingface/transformers`) and BAAI/bge-reranker-base run directly in-process in `src/vector_search.js`, caching models under `~/.konoha/models/` and achieving ±0.0001 cosine similarity parity with PyTorch baselines.
    - Protocol Stream Isolation & Zero STDOUT Pollution: Under MCP stdio mode, `process.stdout` is strictly reserved for JSON-RPC messages (`{"jsonrpc":"2.0",...}`). Any non-JSON text on STDOUT corrupts the protocol stream and causes host disconnects (`signal: terminated`). All diagnostics, background progress indicators, and auto-migration logs (`src/migrate.js`, `src/server.js`) MUST be routed strictly to `process.stderr`.
    - Native Bounded File Tools & SQLite WAL: Bounded file tools in `src/file_tools_router.js` and `src/file_tools/` enforce memory bounds and directory jail confinement natively in JavaScript. All database managers (`src/db.js`, `src/db_agents.js`, `src/db_bridges.js`, `src/db_savings.js`, `src/db_stats.js`, `src/persona_memory.js`) use `better-sqlite3` with Write-Ahead Logging and FTS5 query token sanitization.
34. **Web UI Full TUI Parity & SvelteKit 3 RC Monorepo Invariants (v2.0.0-beta.7)**:
    - SvelteKit 3 (RC) + Svelte 5 Monorepo: Frontend runs on `@sveltejs/kit` 3.0.0-next.27 + `@sveltejs/vite-plugin-svelte` 7 + `@sveltejs/adapter-node` 6.0.0-next.12 (Vite 8/Rolldown), built into `apps/web/build`. Root `package.json` includes `prepack` and postinstall automation so fresh installations ship with a pre-built web application, ready for immediate startup via `konoha web` or background daemon `konoha ui start`.
    - SK3 Configuration Location: `svelte.config.js` no longer exists — the adapter and all SvelteKit options are passed directly to the `sveltekit()` Vite plugin in `apps/web/vite.config.js`. The `$lib` alias is replaced by Node subpath imports: `package.json` declares `"imports": { "#lib/*": "./src/lib/*" }` and all imports use `#lib/<file>.js` (extension required).
    - Complete TUI Parity: Visual interfaces for Persona Memory (`/persona`), Project Context Memory (`/context`), Tool-by-Tool Token Savings Breakdown (`/savings`), Full Skills Management (`/skills` — create, embed, unembed, delete, reindex), Bridge Gateway Management (`/bridges` — daemon start/stop/restart, port telemetry, served models inspector), SearXNG Web Search (`/search`), and SDLC Governance & Tasks (`/tasks` — live tasks registry, DoR tester, audit modal).
    - Pure Light-Mode Theme Switcher & 3D Aesthetic: Universal floating circular FAB button (`fixed bottom-20 left-5 lg:bottom-6 lg:left-6 z-50`) in bottom-left opening 10 light-mode gradient themes with layered glassmorphism (`glass-frost` frosted panels with backdrop blur + saturation, `glass-frost-strong` for modals, `--glass-tint` per-theme primary/accent color-mix layer, specular `::before` sheen on `.glass-card-3d`), 3D tilt & hover animations (`scene-3d` / `tilt-3d` / `rise-3d` utilities), GPU hardware acceleration (`transform: translateZ(0)` / `will-change`) eliminating Chrome rendering lag with full `prefers-reduced-motion` support, accessible high-contrast fonts, and a custom Svelte 5 runes SweetAlert modal (`src/components/SweetAlertModal.svelte`) with body scroll-lock and Escape/backdrop close.
    - CSRF Protection: `X-Konoha-Web-Token` required on state mutations.
    - skills.sh Global Registry Search & 1-Click Install: Route `GET /api/v1/skills/registry?q=<query>` proxies live search queries to `https://skills.sh/api/skills` with exact CLI parity to `konoha skill search <query>`, registered before the wildcard `GET /api/v1/skills/:name` to prevent 404 shadowing. Route `POST /api/v1/skills/install` executes non-interactive `skills add` (`-y --agent '*'`) with piped stdio diagnostics and automated multi-directory SQLite FTS5 + Granite vector embedding migration.
    - Interactive Neural Vector & Chunks Inspector: `GET /api/v1/vectors/stats` serves vector index metrics (IBM Granite 384d, chunk counts, RRF reranker). `GET /api/v1/skills/:name` extracts Float32 embedding vector samples (`vector_sample`), rendered in `Skills.svelte` alongside tokenized chunk previews.
    - Multi-Directory SQLite Migration Aggregation (`src/migrate.js`): `--skills-dir` CLI flags are accumulated into `options.skillsDirs`, scanning and indexing all detected directories (`~/.agents/skills`, `.agents/skills`, `.gemini/skills`, etc.) so that installed skills are immediately indexed and preserved across both project and global scopes.
35. **Agent Dedicated Primary Skill Prioritization Invariant (v2.0.0-beta.7)**:
    - `getSkillsForAgentFromDb` in `src/agent_manager.js` strictly preserves the configured skill ordering from `~/.agents/agents.yaml`. Dedicated primary skills (`kage-skill`, `jonin-skill`, `anbu-skill`, etc.) are permanently anchored at index 0, guaranteeing that subagents never lose their core role SOP when custom skills are embedded.
36. **Web Server Security Posture & Global Command Reconciliation Invariants (v2.0.0-beta.7)**:
    - No CORS Wildcard: `sendJson()` in `src/web_server.js` never emits `Access-Control-Allow-Origin: *` — the SvelteKit UI is same-origin and any wildcard lets arbitrary web pages read the CSRF token cross-origin. Do not re-add CORS headers without an explicit same-origin allowlist.
    - Token Hygiene: the session token is served only by `GET /api/v1/csrf` (and the session cookie, `SameSite=Strict`); `/api/v1/health` and other GET responses must never embed it.
    - Secret Redaction: `GET /api/v1/bridges` returns `has_key` instead of `api_key`/`apiKey`; any new API exposing stored credentials must redact the same way.
    - Global Command Path: `installCliRuntime()` installs the self-contained CLI at `~/.konoha/bin/cli.js`; `reconcileGlobalCommand()` (called by `init` and `upgrade`) repairs/creates the `konoha` shim across npm prefix bin, `~/.local/share/pnpm` (Linux), `~/Library/pnpm` (macOS), `~/.local/bin`, and any PATH dir with a stale shim — Windows gets `konoha.cmd`/`konoha.ps1` wrappers. `konoha uninstall` removes only shims resolving into `~/.konoha`.
37. **SQLite FTS Sync & Validation Evidence Invariants (v2.0.0-beta.7)**:
    - External-Content FTS Sync: `persona_memories_fts` is kept in sync exclusively by the `persona_memories_ai/ad/au` triggers in `src/db.js`; never hand-insert/delete FTS rows in `src/persona_memory.js`, and never delete the content row before the index entry (external-content FTS requires the content row for `'delete'`). Legacy FTS schemas missing the `project_hash` column are dropped and rebuilt by `setupSchema`.
    - Connection Hygiene: every `db.getConnection()` call site MUST close in `finally` (see `try/finally` pattern across `src/mcp/*.js`, `src/tools_savings_logger.js`, `src/file_tools_mcp.js`); `src/vector_search.js` tracks loaded connections in a `WeakSet`, never a `Set`.
    - VACUUM Statement: `VACUUM` is SQL, not a pragma — always `conn.exec('VACUUM')` (used by `konoha data prune` / `data vacuum`).
    - Validation Evidence Parsing: `isCleanValidation()` in `src/mcp/workflow.js` strips zero-count success phrases (`0 errors and 0 warnings`, `exit code 0`, `0 critical vulnerabilities`) before the dirty-word check, so canonical success evidence never blocks delivery while `2 errors` / `build failed` still do.
    - JSON-RPC Error Correlation: `tools/call` crashes must answer with the original request `id` and `isError: true` in both `src/mcp/protocol.js` and `src/file_tools_mcp.js` — never `id: null` parse errors.
38. **Client MCP Topology & Manifest/Dispatch Parity Invariants (v2.0.0-beta.7)**:
    - Client Entry Target: every client's `konoha` MCP entry MUST point at `~/.konoha/file_tools_launcher.js` (which serves ALL 43 tools: bounded file tools + skills + build specs + subagents + workflow + persona memory + SDLC governance) — not the orchestrator-only `server.js`. Pi's registration (`src/pi_manager.js`) follows the same topology as Antigravity/Cursor/Claude Code.
    - Manifest/Dispatch Parity: every tool listed in `server.js`'s `tools/list` MUST be dispatchable. `src/mcp/tool_dispatch.js` delegates the six bounded file tools to `file_tools_router.dispatchTool`; when adding a tool to the manifest, implement it in the dispatcher in the same change. A manifest entry without a dispatch path returns `{"error":"Unknown tool: ..."}` at runtime (verified against Pi).
    - Workflow Artifact Location: workflow files (`prompt.md`, `plan.md`, `result.md`, `delegate.md`, `findings.md`, `final_report.md`, `kage_review.json`) live ONLY in the task dir (`~/.konoha/tmp/<client>/<session>/scratch/tasks/<task_id>/`). File-tool not-found errors for these names embed a `hint` with the resolved task dir; never instruct agents to look for them in the workspace root.
39. **Pi (pi.dev) Client Integration & Savings Attribution Invariants (v2.0.0-beta.7)**:
    - First-Class Pi Integration: `src/pi_manager.js` delivers full support for the Pi coding agent (`pi` CLI), registering `npm:pi-mcp-adapter` into `~/.pi/agent/settings.json`, merging `konoha`, `semble`, and `aislop` into `~/.pi/agent/mcp.json`, and deploying the official RTK extension via `rtk init -g --agent pi` into `~/.pi/agent/extensions/rtk.ts`.
    - Workflow Mandate Deployment: `ensurePiSetup` deploys the full Konoha runtime contract and Pi Workflow Mandate in `~/.pi/agent/AGENTS.md` (managed `<!-- KONOHA-CONTRACT-START/END -->` block), ensuring Pi adheres to Sannin task routing and Kage delivery gates instead of free-running.
    - Pi Savings Telemetry: `detectActiveClient()` in `src/tools_savings_logger.js` detects Pi sessions via `PI_CODING_AGENT=true`, `PI_SESSION_FILE`, `PI_SESSION_ID`, and session files under `~/.pi/agent/sessions/`, attributing savings to the dedicated `▲ Pi` client row.
40. **Shared Guardrail Engine & Cross-Client Hard Enforcement Invariants (v2.0.0-beta.7)**:
    - Single Source of Truth: `src/guardrails.js` (`checkCommandGuardrails(command)` and `buildGuardrailCheckerSource()`) defines the self-contained command guardrail checker.
    - Tool-Level Hard Enforcement: Deployed across Claude Code (`konoha-bash-guard.js`), Command Code (`konoha-native-blocker-cc.js`), Antigravity (`antigravity_tool_sanitize_hook.js`), and Pi (`konoha-blocker.ts`), blocking destructive commands (`rm -rf /`, `mkfs`, `dd`), destructive git (`reset --hard`, `push --force`), secret file access (`.env*`, `secrets.yaml`), and bare read tools, while allowing `rtk <command>`.
41. **Session Resume Workflow Reminder Invariants (v2.0.0-beta.7)**:
    - Re-Engagement on Resume: `src/workflow_reminder.js` is registered as a UserPromptSubmit hook and SessionStart hook (`resume|compact|clear`) for Claude Code, and a SessionStart hook for Command Code, mechanically re-engaging Sannin routing, Konoha skill tools, and the Kage delivery gate on every session resume or compact.
42. **Elevated Kage Reviewer Minimum Confidence Threshold Invariant (≥ 97%) (v2.0.0-beta.7)**:
    - Strict Delivery Gate: In `src/mcp/workflow.js`, test suites, and documentation, the Kage Reviewer confidence gating threshold requires `Minimum Required: ≥ 97%` across all verification categories. Delivery is mechanically blocked if overall or category confidence < 97%.
43. **VSIX Antigravity-Only Scoping & Models Command Consolidation Invariants (v2.0.0-beta.7)**:
    - VSIX Install Scope: `autoInstallKonohaBridgeExtension` in `bin/cli.js` installs `konoha-bridge-1.4.0.vsix` ONLY into Antigravity IDE (`installExtensionViaCli('antigravity', ...)`). NEVER re-add `code` or `cursor` VSIX installation calls — the extension is exclusively an Antigravity IDE integration.
    - Single Models List Surface: the standalone `konoha models` CLI command is REMOVED. Bridge-served models are listed exclusively via `konoha bridge models` (`cmdBridgeModels`). Do not reintroduce a top-level `models` command.
    - Agent Model Config: `konoha agent models [config] [agent-name]` (interactive TUI, or `--model <id>` / `--model inherit` non-interactive) assigns bridge-served models to subagents via `agentManager.updateAgentModel` (`src/agent_manager.js`), persisted as the `model` field in the `agents` SQLite table (`src/db.js` schema + migration guard) and mirrored through `agents.yaml` via `syncDbToYaml`. The Web UI equivalent lives in `/agents` (Agents.svelte) using `PATCH /api/v1/agents/:name/model` and the model list from `GET /api/v1/bridges/models`. Assignment is advisory metadata for host clients; agents without a `model` field inherit the host client default.
44. **Native SDLC Governance Layer Invariants (v2.0.0-beta.7)**:
    - Native Medium-Weight Engine: `src/sdlc_manager.js` provides zero-external-dependency SDLC governance integrated into `src/mcp/workflow.js` and `src/mcp/memory_reporting.js`.
    - Definition-of-Readiness (DoR) Gate: `checkReadiness(task, projectPath)` validates task substance (> 4 words), absence of unresolved placeholders (`TODO`, `FIXME`, `???`), existence of referenced files, and domain alignment. Configurable per project (`projects.dor_mode`: `advisory` default vs `enforced`) via `konoha project set dor-mode`.
    - Cross-Provider Review Independence: `detectReviewIndependence(implementingAgent, reviewerAgent)` compares assigned models from the `agents` table, detecting when the reviewer (`kage`) runs on a different bridge/model than the implementer (`anbu`, `jonin`).
    - Two-Step Anti-Slop Gate: Step 1 `aislop_scan` (aislop scanner — engine findings must be 0), Step 2 `anti-slop` rule review via the vendored `antislop` skill family (upstream https://github.com/miqdadbadjuber/anti-slop: core filter plus `antislop-code/ui/copywriting/human/layoutmobile`), enforced through the `antislop` Delivery Gate; strict check (`ai_slop_clean: true` and `ai_slop_findings: 0`) — TARGET 100%: the workflow mechanically enforces a perfect 100/100 aislop scan (zero findings of ANY severity) before synthesis.
    - Autonomous Kage → Anbu Remediation Loop: Automatically converts anti-slop findings into high-priority remediation tasks for `anbu` when findings are present, bounded by the delegation-depth circuit breaker (`slop_cycles > 7`).
    - Persistent SQLite Audit Trail: `sdlc_tasks` table records tasks, DoR results, review modes, validation evidence (`report_from_agent`), and anti-slop findings. Managed via CLI (`konoha task list`, `konoha task show <id>`, `konoha task slop <id>`) and MCP tools (`check_readiness`, `get_task_evidence`, `get_slop_findings`).
    - Web UI Governance Dashboard (`/tasks`): SvelteKit 3 / Svelte 5 frontend component `Tasks.svelte` with full task registry exploration, interactive Definition-of-Readiness sandbox tester (`POST /api/v1/sdlc/check-readiness`), detailed task evidence & anti-slop audit modal (`GET /api/v1/sdlc/tasks/:id`), and project-level governance toggles (`PATCH /api/v1/sdlc/config`).
    - Test Suite Verification: Verified across 5 dedicated SDLC test suites (`test_sdlc_dor.js`, `test_sdlc_tasks.js`, `test_sdlc_cross_provider.js`, `test_sdlc_remediation_loop.js`, `test_web_sdlc_api.js`), bringing total JS test suite count to 69 passing suites at 100%.
45. **Runtime Deploy Root-Mirror Invariant (v2.0.0-beta.7)**:
    - Dynamic Root Mirror: `installFileTools()` in `src/deploy_utils.js` root-mirrors EVERY `src/*.js` into `~/.konoha/` (runtime ROOT). The installed `mcp/` subsystem resolves shared modules via relative requires like `require('../sdlc_manager')`, which point at the runtime ROOT — not `~/.konoha/src/`. A hardcoded copy list previously missed new modules (e.g. `sdlc_manager.js`), crashing ALL 42 subagent MCP tools (sannin/jonin/anbu/kage) after every deploy — the "konoha workflow never runs" regression. Never replace the dynamic mirror pass with a static list.
46. **Sannin Stale-State Guard & Two-Step Slop Review Invariant (v2.0.0-beta.7)**:
    - Reused Task Dirs: `getResolvedTaskDir()` returns the most-recently-modified task subdir (usually the same reused `default` dir). `runSannin()` in `src/mcp/workflow.js` guards: when a supplied prompt differs from the stored `prompt.md`, stale `result.md` / `status.json` / `delegate.md` / `plan.md` / `findings.md` / `kage_review.json` / `final_docs.md` are reset before triage; `result.md` is only short-circuited when it belongs to the current prompt.
    - Two-Step Gate Enforcement: `runAislopGate()` mechanically runs the aislop scanner at the Kage review phase and BLOCKS synthesis unless the scan is a perfect 100/100 (zero findings of ANY severity). Subagent tools (`anbu`, `jonin`, …) require `delegate.md` in the task dir BEFORE the call.
47. **Test DB Isolation Invariant (v2.0.0-beta.7)**:
    - Env Override: `src/db.js` and `bin/cli.js` honor `process.env.KONOHA_DB_PATH` (canonical default stays `~/.konoha/konoha.db`). Test suites that write DB rows MUST require `tests/helpers/isolate_db` (temp DB with pre-initialized schema); routing suites also require `tests/helpers/seed_agents`. `npm test` must leave the production DB row counts unchanged.
48. **Token-Efficient Output & Honest Attribution Invariants (v2.0.0-beta.7)**:
    - ANSI Color Gate: `bin/cli.js` defines `USE_COLOR` (TTY && !`NO_COLOR` && !`CI` && `KONOHA_COLOR!=='0'`); all report colors route through `C`/`rgb()` — never inline gradient escapes.
    - Review Token Hygiene & Strict Changed-Files Scoping: across all clients (Pi, Antigravity, Cursor, Claude Code, OpenCode, CommandCode, Codex), agents MUST NEVER execute unscoped full-repository scans (`aislop_scan` without target path or `aislop scan` without `--changes` or specific files). When calling `aislop_scan`, ALWAYS pass specific changed file paths or use `--changes` to ensure bounded, token-efficient execution. Raw full-repo scan output must NEVER be dumped into conversation context; summarize counts and key findings only (score, error count, rule IDs) or use `get_slop_findings(compact: true)`. Single-file edits or routine configuration changes must NEVER trigger repository-wide slop refactoring loops.
    - Honest Client Attribution: `detectActiveClient()` (savings logger + client_detection) attributes ONLY on hard session signals (env overrides, PI_SESSION_FILE, CLAUDE_CODE_CHILD_SESSION, …). With no signal it returns `unattributed` — never guess from filesystem mtimes (the old heuristic misattributed thousands of calls across clients and corrupted the `konoha savings` provider breakdown).
    - Test DB Isolation: all test suites (`tests/run_all.js` and standalone tests) run against isolated temporary databases via `KONOHA_DB_PATH` (`tests/helpers/isolate_db.js`), guaranteeing that test tool calls and SDLC task mutations never pollute the production database `~/.konoha/konoha.db` or skew provider breakdown savings.
49. **Pi Skill Conflict Elimination Invariant (v2.0.0-beta.7)**:
    - Collision Diagnostics Silencing: Pi (`@earendil-works/pi-coding-agent`) auto-discovers skills from both `~/.agents/skills` (user global) and `<project>/.agents/skills` (project local). Because mirrored files have different physical paths on disk, Pi's `loadSkills2` records benign collision diagnostics and displays `[Skill conflicts]`.
    - Native Extension Monkeypatch: `konoha-blocker.ts` deployed to `~/.pi/agent/extensions/` patches `DefaultResourceLoader.prototype.getSkills` and `updateSkillsFromPaths` to filter out `{ type: "collision" }` diagnostics. This guarantees zero `[Skill conflicts]` startup warnings while preserving full access to all skills and real errors/warnings.
50. **Web UI Single-Instance Daemon & Terminal Tab Invariant (v2.0.0-beta.7)**:
    - Informational Status: `cmdUiStart` reports already-running servers as `info` (`ℹ Konoha Web UI is already active on ...`) rather than `warn`, preventing false positive warning alerts when new terminal tabs or background scripts initialize.
    - Single-Instance Guard & Cleanup: `cmdUiStart` automatically detects and prunes stale `ui.pid` files (verifying PID liveness via `process.kill(pid, 0)`), checks for zombie `cli.js ui daemon` instances via `pgrep` before spawning, and handles `SIGHUP` in `cmdUiDaemon`.
    - Port-Aware Pid Files & Port-Scoped Stop (v2.0.0-beta.7 hotfix): `uiPidFileForPort()` keeps the canonical `ui.pid` for port 1404 and `ui-<port>.pid` for custom ports, so daemons on different ports can never clobber each other's pid records. `cmdUiStop` is fully port-scoped — the `ui` dispatcher MUST forward `subArgs` to `cmdUiStop` (the legacy `cmdUiStop()` no-arg call made `ui stop --port=1405` kill the production daemon on 1404), the pidfile pid is verified against `/proc/<pid>/cmdline` for the target port before killing (win32: taskkill, POSIX: SIGTERM), the pkill pattern is `ui daemon --port=<port>`, and the fallback is port-scoped `fuser -k <port>/tcp`. Tests and scratch scripts that start/stop daemons MUST pass an explicit `--port` other than 1404.
56. **Premium Flow GIF Generator Invariants (v2.0.0-beta.7)**:
    - Single Toolkit: `scripts/lib/premium_gif.js` is the shared premium drawing library (ink-gradient background with dot grid, glass cards, gradient connectors with marching-ants dashes, traveling pulse dots, ring gauges, rotated stamps, chrome/badges) and `scripts/generate_premium_flow_gifs.js` generates ALL three README flow GIFs — `assets/konoha-orchestration-flow.gif`, `assets/konoha-jonin-flow.gif`, and `assets/konoha-kage-gate.gif` — via `node scripts/generate_premium_flow_gifs.js`. Never add a separate per-GIF generator.
    - Verification Constraint: generated GIF frames CANNOT be visually inspected (konoha-blocker rejects built-in reads of image files) — verify via pixel sampling with `@napi-rs/canvas` `loadImage` + `getImageData` against expected accent RGB tuples and glyph-density scans, plus `ffprobe` for authoritative frame counts/durations.
    - Scene Fidelity: the orchestration scene must mirror the README Mermaid spec (steps 1-7, remediation loop `<= 7 cycles`, 83-98% token savings badge), the jonin scene must mirror the actual pipeline (build spec -> Taste-Skill dials 8/7/6 -> human-built fingerprint -> anti-slop gate -> Kage >= 97% -> delivered), and the kage scene must mirror the real gate (aislop scan 100/100 -> anti-slop rules 0 findings -> verification matrix -> >= 97% confidence with BLOCKED below threshold).
51. **Cross-Agent ADHD-Friendly Output Skill Invariant (`i-have-adhd`, v2.0.0-beta.7)**:
    - Agent Scoping: the `i-have-adhd` skill (adapted from `ayghri/i-have-adhd`, MIT) is embedded into exactly five agents — genin, jonin, anbu, tokubetsu-jonin, and chunin — via `src/templates/agents.yaml`, the `src/templates/AGENTS.md` / `GEMINI.md` routing tables, and Domain-Routing rows in each agent skill. Sannin (router) and Kage (reviewer) must NEVER receive it: their output contracts are governed by their own skills and the delivery gate.
    - Four-Tree Parity: `i-have-adhd/SKILL.md` ships byte-identical across `src/templates/skills/`, `.agents/skills/`, `.cursor/skills/`, and `.gemini/skills/`; `tests/test_i_have_adhd_skill.js` enforces parity, the exact 5-agent mapping, and the presence of all 10 output rules.
    - Presentation-Only Cap: rule 9 (cap lists to 5) shapes final-response presentation only — it must never limit analysis, search, tool results, or retained information; delivery-gate evidence requirements always outrank brevity.
52. **Pi Managed-Contract Deduplication Invariant (v2.0.0-beta.7)**:
    - Addendum Inside Markers: the Pi Workflow Mandate MUST be deployed INSIDE the `<!-- KONOHA-CONTRACT-START/END -->` managed block (`buildPiManagedContract()` in `src/pi_manager.js`), never concatenated after it. The legacy `buildMainAgentContract(pi) + buildPiWorkflowAddendum()` pattern appended a fresh mandate copy outside the markers on every redeploy while stale copies survived — production accumulated 166 copies (~410KB, ~100K tokens burned per Pi session).
    - Stale Sanitization: `stripStalePiMandates()` runs before every write, removing exact copies of the current addendum text plus legacy-format `## Konoha Workflow Mandate (Pi)` sections (shape-aware: only blank lines and `- ` bullets are consumed, user prose survives). `tests/test_pi_contract_dedup.js` enforces single-mandate idempotency, legacy-collapse, and fresh-install behavior.
53. **Token-Efficiency Feature Checklist (MANDATORY when adding ANY feature)**:
    - Budget every output: any new tool, endpoint, or command MUST return bounded payloads — previews with on-demand full content (see `find_skill` 500/250-char previews, `loadSkillContentForBuild` 400-char SOP previews), hard caps on findings/entries lists (e.g. 50), and byte/line caps on file reads. Never dump raw file contents or full-repo scan output into agent context.
    - Scan scope: every scan-style feature MUST be scoped (changed-files, explicit paths, or bounded directory walks with SKIP_DIRS and MAX_FILES/MAX_FILE_BYTES guards — see `src/ai_detector.js`). Unscoped full-repository evaluation is forbidden (token-hygiene mandate).
    - Boilerplate discipline: prompt/contract blocks injected into client context files must be marker-wrapped and REPLACED on redeploy (never appended — see rule 52). Before shipping, verify the deployed artifact size stays constant across repeated deployments.
    - Measure before/after: when adding a feature, run `konoha savings` and confirm the per-tool `avg_KB` stays within the bounded-tool envelope (read-style tools `<=` 5KB, build specs `<=` 16KB); a regression here is a delivery-gate failure.
    - Cache deliberately: expensive computations get fingerprint or mtime caching (see `copySkillsDirFast`, transcript caching rule 28) — but caches keyed by version must be invalidated on code change (never cache across upgrades without a version key).
54. **Website AI Detector Tool Invariants (v2.0.0-beta.7)**:
    - Pure Core + Three Surfaces: `src/ai_detector.js` is the pure detector (no DB/MCP/CLI deps) reused by the MCP tool wrapper (`src/mcp/ai_detector.js`, tool name `website_ai_detector`), the CLI (`konoha detect-ai <path-or-url> [--json]`), and the Web UI (`GET /api/v1/detect-ai?target=` + the `/detector` page). Adding detector rules means editing ONLY the RULES array in the core.
    - Scoring contract: score 0-100 = sum of triggered rule weights (GEN-01 generator tag +15, ICON-01 Lucide +12, ATTR-01 attribution +12, UI-01 shadcn shape +10, HOST-01 Vercel/Netlify +8, TPLT-01 boilerplate +6, ASSET-01 generic assets +4, FRAME-01 default title +3). Bands: 0-20 Human-Built, 21-40 Likely Human-Built, 41-60 AI-Assisted Build, 61-100 AI-Generated — the 0-20 band is the PLAN_HUMAN_BUILT.md target.
    - Manifest/Dispatch parity (rule 38): `website_ai_detector` is registered in `src/mcp_tool_manifest.json`, `TOOL_HANDLERS` (file_tools_router.js), both `_executeToolInternal` and async `executeTool` (directory targets sync; URL targets via the async path or a server.js subprocess). `tests/test_ai_detector.js` covers fixtures, URL mode, error handling, and the MCP dispatch contract.
55. **Upgrade Full-Runtime Refresh Invariant (v2.0.0-beta.7)**:
    - The `ensureAutoSetup()` slow path MUST call `installCliRuntime()` so version-bump upgrades refresh the COMPLETE installed runtime (bin/cli.js, the full src/ tree including src/mcp/, the pre-built web UI, package.json). The flat `filesToCopy` list covers the legacy root layout ONLY — it historically missed `web_server.js`, `src/mcp/*`, and `sdlc_manager.js`, leaving a stale backend after upgrades (the "dashboard 500 after upgrade" bug class).
    - `copyFile()` carries a same-path guard (self-copy is a no-op on Linux but can throw EPERM on Windows when `konoha init` runs from the installed runtime). `konoha ui build` refreshes ONLY the web build — backend changes still require a version bump (auto-setup) or `konoha init`.
56. **Token Savings Flow Logic Preservation Invariant (NEVER TOUCH TOKEN SAVINGS FLOW LOGIC)**:
    - Under NO circumstances should any coding agent or tool modify, refactor, remove, or disrupt the token savings telemetry, bounded file tool constraints (`MAX_SPAN=250`, `MAX_LINES=150`, `MAX_LINE_CHARS=1000`, `DEFAULT_LIMIT=50`), auto-compaction budgets, or baseline computation flow logic in `src/file_tools/read_file_range.js`, `src/file_tools/read_file_head.js`, `src/file_tools/find_files_clean.js`, `src/mcp/tool_dispatch.js`, `src/tools_savings_logger.js`, `src/mcp/memory_reporting.js`, and `src/db_savings.js`.
    - This token savings flow logic is stable, finalized, and strictly enforces our 83%–98% token reduction guarantee across all 7 supported coding clients.
    - Coding agents must treat this token savings engine as a strictly protected, immutable invariant alongside the stable Bridge Gateway.
57. **Konoha Maintenance Token Burn Elimination & Automation Invariant (v2.0.0-beta.7)**:
    - Zero Unscoped MCP Scans: The external `aislop` MCP tool `aislop_scan` only accepts directory `path` and lacks `--changes` support. Calling it on root scans all 3,500+ files and dumps ~14,000 findings into context (~50k tokens). Delivery Zero-AI-Slop gating on changed files MUST ALWAYS be executed via CLI: `rtk aislop scan --changes` (or pass specific changed file paths).
    - Skill Tree Sync Automation: When editing skills (such as `konoha/SKILL.md`), edit `.agents/skills/` once and run `npm run sync:skills` (`node scripts/sync_skills.js`). NEVER manually duplicate edits across `.agents/skills`, `src/templates/skills`, `.cursor/skills`, and `.gemini/skills`, which burns 150k+ context tokens in multi-file reads/writes.
    - Incremental Test Runner Filtering: `tests/run_all.js` supports pattern filtering (`node tests/run_all.js <pattern>`). Incremental test passes during development MUST run only the relevant test suite (e.g. `rtk node tests/run_all.js parity`) to avoid burning terminal output tokens across 77 suites until the final regression run.
58. **Subagent Skill Consolidation & Reference Invariant (v2.0.0-beta.7)**:
    - All anti-slop rules (`antislop.md`, `antislop-code.md`, `antislop-copywriting.md`, `antislop-human.md`, `antislop-layoutmobile.md`, `antislop-ui.md`) are consolidated directly under `kage-skill/references/` for Zero-AI-Slop gate reviews.
    - ADHD-friendly output shaping (`i-have-adhd.md`) is embedded byte-identical under all 5 target agent reference directories (`genin-skill/references/`, `chunin-skill/references/`, `jonin-skill/references/`, `anbu-skill/references/`, `tokubetsu-jonin-skill/references/`).
    - DevOps & Infrastructure scaffolding (`helm-chart-scaffolding.md`, `helm-chart-scaffolding-assets/`, `multi-stage-dockerfile.md`) is consolidated under `anbu-skill/references/`. Redundant `helm-assets/` was permanently deduplicated in favor of canonical `helm-chart-scaffolding-assets/`.
    - PowerPoint presentation design (`elite-powerpoint-designer.md`, `elite-powerpoint-designer-assets/`) is consolidated under `tokubetsu-jonin-skill/references/`.
    - All standalone source skill directories (`antislop*`, `helm-chart-scaffolding`, `multi-stage-dockerfile`, `react-*`, `elite-powerpoint-designer`, `i-have-adhd`) are deprecated and removed across all 4 skill trees.
    - Legacy skill lookups in `src/mcp/skills.js` automatically normalize aliases and resolve references without prefixes.
59. **Neural Embedding CPU 100% Peak Elimination & Adaptive Duty-Cycle Throttling Invariant (v2.0.0-beta.7)**:
    - In `src/vector_search.js`, ONNX Runtime session options enforce single-threaded execution (`intraOpNumThreads: 1`, `interOpNumThreads: 1`, `executionMode: 'sequential'`), and WASM backend `numThreads` is bound to 1.
    - To eliminate 100% CPU pegging during clean re-embedding across large document corpora (1,188+ chunks), adaptive duty-cycle throttling is enforced in `indexSingleSkillChunks`: sleeping `Math.max(Math.round(inferMs * 1.25) + 15, 35)` ms per chunk (overridable via `KONOHA_EMBED_PACE_MS`), strictly capping active CPU duty cycle to ~40–50%.
    - An inter-skill cooling delay of 50ms and post-initialization settle delay of 100ms prevent thread contention and thermal throttling.
    - Transformer attention matrix memory is strictly bounded by capping chunk sizes to $\le 2000$ characters via sliding-window chunking, disposing native ONNX tensors via `output.dispose()`, and bounding in-memory embedding cache to 512 entries with inter-skill cache flushing.
60. **Offline Bundled Models & Dual-Stage Neural Reranker Invariant (v2.0.0-beta.7)**:
    - **Offline Bundled Models**: Both the neural embedding model (`assets/models/onnx-community/granite-embedding-97m-multilingual-r2-ONNX/` at 93.3 MB) and the neural cross-encoder reranker model (`assets/models/Xenova/ms-marco-MiniLM-L-6-v2/` at 23 MB) are pre-bundled directly under `assets/models/`, guaranteeing every single file is strictly under GitHub's 100 MB file limit.
    - **Offline Discovery & Zero-Download**: `src/vector_search.js` automatically detects bundled models via `getBundledModelsDir()`, sets `env.cacheDir` and `env.localModelPath`, and enforces `local_files_only: true` with graceful fallback, providing 100% offline neural vector search and cross-encoder reranking with zero network downloads.
    - **Dual-Stage Reranking & RAG Retrieval**: Retrieval combines fast Reciprocal Rank Fusion (RRF, k=60) for skill-level candidate ranking with full neural cross-encoder reranking (`rerank()` and `searchChunksRAG()`) for high-precision passage scoring and RAG context retrieval.
    - **Global CLI Synchronization**: `bin/cli.js:installCliRuntime` synchronizes `assets/models` into `~/.konoha/assets/models/` during `konoha init` / `konoha upgrade`, ensuring smooth global CLI deployment across all 7 coding clients.

