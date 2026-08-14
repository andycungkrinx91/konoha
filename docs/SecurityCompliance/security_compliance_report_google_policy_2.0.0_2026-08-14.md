# Security and Compliance Review: Konoha Project [v2.0.0]

## Executive Summary

This Google Policy Compliance v1.1.7 review audits Konoha v2.0.0 after the cross-client MCP integration, canonical `genin-skill` routing, fresh-install verification, documentation diagram updates, and repository-hygiene changes. The review covers interactive setup boundaries, MCP tool permissions, workspace/task isolation, skill migration integrity, client auto-setup behavior, bridge security boundaries, and documentation/test currency.

**Overall outcome:** PASS for the controls reviewed. The Draw.io desktop CLI was unavailable in the review environment, so rendered visual export was not assessed; editable XML passed structural validation.

## Findings

### 1. Interactive Installation and Client Consent

- **Action Verified:** `bin/cli.js` `cmdInit()` retains the explicit initialization consent flow and configures only detected clients. Missing optional clients are skipped rather than treated as installation failures.
- **Impact:** Client configuration changes remain bounded to the initialization flow and partial environments do not require unsupported clients to be present.

### 2. MCP Tool Boundary Enforcement

- **Action Verified:** `src/agent_manager.js`, `src/cursor_manager.js`, `src/mcp_clients_manager.js`, and `src/search_policy.js` generate rules that route skill lookup through Konoha MCP and code search through Semble MCP. Native file/search bypasses remain prohibited by the generated policies and hooks.
- **Impact:** All supported clients use the same controlled MCP surfaces for skill retrieval, bounded file reads, and semantic code discovery.

### 3. Canonical Genin Skill Routing

- **Action Verified:** `src/templates/skills/genin-skill/` is the canonical source; packaged `.agents/skills/` and Cursor deployment metadata use `genin-skill`. `src/agent_manager.js`, `src/migrate.py`, and `src/server.py` preserve `deep-code-explorer` normalization only for legacy upgrades. Fresh installation requires and verifies a `genin-skill` SQLite row.
- **Impact:** New installations cannot silently seed an obsolete exploration skill, while existing installations retain an upgrade path without exposing legacy metadata as current routing.

### 4. Skill Migration and SQLite Integrity

- **Action Verified:** `src/migrate.py` supports clean migration, deterministic canonical precedence for legacy collisions, required-skill assertions, and removal of stale legacy rows. `tests/test_genin_skill_contract.py` exercises migration, collision handling, and required canonical seeding.
- **Impact:** Skill content remains indexed in the SQLite FTS5 runtime source without duplicate legacy identities or silent missing-skill installation states.

### 5. Cross-Client Auto-Setup Contract

- **Action Verified:** `src/antigravity_manager.js`, `src/cursor_manager.js`, `src/mcp_clients_manager.js`, `src/opencode_manager.js`, and the CLI setup path are verified by `tests/test_client_skill_loading.js` for Antigravity CLI/IDE, Cursor, Claude Code, OpenCode, and Command Code. Generated instructions preserve `genin-skill` and expose Konoha MCP `find_skill`/`get_skill` loading.
- **Impact:** Supported clients receive a consistent skill-loading contract and do not depend on a physical `deep-code-explorer` folder.

### 6. Workspace and Task Isolation

- **Action Verified:** `src/server.py` resolves task directories under the Konoha-managed temporary root, and `tests/test_scratch_path.py` verifies that delegated artifacts do not default to project workspace paths. Repository cleanup removed generated task trash after validation.
- **Impact:** Delegation artifacts such as `delegate.md` and `result.md` remain outside normal project source paths, reducing accidental commits and workspace contamination.

### 7. Bridge Gateway Security Boundary

- **Action Verified:** `src/bridge/gateway.js` and related handlers retain local gateway routing on port `19999`, inbound credential/header sanitization, response model rewriting, request validation, and single-bridge request routing. The architecture documentation distinguishes request-time bridge selection from sidecar-internal retries.
- **Impact:** Credentials remain at the outbound bridge boundary, while the gateway does not claim or perform unsupported global 429 round-robin failover.

### 8. Professional Diagram and Documentation Integrity

- **Action Verified:** `docs/diagrams/konoha-architecture.drawio` contains eight editable pages. Mermaid companion diagrams are restored in `README.md`, `docs/ARCHITECTURE.md`, `docs/LLM-BRIDGE-GATEWAY.md`, `docs/SETUP-SEARXNG.md`, and `docs/ADDING-SKILLS.md`. Draw.io routing uses explicit ports and verified waypoints for dense hubs.
- **Impact:** Architecture documentation remains editable, Markdown-renderable, semantically synchronized, and less prone to misleading arrow overlap.

### 9. Repository Hygiene After Fixes

- **Action Verified:** The developer-only Konoha maintenance skill requires reference audits and cleanup of obsolete patch/fix/revert scripts, debug output, caches, and transient task directories while preserving production code, official tests, deployment artifacts, local configuration, and legacy compatibility.
- **Impact:** Maintenance work leaves the repository free of confirmed historical noise without deleting operational or compatibility assets.

### 10. Verification Evidence

- **Action Verified:** `pnpm test` completed with **30 suites passed and 0 failed**. Focused Genin, client-loading, documentation, Mermaid synchronization, and Draw.io XML tests passed. The bundled Draw.io validator reported **0 errors, 0 warnings, 0 through-vertex routes, 0 crossings, and 0 overlaps**.
- **Impact:** The reviewed controls are backed by repeatable repository tests and structural diagram validation rather than documentation claims alone.

## Conclusion

Konoha v2.0.0 passes the Google Policy Compliance v1.1.7 review for the controls examined. The cross-client MCP contract, canonical Genin skill routing, migration checks, sandbox/task isolation, bridge security boundary, documentation synchronization, and repository cleanup policy are implemented and regression-tested. Rendered Draw.io export could not be assessed because the Draw.io desktop CLI was unavailable; the editable Draw.io XML itself passed structural validation.
