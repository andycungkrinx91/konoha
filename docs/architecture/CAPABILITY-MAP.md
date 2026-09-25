# Konoha Architecture Capability Map

**Document Version:** 1.0.0 (Konoha v2.0.1)  
**Date:** 2026-09-25  
**Status:** Canonical Reference  

---

## 1. Overview & System Blueprint

Konoha is a local-first MCP orchestration and intelligence platform for AI coding agents. It unifies context and skill retrieval, multi-client agentic delegation, project memory, and deterministic SDLC governance.

```text
                                KONOHA ARCHITECTURE
                                         │
        ┌────────────────────────────────┼────────────────────────────────┐
        │                                │                                │
  Intelligence                     Orchestration                      Governance
        │                                │                                │
  • Skill Retrieval (FTS5 + ONNX)  • Sannin Router                   • Definition of Ready (DoR)
  • Vector Search & Reranking      • 7 Subagents (Genin..Tokubetsu)  • Anti-Slop Quality Gate
  • Project Memory & Learnings     • Structured MCP Delegation       • Dual-Provider Review
  • Workspace Context              • Token Auto-Compaction           • Evidence Tracking & Remediation
  • Persona Memory                 • Task Checkpointing              • AI Fingerprint Detection
        │                                │                                │
        └────────────────────────────────┼────────────────────────────────┘
                                         │
                          Unified MCP Protocol Interface
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   │                                           │
             Local Runtime                               Coding Clients
         • SQLite (konoha.db)                        • Antigravity IDE/CLI
         • Web UI (SvelteKit 3 :1404)                • Cursor IDE/CLI
         • LLM Bridge Router (:19999)                • Claude Code
         • SearXNG Search Engine                     • OpenCode, Command Code
         • RTK Token Optimization                    • Codex, Pi (pi.dev)
```

---

## 2. Capability Catalog

### 2.1 Skill Discovery & Neural Retrieval

* **Purpose:** Resolve, search, rank, and load relevant skills and reference SOPs for agent execution.
* **Canonical Implementation:** `src/mcp/skills.js`, `src/vector_search.js`, `src/db.js`.
* **Entry Points:**
  - MCP Tools: `find_skill(keyword, limit?)`, `list_skills(limit?)`, `get_skill(name)`, `optimize_report(query)`.
  - CLI: `konoha migrate`, `konoha embed`, `konoha skill list`.
* **Consumers:** Sannin router, all 7 specialist subagents, external MCP clients.
* **Storage:** SQLite FTS5 (`skills` table in `~/.konoha/konoha.db`), ONNX embeddings in `assets/models/`.
* **Configuration:** `~/.konoha/mcp_config.json`, embedding model config in `src/vector_search.js`.
* **Tests:** `tests/test_skill_resolution.js`, `tests/test_vector_search.js`, `tests/test_fts5_sanitization.js`.
* **Documentation:** `docs/ARCHITECTURE.md`, `docs/ADDING-SKILLS.md`.
* **Dependencies:** `better-sqlite3`, `@xenova/transformers`, `tar`.
* **Token Optimization (ADR-0004):** Snippet-first search responses (~150 chars clean text vs 500 chars raw markdown, -32.3% payload reduction), intra-session search deduplication (`[LOADED]` badge on repeats, -38.4% reduction), and token-budgeted/section-targeted retrieval in `get_skill` (-87.1% reduction). See `docs/architecture/TOKEN-BASELINE.md`.
* **Known Legacy Paths:** `find_skills` (plural alias for `find_skill`).
* **Known Duplication:** Duplicate skill search wrapper `find_skills` in `src/mcp_tool_manifest.json` and `src/file_tools_router.js`.

---

### 2.2 Agent Orchestration & Subagent Delegation

* **Purpose:** Route user intent, assign domain tasks to specialized subagents, and checkpoint structured findings without disk read loops.
* **Canonical Implementation:** `src/mcp/tool_dispatch.js`, `src/agent_manager.js`, `src/agent_contract.js`.
* **Entry Points:**
  - MCP Tools: `sannin`, `genin`, `kage`, `chunin`, `jonin`, `anbu`, `tokubetsu_jonin`, `report_from_agent`.
  - CLI: `konoha agent list`, `konoha agent status`.
* **Consumers:** Antigravity IDE/CLI, Cursor, Claude Code, OpenCode, Command Code, Codex, Pi.
* **Storage:** Ephemeral process memory, task evidence in SQLite `sdlc_tasks`.
* **Configuration:** `~/.agents/agents.yaml`, managed agent contract headers in IDE rule files.
* **Tests:** `tests/test_structured_delegation.js`, `tests/test_agent_delegation.js`, `tests/test_cross_client_contract.js`.
* **Documentation:** `docs/ARCHITECTURE.md`, `GEMINI.md`.
* **Dependencies:** `js-yaml`, `better-sqlite3`.
* **Known Legacy Paths:** `delegate_to_sannin`, `delegate_to_kage`, `delegate_to_jonin`, `delegate_to_anbu`, `delegate_to_chunin`, `delegate_to_tokubetsu_jonin`, `delegate_to_genin`; legacy disk fallback `task_dir`, `delegate.md`, `result.md`.
* **Known Duplication:** Redundant `delegate_to_*` tool wrappers in manifest and router.

---

### 2.3 Bounded Safe File Operations

* **Purpose:** Provide bounded, line-limited, token-efficient file inspection without context exhaustion or IDE binary tampering.
* **Canonical Implementation:** `src/file_tools/` (`read_file_head.js`, `read_file_range.js`, `file_info.js`, `token_efficient_grep.js`, `get_file_structure.js`, `find_files_clean.js`), `src/file_tools_router.js`.
* **Entry Points:** MCP file tools (`read_file_head`, `read_file_range`, `file_info`, `token_efficient_grep`, `get_file_structure`, `find_files_clean`).
* **Consumers:** All subagents for bounded file reading and code exploration.
* **Storage:** Target project filesystem.
* **Configuration:** Invariant limits (max 200 lines, 8000 chars/line) hardcoded in `src/file_tools/common.js`.
* **Tests:** `tests/test_file_tools_router.js`, `tests/test_ide_directory_guard.js`, `tests/test_token_hygiene_and_platform.js`.
* **Documentation:** `docs/SETUP-IDE.md`, `docs/SETUP-CURSOR.md`.
* **Dependencies:** Node.js native `fs`, `path`.
* **Known Legacy Paths:** None.
* **Known Duplication:** None.

---

### 2.4 Multi-Archetype UI & Website Builder

* **Purpose:** Generate canonical UI structural specifications and layout contracts from text descriptions or design images.
* **Canonical Implementation:** `src/mcp/skills.js` (`handleBuildFromSource`, `handleBuildFromText`), `src/mcp/tool_dispatch.js`.
* **Entry Points:** MCP Tools `build_from_source`, `build_from_text`.
* **Consumers:** Jonin frontend builder subagent.
* **Storage:** Ephemeral JSON specification payload.
* **Configuration:** Taste-Skill dials, supported frameworks (Next.js, SvelteKit, Nuxt, Angular).
* **Tests:** `tests/test_build_workflows.js`, `tests/test_taste_skill_jonin.js`.
* **Documentation:** `docs/ARCHITECTURE.md`, `README.md`.
* **Dependencies:** Node.js native `fs`, `path`.
* **Known Legacy Paths:** `build_with_image_design` (legacy alias for `build_from_source`).
* **Known Duplication:** Duplicate manifest entry `build_with_image_design`.

---

### 2.5 Project Memory & Persistent Context

* **Purpose:** Persist verified architectural learnings, tech stack facts, and episodic memory across agent turns and sessions.
* **Canonical Implementation:** `src/project_memory.js`, `src/db.js`.
* **Entry Points:**
  - MCP Tools: `get_project_context`, `save_project_context`, `query_project_memory`.
  - Web API: `GET /api/v1/context`, `POST /api/v1/context`.
* **Consumers:** Main orchestrator, Sannin, Kage, Jonin, Anbu, Web UI.
* **Storage:** SQLite `project_memory` and `project_context` tables in `~/.konoha/konoha.db`.
* **Configuration:** Project root path mapping.
* **Tests:** `tests/test_project_memory_persistence.js`, `tests/test_memory_context_prune_and_web.js`.
* **Documentation:** `docs/ARCHITECTURE.md`.
* **Dependencies:** `better-sqlite3`.
* **Known Legacy Paths:** None.
* **Known Duplication:** None.

---

### 2.6 Persona Memory

* **Purpose:** Store, query, and manage user and agent persona preferences and traits.
* **Canonical Implementation:** `src/persona_memory.js`, `src/db.js`.
* **Entry Points:**
  - MCP Tools: `save_persona_memory`, `query_persona_memory`, `list_persona_memories`, `delete_persona_memory`.
  - Web API: `/api/v1/persona`.
* **Consumers:** Subagents, Web UI.
* **Storage:** SQLite `persona_memories` table.
* **Configuration:** Schema in `src/db.js`.
* **Tests:** `tests/test_persona_memory.js`.
* **Documentation:** `docs/ARCHITECTURE.md`.
* **Dependencies:** `better-sqlite3`.
* **Known Legacy Paths:** None.
* **Known Duplication:** None.

---

### 2.7 SDLC Governance & Quality Gates

* **Purpose:** Enforce Definition of Ready (DoR), dual-model independent code review, Zero-AI-Slop gating, remediation loops, and audit trails.
* **Canonical Implementation:** `src/sdlc_tasks.js`, `src/sdlc_manager.js`, `src/ai_detector.js`, `src/docs_ai_detector.js`, `src/mcp/workflow.js`.
* **Entry Points:**
  - MCP Tools: `check_readiness`, `get_task_evidence`, `get_slop_findings`, `website_ai_detector`, `docs_ai_detector`.
  - CLI: `konoha sdlc`.
  - Web API: `/api/v1/sdlc`.
* **Consumers:** Sannin router, Kage reviewer, Anbu builder, Web UI.
* **Storage:** SQLite `sdlc_tasks`, `sdlc_task_events`, `sdlc_task_evidence` tables.
* **Configuration:** Confidence threshold (`MINIMUM_CONFIDENCE = 98`), `.aislopignore`.
* **Tests:** `tests/test_sdlc_dor.js`, `tests/test_sdlc_tasks.js`, `tests/test_anti_slop_gate.js`, `tests/test_ai_detector.js`, `tests/test_docs_ai_detector.js`.
* **Documentation:** `docs/ARCHITECTURE.md`, `docs/SecurityCompliance/`.
* **Dependencies:** `better-sqlite3`, `aislop` CLI.
* **Known Legacy Paths:** None.
* **Known Duplication:** None.

---

### 2.8 LLM Bridge Gateway & Router

* **Purpose:** Route, proxy, and multiplex LLM requests across OpenAI, local endpoints, and Antigravity IDE sidecars on port 19999.
* **Canonical Implementation:** `src/bridge/gateway.js`, `src/bridge/server.js`, `src/bridge/manager.js`.
* **Entry Points:**
  - HTTP Server: `http://127.0.0.1:19999/v1/chat/completions`.
  - CLI: `konoha bridge list`, `konoha bridge status`, `konoha bridge enable`, `konoha bridge disable`.
* **Consumers:** External MCP clients, local AI tools.
* **Storage:** SQLite `bridges` table in `~/.konoha/konoha.db`.
* **Configuration:** Port bindings, provider credentials.
* **Tests:** `tests/test_bridge_gateway.js`, `tests/test_antigravity_bridge_contract.js`.
* **Documentation:** `docs/LLM-BRIDGE-GATEWAY.md`.
* **Dependencies:** Node.js native `http`, `net`, `dgram`.
* **Known Legacy Paths:** None (stable finalized subsystem; zero-modification invariant).
* **Known Duplication:** None.

---

### 2.9 Zero-API-Key Web Search

* **Purpose:** Query search engines via local or public SearXNG instances without tracking or API keys.
* **Canonical Implementation:** `src/searxng.js`.
* **Entry Points:**
  - MCP Tool: `web_search(query, category?)`.
  - CLI: `konoha search <query>`.
* **Consumers:** Chunin intel researcher subagent.
* **Storage:** Ephemeral results.
* **Configuration:** `SEARXNG_URL` env var, fallback public instance list.
* **Tests:** `tests/test_web_search.js`.
* **Documentation:** `docs/SETUP-SEARXNG.md`.
* **Dependencies:** Node.js native `fetch` / `http`.
* **Known Legacy Paths:** None.
* **Known Duplication:** None.

---

### 2.10 Token Savings Telemetry

* **Purpose:** Quantify token reduction and cost savings from bounded tool operations and Semble search.
* **Canonical Implementation:** `src/db_savings.js`, `src/tools_savings_logger.js`.
* **Entry Points:**
  - CLI: `konoha savings`.
  - Web API: `GET /api/v1/savings`.
* **Consumers:** CLI TUI, SvelteKit Web UI.
* **Storage:** SQLite `savings` table.
* **Configuration:** Baseline constant (2065 KB baseline sizing).
* **Tests:** `tests/test_token_hygiene_and_platform.js`.
* **Documentation:** `docs/BENCHMARK.md`.
* **Dependencies:** `better-sqlite3`.
* **Workflow Artifact Optimization (ADR-0004):** In addition to bounded file tool telemetry (83%–98% savings on repo reads), the 8-phase workflow enforces path-referenced summaries in `final_report.md` and bounded planning findings in `delegate.md`, reducing end-to-end task artifact tokens from 759.3 to 630.7 tokens/task (-16.9% artifact footprint reduction verified in `docs/architecture/TOKEN-BASELINE.md`).
* **Known Legacy Paths:** None (stable finalized telemetry invariant).
* **Known Duplication:** None.

---

### 2.11 Multi-Client Lifecycle & Contract Enforcement

* **Purpose:** Scaffolding, configuration management, and invariant enforcement across 7 supported IDE/CLI environments.
* **Canonical Implementation:** `src/antigravity_manager.js`, `src/cursor_manager.js`, `src/mcp_clients_manager.js`, `src/opencode_manager.js`, `src/codex_manager.js`, `src/pi_manager.js`, `src/agent_contract.js`.
* **Entry Points:**
  - CLI: `konoha init`, `konoha doctor`.
  - Web API: `POST /api/v1/clients/:id/setup`, `POST /api/v1/clients/:id/remove`.
* **Consumers:** Antigravity, Cursor, Claude Code, OpenCode, Command Code, Codex, Pi.
* **Storage:** Editor configuration files (`mcp.json`, `rules`, `hooks`).
* **Configuration:** Managed contracts embedded between `<!-- KONOHA-CONTRACT-START -->` and `<!-- KONOHA-CONTRACT-END -->`.
* **Tests:** `tests/test_cross_client_contract.js`, `tests/test_client_disconnect_and_bridge_scope.js`.
* **Documentation:** `docs/SETUP-IDE.md`, `docs/SETUP-CURSOR.md`, `docs/SETUP-MCP-CLIENTS.md`.
* **Dependencies:** Node.js native `fs`, `path`.
* **Known Legacy Paths:** None.
* **Known Duplication:** None.

---

### 2.12 Administrative Web Dashboard

* **Purpose:** Visual administration of agents, skills, SDLC tasks, bridges, clients, savings, and diagnostics.
* **Canonical Implementation:** `src/web_server.js`, `apps/web/`.
* **Entry Points:**
  - CLI: `konoha ui start`, `konoha ui status`, `konoha ui stop`.
  - HTTP Server: `http://127.0.0.1:1404`.
* **Consumers:** Developers, administrators.
* **Storage:** Ephemeral session tokens, CSRF tokens.
* **Configuration:** `src/web_server.js` port 1404.
* **Tests:** `tests/test_web_ui.js`.
* **Documentation:** `docs/SETUP-WEB-UI.md`.
* **Dependencies:** SvelteKit 3, Vite, Tailwind CSS v4.
* **Known Legacy Paths:** None.
* **Known Duplication:** None.
