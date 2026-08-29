# Changelog

All notable changes to the **Konoha** project will be documented in this file.

## [Unreleased]

### Added
- **Official Framework Scaffolding Standards**: Standardized new website/project scaffolding commands across the Konoha MCP server, subagents, and client rules:
  - Next.js: `pnpm create next-app@latest`
  - Nuxt: `pnpm dlx nuxi@latest init <project-name>`
  - Angular: `pnpm dlx @angular/cli@latest new <project-name> --package-manager=pnpm`
  - SvelteKit: `pnpm dlx sv create <project-name>`
  - Added `scaffold_command` property to `BUILD_FRAMEWORKS` in `src/server.py` and included standard scaffolding commands in `build_from_text` and `build_from_source` output directives.
- **Kage Reviewer Confidence Gate Report**: Standardized final delivery gate report across all 5 clients (Antigravity IDE/CLI, Cursor, Claude Code, OpenCode, and Command Code), enforcing a minimum 90% confidence threshold with category breakdown tables.
- **Strict Factual Truth & Anti-Hallucination Guardrails**: Enforced explicit guardrails prohibiting simulated executions, unverified claims, or false completions without inspecting real command and tool outputs.
- **High-Efficiency Auto-Compaction Contract**: Automatically activated after turn 2 across all coding environments to preserve project context and invariants under 450 tokens without prompt bloat.
- **Promoted Structured MCP Delegation**: Primary cross-client workflow for all subagents (`delegate_to_jonin`, `delegate_to_anbu`, `delegate_to_kage`, etc.), keeping legacy `delegate.md`/`result.md` isolated as fallback-only paths.
- **Taste-Skill Build Engine**: Validated, side-effect-free build specifications for Next.js, Nuxt, SvelteKit, and Angular with numeric taste dials and framework-native pnpm validation commands.
- **Full Test Suite Extension**: Expanded test runner to 51 test suites, all passing with 0 failures (`tests/run_all.js`).

### Removed
- Removed unreferenced historical patch, fix, and revert scripts plus confirmed transient cache/task artifacts.

## [2.0.0] - 2026-08-14
### Fix: Base feature 
- Replaced the obsolete pinned bridge-extension flow with live `master` refreshes for detected Antigravity IDE only; installs use `~/.antigravity-ide/extensions/andycungkrinx91.konoha-bridge-master-universal/`, record the resolved commit, preserve rollback, and keep external bridge records disabled by default.
- Canonicalized Genin routing and metadata to `genin-skill` across packaged and client deployment copies while preserving legacy upgrade normalization.
- Fresh installation and missing-database auto-setup now require and verify the canonical `genin-skill` SQLite entry before client registration.
- Replaced embedded documentation diagrams with a validated multi-page editable Draw.io architecture source and manifest.
- Added a post-fix cleanup gate to the developer-only Konoha maintenance skill.

### Fix: Sanin MCP Tool Naming
- **Consistent tool naming**: Fixed inconsistent MCP tool name for `run_sannin` — now consistently uses `mcp__konoha__sannin` (was `mcp__konoha__sannin` in JS bridge managers, `mcp__konoha__sannin` in Python server). Updated `mcp-tools-block.md` reference skill, DB entry, and server execution protocol instructions.
- **MCP block consistency**: The routing rules in the subagent MCP block now correctly reference `mcp__konoha__sannin` for all client integrations.
- **MCP Tool Alias Architecture**: All MCP tool names now use consistent double-underscore naming (`mcp__konoha__*`, `mcp__semble__*`). The `sannin` orchestrator tool is `mcp__konoha__sannin`. Subagent aliases (`kage`, `jonin`, etc.) remain for the legacy name-lookup route.

### Major: Three-Way Cross-Platform IDE/CLI Support
- **Cursor IDE & CLI Integration**: New `src/cursor_manager.js` registers `konoha`, `semble`, and `konoha-files` in `~/.cursor/mcp.json`, deploys ninja subagents to `~/.cursor/agents/` with Cursor model slugs (`composer-2.5-fast`, `claude-opus-4-8-thinking-high`, `gpt-5.3-codex`, etc.), writes project `.cursor/rules/konoha.mdc` orchestrator rules, and configures Cursor CLI MCP permissions in `~/.cursor/cli-config.json`.
- **Claude Code Integration**: New `src/mcp_clients_manager.js` registers `konoha`, `semble`, and `konoha-files` in `~/.claude.json`, deploys subagents to `~/.claude/agents/`, and writes `~/.claude/CLAUDE.md` instructions with correct double-underscore MCP naming (`mcp__konoha__*`, `mcp__semble__*`).
- **Antigravity IDE/CLI** (existing): MCP schemas in `~/.gemini/antigravity-cli/mcp/konoha/`, subagent configs in `~/.gemini/antigravity-cli/agents/` and `~/.gemini/antigravity-ide/agents/`, hooks in `~/.gemini/config/hooks.json`.
- **RTK (Rust Token Killer) Auto-Deployment**: On every `konoha init`, RTK rule files are automatically deployed to all three clients: `~/.gemini/antigravity-cli/rules/rtk.md`, `~/.gemini/antigravity-ide/rules/rtk.md` (Antigravity), `~/.cursor/rules/rtk.mdc` (Cursor), and `~/.claude/rules/rtk.md` (Claude Code). Requires `rtk` binary on PATH; gracefully skipped when unavailable.
- **Multi-Client Status Reporting**: `konoha status` now shows RTK install/deploy status per client alongside MCP and hooks status.

### Major: Konoha Bridge Router & Proxy Gateway
- **Konoha Bridge Router**: Implemented the central Konoha Bridge Router on port `11434` to multiplex and serve all active LLM bridges. The router dynamically discovers active bridges, aggregates their available models into an alias list (`<bridge_name>-<model_name>`), and proxies requests (OpenAI completions, Anthropic messages, Gemini generateContent) directly to the target bridge server based on the model prefix.
- **Proxy Gateway Port 11434 → 19999**: The outer Proxy Gateway now listens on port `19999` (was `11434`). Inner bridges use user-specified ports. Update any client SDK base URLs accordingly.
- **Bridge Model Prefix Resolution**: Gateway checks (1) bridge-name prefix first, (2) exact model cache match, then (3) falls back to first active bridge. Cache TTL is 30 seconds.
- **Multi-Provider Bridges Config**: `~/.konoha/bridges.json` is now an array of bridge objects `{name, port, provider, enabled, requiresSidecar?, targetUrl?, apiKey?}`. Supported providers: `antigravity` (passive sidecar) and `openai` (real upstream). Legacy single-object configs auto-migrated.
- **Local Auth Boundary & Header Stripping**: The gateway strips inbound `Authorization`, `x-api-key`, `x-konoha-gateway-*` headers before forwarding to inner bridges. API keys are only attached by a bridge on outbound calls. The `antigravity` bridge never holds or transmits Google OAuth credentials; uses passive CSRF + mTLS discovery against the user's running sidecar.
- **Bridge Management Subcommands**: New CLI commands (`konoha bridge status`, `konoha bridge list`, `konoha bridge create`, `konoha bridge delete`, `konoha bridge enable`, `konoha bridge disable`) for managing multiple local LLM bridge instances.
- **Custom OpenAI Provider Support**: `konoha bridge create` interactively collects custom ports, target URLs, and API keys, saving to `~/.konoha/bridges.json`.
- **Dynamic Bridge Hot-Reloading**: `konoha-files` MCP server dynamically reads `bridges.json` and hot-reloads bridge config changes in real-time. Modify config → bridge starts/reloads/stops immediately without restarting the host IDE or Claude Code.
- **Upstream Error Propagation**: Exact HTTP status code propagation (401, 403, 429) and error details parser inside proxy handlers (`openai.js`, `anthropic.js`, `gemini.js`), mapping to standard OpenAI/Anthropic/Gemini error shapes.
- **Clean Process Termination**: Dedicated `readline` close listener cleanly terminates intervals, closes file watchers, and exits the MCP server on stdin EOF — preventing orphaned bridge processes.
- **Response Model Rewriting**: Gateway rewrites both streaming (SSE) and non-streaming response `"model"` fields back to the gateway alias (e.g. `antigravity-gpt-4o` ← `gpt-4o`). Covers OpenAI, Anthropic, and Gemini protocols.
- **Compression Safety**: Strips `accept-encoding` headers in gateway forwarding to guarantee uncompressed responses.

### Major: MCP Architecture
- **MCP Alias Architecture**: Subagents (`kage`, `jonin`, `anbu`, `chunin`, `tokubetsu_jonin`, `genin`) are inline persona-injection aliases served by the konoha MCP server. When called, they return the agent's persona, system prompt, and embedded skills as tool response text.
- **Forced Konoha MCP + Semble MCP Usage**: Added top-level "Forced MCP Usage & Delegation" preamble (`⚠️ MANDATORY`) to all instruction files (`GEMINI.md`, `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/konoha.mdc`). Agents MUST use `konoha` MCP (skills + bounded file ops) and `semble` MCP (codebase search) — never generic `Read`/`Grep`/`Glob`/`cat`/`grep`.
- **Native Tool Denial Enforcement**: `antigravity_tool_sanitize_hook.js` now denies `view_file`, `grep_search`, `list_dir`, `Read`, `Grep`, `Glob`, and `Search` tools at the platform level.
- **Shell Command Blocking**: Extended sanitize hook to block `run_command` calls containing `cat`, `head`, `tail`, `grep`, `rg`, `find`, `fd`, `ag`, `ack`, `less`, `more`, `bat`, `wc`.
- **Semble as Default Search**: New `src/search_policy.js` mandates `semble` MCP (`search`, `find_related`) instead of grep/glob/find/rg and Cursor `Grep`/`Glob`/`SemanticSearch`.
- **Token-Efficient File Tools (`konoha-files` MCP)**: New Node MCP server (`file_tools_mcp.js`) with Python workers for `read_file_head`, `read_file_range`, `file_info`, `token_efficient_grep`, `get_file_structure`, `find_files_clean`. Auto-registered on init for Antigravity and Cursor.

### Major: Design System & Website Generation
- **Multi-Framework Konoha Design System**: Canonical design system (warm amber #C89B77 accent, DM Sans + Roboto fonts, #F8F8F8 body) as the base template for all Next.js, SvelteKit, Nuxt, and Angular apps.
- **Split-Panel 3D Hero Carousel**: Full-viewport split-panel hero (left text/CTA + right portrait image) with mouse-tracking 3D perspective tilt and 4.5s auto-advance. Responsive mobile stack.
- **1-Shot 8-Page Production Application Architecture**: `build_from_text` and `build_from_source` deliver complete 8-page apps (10-Theme Switcher, 50-item live search, range sliders, sticky mobile dock, loan calculator, branch finder, VIP portal, custom error pages, `Build by Konoha` watermark).
- **Multi-Framework Jonin Skills Suite**: Added Nuxt (`nuxt-ui-expert`, `nuxt-code-expert`) and Angular (`angular-ui-expert`, `angular-code-expert`) alongside Next.js, Svelte, and Tailwind.
- **SPA vs Landing Page Dynamic Architecture**: `build_from_text` enforces full SPA with internal client-side routing by default, gracefully falling back to a single landing page only if explicitly requested.
- **Premium 3D Hero Carousel Directive**: All framework templates require a "Premium full image wide carousel with interactive 3D" — 100vw edge-to-edge layout with mouse-tracking animations.
- **Aggressive Mobile Menu Deduplication (DS-7)**: Forcefully hide desktop header nav links on mobile (`hidden md:flex`), making the sticky mobile bottom dock the sole mobile navigation.
- **Floating Theme Switcher Alignment (DS-6)**: Mandate absolute bottom-left pinning in Tailwind (`fixed bottom-4 left-4 z-50`), forbidding placement inside the header.
- **Strict Quality Guarantees**: Jonin builds enforce zero deprecated packages, safe `.env.example` extraction, security best practices, zero CVEs, and zero linting/build errors.

### Added
- **Fast-Path Auto-Setup CLI Caching**: Timestamp-based fast-path caching (`.last_autosetup`) in `ensureAutoSetup()` accelerates `konoha` CLI execution from > 5s to **< 100ms**.
- **Enterprise Web Search Tool**: `web_search` MCP tool with Google Custom Search API, DuckDuckGo API, and Wikipedia OpenSearch fallback, automated browser header emulation, and query simplification loops.
- **Multi-Source Zero-API-Key Search Chain**: Dynamic public SearXNG instance resolution from searx.space with 24h caching, 1h best-instance verification, DuckDuckGo/Startpage/Wikipedia fallbacks.
- **chunin Deep Research Integration**: Automatically triggers parallel web search and injects cited, ranked findings into the subagent's initialization prompt for deep research tasks.
- **Proxy Gateway Token Preflight Mocking**: Added preflight interceptor for `POST /v1/messages/count_tokens` returning `{"input_tokens": 0}` with `200 OK` — prevents Claude CLI and Cherry Studio gateway infinite retry loops.
- **Models Status Subcommand**: `konoha models status` views model configurations of the agent village without listing all available models.
- **Passive Sidecar Discovery**: Strict sidecar process discovery (`discovery.js`) — the bridge connects only to already active, user-initiated `agy` CLI or Antigravity IDE sessions. Never auto-spawns background daemons.
- **`ag-local-bridge` Integration**: Local LLM proxy bridge automatically booted in-process when `konoha-files` MCP server initializes (listening on port `11435`).
- **Automated Bridge Deployment**: `deploy_utils.js` recursively copies all bridge modules to `~/.konoha/bridge/` and runs `npm install` to install `@bufbuild/protobuf`.
- **Active Sessions Telemetry & Pruning**: Session tracking inside SQLite. Commands: `konoha data view`, `konoha data prune`, `konoha data vacuum`.
- **Knowledge Base Exporting**: `konoha data export` exports skills, agent roster, and active session telemetry into a Markdown file.
- **Session Isolation & Leak Prevention**: Workspace scan restricted to files matching the active workspace slug to prevent cross-session context leaks.
- **Direct Tool Calls Fallback**: Main coordinator thread executes skills via Direct Tool Calls when no specialized subagent embeds the matching skill.
- **Persistent Upgrade Marker**: `.upgraded_v1.1.1` marker file determines upgrade status, allowing complete freedom to change or unembed official skills per agent.
- **SearXNG Data Pruning**: `konoha data prune` cleans SearXNG logs and cache files (`search.log`, `instances_cache.json`, `best_instance.json`) under `~/.konoha/searxng/`.
- **Laravel & Go Walk Ignores**: Automatically exclude `go-dist` and `vendor` directories during `find_files_clean` file walks.
- **FTS5 & Database Migration Tests**: Added `src/test_database_migration.py`.
- **Web Search Chain Tests**: Added `src/test_web_search.py`.
- **Bridge Gateway Tests**: Added `src/test_bridge_gateway.py`.
- **Unified Python Test Runner**: `konoha test` automatically scans `src/` and runs all Python test suites.
- **Cross-Platform QA Scripts**: `test_agent_attribution.py`, `test_cursor_attribution.py` 100% pass rate.

### Changed
- **`konoha init`**: Now prompts for Cursor IDE/CLI configuration consent and deploys global + project Cursor configs.
- **`konoha status` / `konoha doctor`**: Report and auto-repair Cursor and Claude Code integration health. Shows RTK status per client.
- **`konoha uninstall`**: Removes Konoha-managed entries from `~/.cursor/` and `~/.claude/`.
- **Cursor Free default model behavior**: Subagents default to `model: inherit` (Auto session model) — works without explicit model selection on free-tier Cursor accounts.
- **Strict Antigravity orchestrator pipeline**: `buildOrchestratorWorkflow()` enforces `prompt.md` → analyze → `delegate.md` → Konoha subagent → `result.md` → user report. Removed `@self` / `@research` from delegation tables.
- **Dynamic Skill Checklist Injection**: Compilers dynamically strip legacy find_skill instructions and inject active `Before work: find_skill` calls at compile/generation boundaries.
- **GEMINI.md & AGENTS.md Disk Persistence**: `regenerateAndDeploy()` now writes generated files to disk.
- **Thought Token Tracking**: Scans transcripts under `<appDataDir>/brain/*/.system_generated/logs/transcript.jsonl` to calculate reasoning/thought tokens (char count / 4) and response tokens.
- **Skills-DB "By Call Type" breakdown**: Added tool call frequency/ratio with visual horizontal bar charts to `konoha savings`.
- **Period Savings Telemetry Refinement**: Replaced redundant `(100%)` column with actual estimated thought tokens per period (e.g. `(thought: 95.0k)`).
- **Agent-tier Cost Computation**: Calculates exact USD context input cost saved based on model tier (Flash: `$0.075/1M`, Pro: `$1.25/1M`).
- **Optimize Thought Tokens**: Embedded thought optimization rule directing agents to keep thought processes concise and implementation-focused.
- **Planning-to-File (Thought-to-Markdown)**: Integrated convention directing orchestrator/subagents to output complex plans to workspace plan markdown files (e.g. `plan.md`) instead of verbose conversation logs.
- **Main Agent Konoha-Files Boundary**: Updated orchestrator templates to mandate `konoha-files` MCP for all file reads and line greps.
- **Clean config on disk**: Automatically migrates and cleans `~/.agents/agents.json` to remove hardcoded checklists.
- **Depth Calculation Correction**: Fixed loop counter reset bugs in nested task structures by loading depth metadata from both incoming and target `delegate.md` directories.
- **Symmetric Provider Breakdown Columns**: Widened table columns to 20 chars, split `antigravity` into `Antigravity IDE` and `Antigravity CLI`, formatted tokens with `Token` suffix.
- **`konoha saving` alias**: Added `saving` as a routed alias for `savings`.
- **Package Manager Mandate**: Strictly forbids `npm` or standalone `npx`; mandates `pnpm` exclusively for package installation/building.
- **Cross-Platform Install Fixes**: Fixed `konoha` command not found after nvm version switch on all platforms (Linux, macOS, Windows nvm-windows).
- **Node.js Version-Agnostic Install**: Konoha now works with any Node.js version (v18+) via global pnpm installation.
- **Python Cross-Platform Detection**: `platform_utils.js` handles Windows (`py -3`, `python`), macOS (`python3`, `python`), and Linux (`python3`, `python`).
- **Windows Line-Ending Fix**: Added guidance for CRLF→LF conversion on `db_bridges.py`.
- **Windows Port 19999 Fix**: Added `netstat`/`taskkill` alongside `fuser` for port collision resolution.
- **Antigravity Windows Support**: Documented WSL2 recommendation for Antigravity on Windows.
- **Animation Removal**: Removed terminal animation code (`chidoriTransition`, `LIGHTNING_CHARS`, `CHIDORI_SPINNER_FRAMES`, `NO_ANIMATION`) from `bin/cli.js`.
- **Best Practices Cleanup**: Removed unused imports and constants from `bin/cli.js`.

### Removed
- **Bridge Quota Persistence**: Dropped `quota_unavailable_until` column from `bridges` table. Quota cooldown is in-memory only.
- **SQLite-Driven Dynamic Skills & Routing Table**: Dynamic resolution of ninja subagent skills configurations compiled at rule generation time by querying SQLite.
- **Dynamic Claude Code & Cursor Rules Mappings**: Rule files now receive fully dynamic, database-driven skill tables.
- **Removed Profiling Leftovers**: Deleted `prof_timings.js`, `prof_autosetup.js`, `bin/cli_inst.js`.
- **Bridge Storage Migration (JSON → SQLite)**: `~/.konoha/bridges.json` flat-file replaced by SQLite-backed persistence in `skills.db` (`bridges` table). Legacy JSON auto-migrated.
- **Stream Inactivity Timeout**: Removed gateway-level 45-second inactivity kill window and 5-minute absolute max duration.
- **`ag-local-bridge` VS Code Extension Shell**: Removed `src/bridge/extension.js` and interceptors. Bridge functionality fully reproduced by in-process `konoha-files` MCP server.
- **Removed `konoha render`**: Deleted the visual comparison command and `src/visual_compare.py`.

### Security
- **Tightened Sidecar Coupling**: Bridge no longer holds a TCP listener open when the user's Antigravity session is closed. A bridge port is only reachable when Antigravity is explicitly open.
- **`konoha-files` workspace path sandbox**: Standardized path bounds checking in `file_tools_mcp.js` (JS) and Python workers to enforce a strict workspace path sandbox and reject absolute traversal attempts.
- **Safe Bounded Request Body Parsing**: Limited payloads to 200MB in `gateway.js` and `utils.js` to prevent OOM crashes while supporting modern high-context LLMs.
- **Consecutive Tool Message Validation**: Fixed logic bug where assistant's multiple tool calls were partially checked against only a single next message.
- **Bridge Gateway Preservation Guard**: Safety guardrail (`NEVER touch stable Bridge Gateway`) built into all rule templates and agent instructions.

### Fixed
- **Savings Token Attribution**: Fixed `db_savings.py` where `jonin` output tokens were erroneously calculated at the Pro tier rate instead of Flash tier.
- **Claude Code MCP Namespacing**: Fixed dot-notation MCP tool calls (`konoha.find_skill`) to use double-underscore format (`mcp__konoha__find_skill`) in all Claude Code configurations.
- **Claude Code Subagent Delegation Bug**: Fixed subagents being generated with orchestrator-centric protocols (`delegate.md`, `~/.agents/AGENTS.md`) causing failures in single-agent Claude Code environment.
- **Claude Code Subagent MCP Tool Permissions**: Fixed wildcard bug — prefixes corrected from `mcp_semble_*` to `mcp__semble__*`, `mcp__konoha__*`, `mcp__konoha-files__*`.
- **Dynamic Model Selection in CLI**: Model configuration wizard and commands now dynamically query active LLM Proxy Gateway bridges.
- **HTTP/2 Unary Connection Timer Leak**: Fixed `setTimeout` timers not cleared on promise settlement in `rpc.js`.
- **Claude Code MCP Permissions**: Resolved Konoha MCP servers failing to execute inside Claude Code via automatic user-level permission granting in `~/.claude/settings.json`.
- **CLI Client Telemetry Attribution**: Fixed client resolution so `agy` CLI tool calls are attributed correctly.
- **Database & Custom Skills Preservation on Uninstall**: `cmdUninstall` now preserves `skills.db*` and leaves custom user skills untouched.
- **Subagent Discovery Across Surfaces**: Fixed custom subagents not listed in prompt — deployment now reaches CLI and IDE global agents directories.
- **`readline` ReferenceError in `konoha skill search`**: Fixed by importing Node.js `readline` in `src/skill_manager.js`.
- **Semble Call Parsing in Combined Savings**: Fixed regex patterns for suffix-formatted counts (`1.0k`, `1.5M`).
- **Cursor session start hook ReferenceError**: Fixed `deployUtils is not defined` in `src/cursor_bootstrap.js`.
- **Session isolation boundary leak**: Excluded Cursor projects search from `brain_dirs` in `detect_active_agent()` when `ANTIGRAVITY_CONVERSATION_ID` is set.
- **Subagent delegation LLM parsing**: Removed model tier annotations from templates; restored `buildDefineSubagentArgs` helper to prevent runtime crashes.
- **`ensureAutoSetup()` never invoked**: Restored silent auto-bootstrap on every `konoha` command.
- **Cursor path visibility**: `server.py` now allows `~/.cursor/` and `.cursor/skills` paths in workspace scoping checks.
- **`konoha agent status` Antigravity attribution**: `detect_active_agent()` no longer false-positives on `VIEW_FILE` transcript lines.
- **`tokubetsu-jonin` mis-attribution**: Subagent scan order now checks `tokubetsu-jonin` before `jonin`.
- **Protected default subagents**: `konoha agent delete` rejects removal of official ninja agents.
- **`agent_stats.py` counters**: Aggregates with `GROUP BY LOWER(agent)` for case-insensitive totals.
- **Cursor agent telemetry**: `detect_active_agent()` scans `~/.cursor/projects/*/agent-transcripts/` for recent delegations.
- **Cursor vs Antigravity ranking**: Session ranking uses transcript mtime so Cursor MCP calls aren't masked by Antigravity hooks.
- **Removed dead `cursor_prompt_hook.js` reference**: Deleted from `cursor_manager.js`.
- **`find_skill` ranking**: Results preserve BM25 order after workspace visibility filtering.
- **Antigravity real subagent delegation**: `konoha-subagent-hook` PreInvocation hook calls `define_subagent` programmatically at session start.
- **`build_from_source` image-to-code**: Correctly sets `image_to_code_required`, `required_skills`, `skill_load_sequence`, `delegate_constraints`, absolute image paths when mockup images detected.
- **Jonin skill bootstrap**: Instructions and `delegate.md` rules require loading all `required_skills` via `get_skill`.
- **`konoha migrate` quality**: `optimize_content()` is now lossless-safe; deprecated skills purged after each migrate.
- **Subagent Identity Spawning (Antigravity CLI)**: Removed `hidden: true` from `antigravity_manager.js` deployer.
- **Null argument crashes**: Added null checks for `build_from_source` and `build_from_text` required arguments.
- **File traversal cap bypass**: Fixed 100-file limit in `build_from_source` directory scanning.
- **Missing `model` parameter in subagent config**: Fixed `src/agent_manager.js` to correctly inject the `model` property.
- **Safe JSON merge**: No longer resets user MCP config on parse errors in `mcp_clients_manager.js`, `cursor_manager.js`, `bin/cli.js`.
- **`konoha init` refresh path**: When DB exists (without `--force`), still syncs server files and refreshes MCP integrations.
- **`ensureAutoSetup` project guard**: Silent bootstrap no longer deploys `.cursor/` into arbitrary working directories.
- **Cursor transcript ordering**: `server.py` prefers most-recent `.jsonl` for Cursor subagent attribution.
- **Deploy utils**: `copyRecursiveIfDifferent` tolerates broken symlinks.

- **Enhanced SvelteKit Skills Reference**: Added advanced Svelte 5 accessibility guidelines, verification pipeline (`svelte-check`, tsc, `pnpm lint`), SSR hydration safety, and image-to-code layout similarity comparison loops.
- **`yaml_parser` Migration Module Fix**: Deployed `yaml_parser.py` resolving `ModuleNotFoundError` during `konoha migrate`.
- **Subprocess Buffer & Event Loop Protections**: Configured Node `maxBuffer` to 1GB across all router spawns; ensured proper `child.unref()` and `process.stdin.pause()` cleanup.

### Documentation
- **Architecture diagrams**: Removed fictional "LLM Model Registry / Fallback Router" layer — Konoha does not implement multi-provider LLM routing.
- **Live benchmarks**: `docs/BENCHMARK.md` refreshed with `konoha savings` metrics.
- **konoha-maintenance skill**: Sections 17–21 cover multi-CLI setup, workspace-local skills, path sandbox, release QA gates, and attribution fixes.
- **RTK (Rust Token Killer) Documentation**: Documented RTK auto-deployment to all clients, rule file locations, and `rtk` CLI usage patterns.
- **CLI TUI**: Gradient styling and dynamic table widths in `konoha doctor`, `konoha status`, and installer output.
- **konoha-files MCP fixes**: Cross-platform `file_tools_launcher.js`; 6 tools; Cursor MCP uses `node` + launcher; `platform_utils.js` for Windows `file://` URIs, tilde paths, and `py -3` Python detection.
- **Cross-platform QA**: Path sandbox `normcase` on Windows; `.node_exec_path` and `.python_cmd` records; test counts are reported from the discovered runner inventory.
- **Separate Feature Diagrams**: Split monolithic `docs/LLM-BRIDGE-GATEWAY.md` into dedicated visual architectures for Konoha Bridge Router and LLM Bridges.
- **Preflight & Ignores Documentation**: `find_files_clean` path ignores (`go-dist` / `vendor`) and Proxy Gateway preflight token count mocking documented in konoha SKILL.md.
- **Installation/Setup Guides Updated**: README, ARCHITECTURE, SETUP-IDE, SETUP-CLI, SETUP-CURSOR, TROUBLESHOOTING, and konoha SKILL updated for v2.0.0 multi-client support, orchestrator pipeline, semble-default search, konoha-files MCP, and RTK auto-deployment.

### Release QA (v2.0.0)
- **Attribution**: `test_agent_attribution.py` 7/7, `test_cursor_attribution.py` 8/8.
- **MCP**: `konoha test` and `konoha doctor --yes` are release gates; exact counts come from the current runner output.
- **Security**: `konoha-files` workspace path sandbox (JS + Python).
- **Install repair**: `deploy_utils.js`, `registerHooks(true, true)`, semble args repair, Cursor project MCP merge, `cursor_bootstrap.js` konoha-files + semble policy.
- **RTK**: RTK rule files deployed to `~/.gemini/antigravity-cli/rules/`, `~/.gemini/antigravity-ide/rules/`, `~/.cursor/rules/`, and `~/.claude/rules/` on init (gracefully skipped when `rtk` binary absent).
- **Cross-platform**: nvm PATH fixes verified on Linux, macOS, Windows nvm-windows.
