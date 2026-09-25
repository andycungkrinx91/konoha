# Konoha Architecture Legacy and Alias Inventory

**Document Version:** 1.0.0 (Konoha v2.0.1)  
**Date:** 2026-09-25  
**Status:** Canonical Audit  

---

## 1. Inventory Summary

This audit catalogs all historical aliases, shims, compatibility fallbacks, and duplicated interfaces across the Konoha repository.

| Identifier | Classification | Type | Canonical Target | Action Plan |
|---|---|---|---|---|
| `find_skills` | **MIGRATE_THEN_REMOVE** | MCP tool alias | `find_skill` | Migrate client instructions and router; deprecate alias |
| `build_with_image_design` | **MIGRATE_THEN_REMOVE** | MCP tool alias | `build_from_source` | Remove from manifest and router schemas |
| `delegate_to_<agent>` (7 tools) | **MIGRATE_THEN_REMOVE** | MCP tool aliases | Direct agent tools (`sannin`, `kage`, etc.) | Remove duplicate schema listings |
| `tokubetsu_jonin` vs `tokubetsu-jonin` | **CANONICAL_MAPPING** | Identifier syntax | `tokubetsu-jonin` (agent) / `tokubetsu_jonin` (MCP tool) | Maintain strict 1:1 bidirectional normalizer |
| `task_dir` / `delegate.md` / `result.md` | **ISOLATED_FALLBACK** | File-based fallback | Direct structured MCP argument passing | Keep isolated in `~/.konoha/tmp/` for non-MCP fallback |
| `skills.db` | **MIGRATE_THEN_REMOVE** | Storage filename | `konoha.db` | Auto-migrate legacy DB file on startup |
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
* **Status:** Scheduled for canonicalization in Phase 4.

---

### Item 2: `build_with_image_design` (Image-to-UI Specification Alias)

* **Legacy Identifier:** `build_with_image_design`
* **Type:** MCP Tool Alias
* **Current Usage:** Listed in `src/mcp_tool_manifest.json`, filtered in `DEPRECATED_LEGACY_TOOL_NAMES` in `src/file_tools_router.js`, dispatched identically to `build_from_source`.
* **Canonical Replacement:** `build_from_source`
* **Internal Consumers:** None.
* **External Consumers:** Historical documentation and test snapshots.
* **Migration Required:** Update documentation and test references; prune from tool manifest.
* **Removal Condition:** Tests and client schemas updated.
* **Risk:** Very Low (already excluded in `listToolSchemas()`).
* **Status:** Scheduled for pruning.

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
* **Current Usage:** Listed in `src/mcp_tool_manifest.json`, forwarded to `runNodeSkillTool` in `src/file_tools_router.js`, marked deprecated in `DEPRECATED_LEGACY_TOOL_NAMES`.
* **Canonical Replacement:** Direct agent tools (`sannin`, `kage`, `jonin`, `anbu`, `chunin`, `tokubetsu_jonin`, `genin`).
* **Internal Consumers:** None.
* **External Consumers:** Legacy prompt examples in older documentation.
* **Migration Required:** Ensure all client templates use direct agent tool calls; prune alias entries from manifest.
* **Removal Condition:** Zero internal/client references.
* **Risk:** Low (already filtered out of live schemas via `DEPRECATED_LEGACY_TOOL_NAMES`).
* **Status:** Ready for canonical removal.

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
* **Internal Consumers:** `src/agent_manager.js`, `src/mcp/tool_dispatch.js`, `src/sdlc_manager.js`.
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
