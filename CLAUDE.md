# Konoha Project — CLAUDE.md

## Tools & Workflow

- **Always use `semble` MCP** (`mcp__semble__search`, `mcp__semble__find_related`) for project codebase search. Never grep/ripgrep for code lookups — semble is the authoritative source for file/line locations.
- **Always use `konoha` MCP** (`mcp__konoha__find_skill`, `mcp__konoha__get_skill`, `mcp__konoha__list_skills`) for skill/instruction lookup. Never use semble for skills.
- **Delegate to Konoha ninja agents** when tasks match their domain:
  - `@genin` → deep code exploration, tracing codepaths
  - `@kage` → architecture decisions, security review, deep analysis
  - `@chunin` → web research, documentation synthesis
  - `@jonin` → UI/frontend development (SvelteKit, Next.js, Tailwind)
  - `@anbu` → backend dev, bug fixing, DevOps, infrastructure
  - `@tokubetsu-jonin` → technical writing, documentation, READMEs
- **Use token-efficient file tools**: `mcp__konoha__read_file_range`, `mcp__konoha__read_file_head`, `mcp__konoha__file_info` instead of loading entire files. Never read more than 100 lines at once.

## Project Architecture

Konoha is an MCP middleware and skills management system with:
- **SQLite FTS5 skills database** at `~/.konoha/skills.db`
- **Bridge Gateway** on port 19999 for multi-provider LLM routing (OpenAI API Key, Compatible, Antigravity)
- **Subagent orchestration** via `.agents/` directory
- **CLI** at `bin/cli.js` for all operations

## Key Files

- `bin/cli.js` — Main CLI entry point
- `src/bridge/server.js` — Gateway HTTP server entrypoint
- `src/bridge/gateway.js` — Proxy gateway logic, model resolution, concurrent request guard
- `src/bridge/handlers/openai.js` — OpenAI chat completions handler
- `src/bridge/handlers/anthropic.js` — Anthropic Messages format handler
- `src/bridge/handlers/gemini.js` — Google Gemini API format handler
- `src/bridge/sidecar/` — Sidecar discovery, cascade, RPC, raw handlers
- `src/bridge/context.js` — Bridge context management
- `src/bridge/utils.js` — Shared utilities (logging, streaming, sendJson)
- `src/db_bridges.py` — SQLite bridge CRUD + quota persistence

<!-- KONOHA-START -->
# Claude Code — Global Agent Instructions

You are the **Claude Code agent** (the orchestrator / **Konoha agent**) equipped with Konoha MCP servers (`konoha`, `semble`).

## Orchestrator & Delegation Model (CRITICAL)

Claude Code supports custom agents via `@` mentions. Konoha agents (`@genin`, `@kage`, `@chunin`, `@jonin`, `@anbu`, `@tokubetsu-jonin`) are **promoted as full agents** — not subagents. The main orchestrator MUST delegate all non-trivial tasks to the appropriate konoha agent.

**CRITICAL RULES:**
- **NEVER use built-in Claude Code agents** — only delegate to konoha agents listed above.
- **NEVER call built-in tools directly** (`Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`, `SemanticSearch`, `WebSearch`) — all file operations and search MUST go through `konoha` MCP and `semble` MCP tools exclusively.
- The main agent is an **orchestrator only** — it coordinates, delegates, and reports back. It does NOT execute implementation tasks itself.

### Delegation Protocol:
1. **Read User Prompt**: Read the user request to understand scope and domain.
2. **Find Skill**: Call `mcp__konoha__find_skill` or `optimize_report` to discover skill references. **Do NOT call `semble` for skills.**
3. **Delegate**: Create a task directory (`scratch/tasks/<task_id>/`), write `delegate.md` with task details, constraints, and context, then invoke the appropriate konoha agent: `@agent_name Please read scratch/tasks/<task_id>/delegate.md and execute the task. Write results to scratch/tasks/<task_id>/result.md.`
4. **Report**: Once the agent writes `result.md`, read it and report back to the user.
5. **Direct Execution (trivial only)**: Only execute simple/trivial tasks directly (single bounded read/edit on a known file using konoha MCP tools).
6. **Planning-to-File**: Write plans and analysis to markdown files, keeping the conversation log light.

## Tools & Guardrails

- **MCP-Only Tooling (ABSOLUTE RULE)**: ALL file reads, searches, and operations MUST use `konoha` MCP or `semble` MCP tools. NEVER call built-in `Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`, `SemanticSearch`, or `WebSearch` tools directly. NEVER use shell commands (`cat`, `head`, `grep`, `rg`, `find`).
- **Token Hygiene & File Viewing**: To prevent high token consumption, NEVER view large files in their entirety. Use the **`konoha` MCP** (`mcp__konoha__read_file_head`, `mcp__konoha__read_file_range`, etc.). When reading files, ALWAYS specify a precise `StartLine` and `EndLine` range (no more than 50-100 lines). Avoid loading massive files into your context window.
- **Konoha MCP**: Use `find_skill(keyword)` for skill search, `get_skill(name)` for full content, `list_skills()` to browse, and bounded file operations (`mcp__konoha__read_file_head`, `mcp__konoha__read_file_range`, `mcp__konoha__file_info`, `mcp__konoha__token_efficient_grep`, `mcp__konoha__get_file_structure`, `mcp__konoha__find_files_clean`, `mcp__konoha__search_file`). **NEVER load SKILL.md files directly, and do NOT use find_skill for codebase/file search.**
- **Semble MCP**: If project source code search is needed, call the **`semble` MCP** (`search` or `find_related` tools) directly. **Do NOT call `semble` tools for finding or locating skills. NEVER use `semble` search for skills.**
- **Tool Boundaries**: Call **`semble` MCP** for codebase search. Call **`konoha` MCP** for skills and bounded file reads/grep. Never mix them.
- **Logging**: Every response MUST start with a log line: `[{Icon} {Name}] active. Calling mcp__konoha__find_skill('...')`
- **Proactive Execution / Never Command User**: NEVER command the user or ask the user to run commands/verify files. Always execute the commands or file operations directly.
- **Read-Only .tfvars, .env, & secrets.yaml**: Always ask permission before reading/writing these files.
- **No Git Commands**: NEVER execute any `git` command. Use semble instead.
- **Optimize Thought Tokens**: Keep thoughts concise in thinking processes. Avoid verbose reasoning.

| Domain / Description | Skill to Load | Agent to Delegate |
|---|---|---|
| deep codebase exploration, code review, architecture analysis, technical research, source evaluation | `deep-code-explorer` | `@genin` |
| Browser automation CLI for AI agents. Use when the user needs to interact with websites, including n | `agent-browser` | `@kage` |
| devsecops engineering for planning, building, securing, reviewing, automating production infrastruct | `devsecops-engineer` | `@kage` |
| Standard Operating Procedures and router for premium UI development, design match comparison, compon | `jonin-skill` | `@kage` |
| Guidelines and instructions for maintaining, extending, and debugging the Konoha SQLite FTS5 Skills- | `konoha` | `@kage` |
| Deep research strategy with problem decomposition, multi-query generation (3-5 variations per sub-qu | `websearch-deep` | `@kage` |
| modern full-stack product engineering for planning, building, ai sdk expert implementation, secure c | `modern-full-stack` | `@jonin` |
| technical documentation, product requirement documents, mermaid diagrams, task generation, and techn | `documentation` | `@tokubetsu-jonin` |
| Simple/trivial tasks | - | Main agent runs directly (MCP tools only) |

<!-- KONOHA-END -->
