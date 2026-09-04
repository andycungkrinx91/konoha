# Antigravity CLI (agy) Setup Guide

## Prerequisites

- Antigravity CLI (`agy`) installed
- Python 3.8+ installed
- Node.js 18+ (via nvm, Homebrew, or system package)
- Agent skills in `~/.agents/skills/` (with SKILL.md files)

### Cross-Platform Notes

| OS | Python Install | Node.js Install | Notes |
|----|---------------|-----------------|-------|
| **Linux (Ubuntu/Debian)** | `sudo apt install python3` | `curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -` | Use `python3` |
| **Linux (Fedora)** | `sudo dnf install python3` | `curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo -E bash -` | Use `python3` |
| **macOS** | `brew install python` | `brew install node` or `nvm install node` | Use `python3` |
| **Windows (WSL)** | Same as Linux | Same as Linux | Recommended: use WSL2 |
| **Windows (native)** | [python.org/downloads](https://www.python.org/downloads/) — check "Add to PATH" | [nodejs.org](https://nodejs.org/) or [nvm-windows](https://github.com/coreybutler/nvm-windows) | Use `python` |

> **nvm PATH Issue (Windows/macOS/Linux):** If `konoha` returns "command not found" after a fresh terminal, your shell hasn't loaded nvm. Run:
> ```bash
> source ~/.nvm/nvm.sh  # Linux/macOS
> ```
> Or for Windows PowerShell:
> ```powershell
> & "$env:NVM_DIR\nvm.ps1"
> ```
> Then verify with `which konoha` (Linux/macOS) or `where konoha` (Windows).

### RTK (Rust Token Killer) — Token-Optimized Shell

If `rtk` is installed (`cargo install rtk`), Konoha auto-deploys RTK rules to `~/.gemini/antigravity-cli/rules/rtk.md` during init. This instructs agents to use `rtk <command>` for shell operations, reducing token usage by up to 90% on common commands.

## Step 1: Install Skills-DB (Zero-Configuration Auto-Setup)

### 📦 Standard 3-Step Team Onboarding (ZIP / Clone / Manual)
For manual repository distribution or local development:
```bash
# 1. Extract and enter the directory
unzip konoha.zip
cd konoha

# 2. Install CLI dependencies (if node_modules is not included in zip)
pnpm install

# 3. Execute one-command cross-client initialization
node bin/cli.js init --yes --force
```

### Direct Global Initialization
```bash
pnpm dlx github:andycungkrinx91/konoha init
```

This installs the MCP server and migrates your skills. The CLI should output:

```
🚀 Konoha Installer
──────────────────────────────────────────────
✓ Python 3 found: python3
✓ Found: ~/.agents/skills/ (5 skills)
📦 Installing MCP Server
✓ Installed: ~/.konoha/file_tools_mcp.js, file_tools_launcher.js, file_tools_router.js
✓ Database: ~/.konoha/skills.db (created if missing)
✓ Migration Complete: skills indexed, FTS5 ready
✅ Installation Complete!
```

### Cross-Platform: Windows PowerShell
On Windows, the above commands work in PowerShell:
```powershell
pnpm dlx github:andycungkrinx91/konoha init
```

## Step 2: Verify MCP Detection

Run the Antigravity CLI inspect command:

```bash
agy inspect
```

You should see `konoha`, `semble`, and `aislop` listed among the MCP servers. If not, check that `~/.gemini/config/mcp_config.json` contains all three entries (run `konoha doctor --yes` to repair).

### Windows PowerShell Alternative
```powershell
agy inspect
```

Or use the node launcher directly:
```powershell
node "$env:USERPROFILE\.konoha\file_tools_launcher.js" <<< '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Step 3: Verify Skills-DB Works

```bash
konoha test
```

Expected: all tests pass (MCP integration + `tests/test_*.py` standalone suites).

## Step 4: Test in a Session

Start a new agy session:

```bash
agy
```

Then ask:

```
Search for "terraform aws" using the konoha MCP tool.
```

The agent should call `konoha.find_skill("terraform aws")` and return relevant anbu-skill references — without loading any SKILL.md files.

## How Skills-DB Integrates with agy

### MCP Config Location

agy reads MCP config from `~/.gemini/config/mcp_config.json`:

```json
{
  "mcpServers": {
    "konoha": {
      "command": "node",
      "args": ["/home/youruser/.konoha/file_tools_launcher.js"]
    }
  }
}
```

### GEMINI.md Location

agy reads global instructions from `~/.gemini/GEMINI.md`. The installer updates this file with konoha instructions.

### Skills Source Directory

The migration script auto-detects and reads skills from standard directories. It prioritizes the global folder `~/.agents/skills/` (if it contains skills), and falls back to checking the current workspace directory (`.agents/skills/`).

## Workflow: Adding New Skills

1. Create or copy the new skill to `~/.agents/skills/new-skill-name/`
2. Ensure it has a `SKILL.md` file
3. Re-run migration:
   ```bash
   konoha migrate
   ```
4. Verify:
   ```bash
   konoha test
   ```

## Workflow: Editing Existing Skills

1. Edit the skill files in `~/.agents/skills/skill-name/`
2. Re-run migration:
   ```bash
   konoha migrate
   ```
   ```bash
   konoha migrate --force
   ```

The migration is idempotent — it replaces existing entries with updated content.

## Skill and Agent Management

Konoha provides CLI commands to manage custom skills and multi-agent configurations directly from your terminal.

### Managing Custom Skills

- **List Installed Skills**:
  ```bash
  konoha skill list
  ```
- **Search and Install Interactively** (searches the `skills.sh` registry):
  ```bash
  konoha skill search <query>
  ```
- **Add a Skill Direct from a GitHub Repository**:
  ```bash
  konoha skill add <repository-url> <skill-name>
  ```
- **Delete/Remove a Skill**:
  ```bash
  konoha skill remove <skill-name>
  ```
  *(Note: removing a skill automatically triggers database re-indexing).*

### Managing Subagent Configurations

The subagent configurations are stored in a structured format, enabling you to inspect or modify your agent team.

- **List Subagents and Active Skills**:
  ```bash
  konoha agent list
  ```

- **Create a Custom Subagent**:
  ```bash
  konoha agent create <agent-name> [options]
  ```
  Creates a new custom subagent configuration. Options include:
  - `--manual`: Override system guardrail lock to create a custom/non-default subagent manually (required for custom agents).
  - `--title "Title"`: Display title of your agent (e.g., `"Database Expert"`).
  - `--purpose "Purpose"`: Goal of the agent (e.g., `"Optimize SQL queries"`).
  - `--keywords "keywords"`: Comma-separated triggers that delegate tasks to this agent (e.g., `"database, SQL"`).
  - `--instructions "text"`: Special instructions given to this agent.

  *Example:*
  ```bash
  konoha agent create sql-expert \
    --manual \
    --title "Database Expert" \
    --purpose "Optimize SQL queries and verify database schemas" \
    --keywords "sql, database, query optimization" \
    --instructions "Verify SQL queries using EXPLAIN and ensure correct index usage."
  ```

- **Configure Subagent Models Interactively**: Removed in v2.0.0 — all subagents now use `Claude Sonnet 4.6 (Thinking)` automatically.

- **Toggle/Embed Skills for a Subagent Interactively**:
  ```bash
  konoha agent skill [agent-name]
  ```

- **Delete and Prune a Subagent**:
  ```bash
  konoha agent delete <agent-name>
  ```
  Deletes a **custom** subagent from `agents.yaml` and prunes its `tool_calls` metrics. The seven official ninja agents (`sannin`, `genin`, `kage`, `chunin`, `jonin`, `anbu`, `tokubetsu-jonin`) are **protected** and cannot be deleted.

### Tracking Efficiency and Token Savings

To monitor the performance and cost efficiency of your local setups, you can query historical context window savings directly:

- **View Token Savings**:
  ```bash
  konoha savings
  ```
  Retrieves and displays token savings metrics (Today, 7 days, All time) for both the `konoha` FTS5 database and the `semble` semantic search MCP server, helping developers track overall efficiency.

### System Diagnostics and Health Checks

To verify all components and configurations are operating correctly, you can run automated health checks:

- **Diagnose Environment Health**:
  ```bash
  konoha doctor
  ```
  Runs a comprehensive health check on the environment, verifying Python installations, global directories, SQLite database status, and MCP config files. It features self-healing to automatically recreate or repair missing configuration files or database tables.

### Checking Version and Upgrading

To keep Konoha updated with the latest optimizations and features, you can check your installed version and perform in-place upgrades:

* **Check Current Version**:
  Displays the installed local version (noted as `2.0.0`) and queries GitHub to check if a newer version is available.
  ```bash
  konoha version
  ```

* **Upgrade CLI**:
  Upgrades the local Konoha installation to the latest stable release from GitHub in-place. Displays a real-time animated progress bar (`[████████░░] 80% (stage/total) [Stage Name] | Live action text`) tracking the 7-stage upgrade pipeline:
  1. Environment Verification & Toolchain Diagnostics
  2. Package Manager & Dependency Engine Update (`pnpm` / `npm`)
  3. Global CLI Symlinks & Shell PATH Provisioning
  4. Skill & Agent Registry Sync (idempotent preserve-protection)
  5. Core Configuration & Database Regeneration
  6. Client Integration & IDE Bridges (Antigravity, Cursor, Codex, OpenCode, Claude Code, Command Code)
  7. Verification, Doctor Diagnostics & Self-Healing
  During execution, it uses interactive `@inquirer/prompts` (or `--yes` / `-y` for headless non-interactive mode) before applying upgrades.
  ```bash
  konoha upgrade
  # Non-interactive / headless CI mode:
  konoha upgrade --yes
  ```

### Optional Antigravity Bridge Extension

The external `konoha-bridge` extension is refreshed from the live `master` branch only when Antigravity IDE is detected. It installs at `~/.antigravity-ide/extensions/andycungkrinx91.konoha-bridge-master-universal/` and serves `127.0.0.1:1313`; Konoha’s embedded gateway remains on `127.0.0.1:19999`. No external bridge is enabled automatically. On CLI-only or headless machines, Konoha skips the extension and uses its embedded fallback.

### Model Registry and Fallbacks

* **Available Models Registry**:
  - `Claude Sonnet 4.6 (Thinking)` (default for all Konoha subagents since v2.0.0)
  - `Claude Opus 4.6 (Thinking)`
  - **Dynamic Bridge Models**: When the LLM Proxy Gateway (port `19999`) is running, any models served by active bridges (e.g. `adacode-*` or `antigravity-*`) are dynamically fetched and made available through the gateway.

* **Fallback Configuration**:
  Subagents all use `Claude Sonnet 4.6 (Thinking)` in v2.0.0 — there is no separate fallback tier. On rate-limit or API error, the orchestrator falls back to direct tool calls instead of spawning additional subagents.

## Auto-Approved Permissions & Commands Whitelisting

To optimize CLI sessions and enable frictionless automation, the `init` script configures auto-approval workflows for tools and commands.

> [!IMPORTANT]
> **Explicit User Consent**: As of `v2.0.0`, the CLI will interactively prompt the user (via `@inquirer/prompts`) during setup before applying these auto-approvals.

### 1. Command Whitelisting
The installer registers whitelisted command prefixes in `~/.gemini/antigravity-cli/settings.json`:
- `node bin/cli.js`
- `konoha`

This allows the CLI agent to run status checks and test validations without triggering interactive terminal prompts.

### 2. Tool Auto-Approvals
The installer registers tool auto-approval settings for the `konoha`, `semble`, and `aislop` MCP servers in `~/.gemini/config/mcp_config.json`. This permits silent execution of non-destructive operations:
- **`konoha`**: Auto-approves `find_skill`, `list_skills`, `get_skill`, `optimize_report`, `build_from_source`, `build_from_text`.
- **`semble`**: Auto-approves `search` and `find_related`.
- **`aislop`**: Auto-approves `aislop_scan`, `aislop_fix`, `aislop_why`, and `aislop_baseline`.
- **`konoha`**: Auto-approves `read_file_head`, `read_file_range`, `file_info`, `token_efficient_grep`, `get_file_structure`, and `find_files_clean`.

These configurations eliminate manual user approval prompts for common reads, searches, and CLI execution commands during coding sessions.

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues.

For **Cursor IDE/CLI** setup, see [SETUP-CURSOR.md](SETUP-CURSOR.md).

