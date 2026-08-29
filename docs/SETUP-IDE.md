# Antigravity IDE Setup Guide

## Prerequisites

- Antigravity IDE installed and running
- Python 3.8+ installed
- Node.js 18+ (via nvm, Homebrew, or system package)
- Agent skills in `~/.agents/skills/` (with SKILL.md files)

### Cross-Platform Notes

| OS | Python Install | Node.js Install | Notes |
|----|---------------|-----------------|-------|
| **Linux (Ubuntu/Debian)** | `sudo apt install python3` | `curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -` | Use `python3` |
| **macOS** | `brew install python` | `brew install node` or `nvm install node` | Use `python3` |
| **Windows (WSL)** | Same as Linux | Same as Linux | Recommended: use WSL2 |
| **Windows (native)** | [python.org/downloads](https://www.python.org/downloads/) — check "Add to PATH" | [nodejs.org](https://nodejs.org/) or [nvm-windows](https://github.com/coreybutler/nvm-windows) | Use `python` |

### RTK (Rust Token Killer) — Token-Optimized Shell

If `rtk` is installed (`cargo install rtk`), Konoha auto-deploys RTK rules to both `~/.gemini/antigravity-cli/rules/rtk.md` and `~/.gemini/antigravity-ide/rules/rtk.md` during init. This instructs agents to use `rtk <command>` for shell operations, reducing token usage by up to 90% on common commands.

## Step 1: Install Skills-DB (Zero-Configuration Auto-Setup)

> [!NOTE]
> **Zero-Prompt Auto-Setup**:
>
> If you prefer a manual setup or want to perform a clean initialization, run:

```bash
pnpm dlx github:andycungkrinx91/konoha init
```

This manual script or the auto-setup routine will:
1. Create `~/.konoha/` with the MCP server and database
2. Migrate all skills from `~/.agents/skills/` into SQLite FTS5
3. **Back up** existing `~/.gemini/config/mcp_config.json` → `mcp_config.json.back` (first install only)
4. **Merge or repair** `~/.gemini/config/mcp_config.json` with the Konoha servers (`konoha` + `semble`) while preserving unrelated entries
5. Update `~/.gemini/GEMINI.md` with new subagent instructions
6. If Antigravity IDE is detected, refresh the live `master` branch of `konoha-bridge` at `~/.antigravity-ide/extensions/andycungkrinx91.konoha-bridge-master-universal/` for `127.0.0.1:1313`; otherwise skip it without creating extension directories. Konoha’s embedded gateway remains on `127.0.0.1:19999`.

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

### Orchestration Model — Structured MCP Subagent Invocation

Konoha implements a pure MCP-based subagent delegation model. The main agent no longer needs to use `invoke_subagent` or rely on pre-tool hooks to translate custom ninja TypeNames. Instead, all delegation goes through the `mcp_sannin` (Village Elder) MCP tool, which intelligently routes tasks to specialized backend MCP agents.

Concretely, the orchestrator:

1. Acts as a coordinator, analyzing the user's prompt in `prompt.md`.
2. Discover skills via `konoha.find_skill` and loads them via `konoha.get_skill` if necessary.
3. **Delegates** all tasks by calling the `mcp_sannin` MCP tool, passing the prompt and the workspace directory.
4. `mcp_sannin` routes the structured task to the appropriate MCP agent (`mcp_kage`, `mcp_jonin`, `mcp_anbu`, `mcp_chunin`, `mcp_tokubetsu_jonin`, or `mcp_genin`).
5. The chosen MCP agent returns a structured result and can checkpoint learnings with `report_from_agent`.
6. Hosts that cannot send structured arguments may use the isolated `delegate.md`/`result.md` fallback under `~/.konoha/tmp/`.

#### Task lifecycle & Conversation Resumption

| Step | Actor | Action | Artifact |
|------|-------|--------|----------|
| 1 | `prompt_hook.js` | Capture user message or resume action | `prompt.md` |
| 2 | Orchestrator | Read & analyze request (using konoha MCP `read_file_head`/`read_file_range`) | reads `prompt.md` |
| 3 | Orchestrator | Discover project knowledge (README, docs/, .cursorrules, project skills) & global skills (`find_skill`) | — |
| 4 | Orchestrator | Delegate task | calls `mcp_<agentname>` |
| 5 | Subagent (MCP) | Write instructions & route | writes `delegate.md` |
| 6 | Subagent (MCP) | Execute task internally | uses MCP file/bash tools |
| 7 | Subagent (MCP) | Return results | writes `result.md` |
| 8 | Orchestrator | Synthesize & respond | final answer |

> [!IMPORTANT]

#### Available MCP Subagents

| MCP Tool | Specialization |
|----------|----------------|
| `mcp_genin` | Read-only codebase exploration, tracing flows, mapping dependencies |
| `mcp_kage` | Architecture decisions, security audits, complex refactoring |
| `mcp_chunin` | Web research, documentation lookup, compliance, evidence synthesis |
| `mcp_jonin` | UI design, frontend components across 4 frameworks (Next.js 16, SvelteKit, Nuxt 3, Angular v19+) using `pnpm` |
| `mcp_anbu` | Backend logic, bug fixing, DevOps, infrastructure, CI/CD |
| `mcp_tokubetsu_jonin` | Technical writing, README, API docs, runbooks, onboarding |

Full orchestrator rules and subagent protocol: `~/.gemini/GEMINI.md` and `~/.agents/AGENTS.md`.

## 🛡️ Default Tools & Guardrails

To maintain stability and enforce security, the Antigravity system implements the following default tools and behavioral guardrails across all subagents:

> [!IMPORTANT]
> **Tool Usage & Operational Guardrails:**
>
> * **konoha MCP**: Use `find_skill(keyword)` to search for relevant skill content on-demand. Use `get_skill(name)` for full content when previews are truncated. Use `list_skills()` to see all available skills. **NEVER load SKILL.md files directly from disk** — always use the `konoha` MCP tools.
> * **Semble Semantic Search (default)**: Konoha replaces grep/glob/find with **semble** (`search`, `find_related`) for semantic codebase discovery. Do not use built-in grep/glob tools or shell `grep`/`rg`/`find` — use semble first (`rg` only if semble MCP is unavailable).
> * **konoha MCP (token-efficient reads)**: After semble locates targets, use `read_file_head`, `read_file_range`, `file_info`, `token_efficient_grep`, `get_file_structure`, and `find_files_clean` from the **konoha** MCP server instead of loading entire files or using built-in Read/Grep/Glob.
> * **Agent-Browser CLI**: Use `agent-browser` (or `npx agent-browser`) to interact with live web pages, submit forms, take screenshots, inspect elements, and run visual end-to-end verifications.
> * **Transparency & Logging**: At the very start of every response, you MUST output a log line announcing your rank/role, which MCP servers you are invoking, and which skill references you are calling. Example:
>   `[🍃 Genin] scout active. Calling konoha.find_skill('keyword') and/or semble.search(...)`
> * **Protected Configuration & Secrets**: All `terraform.tfvars`, `.env` configurations, and `secrets.yaml` files are strictly **read-only** by default. AI agents must **ALWAYS ask for user permission** before attempting to read or write them.
> * **Subagent Delegation Model**: Custom `TypeName` values and `invoke_subagent` calls have been fully replaced by the MCP-only delegation model. All subagent delegation goes through the `mcp_sannin` tool, which routes to backend tools like `mcp_jonin`, `mcp_kage`, etc.
> * **No Auto-Creation of Subagents**: The AI agent is **NEVER** allowed to automatically define, create, or delete subagents.
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
> **Explicit User Consent**: As of `v2.0.0`, Konoha will interactively prompt the user (via `@inquirer/prompts`) during setup and upgrades before applying these auto-approvals to comply with security policies.

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
      "command": "node",
      "args": ["/home/user/.konoha/file_tools_launcher.js"],
      "autoApprove": ["*", "find_skill", "list_skills", "get_skill", "read_file_head", "read_file_range", "file_info", "token_efficient_grep", "get_file_structure", "find_files_clean"]
    },
    "semble": {
      "command": "uvx",
      "args": ["--from", "semble[mcp]@latest", "semble", "--content", "all"],
      "autoApprove": ["*", "search", "find_related"]
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

