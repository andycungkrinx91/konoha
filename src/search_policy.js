// Shared Konoha code-search policy — native SQLite FTS5 code intelligence replaces grep/glob/find everywhere.

const CODE_SEARCH_CONSTRAINT =
  'NEVER use grep, glob, find, rg/ripgrep, or built-in Grep/Glob/SemanticSearch for codebase discovery — use the konoha code_* tools (code_search, code_symbol, code_impact) only.';

const FILE_TOOLS_CONSTRAINT =
  'NEVER use built-in Read/Grep/Glob or shell cat/head/tail/less for project files — use konoha MCP (read_file_head, read_file_range, file_info, token_efficient_grep, get_file_structure, find_files_clean) after code_search locates targets.';

function buildCodeSearchPolicy() {
  return `### Default Code Search — Konoha Native Code Intelligence

Konoha indexes repositories into its own SQLite database (FTS5). No external server, no Python runtime, no network round trip.

| Instead of | Use |
|------------|-----|
| \`grep\`, \`rg\`, \`ripgrep\`, \`find\`, \`ag\`, \`ack\` (shell) | \`konoha.code_search(query="...", root="<absolute-project-path>")\` |
| glob, filename patterns, "find file named …" | \`konoha.code_search\` with filename/symbol keywords, or \`code_symbol\` |
| Antigravity built-in grep / glob / search tools | \`konoha.code_search\` |
| Cursor \`Grep\`, \`Glob\`, \`SemanticSearch\` tools | \`konoha.code_search\` |

**Mandatory rules:**
- All project code discovery MUST use \`konoha.code_search\` or \`code_symbol\` first.
- Always pass \`root\` with the absolute path to the project root.
- Run \`code_index\` once per root; re-run it (\`force: true\`) after large changes.
- \`code_impact\` answers "who calls this" — use it instead of chaining grep for references.
- Do NOT use the code_* tools for skill lookup — use \`konoha.find_skill\` / \`get_skill\`.
- **Fallback only:** If the response carries \`degraded: true\` (FTS5 unavailable), say so once and use \`rg\` for that lookup. Never default to grep/glob.

**Examples:**
- Find a symbol: \`code_search(query="function detect_active_agent", root="/path/to/project")\`
- Locate config: \`code_search(query="mcp config registration", root="/path/to/project")\`
- Blast radius: \`code_impact(symbol="registerMcp", root="/path/to/project")\``;
}

function buildCodeSearchPolicyCompact() {
  return `- **Code search default**: Use \`konoha\` \`code_search\` / \`code_symbol\` / \`code_impact\` (native SQLite FTS5 index) for ALL codebase discovery. Do NOT use grep/glob/find/rg, Antigravity search tools, or Cursor \`Grep\`/\`Glob\`/\`SemanticSearch\`. Always pass absolute \`root\`; run \`code_index\` first. Skills: \`konoha.find_skill\` only.`;
}

function buildFileToolsPolicy() {
  return `### Default File I/O — konoha MCP Only

Konoha installs **konoha** as the token-efficient replacement for built-in file read/grep/glob tools.

| Instead of | Use |
|------------|-----|
| Cursor \`Read\` tool, Antigravity \`view_file\`, shell \`cat\`/\`head\`/\`tail\`/\`less\` | \`konoha.read_file_head\` (preview) or \`read_file_range\` (targeted window) |
| Loading an entire large file into context | \`file_info\` (size + line count) → \`get_file_structure\` (signatures) → \`read_file_range\` (≤500 lines) |
| Cursor \`Grep\` / shell \`grep\`/\`rg\` for line matches | \`konoha.code_search\` |
| Cursor \`Glob\` / shell \`find\` for filenames | \`konoha.code_search\` / \`code_symbol\` |

**Mandatory rules:**
- After \`code_search\` locates a file, use **konoha MCP** for all reads and line-level grep — never built-in Read/Grep/Glob.
- Start with \`file_info\` or \`read_file_head\` when file size is unknown.
- Use \`read_file_range\` for edits; max span is **500 lines** per call.
- **Fallback only:** If konoha MCP is unavailable after retry, note the fallback and use the smallest possible read window.`;
}

function buildFileToolsPolicyCompact() {
  return `- **File I/O default**: Use \`konoha\` MCP (\`read_file_head\`, \`read_file_range\`, \`file_info\`, \`token_efficient_grep\`, \`get_file_structure\`, \`find_files_clean\`). Use \`code_search\` / \`code_symbol\` for all code discovery. Do NOT use Cursor \`Read\`/\`Grep\`/\`Glob\` or shell \`cat\`/\`head\`/\`grep\`. Workflow: code_search → konoha read tools.`;
}

module.exports = {
  CODE_SEARCH_CONSTRAINT,
  FILE_TOOLS_CONSTRAINT,
  buildCodeSearchPolicy,
  buildCodeSearchPolicyCompact,
  buildFileToolsPolicy,
  buildFileToolsPolicyCompact
};
