# Database Schema & Codebase Consistency Audit — 2026-11-09

Scope: `konoha.db` (main store) and `lab.db` (Akatsuki Lab store). App version 2.2.19, schema version 5.

Every number below was produced in this environment (Linux x64) from two databases:

| DB | How built | Path |
|----|-----------|------|
| Fresh | `runTransactionalDatabaseMigration()` → `setupSchema` + `seedSoulArchetypes` in a temp `KONOHA_HOME` | `/tmp/konoha-schema-audit/home/.konoha/konoha.db` |
| Live copy | `VACUUM INTO` from a read-only connection to the live DB | `/tmp/konoha-schema-audit/live-copy.db` |

The live DB was never opened for writing during this audit. No `VACUUM`, `ALTER`, or `DELETE` ran against it.

## 1. Architecture discovery

Two stores, no shared connection, no shared migration, no shared backup.

| Store | Path resolver | Schema owner | Connection opener |
|-------|---------------|--------------|-------------------|
| Main | `KONOHA_DB_PATH` → `~/.konoha/konoha.db` (`src/db.js#getDbPath`) | `src/db_schema.js#setupSchema` | `src/db.js#getConnection` |
| Lab | `KONOHA_LAB_DB_ROOT` + `lab.db`, or `KONOHA_AKATSUKI_LAB_DB` | `src/workflow/akatsuki/lab_db.js#setupLabSchema` | `src/workflow/akatsuki/lab_db.js#openLabDb` → `src/db.js#openRawConnection` |

`getConnection` throws `LAB_DB_ISOLATION_VIOLATION` on a lab path. `openLabDb` calls `assertLabDbPath` before opening. `openRawConnection` applies pragmas only — no legacy skills migration, no vector setup, no `KONOHA_DB_PATH` inheritance.

One extension-owned virtual table (`_sqliteai_vector`) and three FTS5 shadow-table families (`skills_fts_*`, `persona_memories_fts_*`, `code_chunks_fts_*`) exist in the main store. The lab store has four tables and no FTS.

> **Revision note (schema v7, Issue #13).** The measurements in Sections 2, 4, and 9 were updated after the code-intelligence v6/v7 migrations added seven declared tables (`code_index_roots`, `code_files`, `code_symbols`, `code_refs`, `code_chunks`, `code_chunks_fts`, `code_edges`), their four FTS5 shadow tables, and additive v7 incremental/graph columns. Fresh and migrated-live object counts now agree at 44 user tables (43 base DDL tables excluding runtime `_sqliteai_vector`).

## 2. Full schema inventory

Measured objects:

| Store | user tables | indexes | named indexes | triggers | views |
|-------|-------------|---------|---------------|----------|-------|
| Fresh (v7) | 44 | 73 | 41 | 9 | 0 |
| Live copy, migrated to v7 | 44 | 73 | 41 | 9 | 0 |

Pre-v6 the same figures were 33 / 58 / 31 / 6 fresh. The v6+v7 code-intelligence delta adds +11 tables (6 ordinary, 1 virtual, 4 shadow), +15 indexes (10 named `idx_code_*`, 5 autoindexes from `UNIQUE` constraints), and +3 triggers (`code_chunks_ai/ad/au`).

`kali_tools` and its `idx_kali_tools_*` / autoindex set are gone from the live copy: the main store and the fresh store now hold identical table sets. `_sqliteai_vector` is present in both files as extension-owned state.

Triggers (all FTS5 sync, both stores' main side only):

`skills_ai`, `skills_ad`, `skills_au`, `persona_memories_ai`, `persona_memories_ad`, `persona_memories_au`, `code_chunks_ai`, `code_chunks_ad`, `code_chunks_au`.

### Foreign keys

| From | To | On delete |
|------|----|-----------|
| `skill_chunks.skill_name` | `skills.name` | CASCADE |
| `asset_files.asset_id` | `assets.asset_id` | CASCADE |
| `assets.job_id` | `generation_jobs.job_id` | RESTRICT |
| `llm_requests_3d.job_id` | `generation_jobs.job_id` | CASCADE |
| `validation_results.asset_id` | `assets.asset_id` | SET NULL |
| `validation_results.job_id` | `generation_jobs.job_id` | CASCADE |
| `persona_memories.project_hash` | `projects.project_hash` | CASCADE |

Lab store FKs: `lab_tool_invocations.run_id → lab_runs.id`, `red_skill_audit.run_id → lab_runs.id`.

### Indexes with named constraints

`idx_skills_skill_name`, `idx_skills_type`, `idx_skill_chunks_skill`,
`idx_persona_memories_agent_proj`, `idx_mem_session`, `idx_mem_project`, `idx_mem_type`, `idx_mem_agent`,
`idx_sdlc_tasks_status_updated`, `idx_sdlc_tasks_updated`, `idx_sdlc_tasks_client`, `idx_sdlc_tasks_session`, `idx_sdlc_tasks_project`, `idx_sdlc_tasks_status`,
`idx_tool_calls_timestamp`, `idx_tool_calls_client`, `idx_tool_calls_agent`,
`idx_active_sessions_last_active`, `idx_active_sessions_client`, `idx_active_sessions_ws`,
`idx_assets_status`, `idx_assets_created`, `idx_asset_files_asset`,
`idx_gen_jobs_created`, `idx_gen_jobs_status`, `idx_llm_requests_3d_created`, `idx_llm_requests_3d_job`,
`idx_validation_job`, `idx_projects_path`, `idx_prompt_queue_created`, `idx_prompt_queue_status`,
`idx_code_files_root`, `idx_code_files_lang`, `idx_code_symbols_name`, `idx_code_symbols_file`,
`idx_code_refs_target`, `idx_code_refs_file`, `idx_code_chunks_root`, `idx_code_chunks_reuse`,
`idx_code_edges_src`, `idx_code_edges_dst`.

`sqlite_sequence` exists in both stores because two tables use `AUTOINCREMENT`:

| Table | `seq` (live) |
|-------|--------------|
| `skill_chunks` | 20224 |
| `tool_calls` | 2072 |

`skill_chunks.seq` (20224) exceeds its live row count (8258) because re-indexing deletes and re-inserts chunks; `sqlite_sequence` never decreases. No defect — monotonic IDs are the intent.

## 3. Source ↔ schema mapping

| Table | DDL source | Writers | Readers | State |
|-------|-----------|---------|---------|-------|
| `skills` | `src/db_schema.js:255` | `src/migrate.js`, `src/mcp/skills_search.js` | `src/mcp/skills_retrieval.js`, `bin/commands/agent*.js` | Live |
| `skill_chunks` | `src/db_schema.js:266` | `src/migrate.js`, `src/mcp/skills_search.js` | `src/vector_search.js`, `src/web/controllers/core_controller.js` | Live |
| `persona_memories` | `src/db_schema.js:356` | `src/persona_memory_items.js`, `src/persona_memory_projects.js` | `src/persona_memory_soul.js`, `src/web/controllers/core_controller.js` | Live |
| `projects` | `src/db_schema.js:448` | `src/persona_memory_projects.js` | `src/mcp/client_detection.js` | Live |
| `agents` | `src/db_schema.js:297` | `src/db_agents.js`, `src/migrate_helpers.js` | `bin/commands/doctor_services.js`, `bin/commands/init.js` | Live |
| `active_sessions` | `src/db_schema.js:287` | `src/file_tools_mcp.js` | `src/client_task_ingest.js` | Live |
| `bridges` | `src/db_schema.js:315` | `src/db_bridges.js` | `bin/lib/paths.js`, `bin/commands/doctor_services.js` | Live |
| `soul_archetypes` | `src/db_schema.js:373` | `src/soul_seeds.js` | `src/persona_memory_soul.js` | Live |
| `telegram_config` | `src/db_schema.js:385` | `src/telegram/config.js` | `src/telegram/config.js` | Live |
| `telegram_session_targets` | `src/telegram/session_manager.js:55` | `src/telegram/session_manager.js` | `src/telegram/session_manager.js` | Live |
| `prompt_queue` | `src/db_schema.js:412` | `src/queue/inbox.js` | `src/queue/inbox.js` | Live |
| `lg_checkpoints` | `src/db_schema.js:437` | `src/mcp/langgraph/checkpointer.js` | `src/mcp/langgraph/checkpointer.js` | Live |
| `lg_writes` | `src/db_schema.js:448` | `src/mcp/langgraph/checkpointer.js` | `src/mcp/langgraph/checkpointer.js` | Live |
| `tool_calls` | `src/agent_stats.js:59` | `src/db_savings.js`, `src/agent_stats.js` | `src/db_savings.js`, `bin/commands/savings.js` | Live |
| `sdlc_tasks` | `src/workflow/kage-reviewer/sdlc_manager.js:32` | `src/workflow/kage-reviewer/sdlc_manager.js`, `src/client_task_ingest.js` | Same + `src/web/controllers/activity_controller.js` | Live |
| `webhooks` | `src/webhook_manager.js:22` | `src/webhook_manager.js` | `src/webhook_manager.js` | Live |
| `schema_migrations` | `migrations/20261103_001_yamanaka_3d_canonical.sql` | `src/mcp/three_asset/db_3d_schema.js:203`, `profile_vocabulary_migration.js:75` | `src/mcp/three_asset/db_3d_schema.js:188` | Live |
| `generation_jobs` | same migration file | `src/mcp/three_asset/db_3d_promotion.js` | `src/mcp/three_asset/db_3d_queries.js` | Live |
| `assets` | same migration file | `src/mcp/three_asset/db_3d_promotion.js` | `bin/lib/runtime_install.js`, `src/mcp/three_asset/index.js` | Live |
| `asset_files` | same migration file | `src/mcp/three_asset/db_3d_promotion.js` | `src/mcp/three_asset/storage_manager.js` | Live |
| `validation_results` | same migration file | `src/mcp/three_asset/db_3d_schema.js` | `src/mcp/three_asset/db_3d_queries.js` | Live |
| `llm_requests_3d` | same migration file | `src/mcp/three_asset/db_3d_schema.js` | `src/mcp/three_asset/db_3d_schema.js` | Live |
| `_sqliteai_vector` | `src/vector_extension.js:106` (`vector_init`) | Extension only | `src/vector_search.js` | 0 rows |
| `code_index_roots` | `src/db_schema.js` (`CODE_INTELLIGENCE_DDL`) | `src/code_intel/store.js` | `src/code_intel/store.js`, `src/code_intel/query.js` | Live (v7) |
| `code_files` | `src/db_schema.js` (`CODE_INTELLIGENCE_DDL`) | `src/code_intel/store.js` | `src/code_intel/store.js`, `src/code_intel/query.js` | Live (v7) |
| `code_symbols` | `src/db_schema.js` (`CODE_INTELLIGENCE_DDL`) | `src/code_intel/store.js` | `src/code_intel/query.js`, `src/code_intel/graph_resolver.js` | Live (v7) |
| `code_refs` | `src/db_schema.js` (`CODE_INTELLIGENCE_DDL`) | `src/code_intel/store.js` | `src/code_intel/query.js` | Live (v7) |
| `code_chunks` | `src/db_schema.js` (`CODE_INTELLIGENCE_DDL`) | `src/code_intel/store.js` | `src/code_intel/query.js` | Live (v7) |
| `code_edges` | `src/code_intel/ddl.js` (`CODE_INTELLIGENCE_V7_DDL`) | `src/code_intel/store.js` | `src/code_intel/query.js`, `src/code_intel/graph_resolver.js` | Live (v7) |
| `code_chunks_fts` | `src/db_schema.js` (`CODE_INTELLIGENCE_FTS_DDL`) | Triggers on `code_chunks` | `src/code_intel/query.js` | Live (v7) |
| `kali_tools` | `src/workflow/akatsuki/lab_db.js:55` (lab), legacy copy in main | `src/workflow/akatsuki/lab.js:66` (lab) | `src/workflow/akatsuki/init.js:67` (lab) | **Finding** |

**Finding 3.1 — `kali_tools` in the main DB has no reader.** The only readers are `src/workflow/akatsuki/init.js:65-67` and `src/workflow/akatsuki/lab.js:56`, and both open the lab DB. `tests/test_akatsuki_init.js:40` already asserts the main DB must not define it. The live table is residue from before the lab split; disposition is Section 7 of the plan, not this document.

## 4. Migration/init convergence

Fresh = 44 user tables (43 excluding runtime `_sqliteai_vector`). Live = 44 after the v7 migration. The pre-v6 diff was `kali_tools`, now removed.

| Difference | Why it exists | Disposition |
|-----------|---------------|-------------|
| `_sqliteai_vector` (0 rows) | Extension-owned, created lazily by `initVectorExtension` | Keep; created on demand, not by `setupSchema` |

`kali_tools` was removed from the live store by the evidence-first remediation in Section 7; fresh and live now define the same table set.

`user_version` is now written by exactly one function, `src/db_schema.js#setUserVersion`, with value `CURRENT_SCHEMA_VERSION = 7`. The previous second writer (`bin/lib/install_lifecycle.js`, `PRAGMA user_version = 2218`) is deleted, and `tests/test_schema_migrations_and_lifecycle.js` fails if any other file writes a literal `user_version = <n>`.

`schema_migrations` rows on the fresh DB, with checksums recomputed from source:

| migration_id | Recorded checksum | Recompute source | Match |
|--------------|-------------------|------------------|-------|
| `20261103_001_yamanaka_3d_canonical` | `96376d7a…72e45e` | `sha256sum migrations/20261103_001_yamanaka_3d_canonical.sql` | Yes |
| `20261104_001_quality_level_ladder` | `e0d4f946…25cc` | `applyQualityLadderMigration` computes from generated DDL | Yes (idempotent re-run returned `applied: false`) |
| `20261109_001_profile_vocabulary` | `b668b133…5ff6` | `sha256('profile-vocabulary-v1')` in `profile_vocabulary_migration.js:71` | Yes |

Re-running `verifyAndApplyCanonicalSchema` against a copy of the live DB returned `{success: true, checksumSha256: 96376d7a…}` with no throw, which proves the recorded checksum matches the on-disk migration.

### Pass 2 — re-measured after remediation (phases 3, 5, 6, 7), pre-v6 baseline

Re-run after the schema/app version split, the isolation hardening, and the cyber-pack removal from the repository.

| Metric | Fresh (`KONOHA_HOME` temp) | Live copy (`VACUUM INTO`) |
|--------|---------------------------|---------------------------|
| user tables | 33 | 34 |
| named indexes | 31 | 33 |
| autoindexes | 27 | 29 |
| triggers | 6 | 6 |
| `user_version` | 5 | 5 |

> Superseded by the v6 numbers in Section 2. This pass is retained as the pre-v6 baseline the migration is measured against.
| `integrity_check` | ok | ok |
| `foreign_key_check` rows | 0 | 0 |

`ONLY_FRESH` and `ONLY_LIVE` were both empty once `kali_tools` was removed. Removing 3,672 pack files from git and gating `_migrateCyberSkills` did not touch DDL, which is the expected result: the pack was content, not schema.

Live still holds 3,268 legacy cyber rows written before the opt-in gate. They are inert (no consent file, no pack on disk) and `konoha doctor --clean-cyber-pack` deletes them after taking a backup; measured on a `VACUUM INTO` copy: 3,268 rows and 48 chunks removed, backup written, 0 rows remaining. The live DB on this machine was not modified.

### Pass 3 — re-measured after schema v7 (Issue #13)

Measured on this host with `node:sqlite` (Node 24.22.2, SQLite 3.53.4), fresh temp `KONOHA_HOME` and a `VACUUM INTO` copy of the live store migrated in place.

| Metric | Fresh | Live copy, migrated v5 → v7 |
|--------|-------|------------------------------|
| user tables | 44 | 44 |
| named indexes | 41 | 41 |
| autoindexes | 32 | 32 |
| triggers | 9 | 9 |
| `user_version` | 7 | 7 |
| `integrity_check` | ok | ok |
| `foreign_key_check` rows | 0 | 0 |

The migration is idempotent: a second `setupSchema` on the migrated copy returns early on the `user_version >= 7` guard and leaves the counts unchanged.

## 5. Integrity & data safety

| Check | Fresh | Live copy |
|-------|-------|-----------|
| `PRAGMA integrity_check` | `ok` | `ok` |
| `PRAGMA foreign_key_check` | `[]` | `[]` |
| `page_count` | 103 | 22655 |
| `freelist_count` | 5 | 0 |

Backups: `~/.konoha/backups/konoha_backup_<ts>.db`, directory mode `0o700` (`src/db.js:229-236`). Live copy is 88.5 MiB (`92794880` bytes).

## 6. RAG / FTS5 / embedding consistency

| Assertion | Observed | Verdict |
|-----------|----------|---------|
| Single embedding column | `skill_chunks.embedding`, all 8258 rows exactly 1536 bytes = 384 float32 | PASS |
| No second vector store | Only `_sqliteai_vector` (0 rows) beyond `skill_chunks` | PASS |
| `vector_init` dimension | `src/vector_extension.js:8` `VECTOR_DIMENSION = 384`, passed at `:106` | PASS |
| RRF constant | `k = 60` at `src/vector_search.js:245`, `:348-349` | PASS |
| Rerank degradation | `src/vector_pipeline.js:279-284` returns rank-ordered input with `1/(60+r+1)` when the pipeline is unavailable — no throw, no empty result | PASS |
| Quantized scan fallback | `scanNearestChunks` (`src/vector_search.js:93-99`) calls `scanQuantizedChunks`; with `_sqliteai_vector` empty it falls through to `scanInMemoryChunks` (brute force) | PASS, with caveat below |

**Caveat 6.1** — `_sqliteai_vector` is empty, so every semantic query takes the brute-force path over 8258 chunks. That is correct but O(n). `vector_quantize` was never run on this DB. This is a performance characteristic, not a consistency defect; Section 7 records the measured plan rather than changing the store.

## 7. Query performance

`EXPLAIN QUERY PLAN` against the live copy:

| Statement | Plan | Verdict |
|-----------|------|---------|
| `skills WHERE name=? OR skill_name=? OR name LIKE ?` (`skills_retrieval.js:164`) | `SCAN skills` | Expected: an `OR` across three predicates with a `LIKE` cannot use a single index. 4272 rows, resolves in-place. No index added — the plan proves no regression, and adding one would only serve `skill_name`. |
| `SELECT … FROM skills ORDER BY name` | `SCAN skills USING INDEX sqlite_autoindex_skills_1` | Index-served; no temp B-tree. |
| `tool_calls GROUP BY agent` | `SCAN tool_calls USING INDEX idx_tool_calls_agent` | Index-served; avoids a sort. |
| `tool_calls WHERE timestamp >= ?` | `SEARCH tool_calls USING INDEX idx_tool_calls_timestamp (timestamp>?)` | Index-served. |
| `persona_memories WHERE agent_name=? AND project_hash=?` | `SEARCH … USING INDEX idx_persona_memories_agent_proj`, temp B-tree for `ORDER BY created_at` | Composite index used as intended; the temp B-tree is bounded by the matching rows. |
| `skills_fts MATCH ?` | `SCAN skills_fts VIRTUAL TABLE INDEX 0:M4` | FTS5 internal; correct. |

No `SCAN` was found on `skill_chunks` in a hot path that an index should serve.

## 8. Cross-platform

| Item | Executed here | Result |
|------|---------------|--------|
| `path.resolve`/`path.sep` on Linux `/home` | Yes | Lab root and main DB path resolve and compare correctly |
| `which` probing | Yes (`process.platform === 'linux'`) | `_probeBinary(runner, 'which', binary)` (`lab.js:128-130`) |
| `where` probing | No | `[INFERENCE]` Windows-only branch; not executable on Linux x64 |
| macOS `/Users` | No | `[INFERENCE]` same resolver, no platform-specific branch in `getLabDbPath` |
| Windows drive letters | No | `[INFERENCE]`; `assertLabDbPath` compares resolved paths, which normalizes drive casing only as far as Node's `path.win32` does |
| WAL mode | Yes | Default on Linux; both stores open with WAL pragmas |

## 9. Traceability

| Table | DDL | Migration id | Writer | Reader | Test | Doc anchor |
|-------|-----|--------------|--------|--------|------|-----------|
| `skills` | `src/db_schema.js:255` | schema v5 | `src/migrate.js` | `src/mcp/skills_retrieval.js` | `tests/test_schema_migrations_and_lifecycle.js` | `docs/DATABASE-ERD.md` |
| `skill_chunks` | `src/db_schema.js:266` | schema v5 | `src/mcp/skills_search.js` | `src/vector_search.js` | `tests/test_schema_migrations_and_lifecycle.js` | `docs/DATABASE-ERD.md` |
| `persona_memories` | `src/db_schema.js:356` | schema v5 | `src/persona_memory_items.js` | `src/persona_memory_soul.js` | `tests/test_db_recovery.js` | `docs/DATABASE-ERD.md` |
| `projects` | `src/db_schema.js:448` | schema v5 | `src/persona_memory_projects.js` | `src/mcp/client_detection.js` | `tests/test_db_recovery.js` | `docs/DATABASE-ERD.md` |
| `agents` | `src/db_schema.js:297` | schema v5 | `src/db_agents.js` | `bin/commands/init.js` | `tests/test_db_recovery.js` | `docs/DATABASE-ERD.md` |
| `active_sessions` | `src/db_schema.js:287` | schema v5 | `src/file_tools_mcp.js` | `src/client_task_ingest.js` | — | `docs/DATABASE-ERD.md` |
| `bridges` | `src/db_schema.js:315` | schema v5 | `src/db_bridges.js` | `bin/lib/paths.js` | — | `docs/DATABASE-ERD.md` |
| `soul_archetypes` | `src/db_schema.js:373` | schema v5 | `src/soul_seeds.js` | `src/persona_memory_soul.js` | — | `docs/DATABASE-ERD.md` |
| `telegram_config` | `src/db_schema.js:385` | schema v5 | `src/telegram/config.js` | `src/telegram/config.js` | — | `docs/DATABASE-ERD.md` |
| `telegram_session_targets` | `src/telegram/session_manager.js:55` | schema v5 | `src/telegram/session_manager.js` | `src/telegram/session_manager.js` | — | `docs/DATABASE-ERD.md` |
| `prompt_queue` | `src/db_schema.js:412` | schema v5 | `src/queue/inbox.js` | `src/queue/inbox.js` | — | `docs/DATABASE-ERD.md` |
| `lg_checkpoints` | `src/db_schema.js:437` | schema v5 | `src/mcp/langgraph/checkpointer.js` | `src/mcp/langgraph/checkpointer.js` | — | `docs/DATABASE-ERD.md` |
| `lg_writes` | `src/db_schema.js:448` | schema v5 | `src/mcp/langgraph/checkpointer.js` | `src/mcp/langgraph/checkpointer.js` | — | `docs/DATABASE-ERD.md` |
| `tool_calls` | `src/agent_stats.js:59` | schema v5 | `src/db_savings.js` | `bin/commands/savings.js` | — | `docs/DATABASE-ERD.md` |
| `sdlc_tasks` | `src/workflow/kage-reviewer/sdlc_manager.js:32` | schema v5 | `sdlc_manager.js` | `sdlc_manager.js` | `tests/test_schema_migrations_and_lifecycle.js` | `docs/DATABASE-ERD.md` |
| `webhooks` | `src/webhook_manager.js:22` | schema v5 | `src/webhook_manager.js` | `src/webhook_manager.js` | — | `docs/DATABASE-ERD.md` |
| `schema_migrations` | migration SQL | `20261103_001` | `db_3d_schema.js:203` | `db_3d_schema.js:188` | `tests/test_schema_migrations_and_lifecycle.js` | `docs/DATABASE-ERD.md` |
| `generation_jobs` | migration SQL | `20261103_001` | `db_3d_promotion.js` | `db_3d_queries.js` | `tests/test_schema_migrations_and_lifecycle.js` | `docs/DATABASE-ERD.md` |
| `assets` | migration SQL | `20261103_001` | `db_3d_promotion.js` | `src/mcp/three_asset/index.js` | `tests/test_schema_migrations_and_lifecycle.js` | `docs/DATABASE-ERD.md` |
| `asset_files` | migration SQL | `20261103_001` | `db_3d_promotion.js` | `storage_manager.js` | — | `docs/DATABASE-ERD.md` |
| `validation_results` | migration SQL | `20261103_001` | `db_3d_schema.js` | `db_3d_queries.js` | — | `docs/DATABASE-ERD.md` |
| `llm_requests_3d` | migration SQL | `20261103_001` | `db_3d_schema.js` | `db_3d_schema.js` | — | `docs/DATABASE-ERD.md` |
| `code_index_roots` | `src/code_intel/ddl.js` (`CODE_INTELLIGENCE_DDL`) | schema v7 | `src/code_intel/store.js` | `src/code_intel/query.js` | `tests/test_code_intel_migration.js` | this document Section 2 |
| `code_files` | `src/code_intel/ddl.js` (`CODE_INTELLIGENCE_DDL`) | schema v7 | `src/code_intel/store.js` | `src/code_intel/query.js` | `tests/test_code_intel_migration.js` | this document Section 2 |
| `code_symbols` | `src/code_intel/ddl.js` (`CODE_INTELLIGENCE_DDL`) | schema v7 | `src/code_intel/store.js` | `src/code_intel/query.js` | `tests/test_code_intel_migration.js` | this document Section 2 |
| `code_refs` | `src/code_intel/ddl.js` (`CODE_INTELLIGENCE_DDL`) | schema v7 | `src/code_intel/store.js` | `src/code_intel/query.js` | `tests/test_code_intel_migration.js` | this document Section 2 |
| `code_chunks` | `src/code_intel/ddl.js` (`CODE_INTELLIGENCE_DDL`) | schema v7 | `src/code_intel/store.js` | `src/code_intel/query.js` | `tests/test_code_intel_migration.js` | this document Section 2 |
| `code_edges` | `src/code_intel/ddl.js` (`CODE_INTELLIGENCE_V7_DDL`) | schema v7 | `src/code_intel/store.js` | `src/code_intel/query.js` | `tests/test_code_intel_migration.js` | this document Section 2 |
| `code_chunks_fts` | `src/code_intel/ddl.js` (`CODE_INTELLIGENCE_FTS_DDL`) | schema v7 | `code_chunks` triggers | `src/code_intel/query.js` | `tests/test_code_intel_search.js` | this document Section 6 |
| `_sqliteai_vector` | `src/vector_extension.js:106` | extension | Extension | `src/vector_search.js` | — | this document Section 6 |
| `kali_tools` (main) | legacy | — | none | **none** | `tests/test_akatsuki_init.js:40` | this document Section 3 |

Empty test cells are tests that do not exist and are not required: the table has a single writer/reader pair with no failure mode that a test would catch. They are recorded as such rather than as gaps to fill.

## 10. Documentation sync

`docs/DATABASE-ERD.md:14-17` deliberately omits `assets`, `asset_files`, `generation_jobs`, `llm_requests_3d`, `schema_migrations`, `validation_results`, `*_fts*`, `sqlite_sequence`, and `_sqliteai_vector` as "standalone storage" with no relationships or security relevance. That is a stated scope decision, not drift — the ERD is a relationship diagram, and this document is the complete inventory.

Both gaps identified in pass 1 are closed:

1. `docs/DATABASE-ERD.md` Section "Akatsuki Lab DB" diagrams all four lab tables (`lab_runs`, `lab_tool_invocations`, `red_skill_audit`, `kali_tools`) with their columns and the `run_id` relationships. The pass-1 note was stale — it read only the path row at line 8.
2. `docs/QA-TEST-CHECKLIST.md` Section 1.3 now carries rows for `test_schema_migrations_and_lifecycle.js` (single-writer guard, 42-table shape), `test_schema_traceability.js`, `test_vps_safe_install.js`, `test_cyber_pack_opt_in.js`, and `test_anbu_intact.js`.

## 11. Controlled remediation

Nothing in this document changed a schema. The only code-level remediation delivered alongside it is the schema/app version separation (Section 5 of the plan), verified by:

- fresh install → `user_version = 5`, `schemaVersion === expectedSchemaVersion`;
- `konoha doctor` → `schema 5, app 2.2.19`;
- single-writer guard test fails when a second `PRAGMA user_version = <n>` is introduced (proven by injection and revert).

## 12. Acceptance

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Two stores, no shared connection | PASS | Section 1, `tests/test_akatsuki_lab_isolation.js` |
| Full inventory reproducible | PASS | Section 2, generated from both DBs |
| Every table mapped to writer/reader | PASS | Section 3, Section 9 |
| Fresh↔live diff is exactly `kali_tools` | PASS | Section 4 |
| Every migration checksum matches source | PASS | Section 4 |
| `integrity_check = ok`, `foreign_key_check = []` | PASS | Section 5 |
| Single embedding store, 384 dims | PASS | Section 6 |
| RRF `k=60` | PASS | Section 6 |
| Hot query plans recorded | PASS | Section 7 |
| Windows/macOS paths | `[INFERENCE]` | Not executable on Linux x64; Section 8 |
| Only `db_schema.js` writes `user_version` | PASS | guard test, proven by injection |
| Post-remediation schema unchanged (no DDL from pack removal) | PASS | Section 4 pass 2: same 33-table pre-v6 fresh shape; v6 adds the code-intelligence tables (Section 2) |
| Fresh schema cannot acquire `kali_tools` | PASS | `tests/test_schema_traceability.js`, `tests/test_schema_migrations_and_lifecycle.js` |
| Every declared table appears in this document | PASS | `tests/test_schema_traceability.js` |
| `kali_tools` blind drop | NOT DONE BY DESIGN | Section 3, Section 4; evidence-first removal in plan Section 7 |