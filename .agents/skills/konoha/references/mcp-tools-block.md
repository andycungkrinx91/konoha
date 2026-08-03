# MCP Tools Available To You
| Tool Name | Description |
|-----------|-------------|
| `mcp__semble__search` | Project source code search (default for any codebase lookup) |
| `mcp__semble__find_related` | Symbol / codepath discovery (default for tracing callsites) |
| `mcp__konoha__find_skill` | Discover skill reference names from the user prompt |
| `mcp__konoha__get_skill` | Load a skill's full content (after find_skill) |
| `mcp__konoha__list_skills` | Browse all available skills |
| `mcp__konoha__optimize_report` | Analyze task complexity and recommend skill workflows |
| `mcp__konoha__read_file_head` | Bounded file read (head, ≤100 lines) |
| `mcp__konoha__read_file_range` | Bounded file read by StartLine/EndLine |
| `mcp__konoha__token_efficient_grep` | Token-aware grep with line numbers |
| `mcp__konoha__file_info` | Inspect a file's size / line count / metadata |
| `mcp__konoha__get_file_structure` | Get a file's outline / symbols |
| `mcp__konoha__find_files_clean` | Find files by glob / pattern |
| `mcp__konoha__search_file` | Search inside a single file (offset-aware) |
| `mcp__konoha__get_resolved_task_dir` | Resolve the absolute scratch dir for this task |
| `mcp__konoha__mcp_sannin` | Return control to the orchestrator (write `result.md` first) |

### Strict Tool Boundaries
- **Codebase search** → `mcp__semble__search` / `mcp__semble__find_related`. Never use `find_skill` for codebase/file search.
- **Skill lookup** → `mcp__konoha__find_skill` / `mcp__konoha__get_skill`. Never use `mcp__semble__search` for skills (it burns API tokens).
- **Bounded file reads** → `mcp__konoha__read_file_head` / `mcp__konoha__read_file_range`. Never read entire files when a range is enough.
