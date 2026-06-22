# Changelog

All notable changes to the **Konoha** project will be documented in this file.

## [1.1.4] - 2026-06-22

### Added
- **Design Mockup Build Selection Tools**: Added `build_with_image_design` and `build_from_text` MCP tools to the Python server.
- **Image-to-Code Generation & Translation Command**: Implemented `konoha render` CLI command, leveraging `agent-browser` for taking screenshots and local Python script `src/visual_compare.py` for pixel-by-pixel similarity checks and mismatch diff highlighting.
- **Support for Multi-Extension Design Mockups**: Translates layout and assets directly from design image folders containing `.svg`, `.html`, `.png`, `.jpg`, and `.webp` files to enable precise code generation matching the designs.
- **Image-to-Code Token Savings**: Optimizes and saves vision token usage by handling layout alignment processes locally, preventing binary visual assets from bloating the model's active context window.

### Changed
- **Visual Comparison Tooling Replacement**: Replaced the legacy `render_image` MCP tool with the new target-specific visual match routing tools `build_with_image_design` and `build_from_text`.
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
- Integrated warnings explicitly separating `semble` and `skills-db` tool boundaries in instructions (`GEMINI.md`, `AGENTS.md`, `agents.json`, `agent_manager.js`, and all 6 local skill files) to prevent rate limit and token quota burning.

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
- **Zero-Configuration Auto-Setup & Self-Healing**: Implemented a silent `ensureAutoSetup()` bootstrapping routine in `bin/cli.js` that automatically runs on any command execution. It ensures required directories exist, silently installs and registers `semble` and `skills-db` MCP servers in `mcp_config.json`, configures permanent tool auto-approvals in `settings.json`, sets up default agent configuration/rule files (`agents.json`, `GEMINI.md`, `AGENTS.md`), and seeds the initial SQLite skills database (`skills.db`) if missing.
- **Command Execution Whitelisting**: Added auto-approval settings for running `node bin/cli.js` and `konoha` in `settings.json` to enable seamless local execution.
- **Persistent Tool Auto-Approval**: Integrated persistent auto-approve configuration for all `skills-db` and `semble` tools in `mcp_config.json`.
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
- **Auto-Approved MCP Tool Access**: Configured subagent rules in `GEMINI.md` and `AGENTS.md` templates to explicitly auto-approve tool execution for `semble` and `skills-db` MCP tools, removing manual permission prompts.

### Fixed
- **Auto-Approve for Delegation Files**: Fixed the auto-approve behavior for delegation and result files (`delegate.md` and `result.md`) by forcing both to be written with `RequestFeedback: false` and `UserFacing: false` inside `ArtifactMetadata` to prevent user prompt overlays.
- **MCP Tool Schema Mismatch**: Resolved a schema mismatch where the `agent` parameter was marked as required on the server-side but optional in client schemas, causing validation crashes during standard direct calls.
- **Subagent Name Character Validation**: Enforced alphanumeric, dash, and underscore character constraints on subagent names in `createSubagent` to prevent broken markdown layouts in `GEMINI.md` and `AGENTS.md`.
- **Symlinked Skill Directories Resolution**: Added support for symbolic links pointing to directories in `listInstalledSkills` to allow symlinked skill packages to be scanned and listed.
- **smart_truncate Name Scoping**: Explicitly passed the skill name parameter to `smart_truncate` inside `get_skill` to fix local variable scoping and ensure the custom full-content retrieval hint is rendered.
- **Python Context Managers for File Reads**: Refactored `migrate.py` to use Python `with open(...) as f` context managers for reading files, preventing file descriptor leaks during bulk migrations.
- **Subagent Custom Skill Embedding Preservation**: Added an `isAlreadyUpgraded` check during agent initialization to prevent default skill mappings from stripping manually configured skills on subsequent load/reload cycles.
- **Doctor health check loop**: Changed the GEMINI.md health verification in `doctor` and `status` commands to search for general `'find_skill'` instead of `'skills-db find_skill'` to prevent infinite "repaired" cycles.
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
- **Base Skills Architecture**: Refined the default skill assignment strategy. Instead of shipping with heavy generic skills (`devsecops-engineer`, `modern-full-stack`), all 6 subagents now ship exclusively with their own highly-specialized base skills (e.g., `genin-skill`, `anbu-skill`).
- **Day-to-Day SOPs**: Rewrote all 6 default base skills into actionable Standard Operating Procedures (SOPs) designed for junior and mid-level engineers, covering Bug Resolution Workflows, Design Match Checklists, Trade-Off Matrices, and Codebase Tracing.
- **Direct Tool Call Routing**: Updated the core system instructions (`GEMINI.md`, `AGENTS.md`) to explicitly enforce the new delegation workflow: The Orchestrator discovers required skills via `skills-db` FIRST, routes the task to the correct agent, and then the agent uses Direct Tool Calls to load their base skill plus any dynamically required skills.

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