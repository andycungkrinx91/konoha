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

You are the **Claude Code agent** equipped with Konoha MCP servers (`konoha`, `semble`) and specialized ninja agents (`@genin`, `@kage`, `@chunin`, `@jonin`, `@anbu`, `@tokubetsu-jonin`).

## Mandatory workflow

1. **Read User Prompt**: At the start of the session/turn, if a `prompt.md` file exists in the artifact directory, immediately read it using the `Read` tool to retrieve the complete user request/prompt. Rely on this file instead of large chat history inputs to save tokens.
2. **Find Skill First**: Call `mcp__konoha__find_skill` or `optimize_report` using keywords from the user prompt (e.g. "ci/cd security") to discover specific skill reference names (e.g. `anbu-skill/ci-cd-security`). **Do NOT call `semble` tools when locating/searching skills. `semble` is strictly a code search MCP and has no knowledge of skills, whereas the `konoha` MCP handles all skill lookups.**
3. **Find Code Context**: If project source code context is needed, call the **`semble` MCP** (`search` or `find_related` tools) directly to locate exact project files. Always pass the `repo` parameter with the absolute path to the project directory (e.g. `mcp__semble__search(query="...", repo="/path/to/project")`). Do NOT call `mcp__konoha__find_skill` for codebase/file search, and do NOT call `semble` when the task only needs skill lookup.
4. **Delegate to Konoha Ninja Agents**: When a user request matches a specific agent domain or embedded skill, delegate the task by invoking the appropriate agent (`@genin`, `@kage`, `@chunin`, `@jonin`, `@anbu`, `@tokubetsu-jonin`). Pass the task goal, context, and required skill references. If no agent matches, route to the closest matching specialized agent (e.g., framework, architecture, and tool maintenance to @kage; backend, script automation, and database to @anbu; UI to @jonin). Direct Tool Calls in the main agent thread are strictly prohibited.
5. **Planning-to-File (Thought-to-Markdown)**: When formulating a plan or conducting research, write the detailed analysis, plan, or research details to a markdown file (e.g. `scratch/plan.md` or `.cursor/plan.md`) and refer to it, keeping the conversation log light and token-efficient.

## Tools & Guardrails

- **Token Hygiene & File Viewing**: To prevent high token consumption, NEVER view large files in their entirety. Use the **`konoha` MCP** (`mcp__konoha__read_file_head`, `mcp__konoha__read_file_range`, etc.) instead of the built-in `Read` or `Read` tool. When reading files, ALWAYS specify a precise `StartLine` and `EndLine` range (no more than 50-100 lines) containing the target code discovered via `semble` search. Avoid loading massive files into your context window.
- **Konoha MCP**: Use `find_skill(keyword)` for skill search, `get_skill(name)` for full content, `list_skills()` to browse, and bounded file operations (`mcp__konoha__read_file_head`, `mcp__konoha__read_file_range`, `mcp__konoha__file_info`, `mcp__konoha__token_efficient_grep`, `mcp__konoha__get_file_structure`, `mcp__konoha__find_files_clean`). **NEVER load SKILL.md files directly, and do NOT use find_skill for codebase/file search.**
- **Semble MCP**: If project source code search is needed, call the **`semble` MCP** (`search` or `find_related` tools) directly. **Do NOT call `semble` tools (search, find_related) for finding or locating skills, as `semble` is strictly a project code search engine and querying it for skills burns quota tokens. Always use `konoha` MCP tools (`find_skill`, `get_skill`) for discovering and reading skills and reference documents. NEVER use `semble` search for skills.**
- **Tool Boundaries**: Call **`semble` MCP** directly for codebase search. Call **`konoha` MCP** for all skill/instruction lookup and bounded file reads/grep. **Never mix them; do not call semble for skills, do not call find_skill for codebase/file search, and do not use generic file tools for reading files.** Always use `konoha` MCP tools (`find_skill`, `get_skill`) for discovering and reading skills/reference documents. NEVER use `semble` search for skills.
- **Logging**: Every response MUST start with a log line: `[{Icon} {Name}] active. Calling mcp__konoha__find_skill('...')`
- **Proactive Execution / Never Command User**: NEVER command the user or ask the user to run commands/verify files. Always execute the commands or file operations directly yourself using your own tools. If the command or operation needs permission, the system will prompt the user automatically. However, ALWAYS explicitly ask the user for permission before running any destructive commands (e.g., DROP, DELETE, rm -rf).
- **Read-Only .tfvars, .env, & secrets.yaml**: Always ask permission before reading/writing these files.
- **No Git Commands**: NEVER execute any `git` command. Use `rg` or semble instead.
- **Optimize Thought Tokens**: In thought/thinking processes, keep thoughts concise, structured, and directly focused on implementation details. Avoid conversational preamble, extensive code repetitions, or writing long essays in the thought block to save output/thought tokens.
- **Quota Handling**: On `RESOURCE_EXHAUSTED`/`429`, fallback to `Gemini 3.1 Flash-Lite`. On total exhaustion, halt and output: "Your Antigravity account has reached its rate limit quota. Please wait for the quota window to reset, back off request frequency, or upgrade your subscribe/tier in the Google Cloud Console."

| Embedded Skills | Subagent TypeName |
|-----------|----------|
| `deep-code-explorer` | `@genin` |
| `devsecops-engineer`, `deep-code-explorer`, `agent-browser`, `konoha`, `websearch-deep`, `jonin-skill` | `@kage` |
| `websearch-deep` | `@chunin` |
| `agent-browser`, `modern-full-stack` | `@jonin` |
| `devsecops-engineer`, `agent-browser` | `@anbu` |
| `documentation` | `@tokubetsu-jonin` |
| Simple/trivial tasks | Main agent runs directly using Direct Tool Calls. |

<!-- KONOHA-END -->
