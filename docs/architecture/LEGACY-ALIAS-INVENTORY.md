# Konoha Architecture Legacy and Alias Inventory

**Document Version:** 2.2.11  
**Date:** 2026-10-27  
**Status:** Canonical Audit (v2.2.11 Complete)  

---

## 1. Inventory Summary

This audit catalogs all historical aliases, shims, compatibility fallbacks, and duplicated interfaces across the Konoha repository.

| Identifier | Classification | Type | Canonical Target | Action Plan |
|---|---|---|---|---|
| `find_skills` | **COMPLETED / PRUNED** | MCP tool alias | `find_skill` | Filtered from live advertised schemas in v2.1.18 (46 canonical advertised tools / 48 manifest-backed tools) |
| `build_with_image_design` | **COMPLETED / PRUNED** | MCP tool alias | `build_from_source` | Filtered from live advertised schemas in v2.1.18 (46 canonical advertised tools / 48 manifest-backed tools) |
| `delegate_to_<agent>` (7 tools) | **COMPLETED / REMOVED** | MCP tool aliases | Direct agent tools (`sannin`, `kage`, etc.) | Removed in Batch 4.6 (commit 576e50b) |
| `tokubetsu_jonin` vs `tokubetsu-jonin` | **CANONICAL_MAPPING** | Identifier syntax | `tokubetsu-jonin` (agent) / `tokubetsu_jonin` (MCP tool) | Maintain strict 1:1 bidirectional normalizer |
| `task_dir` / `delegate.md` / `result.md` | **ISOLATED_FALLBACK** | File-based fallback | Direct structured MCP argument passing | Keep isolated in `~/.konoha/tmp/` for non-MCP fallback |
| `skills.db` | **MIGRATE_THEN_REMOVE** | Storage filename | `konoha.db` | Auto-migrate legacy DB file on startup |
| 27 Top-Level CLI Aliases | **COMPLETED / REMOVED** | CLI command aliases | Canonical CLI subcommands | Removed in v2.1.18; strict rejection with exit code 1 |
| `openai-oauth` | **FALSE_POSITIVE** | Auth provider | `openai` (API key) / `sidecar` | Already eradicated in v2.0.0 |
| `deep-code-explorer` | **FALSE_POSITIVE** | Agent name | `genin` | Already eradicated in v2.0.0 |

---

## 2. Detailed Item Records

### Item 1: `find_skills` (Plural Skill Search Alias)

* **Legacy Identifier:** `find_skills`
* **Type:** MCP Tool Alias
* **Current Usage:** Defined in `src/mcp_tool_manifest.json` and `src/file_tools_router.js` line 368:
  ```javascript
  find_skills: (args) => runNodeSkillTool('find_skill', args)
  ```
  Also referenced in prompt generation strings: `all clients call skills through konoha.find_skills`.
* **Canonical Replacement:** `find_skill`
* **Internal Consumers:** Router dispatch only; actual implementation is `find_skill` in `src/mcp/skills.js`.
* **External Consumers:** Client prompt templates (`agent_contract.js`, `agent_manager.js`, `cursor_manager.js`).
* **Migration Required:**
  1. Standardize prompt contracts to mandate `find_skill`.
  2. Keep internal alias dispatch until client prompts migrate, then retire from tool manifest.
* **Removal Condition:** All client contracts unified to `find_skill`.
* **Risk:** Low (pure alias).
* **Status:** COMPLETED / PRUNED in v2.1.18. Filtered from live MCP tool schemas, maintaining live roster at exactly 46 canonical tools (48 manifest-backed).

---

### Item 2: `build_with_image_design` (Image-to-UI Specification Alias)

* **Legacy Identifier:** `build_with_image_design`
* **Type:** MCP Tool Alias
* **Current Usage:** Legacy alias for `build_from_source`. Pruned from live tool schemas in `src/mcp/protocol.js` and `src/file_tools_router.js`.
* **Canonical Replacement:** `build_from_source`
* **Internal Consumers:** None.
* **External Consumers:** Historical documentation and test snapshots.
* **Migration Required:** Completed. Pruned from active tool manifest in v2.1.18.
* **Removal Condition:** Satisfied in v2.1.18.
* **Risk:** Very Low (already excluded in `listToolSchemas()`).
* **Status:** COMPLETED / PRUNED in v2.1.18.


---

### Item 3: `delegate_to_<agent>` (7 Prefixed Delegation Tools)

* **Legacy Identifiers:**
  - `delegate_to_sannin`
  - `delegate_to_kage`
  - `delegate_to_jonin`
  - `delegate_to_anbu`
  - `delegate_to_chunin`
  - `delegate_to_tokubetsu_jonin`
  - `delegate_to_genin`
* **Type:** MCP Tool Aliases
* **Current Usage:** Removed in Batch 4.6 (commit 576e50b); previously listed in `src/mcp_tool_manifest.json` and router.
* **Canonical Replacement:** Direct agent tools (`sannin`, `kage`, `jonin`, `anbu`, `chunin`, `tokubetsu_jonin`, `genin`).
* **Internal Consumers:** None.
* **External Consumers:** Legacy prompt examples in older documentation.
* **Migration Required:** Completed in Batch 4.6 (commit 576e50b).
* **Removal Condition:** Satisfied in Batch 4.6.
* **Risk:** Low (already filtered out of live schemas; removed in Batch 4.6).
* **Status:** COMPLETED / REMOVED in Batch 4.6 (commit 576e50b). Catalog entry retained for historical tracking.

---

### Item 4: Agent Naming Syntax (`tokubetsu_jonin` vs `tokubetsu-jonin`)

* **Legacy Identifier:** `tokubetsu_jonin` (in code/MCP) vs `tokubetsu-jonin` (in filesystem/yaml)
* **Type:** Identifier Syntax Discrepancy
* **Current Usage:**
  - MCP tool: `tokubetsu_jonin` (JSON-RPC function naming convention prohibiting hyphens in certain schema validators).
  - Directory & Agent config: `tokubetsu-jonin` (`.agents/agents/tokubetsu-jonin/`, `tokubetsu-jonin-skill`).
* **Canonical Replacement:**
  - Agent Name: `tokubetsu-jonin`
  - MCP Tool Name: `tokubetsu_jonin`
* **Internal Consumers:** `src/agent_manager.js`, `src/mcp/tool_dispatch.js`, `src/workflow/kage-reviewer/sdlc_manager.js`.
* **External Consumers:** MCP host tool calls.
* **Resolution:** Canonicalize the bidirectional mapping `cleanAgentName(name) = name.replace(/_/g, '-')` in `src/agent_manager.js` and document this as standard protocol behavior.
* **Status:** Canonical mapping documented.

---

### Item 5: Legacy Disk Delegation Fallback (`task_dir`, `delegate.md`, `result.md`)

* **Legacy Identifier:** Disk-based scratch task directories
* **Type:** Execution Fallback
* **Current Usage:** Primary orchestration protocol is direct structured MCP argument passing (`task`, `context`, `constraints`, `skills`, `taste_dials`). If a client cannot pass structured arguments, `konoha.get_resolved_task_dir` resolves an isolated temporary scratch folder under `~/.konoha/tmp/<client>/<session>/scratch/tasks/<task_id>/`.
* **Canonical Replacement:** Direct structured MCP delegation.
* **Internal Consumers:** `src/mcp/memory_reporting.js`, `src/mcp/tool_dispatch.js`.
* **External Consumers:** Non-standard MCP host clients.
* **Resolution:** Retain strictly as an isolated fail-safe fallback outside the project workspace, ensuring it never touches the user's project repository.
* **Status:** Preserved as isolated fallback per architecture invariants.

---

### Item 6: Database File Alias (`skills.db` vs `konoha.db`)

* **Legacy Identifier:** `skills.db`
* **Type:** Database Filename
* **Current Usage:** Older installations used `~/.konoha/skills.db`. Konoha v2.0+ uses `~/.konoha/konoha.db`. `src/db.js` auto-migrates and falls back if `skills.db` exists.
* **Canonical Replacement:** `konoha.db`
* **Internal Consumers:** `src/db.js`.
* **External Consumers:** Existing user home directories with legacy data.
* **Migration Required:** Auto-rename on startup in `src/db.js`.
* **Removal Condition:** When all runtime references point exclusively to `konoha.db`.
* **Status:** Migration active and isolated.

---

### Item 7: 27 Removed Top-Level CLI Aliases

* **Legacy Identifiers:**
  - `embeddings`
  - `detect_ai`, `ai-detector`
  - `detect_docs`, `docs-detector`, `detect-doc`
  - `personas`, `persona`, `context`
  - `memories`, `memory`
  - `spirit`, `will-of-fire`
  - `projects`
  - `tasks`, `sdlc`
  - `web-search`, `searxng`
  - `inbox`
  - `install`, `setup`, `update`
  - `saving`
  - `agents`
  - `tg`
  - `tunnels`
  - `prune`
* **Type:** CLI Subcommand Aliases
* **Current Usage:** Completely removed from `bin/cli.js` in v2.1.18. Invoking any of these aliases now outputs `Unknown command: <name>` with `Run konoha help for usage.` and immediately exits with exit code 1.
* **Canonical Replacements:**
  - `embeddings` -> `konoha embed`
  - `detect_ai`, `ai-detector` -> `konoha detect-ai <path-file-or-url>`
  - `detect_docs`, `docs-detector`, `detect-doc` -> `konoha detect-docs <path-or-url>`
  - `personas`, `persona`, `context` -> `konoha agent <subcommand>`
  - `memories`, `memory` -> `konoha data <subcommand>` / MCP memory tools
  - `spirit`, `will-of-fire` -> `konoha soul`
  - `projects` -> `konoha project <subcommand>`
  - `tasks`, `sdlc` -> `konoha task <subcommand>`
  - `web-search`, `searxng` -> MCP `web_search`
  - `inbox` -> `konoha queue <subcommand>`
  - `install`, `setup` -> `konoha init`
  - `update` -> `konoha upgrade`
  - `saving` -> `konoha savings`
  - `agents` -> `konoha agent list`
  - `tg` -> `konoha telegram <subcommand>`
  - `tunnels` -> `konoha tunnel <subcommand>`
  - `prune` -> `konoha data prune --retention <days>`
* **Internal Consumers:** None.
* **External Consumers:** Legacy scripts and user shell history.
* **Status:** COMPLETED / REMOVED in v2.1.18. Strict canonical routing enforced.

