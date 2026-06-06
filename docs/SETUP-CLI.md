# Antigravity CLI (agy) Setup Guide

## Prerequisites

- Antigravity CLI (`agy`) installed
- Python 3.8+ installed
- Node.js 18+ (for npx)
- Agent skills in `~/.agents/skills/` (with SKILL.md files)

## Step 1: Install Skills-DB

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

The agent should call `find_skill("terraform aws")` and return relevant devsecops-engineer references — without loading any SKILL.md files.

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

The subagent configurations are stored in a structured format, enabling you to inspect, create, or modify your agent team.

- **List Subagents and Active Skills**:
  ```bash
  konoha agent list
  ```
- **Create a New Custom Subagent**:
  ```bash
  konoha agent create <agent-name> [options]
  ```
  Options:
  - `--title "<Title>"`
  - `--purpose "<Purpose>"`
  - `--instructions "<Instructions>"`
  - `--keywords "<Keywords>"`
  
  Example:
  ```bash
  konoha agent create test-ninja --title "Testing Ninja" --purpose "A testing ninja" --instructions "Test instructions" --keywords "testing"
  ```
- **Embed a Skill to a Subagent**:
  ```bash
  konoha agent embed <agent-name> <skill-name>
  ```
- **Remove/Unembed a Skill from a Subagent**:
  ```bash
  konoha agent unembed <agent-name> <skill-name>
  ```
- **Delete a Subagent Entirely**:
  ```bash
  konoha agent delete <agent-name>
  ```

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues.

