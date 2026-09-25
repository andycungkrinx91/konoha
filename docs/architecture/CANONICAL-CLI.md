# Konoha Canonical CLI Specification

**Document Version:** 1.0.0 (Konoha v2.0.1)  
**Date:** 2026-09-25  
**Status:** Authoritative CLI Command Reference  

---

## 1. Primary Commands

The Konoha CLI (`konoha` or `node bin/cli.js`) exposes strictly one canonical command per operation.

| Command | Arguments / Flags | Description |
|---|---|---|
| `konoha init` | `[--force] [--yes] [--client <name>]` | Initialize MCP servers, database tables, and client integrations |
| `konoha migrate` | `[--clean] [--rebuild-embeddings] [--skip-embeddings] [--skills-dir <path>]` | Ingest and index agent skills into SQLite FTS5 |
| `konoha embed` | `[--force]` | Generate neural vector embeddings using local ONNX Granite model |
| `konoha status` | - | Display system health, client configurations, and database stats |
| `konoha version` | - | Display installed CLI version (2.0.1) and check for GitHub updates |
| `konoha upgrade` | `[--yes]` | Upgrade local Konoha installation to latest release with progress bar |
| `konoha savings` | - | Display token savings metrics and visual reduction percentages |
| `konoha doctor` | - | Run self-healing diagnostics on environment and configurations |
| `konoha test` | - | Run integration diagnostics against the MCP server |
| `konoha search` | `<query> [--category <cat>]` | Perform zero-API-key search via SearXNG |

---

## 2. Command Sub-Namespaces

### 2.1 Web UI (`konoha ui`)
- `konoha ui start [--port <port>] [--daemon]` — Launch SvelteKit 3 administrative UI (default port 1404).
- `konoha ui status` — Check whether the UI server is running and healthy.
- `konoha ui stop` — Terminate running background UI daemon.

### 2.2 Bridge Router (`konoha bridge`)
- `konoha bridge list` — List all configured bridges, models, and provider endpoints.
- `konoha bridge status` — Display router status, active ports, and sidecar availability.
- `konoha bridge create` — Interactively configure a new upstream LLM bridge.
- `konoha bridge enable <name>` — Enable routing to a configured bridge.
- `konoha bridge disable <name>` — Temporarily disable a bridge.
- `konoha bridge delete <name>` — Remove a bridge configuration.
- `konoha bridge start` — Start the proxy gateway listening on port 19999.

### 2.3 SDLC Governance (`konoha sdlc`)
- `konoha sdlc tasks [--status <status>]` — List managed development tasks.
- `konoha sdlc evidence <task_id>` — Display collected validation and review evidence.
- `konoha sdlc status` — Display current SDLC governance summary.

### 2.4 Agent Management (`konoha agent`)
- `konoha agent list` — List all 7 official ninja subagents and their assigned models.
- `konoha agent status` — Display runtime configuration and prompt hook status.

### 2.5 Skill Management (`konoha skill`)
- `konoha skill list` — List all indexed skills and references in the database.
- `konoha skill add <git_url>` — Install a skill directly from a Git repository.
- **Rule Invariant:** `konoha skilladd` is strictly prohibited and must never be implemented or documented.
