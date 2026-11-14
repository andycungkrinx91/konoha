# Konoha Database ERD

Two physically separate SQLite files. Nothing joins across them, and no write path bridges them.

| Store | Path | Owner module |
|---|---|---|
| Main DB | `~/.konoha/konoha.db` (override `KONOHA_DB_PATH`) | `src/db.js` → `getConnection()` |
| Akatsuki Lab DB | `~/.konoha/akatsuki-lab/lab.db` (override `KONOHA_LAB_DB_ROOT`) | `src/workflow/akatsuki/lab_db.js` → `openLabDb()` |

`src/db.js#getConnection()` throws `LAB_DB_ISOLATION_VIOLATION` for any lab path; `getLabDbPath()` throws unless the path is inside the lab root and is not the main DB. The boundary is structural, not a config flag.

## Main DB

Twenty-two tables appear below — those with relationships or security relevance. The
remaining main tables (`assets`, `asset_files`, `generation_jobs`, `llm_requests_3d`,
`schema_migrations`, `validation_results`) and SQLite's own `*_fts*`, `sqlite_sequence`,
and `_sqliteai_vector` bookkeeping tables are omitted as standalone storage.

```mermaid
---
title: Konoha Main SQLite Database ERD
config:
  theme: base
  themeVariables:
    darkMode: false
    background: '#ffffff'
    mainBkg: '#eff6ff'
    primaryColor: '#eff6ff'
    primaryTextColor: '#334155'
    primaryBorderColor: '#3b82f6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f0fdf4'
    tertiaryColor: '#fff7ed'
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    fontSize: '13px'
---
erDiagram
    agents ||..o| soul_archetypes : "agent_name (logical)"
    skills ||--o{ skill_chunks : "skill_name = name"
    projects ||--o{ persona_memories : "project_hash"
    projects ||..o{ active_sessions : "project_hash (logical)"
    code_index_roots ||--o{ code_files : "root_hash"
    code_index_roots ||--o{ code_edges : "root_hash"
    code_files ||--o{ code_symbols : "file_id"
    code_files ||--o{ code_refs : "file_id"
    code_files ||--o{ code_edges : "source_file_id / target_file_id"
    code_files ||--o{ code_chunks : "file_id"
    code_symbols ||..o{ code_refs : "target_symbol_id (SET NULL)"
    code_symbols ||..o{ code_edges : "source_symbol_id / target_symbol_id"

    agents {
        TEXT name PK
        TEXT icon
        TEXT title
        TEXT model
        TEXT model_tier
        TEXT purpose
        TEXT skills
        TEXT delegate_when
        TEXT constraints_text
        TEXT workflow
        TEXT description
        TEXT instructions
        TEXT delegation_keywords
        TEXT cursor_fallback_model
        INTEGER enable_mcp_tools
    }

    soul_archetypes {
        TEXT agent_name PK
        TEXT name
        TEXT role
        TEXT voice
        TEXT calling
        TEXT antislop_skills
        TEXT adhd_shaping
        TEXT source
        TEXT updated_at
    }

    skills {
        TEXT name PK
        TEXT skill_name
        TEXT type
        TEXT tags
        TEXT content
        TEXT file_path
        INTEGER byte_size
        INTEGER line_count
    }

    skill_chunks {
        INTEGER id PK
        TEXT skill_name FK
        INTEGER chunk_index
        TEXT chunk_text
        BLOB embedding
    }

    projects {
        TEXT project_hash PK
        TEXT project_path
        TEXT project_name
        TEXT framework
        TEXT styling
        TEXT package_manager
        TEXT context_summary
        TEXT tech_stack
        TEXT dor_mode
        TEXT review_mode
        TEXT hitl_mode
        TEXT advisor_mode
        INTEGER advisor_max_tokens
        TEXT created_at
        TEXT updated_at
    }

    persona_memories {
        TEXT id PK
        TEXT project_hash FK
        TEXT session_id
        TEXT agent_name
        TEXT memory_type
        TEXT title
        TEXT content
        TEXT tags
        INTEGER importance
        TEXT created_at
        TEXT updated_at
    }

    active_sessions {
        TEXT client PK
        TEXT workspace_root PK
        TEXT session_id PK
        TEXT project_hash
        TEXT transcript_path
        TIMESTAMP last_active_at
    }

    tool_calls {
        INTEGER id PK
        DATETIME timestamp
        TEXT tool
        TEXT query
        INTEGER returned_bytes
        INTEGER total_library_bytes
        INTEGER bytes_saved
        INTEGER tokens_saved
        INTEGER input_tokens
        INTEGER output_tokens
        INTEGER cached_tokens
        TEXT agent
        TEXT client
    }

    sdlc_tasks {
        TEXT id PK
        TEXT description
        TEXT status
        TEXT dor_result
        TEXT review_mode
        TEXT evidence
        TEXT slop_result
        INTEGER slop_cycles
        TEXT project_path
        TEXT session_id
        TEXT client
        TEXT created_at
        TEXT updated_at
    }

    bridges {
        TEXT name PK
        INTEGER port
        TEXT provider
        INTEGER enabled
        TEXT target_url
        TEXT api_key
    }

    webhooks {
        TEXT id PK
        TEXT name
        TEXT url
        INTEGER enabled
        TEXT auth_type
        TEXT auth_token
        TEXT custom_header
        TEXT events
        INTEGER last_status
        TEXT last_delivered_at
        TEXT created_at
        TEXT updated_at
    }

    prompt_queue {
        TEXT id PK
        TEXT source
        TEXT sender_info
        TEXT prompt
        TEXT status
        TEXT session_id
        TEXT workspace_root
        TEXT client
        TEXT result_summary
        REAL token_savings_percent
        INTEGER kage_confidence_score
        TEXT created_at
        TEXT processed_at
        TEXT completed_at
    }

    telegram_config {
        INTEGER id PK
        INTEGER enabled
        TEXT mode
        TEXT transport
        TEXT bot_token
        TEXT chat_id
        TEXT webhook_secret
        TEXT last_notified_at
        TEXT updated_at
    }

    telegram_session_targets {
        TEXT chat_id PK
        TEXT client
        TEXT workspace_root
        TEXT session_id
        TIMESTAMP updated_at
    }

    lg_checkpoints {
        TEXT thread_id PK
        TEXT checkpoint_ns PK
        TEXT checkpoint_id PK
        TEXT parent_checkpoint_id
        TEXT type
        BLOB checkpoint
        BLOB metadata
    }

    lg_writes {
        TEXT thread_id PK
        TEXT checkpoint_ns PK
        TEXT checkpoint_id PK
        TEXT task_id PK
        TEXT task_path
        INTEGER idx PK
        TEXT channel
        TEXT type
        BLOB value
    }

    code_index_roots {
        TEXT root_hash PK
        TEXT root_path UK
        TEXT head_sha
        TEXT status
        INTEGER file_count
        INTEGER symbol_count
        INTEGER chunk_count
        INTEGER indexed_epoch_ms
        TEXT indexed_at
        TEXT updated_at
        TEXT error
    }

    code_files {
        INTEGER id PK
        TEXT root_hash FK
        TEXT rel_path UK
        TEXT language
        INTEGER byte_size
        INTEGER line_count
        TEXT content_hash
        REAL mtime_ms
        REAL ctime_ms
        TEXT inode_id
        TEXT parser_version
        TEXT content_kind
        TEXT metrics_json
        TEXT indexed_at
    }

    code_symbols {
        INTEGER id PK
        TEXT root_hash FK
        INTEGER file_id FK
        TEXT name UK
        TEXT kind UK
        TEXT parent_name
        INTEGER start_line UK
        INTEGER end_line
        TEXT signature
        TEXT language
    }

    code_refs {
        INTEGER id PK
        TEXT root_hash FK
        INTEGER file_id FK
        TEXT target_name
        INTEGER target_symbol_id FK
        TEXT kind
        INTEGER line
    }

    code_edges {
        INTEGER id PK
        TEXT root_hash FK
        INTEGER source_file_id FK
        INTEGER source_symbol_id FK
        INTEGER target_file_id FK
        INTEGER target_symbol_id FK
        TEXT edge_kind
        TEXT specifier
        REAL confidence
    }

    code_chunks {
        INTEGER id PK
        TEXT root_hash
        INTEGER file_id FK
        TEXT rel_path
        TEXT language
        INTEGER chunk_index UK
        INTEGER start_line
        INTEGER end_line
        TEXT body
        TEXT chunk_kind
        INTEGER symbol_id FK
        TEXT content_hash
        BLOB embedding
        TEXT embedding_model
    }
```

Declared foreign keys are `skill_chunks.skill_name → skills.name`, `persona_memories.project_hash → projects.project_hash`, and every `code_*` child row to its parent (`code_edges` also references `code_files` and `code_symbols`, `code_chunks.symbol_id` references `code_symbols`). Dotted relations are logical joins with no constraint.

The six relational `code_*` tables plus `code_chunks_fts` form the native code-intelligence index (schema v7). Each child table cascades from `code_index_roots` on `root_hash`, so `code_remove` is a single delete. `code_refs.target_symbol_id` and `code_edges.target_file_id` / `target_symbol_id` use `ON DELETE SET NULL` so unresolved targets stay in the graph until re-linked. `code_chunks_fts` is an FTS5 external-content table over `code_chunks` and is not drawn; its three triggers (`code_chunks_ai/ad/au`) keep it in step. `code_chunks.embedding` stays `NULL` only when semantic search is explicitly disabled (`KONOHA_SEMANTIC_SEARCH=0`) — synthetic hash-derived vectors are never written there.

`lg_writes` is keyed on `(thread_id, checkpoint_ns, checkpoint_id, task_id, idx)`; it references `lg_checkpoints` logically, not by a declared foreign key.

`persona_memories_migrated` and `active_sessions_migrated` are not shown: they exist only while a foreign-key/PK rebuild is running and are dropped when it commits.

## Akatsuki Lab DB

```mermaid
---
title: Konoha Akatsuki Lab SQLite Database ERD
config:
  theme: base
  themeVariables:
    darkMode: false
    background: '#ffffff'
    mainBkg: '#eff6ff'
    primaryColor: '#eff6ff'
    primaryTextColor: '#334155'
    primaryBorderColor: '#3b82f6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f0fdf4'
    tertiaryColor: '#fff7ed'
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    fontSize: '13px'
---
erDiagram
    lab_runs ||--o{ lab_tool_invocations : "run_id"
    lab_runs ||--o{ red_skill_audit : "run_id"

    lab_runs {
        INTEGER id PK
        TEXT lab_name
        TEXT engine
        TEXT workflow
        TEXT scope
        TEXT started_at
        TEXT finished_at
        INTEGER exit_status
        TEXT evidence_json
    }

    lab_tool_invocations {
        INTEGER id PK
        INTEGER run_id FK
        TEXT tool_id
        TEXT phase
        TEXT command
        INTEGER exit_status
        TEXT created_at
    }

    red_skill_audit {
        INTEGER id PK
        TEXT occurred_at
        INTEGER run_id FK
        TEXT skill_name
        TEXT agent_name
        TEXT decision
        TEXT code
        TEXT reason
        TEXT surface
    }

    kali_tools {
        TEXT id PK
        TEXT slug
        TEXT name
        TEXT package
        TEXT category
        TEXT description
        TEXT url
    }
```

`kali_tools` is a standalone reference table: no foreign keys, seeded from `src/templates/akatsuki_lab/kali_tools.json` when empty.

## Why these do not merge

| Concern | Main DB | Lab DB |
|---|---|---|
| Lifetime | Persistent, backed up | Ephemeral, purged on confirmed teardown |
| `kali_tools` catalog | Absent by design | Owned here since the Kali catalog migration |
| Red-skill audit | Absent by design | `red_skill_audit`, written through a supplied connection or an existing-file-only open; never created by auditing |
| Vector extension | Loaded | Never loaded |
| Legacy skill migration | Runs at startup | Never runs |
| Writer | `getConnection()` | `openLabDb()`; `openLabAuditConnection()` when only appending audit rows |

See `docs/security/DATABASE-ISOLATION-INVENTORY.md` for the guard-by-guard enforcement list and `docs/security/RED-SKILL-INVENTORY.md` for skill classification.
