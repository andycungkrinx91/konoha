# Security and Compliance Review: Konoha Project [v1.1.6]

## Executive Summary
This compliance report audits version 1.1.6 of the Konoha Project, focusing on the new Cursor IDE/CLI integration layer, automatic bootstrap execution, and Cursor subagent model embedding. The audit verifies that Cursor configuration writes remain consent-gated during `konoha init`, that the sessionStart hook fails open, and that workspace path scoping was extended without weakening sandbox boundaries. Overall, the integration complies with established interactive consent and path visibility policies.

## Findings

### 1. Interactive Consent for Cursor Configuration
- **Action Verified**: `bin/cli.js` `cmdInit()` adds a `@inquirer/prompts` confirmation (`Configure Konoha for Cursor IDE and Cursor CLI?`) before writing `~/.cursor/mcp.json`, `~/.cursor/agents/`, or `~/.cursor/hooks.json`.
- **Impact**: Cursor auto-setup cannot silently modify user Cursor configuration without explicit consent during manual init, preserving Google Policy interactive consent requirements.

### 2. Fail-Open Cursor sessionStart Hook
- **Action Verified**: `src/cursor_bootstrap.js` wraps all logic in try/catch and always exits with code 0, preventing session blocking if bootstrap fails.
- **Impact**: Cursor sessions remain usable even when Konoha files are missing or Python is unavailable.

### 3. Workspace Scoping Extension for Cursor Paths
- **Action Verified**: `src/server.py` `is_path_visible()` adds `~/.cursor/` prefix checks and `.cursor/skills` / `.cursor/agents` path markers without removing existing `~/.agents/` or `~/.gemini/` boundaries.
- **Impact**: Cursor-managed skill and agent files remain accessible to MCP tools while generic home-directory exposure is still blocked.

### 4. Cursor Subagent Model Embedding
- **Action Verified**: `src/cursor_manager.js` `generateCursorSubagent()` injects `model: inherit` (Cursor Auto) into YAML frontmatter for all six official ninja agents by default, supporting Cursor Free accounts without explicit model selection.
- **Impact**: Subagents follow the session Auto model.

### 5. Restored Auto-Setup Execution
- **Action Verified**: `bin/cli.js` `main()` now calls `ensureAutoSetup()` on every command except `uninstall` and `help`, restoring the documented v1.0.7+ self-healing bootstrap that was previously defined but not invoked.
- **Impact**: MCP registration and database seeding self-heal on routine CLI use without requiring manual re-init.

### 6. Dual-Platform Agent Attribution
- **Action Verified**: `detect_active_agent()` in `server.py` resolves Antigravity (`brain/` transcripts) and Cursor (`agent-transcripts/`) sessions; `agent_stats.py` uses case-insensitive grouping; official subagents are delete-protected in `agent_manager.js`.
- **Impact**: `konoha agent status` reports accurate per-ninja counters in both Antigravity and Cursor without false positives from `VIEW_FILE` transcript noise.

### 7. Strict Orchestrator Delegation Pipeline
- **Action Verified**: `buildOrchestratorWorkflow()` in `agent_manager.js` enforces `prompt.md` → `delegate.md` → Konoha subagent → `result.md`; `@self` and `@research` removed from delegation tables.
- **Impact**: Main Antigravity agent acts as coordinator only — work is routed exclusively through the six official Konoha ninjas.

### 8. Semble as Default Code Search
- **Action Verified**: `src/search_policy.js` mandates `semble` MCP over built-in grep/glob and Cursor `Grep`/`Glob`/`SemanticSearch` in generated `GEMINI.md`, `AGENTS.md`, and `.cursor/rules/konoha.mdc`.
- **Impact**: Reduces token waste from raw grep dumps; enforces consistent discovery tooling across Antigravity and Cursor.

### 9. Token-Efficient File Tools (`konoha-files`)
- **Action Verified**: `file_tools_mcp.js` (Node JSON-RPC) spawns Python helpers with hard caps: 500-line read span, 20 grep matches, structure-only parsing, blacklisted directory walks. Registered in Antigravity and Cursor MCP configs with auto-approve permissions.
- **Impact**: Agents can read and search files without loading full file contents into the LLM context window.

## Conclusion
Version 1.1.6 extends Konoha to Cursor IDE and Cursor CLI with consent-gated configuration, fail-open session hooks, and `model: inherit` defaults for all official subagents. Dual-platform agent attribution, strict orchestrator delegation, semble-default search policy, konoha-files token-efficient tooling, path scoping, auto-setup restoration, and uninstall cleanup were verified. The system remains compliant with Konoha security and Google Policy interactive consent requirements.
