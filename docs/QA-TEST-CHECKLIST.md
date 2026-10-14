# Konoha Manual Verification & Testing Checklist

**Version:** 2.1.18  
**Date:** 2026-10-14  
**Target:** Local Sandbox Manual Verification & Pre-Release QA  
**Authoritative Sources:** `bin/cli.js`, `src/file_tools_router.js`, `src/mcp_tool_manifest.json`, `src/web_server.js`, `src/persona_memory.js`, `src/mcp/workflow.js`

---

## 1. Sandbox Environment Setup

Before running manual tests, isolate the execution environment completely from the host system:

```bash
# 1.1 Create dedicated sandbox directory
export KT="$(mktemp -d /tmp/konoha_manual_test_XXXXXX)"
echo "Sandbox HOME: $KT"

# 1.2 Define the isolated CLI execution helper
k() {
  env HOME="$KT" KONOHA_UI_AUTOSTART=0 node bin/cli.js "$@"
}

# 1.3 Free port allocation for Web UI daemon
export TEST_PORT=1492

# 1.4 Production Host Protection Guardrail
# Host production daemon on 127.0.0.1:1404 (PID 143245) must NEVER be stopped or killed.
# Never execute destructive commands ('clean', 'uninstall', 'reinstall', 'migrate --clean', 'data prune') without HOME="$KT".
```

- [ ] **1.1 Sandbox Creation**: `export KT="$(mktemp -d /tmp/konoha_manual_test_XXXXXX)"`
  - Expected: Creates a fresh, isolated directory under `/tmp`.
  - Ref: `tests/run_all.js:28`
- [ ] **1.2 Isolated Helper Definition**: Define `konoha()` function with `KonohaONOHA_UI_AUTOSTART=0`.
  - Expected: All CLI subcommands execute strictly inside `$KT`.
  - Ref: `bin/cli.js:9290`
- [ ] **1.3 First-Seed Duration Note**: First invocation against clean `$KT` takes ~10–25s to initialize SQLite schemas and copy skill templates.
  - Ref: `bin/cli.js:1240`
- [ ] **1.4 Tarball Verification Recipe**:
  ```bash
  # To test directly from clean-clone tarball:
  npx --package=/tmp/konoha-mcp-2.1.18.tgz konoha status
  ```
  - Expected: Runs packed binary without requiring global installation.
  - Ref: `package.json:bin`

---

## 2. CLI Command Surface & Router Verification

Test every retained canonical command and verify strict rejection of legacy aliases.

### 2.1 Retained Canonical Commands

| Check | Command | Expected Output | Risk / Mode | Source Reference |
|---|---|---|---|---|
| [ ] | `konoha help` | Command overview, canonical usage flags, exit 0 | Safe | `bin/cli.js:9380` |
| [ ] | `konoha version` | `Current Version: 2.1.18` | Safe | `bin/cli.js:9340` |
| [ ] | `konoha status` | Database location, 15 skills, client statuses | Safe | `bin/cli.js:9315` |
| [ ] | `konoha savings` | Token savings telemetry, visual ASCII bar | Safe | `bin/cli.js:9320` |
| [ ] | `konoha doctor` | Environment diagnostics, SQLite FTS5 status | Safe | `bin/cli.js:9330` |
| [ ] | `konoha test` | MCP tool tests, vector search sample query | Safe | `bin/cli.js:9310` |
| [ ] | `konoha data view` | Storage breakdown, table sizes, row counts | Safe | `bin/cli.js:9365` |
| [ ] | `konoha data backup` | Creates `.konoha/konoha.db.backup-*` via `VACUUM INTO` | Safe | `bin/cli.js:6115` |
| [ ] | `konoha data rebuild-fts` | Rebuilds `skills_fts` and `persona_memories_fts` | Safe | `bin/cli.js:6140` |
| [ ] | `konoha data prune --retention 90` | Prunes tool calls older than 90d (Immediate delete warning) | Destructive (Data) | `bin/cli.js:6165` |
| [ ] | `konoha project list` | Lists registered workspace projects | Safe | `bin/cli.js:9370` |
| [ ] | `konoha task list` | Displays recorded SDLC tasks from SQLite | Safe | `bin/cli.js:9375` |
| [ ] | `konoha bridge list` | Displays bridge router ports and providers | Safe | `bin/cli.js:9380` |
| [ ] | `konoha bridge models` | Displays cached LLM models per bridge | Safe | `bin/cli.js:9380` |
| [ ] | `konoha skill list` | Lists all 15 canonical skills | Safe | `bin/cli.js:9350` |
| [ ] | `konoha agent status` | Displays 7 specialist ninjas status | Safe | `bin/cli.js:9355` |
| [ ] | `konoha soul view` | Displays global persona memory & guidelines | Safe | `bin/cli.js:9368` |
| [ ] | `konoha search --help` | Web search fallback chain flags | Safe | `bin/cli.js:9382` |
| [ ] | `konoha telegram status` | Telegram bot daemon status & config | Safe | `bin/cli.js:9384` |
| [ ] | `konoha tunnel status` | Cloudflare tunnel supervisor status | Safe | `bin/cli.js:9386` |
| [ ] | `konoha queue list` | Lists queued async prompts from SQLite inbox | Safe | `bin/cli.js:9388` |
| [ ] | `konoha detect-ai package.json` | Scans for AI fingerprints (Human-Built Index) | Safe | `bin/cli.js:9324` |
| [ ] | `konoha detect-docs README.md` | Scans text for AI generation markers (ZeroGPT defense) | Safe | `bin/cli.js:9327` |
| [ ] | `konoha ui status --port=$TEST_PORT` | Shows UI daemon status on custom test port | Safe | `bin/cli.js:9336` |
| [ ] | `konoha migrate` | Re-indexes skills non-destructively into FTS5 | Safe / Ingest | `bin/cli.js:9303` |
| [ ] | `konoha embed` | Rebuilds neural vector embeddings | CPU Intensive | `bin/cli.js:9306` |
| [ ] | `konoha init --yes` | Configures client MCP configs in sandbox HOME | Writes Config | `bin/cli.js:9299` |
| [ ] | `konoha reinstall --yes` | Re-initializes sandbox database and configs | Destructive (Config) | `bin/cli.js:9300` |
| [ ] | `konoha clean --yes` | Cleans temporary scratch/cache directories | Destructive (Cache) | `bin/cli.js:9332` |

### 2.2 Rejection of 27 Removed Legacy Aliases

Each of the following removed router aliases must exit 1 with:
`Unknown command: <alias>`  
`Run konoha help for usage.`

- [ ] `konoha embeddings` (Ref: `bin/cli.js:9408`)
- [ ] `konoha detect_ai` (Ref: `bin/cli.js:9408`)
- [ ] `konoha ai-detector` (Ref: `bin/cli.js:9408`)
- [ ] `konoha detect_docs` (Ref: `bin/cli.js:9408`)
- [ ] `konoha docs-detector` (Ref: `bin/cli.js:9408`)
- [ ] `konoha detect-doc` (Ref: `bin/cli.js:9408`)
- [ ] `konoha personas` (Ref: `bin/cli.js:9408`)
- [ ] `konoha memories` (Ref: `bin/cli.js:9408`)
- [ ] `konoha spirit` (Ref: `bin/cli.js:9408`)
- [ ] `konoha will-of-fire` (Ref: `bin/cli.js:9408`)
- [ ] `konoha projects` (Ref: `bin/cli.js:9408`)
- [ ] `konoha tasks` (Ref: `bin/cli.js:9408`)
- [ ] `konoha web-search` (Ref: `bin/cli.js:9408`)
- [ ] `konoha inbox` (Ref: `bin/cli.js:9408`)
- [ ] `konoha install` (Ref: `bin/cli.js:9408`)
- [ ] `konoha memory` (Ref: `bin/cli.js:9408`)
- [ ] `konoha setup` (Ref: `bin/cli.js:9408`)
- [ ] `konoha update` (Ref: `bin/cli.js:9408`)
- [ ] `konoha saving` (Ref: `bin/cli.js:9408`)
- [ ] `konoha agents` (Ref: `bin/cli.js:9408`)
- [ ] `konoha tg` (Ref: `bin/cli.js:9408`)
- [ ] `konoha tunnels` (Ref: `bin/cli.js:9408`)
- [ ] `konoha prune` (Ref: `bin/cli.js:9408`)
- [ ] `konoha context` (Ref: `bin/cli.js:9408`)
- [ ] `konoha persona` (Ref: `bin/cli.js:9408`)
- [ ] `konoha searxng` (Ref: `bin/cli.js:9408`)
- [ ] `konoha sdlc` (Ref: `bin/cli.js:9408`)

---

## 3. MCP STDIO Protocol & Dispatch Verification

Execute the headless MCP STDIO server via JSON-RPC 2.0 in the sandbox environment:

```bash
# Helper to execute single JSON-RPC message
mcp_call() {
  printf '%s\n' "$1" | env HOME="$KT" KONOHA_DB_PATH="$KT/.konoha/konoha.db" node src/server.js
}
```

- [ ] **3.1 Protocol Initialization**:
  - Request: `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test-client","version":"1.0"}}}`
  - Expected: HTTP/JSON response with `serverInfo.name: "konoha"`, `serverInfo.version: "2.1.18"`, `protocolVersion: "2024-11-05"`.
  - Ref: `src/mcp/protocol.js:46`
- [ ] **3.2 Tools List Manifest Count**:
  - Request: `{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`
  - Expected: Exactly 40 manifest tools returned (`result.tools.length == 40`).
  - Ref: `src/mcp_tool_manifest.json:tools`
- [ ] **3.3 Skill Search Tool (`find_skill`)**:
  - Request: `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"find_skill","arguments":{"keyword":"sannin"}}}`
  - Expected: `result.content[0].text` contains JSON with `found >= 1`.
  - Ref: `src/file_tools_router.js:find_skill`
- [ ] **3.4 Bounded File Tool (`read_file_head`)**:
  - Request: `{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"read_file_head","arguments":{"file_path":"package.json","max_lines":5}}}`
  - Expected: First 5 lines of `package.json` with line prefixes.
  - Ref: `src/file_tools_router.js:read_file_head`
- [ ] **3.5 Direct Specialist Tool Call (`genin`)**:
  - Request: `{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"genin","arguments":{"task":"inspect package.json"}}}`
  - Expected: Structured execution report from Genin scout.
  - Ref: `src/file_tools_router.js:genin`
- [ ] **3.6 Readiness Check Tool (`check_readiness`)**:
  - Request: `{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"check_readiness","arguments":{"task":"Verify sandbox"}}}`
  - Expected: Status report evaluating Definition-of-Readiness (DoR).
  - Ref: `src/file_tools_router.js:check_readiness`
- [ ] **3.7 Valid Agent Caller in `report_from_agent`**:
  - Request: `{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"report_from_agent","arguments":{"agent":"kage","summary":"audit pass"}}}`
  - Expected: Successfully records task event without rejection.
  - Ref: `src/file_tools_router.js:report_from_agent`
- [ ] **3.8 Legacy `delegate_to_` Rejection in `report_from_agent` (G-18)**:
  - Request: `{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"report_from_agent","arguments":{"agent":"delegate_to_kage","summary":"test"}}}`
  - Expected: Error response rejecting legacy caller: `Legacy delegate_to_* name rejected`.
  - Ref: `src/file_tools_router.js:report_from_agent`
- [ ] **3.9 Unknown Tool Invocation**:
  - Request: `{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"nonexistent_tool","arguments":{}}}`
  - Expected: JSON-RPC error code `-32601` (`Method not found` / `Unknown tool`).
  - Ref: `src/server.js:handleToolCall`

---

## 4. Web UI & HTTP API Subsystem

Test Web UI server daemon on custom isolated port (`$TEST_PORT` = 1492):

```bash
# Start daemon
k ui daemon --port=$TEST_PORT --host=127.0.0.1
```

- [ ] **4.1 Health Endpoint (`GET /api/v1/health`)**:
  - Command: `curl -s http://127.0.0.1:$TEST_PORT/api/v1/health`
  - Expected: `{"status":"healthy","version":"2.1.18",...}`
  - Ref: `src/web_server.js:372`
- [ ] **4.2 Root Redirect (`GET /`)**:
  - Command: `curl -i http://127.0.0.1:$TEST_PORT/`
  - Expected: HTTP 307 Temporary Redirect to `/dashboard`.
  - Ref: `src/web_server.js:2160`
- [ ] **4.3 Dashboard SvelteKit Route (`GET /dashboard`)**:
  - Command: `curl -i http://127.0.0.1:$TEST_PORT/dashboard`
  - Expected: HTTP 200 with `x-sveltekit-page: true`.
  - Ref: `src/web_server.js:2155`
- [ ] **4.4 Static Asset Serving (`GET /_app/version.json`)**:
  - Command: `curl -i http://127.0.0.1:$TEST_PORT/_app/version.json`
  - Expected: HTTP 200 `application/json`.
  - Ref: `src/web_server.js:2140`
- [ ] **4.5 Foreign Host Header Rejection (Loopback Security / G-04)**:
  - Command: `curl -i -H "Host: evil.attacker.com" http://127.0.0.1:$TEST_PORT/api/v1/health`
  - Expected: HTTP 403 Forbidden (`Loopback interface rejected external Host header`).
  - Ref: `src/web_server.js:189`
- [ ] **4.6 Project Deletion Confirmation Flag (SEC-01)**:
  - Command: `curl -X DELETE http://127.0.0.1:$TEST_PORT/api/v1/projects/dummyhash`
  - Expected: HTTP 400 Bad Request requiring explicit `?confirm=true` or confirmation body.
  - Ref: `src/web_server.js:1450`
- [ ] **4.7 Clean Stop**:
  - Command: `konoha ui stop --port=$TEST_PORT`
  - Expected: Shuts down daemon cleanly, removes PID file.
  - Ref: `bin/cli.js:7750`

---

## 5. Memory Subsystem & Per-Session Isolation

Validate strict per-session memory isolation contract (Decision A):

- [ ] **5.1 Session Isolation Write**:
  - Session A registers episodic memory: `M_A` with `session_id: "sess_alpha"`.
  - Session C registers episodic memory: `M_C` with `session_id: "sess_gamma"`.
  - Ref: `src/persona_memory.js:saveMemory`
- [ ] **5.2 Session-Scoped Query**:
  - Query episodic memories with `session_id: "sess_alpha"`.
  - Expected: Returns `M_A` only; `M_C` is strictly omitted.
  - Ref: `src/persona_memory.js:queryMemories`
- [ ] **5.3 All-Sessions Administrative Listing**:
  - Query memories with `allSessions: true`.
  - Expected: Returns both `M_A` and `M_C`.
  - Ref: `src/persona_memory.js:listMemories`
- [ ] **5.4 Non-Episodic Project Invariant Visibility**:
  - Register invariant rule (`memory_type: "stack"`).
  - Expected: Invariant is visible across all sessions for the project workspace.
  - Ref: `src/persona_memory.js:queryMemories`

---

## 6. Multi-Agent SDLC Workflow Engine

- [ ] **6.1 WORKFLOW_PHASES Constant Order**:
  - Inspect `src/mcp/workflow.js:19`.
  - Expected sequence: `route`, `explore`, `plan`, `research`, `execute`, `document`, `review`, `synthesize`, `done`.
  - Ref: `src/mcp/workflow.js:19`
- [ ] **6.2 State Machine Transition Guard**:
  - Verify transitions cannot skip mandatory gates (DoR before explore, Kage review before synthesize).
  - Ref: `src/mcp/workflow.js:advancePhase`

---

## 7. Client Configurations & Integration Hygiene

Verify client configuration updates in sandbox HOME (`$KT`):

- [ ] **7.1 Supported Clients**:
  - Antigravity IDE (`~/.gemini/` and `~/.antigravity-ide/`)
  - Claude Code (`~/.claude/`)
  - Cursor IDE (`~/.cursor/`)
  - OpenCode (`~/.config/opencode/`)
  - Command Code (`~/.commandcode/`)
  - OpenAI Codex (`~/.codex/`)
  - Pi Coding Agent (`~/.pi/`)
- [ ] **7.2 Backup Preservation (.bak)**:
  - Existing client configs are backed up before modification (`config.json.bak`, `config.toml.bak`).
  - Ref: `bin/cli.js:3380`
- [ ] **7.3 Custom Agents Preservation**:
  - User-defined custom agents in Codex `config.toml` or Cursor settings are preserved via union-merge.
  - Ref: `bin/cli.js:3420`

---

## 8. Skill Synchronization & Retrieval

- [ ] **8.1 15 Canonical Skills**:
  - Verify all 15 skills exist in `src/templates/skills/` and database:
    `accessibility-testing-expert`, `adaptive-model-cascade`, `affective-computing-emotion-ai`, `agentic-coding-workflow-expert`, `agentic-memory-architect`, `agentic-micro-economy-architect`, `anbu-skill`, `antislop`, `antislop-code`, `antislop-copywriting`, `antislop-human`, `antislop-layoutmobile`, `antislop-ui`, `chunin-skill`, `genin-skill`, `helm-chart-scaffolding`, `i-have-adhd`, `jonin-skill`, `kage-skill`, `konoha`, `sannin-skill`, `tokubetsu-jonin-skill`.
  - Ref: `scripts/sync_skills.js:20`
- [ ] **8.2 Multi-Tree Skill Mirror**:
  - Verify `scripts/sync_skills.js` synchronizes canonical templates into `.agents/skills/`, `.claude/skills/`, `.cursor/skills/`, `.gemini/skills/`, `.commandcode/skills/`.
  - Ref: `scripts/sync_skills.js:45`

---

## 9. Documentation, Diagrams & Visual Assets

- [ ] **9.1 Architecture DrawIO Parsing**:
  - Both `docs/diagrams/konoha-architecture.drawio` and `docs/diagrams/konoha-enterprise-architecture.drawio` parse cleanly with 15 pages.
  - Ref: `tests/test_documentation_diagrams.js:35`
- [ ] **9.2 Mermaid Syntax Compliance**:
  - All Markdown companion diagrams conform to theme and unescaped pipe invariants.
  - Ref: `tests/test_documentation_diagrams.js:115`
- [ ] **9.3 Animated GIF Assets**:
  - All 8 regenerated GIFs in `assets/` display version `2.1.18` or suite count `142` with correct dimensions.
  - Ref: `scripts/generate_premium_flow_gifs.js`, `scripts/generate_real_demo_gifs.js`

---

## 10. Clean-Clone Packaging & Release Hygiene

- [ ] **10.1 Tarball File Invariants**:
  - Run `npm pack --dry-run --ignore-scripts`.
  - Verify `docs/` is completely excluded from tarball.
  - Verify `.pyc`, `__pycache__`, and temporary test artifacts are excluded.
  - Ref: `tests/test_package_tarball_files.js:13`
- [ ] **10.2 Zero Untracked Secrets**:
  - Confirm no credentials, `.env*`, or private keys are tracked in git repository.
  - Ref: `GEMINI.md:Guardrails`

---

## 11. Known Deferred Limitations (Out of Scope for 2.1.18)

1. **G-21 (Anti-slop workspace path restriction)**:
   - Status: Approved by user prompt, but deferred (report only, no implementation commit).
2. **SEC-04 Public Tunnel Ingress Authentication**:
   - Status: User explicitly declared Cloudflare Tunnel out of scope; basic PIN mechanism remains active as documented in limitation tables.
3. **Playwright Headless Browser in Sandboxed CI**:
   - Status: Requires host Chromium binary; automated mock fallback active for headless test suites.
