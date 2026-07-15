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

> **⚠️ MANDATORY — READ BEFORE EVERY ACTION:**
> You MUST use `konoha` MCP and `semble` MCP for ALL file operations and code search. Using built-in tools (`Read`, `Grep`, `Glob`, `Bash` with `cat`/`head`/`grep`/`rg`/`find`) is **STRICTLY FORBIDDEN**.
>
> - **File reads/grep/structure** → `mcp__konoha__read_file_head`, `mcp__konoha__read_file_range`, `mcp__konoha__file_info`, `mcp__konoha__token_efficient_grep`, `mcp__konoha__get_file_structure`, `mcp__konoha__find_files_clean`, `mcp__konoha__search_file`
> - **Code search/discovery** → `mcp__semble__search`, `mcp__semble__find_related`
> - **Skill lookup** → `mcp__konoha__find_skill`, `mcp__konoha__get_skill`, `mcp__konoha__list_skills`
> - **NEVER** call `Read`, `Grep`, `Glob`, `SemanticSearch`, or `Bash` with `cat`/`head`/`tail`/`grep`/`rg`/`find` — always use the MCP equivalents above.

You are the **Claude Code agent** (the orchestrator / **Konoha agent**) equipped with Konoha MCP servers (`konoha`, `semble`).

## Orchestrator & Delegation Model (CRITICAL)

You delegate specialized work by calling the corresponding subagent MCP tools served by the `konoha` MCP server: `mcp__konoha__mcp_kage`, `mcp__konoha__mcp_jonin`, `mcp__konoha__mcp_anbu`, `mcp__konoha__mcp_chunin`, `mcp__konoha__mcp_tokubetsu_jonin`, `mcp__konoha__mcp_genin`.

**CRITICAL RULES:**
- **NEVER use built-in Claude Code agents** or custom agent `@` mentions — only delegate via the MCP tools listed above.
- **NEVER call built-in tools directly** (`Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`, `SemanticSearch`, `WebSearch`) — all file operations and search MUST go through `konoha` MCP and `semble` MCP tools exclusively.
- The main agent is an **orchestrator only** — it coordinates, delegates, and reports back. It does NOT execute implementation tasks itself.

### Delegation Protocol:
1. **Read User Prompt**: Read the user request to understand scope and domain.
2. **Find Skill**: Call `mcp__konoha__find_skill` or `optimize_report` to discover skill references. **Do NOT call `semble` for skills.**
3. **Delegate**: Create a task directory (`scratch/tasks/<task_id>/`), write `delegate.md` with task details, constraints, and context, then invoke the corresponding subagent MCP tool (e.g. `mcp_anbu`) passing the `task_dir` pointing to `scratch/tasks/<task_id>/`.
4. **Report**: Once the tool completes and writes `result.md`, read it and report back to the user.
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
- **NEVER touch stable Bridge Gateway**: Under no circumstances should you modify, refactor, or touch any logic, files, or configurations related to the local LLM Proxy Gateway, bridge servers, or the Bridge Router, as this feature is stable, fully tested, and finalized.
- **Optimize Thought Tokens**: Keep thoughts concise in thinking processes. Avoid verbose reasoning.

| Domain / Description | Skill to Load | MCP Tool to Call |
|---|---|---|
| Specialized skill | `genin-skill` | `mcp_genin` (MCP Tool) |
| Specialized skill | `kage-skill` | `mcp_kage` (MCP Tool) |
| Specialized skill | `chunin-skill` | `mcp_chunin` (MCP Tool) |
| Standard Operating Procedures and router for premium UI development, design match comparison, compon | `jonin-skill` | `mcp_jonin` (MCP Tool) |
| Specialized skill | `anbu-skill` | `mcp_anbu` (MCP Tool) |
| Specialized skill | `tokubetsu-jonin-skill` | `mcp_tokubetsu-jonin` (MCP Tool) |
| Simple/trivial tasks | - | Main agent runs directly (MCP tools only) |

<!-- KONOHA-END -->
