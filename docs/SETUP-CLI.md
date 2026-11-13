# Konoha CLI Setup Guide (Antigravity CLI `agy` + cross-platform install)

## Prerequisites

- Antigravity CLI (`agy`) installed
- Node.js 24.0.0+ (via nvm, Homebrew, or system package; uses built-in `node:sqlite` with FTS5, zero external native compilation)
- Agent skills in `~/.agents/skills/` (with SKILL.md files)

### Cross-Platform Notes

Status: **Linux x64 and Windows 11 x64 (local `dockur/windows` VM) verified.** `.github/workflows/cross-platform.yml` runs install, lint, full suite (8 shards), and fresh-install smoke across `ubuntu-latest`, `windows-latest`, and `macos-latest`. Locally, all 3 platforms have a reproducible verification path: Linux (`pnpm test:sandbox` Debian + `pnpm ci:act` / `pnpm ci:act:shard` Ubuntu), Windows (`docker/windows-vm/oem/run-ci.cmd` / `retest.cmd` via `scripts/windows-ci.ps1`), and macOS (`KONOHA_SANDBOX_RUNTIME=container pnpm test:sandbox`, with host-native `/private/var` / APFS / `.dmg` semantics covered by `macos-latest` or the symlinked-`HOME` proxy in `docs/CI.md`).

| OS | Node.js 24+ Install | Notes |
|----|-----------------|-------|
| **Linux (Ubuntu/Debian)** | `curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -` | Pure Node.js |
| **Linux (Fedora)** | `curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo -E bash -` | Pure Node.js |
| **macOS** | `brew install node` or `nvm install 24` | Pure Node.js |
| **Windows (WSL)** | Same as Linux | Recommended: use WSL2 |
| **Windows (native)** | [nodejs.org](https://nodejs.org/) or [nvm-windows](https://github.com/coreybutler/nvm-windows) | Pure Node.js |

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

If `rtk` is installed (`cargo install --git https://github.com/rtk-ai/rtk`), Konoha auto-deploys RTK rules to `~/.gemini/antigravity-cli/rules/rtk.md` during init. This instructs agents to use `rtk <command>` for shell operations, reducing token usage by up to 90% on common commands.

## Step 1: Install Konoha (Zero-Configuration Auto-Setup)

> [!TIP]
> **Automatic Global `settings.json` & Config Backup (No Manual `cp -r` Required):**
> You never need to manually back up (`cp -r`) your existing global `settings.json` or coding-agent configurations before installing, upgrading, reinstalling, or migrating Konoha. Before touching any global or project configuration file across all 8 supported clients (`antigravity`, `cursor`, `claude`, `opencode`, `commandcode`, `codex`, `pi`, `omp`), Konoha automatically creates a timestamped, collision-safe, SHA-256-verified backup under `~/.konoha/backups/configs/<client>/<scope>/` with restrictive file permissions (`0600`) and aborts fail-closed if a backup cannot be verified.

### 📦 Standard 3-Step Team Onboarding (Explicit `--client` Append-Only Setup)
For manual repository distribution or local development:
```bash
# 1. Extract and enter the directory
unzip konoha.zip
cd konoha

# 2. Install CLI dependencies (if node_modules is not included in zip)
pnpm install

# 3. Append Konoha MCP & agent config for your target coding client(s) (with automatic backup):
node bin/cli.js init --client=cursor
node bin/cli.js init --client=claude
node bin/cli.js init --client=opencode
node bin/cli.js init --client=omp
node bin/cli.js init --client=codex
node bin/cli.js init --client=pi
node bin/cli.js init --client=antigravity
node bin/cli.js init --client=commandcode
# Or initialize all 8 supported clients at once:
node bin/cli.js init --client=all
```

### Installation Modes — Pick Exactly One

Konoha has three distinct modes. They are not interchangeable, and no mode performs another's work.

| Mode | Command | Behavior |
|:---|:---|:---|
| **Persistent global install** | `npm install -g konoha-mcp@latest` (or `pnpm add -g konoha-mcp@latest`); from a packed tarball, `npm install -g ./konoha-mcp-<version>.tgz` | Puts `konoha` on PATH. The package ships no install-time lifecycle script, so nothing is prompted for permission and nothing touches `$HOME` at install time. Runtime setup stays explicit (`konoha init --yes`) |
| **In-place upgrade** | `konoha upgrade` | Reinstalls the global package with the detected manager (npm → pnpm → yarn → GitHub fallback), then runs the runtime lifecycle. If every installer fails it prints `Upgrade aborted: no package manager could install konoha-mcp@<v>.`, keeps your existing installation untouched, and exits `1` |
| **Ephemeral execution** | `npm exec --yes --package=konoha-mcp@latest -- konoha --version` | Runs one command from the registry. No persistent global install, no install-script side effects |

`npx i -g konoha-mcp` is **not valid syntax** — `i` is not an `npx` flag. Use the persistent or ephemeral form above.

### Global Installation (Permanent 'konoha' terminal command)
```bash
# Install globally from npm (recommended):
npm install -g konoha-mcp@latest
# Or with pnpm:
pnpm add -g konoha-mcp@latest

# Initialize a specific client or all 8 clients (append-only, preserves existing settings):
konoha init --client=all

# Restore a previous client configuration backup at any time:
konoha restore --client=cursor
konoha restore --client=all
```

```powershell
# Windows PowerShell — identical commands
npm install -g konoha-mcp@latest
konoha init --client=all
```

### Direct Execution (Zero-Install via npm exec or pnpm dlx)
```bash
# 1. Run one-shot directly via npm exec:
npm exec --yes --package=konoha-mcp@latest -- konoha init --client=all
# Or with pnpm dlx:
pnpm dlx konoha-mcp init --client=all

# 2. Re-index skills & synchronize neural vector embeddings (strictly non-destructive):
konoha migrate --rebuild-embeddings
# (or simply: konoha embed)
```

This installs the MCP server and migrates your skills. The CLI should output:

```text
🚀 Konoha Installer
──────────────────────────────────────────────
✓ Node.js ≥ 24.0.0 found: v24.x.x
✓ Found: ~/.agents/skills/ (5 skills)
📦 Installing MCP Server
✓ Installed: ~/.konoha/file_tools_mcp.js, file_tools_launcher.js, file_tools_router.js
✓ Runtime mirrored: ~/.konoha/src (mcp/ langgraph/ nodes/ workflow/ intact)
✓ Database: ~/.konoha/konoha.db (created if missing)
✓ Migration Complete: skills indexed, FTS5 ready
✓ Global command 'konoha' → ~/.konoha/bin/cli.js
✅ Installation Complete!
```

> On Node < 24 the CLI never reaches this output: `bin/cli.js` prints `Konoha requires Node.js >= 24.0.0 (found <v>).` and exits `1`, because `src/sqlite_driver.js` requires the Node 24 built-in `node:sqlite`.

### Cross-Platform: Windows PowerShell
On Windows, the same registry commands work in PowerShell:
```powershell
# Persistent global install, then init
npm install -g konoha-mcp@latest
konoha init --client=all

# Ephemeral, no persistent install
npm exec --yes --package=konoha-mcp@latest -- konoha init --client=all
```

## Step 2: Verify MCP Detection

Run the Antigravity CLI inspect command:

```bash
agy inspect
```

You should see `konoha` and `aislop` listed among the MCP servers. If not, check that `~/.gemini/config/mcp_config.json` contains both entries (run `konoha doctor --yes` to repair).

### Windows PowerShell Alternative
```powershell
agy inspect
```

Or use the node launcher directly:
```powershell
'{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node "$env:USERPROFILE\.konoha\file_tools_launcher.js"
```
(PowerShell has no `<<<` here-string operator — the bash `<<<` form only works in WSL or Git Bash.)

## Step 3: Verify Konoha Works

```bash
konoha test
```

Expected: all tests pass (MCP integration + `tests/test_*.js` standalone suites).

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

## How Konoha Integrates with agy

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
   # Or rebuild embeddings explicitly:
   konoha migrate --rebuild-embeddings
   ```

The migration is strictly non-destructive and idempotent — it preserves all pre-existing user skills and updates indexed entries with fresh content without pruning.

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
  *(Note: `konoha skill add` is the canonical command; `konoha skilladd` is strictly prohibited).*
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

- **Configure Subagent Model Assignment (v2.0.2)**:
  Assign active bridge-served models (or inherit the host default) to subagents:
  ```bash
  # Interactive two-step raw-mode TUI:
  konoha agent models config [agent-name]

  # Non-interactive / CLI mode:
  konoha agent models config <agent-name> --model <model-id>
  konoha agent models config <agent-name> --model inherit

  # View all current agent model assignments:
  konoha agent models
  ```

- **Toggle/Embed Skills for a Subagent Interactively**:
  ```bash
  konoha agent skill [agent-name]
  ```

- **Delete and Prune a Subagent**:
  ```bash
  konoha agent delete <agent-name>
  ```
  Deletes a **custom** subagent from `agents.yaml` and prunes its `tool_calls` metrics. The nine official ninja agents (`sannin`, `genin`, `kage`, `chunin`, `jonin`, `anbu`, `tokubetsu-jonin`, `akatsuki`, `yamanaka`) are **protected** and cannot be deleted.

### Database Maintenance & Telemetry Pruning (`konoha data`)

- **Online Zero-Downtime Backup**:
  ```bash
  konoha data backup
  # Or specify target backup destination:
  konoha data backup /path/to/custom_backup.db
  ```
  Creates an atomic, non-blocking snapshot using SQLite `VACUUM INTO` while the database is actively handling requests.

- **Rebuild FTS5 Search Indexes**:
  ```bash
  konoha data rebuild-fts
  ```
  Rebuilds all full-text search indexes (`skills_fts`, `persona_memories_fts`) from canonical tables.

- **Prune Historical Telemetry**:
  ```bash
  konoha data prune --retention 90
  ```
  Prunes execution records from `tool_calls` older than the retention threshold (default 90 days) while preserving all-time summary metrics.

### SDLC Task Governance & Quality Gates (v2.0.2)

Konoha includes a built-in SDLC governance layer tracking tasks, Definition of Readiness (DoR), cross-provider reviews, and anti-slop compliance in the `sdlc_tasks` SQLite table:

- **List Recorded SDLC Tasks**:
  ```bash
  konoha task list
  ```

- **Inspect Task Evidence & Diagnostics**:
  ```bash
  konoha task show <task-id>
  ```

- **Inspect Anti-Slop Findings for a Task**:
  ```bash
  konoha task slop <task-id>
  ```

- **Configure Project Governance Modes**:
  ```bash
  # Set Definition-of-Readiness gate mode (advisory | enforced):
  konoha project set dor-mode advisory
  konoha project set dor-mode enforced

  # Set Review Independence mode (self | cross-provider):
  konoha project set review-mode self
  konoha project set review-mode cross-provider
  ```

### Tracking Efficiency and Token Savings

To monitor the performance and cost efficiency of your local setups, you can query historical context window savings directly:

- **View Token Savings**:
  ```bash
  konoha savings
  ```
  Retrieves and displays token savings metrics (Today, 7 days, All time) from the `konoha` FTS5 telemetry database, helping developers track overall efficiency.

### AI Fingerprint Detection (Website & Documents) (v2.0.2)

Scan websites and Production documents for AI generation markers, generator footprints, and robotic cadence:

- **Scan Website or Code for AI Fingerprints**:
  ```bash
  konoha detect-ai <path-file-or-url> [--json]
  ```
  Evaluates generator meta tags, Lucide icons, shadcn/ui shapes, Vercel/Netlify hosting signals, attribution comments, boilerplate text, and template asset names across directories, single files, or URLs. Scores 0–100 (0–20 = Human-Built per PLAN_HUMAN_BUILT).

- **Scan Documents for AI Fingerprints (0%–1% ZeroGPT Target)**:
  ```bash
  konoha detect-docs <file-path> [--json]
  ```
  Evaluates `.docx`, `.pdf`, `.pptx`, `.xlsx`, `.md`, and `.txt` files for sliding-window paragraph burstiness, sentence cadence uniformity ($CV < 0.18$), generator tags (`python-docx`, `docx-js`), watermarks, and dark theme violations.

### Web Configuration UI (`konoha ui`) (v2.0.2)

Konoha provides an optional local browser-based management dashboard powered by SvelteKit 3 and Tailwind CSS v4 on `127.0.0.1:1404`:

- **Start in the foreground**:
  ```bash
  konoha ui start
  ```
  Runs the server in the foreground and blocks the terminal. Press `Ctrl+C` to stop. The default browser opens automatically unless `--no-open` is passed.
- **Build from source**:
  ```bash
  konoha ui build
  ```
  Compiles the production SvelteKit bundle into `apps/web/build/` and refreshes the installed runtime copy under `~/.konoha/apps/web/build`.
- **Options**: `--port=<n>` (default `1404`), `--host=<h>` (default `127.0.0.1`), `--no-open`.

`konoha ui` has exactly these two subcommands. Nothing starts the UI implicitly — not `init`, not `upgrade`. A second `konoha ui start` on a port that is already listening exits 1 with `already running`; press Ctrl+C in the owning terminal first. For a boot-time instance use `konoha service`.

- **Register the boot-time OS service** (systemd on Linux, launchd on macOS):
  ```bash
  konoha service install
  konoha service status
  konoha service restart
  konoha service uninstall
  ```

### LLM Bridge Router (`konoha bridge`)

Manage local proxy bridges and upstream LLM providers on `127.0.0.1:19999`:

- **List Active Bridges & Models**:
  ```bash
  konoha bridge list
  ```
- **Check Router Health**:
  ```bash
  konoha bridge status
  ```
- **Create a New Bridge Configuration**:
  ```bash
  konoha bridge create
  ```
- **Enable or Disable a Bridge**:
  ```bash
  konoha bridge enable <name>
  konoha bridge disable <name>
  ```
- **Delete a Bridge**:
  ```bash
  konoha bridge delete <name>
  ```
- **Start the Standalone Bridge Gateway**:
  ```bash
  konoha bridge start
  ```

### System Diagnostics and Health Checks

To verify all components and configurations are operating correctly, you can run automated health checks:

- **Diagnose Environment Health**:
  ```bash
  konoha doctor
  ```
  Runs a comprehensive health check on the environment, verifying Node.js installations, global directories, SQLite database status, and MCP config files. It features self-healing to automatically recreate or repair missing configuration files or database tables.

### Checking Version and Upgrading

To keep Konoha updated with the latest optimizations and features, you can check your installed version and perform in-place upgrades:

* **Check Current Version**:
  Displays the installed local version (`2.2.22`) and queries the official npm registry to check if a newer version is available:
  ```bash
  konoha version
  ```

* **Upgrade CLI**:
  Upgrades the local Konoha installation to the latest stable release from npm registry (`konoha-mcp`) in-place. Displays a real-time animated progress bar (`[████████░░] 80% (stage/total) [Stage Name] | Live action text`) tracking the 7-stage upgrade pipeline:
  1. Environment Verification & Toolchain Diagnostics
  2. Package Manager & Dependency Engine Update (`pnpm` / `npm`)
  3. Global CLI Symlinks & Shell PATH Provisioning
  4. Skill & Agent Registry Sync (strictly non-destructive: additive-only copy, zero pruning of pre-existing user skills)
  5. Core Configuration & Database Regeneration (additive SQLite upsert without wiping `konoha.db`; managed boundary injection preserving all user instructions)
  6. Client Integration & IDE Bridges (Antigravity, Cursor, Codex, OpenCode, Claude Code, Command Code, Pi / pi.dev; custom agent union-merge in `agents.yaml`)
  7. Verification, Doctor Diagnostics & Self-Healing
  During execution, it uses interactive confirmation prompts via native Node.js `node:readline` (or `--yes` / `-y` for headless non-interactive mode) before applying upgrades.
  ```bash
  konoha upgrade
  # Non-interactive / headless CI mode:
  konoha upgrade --yes
  ```

  **Failure semantics (2.2.19):** if npm, pnpm, yarn, and the GitHub fallback all fail to install the target, the command prints `Upgrade aborted: no package manager could install konoha-mcp@<v>.`, states that your existing installation and configuration were not modified, prints the recovery commands, and **exits 1**. It never continues into the post-upgrade lifecycle against an un-upgraded package.

  **Windows file locking:** Windows cannot replace a global package while a process from it is running. Konoha writes `~/.konoha/.upgrade_pending.json` before the install stage, verifies and deletes it afterwards, and on the next `konoha` startup reads a leftover marker and prints `Upgrade to <target> was interrupted. Re-run "konoha upgrade --yes".` — startup continues normally either way.

### Optional Antigravity Bridge Extension

The external `konoha-bridge` extension is refreshed from the live `master` branch only when Antigravity IDE is detected. It installs at `~/.antigravity-ide/extensions/andycungkrinx91.konoha-bridge-master-universal/` and serves `127.0.0.1:1313`; Konoha’s embedded gateway remains on `127.0.0.1:19999`. No external bridge is enabled automatically. On CLI-only or headless machines, Konoha skips the extension and uses its embedded fallback.

### Model Registry and Fallbacks

* **Available Models Registry**:
  - `Claude Sonnet 4.6 (Thinking)` (default for all Konoha subagents in v2.0.2)
  - `Claude Opus 4.6 (Thinking)`
  - **Dynamic Bridge Models**: When the LLM Proxy Gateway (port `19999`) is running, any models served by active bridges (e.g. `adacode-*` or `antigravity-*`) are dynamically fetched and made available through the gateway.

* **Fallback Configuration**:
  Subagents all use `Claude Sonnet 4.6 (Thinking)` in v2.0.2 — there is no separate fallback tier. On rate-limit or API error, the orchestrator falls back to direct tool calls instead of spawning additional subagents.

## Auto-Approved Permissions & Commands Whitelisting

To optimize CLI sessions and enable frictionless automation, the `init` script configures auto-approval workflows for tools and commands.

> [!IMPORTANT]
> **Explicit User Consent**: The CLI interactively prompts the user (via native Node.js `node:readline`) during setup before applying these auto-approvals.

### 1. Command Whitelisting
The installer registers whitelisted command prefixes in `~/.gemini/antigravity-cli/settings.json`:
- `node bin/cli.js`
- `konoha`

This allows the CLI agent to run status checks and test validations without triggering interactive terminal prompts.

### 2. Tool Auto-Approvals
The installer registers tool auto-approval settings for the `konoha` and `aislop` MCP servers in `~/.gemini/config/mcp_config.json`. This permits silent execution of non-destructive operations:
- **`konoha`**: Auto-approves `find_skill`, `list_skills`, `get_skill`, `optimize_report`, `build_from_source`, `build_from_text`.
- **`aislop`**: Auto-approves `aislop_scan`, `aislop_fix`, `aislop_why`, and `aislop_baseline`.
- **`konoha`**: Auto-approves `read_file_head`, `read_file_range`, `file_info`, `token_efficient_grep`, `get_file_structure`, and `find_files_clean`.
- **`konoha`**: Auto-approves every canonical tool (55), including the native code-intelligence set — `code_index`, `code_search`, `code_symbol`, `code_context`, `code_impact`, `code_status`, `code_remove`. The grant list is derived from `KONOHA_CANONICAL_TOOLS`, so a new canonical tool is approved without editing this list.

These configurations eliminate manual user approval prompts for common reads, searches, and CLI execution commands during coding sessions.

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues.

For **Cursor IDE/CLI** setup, see [SETUP-CURSOR.md](SETUP-CURSOR.md).

