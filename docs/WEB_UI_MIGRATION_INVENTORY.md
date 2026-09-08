# Web UI Migration Inventory & Phase 0 Snapshot

**Document**: `docs/WEB_UI_MIGRATION_INVENTORY.md`  
**Plan**: `PLAN_REFACTOR_WEB_UI.md`  
**Target**: `apps/web/`  
**Framework Migration**: Svelte 5 + Vite (SPA) → SvelteKit 2 + Svelte 5 Runes + Tailwind CSS v4 + Node adapter (`build/`)

---

## 1. File Classification Inventory

| File Path | Classification | Role & Target Action |
| :--- | :--- | :--- |
| `apps/web/src/lib/api.js` | **(d) API Client** | Portable as-is. Provides `apiRequest(endpoint, options)` with automatic CSRF token extraction from `<meta name="konoha-web-token">` and header injection. |
| `apps/web/src/components/Bridges.svelte` | **(a) Pure UI Component** | Port to `src/routes/bridges/+page.svelte` (or keep as reusable component rendered by route) with Runes (`$state`, `$derived`, `$effect`) and Tailwind v4 classes. |
| `apps/web/src/components/Agents.svelte` | **(a) Pure UI Component** | Port to `src/routes/agents/+page.svelte` with Runes and Tailwind v4 classes. |
| `apps/web/src/components/Skills.svelte` | **(a) Pure UI Component** | Port to `src/routes/skills/+page.svelte` with Runes and Tailwind v4 classes. |
| `apps/web/src/components/Savings.svelte` | **(a) Pure UI Component** | Port to `src/routes/savings/+page.svelte` with Runes and Tailwind v4 classes. |
| `apps/web/src/components/Doctor.svelte` | **(a) Pure UI Component** | Port to `src/routes/doctor/+page.svelte` with Runes and Tailwind v4 classes. |
| `apps/web/src/components/Clients.svelte` | **(a) Pure UI Component** | Port to `src/routes/clients/+page.svelte` with Runes and Tailwind v4 classes. |
| `apps/web/src/App.svelte` | **(c) Routing/Shell Glue** | Legacy root shell with tab switching. Replaced by `src/routes/+layout.svelte` and file-based route navigation. Kept for legacy fallback during migration. |
| `apps/web/src/main.js` | **(c) Routing/Shell Glue** | Vite SPA DOM mounter `mount(App, { target: document.getElementById('app') })`. Replaced by SvelteKit runtime. |
| `apps/web/index.html` | **(c) Routing/Shell Glue** | Legacy HTML shell. Replaced by `src/app.html` for SvelteKit. |
| `apps/web/src/lib/state/` | **(b) Store / State** | New directory created for Svelte 5 Rune-based reactive state modules (`uiState.svelte.ts`, `bridgeState.svelte.ts`). |

---

## 2. CSS Approach Confirmation

- **Current State**: Component-scoped `<style>` blocks in each `.svelte` component using dark-themed CSS variables and explicit selectors (`.card`, `.btn`, `.badge`, `.grid-2`, `.modal-backdrop`, `.table`).
- **Target State**: **Tailwind CSS v4** configured in `apps/web/src/app.css` using `@import "tailwindcss";` and utility classes, preserving dark-mode aesthetics, zero-slop layout tokens, and exact UI behavior.

---

## 3. Screen Behavior & Mutating Action Snapshot

### 3.1 Bridges Screen
- **Read Operations**:
  - Fetches `/api/v1/bridges` (configured bridges list, port, provider, enabled state, target endpoint).
  - Fetches `/api/v1/bridges/status` (router running status, active port).
- **Mutating Actions**:
  - `POST /api/v1/bridges` (create new bridge with name, port, provider, target_url, api_key).
  - `PATCH /api/v1/bridges/:name` (toggle enable/disable bridge).
  - `DELETE /api/v1/bridges/:name` (remove bridge with confirmation modal).

### 3.2 Agents Screen
- **Read Operations**:
  - Fetches `/api/v1/agents` (7 Naruto Ninja Ranks: Sannin, Genin, Kage, Chunin, Jonin, Anbu, Tokubetsu-Jonin; roles, models, skills).
  - Fetches `/api/v1/skills` for available skill checklist.
- **Mutating Actions**:
  - `PATCH /api/v1/agents/:name/skills/:skill` (toggle skill attachment for an agent).

### 3.3 Skills Screen
- **Read Operations**:
  - Fetches `/api/v1/skills?limit=100&q=<query>` (SQLite FTS5 full-text search).
  - Fetches `/api/v1/skills/:name` (markdown content modal view).
- **Mutating Actions**: None (read-only inspection).

### 3.4 Savings Screen
- **Read Operations**:
  - Fetches `/api/v1/savings` (Today, 7-Day, and All-Time token reductions, tool-by-tool breakdown with percentage savings).
- **Mutating Actions**: None (read-only telemetry).

### 3.5 Doctor Screen
- **Read Operations**:
  - Fetches `/api/v1/doctor` (24 system diagnostic checks with PASS, WARN, FAIL status pills).
- **Mutating Actions**:
  - `POST /api/v1/doctor/repair` (triggers automated remediation routines and refreshes diagnostic checks).

### 3.6 Clients Screen
- **Read Operations**:
  - Fetches `/api/v1/clients` (6 coding clients: Antigravity IDE/CLI, Cursor, Claude Code, OpenCode, Command Code, Codex).
- **Mutating Actions**:
  - `POST /api/v1/clients/:name/setup` (configures client MCP integration).
  - `POST /api/v1/clients/:name/remove` (removes client MCP integration).
