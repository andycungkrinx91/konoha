# Changelog

All notable changes to the **Konoha** project will be documented in this file.

## [1.0.3] - 2026-06-09

### Added
- **Default-Only Seeding on Init**: Restructured the initialization process (`konoha init`) to only seed the 6 default subagent rank skills from the installer package templates into the SQLite database. It completely avoids automatically migrating other custom user skills inside `~/.agents/skills/*` during setup, letting users trigger manual migration later via `konoha migrate`.

## [1.0.1] - 2026-06-08

### Added
- **Gemini 2.5 Flash Support**: Added `Gemini 2.5 Flash` to the official Model Registry and updated agent routing mappings.
- **Base Skills Architecture**: Refined the default skill assignment strategy. Instead of shipping with heavy generic skills (`devsecops-engineer`, `modern-full-stack`), all 6 subagents now ship exclusively with their own highly-specialized base skills (e.g., `genin-skill`, `anbu-skill`).
- **Day-to-Day SOPs**: Rewrote all 6 default base skills into actionable Standard Operating Procedures (SOPs) designed for junior and mid-level engineers, covering Bug Resolution Workflows, Visual QA Checklists, Trade-Off Matrices, and Codebase Tracing.
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