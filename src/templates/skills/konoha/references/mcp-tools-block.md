# MCP Tools Available To You

Every official Konoha subagent must follow this contract on every new, resumed, and follow-up session.

- **Konoha is mandatory**: use `mcp__konoha__find_skill` and `mcp__konoha__get_skill` for skill discovery/loading and Konoha bounded file tools for file operations.
- **Semble is mandatory**: use `mcp__semble__search` and `mcp__semble__find_related` for all project codebase discovery. Always pass the absolute repository path.
- **RTK is mandatory for commands**: prefix shell commands with `rtk` when the binary is installed. If unavailable, report the warning and use the approved client fallback without claiming RTK was used.
- **Resume safety**: on every new or resumed session, re-read this contract, re-evaluate the prompt, repeat skill discovery, and restore the Konoha/Semble/RTK workflow before acting.

| Tool Name | Description |
|-----------|-------------|
| `mcp__semble__search` | Project source code search (default for any codebase lookup) |
| `mcp__semble__find_related` | Symbol / codepath discovery (default for tracing callsites) |
| `mcp__konoha__find_skill` | Discover skill reference names from the prompt |
| `mcp__konoha__get_skill` | Load a skill's full content after discovery |
| `mcp__konoha__list_skills` | Browse available skills |
| `mcp__konoha__optimize_report` | Analyze task complexity and skill workflows |
| `mcp__konoha__build_with_image_design` | Compatibility alias for source-driven UI builds |
| `mcp__konoha__build_from_source` | Build UI from source mockups |
| `mcp__konoha__build_from_text` | Build UI from a text description |
| `mcp__konoha__read_file_head` | Bounded file read preview |
| `mcp__konoha__read_file_range` | Bounded file read by line range |
| `mcp__konoha__token_efficient_grep` | Token-aware bounded line search |
| `mcp__konoha__file_info` | Inspect file size and line count |
| `mcp__konoha__get_file_structure` | Inspect file signatures |
| `mcp__konoha__find_files_clean` | Find files while skipping build/VCS noise |
| `mcp__konoha__get_resolved_task_dir` | Resolve an isolated task directory |
| `mcp__konoha__sannin` | Return control to the orchestrator after writing result.md |

### Strict Tool Boundaries

- Codebase search → `mcp__semble__search` / `mcp__semble__find_related`.
- Skill lookup and bounded file reads → `mcp__konoha__*` tools.
- Shell output → `rtk <command>` when installed; never bypass Semble or Konoha with native search/read tools.
