# Konoha Canonical API Snapshot

**Document Version:** 1.0.0 (Konoha v2.0.1)  
**Date:** 2026-09-25  
**Status:** Machine-Readable & Authoritative Architecture Snapshot  

---

## 1. Canonical MCP Tools (Active Advertised Roster)

All tools (35 active) are served through the `konoha` MCP server over stdio JSON-RPC.

| Tool Name | Parameters | Purpose | Return Schema |
|---|---|---|---|
| `read_file_head` | `path?: string, file_path?: string, filepath?: string, max_lines?: number` | Read the first N lines of a file. | Line-numbered text content |
| `read_file_range` | `path?: string, file_path?: string, filepath?: string, start_line?: number, end_line?: number` | Read a bounded inclusive line range. | Line-numbered text content |
| `file_info` | `path?: string, file_path?: string, filepath?: string` | Return file metadata. | JSON metadata object |
| `token_efficient_grep` | `pattern: string, dir?: string, path?: string, file_path?: string, filepath?: string, glob?: string, file_glob?: string, ignore_case?: boolean, max_matches?: number` | Search text with a bounded result count. | JSON match array with line numbers |
| `get_file_structure` | `path?: string, dir?: string, dir_path?: string` | Return a compact class and function signature map. | ASCII directory tree |
| `find_files_clean` | `pattern?: string, dir?: string, path?: string, limit?: number` | Find files while skipping build and VCS noise. | JSON file list object |
| `website_ai_detector` | `target?: string, path?: string, url?: string` | Scan a website directory or URL for AI-generation fingerprints. | Heuristic score object |
| `docs_ai_detector` | `file_path?: string, target?: string` | Scan a document for AI-generation fingerprints and return a 0-100 score. | Heuristic score object (0-100) |
| `get_resolved_task_dir` | `task_dir?: string` | Resolve an isolated task directory. | Absolute path string |
| `find_skill` | `keyword: string, limit?: number, agent?: string, compact?: boolean, task_id?: string` | Search indexed skills across repositories. | JSON array of matched skills & snippets |
| `list_skills` | `agent?: string, fields?: array` | List indexed skills. | JSON array of skill records |
| `get_skill` | `name: string, agent?: string, token_budget?: number, section?: string, task_id?: string` | Retrieve a skill or reference by name. | Markdown skill text with section metadata |
| `optimize_report` | `keyword?: string, agent?: string` | Analyze skill token footprint. | Formatted skill token analysis |
| `build_from_source` | `name: string, source_dir: string, framework: string, taste_dials?: object` | Return a source-fidelity build specification. | Structured JSON specification |
| `build_from_text` | `name: string, description: string, framework: string, taste_dials?: object` | Return a text-driven build specification. | Structured JSON specification |
| `sannin` | `task?: string, context?: string, constraints?: string, skills?: array, taste_dials?: object, project_path?: string, task_dir?: string, prompt?: string` | Route and orchestrate a task. | Structured task result JSON |
| `kage` | `task?: string, context?: string, constraints?: string, skills?: array, taste_dials?: object, project_path?: string, task_dir?: string` | Delegate architecture or review work to Kage. | Confidence report & verdict JSON |
| `jonin` | `task?: string, context?: string, constraints?: string, skills?: array, taste_dials?: object, project_path?: string, task_dir?: string` | Delegate frontend work to Jonin. | UI implementation results JSON |
| `anbu` | `task?: string, context?: string, constraints?: string, skills?: array, taste_dials?: object, project_path?: string, task_dir?: string` | Delegate backend or DevOps work to Anbu. | Backend implementation results JSON |
| `chunin` | `task?: string, context?: string, constraints?: string, skills?: array, taste_dials?: object, project_path?: string, task_dir?: string` | Delegate research work to Chunin. | Citation-backed report JSON |
| `tokubetsu_jonin` | `task?: string, context?: string, constraints?: string, skills?: array, taste_dials?: object, project_path?: string, task_dir?: string` | Delegate documentation work to Tokubetsu-Jonin. | Generated documentation JSON |
| `genin` | `task?: string, context?: string, constraints?: string, skills?: array, taste_dials?: object, project_path?: string, task_dir?: string` | Delegate codebase exploration to Genin. | Structured exploration report JSON |
| `report_from_agent` | `agent_name: string, summary: string, status?: string, files_created?: array, files_modified?: array, learnings?: array, project_path?: string, task_dir?: string, dispatch_id?: string, validation?: array` | Record a structured agent result. | Checkpoint confirmation JSON |
| `get_project_context` | `project_path?: string` | Get project context and memories. | JSON context object |
| `save_project_context` | `project_path?: string, context_summary: string, tech_stack?: object` | Save project invariants. | Save confirmation JSON |
| `query_project_memory` | `query?: string, project_path?: string, agent_name?: string, memory_type?: string, limit?: number` | Query project-scoped memories. | JSON match list |
| `web_search` | `query: string, num_results?: number, search_depth?: string` | Search the web with fallback providers. | Search result JSON with citations |
| `migrate_skills` | `force?: boolean, skills?: array, skills_dir?: string` | Re-index skills into SQLite FTS5. | Migration summary JSON |
| `save_persona_memory` | `agent_name: string, content: string, title?: string, memory_type?: string, tags?: string, importance?: number` | Save a persona memory. | Record ID confirmation |
| `query_persona_memory` | `agent_name: string, query?: string, memory_type?: string, limit?: number` | Query persona memories. | Matched persona records JSON |
| `list_persona_memories` | `agent_name?: string, memory_type?: string, limit?: number` | List persona memories. | Persona record list JSON |
| `delete_persona_memory` | `id: string` | Delete a persona memory. | Deletion confirmation JSON |
| `check_readiness` | `task: string, project_path?: string` | Check task prompt readiness before dispatch. | Gate approval status JSON |
| `get_task_evidence` | `task_id: string` | Retrieve validation evidence for a task. | Evidence log JSON |
| `get_slop_findings` | `task_id: string` | Retrieve anti-slop scan findings and report for a task. | Anti-slop scanner report JSON |
---

## 2. Canonical Subagents Roster

| Agent Key | Type Name | Skill Package | Primary Role |
|---|---|---|---|
| `sannin` | `sannin` | `sannin-skill` | Router & task triage |
| `genin` | `genin` | `genin-skill` | Code exploration & dependency mapping |
| `kage` | `kage` | `kage-skill` | Architecture decisions & code review |
| `chunin` | `chunin` | `chunin-skill` | Web research & documentation lookup |
| `jonin` | `jonin` | `jonin-skill` | Frontend development & UI design matching |
| `anbu` | `anbu` | `anbu-skill` | Backend dev, DevOps, infrastructure, testing |
| `tokubetsu-jonin` | `tokubetsu_jonin` | `tokubetsu-jonin-skill` | Documentation, specs, runbooks, reports |

---

## 3. Canonical Storage Architecture

All database tables reside inside SQLite database `~/.konoha/konoha.db` using `WAL` journal mode:

| Table | Engine | Purpose |
|---|---|---|
| `skills` | FTS5 Virtual Table + Relational | Full-text skill indexing & content lookup |
| `skill_chunks` | Relational + BLOB | Vector embeddings storage (384-dim Granite) |
| `project_memory` | Relational | Episodic architectural learnings per workspace |
| `project_context` | Relational | Verified tech stack & architectural invariants |
| `persona_memories` | Relational | User & agent persona traits and preferences |
| `sdlc_tasks` | Relational | SDLC tasks, lifecycle states, and model tracking |
| `sdlc_task_events` | Relational | Task event log, review notes, and transitions |
| `sdlc_task_evidence` | Relational | Review evidence, command outputs, confidence scores |
| `bridges` | Relational | Local LLM bridge configurations & routing targets |
| `savings` | Relational | Token savings telemetry & invocation counters |

---

## 4. Canonical CLI Interfaces

* `konoha init [--force] [--yes] [--client <client>]`
* `konoha migrate [--clean] [--rebuild-embeddings] [--skip-embeddings]`
* `konoha embed [--force]`
* `konoha status`
* `konoha version`
* `konoha upgrade [--yes]`
* `konoha savings`
* `konoha doctor`
* `konoha test`
* `konoha search <query>`
* `konoha ui {start|status|stop}`
* `konoha bridge {list|status|create|enable|disable|delete|start}`
* `konoha sdlc {tasks|evidence|status}`
* `konoha agent {list|status}`
* `konoha skill {list|add}`
