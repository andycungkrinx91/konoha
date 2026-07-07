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

2. Verify the `konoha` entry matches:
   ```json
   {
     "mcpServers": {
       "konoha": {
         "command": "python3",
         "args": ["/home/youruser/.konoha/server.py"]
       }
     }
   }
   ```

3. **Restart Antigravity IDE/CLI** — MCP configuration files are only read once on startup.
4. For CLI, run `agy inspect` to verify if `konoha` is successfully loaded.

---

### 🔌 MCP Server Not Detected in Cursor

1. Check that the configuration file exists:
   ```bash
   cat ~/.cursor/mcp.json
   ```

2. Verify `konoha`, `semble`, and `konoha` entries are present (installed by `konoha init` or `konoha doctor --yes`).

3. Run the bootstrap hook manually (must exit 0):
   ```bash
   node ~/.konoha/cursor_bootstrap.js
   echo $?   # should print 0
   ```

4. **Restart Cursor** — open a new agent session after MCP config changes.

5. Run `konoha doctor --yes` to auto-repair Cursor MCP, subagents, hooks, and CLI permissions.

See [SETUP-CURSOR.md](SETUP-CURSOR.md) for full Cursor setup.

---

### 🔌 MCP Server Not Detected in Claude Code or OpenCode

1. Confirm the CLI is installed: `claude --version` or `opencode --version`.
2. If **not installed**, Konoha skips auto-setup by design — use templates in `docs/templates/` after you install the CLI, or run `konoha init` once the CLI is available.
3. If **installed**, run `konoha doctor --yes` or `konoha init --force` to merge Konoha MCP entries.
4. Verify with `konoha status` (Claude Code / OpenCode integration rows).
5. Restart the CLI session (`/mcp` in Claude Code, `opencode mcp list` in OpenCode).

Full walkthrough: [SETUP-MCP-CLIENTS.md](SETUP-MCP-CLIENTS.md).

---

### 📂 Working in the Konoha repo — skill not found

Project-local skills live in `.agents/skills/` (including `konoha-maintenance`). After `git pull`, run:

```bash
konoha migrate
```

Then agents should use `find_skill("konoha maintenance")` instead of reading `SKILL.md` directly. Confirm indexing with `konoha status` (expect `konoha` skill in the list).

---

### 📁 `konoha` MCP Not Working

**Symptoms:** Cursor shows `konoha` with **0 tools** or "not connected".

1. Verify files are installed:
   ```bash
   ls ~/.konoha/file_tools_mcp.js ~/.konoha/file_tools_launcher.sh ~/.konoha/file_tools/
   ```

2. Repair and refresh Cursor MCP config:
   ```bash
   konoha doctor --yes
   ```

3. **Cursor global** `~/.cursor/mcp.json` should use the cross-platform JS launcher:
   ```bash
   grep -A5 konoha-files ~/.cursor/mcp.json
   ```
   Expected: `"command": "node"` with `file_tools_launcher.js`.

4. Smoke test (Linux/macOS/Git Bash):
   ```bash
   node ~/.konoha/file_tools_launcher.js <<< '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
   ```
   **Windows (PowerShell):**
   ```powershell
   '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node $env:USERPROFILE\.konoha\file_tools_launcher.js
   ```
   Expected: JSON listing **6 tools**.

5. **Restart Cursor** after repair.

6. Run `konoha test` — expects **16 tests** (9 konoha + 7 konoha-files).

**Common errors:**
- `Refused: requested span is N lines (max 500)` — narrow `read_file_range` window.
- `Showing first 20 matches` — expected; refine `token_efficient_grep` pattern.

---

### 📊 `konoha agent status` Shows Wrong Counts

Agent attribution when the `agent` MCP parameter is omitted is resolved by `detect_active_agent()` in `server.py`:

- **Antigravity**: Scans `~/.gemini/antigravity-ide/brain` and `antigravity-cli/brain` using delegated `prompt.md` and recent `PLANNER_RESPONSE` transcripts (ignores `VIEW_FILE` noise). If `ANTIGRAVITY_CONVERSATION_ID` is set, scans are strictly isolated to the active session folder (Cursor projects are excluded) to prevent cross-session telemetry pollution.
- **Cursor**: Scans `~/.cursor/projects/*/agent-transcripts/` for `Task` `subagent_type`, subagent `[Agent] active` logs, or `[Konoha] orchestrator active`.
- **Claude Code**: Scans `~/.claude/projects/*/*.jsonl` for assistant message blocks containing subagent `[Agent] active` activation strings or Task delegation.

**Fixes:**
1. Pass `agent='genin'` (etc.) explicitly in `find_skill` / `get_skill` when possible.
2. Ensure subagents log `[Icon Agent] active` at response start.
3. Run verification:
   ```bash
   python3 src/test_agent_attribution.py
   python3 src/test_cursor_attribution.py
   python3 src/test_claude_attribution.py
   ```

Unregistered names (`orchestrator`, `null`, tests) appear under **Direct Tool Calls** — this is expected.

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

1. `~/.gemini/GEMINI.md` — should contain instructions for `konoha` references, NOT "Load and follow".
2. IDE User Rules — should match the updated `GEMINI.md`.
3. If necessary, force-reinstall instructions: `npx github:andycungkrinx91/konoha init --force`

---

### 🚫 "Permission denied" Errors

On Linux/macOS, ensure the server script and assets are readable:
```bash
chmod 644 ~/.konoha/server.py
chmod 644 ~/.konoha/migrate.py
chmod 644 ~/.konoha/skills.db
```

---

### 🪞 Cursor Skills Mirror Missing or Stale

Konoha mirrors `~/.agents/skills/` → `~/.cursor/skills/` (and project `.agents/skills/` → `.cursor/skills/` when project deploy is enabled). Skill **content** is still loaded via `konoha` MCP — the mirror is filesystem parity for Cursor.

**Symptoms:** `~/.cursor/skills/` empty, outdated, or missing a skill you added to `~/.agents/skills/`.

**Fixes:**
1. Run `konoha doctor --yes` — re-syncs global and project Cursor skills.
2. After editing skills: `konoha migrate` (re-indexes DB and refreshes mirrors).
3. After `konoha skill add`: mirror runs automatically; verify with `ls ~/.cursor/skills/`.
4. On Cursor session start: `cursor_bootstrap.js` self-heals skills mirror (fail-open).

---

### 💻 Windows-Specific Issues

* **Paths**: Windows uses backslashes. The installer handles this automatically, but if you're manually editing `mcp_config.json`, use forward slashes or double backslashes:
  ```json
  {
    "command": "python",
    "args": ["C:/Users/youruser/.konoha/server.py"]
  }
  ```

* **Python command**: Windows may use `python` instead of `python3`. The installer auto-detects this.
* **Line endings**: If you get `SyntaxError` when running the server, convert the CRLF line endings to LF:
  ```powershell
  # PowerShell
  (Get-Content ~/.konoha/server.py -Raw) -replace "`r`n", "`n" | Set-Content ~/.konoha/server.py -NoNewline
  ```

---

### 🗄️ Database Corruption

If the SQLite database becomes corrupted, remove it and rebuild the index:
```bash
rm ~/.konoha/skills.db
konoha migrate
```

---

### 🧪 Checking the MCP Server Manually

**konoha (Python):**
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | python3 ~/.konoha/server.py
```

**konoha-files (Node):**
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node ~/.konoha/file_tools_mcp.js
```

*Expected output:* A JSON response containing `protocolVersion` and `serverInfo` (initialize) or a `tools` array (tools/list).

## API Rate Limits and Errors

If a task execution encounters rate limits or API errors, the coordinator will fall back to Direct Tool Calls (executing edits, reads, and commands directly) to complete the task.

The system and agent configurations will automatically fallback to `Gemini 3.1 Flash-Lite` to ensure continuous operational capability.

## Bridge Gateway Troubleshooting

### Port Already in Use

```bash
# Check if something is already on port 19999
lsof -i :19999
# Kill the process if needed
kill -9 $(lsof -t -i :19999)
```

### Gateway Won't Start

1. Ensure no other process is using port 19999
2. Check that `node >= 18.0.0` is installed:
   ```bash
   node --version
   ```
3. Verify bridge configuration is valid:
   ```bash
   konoha bridge list
   ```

### Request Times Out / No Response

1. Check if the bridge is reachable:
   ```bash
   curl http://127.0.0.1:19999/healthz
   ```
2. Verify the target bridge is enabled:
   ```bash
   konoha bridge status
   ```
3. Check the bridge's target URL is accessible:
   ```bash
   curl -X POST http://localhost:11437/v1/chat/completions -H "Content-Type: application/json" -d '{"model":"llama3.1","messages":[{"role":"user","content":"hi"}]}'
   ```

### Streaming Produces Garbled / Corrupted Output

- This is handled automatically by the gateway (HTML entity escaping, null byte stripping)
- If you still see framing issues, ensure your client supports SSE `text/event-stream` content type
- Check the gateway logs at `~/.konoha/` for error output

### Error: "Invalid JSON" or "[object Object]"

- Ensure your client sends a properly formatted JSON body
- Messages should be an array of objects with `role` and `content`
- If you see `"[object Object]"` in the request, your serialization is incorrect — this is a client error

---

### Stale Antigravity / Sidecar Bridge

If Antigravity IDE was shut down but its bridge remains registered as `AVAILABLE`:

1. Run `konoha bridge status` — sidecar-gated bridges show `AWAITING SIDECAR` when the IDE is closed.
2. If you still see `AVAILABLE` on a dead session, run `konoha bridge delete antigravity` and recreate via `konoha bridge create` after restarting Antigravity.
3. Alternatively, disable temporarily: `konoha bridge disable antigravity`

### Bridge Returns Rate Limit Errors

The gateway automatically rotates to the next available bridge when rate limits are hit. You can also:

1. Check bridge status: `konoha bridge status`
2. Disable a failing bridge: `konoha bridge disable <bridge-name>`
3. Remove and recreate: `konoha bridge delete <bridge-name>` then `konoha bridge create`

---

## Getting Help

1. Run `konoha status` for diagnostic info
2. Run `konoha test` for server health check
3. Run `konoha doctor --yes` for auto-repair (Antigravity + Cursor)
4. Check the logs at `~/.konoha/` for any error files
