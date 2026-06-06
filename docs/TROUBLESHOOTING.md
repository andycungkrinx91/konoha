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
   npx github:andycungkrinx91/konoha status
   ```

2. If "Total entries: 0", re-run migration:
   ```bash
   npx github:andycungkrinx91/konoha migrate
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
npx github:andycungkrinx91/konoha migrate
```

### Checking MCP server manually

Test the server directly:
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | python3 ~/.gemini/skills-db/server.py
```

Expected: A JSON response with `protocolVersion` and `serverInfo`.

## Getting Help

1. Run `npx github:andycungkrinx91/konoha status` for diagnostic info
2. Run `npx github:andycungkrinx91/konoha test` for server health check
3. Check the logs at `~/.gemini/skills-db/` for any error files
