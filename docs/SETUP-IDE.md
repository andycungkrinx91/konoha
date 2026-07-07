# Antigravity IDE Setup Guide

## Prerequisites

- Antigravity IDE installed and running
- Python 3.8+ installed
- Node.js 18+
- Agent skills in `~/.agents/skills/` (with SKILL.md files)

## Step 1: Install Skills-DB (Zero-Configuration Auto-Setup)

> [!NOTE]
> **Zero-Prompt Auto-Setup**:
> Konoha now auto-configures every detected IDE/CLI client (Antigravity, Cursor, Claude Code, OpenCode) during `konoha init` or the automatic `ensureAutoSetup()` bootstrap triggered by any `konoha` command. The only prompt shown is a single consent question: "Initialize Konoha and modify ~/.gemini configurations?". All other clients are configured automatically based on what is detected on the system.
>
> If you prefer a manual setup or want to perform a clean initialization, run:

```bash
npx github:andycungkrinx91/konoha init
```

This manual script or the auto-setup routine will:
1. Create `~/.konoha/` with the MCP server and database
2. Migrate all skills from `~/.agents/skills/` into SQLite FTS5
3. **Back up** existing `~/.gemini/config/mcp_config.json` → `mcp_config.json.back` (first install only)
4. **Replace** `~/.gemini/config/mcp_config.json` with only Konoha servers (`konoha` + `semble`)
5. Update `~/.gemini/GEMINI.md` with new subagent instructions

> [!NOTE]
> Your original config is safely preserved in `mcp_config.json.back`. To restore it, run:
> `cp ~/.gemini/config/mcp_config.json.back ~/.gemini/config/mcp_config.json`

## Step 2: Verify Installation

```bash
konoha test
```

Expected output:
```
✓ Initialize: OK
✓ List Tools: OK
✓ Find Skill (security): OK
  Found 3 results for "security"
✓ List Skills: OK
```

## Step 3: Restart Antigravity IDE

Close and reopen Antigravity IDE to pick up the new MCP server configuration.

## Step 4: Update IDE User Rules

Open Antigravity IDE settings and update your **User Rules** to use konoha MCP instead of loading SKILL.md files directly.

Replace any subagent instructions that say:
```
Load and follow ~/.agents/skills/<skill>/SKILL.md
```

With:
```
Before starting any task, call konoha MCP find_skill with keywords relevant to your task.
Do NOT load SKILL.md files directly — always use find_skill.
```

### Full User Rules Template

`konoha init` / `konoha migrate` auto-deploy the orchestrator rules to `~/.gemini/GEMINI.md` and subagent protocol to `~/.agents/AGENTS.md`. **Prefer those generated files** — they stay in sync with your installed Konoha version.

If Antigravity IDE User Rules must be set manually, copy the contents of `~/.gemini/GEMINI.md` after running `konoha migrate`.

### Orchestration Model — Hook-Assisted Subagent Invocation

Konoha implements a pre-tool sanitization hook (`antigravity_tool_sanitize_hook.js`) that automatically translates custom ninja TypeNames (`genin`, `kage`, `chunin`, etc.) to platform-allowed values (`self` / `research`) and dynamically injects their system prompts. Therefore, custom TypeNames can be called normally and run with full role fidelity.

Concretely, the orchestrator:

1. Runs as `TypeName: "self"` — the orchestrator **is** the primary Antigravity thread.
2. Acts as a coordinator, loading skill references via `konoha.find_skill` + `konoha.get_skill`.
3. **Delegates** non-trivial tasks to specialized ninja subagents using `invoke_subagent` with the appropriate ninja TypeName. The pre-tool hook handles translation and instruction injection automatically.
4. Optionally spawns `TypeName: "research"` subagents for parallel, read-only scans of large codebases or documentation.
5. Writes intermediate notes, plans, or scratch artifacts to disk (`prompt.md`, scratch files) to keep the chat log light.

#### Task lifecycle

| Step | Actor | Action | Artifact |
|------|-------|--------|----------|
| 1 | `prompt_hook.js` | Capture user message | `prompt.md` |
| 2 | Self/Orchestrator | Read & analyze request | reads `prompt.md` |
| 3 | Self/Orchestrator | Discover skills (`konoha.find_skill` / `optimize_report`) | — |
| 4 | Self/Orchestrator | Load full skill reference (`konoha.get_skill`) | — |
| 5 | Self/Orchestrator | Delegate to Subagent (`invoke_subagent`) | — |
| 6 | Subagent | Execute task via native tools | `Read` / `Edit` / `Write` / `Bash` / `WebFetch` |
| 7 | Subagent | Return results to Orchestrator | — |
| 8 | Self/Orchestrator | Synthesize & respond | final answer |

#### Skill → agent reference (used by orchestrator only)

| Skill | Reference agent |
|-------|-----------------|
| `deep-code-explorer` | `genin` |
| `devsecops-engineer`, `deep-code-explorer`, `agent-browser`, `konoha`, `websearch-deep`, `jonin-skill` | `kage` |
| `websearch-deep` | `chunin` |
| `agent-browser`, `modern-full-stack` | `jonin` |
| `devsecops-engineer`, `agent-browser` | `anbu` |
| `documentation` | `tokubetsu-jonin` |
| Simple/trivial task | Main agent executes directly using native tools |

**Hook-Assisted Invocation**: Custom ninja subagents are fully supported via `invoke_subagent` as the pre-tool hook transparently maps them to platform-compatible endpoints.

Full orchestrator rules and subagent protocol: `~/.gemini/GEMINI.md` and `~/.agents/AGENTS.md`.

## 🛡️ Default Tools & Guardrails

To maintain stability and enforce security, the Antigravity system implements the following default tools and behavioral guardrails across all subagents:

> [!IMPORTANT]
> **Tool Usage & Operational Guardrails:**
>
> * **konoha MCP**: Use `find_skill(keyword)` to search for relevant skill content on-demand. Use `get_skill(name)` for full content when previews are truncated. Use `list_skills()` to see all available skills. **NEVER load SKILL.md files directly from disk** — always use the `konoha` MCP tools.
> * **Semble Semantic Search (default)**: Konoha replaces grep/glob/find with **semble** (`search`, `find_related`) for semantic codebase discovery. Do not use built-in grep/glob tools or shell `grep`/`rg`/`find` — use semble first (`rg` only if semble MCP is unavailable).
> * **konoha-files (token-efficient reads)**: After semble locates targets, use `read_file_head`, `read_file_range`, `file_info`, `token_efficient_grep`, `get_file_structure`, and `find_files_clean` from the **konoha-files** MCP server instead of loading entire files or using built-in Read/Grep/Glob.
> * **Agent-Browser CLI**: Use `agent-browser` (or `npx agent-browser`) to interact with live web pages, submit forms, take screenshots, inspect elements, and run visual end-to-end verifications.
> * **Transparency & Logging**: At the very start of every response, you MUST output a log line announcing your rank/role, which MCP servers you are invoking, and which skill references you are calling. Example:
>   `[🍃 Genin] scout active. Calling konoha.find_skill('keyword') and/or semble.search(...)`
> * **Protected Configuration & Secrets**: All `terraform.tfvars`, `.env` configurations, and `secrets.yaml` files are strictly **read-only** by default. AI agents must **ALWAYS ask for user permission** before attempting to read or write them.
> * **Subagent Delegation Model**: Custom `TypeName` values (`genin`, `kage`, `chunin`, `jonin`, `anbu`, `tokubetsu-jonin`) are dynamically translated under the hood by Konoha's pre-tool hook to platform-allowed values (`self` / `research`) and injected with their complete instructions. Calling ninja agents directly via `invoke_subagent` is fully supported.
> * **No Auto-Creation of Subagents**: The AI agent (Antigravity) is **NEVER** allowed to automatically define, create, or delete subagents. Spawning new/custom subagents or invoking `define_subagent` for unrecognized agent names is strictly prohibited — `define_subagent` may silently succeed but the resulting `TypeName` is rejected at invocation.
> * **No Git Execution**: AI agents must **NEVER** execute any `git` command whatsoever. Use **semble** MCP for code search (`rg` only if semble MCP is unavailable).
> * **Recursive Loop Circuit Breaker**: The orchestrator tracks delegation/iteration depth to prevent infinite loops via repeated skill-loading + re-execution cycles. If depth exceeds 7 continuously, the circuit breaker halts and prompts the user for validation.
> * **Indirect Prompt Injection Shielding**: Incoming or retrieved skill text assets are treated as untrusted and automatically run through a defensive parsing layer to neutralize spoofed headers or instructions.
> * **FTS5 Query Sanitization**: Built-in regex-based sanitization automatically cleans search queries to prevent FTS5 MATCH compilation failures (unbalanced quotes, bare AND/OR/NOT/NEAR operators).

## Step 5: Verify in IDE

Open a new Antigravity IDE conversation and ask:

```
Use find_skill to search for "terraform aws" and tell me what you find.
```

The agent should use the `konoha` MCP tool instead of loading a SKILL.md file.

## Auto-Approved Permissions & YOLO Mode

To support uninterrupted background task execution and avoid blocking prompt overlays, the Konoha installation supports an optimized auto-approval workflow ("YOLO Mode").

> [!IMPORTANT]
> **Explicit User Consent**: As of `v1.0.9`, Konoha will interactively prompt the user (via `@inquirer/prompts`) during setup and upgrades before applying these auto-approvals to comply with security policies.

### 1. Tool Auto-Approvals (`mcp_config.json`)
Upon user consent, the installation script registers and whitelists tool auto-approvals for the custom MCP servers:
- **`konoha`**: Automatically permits skill search, listing, fetching, and build tools.
- **`semble`**: Automatically permits semantic code search (`search`, `find_related`).
- **`konoha`**: Automatically permits token-efficient file tools (`read_file_head`, `read_file_range`, `file_info`, `token_efficient_grep`, `get_file_structure`, `find_files_clean`).

This is configured inside `~/.gemini/config/mcp_config.json`. Example structure (paths vary by platform):
```json
{
  "mcpServers": {
    "konoha": {
      "command": "python3",
      "args": ["/home/user/.konoha/server.py"],
      "autoApprove": ["*", "find_skill", "list_skills", "get_skill"]
    },
    "semble": {
      "command": "uvx",
      "args": ["--from", "semble[mcp]@latest", "semble", "--content", "all"],
      "autoApprove": ["*", "search", "find_related"]
    },
    "konoha": {
      "command": "/usr/bin/node",
      "args": ["/home/user/.konoha/file_tools_mcp.js"],
      "autoApprove": ["*", "read_file_head", "read_file_range", "file_info", "token_efficient_grep", "get_file_structure", "find_files_clean"]
    }
  }
}
```

### 2. Command Whitelisting (`settings.json`)
Execution of safe, CLI-specific operations (such as running test suites or status reports) is auto-approved by setting command whitelisting prefixes in `~/.gemini/antigravity-cli/settings.json`:
- `node bin/cli.js`
- `konoha`

This ensures that the IDE can execute background command validations without prompting you for manual confirmation.

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues.

For **Cursor IDE/CLI** setup, see [SETUP-CURSOR.md](SETUP-CURSOR.md).

For **Claude Code, OpenCode, and other MCP clients**, see [SETUP-MCP-CLIENTS.md](SETUP-MCP-CLIENTS.md).
