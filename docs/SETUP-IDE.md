# Antigravity IDE Setup Guide

## Prerequisites

- Antigravity IDE installed and running
- Python 3.8+ installed
- Node.js 18+
- Agent skills in `~/.agents/skills/` (with SKILL.md files)

## Step 1: Install Skills-DB (Zero-Configuration Auto-Setup)

> [!NOTE]
> **Auto-Setup with Interactive Consent**:
> Starting with version `1.0.9` for Google Policy compliance, running **any** `konoha` command (or executing an agent session) automatically triggers the bootstrap routine (`ensureAutoSetup()`). The CLI will now interactively prompt you using `@inquirer/prompts` Yes/No flows before modifying any `~/.gemini` configurations, setting up subagents, or auto-approving MCP tools. The silent `postinstall` script has been removed.
> 
> If you prefer a manual setup or want to perform a clean initialization, run:

```bash
npx github:andycungkrinx91/konoha init
```

This manual script or the auto-setup routine will:
1. Create `~/.gemini/skills-db/` with the MCP server and database
2. Migrate all skills from `~/.agents/skills/` into SQLite FTS5
3. Register `skills-db` in `~/.gemini/config/mcp_config.json`
4. Update `~/.gemini/GEMINI.md` with new subagent instructions

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

Open Antigravity IDE settings and update your **User Rules** to use skills-db instead of loading SKILL.md files directly.

Replace any subagent instructions that say:
```
Load and follow ~/.agents/skills/<skill>/SKILL.md
```

With:
```
Before starting any task, call skills-db find_skill with keywords relevant to your task.
Do NOT load SKILL.md files directly — always use find_skill.
```

### Full User Rules Template

`konoha init` / `konoha migrate` auto-deploy the orchestrator rules to `~/.gemini/GEMINI.md` and subagent protocol to `~/.agents/AGENTS.md`. **Prefer those generated files** — they stay in sync with your installed Konoha version.

If Antigravity IDE User Rules must be set manually, copy the contents of `~/.gemini/GEMINI.md` after running `konoha migrate`.

### Mandatory File-Based Delegation Pipeline (Antigravity)

Every user request follows this pipeline. The main agent is a **coordinator only** — it never executes project work directly (except quota fallback).

| Step | Actor | Action | File |
|------|-------|--------|------|
| 1 | `prompt_hook.js` | User message captured | `prompt.md` |
| 2 | Orchestrator | Read & analyze request | read `prompt.md` |
| 3 | Orchestrator | Discover skills / code (discovery MCP only) | — |
| 4 | Orchestrator | Select **one** Konoha subagent | `genin`, `kage`, `chunin`, `jonin`, `anbu`, `tokubetsu-jonin` (as `invoke_subagent` `TypeName`) |
| 5 | Orchestrator | Write delegation brief | `scratch/tasks/<task_id>/delegate.md` |
| 6 | Orchestrator | Call `invoke_subagent` with `TypeName`, then **end turn** | — |
| 7 | Subagent | Read brief & execute | read `delegate.md` |
| 8 | Subagent | Write completion report | `scratch/tasks/<task_id>/result.md` |
| 9 | Orchestrator | Summarize for user & cleanup | read `result.md` |

**Naming:** `delegate.md` = delegation brief (your `DELEGATED.md` equivalent). `result.md` = subagent report (your `REPORT.md` equivalent).

**Forbidden for orchestrator:** `@self`, `@research`, typing `@jonin` in chat instead of calling `invoke_subagent`, impersonating subagents, custom/shadow agents, and direct `write_to_file` / `run_command` on project source.

**Delegation API:** After `delegate.md` is written, call `invoke_subagent` with Konoha `TypeName` (`jonin`, `anbu`, etc.). **Never** use `TypeName: "self"` or `"research"`. Konoha auto-registers subagents at session start via the `antigravity_subagent_hook.js` PreInvocation hook (programmatic `define_subagent` with bare names). Run `konoha migrate` and start a **new session** if `subagent not found` errors persist.

| Task type | Subagent TypeName |
|-----------|-------------------|
| Understand codebase, trace flows, map dependencies | `genin` |
| Architecture decisions, security review, deep analysis | `kage` |
| External research, documentation, best practices | `chunin` |
| UI design, frontend components, styling | `jonin` |
| Backend logic, bug fixing, DevOps, infrastructure, CI/CD | `anbu` |
| Technical writing, README, API docs, runbooks, onboarding | `tokubetsu-jonin` |
| Parallel / multi-domain work | Multiple Konoha subagents in parallel |
| Simple/trivial tasks | MUST still delegate (quota fallback only) |

Full orchestrator rules, guardrails, and subagent protocol: `~/.gemini/GEMINI.md` and `~/.agents/AGENTS.md`.

## 🛡️ Default Tools & Guardrails

To maintain stability and enforce security, the Antigravity system implements the following default tools and behavioral guardrails across all subagents:

> [!IMPORTANT]
> **Tool Usage & Operational Guardrails:**
>
> * **Skills-DB MCP**: Use `find_skill(keyword)` to search for relevant skill content on-demand. Use `get_skill(name)` for full content when previews are truncated. Use `list_skills()` to see all available skills. **NEVER load SKILL.md files directly from disk** — always use the `skills-db` MCP tools.
> * **Semble Semantic Search (default)**: Konoha replaces grep/glob/find with **semble** (`search`, `find_related`) for semantic codebase discovery. Do not use built-in grep/glob tools or shell `grep`/`rg`/`find` — use semble first (`rg` only if semble MCP is unavailable).
> * **konoha-files (token-efficient reads)**: After semble locates targets, use `read_file_head`, `read_file_range`, `file_info`, `token_efficient_grep`, `get_file_structure`, and `find_files_clean` from the **konoha-files** MCP server instead of loading entire files or using built-in Read/Grep/Glob.
> * **Agent-Browser CLI**: Use `agent-browser` (or `npx agent-browser`) to interact with live web pages, submit forms, take screenshots, inspect elements, and run visual end-to-end verifications.
> * **Transparency & Logging**: At the very start of every response, you MUST output a log line announcing your rank/role, which MCP servers you are invoking, and which skill references you are calling. Example:
>   `[🍃 Genin] scout active. Calling skills-db.find_skill('keyword') and/or semble.search(...)`
> * **Protected Configuration & Secrets**: All `terraform.tfvars`, `.env` configurations, and `secrets.yaml` files are strictly **read-only** by default. AI agents must **ALWAYS ask for user permission** before attempting to read or write them.
> * **Locked Subagent Delegation**: Subagent delegation is strictly restricted to the 6 official Konoha agents: `genin`, `kage`, `chunin`, `jonin`, `anbu`, `tokubetsu-jonin`. Never use Antigravity built-ins `@self` or `@research` — use parallel Konoha subagents or `genin`/`chunin` instead. Defining or creating custom subagents is prohibited.
> * **No Auto-Creation of Subagents**: The AI agent (Antigravity) is **NEVER** allowed to automatically define, create, or delete subagents. Spawning new/custom subagents or invoking `define_subagent` for unrecognized agent names is strictly prohibited.
> * **No Git Execution**: AI agents must **NEVER** execute any `git` command whatsoever. Use **semble** MCP for code search (`rg` only if semble MCP is unavailable).
> * **Recursive Loop Circuit Breaker**: File queue transitions via `scratch/tasks/<task_id>/delegate.md` must embed and track delegation depth metadata (`depth: <N>`). If depth exceeds 7 continuously, the circuit breaker must freeze the file state, halt the subagent pool, and prompt the user for validation.
> * **Indirect Prompt Injection Shielding**: Incoming or retrieved skill text assets are treated as untrusted and automatically run through a defensive parsing layer to neutralize spoofed headers or instructions.
> * **FTS5 Query Sanitization**: Built-in regex-based sanitization automatically cleans search queries to prevent FTS5 MATCH compilation failures (unbalanced quotes, bare AND/OR/NOT/NEAR operators).
> * **Quota & Rate Limits Handling**: In case of Quota Limits or API errors (such as `RESOURCE_EXHAUSTED` or `429` errors), the coordinator will NOT spawn shadow subagents. Instead, it will immediately fall back to Direct Tool Calls (executing edits, reads, and commands directly) to complete the task. The agent and the runtime must immediately and automatically fallback to using `Gemini 3.1 Flash-Lite` for all subsequent requests to ensure continuous operational capability. If both the primary model and cloud fallback models return `RESOURCE_EXHAUSTED` or `429` errors, the system is in total quota exhaustion. In this case, the agent must halt execution gracefully and output this exact warning:
>   "Your Antigravity account has reached its rate limit quota. Please wait for the quota window to reset, back off request frequency, or upgrade your subscribe/tier in the Google Cloud Console."

### 🛠️ Step-by-Step Guide to Resolve Quota Exhaustion:

1. **Resume the Coding Session**:
   - **IDE User**: Close the current agent panel/chat session and start a new one, or reload your workspace window.
   - **CLI User**: Simply run your previous CLI command (e.g., `konoha` or your target command) to resume the session.

2. **Upgrade Google AI Subscription**:
   - **Google AI Studio**: Go to [Google AI Studio](https://aistudio.google.com/) to add billing information or upgrade your tier.
   - **Google Cloud Console**: Visit the [Google Cloud Console](https://console.cloud.google.com/) to associate a billing account with your project or request a quota limit increase.
```

## Step 5: Verify in IDE

Open a new Antigravity IDE conversation and ask:

```
Use find_skill to search for "terraform aws" and tell me what you find.
```

The agent should use the `skills-db` MCP tool instead of loading a SKILL.md file.

## Auto-Approved Permissions & YOLO Mode

To support uninterrupted background task execution and avoid blocking prompt overlays, the Konoha installation supports an optimized auto-approval workflow ("YOLO Mode").

> [!IMPORTANT]
> **Explicit User Consent**: As of `v1.0.9`, Konoha will interactively prompt the user (via `@inquirer/prompts`) during setup and upgrades before applying these auto-approvals to comply with security policies.

### 1. Tool Auto-Approvals (`mcp_config.json`)
Upon user consent, the installation script registers and whitelists tool auto-approvals for the custom MCP servers:
- **`skills-db`**: Automatically permits skill search, listing, fetching, and build tools.
- **`semble`**: Automatically permits semantic code search (`search`, `find_related`).
- **`konoha-files`**: Automatically permits token-efficient file tools (`read_file_head`, `read_file_range`, `file_info`, `token_efficient_grep`, `get_file_structure`, `find_files_clean`).

This is configured inside `~/.gemini/config/mcp_config.json`. Example structure (paths vary by platform):
```json
{
  "mcpServers": {
    "skills-db": {
      "command": "python3",
      "args": ["/home/user/.gemini/skills-db/server.py"],
      "autoApprove": ["*", "find_skill", "list_skills", "get_skill"]
    },
    "semble": {
      "command": "uvx",
      "args": ["--from", "semble[mcp]@latest", "semble", "--content", "all"],
      "autoApprove": ["*", "search", "find_related"]
    },
    "konoha-files": {
      "command": "/usr/bin/node",
      "args": ["/home/user/.gemini/skills-db/file_tools_mcp.js"],
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
