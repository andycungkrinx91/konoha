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

### ❌ "Node.js is required but not found or outdated"

Konoha runs on a 100% pure Node.js runtime and requires **Node.js ≥ 24.0.0**. Python is not required or used.

The concrete failure is `bin/cli.js` exiting before any runtime module loads:

```
Konoha requires Node.js >= 24.0.0 (found v22.x.x).
Install Node 24: https://nodejs.org/
```

Exit code is `1`. `engines.node` is `>=24.0.0` and must stay that way: `src/sqlite_driver.js` requires the built-in `node:sqlite`, which only ships in Node 24+. Do not widen it to `>=20`.

To install or update Node.js:
* **Linux/macOS (via nvm)**: `nvm install 24 && nvm use 24`
* **Windows (via nvm-windows)**: `nvm install 24` and `nvm use 24`
* Or download the LTS installer from the [official Node.js downloads page](https://nodejs.org/).

To verify your Node.js installation:
```bash
node --version  # Must be >= 24.0.0
```

---

### ❌ `Cannot find module './nodes/plan'` (or `./edges/router`) from `~/.konoha/mcp/langgraph/index.js`

- **Cause**: a legacy *flattened* mirror. An older `konoha doctor` copied only top-level `.js` files into `~/.konoha/mcp/`, `~/.konoha/file_tools/`, and `~/.konoha/workflow/`, dropping `langgraph/nodes/`, `langgraph/edges/`, `qa-automation/`, and `three_asset/`. The copied `index.js` then required siblings that were never copied.
- **Important**: `~/.konoha/mcp`, `~/.konoha/file_tools`, and `~/.konoha/workflow` are **not obsolete** — when present with their nested directories they are required, because the deployed `file_tools_router.js` requires `./mcp/runtime_state` and `./workflow/qa-automation/qa_tools`. Only flattened trees are invalid.
- **Fix**: run `konoha doctor --yes`. It purges the flattened mirrors (`Removed flattened mirror missing langgraph/index.js`) and keeps intact trees. Confirm `~/.konoha/src/mcp/langgraph/nodes/plan.js` exists afterwards; `node -e "require(require('os').homedir()+'/.konoha/src/mcp/langgraph/index.js')"` must not throw.

---

### ❌ `Runtime not initialized. Run "konoha init --yes" first.`

- **Cause**: the package is installed but `~/.konoha` has no runtime yet. `bin/cli.js` detects `Cannot find module '…/.konoha/…'` and replaces the raw stack with this message.
- **Fix**: `konoha init --yes`. Install mode notes: `npm install -g konoha-mcp@latest` (or `npm install -g ./konoha-mcp-<version>.tgz` from a packed tarball) runs no install-time script at all, so it cannot initialize the runtime for you — and it never will.

---

### ❌ `npm error code EALLOWSCRIPTS` during a global install (affected ≤ 2.2.19)

- **Cause**: 2.2.19 and earlier declared an install-time lifecycle script for a guidance-only shim. Stock npm refuses to run lifecycle scripts a package ships unless they are allowlisted, so the install aborted before the CLI was linked. The script itself never executed, and nothing depended on it — it only printed guidance.
- **Fix**: upgrade to 2.2.20 or later, which ships no lifecycle script at all. Do **not** allowlist lifecycle scripts for this package (no `allowScripts` entry, no npmrc workaround) and do not re-add one; none is needed.
  ```bash
  npm install -g konoha-mcp@latest
  konoha init --yes   # or: konoha upgrade
  ```
- **Note**: the gate only fires when a package ships lifecycle scripts; 2.2.20 ships none, so an `EALLOWSCRIPTS` error means the old version is still being resolved.

---

### ❌ `Upgrade aborted: no package manager could install konoha-mcp@<version>.`

- **Cause**: npm, pnpm, yarn, and the GitHub fallback all failed to install the target — usually a missing/blocked package manager or an unreachable registry.
- **Behavior**: the command exits `1`, leaves the existing installation and configuration modified by nothing, and does not continue into the runtime lifecycle. An `unverified` version read (`konoha --version` failing) also aborts the run rather than reporting a version it never confirmed.
- **Fix**: install directly, then re-run:
  ```bash
  npm install -g konoha-mcp@latest
  konoha upgrade --yes
  ```
- **Windows / interrupted upgrade**: `~/.konoha/.upgrade_pending.json` marks an in-flight upgrade. If you see `Upgrade to <target> was interrupted. Re-run "konoha upgrade --yes".`, the previous run was killed mid-install (Windows cannot replace a running package, so it hits `EBUSY`). Startup still proceeds normally; just re-run the upgrade.

---

### ❌ `Upgrade verification failed: PATH 'konoha' reports v<old> but the installed package is v<new>.`

- **Cause**: the package install succeeded, but the `konoha` a shell would run is a different copy — a `~/.local/bin/konoha` shim, a pnpm or nvm shim, or another `bin` dir earlier on `PATH`. 2.2.19 printed "successfully upgraded" in this state while `konoha version` still reported the old version.
- **Behavior**: 2.2.20 and later exit `1` and name the winning path under `PATH resolves 'konoha' to:` instead of reporting a version it never confirmed. The same failure fires when nothing named `konoha` is on `PATH` after the install, or when the resolved binary prints no `Current Version:` line.
- **Fix**: find the shadowing copy and remove or update it, then re-run:
  ```bash
  which -a konoha        # every copy, in PATH order; the first one wins
  npm install -g konoha-mcp@latest
  konoha upgrade --yes
  ```
  If the first entry is a shim you maintain, repoint it at the npm-installed CLI. Do not "fix" this by reordering `PATH` permanently — the next shell will just shadow it again.

---

### ❌ MCP tool returns `{"error":"invalid_arguments","message":"...","tool":"..."}`

- **Cause**: the `arguments` value could not be parsed into a JSON object, and the tool is not a delegation tool. Konoha returns a JSON-RPC *tool* error (`isError: true`) instead of a transport error so the client shows exactly what failed.
- **Not affected**: delegation tools (`genin`, `kage`, `jonin`, `anbu`, `chunin`, `tokubetsu_jonin`, `sannin`, `akatsuki`) accept bare prose and wrap it as `{ "task": "<text>" }`. `null`, `undefined`, and `{}` are treated as empty argument sets.
- **Fix**: send `arguments` as a JSON object. A JSON *string* works when it parses to an object; arrays and scalars are rejected.

---

### ❌ `File not found: <skill>/<reference>` from a `skill://` URI

- **Cause**: clients may request `<skill>/<file>` as well as `<skill>/references/<file>`; a tree installed only under `references/` fails the bare form.
- **Fix**: run `konoha migrate` (or `konoha doctor --yes`). Entry-point `.md` files are mirrored next to `SKILL.md` as well as under `references/`, and both URI forms resolve through the same lookup. Do not hand-create alias files — `src/templates/skills` and the installed tree must stay in exact parity.
- Path traversal requests (`../x`, `C:\x`, `..%2F`) are rejected with `invalid_skill_path` and never throw across the MCP boundary.

---

### ⚠️ `QA blocked: agent-browser unavailable (...)` during `konoha init`

- **Cause**: `agent-browser` is a **hard requirement for QA only**. `init` resolves it in order: global install → managed `~/.konoha/tools` → `npx --yes agent-browser@0.3.1`, verifying each with `--version`. If none works, core install still succeeds and this actionable warning is recorded so `konoha doctor` shows `QA: BLOCKED`.
- **Linux note**: `agent-browser@0.3.1` publishes **no linux-x64 native binary** (`Error: No binary found for linux-x64`), so QA stays blocked on Linux x64 regardless of install method. Do not treat this as a broken install — every non-QA feature works.
- **Effect**: `qa_codify` returns `{ ok: false, error: 'qa_blocked', reason }`; `qa_e2e_run` remains usable for Playwright suites that do not shell out to `agent-browser`.
- **Fix (where a native binary exists)**: `npm i -g agent-browser@0.3.1`, then `agent-browser install` (`--with-deps` on Linux only).

---

### ⚠️ `The "pnpm" field in package.json is no longer read` / `ignored: "pnpm.auditConfig"`

- **Cause**: pnpm 12 no longer reads the `package.json#pnpm` block, and the `package.json#overrides` copy that duplicated the YAML was dead config (pnpm reads `pnpm-workspace.yaml#overrides`). Both were removed in 2.2.19.
- **Current state**: `pnpm-workspace.yaml` carries `overrides` plus `audit:\n  ignore:\n    - "GHSA-gcqx-w48m-w2h4"`. CVE-2026-93753 is **no longer suppressed** — pnpm 12 has no CVE-level suppression, and this is a documented accepted change.
- **2.2.20 exception**: `package.json#overrides` is back for exactly one entry, `image-size: ">=2.0.3"`. npm ignores a dependency's own `overrides`, so the shipped copy is what carries the CVE-2025-71330 / CVE-2025-71329 patch to npm consumers; pnpm still reads its own `>=2.0.4` floor from the YAML. Do not remove it, and do not re-add `package.json#pnpm` or any other override.
- **Fix**: if you see the warning, you are on an old checkout. Pull 2.2.19+, run `pnpm install --frozen-lockfile`, and verify with `pnpm config get audit` → `{"ignore":["GHSA-gcqx-w48m-w2h4"]}`.

---

### ❌ "Server not installed" or "Database not found"

Starting with version `2.0.0`, Konoha features self-healing capabilities. Running any `konoha` command (or executing the `konoha doctor` command) will automatically bootstrap and repair missing files.

Alternatively, you can manually re-run the full installer script to verify all files are correctly created and configured:
```bash
npm exec --yes --package=konoha-mcp@latest -- konoha init --yes
# or, if konoha is installed globally:
konoha init --yes
```

---

### 🔌 MCP Server Not Detected in Antigravity

1. Check that the configuration file exists:
   ```bash
   # Linux/macOS
   rtk cat ~/.gemini/config/mcp_config.json

   # Windows (PowerShell)
   rtk cat $env:USERPROFILE\.gemini\config\mcp_config.json
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
         "args": ["C:/Users/youruser/.konoha/file_tools_launcher.js"]
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
   rtk cat ~/.cursor/mcp.json
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

**If the Claude Code CLI is not installed at all:** Konoha skips auto-setup by design. Install the CLI, then run `konoha init` (or `konoha doctor --yes` once it is installed) to merge the Konoha MCP entries; `docs/templates/claude-code.mcp.yaml` is the manual fallback for the global `~/.claude.json` → `mcpServers` entry.

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
   Expected: JSON listing **48 canonical tools**.

5. **Restart Cursor** after repair.

6. Run `konoha test` — expects all MCP integration tests to pass, plus `tests/test_*.js` standalone suites.

**Common errors:**
- `Refused: requested span is N lines (max 500)` — narrow `read_file_range` window.
- `Showing 20 of 137 matches. Refine: add a term or path filter.` — expected; the footer always reports `showing X of Y`, and `token_efficient_grep` caps at 20 matches (hard cap 50). Narrow the pattern, add a `path` filter, or raise the limit.

---

### 🤖 Codex MCP Configuration Not Detected

1. Verify `~/.codex/config.toml` exists and contains `[mcp_servers.konoha]`, `[mcp_servers.semble]`, and `[mcp_servers.aislop]`:
   ```bash
   rtk cat ~/.codex/config.toml
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
   - **Fix**: Run `konoha doctor --yes` to auto-register `aislop` across all installed clients (`Antigravity`, `Cursor`, `Claude Code`, `OpenCode`, `Command Code`, `Codex`, `Pi`, `OMP`). Ensure Node.js and `npx` are installed and available on PATH.

3. **Role Boundary Violations**:
   - **Symptom**: `genin` or `kage` attempts to call `aislop_fix` or `aislop_baseline`.
   - **Reason**: `genin` and `kage` are strictly read-only analysis agents. Only execution agents (`jonin`, `anbu`) are permitted to execute code modification tools like `aislop_fix`.

4. **`aislop` MCP Handshake Failure or npm 404 (`aislop-mcp`)**:
   - **Symptom**: `npm error 404 Not Found - GET https://registry.npmjs.org/aislop-mcp` or `handshaking with MCP server failed: connection closed: initialize response` during client startup.
   - **Reason**: Attempting to execute `npx aislop-mcp` prompts npm to search for a non-existent package named `aislop-mcp`. The binary `aislop-mcp` is packaged inside `aislop`.
   - **Fix**: Update MCP client configuration arguments to `args: ["-y", "-p", "aislop@latest", "aislop-mcp"]`. In `~/.codex/config.toml`, ensure `command = "npx"` and `args = ["-y", "-p", "aislop@latest", "aislop-mcp"]`. Run `konoha upgrade --yes` or `konoha doctor --yes` to automatically repair all 8 client configurations.

---

### 📊 `konoha agent status` Shows Wrong Counts

Agent attribution when the `agent` MCP parameter is omitted is resolved by `detectActiveAgent()` in `src/mcp/client_detection.js`:

- **Antigravity**: Scans `~/.gemini/antigravity-ide/brain` and `antigravity-cli/brain` using recent `PLANNER_RESPONSE` transcripts (ignores `VIEW_FILE` noise). If `ANTIGRAVITY_CONVERSATION_ID` is set, scans are strictly isolated to the active session folder (Cursor projects are excluded) to prevent cross-session telemetry pollution.
- **Cursor**: Scans `~/.cursor/projects/*/agent-transcripts/` for `Task` `subagent_type`, subagent `[Agent] active` logs, or `[Konoha] orchestrator active`.
- **Claude Code**: Scans `~/.claude/projects/*/*.jsonl` for assistant message blocks containing subagent `[Agent] active` activation strings or Task delegation.

**Fixes:**
1. Pass `agent='genin'` (etc.) explicitly in `find_skill` / `get_skill` when possible.
2. Ensure subagents log `[<Icon> <AgentName>] active` at response start (e.g. `[🍃 Genin] active`, `[🌀 Kage] active`).
3. Run verification:
   ```bash
   node tests/test_agent_attribution.js
   node tests/test_cursor_attribution.js
   node tests/test_claude_attribution.js
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
3. If necessary, re-run client initialization: `konoha init --client=all`

---

### 🚫 "Permission denied" Errors

On Linux/macOS, ensure the files are readable:
```bash
chmod 644 ~/.konoha/file_tools_mcp.js ~/.konoha/file_tools_launcher.js ~/.konoha/file_tools_router.js
chmod 644 ~/.konoha/konoha.db
```

---

### 🚫 MCP tools/call returns `{"error":"Unknown tool: get_file_structure"}` (or `file_info`, `read_file_head`, ...) (`fixed in v2.0.0-beta.7`)

- **Cause**: The client's `konoha` MCP entry pointed at `~/.konoha/server.js`, whose tool manifest advertises the bounded file tools but whose dispatcher did not implement them (they live in `file_tools_router.js`). Pi's initial registration hit exactly this.
- **Fix**: Two-layer:
  1. `src/mcp/tool_dispatch.js` now delegates the six bounded file tools to `file_tools_router.dispatchTool`, so `server.js` serves every tool it advertises (verified live via JSON-RPC).
  2. `src/pi_manager.js` registers Pi's `konoha` entry against `~/.konoha/file_tools_launcher.js` (the same topology as Antigravity/Cursor/Claude Code), which serves all 48 canonical tools.
- **If it persists**: re-run `konoha init --client=pi` (or `konoha init --client=all`), fully restart the client, and verify `~/.pi/agent/mcp.json` (or the client's MCP config) points `konoha` at `file_tools_launcher.js`.

---

### ℹ️ Pi reports `[Skill conflicts] ... ✗ skipped` on startup (`informational — no action needed`)

- **Cause**: Konoha seeds packaged skills into the global `~/.agents/skills/` and indexes them into `~/.konoha/konoha.db`.
- **Behavior**: Pi automatically resolves the active skill set without duplicating context.
- **Action**: None. The warnings are informational.
- **Workflow note**: if Pi "executes tasks by itself" instead of using the Konoha workflow, ensure the runtime contract is deployed — `konoha doctor --yes` should show `✔ Pi (pi.dev)`, and `~/.pi/agent/AGENTS.md` must contain the `Konoha Workflow Mandate (Pi)` section (re-run `konoha init --client=pi` to deploy it). The mandate instructs Pi to route through `sannin` with structured task arguments and use Konoha MCP skill tools instead of the native `/skill:` mirrors.

---

### 🚫 Resumed sessions stop using the Konoha workflow (`fixed in v2.0.0-beta.7`)

- **Cause**: Contracts/rules are injected at session **start**; on `--resume`/`--continue` the existing conversation history dominated and nothing re-engaged the Konoha workflow mechanically.
- **Fix**: Claude Code now runs the Konoha **workflow reminder** on `UserPromptSubmit` (every prompt, all sessions) and on `SessionStart` with matcher `resume|compact|clear`. Pi/Codex re-read the deployed `AGENTS.md` (contract + Workflow Mandate) on every startup; Cursor's `konoha.mdc` uses `alwaysApply: true`; Antigravity's per-prompt `prompt_hook` emits structured workflow reminders without writing any session files.
- **If it persists**: re-run `konoha init --client=claude` (or `konoha init --client=all`), fully restart the client, and confirm `~/.claude/settings.json` contains a `UserPromptSubmit` entry with `workflow_reminder.js`.

---

### 🚫 `File not found: <workspace>/prompt.md` (or `plan.md`, ...) (`retired: file-based IPC removed`)

- **Cause**: Legacy workflow artifacts (`prompt.md`, `delegate.md`, `result.md`) are retired and never written. Live workflow state travels as structured MCP arguments and `status.json` in the **task directory** (`~/.konoha/tmp/<client>/<session>/scratch/tasks/<task_id>/`), never in the workspace root. Agents guessing the workspace path get a plain not-found error.
- **Fix**: never create or read `prompt.md` / `delegate.md` / `result.md`. Pass task instructions via direct structured MCP tool arguments and report completion via `report_from_agent`. Use `get_resolved_task_dir` to locate the task directory, then read live artifacts (`status.json`, `findings.md`, `plan.md`, `final_report.md`, `kage_review.json`) there.

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

* **Pure Node.js Runtime**: Konoha runs 100% pure Node.js (`file_tools_launcher.js` / `server.js`) via built-in `node:sqlite`. No Python installation, Python processes, or Python bridges are needed.
* **nvm-windows**: Konoha works with [nvm-windows](https://github.com/coreybutler/nvm-windows). If `konoha` is missing after switching Node versions, re-run:
  ```powershell
  nvm use <version>
  npm install -g konoha-mcp@latest
  ```
* **Antigravity on Windows**: Antigravity IDE/CLI primarily supports macOS and Linux. Windows users should use [WSL2](https://learn.microsoft.com/en-us/windows/wsl/install) for full integration. Native Windows support is limited.
* **Cursor on Windows**: Works natively on Windows; ensure `node` is on PATH.
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
* **Excessive Token Consumption / Prompt Loop in IDE (`retired: file-based IPC removed`)**:
  - **Symptom**: Legacy agents re-read `prompt.md` repeatedly on every tool call, consuming thousands of tokens.
  - **Reason**: Retired file-based IPC pattern; session context now arrives as structured MCP arguments.
  - **Fix**: Never write or read `prompt.md` / `delegate.md` / `result.md`. The session prompt hook emits no files; ephemeral notifications fire once for fresh user inputs awaiting an initial response, and preview limits in `find_skill` were reduced to 500 characters.
* **`Token Efficient Grep: FAILED - Path outside workspace` or Timeout on Windows (`v2.0.0-beta.5`)**:
  - **Symptom**: On Windows systems, running `konoha test` displays `✗ Token Efficient Grep: FAILED - [gateway] Proxy Gateway running on http://127.0.0.1:20002` or `Path outside workspace: D:\...`.
  - **Reason**: On Windows NTFS drives, Node `realpathSync` produces extended prefix paths (`\\?\D:\...`). Python's `os.path.commonpath` threw `ValueError: Paths don't have the same drive` comparing `d:` and `\\?\d:`. Furthermore, Windows command-line argument quoting rules under `py.exe` corrupted backslashes in JSON payloads, and scanning 4,700+ reference files in `src/templates/skills` caused 60-second timeouts.
  - **Fix**: Resolved in `v2.0.0-beta.5` by introducing `stripWinExtendedPrefix` and `_strip_win_prefix` across Node and Python runtimes, adding an `os.path.relpath` fallback, transporting JSON payloads safely via child process `stdin` with `PYTHONIOENCODING=utf-8`, and adding `'references'` and build caches to `SKIP_DIR_NAMES`.
* **`Failed to initialize skills database: spawnSync python3 ETIMEDOUT` during `konoha upgrade --force` (`v2.0.0-beta.5`)**:
  - **Symptom**: At Stage 5 (Seeding Default Subagent Skills to SQLite FTS5), the upgrade aborts with `✗ Failed to initialize skills database: spawnSync python3 ETIMEDOUT` and exits 1.
  - **Reason**: The Stage 5 retry only re-ran the migration with `--skip-embeddings` when that flag was *not already present* — but `konoha upgrade` always passes `--skip-embeddings` internally, so a timeout (typically from re-indexing hundreds of reference `.md` files in large skill trees on a slow or loaded machine) had no fallback and hard-exited.
  - **Fix**: Resolved in `v2.0.0-beta.5` with a three-attempt progressive fallback chain: (1) full migration, (2) unconditional retry with `--skip-embeddings`, (3) `--skills-only --skip-embeddings` which seeds only `SKILL.md` entries and defers reference indexing to a later `konoha migrate`. The SQLite schema verification is now the sole completion gate, so upgrade/init succeed with a `Reference indexing deferred` warning instead of failing. Additionally, `migrate.py` enforces a `KONOHA_MIGRATE_TIME_BUDGET` (default 150s) that defers remaining non-required skills gracefully and always exits 0.
* **`Error auto-migrating project skills ... FOREIGN KEY constraint failed` in server logs**:
  - **Symptom**: The MCP server logs `[mcp konoha] Error auto-migrating project skills from <dir>: FOREIGN KEY constraint failed` during initialization, and project-scoped skills are never ingested into `skills.db`.
  - **Reason**: `src/server.py:_migrate_skill` deleted parent `skills` rows without first removing dependent `skill_chunks` rows. With `PRAGMA foreign_keys=ON` (enforced by `src/db.py`), any chunk row referencing the deleted skill name aborted the whole per-directory transaction.
  - **Fix**: Resolved in `v2.0.0-beta.5` by applying dependent-rows-first deletion at all four delete sites in `_migrate_skill` (matching the canonical pattern already used in `src/migrate.py` since beta.2). If the error persists after upgrading, run `konoha init --force` to redeploy the fixed `server.py` to `~/.konoha/`.
* **`The value of "timeout" is out of range. It must be an unsigned integer. Received NaN` on `konoha migrate --rebuild-embeddings` (`v2.2.3`)**:
  - **Symptom**: Running `konoha migrate --rebuild-embeddings` or `konoha embed` aborts with `✗ Migration failed: The value of "timeout" is out of range. It must be an unsigned integer. Received NaN` followed by `↯ Migration timed out; run "konoha migrate" again to finish remaining references.`
  - **Reason**: `MIGRATION_TIMEOUT_MS` was omitted from the exports of `bin/lib/paths.js`, evaluating to `undefined` in `bin/commands/migrate.js`. The expression `Math.max(MIGRATION_TIMEOUT_MS, 300000)` produced `NaN`, causing Node.js `child_process.spawnSync` to throw `ERR_OUT_OF_RANGE`.
  - **Fix**: Resolved in `v2.2.3` by exporting `MIGRATION_TIMEOUT_MS = 180000` from `bin/lib/paths.js` and adding defensive normalization (`Number.isFinite(raw) && raw > 0 ? raw : 180000`) across `migrate.js`, `init.js`, `doctor.js`, and `runtime.js`, allocating 600s for dense vector embedding generation. The hardcoded 180000 literal is superseded in 2.2.20: `MIGRATION_TIMEOUT_MS` now resolves from `install_build_migrate_timeout_ms` (900000 ms default) through `bin/lib/config_defaults.js`.
* **`↯ Migration timed out; run "konoha migrate" again to finish remaining references` on a large skill tree**:
  - **Symptom**: `konoha migrate`, `konoha embed`, or the migrate stage of `konoha upgrade` stops partway and asks to be re-run, even though the surrounding step waited 15 minutes.
  - **Reason**: the embedding pass inside `src/migrate.js` had its own 300 s cap, independent of the caller's `INSTALL_BUILD_MIGRATE_TIMEOUT_MS` (900000 ms). A caller waiting 900 s still saw the embedding stage truncated at 300 s, so the tail of the reference set was deferred.
  - **Fix**: in 2.2.20 the pass defaults to 900 s. On a slow or loaded machine, raise it with `KONOHA_MIGRATE_TIME_BUDGET=1800 konoha migrate` (the embedding pass reads that variable directly). `konoha migrate` is resumable: it indexes only what is missing, so re-running continues rather than restarting.

* **Severe Token-Burn on Website & Mockup Build Requests (`build_from_text` / `build_from_source`)**:
  - **Symptom**: A single call to `build_from_text` or `build_from_source` returned over 100 KB (~26,000 tokens), causing context overflow and burning API quotas.
  - **Reason**: `_load_skill_content_for_build` dumped the full raw markdown of 5 full framework skills (~90 KB) into the response, accompanied by 2-space indented JSON formatting.
  - **Fix**: Resolved in `v2.0.0-beta.5` by replacing raw markdown dumps with token-efficient SOP previews (≤400 chars) that direct agents to load full reference manuals on demand via `konoha.get_skill`, cutting build payload sizes down to ~15 KB (an 85.2% direct context reduction saving ~22,000 tokens per request).

* **`Execution error: a.instructions.includes is not a function` in `konoha status` (`v2.0.0-beta.6`)**:
  - **Symptom**: Running `konoha status` fails to list subagents and displays `Subagents (Naruto Ninja Ranks): ✗ Execution error: a.instructions.includes is not a function`.
  - **Reason**: The lightweight YAML parser in `bin/lib/yaml_utils.js` and `src/db_agents.js` treated unindented following keys (e.g. `instructions:\ntools:`) as empty object dictionaries `{}` or arrays `[]` rather than empty strings `""` when evaluating empty scalar YAML fields.
  - **Fix**: Resolved in `v2.0.0-beta.6` by fixing empty scalar termination logic in `bin/lib/yaml_utils.js` and `src/db_agents.js`, and adding defensive type guards `(typeof a.instructions === 'string' ? a.instructions : '')` in `src/agent_manager.js`.
* **High CLI Latency & Slow Execution on Every `konoha <command>` (`v2.0.0-beta.6`)**:
  - **Symptom**: Commands like `konoha status`, `konoha list`, or `konoha test` take 7–10 seconds to respond even when idle.
  - **Reason**: `needsReferenceLoadingUpgrade()` checked if instructions were non-empty but lacked the check for `'exact reference names'`, causing `sannin` to continuously detect an upgrade needed on every single CLI run. This triggered full multi-client re-deploy loops, repeated SQLite queries, and expensive child-process spawning on every invocation.
  - **Fix**: Resolved in `v2.0.0-beta.6` by adding strict check for `'exact reference names'` in `needsReferenceLoadingUpgrade()`, replacing `konoha agent list-compact` child processes with direct YAML parsing (<0.5ms), adding an in-memory mtime cache to `_getDbSkills()`, and caching auto-setup state in `.auto_setup_state.json`. CLI response time dropped from 7.7s to 0.28s (a 27x speedup).
* **Missing Global Binary after `konoha upgrade` on Linux / Mac (`v2.0.0-beta.6`)**:
  - **Symptom**: Running `konoha upgrade` succeeds, but subsequent commands fail with `bash: /home/<user>/.local/share/pnpm/konoha: No such file or directory`.
  - **Reason**: `addPnpm` prematurely ran `pnpm remove --global konoha` which deleted existing global binary symlinks, and passed the invalid `--prefer-online` npm flag to pnpm.
  - **Fix**: Resolved in `v2.0.0-beta.6` by preserving existing binaries during pnpm global installation, removing `--prefer-online`, and introducing automated post-upgrade global symlink reconciliation.
* **`MCP server connection closed unexpectedly: signal: terminated` during startup / migration (`v2.0.0-beta.7`)**:
  - **Symptom**: When Antigravity or another MCP host launches `konoha`, the server crashes or closes with `signal: terminated`.
  - **Reason**: Background skill auto-migration in `src/migrate.js` output status messages (e.g. `✓ references/...`) via `console.log` directly onto `process.stdout`. In MCP stdio mode, `stdout` is strictly reserved for JSON-RPC messages; raw plaintext corrupts the stream and causes host disconnect.
  - **Fix**: Resolved in `v2.0.0-beta.7` by routing all non-protocol diagnostics and auto-migration logs to `process.stderr` whenever running in MCP server or client mode, keeping `process.stdout` 100% clean for JSON-RPC frames.
* **`Forbidden: Invalid or missing X-Konoha-Web-Token CSRF header` in Web UI (`v2.0.0-beta.7`)**:
  - **Symptom**: Saving bridges, embedding skills, or editing persona memories in the Web UI returns HTTP 403 Forbidden.
  - **Reason**: All state-mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`) require the session CSRF token to prevent cross-site request forgery attacks.
  - **Fix**: Resolved in `v2.0.0-beta.7` by issuing the session token as an `HttpOnly` + `SameSite=Strict` cookie (`konoha-web-token`) and exposing the CSRF token through `GET /api/v1/csrf`; the Web UI (`apps/web/src/lib/api.js`) fetches the token at runtime, keeps it in memory only, and attaches it via `X-Konoha-Web-Token` on all API mutations. The token is no longer injected into `index.html`, so it never leaks through the served HTML.
* **`ENOENT: no such file or directory` when running `konoha ui start` / `ui build` from installed runtime (`v2.0.0-beta.7`)**:
  - **Symptom**: Running `konoha ui start` from an arbitrary directory fails with `spawn ENOENT`.
  - **Reason**: The CLI resolved `apps/web` relative to the installed runtime location (`~/.konoha/bin/cli.js`), pointing to a non-existent `$HOME/apps/web`.
  - **Fix**: Resolved in `v2.0.0-beta.7` by pre-building the Web UI production distribution (`apps/web/build`), copying it into `~/.konoha/apps/web/build` during `init`, and introducing `resolveWebUiDir()` in `src/deploy_utils.js`.
* **Pi (pi.dev) free-running multi-step work without sannin router (`v2.0.0-beta.7`)**:
  - **Symptom**: The Pi coding agent does not route tasks through the `sannin` structured workflow.
  - **Reason**: Pi lacked the Konoha runtime contract and workflow mandate in its global context file.
  - **Fix**: Resolved in `v2.0.0-beta.7` by deploying the full Konoha runtime contract + Pi Workflow Mandate in `~/.pi/agent/AGENTS.md`.
* **Workflow Abandoned on Session Resume across coding clients (`v2.0.0-beta.7`)**:
  - **Symptom**: When resuming an existing conversation with `--resume` or `--continue`, agents bypassed the Konoha workflow.
  - **Reason**: Contracts are loaded at session start, but session resume lacked a re-engagement trigger.
  - **Fix**: Resolved in `v2.0.0-beta.7` by registering `src/workflow/sannin-orchestrator/workflow_reminder.js` as UserPromptSubmit and SessionStart hooks (`resume|compact|clear`) for Claude Code and Command Code.
* **Pi (pi.dev) `[Skill conflicts]` warning at startup (`v2.0.0-beta.7`)**:
  - **Symptom**: Running `pi` in a project with `.agents/skills` prints `[Skill conflicts]` collisions between global user skills (`~/.agents/skills`) and project local skills (`.agents/skills`).
  - **Reason**: Pi scans both global and local skill directories; identical mirror copies on disk have different physical file paths, causing Pi to log collision diagnostics.
  - **Fix**: Resolved in `v2.0.0-beta.7` by updating `konoha-blocker.ts` in `~/.pi/agent/extensions/` to monkeypatch `DefaultResourceLoader.prototype.getSkills` and `updateSkillsFromPaths`, filtering out benign collision diagnostics while keeping all skills fully accessible.
* **Web UI Port 1404 Process Duplication or Warnings on New Terminal Tabs (`v2.0.0-beta.7`)**:
  - **Symptom**: Opening new terminal tabs or running `konoha ui start` when already running shows `warn` warnings or leaves orphaned daemon processes in `ps aux`.
  - **Reason**: `cmdUiStart` logged active instances as warnings instead of informational status, and dead PID files were not cleaned up if processes exited abruptly.
  - **Fix**: Resolved in `v2.0.0-beta.7` by reporting active servers cleanly via `info()`, pruning dead PID files, adding single-instance daemon process deduplication before spawn, handling `SIGHUP` in `cmdUiDaemon`, and ensuring `cmdUiStop` unconditionally cleans all orphaned daemons via `pkill -f "cli.js ui daemon"`.
* **SDLC Task Delivery Deadlock in Long-Running Persistent Sessions (`v2.0.0-beta.7`)**:
  - **Symptom**: Sannin routes a task, execution succeeds, but the Kage delivery review gate returns `status: "blocked"` with `Kage review did not approve all completed tasks` even though all current tasks passed validation.
  - **Reason**: The SDLC task completion check in `workflowReviewApproved` queried `listTasks({ sessionId })` across the entire session table. In persistent clients (Antigravity CLI/IDE with a long-lived conversation ID), leftover or unverified tasks from earlier prompts in that same session falsely blocked the active workflow from completing.
  - **Fix**: Resolved in `v2.0.0-beta.7` by strictly scoping Kage's SDLC delivery gate to the root task container (checking for non-failure/non-blocked status while excluding it from self-deadlock) and the subtasks belonging specifically to the active workflow (`status.tasks`).
* **Web UI `/agents` Missing Embedded & Official Skills (`v2.0.0-beta.7`)**:
  - **Symptom**: In the SvelteKit Web UI `/agents` page, subagent cards do not show their official skills or embedded reference capabilities.
  - **Reason**: The skills list was querying without agent name mapping and default pagination in `GET /api/v1/skills` truncated the returned list at 100 items.
  - **Fix**: Resolved in `v2.0.0-beta.7` by introducing `getSkillsForAgent` helper, rendering active embedded skills with badges and smooth inside-card scrolling (`max-h-56 overflow-y-auto`), and increasing the API default pagination limit to 500.
* **Fragmented Savings Telemetry in TUI & UI (`v2.0.0-beta.7`)**:
  - **Symptom**: Running `konoha savings` displayed cluttered per-client provider invocation tables that distracted from visual token reduction metrics.
  - **Reason**: Legacy provider breakdown tables duplicated client stats rather than aggregating into the core token optimization metric.
  - **Fix**: Resolved in `v2.0.0-beta.7` by removing the "Client Provider Breakdown (Invocations & Tokens)" section from both TUI and Web UI, unifying all counters into a single all-in-one counter: Visual Savings (Tokens & Thought Reasoning), calculated relative to the measured skill-library baseline (baseline shown as unavailable when nothing is indexed) and Unified live metric from Konoha MCP + Semble Semantic Engine.
* **Definition-of-Readiness (DoR) Gate Blocks Dispatch**:
  - **Symptom**: Sannin returns `status: "blocked", phase: "dor"` with message `Definition-of-Readiness (DoR) check failed in enforced mode`.
  - **Reason**: The project has `dor_mode: enforced`, and the prompt contains fewer than 5 words, unresolved placeholder tokens (`TODO`, `FIXME`, `???`), non-existent file paths without creation intent, or lacks clear domain action keywords.
  - **Fix**: Either provide more specific details in the prompt (e.g. mention the target file or feature), or switch the project to advisory mode via `konoha project set dor-mode advisory`.

---

### 🔐 Web UI login offers the default passphrase instead of first-run setup (fixed in 2.2.20; affects ≤ 2.2.19)

- **Symptom**: The login card shows two tabs ("Passphrase Sign-In" selected by default, plus "First-Run Setup"), a `default passphrase (konohagakure)` badge, and a hint line naming the default value. Clicking "First-Run Setup" and submitting it in 2.2.19 or earlier returns `401 Unauthorized` from a real browser.
- **Reason**: `apps/web/src/components/Login.svelte` defaulted `isSetupMode` to `false` and rendered the provisioning constant, so the sign-in form was the landing view and the default value was displayed. `POST /api/v1/auth/setup-password` was also not reachable by an unauthenticated browser request (the API auth middleware rejected it before the controller).
- **Fix**: The landing view is now chosen from `GET /api/v1/auth/status` (`is_bootstrap: true` ⇒ two-field set-new-password form only) and the default value is no longer rendered anywhere; `setup-password` is reachable from the browser with the required `X-Konoha-Web-Token` CSRF header while bootstrap is active. The bootstrap session gate and the default credential itself are unchanged.
- **Recovery**: On 2.2.20+ set the new password on the login page and sign in with it. If the account is locked out, run `konoha auth reset` to restore the bootstrap credential (`is_bootstrap: true`) and reload the page — the setup form returns.

---

### 🗄️ Database Corruption

If the SQLite database becomes corrupted, remove it and rebuild the index:
```bash
rm ~/.konoha/konoha.db ~/.konoha/skills.db 2>/dev/null
konoha migrate
```

---

### 🛡️ VPS Provider False Positive (malware / offensive-tooling alert)

- **Symptom**: a VPS provider suspends or flags the host after installing Konoha, citing offensive security tooling or "cyber attack" files.
- **Reason**: releases before 2.2.19 shipped an 817-skill cybersecurity library inside the package and indexed it under the backend/DevOps skill. Backend work does not need offensive tooling, so the default install looked like a penetration-testing kit to scanners.
- **2.2.19+ behaviour**: the library is not shipped and not indexed. A fresh install contains 0 pack files and 0 cyber rows; `@anbu` handles backend, bugfix, and DevOps, and escalates security work to `@akatsuki`.
- **Verify**:
  ```bash
  konoha doctor --vps
  ```
  Every check must print `PASS`. `cyber rows` is the one that flags a pre-2.2.19 install.
- **Fix (upgrade path)**: the library is opt-in and red-only. Install it deliberately with `konoha akatsuki cyber-pack install --confirm`, or purge legacy rows from an older install with:
  ```bash
  konoha doctor --clean-cyber-pack
  ```
  `--clean-cyber-pack` snapshots the database to `~/.konoha/backups/` before deleting anything and prints the exact row/chunk counts removed. `--restore-anbu` restores the ANBU skill itself and never restores the pack.
- **Report a new false positive**: include the provider's exact alert text, the flagged absolute paths, and `konoha doctor --vps` output. See [VPS-INSTALL.md](VPS-INSTALL.md).

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
2. Check that `node >= 24.0.0` is installed:
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

The `konoha-bridge` extension (`https://github.com/andycungkrinx91/konoha-bridge`) is automatically cloned from live `master`, packaged into `konoha-bridge-1.6.0.vsix`, and installed ONLY into Antigravity IDE during `konoha init` and `konoha upgrade`:
```bash
# Antigravity IDE CLI (exclusive install target)
antigravity --install-extension konoha-bridge-1.6.0.vsix
```
The VSIX is never installed into other IDEs (no `code --install-extension`, no `cursor --install-extension`). A fallback VSIX is bundled in `assets/konoha-bridge-1.6.0.vsix`.
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

**Fix:** Konoha incorporates strict `isIdeInstallationDirectory` guards in `file_tools_router.js` and `src/file_tools/common.js`. Access to IDE program directories is permanently blocked, and `detectWorkspaceRoot()` automatically resolves the real project directory from session cache (`last_conversations.json`, `projects.json`) or `WORKSPACE_ROOT`. Run `konoha doctor --yes` to ensure all latest file tools are synced to `~/.konoha/`.

---

### 🌐 Web Configuration UI Issues (`konoha ui`) (v2.0.2)

1. **Port 1404 Already in Use**:
   - **Symptom**: `EADDRINUSE 127.0.0.1:1404` when executing `konoha ui start`.
   - **Fix**: Run `konoha ui restart` or `konoha ui stop`. On Windows, the stop handler executes process tree cleanup via `taskkill /F /T /PID`, releases port 1404, and cleans up port-scoped PID files under `~/.konoha/ui/`.
   - Alternatively, bind to a custom port: `konoha ui start --port 1500`.

2. **UI Daemon Fails to Start or Exits Immediately**:
   - Check status and PID: `konoha ui status`.
   - Check daemon logs: `~/.konoha/ui/daemon-1404.log`.
   - Rebuild pre-built assets if missing: `konoha ui build`.

3. **Browser Does Not Launch Automatically**:
   - Run `konoha ui open` or navigate manually to `http://127.0.0.1:1404/`.
   - On Windows, detached daemon execution uses `cmd.exe /c start ""` with `windowsHide: true`.

---

## Getting Help

1. Run `konoha status` for diagnostic info
2. Run `konoha test` for server health check
3. Run `konoha doctor --yes` for auto-repair across all supported clients
4. Check the logs at `~/.konoha/` for any error files
