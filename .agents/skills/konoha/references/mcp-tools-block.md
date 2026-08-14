# MCP Tools Available To You
| Tool Name | Description |
|-----------|-------------|
| `mcp__semble__search` | Project source code search (default for any codebase lookup) |
| `mcp__semble__find_related` | Symbol / codepath discovery (default for tracing callsites) |
| `mcp__konoha__find_skill` | Discover skill reference names from the user prompt |
| `mcp__konoha__get_skill` | Load a skill's full content (after find_skill) |
| `mcp__konoha__list_skills` | Browse all available skills |
| `mcp__konoha__optimize_report` | Analyze task complexity and recommend skill workflows |
| `mcp__konoha__build_with_image_design` | Legacy alias for `build_from_source` mockup-driven UI builds |
| `mcp__konoha__build_from_source` | Build UI from source mockups |
| `mcp__konoha__build_from_text` | Build UI from a text description |
| `mcp__konoha__read_file_head` | Bounded file read (head, ≤100 lines) |
| `mcp__konoha__read_file_range` | Bounded file read by StartLine/EndLine |
| `mcp__konoha__token_efficient_grep` | Token-aware grep with line numbers |
| `mcp__konoha__file_info` | Inspect a file's size / line count / metadata |
| `mcp__konoha__get_file_structure` | Get a file's outline / symbols |
| `mcp__konoha__find_files_clean` | Find files by glob / pattern |
| `mcp__konoha__get_resolved_task_dir` | Resolve the absolute scratch dir for this task |
| `mcp__konoha__sannin` | Return control to the orchestrator (write `result.md` first) |

### Strict Tool Boundaries
- **Codebase search** → `mcp__semble__search` / `mcp__semble__find_related`. Never use `find_skill` for codebase/file search.
- **Skill lookup** → `mcp__konoha__find_skill` / `mcp__konoha__get_skill`. Never use `mcp__semble__search` for skills (it burns API tokens).
- **Bounded file reads** → `mcp__konoha__read_file_head` / `mcp__konoha__read_file_range`. Never read entire files when a range is enough.

### Usage Examples
- **Find a symbol** → `mcp__semble__search(query="function detect_active_agent", repo="/absolute/project/path")`
- **Trace callers** → `mcp__semble__find_related(file_path="src/server.py", line=509, repo="/absolute/project/path")`
- **Locate a skill** → `mcp__konoha__find_skill(keyword="forensic timeline hayabusa")` → then `mcp__konoha__get_skill(name="hayabusa-skill")`
- **Read a code block** → `mcp__semble__search` first → `mcp__konoha__file_info(path="...")` → `mcp__konoha__read_file_range(path="...", start_line=120, end_line=180)`
- **Finalize result** → `mcp__konoha__sannin(task_dir="...")` after writing `result.md`

### Forbidden Tools (Replacement Required)
| NEVER use | Replace with |
|-----------|--------------|
| `Grep`, `Glob`, `SemanticSearch`, `Read`, `Edit`, `Write` (Cursor) | `mcp__semble__search` / `mcp__konoha__read_file_*` |
| `view_file`, `grep_search`, `list_dir`, `replace_in_file` (Antigravity) | `mcp__konoha__read_file_*` / `delegate to subagent` |
| Shell `cat`, `head`, `tail`, `grep`, `rg`, `find`, `fd`, `ag`, `ack`, `less`, `more`, `bat`, `wc` | `mcp__konoha__read_file_*` / `mcp__semble__search` |
