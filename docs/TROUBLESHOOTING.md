# Troubleshooting

## Common Issues

### "Python 3 is required but not found"

The MCP server requires Python 3.8+. Install it:

- **Linux (Ubuntu/Debian)**: `sudo apt install python3`
- **Linux (Fedora)**: `sudo dnf install python3`
- **macOS**: `brew install python3` or download from [python.org](https://www.python.org/downloads/)
- **Windows**: Download from [python.org](https://www.python.org/downloads/) — check "Add to PATH" during install

Verify:
```bash
python3 --version  # Linux/macOS
python --version   # Windows
```

### "Server not installed" or "Database not found"

Run the full install:
```bash
npx github:andycungkrinx91/konoha init
```

### MCP server not detected in Antigravity

1. Check the config file exists:
   ```bash
   cat ~/.gemini/config/mcp_config.json
   ```

2. Verify `skills-db` entry:
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

3. **Restart Antigravity IDE/CLI** — MCP config is read on startup.

4. For CLI, run `agy inspect` to check if skills-db is loaded.

### FTS5 search returns no results

1. Check if skills were migrated:
   ```bash
   konoha status
   ```

2. If "Total entries: 0", re-run migration:
   ```bash
   konoha migrate
   ```

3. Check that skills exist at `~/.agents/skills/`:
   ```bash
   ls ~/.agents/skills/*/SKILL.md
   ```

### Agent still loading SKILL.md files directly

The agent's instructions need to be updated. Check:

1. `~/.gemini/GEMINI.md` — should contain `skills-db` references, NOT "Load and follow"
2. IDE User Rules — should match the updated GEMINI.md
3. Re-run: `npx github:andycungkrinx91/konoha init --force`

### "Permission denied" errors

On Linux/macOS, ensure the server script is readable:
```bash
chmod 644 ~/.gemini/skills-db/server.py
chmod 644 ~/.gemini/skills-db/migrate.py
chmod 644 ~/.gemini/skills-db/skills.db
```

### Windows-specific issues

**Paths**: Windows uses backslashes. The installer handles this, but if you're manually editing `mcp_config.json`, use forward slashes or double backslashes:
```json
{
  "command": "python",
  "args": ["C:/Users/youruser/.gemini/skills-db/server.py"]
}
```

**Python command**: Windows may use `python` instead of `python3`. The installer auto-detects this.

**Line endings**: If you get `SyntaxError` when running the server, convert line endings:
```bash
# PowerShell
(Get-Content ~/.gemini/skills-db/server.py -Raw) -replace "`r`n", "`n" | Set-Content ~/.gemini/skills-db/server.py -NoNewline
```

### Database corruption

If the database becomes corrupted:
```bash
# Remove and re-create
rm ~/.gemini/skills-db/skills.db
konoha migrate
```

### Checking MCP server manually

Test the server directly:
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | python3 ~/.gemini/skills-db/server.py
```

Expected: A JSON response with `protocolVersion` and `serverInfo`.

## Quota Limits, Rate Limits, and API Errors

If a task execution encounters quota limits, rate limits, or API errors (such as `RESOURCE_EXHAUSTED` or HTTP `429` status codes), the coordinator will NOT spawn shadow subagents. Instead, it will immediately fall back to Direct Tool Calls (executing edits, reads, and commands directly) to complete the task.

The system and agent configurations will automatically and immediately fallback to `Gemini 3.5 Flash (High)` to ensure continuous operational capability. If both the primary model and cloud fallback models return `RESOURCE_EXHAUSTED` or `429` errors, the system is in total quota exhaustion. In this case, the agent will halt execution gracefully and output this exact warning:

> [!WARNING]
> "Your Antigravity account has reach the limit quota. Please change the account and resume the session or increase your subcribe Google AI."

### Step-by-Step Guide to Resolve Quota Exhaustion:

1. **Switch Google Accounts**:
   Open a terminal window and run the following command to authenticate with a different Google account that has available quota:
   ```bash
   gcloud auth application-default login
   ```
   Follow the prompts in your web browser to complete the sign-in process for the new account.

2. **Verify Active Account**:
   To inspect and verify which Google account is currently authorized and active, execute:
   ```bash
   gcloud auth list
   ```
   Confirm that the active account marked with an asterisk is the correct one.

3. **Resume the Coding Session**:
   - **IDE User**: Close the current agent panel/chat session and start a new one, or reload your workspace window.
   - **CLI User**: Simply run your previous CLI command (e.g., `konoha` or your target command) to resume the session.

4. **Upgrade Google AI Subscription**:
   - **Google AI Studio**: Go to [Google AI Studio](https://aistudio.google.com/) to add billing information or upgrade your tier.
   - **Google Cloud Console**: Visit the [Google Cloud Console](https://console.cloud.google.com/) to associate a billing account with your project or request a quota limit increase.

## Getting Help

1. Run `konoha status` for diagnostic info
2. Run `konoha test` for server health check
3. Check the logs at `~/.gemini/skills-db/` for any error files
