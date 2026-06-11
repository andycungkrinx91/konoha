# 🛠️ Troubleshooting

This guide provides solutions to common issues encountered during the installation, configuration, and execution of Konoha.

---

## 🔍 Common Issues

### ❌ "Python 3 is required but not found"

The MCP server requires Python 3.8+. To install it:

* **Linux (Ubuntu/Debian)**: `sudo apt install python3`
* **Linux (Fedora)**: `sudo dnf install python3`
* **macOS**: `brew install python3` or download from the [official Python downloads page](https://www.python.org/downloads/)
* **Windows**: Download from the [official Python downloads page](https://www.python.org/downloads/) — make sure to check **"Add to PATH"** during installation.

To verify your Python installation:
```bash
python3 --version  # Linux/macOS
python --version   # Windows
```

---

### ❌ "Server not installed" or "Database not found"

Starting with version `1.0.9`, Konoha features self-healing capabilities. Running any `konoha` command (or executing the `konoha doctor` command) will automatically bootstrap and repair missing files.

Alternatively, you can manually re-run the full installer script to verify all files are correctly created and configured:
```bash
npx github:andycungkrinx91/konoha init
```

---

### 🔌 MCP Server Not Detected in Antigravity

1. Check that the configuration file exists:
   ```bash
   cat ~/.gemini/config/mcp_config.json
   ```

2. Verify the `skills-db` entry matches:
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

3. **Restart Antigravity IDE/CLI** — MCP configuration files are only read once on startup.
4. For CLI, run `agy inspect` to verify if `skills-db` is successfully loaded.

---

### 🔍 FTS5 Search Returns No Results

1. Check if the skills have been indexed:
   ```bash
   konoha status
   ```

2. If "Total entries: 0" is displayed, re-run migration:
   ```bash
   konoha migrate
   ```

3. Confirm that skill files exist at `~/.agents/skills/`:
   ```bash
   ls ~/.agents/skills/*/SKILL.md
   ```

---

### 🥷 Agent Still Loading SKILL.md Files Directly

The agent's instructions must be updated. Check the following:

1. `~/.gemini/GEMINI.md` — should contain instructions for `skills-db` references, NOT "Load and follow".
2. IDE User Rules — should match the updated `GEMINI.md`.
3. If necessary, force-reinstall instructions: `npx github:andycungkrinx91/konoha init --force`

---

### 🚫 "Permission denied" Errors

On Linux/macOS, ensure the server script and assets are readable:
```bash
chmod 644 ~/.gemini/skills-db/server.py
chmod 644 ~/.gemini/skills-db/migrate.py
chmod 644 ~/.gemini/skills-db/skills.db
```

---

### 💻 Windows-Specific Issues

* **Paths**: Windows uses backslashes. The installer handles this automatically, but if you're manually editing `mcp_config.json`, use forward slashes or double backslashes:
  ```json
  {
    "command": "python",
    "args": ["C:/Users/youruser/.gemini/skills-db/server.py"]
  }
  ```

* **Python command**: Windows may use `python` instead of `python3`. The installer auto-detects this.
* **Line endings**: If you get `SyntaxError` when running the server, convert the CRLF line endings to LF:
  ```powershell
  # PowerShell
  (Get-Content ~/.gemini/skills-db/server.py -Raw) -replace "`r`n", "`n" | Set-Content ~/.gemini/skills-db/server.py -NoNewline
  ```

---

### 🗄️ Database Corruption

If the SQLite database becomes corrupted, remove it and rebuild the index:
```bash
rm ~/.gemini/skills-db/skills.db
konoha migrate
```

---

### 🧪 Checking the MCP Server Manually

You can test the stdin/stdout MCP server directly from your shell:
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | python3 ~/.gemini/skills-db/server.py
```

*Expected output:* A JSON response containing `protocolVersion` and `serverInfo`.

## Quota Limits, Rate Limits, and API Errors

If a task execution encounters quota limits, rate limits, or API errors (such as `RESOURCE_EXHAUSTED` or HTTP `429` status codes), the coordinator will NOT spawn shadow subagents. Instead, it will immediately fall back to Direct Tool Calls (executing edits, reads, and commands directly) to complete the task.

The system and agent configurations will automatically and immediately fallback to `Gemini 3.1 Flash-Lite` to ensure continuous operational capability. If both the primary model and cloud fallback models return `RESOURCE_EXHAUSTED` or `429` errors, the system is in total quota exhaustion. In this case, the agent will halt execution gracefully and output this exact warning:

> [!WARNING]
> "Your Antigravity account has reached its rate limit quota. Please wait for the quota window to reset, back off request frequency, or upgrade your subscribe/tier in the Google Cloud Console."

### Step-by-Step Guide to Resolve Quota Exhaustion:

1. **Resume the Coding Session**:
   - **IDE User**: Close the current agent panel/chat session and start a new one, or reload your workspace window.
   - **CLI User**: Simply run your previous CLI command (e.g., `konoha` or your target command) to resume the session.

2. **Upgrade Google AI Subscription**:
   - **Google AI Studio**: Go to [Google AI Studio](https://aistudio.google.com/) to add billing information or upgrade your tier.
   - **Google Cloud Console**: Visit the [Google Cloud Console](https://console.cloud.google.com/) to associate a billing account with your project or request a quota limit increase.

## Getting Help

1. Run `konoha status` for diagnostic info
2. Run `konoha test` for server health check
3. Check the logs at `~/.gemini/skills-db/` for any error files
