# Antigravity CLI (agy) Setup Guide

## Prerequisites

- Antigravity CLI (`agy`) installed
- Python 3.8+ installed
- Node.js 18+
- Agent skills in `~/.agents/skills/` (with SKILL.md files)

## Step 1: Install Skills-DB (Zero-Configuration Auto-Setup)

> [!NOTE]
> **Auto-Setup with Interactive Consent**:
> Starting with version `1.0.9` for Google Policy compliance, running **any** `konoha` command automatically triggers the bootstrap routine (`ensureAutoSetup()`). The CLI will now interactively prompt you using `@inquirer/prompts` Yes/No flows before modifying any `~/.gemini` configurations, setting up subagents, or auto-approving MCP tools.
>
> If you still want to perform a manual clean initialization, run:

```bash
npx github:andycungkrinx91/konoha init
```

This installs the MCP server and migrates your skills. The CLI should output:

```
🚀 Konoha Installer
──────────────────────────────────────────────
✓ Python 3 found: python3
✓ Found: ~/.agents/skills/ (5 skills)
📦 Installing MCP Server
✓ Installed: ~/.gemini/skills-db/server.py
✓ Installed: ~/.gemini/skills-db/migrate.py
📊 Migrating Skills to SQLite FTS5
...
✅ Installation Complete!
```

## Step 2: Verify MCP Detection

Run the Antigravity CLI inspect command:

```bash
agy inspect
```

You should see `skills-db` listed among the MCP servers. If not, check that `~/.gemini/config/mcp_config.json` contains the skills-db entry.

## Step 3: Verify Skills-DB Works

```bash
konoha test
```

## Step 4: Test in a Session

Start a new agy session:

```bash
agy
```

Then ask:

```
Search for "terraform aws" using the skills-db MCP tool.
```

The agent should call `find_skill("terraform aws")` and return relevant anbu-skill references — without loading any SKILL.md files.

## How Skills-DB Integrates with agy

### MCP Config Location

agy reads MCP config from `~/.gemini/config/mcp_config.json`:

```json
{
  "mcpServers": {
    "skills-db": {
      "command": "python3",
      "args": ["/home/youruser/.gemini/skills-db/server.py"]
    }
  }
}
```

### GEMINI.md Location

agy reads global instructions from `~/.gemini/GEMINI.md`. The installer updates this file with skills-db instructions.

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
  - `--title "Title"`: Display title of your agent (e.g., `"Database Expert"`).
  - `--purpose "Purpose"`: Goal of the agent (e.g., `"Optimize SQL queries"`).
  - `--keywords "keywords"`: Comma-separated triggers that delegate tasks to this agent (e.g., `"database, SQL"`).
  - `--instructions "text"`: Special instructions given to this agent.

  *Example:*
  ```bash
  konoha agent create sql-expert \
    --title "Database Expert" \
    --purpose "Optimize SQL queries and verify database schemas" \
    --keywords "sql, database, query optimization" \
    --instructions "Verify SQL queries using EXPLAIN and ensure correct index usage."
  ```

- **Configure Subagent Models Interactively**:
  ```bash
  konoha agent models [agent-name]
  ```

- **Toggle/Embed Skills for a Subagent Interactively**:
  ```bash
  konoha agent skill [agent-name]
  ```

- **Delete and Prune a Subagent**:
  ```bash
  konoha agent delete <agent-name>
  ```
  Deletes the subagent configuration from `agents.json` and prunes its historical metrics from the SQLite database's `tool_calls` table, preventing legacy subagents (like `ops-ninja` or `shadow-anbu`) from cluttering the status call frequency list.

### Tracking Efficiency and Token Savings

To monitor the performance and cost efficiency of your local setups, you can query historical context window savings directly:

- **View Token Savings**:
  ```bash
  konoha savings
  ```
  Retrieves and displays token savings metrics (Today, 7 days, All time) for both the `skills-db` FTS5 database and the `semble` semantic search MCP server, helping developers track overall efficiency.

### Design Match and Render Comparison

To ensure built website interfaces are a 100% match with design mockups while conserving token usage, you can run pixel-by-pixel render checks:

- **Run Design Match Comparison**:
  ```bash
  konoha render <url> <mockup-path> [diff-output-path]
  ```
  This command takes a screenshot of the running website URL, renders the mockup file in the browser if it has a `.svg` or `.html` extension, performs a pixel-by-pixel visual comparison, displays similarity percentages, and saves a diff image showing highlighted mismatches to `[diff-output-path]`.

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
  Displays the installed local version (noted as `1.1.4`) and queries GitHub to check if a newer version is available.
  ```bash
  konoha version
  ```

* **Upgrade CLI**:
  Upgrades the local Konoha installation to the latest stable release from GitHub in-place. During execution, it uses interactive `@inquirer/prompts` to ensure explicit user consent before modifying configurations.
  ```bash
  konoha upgrade
  ```

### Model Registry and Fallbacks

Konoha CLI maintains a registry of available Large Language Models (LLMs) that can be assigned to your subagents.

* **Available Models Registry**:
  - `Gemini 3.1 Flash-Lite`
  - `Gemini 2.5 Flash`
  - `Gemini 3.5 Flash (Low / Medium / High)`
  - `Gemini 3.1 Pro (Low / High)`
  - `Claude Sonnet 4.6 (Thinking)`
  - `Claude Opus 4.6 (Thinking)`
  - `GPT-OSS 120B (Medium)`

* **Fallback Configuration**:
  Subagents default to using `Gemini 3.1 Flash-Lite` as their automatic fallback model in the event of primary model failures, rate limits, or API errors.

* **Quota Exceeded Recovery**:
  In case of total quota exhaustion, the system will output the standard Antigravity account limit warning. Refer to the recovery steps (using `gcloud auth login` or subscription upgrades) documented in [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## Auto-Approved Permissions & Commands Whitelisting

To optimize CLI sessions and enable frictionless automation, the `init` script configures auto-approval workflows for tools and commands.

> [!IMPORTANT]
> **Explicit User Consent**: As of `v1.0.9`, the CLI will interactively prompt the user (via `@inquirer/prompts`) during setup before applying these auto-approvals.

### 1. Command Whitelisting
The installer registers whitelisted command prefixes in `~/.gemini/antigravity-cli/settings.json`:
- `node bin/cli.js`
- `konoha`

This allows the CLI agent to run status checks and test validations without triggering interactive terminal prompts.

### 2. Tool Auto-Approvals
The installer registers tool auto-approval settings for the `skills-db` and `semble` MCP servers in `~/.gemini/config/mcp_config.json`. This permits silent execution of non-destructive operations:
- **`skills-db`**: Auto-approves `find_skill`, `list_skills`, and `get_skill`.
- **`semble`**: Auto-approves `search` and `find_related`.

These configurations eliminate manual user approval prompts for common reads, searches, and CLI execution commands during coding sessions.

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues.
