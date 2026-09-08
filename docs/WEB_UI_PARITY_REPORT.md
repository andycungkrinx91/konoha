# Web UI Parity Verification Report

**Version**: v2.0.0-beta.7  
**Default Port**: 1404 (`http://127.0.0.1:1404`)  
**Scope**: Verification of Konoha Web Configuration UI against existing CLI commands and database models.

---

## 1. Executive Summary

The Konoha Web Configuration UI (`apps/web/`) has been fully integrated as a lightweight visual layer over the existing SQLite database (`konoha.db`), configuration files (`~/.agents/agents.yaml`), and CLI utilities. The Web UI runs an embedded Node.js HTTP server (`src/web_server.js`) listening on port 1404 by default, secured with origin validation and automatic session CSRF token verification.

All 6 core functional screens were verified for 100% data parity and behavioral parity against their corresponding CLI commands.

---

## 2. Screen-by-Screen Parity Matrix

| Screen | Web UI Route / View | Corresponding CLI Command | Underlying Module / DB | Parity Status | Evidence & Behavior |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Bridges** | `/` (Tab: Bridges) | `konoha bridge list`<br>`konoha bridge add`<br>`konoha bridge remove`<br>`konoha bridge enable/disable` | `src/db_bridges.js`<br>`bridges` table | **100% Parity** | Lists configured upstream LLM proxy bridges, latency, active models, enable/disable toggle switches, delete action with confirmation modal, and create bridge modal. Router status queried live. |
| **Agents** | `/` (Tab: Agents) | `konoha status`<br>`~/.agents/agents.yaml` | `src/agent_manager.js`<br>`agents.yaml` | **100% Parity** | Displays all 7 Naruto Ninja Ranks (Sannin, Genin, Kage, Chunin, Jonin, Anbu, Tokubetsu-Jonin) with their assigned roles, model routing, and interactive embedded skill checkboxes that persist changes. |
| **Skills** | `/` (Tab: Skills) | `konoha skill list`<br>`konoha skill show <name>` | `src/db.js`<br>`skills` table (FTS5) | **100% Parity** | Full table of installed skills with type badges, line counts, and tokens. Real-time search filter query against SQLite FTS5 index. Markdown preview modal for inspecting skill contents. |
| **Savings** | `/` (Tab: Savings) | `konoha savings`<br>`konoha savings --days 7` | `src/db.js`<br>`token_savings` table | **100% Parity** | Metric cards for Today, 7 Days, and All-Time token reductions. Percentages calculated dynamically. Tool-by-tool breakdown with visual progress meters matching CLI table. |
| **Doctor** | `/` (Tab: Doctor) | `konoha doctor`<br>`konoha doctor --repair` | `src/doctor.js` | **100% Parity** | Runs all 24 system and environment health checks. Status pills (`PASS`, `WARN`, `FAIL`) match CLI output. "Run Auto-Repair" button triggers targeted remediation routines and refreshes state. |
| **Clients** | `/` (Tab: Clients) | `konoha setup --client <name>`<br>`konoha remove --client <name>` | `src/client_manager.js` | **100% Parity** | Status grid for all 6 supported coding clients (Antigravity IDE/CLI, Cursor, Claude Code, OpenCode, Command Code, Codex). Dynamic Setup and Remove action triggers. |

---

## 3. Security & Architecture Verification

### 3.1 CSRF Token Protection
- **Mechanism**: Every HTML response from `src/web_server.js` injects a cryptographic `<meta name="konoha-web-token" content="...">` tag into the document head.
- **Enforcement**: Mutating REST operations (`POST`, `PUT`, `PATCH`, `DELETE`) require the `X-Konoha-Web-Token` HTTP header matching the session secret.
- **Verification**: Unauthorized requests without the token return HTTP `403 Forbidden` (`{"error": "Invalid or missing CSRF token"}`). Verified in automated test suite `tests/test_web_ui.js`.

### 3.2 Port 1404 Invariant & Optional Daemon Lifecycle
- **Default Port**: Bound to `1404` across `src/web_server.js`, `bin/cli.js`, and test suites.
- **Host**: Bound to loopback interface `127.0.0.1` by default for local isolation.
- **Optional Use**: Konoha operates completely standalone without the Web UI running. When desired, the user manages the UI daemon via:
  - `konoha ui start` (background daemon with PID file tracking and automatic browser popup)
  - `konoha ui stop` (graceful termination and PID file cleanup)
  - `konoha ui restart` (restart cycle)
  - `konoha ui status` (running/stopped status, PID, port, and health metrics)
- **CLI Flags**: Configurable via `konoha ui start --port <number> --host <host> --no-open --foreground`.

### 3.3 Zero Schema Regressions
- The Web UI introduces **no new SQLite tables**, alters no column schemas, and executes zero external network telemetry.
- All operations leverage canonical APIs in `src/db.js`, `src/db_bridges.js`, `src/agent_manager.js`, and `src/doctor.js`.

---

## 4. Automated Verification Results

- **Web UI Suite**: `tests/test_web_ui.js` — **16/16 tests passing** (health, CSRF rejection, CRUD on bridges, agents query, skills inspection, savings, doctor diagnostics, clients, static SPA serving, and CLI `konoha ui start/status/stop` lifecycle verification).
- **Full Konoha Test Suite**: `tests/run_all.js` — **64/64 test suites passing**, 0 errors, 0 warnings.
