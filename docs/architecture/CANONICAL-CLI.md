# Konoha Canonical CLI Specification

**Document Version:** 1.0.0 (Konoha v2.0.2)  
**Date:** 2026-10-02  
**Status:** Authoritative CLI Command Reference  

---

## 1. Primary Commands

The Konoha CLI (`konoha` or `node bin/cli.js`) exposes strictly one canonical command per operation.

| Command | Arguments / Flags | Description |
|---|---|---|
| `konoha init` | `[--force] [--yes] [--client <name>]` | Initialize MCP servers, database tables, and client integrations |
| `konoha migrate` | `[--clean] [--rebuild-embeddings] [--skip-embeddings] [--skills-dir <path>]` | Ingest and index agent skills into SQLite FTS5 (strictly non-destructive: preserves existing user skills; `--clean` is an explicit opt-in) |
| `konoha embed` | `[--force]` | Generate neural vector embeddings using local ONNX Granite model |
| `konoha status` | - | Display system health, client configurations, and database stats |
| `konoha version` | - | Display installed CLI version (2.0.2) and check for GitHub updates |
| `konoha upgrade` | `[--yes]` | Upgrade local Konoha installation to latest release with progress bar |
| `konoha savings` | - | Display token savings metrics and visual reduction percentages |
| `konoha doctor` | - | Run self-healing diagnostics on environment and configurations |
| `konoha test` | - | Run integration diagnostics against the MCP server |
| `konoha search` | `<query> [--category <cat>]` | Perform zero-API-key search via SearXNG |

---

## 2. Command Sub-Namespaces

### 2.1 Web UI (`konoha ui` / `konoha web`)
- `konoha ui start [--port <port>] [--foreground] [--no-open]` — Launch SvelteKit 3 administrative UI daemon (default port 1404) with cross-platform resilience (`windowsHide: true`, 30-attempt polling).
- `konoha ui stop [--port <port>]` — Terminate running background UI daemon process tree (`taskkill /F /T` on Windows).
- `konoha ui restart [--port <port>]` — Cleanly restart running UI daemon and reconnect to browser.
- `konoha ui status [--port <port>]` — Check whether the UI server is running, healthy, and report PID and port.
- `konoha ui daemon` — Internal detached background daemon runner with port-scoped PID management.
- `konoha ui build` — Build SvelteKit 3 UI with Vite 8 / Rolldown and Node adapter.
- `konoha ui preview` — Run Vite preview server for the built frontend.
- `konoha ui open` — Open the default system browser to the active Web UI URL.
- `konoha ui service <install|uninstall|start|stop|restart|status>` — Manage OS-level background user services (`systemd` on Linux, `launchd` on macOS).
- `konoha web` — Foreground shorthand alias for `konoha ui start --foreground`.

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
