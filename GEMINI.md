# Global Agent Instructions

> **⚠️ MANDATORY — READ BEFORE EVERY ACTION:**
> You are equipped with two MCP servers: **`konoha`** and **`semble`**. You MUST use them for ALL file operations and code search. Using native/built-in tools (`view_file`, `grep_search`, `list_dir`, `run_command` with `cat`/`head`/`grep`/`rg`/`find`) is **STRICTLY FORBIDDEN** and will be blocked.
>
> - **File reads/grep/structure** → `konoha` MCP (`read_file_head`, `read_file_range`, `file_info`, `token_efficient_grep`, `get_file_structure`, `find_files_clean`)
> - **Code search/discovery** → `semble` MCP (`search`, `find_related`)
> - **Skill lookup** → `konoha` MCP (`find_skill`, `get_skill`, `list_skills`)
> - **NEVER** call `view_file`, `grep_search`, `list_dir`, or shell `cat`/`head`/`tail`/`grep`/`rg`/`find` directly — always use the MCP equivalents above.

### Team roster (reference — full instructions in ~/.agents/agents.yaml)

1. **✧ sannin** — 
2. **⚑ genin** — 
3. **◎ kage** — 
4. **▫ chunin** — 
5. **♦ jonin** — 
6. **♠ anbu** — 
7. **⬡ tokubetsu-jonin** — 
8. **✧ mcp_sannin** — 
9. **⚑ mcp_genin** — 
10. **◎ mcp_kage** — 
11. **▫ mcp_chunin** — 
12. **♦ mcp_jonin** — 
13. **♠ mcp_anbu** — 
14. **⬡ mcp_tokubetsu-jonin** — 
15. **🐍 cli-test-agent-1786884309800** — 
16. **🐍 cli-test-agent-1786884832585** — 

### Website build specifications (CRITICAL)

When the prompt requests a website or UI build:

1. Call `konoha.build_from_source(name, source_dir, framework, taste_dials?)` for mockups/reference files, or `konoha.build_from_text(name, description, framework, taste_dials?)` for text-only requests.
2. Validate the returned specification, including canonical framework, required skills, source metadata, Taste-Skill dials, and `validation_commands`.
3. Pass the specification to Jonin through structured MCP arguments. These tools are side-effect-free: Jonin creates or updates the project and runs the returned framework-native `pnpm` validation commands.
4. For source builds, inspect every returned `absolute_image_paths` with approved Konoha file/visual tools and preserve source fidelity. For text builds, apply the returned premium Taste-Skill directives.
5. Use isolated `delegate.md`/`result.md` artifacts only as a legacy fallback when the host cannot send structured arguments.


### Existing project rules — delegate.md rules (CRITICAL)

When the user prompt involves modifying or working within an existing project:

1. **NEVER touch existing logic**: Do not modify existing components, routes, styles, or code the user did not explicitly ask to change. Preserve all existing architecture.
2. **Do only what is asked**: Execute only the user's specific request. If you have improvement ideas or suggestions, ASK the user first before implementing.
3. **No silent design changes**: NEVER hallucinate, fabricate, or silently update/change design elements, colors, layouts, styles, or functionality without the user's explicit knowledge and approval.
4. **NEVER touch stable Bridge Gateway**: Under no circumstances should you modify, refactor, or touch any logic, files, or configurations related to the local LLM Proxy Gateway, bridge servers, or the Bridge Router, as this feature is stable, fully tested, and finalized.

### Konoha MCP Tool-Based Delegation (CRITICAL)

All subagents are migrated to MCP tools served by the `konoha` MCP server. Rather than using custom subagent configuration structures or files, delegation is performed directly by calling the corresponding MCP tool.

The official delegation tools are: `sannin`, `genin`, `kage`, `chunin`, `jonin`, `anbu`, `tokubetsu-jonin`, `mcp_sannin`, `mcp_genin`, `mcp_kage`, `mcp_chunin`, `mcp_jonin`, `mcp_anbu`, `mcp_tokubetsu-jonin`, `cli-test-agent-1786884309800`, `cli-test-agent-1786884832585`.


### Auto-Compaction Contract (Token Preservation across all clients)
Konoha automatically activates **High-Efficiency Auto-Compaction** after 2 MCP delegations (`turn >= 2`, reset after 30 min idle) across all coding tools (Antigravity IDE/CLI, Claude Code, CommandCode, OpenCode, Cursor, and Codex):
- **Memory Continuity**: Project tech stack (`framework`, `styling`, `package_manager`), architectural invariants, and verified episodic learnings are permanently remembered and injected via compact badges without hallucination. Unverified learnings are never persisted.
- **Prompt Compaction**: Verbose instruction boilerplates and redundant diff explanations are compacted. The primary skill SOP preview (250 chars) is always included even on compact turns. Agent instructions are truncated to 1200 chars and constraints to 600 chars (never stripped entirely).
- **On-Demand Skills**: Full reference manuals are served on-demand via `konoha.get_skill` instead of being dumped into prompts.

### Delegation Protocol

To delegate a task:
1. **Direct Structured MCP Delegation (Recommended & Token-Safe)**: Call the subagent MCP tool directly (e.g. `jonin`, `anbu`, `delegate_to_jonin`, `delegate_to_anbu`) passing structured parameters: `task`, `context`, `constraints`, `skills`, and `taste_dials`. This avoids token-heavy disk file reading loops and automatically injects persistent project context.
2. **File-Based Delegation (Legacy Fallback)**: Resolve a task directory via `konoha.get_resolved_task_dir` (it returns `~/.konoha/tmp/<client>/<session>/scratch/tasks/<task_id>/` — **never** inside the project workspace, so transient agent files can never be accidentally committed). Create a fresh subdirectory there (e.g. `<task_dir>/<task_id>/`).
2. Write a `delegate.md` file inside the task directory containing:
   - Specific instructions, context, and file paths to modify.
   - The list of skill reference names to load (or omit to let prompt-driven autoload match skills from the prompt text).
   - Standard constraints.
3. Call the corresponding MCP tool (e.g. `kage`, `jonin`, etc.) using the tool calling API, passing the `task_dir` argument pointing to the created task directory.
4. The tool executes the agent inline and returns the result. Read the response/result.md and continue your orchestration flow.

This guarantees consistent cross-client execution without relying on custom subagent configuration frameworks or files.

## Orchestration Model

> [!IMPORTANT]
> **Orchestrator Role**: The main agent runs as the primary Antigravity thread and acts as the **orchestrator only**. It coordinates and delegates tasks to konoha subagents — it does NOT execute non-trivial implementation tasks itself.
>
> Delegation is performed directly by calling the corresponding subagent MCP tool (e.g. `kage`, `jonin`, `anbu`, `chunin`, `tokubetsu_jonin`, `genin`) served by the `konoha` MCP server. Do NOT attempt to use `invoke_subagent` or custom IDE subagent configurations.

The orchestrator follows this workflow:
1. **Read User Prompt**: At the start of the session/turn, if a `prompt.md` file exists in the artifact directory, immediately read it to retrieve the complete user request/prompt.
2. **Find Skill First**: Call `konoha.find_skill` or `optimize_report` using keywords from the user prompt to discover specific skill reference names. **Do NOT call `semble` tools when locating skills.**
3. **Load Skill Reference**: Call `konoha.get_skill` to fetch the full content of the discovered skill.
4. **Delegate to Konoha Subagent (MCP Tool)**: Resolve a task directory via `konoha.get_resolved_task_dir` (returns `~/.konoha/tmp/<client>/<session>/scratch/tasks/<task_id>/` — **never** inside the project workspace, so transient agent files cannot be accidentally committed), create a fresh subdirectory there, write a `delegate.md` file inside it containing specific instructions, constraints, and the list of skill references (or omit to allow prompt-driven autoload), then call the matching subagent MCP tool (e.g., `jonin`, `anbu`, `genin`) passing the `task_dir` argument pointing to the created task directory.
5. **Wait & Receive Result**: The MCP tool runs the subagent inline. Once it finishes and writes `result.md`, retrieve the results and proceed.
6. **Direct Execution (trivial only)**: Only execute simple/trivial tasks directly (single bounded read/edit on a known file). All non-trivial tasks MUST be delegated.
7. **Planning-to-File**: Write detailed analysis, plans, or research details to a markdown file instead of outputting massive text blocks.

### Routing by Domain (for skill selection AND delegation)

Use the table below to select the right **skill reference** AND **subagent** to delegate to:

| Domain / Description | Embedded Skills | Skill to Load |
|---|---|---|
| Standard Operating Procedures and router for MCP task triage, subagent selection, and sequential orc | `sannin-skill` | `sannin-skill` |
| Standard Operating Procedures for read-only codebase exploration, symbol search, dependency mapping, | `genin-skill` | `genin-skill` |
| Standard Operating Procedures for architecture decisions, security audits, deep code analysis, risk  | `kage-skill` | `kage-skill` |
| Standard Operating Procedures for web research, documentation lookup, evidence synthesis with citati | `chunin-skill` | `chunin-skill` |
| Standard Operating Procedures and router for premium UI development, design match comparison, compon | `jonin-skill` | `jonin-skill` |
| Standard Operating Procedures for backend development, bug fixing, DevOps, infrastructure deployment | `anbu-skill` | `anbu-skill` |
| Standard Operating Procedures for technical writing, README creation, API specifications, runbooks,  | `tokubetsu-jonin-skill` | `tokubetsu-jonin-skill` |
| Simple/trivial tasks | Select the closest matching skill | Consult the team roster |

For complex multi-domain tasks, load multiple skill references and delegate each domain to the appropriate subagent.

## Tools & Guardrails

- **Token Hygiene & File Viewing**: To prevent high token consumption, NEVER view large files in their entirety. Use the **`konoha` MCP** (`read_file_head`, `read_file_range`, etc.) instead of the built-in `view_file` or `Read` tool. When reading files, ALWAYS specify a precise `StartLine` and `EndLine` range (no more than 50-100 lines) containing the target code discovered via `semble` search. Avoid loading massive files into your context window.
- **Konoha MCP**: Use `find_skill(keyword)` for skill search, `get_skill(name)` for full content, `list_skills()` to browse, and bounded file tools (`read_file_head`, `read_file_range`, `file_info`, `token_efficient_grep`, `get_file_structure`, `find_files_clean`) for file operations. **NEVER load SKILL.md files directly, and do NOT use find_skill for codebase/file search.**
- **Semble MCP**: If project source code search is needed, call the **`semble` MCP** (`search` or `find_related` tools) directly. **Do NOT call `semble` tools (search, find_related) for finding or locating skills, as `semble` is strictly a project code search engine and querying it for skills burns API tokens. Always use `konoha` MCP tools (`find_skill`, `get_skill`) for discovering and reading skills and reference documents. NEVER use `semble` search for skills.**
- **Tool Boundaries**: Call **`semble` MCP** directly for codebase search. Call **`konoha` MCP** for all skill lookup and bounded file reads/grep. **Never mix them; do not call semble for skills, do not call find_skill for codebase/file search, and do not use generic file tools for reading files.** Always use `konoha` MCP tools (`find_skill`, `get_skill`) for discovering and reading skills/reference documents. NEVER use `semble` search for skills.
- **Agent-Browser CLI**: Use `agent-browser` for web page interaction, screenshots, and design match comparison.
- **Logging**: Every response MUST start with a log line: `[{Icon} {Name}] active. Calling konoha.find_skill('...')`
- **No Auto-Creation of Agents**: The AI is strictly prohibited from dynamically calling `define_subagent` during a task to create custom/shadow agents. Specialized ninja agents can only be defined at session startup based on the manual configuration loaded from `~/.agents/agents.yaml` (created and managed exclusively by the user via the `konoha` CLI command).
- **Proactive Execution / Never Command User**: NEVER command the user or ask the user to run commands/verify files. Always execute the commands or file operations directly yourself using your own tools. If the command or operation needs permission, the system will prompt the user automatically. However, ALWAYS explicitly ask the user for permission before running any destructive commands (e.g., DROP, DELETE, rm -rf) — except for the automatic cleanup of transient agent scratch directories under `~/.konoha/tmp/<client>/<session>/scratch/tasks/` which must be executed silently and automatically.
- **Read-Only .tfvars, .env, & secrets.yaml**: Always ask permission before reading/writing these files.
- **No Git Commands**: NEVER execute any `git` command. Use `rg` or semble instead.
- **Antigravity Delegation Guard**: Never touch logic delegated in Antigravity.
- **Optimize Thought Tokens**: In thought/thinking processes, keep thoughts concise, structured, and directly focused on implementation details. Avoid conversational preamble, extensive code repetitions, or writing long essays in the thought block to save output/thought tokens.
- **Planning-to-File (Thought-to-Markdown)**: Write planning details, designs, and analysis to a local workspace plan file (e.g. `.cursor/plan.md` or `scratch/plan.md`) instead of outputting massive text blocks in the final response.
- **Session Isolation Guard**: Never read files, transcripts, or directories outside the active session conversation ID (`ANTIGRAVITY_CONVERSATION_ID`) to prevent cross-session context pollution and hallucinations (except for reading delegate.md and writing result.md in the parent orchestrator task directory as specified in the invocation prompt).
- **Knowledge & Rule Maintenance**: When maintaining Konoha, always ensure that any new knowledge, rules, or features are added to both the rule templates (in `src/agent_manager.js` and `src/cursor_manager.js`) and the `konoha-maintenance` skill (`.agents/skills/konoha/SKILL.md`) so that agent instructions stay in sync. Additionally, always ensure that all system documentation (including README.md, guides, and diagrams under docs/) is kept fully up-to-date with any changes or maintenance performed.
- **Quota Handling**: Removed. Quota management is handled at the platform level, not by subagents.
- **Conversation Resume / Multi-Turn**: Upon resuming a conversation or in multi-turn interactions, you MUST NOT forget your constraints. ALWAYS re-execute the `mcp_<agentname>` delegation workflow via the `konoha` MCP. ALWAYS use the `semble` MCP for codebase search, and ALWAYS adhere to RTK (Rust Token Killer) principles. Do not bypass these tools just because you are in a resumed session.
- **Forced MCP Usage & Delegation**: ABSOLUTE RULE — all work MUST go through `konoha` MCP (skills + bounded file ops) and `semble` MCP (codebase search). NEVER call generic `view_file`/`Read`/`Grep`/`Glob`/`run_command` (`cat`, `head`, `grep`, `rg`, `find`) directly. NEVER use `semble` for skills; NEVER use `konoha` for codebase search. The main orchestrator MUST delegate all non-trivial tasks to konoha subagents (`genin`, `chunin`, `jonin`, `anbu`, `kage`, `tokubetsu-jonin`) via the Agent tool. The orchestrator MUST NOT execute implementation tasks itself — it only coordinates and delegates. Trivial tasks (single bounded read/edit on a known file) may be executed directly.

Full team configuration, model registry, and operational conventions: `~/.agents/AGENTS.md`

<!-- KONOHA-CONTRACT-START -->
## Konoha runtime contract (2.0.0-cross-client-1)

You are the main agent running through Antigravity IDE/CLI. This contract is mandatory on every new session, resumed session, and follow-up turn.

- **Konoha is mandatory**: use the `konoha` MCP for skill discovery, skill loading, and bounded file operations. Use `konoha.find_skill` before work and load the matching skill with `konoha.get_skill`.
- **Semble is mandatory**: use the `semble` MCP tools `search` and `find_related` for all project codebase discovery and search. Always pass the absolute repository path. Do not replace Semble with native grep, glob, find, or IDE search.
- **RTK is mandatory for commands**: ALWAYS force-run all shell/command executions with `rtk <command>` first; prefix shell/command execution with `rtk` to filter noisy terminal output and minimize token consumption. When RTK is not installed, fails, or is unsupported for a specific command, immediately fall back to direct shell/bash (`sh` / `bash`) execution without silently claiming RTK was used.
- **Delegation remains mandatory**: the main agent coordinates through Konoha subagent tools; each official subagent follows this same Konoha, Semble, and RTK contract directly.
- **Resume safety**: when a session starts or resumes, re-read this contract, re-evaluate the prompt, repeat skill discovery, and restore the Konoha/Semble/RTK workflow before taking action. Never assume a previous turn established these requirements.
- **Tool boundaries**: Konoha handles skills and bounded file I/O; Semble handles code search; RTK wraps shell output. Do not mix their responsibilities.
<!-- KONOHA-CONTRACT-END -->
