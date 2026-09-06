# 🛠️ Troubleshooting

This guide provides solutions to common issues encountered during the installation, configuration, and execution of Konoha.

---

## 🔍 Cross-Platform Install Issues

### ❌ `konoha` Command Not Found (nvm PATH Issue)

If `konoha` works in one shell but not another, your nvm PATH isn't being loaded. This is common on:
- **macOS**: Fresh terminal with nvm not in profile
- **Linux**: SSH sessions without interactive shell
- **Windows**: PowerShell without nvm-windows loaded

**Fix:**
```bash
# Linux/macOS
source ~/.nvm/nvm.sh
which konoha

# Windows PowerShell
& "$env:NVM_DIR\nvm.ps1"
where konoha
```

**Permanent fix for macOS/Linux:** Ensure this is in `~/.bashrc` or `~/.zshrc`:
```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use stable
```

**Windows (nvm-windows):** Add to PowerShell profile:
```powershell
# Edit ~/.powershell/Microsoft.PowerShell_profile.ps1
nvm list
nvm use stable
```

---

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

> **Windows Note:** If you see `Python was not found` even after installing Python, the issue is typically that the Python install directory isn't on PATH. Re-run the Python installer and check "Add Python to PATH", or manually add `C:\Users\<you>\AppData\Local\Programs\Python\Python3X\` and `C:\Users\<you>\AppData\Local\Programs\Python\Python3X\Scripts\` to your system PATH.

---

### ❌ "Server not installed" or "Database not found"

Starting with version `2.0.0`, Konoha features self-healing capabilities. Running any `konoha` command (or executing the `konoha doctor` command) will automatically bootstrap and repair missing files.

Alternatively, you can manually re-run the full installer script to verify all files are correctly created and configured:
```bash
pnpm dlx github:andycungkrinx91/konoha init
```

---

### 🔌 MCP Server Not Detected in Antigravity

1. Check that the configuration file exists:
   ```bash
   # Linux/macOS
   cat ~/.gemini/config/mcp_config.json

   # Windows (PowerShell)
   cat $env:USERPROFILE\.gemini\config\mcp_config.json
   ```

2. Verify the `konoha` entry matches:
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

   On Windows:
   ```json
   {
     "mcpServers": {
       "konoha": {
         "command": "node",
         "args": ["C:/Users/youruser/.konoha/file_tools_launcher.sh"]
       }
     }
   }
   ```

3. **Restart Antigravity IDE/CLI** — MCP configuration files are only read once on startup.
4. For CLI, run `agy mcp list` to verify if `konoha` is successfully loaded.

---

### 🔌 MCP Server Not Detected in Cursor

1. Check that the configuration file exists:
   ```bash
   cat ~/.cursor/mcp.json
   ```

2. Verify `konoha` and `semble` entries are present (installed by `konoha init` or `konoha doctor --yes`).

3. Run the bootstrap hook manually (must exit 0):
   ```bash
   node ~/.konoha/cursor_bootstrap.js
   echo $?   # should print 0
   ```

4. **Restart Cursor** — open a new agent session after MCP config changes.

5. Run `konoha doctor --yes` to auto-repair Cursor MCP, subagents, hooks, and CLI permissions. See [SETUP-CURSOR.md](SETUP-CURSOR.md) for full Cursor setup.

---

### 💥 MCP Crashes with "signal: terminated" or "signal: killed" (Port 19999 Collision)

If you see `signal: terminated` or `signal: killed` when Antigravity / Cursor / Claude Code tries to load the `konoha` MCP server, it is likely due to a **Proxy Gateway Port Collision**.

The Konoha MCP server runs a background Bridge Gateway on port **19999**. If an orphaned Node process from a previous crashed session is still running and occupying port 19999, the new MCP server will instantly crash with `EADDRINUSE 127.0.0.1:19999`. The IDE MCP client catches this immediate exit and throws `signal: terminated`, placing the server in a permanent failed state for that session.

**How to fix:**
1. Kill any process holding port 19999:

   **Linux/macOS:**
   ```bash
   fuser -k 19999/tcp
   # OR
   lsof -i :19999
   kill -9 $(lsof -t -i :19999)
   ```

   **Windows (PowerShell):**
   ```powershell
   Get-NetTCPConnection -LocalPort 19999 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
   # OR
   netstat -ano | findstr :19999
   taskkill /PID <pid> /F
   ```

2. **Restart your IDE / CLI Session completely** to clear the cached failed state of the MCP client.

---


### 🔌 MCP Server Not Detected in Claude Code

1. Check `~/.claude.json` for the `mcpServers` section:
   ```bash
   # Linux/macOS
   grep -A 20 mcpServers ~/.claude.json
   ```
2. Verify both `konoha` and `semble` entries are present (installed by `konoha init` when `claude` CLI is detected).
3. Run `/mcp` inside a Claude Code session — should list `konoha` and `semble` as connected servers.
4. If missing, run `konoha doctor --yes` to auto-repair the `~/.claude.json` registration.
5. Restart Claude Code to pick up the new MCP config.


2. If **not installed**, Konoha skips auto-setup by design — use templates in `docs/templates/` after you install the CLI, or run `konoha init` once the CLI is available.
3. If **installed**, run `konoha doctor --yes` or `konoha init --force` to merge Konoha MCP entries.

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
   ls ~/.konoha/file_tools_mcp.js ~/.konoha/file_tools_launcher.js ~/.konoha/file_tools_router.js
   ```

2. Repair and refresh Cursor MCP config:
   ```bash
   konoha doctor --yes
   ```

3. **Cursor global** `~/.cursor/mcp.json` should use the cross-platform JS launcher:
   ```bash
   grep -A5 konoha ~/.cursor/mcp.json
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
   Expected: JSON listing **20 tools** (or more).

5. **Restart Cursor** after repair.

6. Run `konoha test` — expects all MCP integration tests to pass, plus `tests/test_*.py` standalone suites.

**Common errors:**
- `Refused: requested span is N lines (max 500)` — narrow `read_file_range` window.
- `Showing first 20 matches` — expected; refine `token_efficient_grep` pattern.

---

### 🤖 Codex MCP Configuration Not Detected

1. Verify `~/.codex/config.toml` exists and contains `[mcp_servers.konoha]`, `[mcp_servers.semble]`, and `[mcp_servers.aislop]`:
   ```bash
   cat ~/.codex/config.toml
   ```

2. Run `konoha doctor --yes` or `konoha init --yes` to auto-repair the Codex TOML configuration and runtime contracts.

3. Restart Codex session to reload MCP servers from `config.toml`.

---

### 🧹 Zero-AI-Slop Gate (`aislop` MCP) Issues

1. **Workflow Delivery Blocked by Kage Review**:
   - **Symptom**: `run_mcp_workflow` returns `status: "blocked"`, or the Kage Reviewer Confidence Gate Report indicates `ai_slop_findings > 0` or `ai_slop_clean: false`.
   - **Reason**: The Zero-AI-Slop Gate is a hard pre-gate. Even with 100% test passing and 100% confidence, unsuppressed `ai-slop/*` findings prevent final delivery.
   - **Fix**: Re-delegate the flagged files to execution agents (`jonin` or `anbu`) to run `aislop_fix` or manually correct code hygiene issues until `aislop_scan` returns 0 findings and `kage_review.json` has `ai_slop_findings: 0` and `ai_slop_clean: true`.

2. **Missing `aislop` MCP Server**:
   - **Symptom**: Agent cannot call `aislop_scan` or `aislop_fix`, or `konoha doctor` reports `aislop` missing.
   - **Fix**: Run `konoha doctor --yes` to auto-register `aislop` across all installed clients (`Antigravity`, `Cursor`, `Claude Code`, `OpenCode`, `Command Code`, `Codex`). Ensure Node.js and `npx` are installed and available on PATH.

3. **Role Boundary Violations**:
   - **Symptom**: `genin` or `kage` attempts to call `aislop_fix` or `aislop_baseline`.
   - **Reason**: `genin` and `kage` are strictly read-only analysis agents. Only execution agents (`jonin`, `anbu`) are permitted to execute code modification tools like `aislop_fix`.

4. **`aislop` MCP Handshake Failure or npm 404 (`aislop-mcp`)**:
   - **Symptom**: `npm error 404 Not Found - GET https://registry.npmjs.org/aislop-mcp` or `handshaking with MCP server failed: connection closed: initialize response` during client startup.
   - **Reason**: Attempting to execute `npx aislop-mcp` prompts npm to search for a non-existent package named `aislop-mcp`. The binary `aislop-mcp` is packaged inside `aislop`.
   - **Fix**: Update MCP client configuration arguments to `args: ["-y", "-p", "aislop", "aislop-mcp"]`. In `~/.codex/config.toml`, ensure `command = "npx"` and `args = ["-y", "-p", "aislop", "aislop-mcp"]`. Run `konoha upgrade --yes` or `konoha doctor --yes` to automatically repair all 6 client configurations.

---

### 📊 `konoha agent status` Shows Wrong Counts

Agent attribution when the `agent` MCP parameter is omitted is resolved by `detect_active_agent()` in `server.py`:

- **Antigravity**: Scans `~/.gemini/antigravity-ide/brain` and `antigravity-cli/brain` using delegated `prompt.md` and recent `PLANNER_RESPONSE` transcripts (ignores `VIEW_FILE` noise). If `ANTIGRAVITY_CONVERSATION_ID` is set, scans are strictly isolated to the active session folder (Cursor projects are excluded) to prevent cross-session telemetry pollution.
- **Cursor**: Scans `~/.cursor/projects/*/agent-transcripts/` for `Task` `subagent_type`, subagent `[Agent] active` logs, or `[Konoha] orchestrator active`.
- **Claude Code**: Scans `~/.claude/projects/*/*.jsonl` for assistant message blocks containing subagent `[Agent] active` activation strings or Task delegation.

**Fixes:**
1. Pass `agent='genin'` (etc.) explicitly in `find_skill` / `get_skill` when possible.
2. Ensure subagents log `[<Icon> <AgentName>] active` at response start (e.g. `[🍃 Genin] active`, `[🌀 Kage] active`).
3. Run verification:
   ```bash
   python3 tests/test_agent_attribution.py
   python3 tests/test_cursor_attribution.py
   python3 tests/test_claude_attribution.py
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
3. If necessary, force-reinstall instructions: `pnpm dlx github:andycungkrinx91/konoha init --force`

---

### 🚫 "Permission denied" Errors

On Linux/macOS, ensure the files are readable:
```bash
chmod 644 ~/.konoha/file_tools_mcp.js ~/.konoha/file_tools_launcher.js ~/.konoha/file_tools_router.js
chmod 644 ~/.konoha/db_bridges.py
chmod 644 ~/.konoha/skills.db
```

---

### 🪞 Cursor Skills Mirror Missing or Stale

Konoha does not create `~/.cursor/skills/` mirrors or symlinks. Skills are indexed in SQLite and Cursor loads content through Konoha MCP.

**Symptoms:** Cursor cannot find a newly added skill.

**Fix:**
1. Run `konoha doctor --yes` to repair MCP and generated rules.
2. Run `konoha migrate` after adding or editing a skill.
3. Verify the session calls `konoha.find_skill` and `konoha.get_skill`; do not create a filesystem mirror.
4. On Cursor session start: `cursor_bootstrap.js` self-heals MCP, generated rules, and RTK state (fail-open).

---

### 💻 Windows-Specific Issues

* **Paths**: Windows uses backslashes. The installer handles this automatically, but if you're manually editing `mcp_config.json`, use forward slashes or double backslashes:
  ```json
  {
    "command": "node",
    "args": ["C:/Users/youruser/.konoha/file_tools_launcher.js"]
  }
  ```

* **Python command**: Konoha ships a Node launcher (`file_tools_launcher.js`) but still embeds a Python bridge (`db_bridges.py`) for database operations. The installer auto-detects `python` vs `python3` on Windows.
* **Line endings**: If you get `SyntaxError` when running the Python bridge, convert the CRLF line endings to LF:
  ```powershell
  # PowerShell
  (Get-Content ~/.konoha/db_bridges.py -Raw) -replace "`r`n", "`n" | Set-Content ~/.konoha/db_bridges.py -NoNewline
  ```
* **nvm-windows**: Konoha works seamlessly with [nvm-windows](https://github.com/coreybutler/nvm-windows). If `konoha` is missing after switching Node versions, re-run:
  ```powershell
  nvm use <version>
  pnpm add --global github:andycungkrinx91/konoha
  ```
* **Antigravity on Windows**: Antigravity IDE/CLI primarily supports macOS and Linux. Windows users should use [WSL2](https://learn.microsoft.com/en-us/windows/wsl/install) for full integration. Native Windows support is limited.
* **Cursor on Windows**: Works natively on Windows; ensure `node` and `python` (not `python3`) are on PATH.
* **`konoha upgrade` Freezes or Hangs**:
  - **Symptom**: `konoha upgrade` hangs indefinitely while setting up client extensions.
  - **Reason**: Remote `git clone` or network operations hanging or blocked on Windows without pre-bundled extensions, or child processes waiting on interactive stdin.
  - **Fix**: As of `v2.0.0-beta.3`, Konoha uses in-process upgrade execution with pre-bundled VSIX prioritization, non-blocking `stdio: ['ignore', 'pipe', 'pipe']`, and a 180s safeguard timeout.
* **`Token Efficient Grep: FAILED` with Proxy Gateway Output on Port 20000**:
  - **Symptom**: Running `konoha test` displays `✗ Token Efficient Grep: FAILED - [gateway] Proxy Gateway running on http://127.0.0.1:20000`.
  - **Reason**: The test runner subprocess inherited `KONOHA_DAEMON=1` from the environment, triggering an attempt to spawn the local proxy gateway server during unit tests. Additionally, unnormalized Windows backslashes with trailing separators caused python argument parsing failures.
  - **Fix**: `bin/cli.js test` sanitizes the test environment (`delete testEnv.KONOHA_DAEMON`), path separators are normalized to forward slashes with trailing separators stripped, and Python launcher resolution prioritizes `py -3`.
* **`Failed to initialize skills database: spawnSync py -3 ENOENT` on Windows**:
  - **Symptom**: During `konoha upgrade`, `konoha init`, or `konoha migrate` on Windows, execution fails with `✗ Failed to initialize skills database: spawnSync py -3 ENOENT`.
  - **Reason**: Windows systems using the Python launcher (`py.exe`) returned `'py -3'` from detection. Passing this string directly into `child_process.spawnSync` caused Node to look for an executable literally named `py -3.exe`.
  - **Fix**: Resolved in `v2.0.0-beta.4` by introducing `spawnPythonSync` and `normalizeCommand` in `src/platform_utils.js`, ensuring commands with prefix arguments are automatically separated into the base executable (`py`) and prefix arguments (`-3`).
* **`konoha upgrade` or `init` Still Displays Previous Version Due to Git/Package Caches**:
  - **Symptom**: After running `konoha upgrade` or `konoha init --force`, the version displayed remains on an older pre-release (e.g. `2.0.0-beta.3`).
  - **Reason**: Global package managers (`pnpm`, `npm`) cache git checkouts in their global store links (e.g. `pnpm/store/v11/links/@/Konoha/`), or reuse dirty temporary git repositories.
  - **Fix**: As of `v2.0.0-beta.4`, Konoha automatically runs `purgePackageCaches` during `init --force` and Stage 1 of `upgrade`. It runs `pnpm store prune`, cleans npm/yarn caches, severs stale global store hardlinks with unlinking, and enforces `--prefer-online --no-cache`.
* **Excessive Token Consumption / Prompt Loop in IDE**:
  - **Symptom**: The AI assistant re-reads `prompt.md` repeatedly on every tool call, consuming thousands of tokens.
  - **Reason**: The session prompt hook unconditionally injected ephemeral reminder messages on every single tool execution step.
  - **Fix**: Resolved in `v2.0.0-beta.4` by adding response state tracking in `prompt_hook.js`. Ephemeral notifications are now only emitted once for fresh user inputs awaiting an initial response, and preview limits in `find_skill` were reduced to 500 characters.

---

### 🗄️ Database Corruption

If the SQLite database becomes corrupted, remove it and rebuild the index:
```bash
rm ~/.konoha/skills.db
konoha migrate
```

---

### 🧪 Checking the MCP Server Manually

**konoha MCP (Node):**
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node ~/.konoha/file_tools_launcher.js
```

*Expected output:* A JSON response containing `protocolVersion` and `serverInfo` (initialize) or a `tools` array (tools/list).

## API Rate Limits and Errors

If a task execution encounters rate limits or API errors, the coordinator will fall back to Direct Tool Calls (executing edits, reads, and commands directly) to complete the task. All subagents use `Claude Sonnet 4.6 (Thinking)` since v2.0.0 — there is no separate fallback tier.

## Bridge Gateway Troubleshooting

### Port Already in Use

```bash
# Linux/macOS - Check if something is already on port 19999
lsof -i :19999
# Kill the process if needed
kill -9 $(lsof -t -i :19999)
```

```powershell
# Windows (PowerShell) - Check if something is already on port 19999
Get-NetTCPConnection -LocalPort 19999 -ErrorAction SilentlyContinue
# Kill the process if needed
Get-NetTCPConnection -LocalPort 19999 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
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

### Anthropic `/v1/messages` requests fail with 400/500 on OpenAI bridges

The gateway **converts Anthropic-format requests to OpenAI** before proxying to upstream bridges (since most bridges speak OpenAI). The conversion handles:

- `system` parameter → leading `{role:"system"}` message
- Content blocks (`text`, `image`, `tool_use`, `tool_result`) → OpenAI multipart content or `tool_calls`/`role:"tool"` messages
- `tools` (Anthropic `input_schema`) → OpenAI function-calling schema
- Streaming responses are coalesced and re-emitted as Anthropic `message_start` / `content_block_*` / `message_delta` / `message_stop` events

If requests still fail after the gateway conversion:
1. Confirm the upstream bridge is reachable: `curl http://127.0.0.1:<bridge-port>/v1/chat/completions`
2. Verify the bridge returns valid OpenAI-format: send a hand-rolled `{"model":"...","messages":[{"role":"user","content":"hi"}]}` to that bridge
3. The gateway's `count_tokens` endpoint returns `{input_tokens: 0}` as a mock. This is intentional; clients like Claude CLI only use it as a budget preflight and accept 0.

---

### Stale Antigravity / Sidecar Bridge

If Antigravity IDE was shut down but its bridge remains registered as `AVAILABLE`:

1. Run `konoha bridge status` — sidecar-gated bridges show `AWAITING SIDECAR` when the IDE is closed.
2. If you still see `AVAILABLE` on a dead session, run `konoha bridge delete antigravity` and recreate via `konoha bridge create` after restarting Antigravity.
3. Alternatively, disable temporarily: `konoha bridge disable antigravity`

### Bridge Returns Rate Limit Errors

The gateway does not rotate globally to another bridge after a rate limit. It forwards the upstream status to the caller; retry behavior belongs to supported sidecar paths or the client. You can:

1. Check bridge status: `konoha bridge status`
2. Disable a failing bridge: `konoha bridge disable <bridge-name>`
3. Remove and recreate: `konoha bridge delete <bridge-name>` then `konoha bridge create`

### External Antigravity Extension

The `konoha-bridge` extension (`https://github.com/andycungkrinx91/konoha-bridge`) is automatically cloned from live `master`, packaged into `konoha-bridge-1.4.0.vsix`, and installed via CLI across detected IDEs during `konoha init` and `konoha upgrade`:
```bash
# Antigravity IDE CLI
antigravity --install-extension konoha-bridge-1.4.0.vsix

# Standard VS Code CLI
code --install-extension konoha-bridge-1.4.0.vsix

# Cursor IDE CLI
cursor --install-extension konoha-bridge-1.4.0.vsix
```
When Antigravity IDE is present, it is also atomically synced into `~/.antigravity-ide/extensions/andycungkrinx91.konoha-bridge-master-universal/`. It owns `127.0.0.1:1313`; Konoha’s embedded aggregate gateway owns `127.0.0.1:19999`. Installation and bridge activation are separate:

1. Check the extension API on port `1313`: `curl -s http://localhost:1313/v1/models | jq .`
2. Run `konoha bridge list`.
3. Explicitly enable the `antigravity-extension` record with `konoha bridge enable <name>`.

On headless or non-Antigravity machines, the embedded Konoha bridge remains the active fallback.

### ⚠️ Claude Code Settings Warning: Invalid Permission Rule

If Claude Code logs a warning such as:
```
Settings Warning
~/.claude/settings.json
├ permissions.allow: Invalid permission rule "mcp:konoha:*" was skipped: Wildcard tool name "mcp:konoha:*" is not supported...
```
**Cause:** Claude Code requires permission rules to follow the `mcp__<server>__*` schema (double underscores) and does not permit colon wildcards (`mcp:konoha:*`) or bare command wildcards (`rtk *`).

**Fix:** Run `konoha doctor --yes` or `node bin/cli.js init --yes --force`. Konoha automatically prunes legacy invalid entries and writes valid syntax (`mcp__konoha__*`, `mcp__semble__*`, `Bash(...)`).

---

### ⚠️ OpenCode Configuration Invalid: V2 Permissions Not Supported by OpenCode V1

If OpenCode fails to load with:
```
Configuration is invalid at ~/.config/opencode/opencode.json
↳ V2 permissions are not supported by OpenCode V1. Use V1 "permission" rules or run opencode2.
```
**Cause:** OpenCode V1 expects a singular `"permission"` dictionary (`read: "allow"`, `edit: "allow"`, `bash: "allow"`, etc.) rather than the V2 plural `"permissions"` or root `"autoApprove"` properties.

**Fix:** Run `konoha doctor --yes`. Konoha will rewrite `~/.config/opencode/opencode.json` with the schema-compliant V1 singular `"permission"` dictionary.

---

### ⚠️ Windows Antigravity IDE Scans App Installation Directory Instead of Project

If running `get_file_structure` with `{"dir_path": "."}` on Windows outputs IDE binaries (`Antigravity IDE.exe`, `dxcompiler.dll`, `resources.pak`, `vulkan-1.dll`):
**Cause:** Electron child processes on Windows inherit `C:\Users\<user>\AppData\Local\Programs\Antigravity IDE\` as `process.cwd()` when no explicit `rootUri` is provided during MCP initialize.

**Fix:** Konoha incorporates strict `isIdeInstallationDirectory` guards in `file_tools_router.js`, `_common.py`, and `server.py`. Access to IDE program directories is permanently blocked, and `detectWorkspaceRoot()` automatically resolves the real project directory from session cache (`last_conversations.json`, `projects.json`) or `WORKSPACE_ROOT`. Run `konoha doctor --yes` to ensure all latest file tools are synced to `~/.konoha/`.

---

## Getting Help

1. Run `konoha status` for diagnostic info
2. Run `konoha test` for server health check
3. Run `konoha doctor --yes` for auto-repair across all supported clients
4. Check the logs at `~/.konoha/` for any error files
