# PLAN_WEB_UI.md
## Konoha — Local Web Configuration UI (Svelte 5 + Vite)

**Status:** Draft for execution
**Depends on:** `PLAN_RUNTIME_MIGRATE.md` must be fully executed and signed off first (Phase 0–11 there, parity report committed). **Do not start this plan until that one is done.** This document is intentionally kept separate so the migration's correctness review is never mixed up with this feature's review.
**Goal:** Give non-technical users a browser-based UI for the configuration and monitoring tasks that today require interactive terminal wizards (`konoha bridge create`, `konoha agent skill`, `konoha savings`, `konoha doctor`, etc.), **without adding any new business logic** — the UI is a thin visual layer over the exact same functions the CLI already calls.
**Non-negotiable constraint:** The CLI remains the source of truth and must keep working identically whether or not the UI is ever launched. This is an **additive, optional surface**, not a replacement for the CLI, and not a redesign of any existing command, data model, or file layout.

---

## 0. Prerequisites (verify before starting)

- [ ] `PLAN_RUNTIME_MIGRATE.md` Phase 11 is complete: zero `.py` files remain, `docs/RUNTIME_MIGRATE_PARITY_REPORT.md` exists and is green.
- [ ] `src/db.ts`, `src/db_agents.ts`, `src/db_bridges.ts`, `src/db_savings.ts`, `src/server.ts` (or their merged equivalent, per that plan's Phase 5 decision) exist and are callable as **in-process functions**, not only as CLI subcommands or MCP-stdio tools. If any of them currently only expose a CLI-shaped interface (parses `process.argv`, calls `process.exit()`, prints directly to stdout), **refactor them first** into a plain function returning data, with the CLI command becoming a thin wrapper that formats and prints that same function's return value. This refactor is a prerequisite, not part of this UI's scope creep — do it as a small preparatory commit before Phase 1 below.
- [ ] TypeScript types/schemas for the 38 MCP tools and the core DB models (per `PLAN_RUNTIME_MIGRATE.md` §11) exist in a shared location (e.g. `src/types/` or `src/schemas/`) importable by both server code and this new UI's API layer.

---

## 1. Scope boundary (read this twice)

This plan owns:
- A new local HTTP server exposing a small, versioned JSON API over existing Konoha functions.
- A Svelte 5 + Vite single-page app consuming that API.
- A new CLI command (`konoha web`) that boots both and opens the browser.

This plan does **not** own, touch, or redesign:
- Any MCP tool, subagent, skill file, or database schema. The UI reads/writes through the same functions the CLI uses — it never queries SQLite directly and never duplicates a query that already exists in `db.ts`/`db_agents.ts`/`db_bridges.ts`/`db_savings.ts`.
- The Konoha Bridge Router (port `19999`) or any bridge's actual request-routing logic — the UI only manages bridge **configuration rows** (create/edit/enable/disable/delete), never proxies inference traffic itself.
- `semble`, `aislop`, or any third-party MCP server — out of scope entirely.
- Skill *content* editing (writing/rewriting `SKILL.md` bodies) — v1 is structured config and read-only skill browsing only (see §4).

---

## 2. Architecture

```
konoha web  (new CLI command in bin/cli.js)
   │
   ├── starts local API server (Node, plain node:http or Fastify — see §3)
   │     bound to 127.0.0.1:<auto-picked free port>, similar pattern to Bridge Router
   │     serves:
   │       /api/v1/*        → JSON API (see §5 for full endpoint list)
   │       /*                → static Svelte build output (dist/web/)
   │
   └── opens default OS browser to http://127.0.0.1:<port>/

apps/web/                     ← NEW directory, isolated frontend workspace
   svelte.config.js
   vite.config.ts
   src/
     routes/ (plain Svelte, NOT SvelteKit — see decision in PLAN_RUNTIME_MIGRATE.md §12)
       Bridges.svelte
       Agents.svelte
       Skills.svelte
       Savings.svelte
       Doctor.svelte
       Clients.svelte
       Shell.svelte           (top-level layout: sidebar nav + top bar)
     lib/
       api.ts                 (typed fetch client generated/derived from shared server types)
       stores/                (Svelte stores for bridges, agents, savings, doctor state)
       components/            (Table, Toggle, Badge, ConfirmDialog, Toast, ProgressBar-in-browser)
   dist/                       (build output, committed to npm package or built on postinstall —
                                 same distribution decision as the CLI's own TS build)

src/
   web_server.ts               ← NEW: the API server itself, imports existing db.ts / server.ts
                                  functions directly. Contains NO business logic of its own beyond
                                  request validation, auth-token check, and JSON (de)serialization.
```

---

## 3. Server stack decisions

| Concern | Decision | Rationale |
|---|---|---|
| HTTP server | **Fastify** | Lower overhead than Express, first-class TypeScript support, built-in JSON schema validation (reuse the same schemas from `PLAN_RUNTIME_MIGRATE.md` §11 for request/response validation — one schema, two consumers: MCP tool validation and HTTP API validation). |
| Binding | `127.0.0.1` by default; `--host` flag to override, **requires** `--token` when host ≠ localhost | Matches the security posture already specified in `PLAN_RUNTIME_MIGRATE.md` §12. |
| Port | Auto-pick a free port starting from a fixed default (e.g. `4321`), print the actual chosen port, same pattern as existing bridge port allocation | Avoids collision with the Bridge Router's `19999` or any user-registered bridge port. |
| Auth | None required for `127.0.0.1`-only mode (matches "it's your own machine" trust model already used by the CLI itself). A short-lived random token is still generated per-session and required for state-changing (`POST`/`PUT`/`DELETE`) requests, passed via an `X-Konoha-Web-Token` header the frontend reads from a `<meta>` tag injected into the served `index.html` — this blocks a malicious webpage open in another tab from silently calling the API (basic CSRF hardening), without requiring the user to log in. | Cheap, meaningful hardening with zero UX cost for the common case. |
| Realtime updates | Server-Sent Events (`/api/v1/events`) for savings counters and doctor/repair progress, not WebSockets | Simpler, one-directional is all that's needed (UI never needs to push a stream of data to the server outside normal REST calls), and avoids an extra dependency. |
| Process lifecycle | `konoha web` runs in the **foreground** by default (Ctrl+C stops it), with a `--detach` flag for background mode writing a pidfile to `~/.konoha/web.pid`, mirroring how `konoha bridge` processes are already managed | Consistency with existing process-management conventions in the CLI. |

---

## 4. Screens (v1 scope, one Svelte component per screen)

### 4.1 Shell / Navigation
Persistent sidebar: Bridges, Agents, Skills, Savings, Doctor, Clients. Top bar shows: current Konoha version, a green/red dot for "Konoha core healthy" (polls `/api/v1/health`), and a link back to docs.

### 4.2 Bridges (`Bridges.svelte`) — highest priority screen
- Table of configured bridges: name, port, provider, enabled toggle, target URL (masked if it's a well-known local default), "has API key" badge (never render the actual key value in the UI after initial entry — write-only field, matching how the CLI wizard already treats it).
- "Create bridge" form mirrors `konoha bridge create`'s interactive wizard fields exactly: name, port, provider (`openai` / `openai-compatible`), target URL, API key (password input, write-only).
- Enable/disable = single toggle switch, calls the same enable/disable path the CLI uses (hot-reloaded by the router the same way it already is today — no new hot-reload mechanism needed).
- Delete requires a confirm dialog (destructive action).
- Live "router status" panel showing what `konoha bridge status` already reports (model aliases currently being served, per-bridge liveness, `AWAITING SIDECAR` state for sidecar-gated bridges) — read-only, polled every few seconds via SSE.

### 4.3 Agents (`Agents.svelte`)
- List of the 7 official subagents + any custom ones, with their currently embedded skills shown as checkboxes (`[x]`/`[ ]`, matching `konoha agent skill <name>`'s existing non-interactive status output).
- Toggling a checkbox calls the same embed/unembed function `konoha skill embed/unembed` already uses.
- Read-only display of each agent's role description, skills-DB keyword, and (if the host client injects it) model tier — do not let the UI silently imply it can change model selection if the current CLI can't; keep exact parity of "what's configurable" vs "what's read-only."
- Explicitly disabled in v1: creating/deleting custom subagents from the UI (the CLI enforces a manual `--manual` flag guard for this precisely to prevent automated/accidental creation — respect that same guard by not exposing it here at all in v1, rather than trying to replicate the flag semantics in a web form).

### 4.4 Skills (`Skills.svelte`)
- Searchable/filterable table over `find_skill`/`list_skills` output: name, type, size, last indexed.
- Clicking a row shows a **read-only** rendered preview (via `get_skill`), same content the CLI would print, rendered as Markdown instead of terminal text.
- "Add skill" form wraps `konoha skill add <name>` (registry search + install), with a progress indicator reflecting the same install steps the CLI prints.
- No in-browser editing of skill Markdown content in v1 (explicitly excluded per §1).

### 4.5 Savings (`Savings.svelte`) — second-highest visual value
- Today / Last 7 Days / All-Time cards, replacing the ASCII summary box with real numbers in the same units already computed by `db_savings.ts`.
- A real bar/line chart (lightweight charting — plain SVG or a tiny library, avoid pulling in a heavy charting framework) for the "by call type" breakdown that today renders as horizontal ASCII bars in `konoha savings`.
- All numbers must trace to the exact same computation as the CLI — this screen renders `db_savings.ts` output, it does not recompute anything independently.

### 4.6 Doctor (`Doctor.svelte`)
- One row per diagnostic check `konoha doctor` already runs, with pass/fail/warn status and a "Repair" button per failing row that calls the exact same repair function the CLI's `--yes` auto-repair path calls.
- A single "Repair all" button at the top, mirroring `konoha doctor --yes`.

### 4.7 Clients (`Clients.svelte`)
- One card per supported client (Antigravity IDE/CLI, Cursor, Claude Code, OpenCode, Command Code, Codex): configured / not configured, with a toggle to run that client's setup/removal, wrapping the same per-client manager functions (`cursor_manager.ts`, `codex_manager.ts`, etc.) the CLI already calls during `konoha init`.

---

## 5. API contract (v1)

All endpoints are namespaced under `/api/v1/`. All state-changing endpoints require the `X-Konoha-Web-Token` header (see §3). Every response body's TypeScript shape is drawn from the shared types in `src/types/` — this table names the underlying function each endpoint wraps, not a new schema to design from scratch.

| Method | Path | Wraps existing function | Notes |
|---|---|---|---|
| GET | `/api/v1/health` | version + doctor summary | Cheap, used for the top-bar status dot. |
| GET | `/api/v1/bridges` | `db_bridges.list()` | |
| POST | `/api/v1/bridges` | `db_bridges.create()` | Same field validation as the CLI wizard. |
| PATCH | `/api/v1/bridges/:name` | `db_bridges.update()` (enable/disable/edit) | |
| DELETE | `/api/v1/bridges/:name` | `db_bridges.delete()` | |
| GET | `/api/v1/bridges/status` | equivalent of `konoha bridge status` | Router liveness, model aliases. |
| GET | `/api/v1/agents` | `agent_manager.listAgents()` | Includes embedded-skill state. |
| PATCH | `/api/v1/agents/:name/skills/:skill` | embed/unembed toggle | Body: `{ embedded: boolean }`. |
| GET | `/api/v1/skills` | `find_skill`/`list_skills` | Query params: `q`, `limit`. |
| GET | `/api/v1/skills/:name` | `get_skill` | Full content, read-only. |
| POST | `/api/v1/skills` | `konoha skill add` equivalent | Body: `{ name }`; returns install progress via SSE. |
| GET | `/api/v1/savings` | `db_savings.calculateAll()` | Query param: `period=today\|7d\|all`. |
| GET | `/api/v1/doctor` | doctor diagnostic list | |
| POST | `/api/v1/doctor/repair` | doctor repair (single or `all`) | Body: `{ check: string \| "all" }`. |
| GET | `/api/v1/clients` | per-client configured status | |
| POST | `/api/v1/clients/:name/setup` | that client's manager `.setup()` | |
| POST | `/api/v1/clients/:name/remove` | that client's manager `.remove()` | |
| GET | `/api/v1/events` (SSE) | pushes savings deltas + doctor/repair progress | One-directional stream only. |

---

## 6. Execution phases

### Phase 1 — Prerequisite refactor
Confirm/complete the "callable as plain functions" prerequisite from §0. Land this as its own commit before any UI code exists, so it's reviewable independently and doesn't get lost inside a large UI PR.

### Phase 2 — API server skeleton
Build `src/web_server.ts` (Fastify), wire up `/api/v1/health` only, add the `konoha web` CLI command that starts it and prints the URL (no browser auto-open yet, no frontend yet). **Done criteria:** `konoha web` starts, `/api/v1/health` returns real data, `Ctrl+C` cleanly shuts it down, port auto-pick avoids collisions with `19999` and any active bridge ports.

### Phase 3 — Frontend scaffold
Scaffold `apps/web/` with `vite --template svelte-ts`, build the `Shell.svelte` layout and static nav only (no real data yet, mocked). Wire the Vite build output into `web_server.ts`'s static file serving. **Done criteria:** `konoha web` opens a browser showing the shell with working navigation between empty placeholder screens.

### Phase 4 — Bridges screen end-to-end
Implement the full `/api/v1/bridges*` endpoints and the `Bridges.svelte` screen per §4.2, including the token-header wiring. **Done criteria:** creating/editing/enabling/disabling/deleting a bridge from the browser produces identical `bridges` table state to doing the same via `konoha bridge create/enable/disable/delete` — verify by diffing the DB row before/after each action performed both ways.

### Phase 5 — Remaining screens
Implement Agents, Skills, Savings, Doctor, Clients screens and their endpoints, one at a time, each with the same "diff against CLI-produced state" verification as Phase 4.

### Phase 6 — SSE + polish
Wire up `/api/v1/events`, replace polling with SSE on the Savings and Doctor screens, add toasts/confirm dialogs, and do an accessibility pass (reuse Jonin's existing a11y verification conventions from `svelte-ui-expert`/`svelte-code-expert` skills, since this UI is itself a Svelte app built under the same project).

### Phase 7 — Packaging & docs
Decide and implement the build-output distribution strategy (commit `apps/web/dist/` vs. build-on-`postinstall`/`prepare`), add `docs/SETUP-WEB-UI.md`, add `konoha web` to the CLI command table in `README.md`, and add a screenshot/GIF following the same style as the existing `assets/konoha-*.png` set.

### Phase 8 — Sign-off
Produce `docs/WEB_UI_PARITY_REPORT.md`: for every screen, confirm every mutating action was verified against direct DB/CLI comparison (per Phase 4/5's method), confirm the localhost-only default and token-header CSRF guard both work as specified, and confirm `konoha web` never starts by default on any other command (it is opt-in only, never auto-launched by `konoha init`).

---

## 7. Explicit non-goals (do not add these without a new, separate plan)
- Multi-user auth / accounts.
- Remote hosting guidance beyond the `--host`/`--token` escape hatch already specified.
- In-browser skill content authoring/editing.
- Any new subagent, MCP tool, or database table — this UI must not require a single schema migration.
- Mobile-responsive layout — this is a local desktop developer tool, optimize for a normal laptop/monitor viewport only.
