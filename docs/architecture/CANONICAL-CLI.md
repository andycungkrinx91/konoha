# Konoha Canonical CLI Specification

**Document Version:** 1.2.0 (Konoha v2.2.3)  
**Date:** 2026-10-18  
**Status:** Authoritative CLI Command Reference  

---

## 1. Primary Commands

The Konoha CLI (`konoha` or `node bin/cli.js`) exposes strictly one canonical command per operation.

| Command | Arguments / Flags | Description |
|---|---|---|
| `konoha agent` | `<subcommand> [args]` | Configure Ninja subagents (list, create, toggle skills, models config, delete, status) |
| `konoha bridge` | `<subcommand> [options]` | Manage Konoha Bridge Router (status, list, create, delete, enable, disable) |
| `konoha clean` | `[--no-vacuum]` | Clean stale runtime artifacts, dead PIDs, old backups, and reclaim disk space in `~/.konoha/` |
| `konoha config` | `<subcommand> [options]` | Manage global Konoha system configuration |
| `konoha data` | `<subcommand> [options]` | Manage SQLite active session history, persona memories, and database size |
| `konoha detect-ai` | `<target> [--json]` | Scan website URL or project files for AI fingerprints (Human-Built Index) |
| `konoha detect-docs` | `<target> [--json]` | Scan prose documents or text for AI generation markers (ZeroGPT defense) |
| `konoha doctor` | - | Run self-healing diagnostics on environment and configurations |
| `konoha embed` | `[options]` | Rebuild vector embeddings for all skills (calls `migrate` with implied `--rebuild-embeddings`) |
| `konoha help` | `[-h] [--help]` | Show interactive educational help menu |
| `konoha init` | `[--yes] [--force] [--python <path>] [--silent]` | Initialize MCP servers, database tables, and configure detected coding clients |
| `konoha migrate` | `[--clean] [--rebuild-embeddings] [--skip-embeddings] [--skills-dir <path>] [--force]` | Ingest and index agent skills into SQLite FTS5 (strictly non-destructive: preserves existing user skills; `--clean` is an explicit opt-in) |
| `konoha project` | `<subcommand> [options]` | Manage persistent project workspaces, detected stacks, and invariants (including `hitl_mode`) |
| `konoha queue` | `<subcommand> [args]` | Background task prompt queue and execution worker |
| `konoha reinstall` | `[options]` | Shorthand for `konoha init --force` (clean reinstallation of MCP servers and configurations) |
| `konoha savings` | - | Display token savings metrics and visual reduction percentages |
| `konoha search` | `<query> [--num=<n>] [--depth=<d>] [--json]` | Zero-API-key multi-source web search (SearXNG, DuckDuckGo, Wikipedia) |
| `konoha service` | `<install\|uninstall\|start\|stop\|restart\|status>` | Manage background system daemon service (systemd / launchd) for Web UI |
| `konoha skill` | `<subcommand> [args]` | Manage skills (list installed, search public registry, add/remove, embed/unembed) |
| `konoha soul` | `[--json]` | Display Ninja's Soul doctrine, tenets, and archetype spirits |
| `konoha status` | - | Display system health, client configurations, and database stats |
| `konoha task` | `<subcommand> [options]` | Native SDLC governance tasks, readiness gates, and audits |
| `konoha telegram` | `<subcommand> [options]` | Manage Telegram bot task reporting and two-way remote prompting |
| `konoha test` | - | Run integration diagnostics against the MCP server |
| `konoha tunnel` | `<subcommand> [options]` | Manage Cloudflare and ngrok public ingress tunnels |
| `konoha ui` | `<subcommand> [options]` | Manage local Web Configuration UI (start, stop, restart, status; port 1404) |
| `konoha uninstall` | - | Safely remove Konoha MCP server (leaves custom skill files intact) |
| `konoha upgrade` | `[--yes] [--force]` | Upgrade local Konoha installation to latest release with progress bar |
| `konoha version` | `[-v] [--version]` | Display installed CLI version and check npm registry for updates |
| `konoha web` | `[options]` | Foreground shorthand alias for `konoha ui start --foreground` |

---

## 2. Command Sub-Namespaces

### 2.1 Web UI (`konoha ui` / `konoha web`)
- `konoha ui start [--port <port>] [--foreground] [--no-open]` — Launch administrative UI daemon (default port 1404) with cross-platform resilience.
- `konoha ui stop [--port <port>]` — Terminate running background UI daemon process tree.
- `konoha ui restart [--port <port>]` — Cleanly restart running UI daemon.
- `konoha ui status [--port <port>]` — Check whether the UI server is running, healthy, and report PID and port.
- `konoha ui daemon` — Internal detached background daemon runner with port-scoped PID management.
- `konoha ui build` — Build SvelteKit UI with Vite and Node adapter.
- `konoha ui preview` — Run preview server for the built frontend.
- `konoha ui open` — Open default system browser to the active Web UI URL.
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
- `konoha bridge stop` — Terminate running proxy gateway process.
- `konoha bridge restart` — Restart the proxy gateway process.
- `konoha bridge models` — Display available models served across all active bridges.

### 2.3 SDLC Governance (`konoha task`)
- `konoha task list [--status <status>] [--limit <n>]` — List managed development tasks.
- `konoha task show <task_id>` — Display collected validation and review evidence.
- `konoha task slop <task_id>` — View authoritative anti-slop Delivery Gate findings and cycles.
- `konoha task delete <id> [--all] [--status <s>]` — Delete specific task or bulk delete tasks by status.
- `konoha task clear [--status <s>] [--project <p>]` — Clear tasks from database to prevent stale task hallucination.

### 2.4 Agent Management (`konoha agent`)
- `konoha agent list [--tui]` — List all 7 official ninja subagents and their assigned skills.
- `konoha agent create <agent-name> [options]` — Create a custom subagent (`--title`, `--purpose`, `--instructions`, `--keywords`).
- `konoha agent skill [agent-name]` — Interactively toggle (embed or remove) a skill for an agent.
- `konoha agent models [config] [agent-name]` — Interactively configure a bridge-served model (or `--model <id>`).
- `konoha agent delete <agent-name>` — Permanently delete an agent and prune its historical statistics.
- `konoha agent status` — Display runtime call frequency and prompt hook status.

### 2.5 Skill Management (`konoha skill`)
- `konoha skill list` — List all custom skills currently installed in the village.
- `konoha skill search <query>` — Find skills on the public registry (`skills.sh`).
- `konoha skill add <name|url> [name]` — Install a skill from registry or Git repository.
- `konoha skill remove <name>` — Uninstall a skill from local environment.
- `konoha skill <name> embed <agent>` (or `embed <skill> <agent>`) — Embed an installed skill into a specific subagent.
- `konoha skill <name> unembed <agent>` — Remove an embedded skill from a specific subagent.
- **Rule Invariant:** `konoha skilladd` is strictly prohibited and must never be implemented or documented.

### 2.6 Inbound Prompt Queue (`konoha queue`)
- `konoha queue list` — List recent prompt queue tasks.
- `konoha queue next` — Print next pending prompt for execution.
- `konoha queue run` — Process and execute next pending prompt.
- `konoha queue start-worker` — Run autonomous background queue worker.
- `konoha queue complete <id> [summary]` — Mark prompt task as completed.
- `konoha queue cancel <id>` — Cancel a pending task.
- `konoha queue help` — Display queue usage instructions.

### 2.7 Project Workspaces & Context (`konoha project`)
- `konoha project context [path]` — View detected stack, package manager, and architectural invariants.
- `konoha project list` — List all tracked project workspaces.
- `konoha project memory [path]` — List persistent memories and episodic learnings for a workspace.
- `konoha project add [path] <summary>` — Save architectural invariants or rules for a project.
- `konoha project set <dor-mode|review-mode> <val> [path]` — Configure SDLC DoR gate mode or review mode.
- `konoha project delete <path|hash>` — Remove a project workspace profile.
- `konoha project delete-memory <id>` — Remove a single episodic learning item by ID.
- `konoha project prune [path]` — Prune all episodic learnings for a project workspace.

### 2.8 Database & Persona Data (`konoha data`)
- `konoha data view` — Display disk size, loaded skills, and persona memory statistics.
- `konoha data memory [agent]` — List saved persona rules, preferences, and episodic memories per agent.
- `konoha data add <agent> <txt>` — Save a persistent rule or preference for an agent persona.
- `konoha data search <query>` — Search saved knowledge and memories across agents.
- `konoha data delete <id>` — Remove a saved memory item by ID.
- `konoha data export` — Export indexed skills and database knowledge to a Markdown report.
- `konoha data backup [path]` — Non-blocking online SQLite database snapshot via `VACUUM INTO`.
- `konoha data rebuild-fts` — Rebuild all FTS5 full-text search indexes (`skills_fts`, `persona_memories_fts`).
- `konoha data prune [--retention <days>]` — Clean old sessions and prune `tool_calls` older than retention period (default 90 days) while preserving memories. Note: `konoha data prune` deletes immediately, with no confirmation and no automatic backup (take `konoha data backup` first). The cumulative "alltime" count in `getAgentStats()` counts only data recorded since the last prune.
- `konoha data vacuum` — Defragment and compress SQLite database file.

### 2.9 Web Search (`konoha search`)
- `konoha search <query> [--num=<n>] [--depth=standard|deep] [--json]` — Multi-source web search via SearXNG, DuckDuckGo, and Wikipedia.
- `konoha search status` — Display active search chain, elected instances, and log size.
- `konoha search prune` — Prune cached instances and query logs.

### 2.10 Remote Notifications & Ingress (`konoha telegram` / `konoha tunnel`)
- `konoha telegram status` — Display Telegram integration status.
- `konoha telegram config [options]` — Configure bot token, chat ID, and mode (`--token`, `--chat-id`, `--mode <one_way|two_way>`).
- `konoha telegram test` — Send verification test message.
- `konoha telegram enable` / `konoha telegram disable` — Toggle Telegram notifications.
- `konoha telegram start-poller` / `konoha telegram stop-poller` — Manage two-way inbound polling listener.
- `konoha tunnel status` — Display active ingress tunnel status and public URL.
- `konoha tunnel start [options]` — Start public ingress tunnel (`--provider <cf|ngrok>`, `--port <port>`, `--token <token>`, `--domain <domain>`, `--pin <pin>`).
- `konoha tunnel stop` — Terminate active ingress tunnel.
- `konoha tunnel config [options]` — Configure default tunnel credentials.
