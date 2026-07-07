// Shared Konoha code-search policy — semble MCP replaces grep/glob/find everywhere.

const SEMBLE_SEARCH_CONSTRAINT =
  'NEVER use grep, glob, find, rg/ripgrep, or built-in Grep/Glob/SemanticSearch for codebase discovery — use semble MCP search/find_related only (always pass repo with absolute project path).';

const FILE_TOOLS_CONSTRAINT =
  'NEVER use built-in Read/Grep/Glob or shell cat/head/tail/less for project files — use konoha MCP (read_file_head, read_file_range, file_info, token_efficient_grep, get_file_structure, find_files_clean, search_file) after semble locates targets.';

function buildSembleSearchPolicy() {
  return `### Default Code Search — Semble MCP Only

Konoha installs **semble** as the default search, find, and grep replacement on Antigravity and Cursor.

| Instead of | Use |
|------------|-----|
| \`grep\`, \`rg\`, \`ripgrep\`, \`find\`, \`ag\`, \`ack\` (shell) | \`semble.search(query="...", repo="<absolute-project-path>")\` |
| glob, filename patterns, "find file named …" | \`semble.search\` with filename/symbol keywords, or \`semble.find_related\` |
| Antigravity built-in grep / glob / search tools | \`semble\` MCP \`search\` / \`find_related\` |
| Cursor \`Grep\`, \`Glob\`, \`SemanticSearch\` tools | \`semble\` MCP \`search\` / \`find_related\` |

**Mandatory rules:**
- All project code discovery MUST use \`semble.search\` or \`semble.find_related\` first.
- Always pass \`repo\` with the absolute path to the project root.
- Do NOT use \`konoha\` for codebase/file search — konoha is for skills, bounded file reads, and semble-backed semantic search (\`search_file\`) only.
- Do NOT use \`semble\` for skill lookup — use \`konoha.find_skill\` / \`get_skill\`.
- **Fallback only:** If semble MCP is unavailable after retry, you may use \`rg\` once and note the fallback. Never default to grep/glob.

**Examples:**
- Find a symbol: \`semble.search(query="function detect_active_agent", repo="/path/to/project")\`
- Trace usages: \`semble.find_related(query="src/server.py", repo="/path/to/project")\`
- Locate config: \`semble.search(query="mcp_config.json semble registration", repo="/path/to/project")\``;
}

function buildSembleSearchPolicyCompact() {
  return `- **Code search default**: Use \`semble\` MCP (\`search\`, \`find_related\`) for ALL codebase discovery. Do NOT use grep/glob/find/rg, Antigravity search tools, or Cursor \`Grep\`/\`Glob\`/\`SemanticSearch\`. Always pass absolute \`repo\`. Skills: \`konoha.find_skill\` only — never semble for skills.`;
}

function buildFileToolsPolicy() {
  return `### Default File I/O — konoha MCP Only

Konoha installs **konoha** as the token-efficient replacement for built-in file read/grep/glob tools.

| Instead of | Use |
|------------|-----|
| Cursor \`Read\` tool, Antigravity \`view_file\`, shell \`cat\`/\`head\`/\`tail\`/\`less\` | \`konoha.read_file_head\` (preview) or \`read_file_range\` (targeted window) |
| Loading an entire large file into context | \`file_info\` (size + line count) → \`get_file_structure\` (signatures) → \`read_file_range\` (≤500 lines) |
| Cursor \`Grep\` / shell \`grep\`/\`rg\` for line matches | \`semble.search\` first, then \`token_efficient_grep\` (capped matches) |
| Cursor \`Glob\` / shell \`find\` for filenames | \`find_files_clean\` or \`search_file\` or \`semble.search\` with filename keywords |

**Mandatory rules:**
- After \`semble\` locates a file, use **konoha MCP** for all reads and line-level grep — never built-in Read/Grep/Glob.
- Start with \`file_info\` or \`read_file_head\` when file size is unknown.
- Use \`read_file_range\` for edits; max span is **500 lines** per call.
- Do NOT use \`semble\` for raw file line dumps — use konoha MCP.
- **Fallback only:** If konoha MCP is unavailable after retry, note the fallback and use the smallest possible read window.`;
}

function buildFileToolsPolicyCompact() {
  return `- **File I/O default**: Use \`konoha\` MCP (\`read_file_head\`, \`read_file_range\`, \`file_info\`, \`token_efficient_grep\`, \`get_file_structure\`, \`find_files_clean\`, \`search_file\`). Do NOT use Cursor \`Read\`/\`Grep\`/\`Glob\` or shell \`cat\`/\`head\`/\`grep\`. Workflow: semble → konoha.`;
}

module.exports = {
  SEMBLE_SEARCH_CONSTRAINT,
  FILE_TOOLS_CONSTRAINT,
  buildSembleSearchPolicy,
  buildSembleSearchPolicyCompact,
  buildFileToolsPolicy,
  buildFileToolsPolicyCompact
};
