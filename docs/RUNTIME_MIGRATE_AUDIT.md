# RUNTIME_MIGRATE_AUDIT.md
## Konoha — Single-Runtime Migration Audit Report (Phase 0)

**Date:** 2026-09-08  
**Author:** Antigravity Orchestrator (Konoha Core Team)  
**Status:** Completed & Verified  

---

### 1. Python Files Inventory

Total `.py` files in codebase: **79**
- `src/` core runtime: **13** modules
- `src/file_tools/`: **7** scripts
- `src/templates/skills/genin-skill/scripts/`: **10** files (preserved skill template assets under Strict Skill Protection Invariant)
- `scripts/`: **7** offline asset generator scripts
- `tests/`: **42** test scripts and harnesses

#### A. Core Runtime (`src/`)

| File | Purpose | Public Functions / Entry Points | Callers in Node | Spawning Mechanism |
|---|---|---|---|---|
| `src/db.py` | Canonical SQLite access layer (schema DDL, WAL, FTS5, connection factory) | `get_connection(db_path, load_vector)`, `setup_schema(conn)` | Indirect via Python scripts; `bin/cli.js` checks schema via CLI commands | Subprocess via Python scripts |
| `src/db_agents.py` | SQLite CRUD & YAML parsing for agents table | `--list`, `--get <name>`, `--upsert <file>`, `--delete <name>`, `load_agents_from_yaml()` | `src/agent_manager.js`, `bin/cli.js` | `spawnPythonSync` / `spawnSync` |
| `src/db_bridges.py` | SQLite CRUD for LLM bridge proxy servers | `--list`, `--get <name>`, `--upsert <name>`, `--delete <name>`, `--toggle <name>` | `src/file_tools_mcp.js`, `bin/cli.js` | `spawnPythonSync` / `spawnSync` |
| `src/db_savings.py` | Token & byte savings metrics calculation | `get_savings_summary()`, `get_daily_savings()`, `get_all_time_savings()` | `bin/cli.js` (`konoha savings`) | `spawnPythonSync` |
| `src/db_stats.py` | Helper script returning skills count and byte stats as JSON | CLI script: `python db_stats.py [db_path]` | `bin/cli.js` (`konoha status`) | `spawnPythonSync` |
| `src/persona_memory.py` | Persona episodic memory storage and FTS5 search | `save_persona_memory()`, `query_persona_memory()`, `list_persona_memories()`, `delete_persona_memory()` | `src/server.py` via MCP tools | In-process in `server.py` |
| `src/tools_savings_logger.py` | Logs tool invocations and calculates token savings vs baseline | `log_tool_call(tool, query, returned_bytes, agent, client)` | `src/file_tools_mcp.js`, `src/server.py` | `spawn(PYTHON_CMD, [SAVINGS_LOGGER, ...])` |
| `src/migrate.py` | Scans skill directories, strips frontmatter/comments, chunks, and writes to SQLite | `migrate()`, `_migrate_skill()`, `optimize_content()`, `chunk_document()` | `bin/cli.js` (`konoha migrate`), `src/server.py` (`auto_migrate_project_skills`) | `spawnPython` / `spawnPythonSync` / in-process in `server.py` |
| `src/vector_search.py` | ONNX embeddings, GTE cross-encoder reranking, RRF hybrid search | `hybrid_search()`, `generate_embedding()`, `rerank()`, `load_vector_extension()` | `src/server.py`, `src/migrate.py` | In-process in `server.py` |
| `src/server.py` | MCP tool logic (38 tools: build specs, delegation, search, memory) | CLI entry point: `--tool <name> <json_args>` | `src/file_tools_router.js` (`runPythonSkillTool`) | `spawnSync(python, [server.py, '--tool', tool, json])` |
| `src/circuit_breaker.py` | Delegation loop & depth counter | `check_circuit_breaker()`, `increment_depth()`, `reset_breaker()` | `src/server.py` | In-process in `server.py` |
| `src/agent_stats.py` | Agent usage statistics aggregator | `get_agent_stats()`, `record_agent_invocation()` | `src/server.py` | In-process in `server.py` |
| `src/yaml_parser.py` | Custom Python YAML parser | `parse_yaml()`, `safe_load()` | `src/db_agents.py` | In-process in `db_agents.py` |

#### B. File Tools Workers (`src/file_tools/`)

| File | Purpose | Public Entry Point | Caller in Node | Spawning Mechanism |
|---|---|---|---|---|
| `_common.py` | Path validation, dev_root allow-list, workspace containment check | `assert_within_allowed(path, workspace, dev_root)` | Used by all 6 file tools below | Python module import |
| `read_file_head.py` | Bounded file head reader (max 200 lines) | Stdin JSON piping: `{"path": ..., "max_lines": ...}` | `src/file_tools_router.js: readFileHead` | `spawnSync(python, [read_file_head.py, '-'], {input})` |
| `read_file_range.py` | Bounded line range reader (max 500 lines) | Stdin JSON piping: `{"path": ..., "start_line": ..., "end_line": ...}` | `src/file_tools_router.js: readFileRange` | `spawnSync(python, [read_file_range.py, '-'], {input})` |
| `file_info.py` | File metadata inspection (size, mtime, line count) | Stdin JSON piping: `{"path": ...}` | `src/file_tools_router.js: fileInfo` | `spawnSync(python, [file_info.py, '-'], {input})` |
| `token_efficient_grep.py`| Bounded ripgrep/regex search (max 20 matches, cap 50) | Stdin JSON piping: `{"path": ..., "pattern": ...}` | `src/file_tools_router.js: tokenEfficientGrep` | `spawnSync(python, [token_efficient_grep.py, '-'], {input})` |
| `get_file_structure.py` | Bounded directory tree structure | Stdin JSON piping: `{"path": ...}` | `src/file_tools_router.js: getFileStructure` | `spawnSync(python, [get_file_structure.py, '-'], {input})` |
| `find_files_clean.py` | Bounded glob file discovery | Stdin JSON piping: `{"dir": ..., "pattern": ...}` | `src/file_tools_router.js: findFilesClean` | `spawnSync(python, [find_files_clean.py, '-'], {input})` |

---

### 2. MCP Server Process Registration & Topology

- **Registered MCP Process:** In all 6 coding clients (Antigravity `mcp_config.json`, Cursor `mcp.json`, Claude Code `.claude.json`, OpenCode `opencode.json`, Command Code `mcp.json`, Codex `config.toml`), the registered MCP server is:
  ```json
  "konoha": {
    "command": "node",
    "args": ["/home/andycungkrinx/.konoha/file_tools_mcp.js"]
  }
  ```
  *(or `file_tools_launcher.js` / launcher wrapper)*.
- **Topology Analysis:**
  - `file_tools_mcp.js` is **already the single MCP stdio transport process**.
  - `file_tools_mcp.js` requires `file_tools_router.js`.
  - `file_tools_router.js` handles:
    - 6 file tools by spawning `src/file_tools/<tool>.py` via stdin JSON.
    - 32 other MCP tools by spawning `src/server.py --tool <toolName> <args>` via `runPythonSkillTool`.
  - **Critical Architectural Confirmation:** There are NOT two separate MCP server processes. Phase 5 does NOT require changing the transport or client registration! Porting `server.py` and `file_tools/*.py` into pure Node.js functions allows `file_tools_router.js` to dispatch **100% in-process** via direct JavaScript function calls. This eliminates all subprocess spawns, child_process latency, and JSON serialization overhead entirely.

---

### 3. Python Dependency Footprint

- **Base Server & File Tools:** 100% Python standard library only (`sqlite3`, `json`, `os`, `sys`, `hashlib`, `re`, `shutil`, `urllib`, `platform`, `typing`, `dataclasses`).
- **Vector Search (`src/vector_search.py`):**
  - Top-level import: `import numpy as np` (used for fallback vector math / cosine similarity).
  - Lazy dynamic imports (only triggered when semantic vector search is actively executed):
    - `from huggingface_hub import hf_hub_download`
    - `import onnxruntime as ort`
    - `from tokenizers import Tokenizer`
- **Node.js Target Footprint:**
  - `better-sqlite3`: Replaces `sqlite3` stdlib with synchronous, high-performance WAL+FTS5 SQLite access.
  - `@huggingface/transformers`: Replaces `onnxruntime`, `tokenizers`, `huggingface_hub`, and `numpy` in a single package bundling WASM ONNX Runtime with zero native compiler dependencies.
  - Pure JS cosine similarity & RRF fusion: Eliminates `numpy`.

---

### 4. Live SQLite Schema Verification

Inspected live SQLite schema via `src/db.py:setup_schema()` and `skills.db`:
- **Tables (8):**
  1. `skills` (name, skill_name, type, tags, content, file_path, byte_size, line_count)
  2. `skill_chunks` (id, skill_name, chunk_index, chunk_text, embedding)
  3. `tool_calls` (id, timestamp, tool, query, returned_bytes, total_library_bytes, bytes_saved, tokens_saved, agent, client)
  4. `active_sessions` (client, workspace_root, session_id, transcript_path, last_active_at)
  5. `agents` (name, icon, title, model_tier, purpose, skills, delegate_when, constraints_text, workflow, description, instructions, delegation_keywords, cursor_fallback_model, enable_mcp_tools)
  6. `bridges` (name, port, provider, enabled, target_url, api_key)
  7. `projects` (project_hash, project_path, project_name, framework, styling, package_manager, context_summary, tech_stack, created_at, updated_at)
  8. `persona_memories` (id, project_hash, agent_name, memory_type, title, content, tags, importance, created_at, updated_at)
- **Virtual FTS5 Tables (2):**
  1. `skills_fts` (content='skills', sync triggers: `skills_ai`, `skills_ad`, `skills_au`)
  2. `persona_memories_fts` (content='persona_memories')
- **Indexes (10):**
  - `idx_skills_type`, `idx_skills_skill_name`, `idx_skill_chunks_skill`, `idx_tool_calls_agent`, `idx_tool_calls_client`, `idx_tool_calls_timestamp`, `idx_projects_path`, `idx_mem_agent`, `idx_mem_type`, `idx_mem_project`.

---

### 5. Registered MCP Tools (39 Tools)

Introspected from `src/mcp_tool_manifest.json`:
1. `read_file_head`
2. `read_file_range`
3. `file_info`
4. `token_efficient_grep`
5. `get_file_structure`
6. `find_files_clean`
7. `get_resolved_task_dir`
8. `find_skill`
9. `find_skills` (alias for `find_skill`)
10. `list_skills`
11. `get_skill`
12. `optimize_report`
13. `build_with_image_design`
14. `build_from_source`
15. `build_from_text`
16. `sannin`
17. `kage`
18. `jonin`
19. `anbu`
20. `chunin`
21. `tokubetsu_jonin`
22. `genin`
23. `delegate_to_sannin`
24. `delegate_to_kage`
25. `delegate_to_jonin`
26. `delegate_to_anbu`
27. `delegate_to_chunin`
28. `delegate_to_tokubetsu_jonin`
29. `delegate_to_genin`
30. `report_from_agent`
31. `get_project_context`
32. `save_project_context`
33. `query_project_memory`
34. `web_search`
35. `migrate_skills`
36. `save_persona_memory`
37. `query_persona_memory`
38. `list_persona_memories`
39. `delete_persona_memory`

---

### 6. Existing Test Suites Inventory

`tests/run_all.js` discovers:
- **23 JS test suites**:
  `agent_manager.test.js`, `test_antigravity_bridge_contract.js`, `test_audit_regressions.js`, `test_bridge_gateway_model_rewrite.js`, `test_cli_help_contract.js`, `test_client_skill_loading.js`, `test_codex_manager.js`, `test_cross_client_config.js`, `test_cross_client_contract.js`, `test_file_tools_router.js`, `test_file_tools_router_errors.js`, `test_hook_base.js`, `test_ide_directory_guard.js`, `test_mcp_e2e.js`, `test_mcp_protocol.js`, `test_migrate_fallback.test.js`, `test_no_filesystem_mirrors.js`, `test_project_skills_auto_migrate.test.js`, `test_prompt_hook.js`, `test_python_spawn_cross_platform.test.js`, `test_skill_embed_cli.test.js`, `test_yaml_utils.js`, `verify_paths.js`.
- **40 Python test suites**:
  `test_agent_attribution.py`, `test_agent_delegation.py`, `test_anti_slop_gate.py`, `test_auto_compaction.py`, `test_bridge_gateway.py`, `test_build_workflows.py`, `test_circuit_breaker.py`, `test_claude_attribution.py`, `test_cli_project_commands.py`, `test_commandcode_and_argument_aliases.py`, `test_commandcode_attribution.py`, `test_cross_platform.py`, `test_cursor_attribution.py`, `test_database_migration.py`, `test_db_consolidation.py`, `test_delegation_chain.py`, `test_docs_currency.py`, `test_documentation_diagrams.py`, `test_embedding_deduplication.py`, `test_fts5_sanitization.py`, `test_genin_skill_contract.py`, `test_kage_reviewer_workflow.py`, `test_maintenance_skill_contract.py`, `test_mcp_subagent_contract.py`, `test_opencode_attribution.py`, `test_orchestration_pipeline.py`, `test_persona_memory.py`, `test_project_memory_persistence.py`, `test_rtk_cross_client.py`, `test_schema_integrity.py`, `test_scratch_path.py`, `test_skill_resolution.py`, `test_skill_tree_parity.py`, `test_structured_delegation.py`, `test_subagent_mcp_block.py`, `test_taste_skill_jonin.py`, `test_vector_search.py`, `test_web_search.py`, `test_workflow_gates.py`, `test_workflow_loop.py`.

---

### 7. Runtime Constraints & Node Version Decision Point

- `package.json` specifies `"engines": { "node": ">=18.0.0" }`.
- Current host runtime is Node v26.5.1 with pnpm 10.8.0.
- All target packages (`better-sqlite3`, `@huggingface/transformers`) run cleanly on Node >= 18 through Node 26.
- Zero-regression policy: All CLI commands, MCP tool signatures, and database structures remain strictly preserved.

---

### 8. Audit Conclusion & Plan Adjustments

The audit validates all assumptions in `PLAN_RUNTIME_MIGRATE.md` with one key clarification:
- **Clarification on MCP Process:** The MCP transport is already unified in `file_tools_mcp.js`. Porting `server.py` and `file_tools/*.py` to Node will not require creating a new MCP transport process or reconfiguring client configs — `file_tools_mcp.js` and `file_tools_router.js` will simply call the ported JS modules directly in-process. This simplifies Phase 5 and removes risk of client config disruption.
