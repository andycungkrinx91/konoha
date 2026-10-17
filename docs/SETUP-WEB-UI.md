# 🌐 Konoha Web Configuration UI Guide

The **Konoha Web Configuration UI** is a local browser-based management dashboard for Konoha, powered by **SvelteKit 3** (`@sveltejs/kit` 3.0.1 + `@sveltejs/adapter-node` 6.0.0), **Svelte 5** (5.57.2), **Vite 8/Rolldown** (8.3.3), and **Tailwind CSS v4**, served directly by an embedded lightweight Node.js API server.

It provides a modern visual interface for configuration and monitoring tasks that otherwise require interactive terminal wizards (`konoha bridge create`, `konoha agent skill`, `konoha savings`, `konoha doctor`, etc.), **without adding any new business logic** — the UI is a thin visual layer over the exact same functions the CLI and SQLite database already use.

<p align="center">
  <img src="../assets/demo-web.webp" alt="Konoha SvelteKit 3 Web Configuration UI Demo" width="100%">
</p>

---

## 🚀 Quick Start (Optional Web UI)

The Web UI is **completely optional**. Konoha functions 100% independently from CLI and MCP tools without the UI running. When you want a visual dashboard, manage it using the `konoha ui` daemon commands:

### Background Service Mode (Recommended)

```bash
# Start the Web UI daemon in background (binds 127.0.0.1:1404 and opens browser)
konoha ui start

# Check current status, port, PID, and health metrics
konoha ui status

# Restart the Web UI server
konoha ui restart

# Stop the background Web UI daemon
konoha ui stop
```

### Foreground / Ephemeral Mode

You can also run the Web UI directly in the foreground:

```bash
# Run in foreground (press Ctrl+C to exit)
konoha ui start --foreground
# or
konoha web

# Custom port or headless server mode (no browser popup)
konoha ui start --port 1404 --no-open
konoha web --port 1404 --no-open
```

### Cross-Platform Daemon Management (Windows, Linux, macOS)

- **Windows**: `konoha ui start` runs as a completely detached background daemon using `windowsHide: true` without flashing visible command prompt windows. Default port 1404 polling waits up to 30 attempts to ensure reliable startup. On `konoha ui stop`, process trees are cleanly cleaned up using `taskkill /F /T /PID`, with PowerShell `-Unique` connection ownership kill and `netstat -ano` fallback. Supports Windows `SIGBREAK` for graceful shutdown.
- **Linux (systemd)**: Run `konoha ui service install` to register a `systemd --user` unit (`konoha-ui.service`) for automatic background launch on login/boot and automatic restarts.
- **macOS (launchd)**: Run `konoha ui service install` to generate a `launchd` LaunchAgent plist (`com.konoha.ui.plist`) for automatic system startup.
- **Port Isolation**: All daemon lifecycle commands (`start`, `stop`, `restart`, `status`) support `--port=<num>` scoping — stopping or restarting a daemon on a custom port never interrupts daemons running on port 1404 or other ports.

---

## 🛡️ Architecture & Security Model

```
konoha web
   │
   ├── Embedded API Server (src/web_server.js)
   │     ├── Bound to 127.0.0.1:1404 (Localhost only)
   │     ├── Password-only authentication via salted scrypt hashing (src/auth.js)
   │     ├── Bootstrap credential ('konohagakure') with mandatory password change enforcement
   │     ├── Serves session token via HttpOnly cookie; exposes CSRF token via GET /api/v1/csrf
   │     ├── Requires X-Konoha-Web-Token on POST / PATCH / DELETE
   │     ├── Realtime updates via Server-Sent Events (/api/v1/events)
   │     └── Serves JSON API (/api/v1/*) over existing Konoha core functions
   │
   └── Frontend (apps/web/build/)
         ├── Built with SvelteKit 3 + Svelte 5 + Vite 8
         ├── Cyberpunk 3D Login Page with Procedural Three.js Rasengan, static chakra fallback & 3,000 ms auth timeline
         └── Theme Picker: 10 four-stop palettes grouped by category × explicit Light/Dark appearance,
             2,000 ms procedural 3D WebGL Rasengan transition
```

### Security & Authentication Hardening
- **Localhost Bound**: The server binds strictly to `127.0.0.1` by default.
- **Salted Scrypt Password Authentication**: Passwords are verified server-side using cryptographic salted scrypt key derivation (`crypto.scryptSync`, `N=16384, r=8, p=1`, 64-byte key) with timing-safe comparison (`crypto.timingSafeEqual`). Plaintext passwords are never stored or logged.
- **Bootstrap Password Gating**: On first run `src/auth.js` provisions the bootstrap credential `konohagakure` (provisioning input only — never compared in the browser or echoed by the API) and persists only its salted scrypt verifier to `~/.konoha/web_auth.json` (mode `0600`). The hint is shown on the login screen only while `GET /api/v1/auth/status` reports `is_bootstrap: true`. Sessions created from the bootstrap credential are gated (`403 requires_password_change`) until the password change is persisted; `/api/v1/auth/change-password` requires the current password and clears the flag only after the new verifier is durably written (in place + `fsync`, mode `0600`). Failed changes never clear the flag.
- **Credential Store Fail-Closed**: A present-but-unreadable or malformed `web_auth.json` never silently reinstalls the bootstrap credential; login returns `401`/`500`-class failures without leaking internals.
- **Rate-Limiting Protection**: Repeated invalid login attempts trigger IP-based throttling (HTTP 429 lockout after repeated failures) to protect against brute-force attacks.
- **CSRF Token Invariant**: Every session generates a secure random token passed via the `X-Konoha-Web-Token` header for all state-changing mutations (`POST`, `PUT`, `PATCH`, `DELETE`). Requests missing or with an invalid token are rejected with HTTP 403 Forbidden.
- **Zero Raw Secrets Rendered**: API keys entered for local LLM bridges are write-only and never echoed back in plaintext.

---

## 📱 Features & Screens

### 1. 🌉 Bridges Screen (`Bridges.svelte`)
- View all configured local LLM proxy bridges and gateway ports.
- Live status indicator and telemetry for the Konoha Bridge Router (port `19999`) and Bridge Sidecar (port `1313`).
- Daemon lifecycle controls: Start, Stop, and Restart the Bridge Gateway daemon directly from the UI.
- Interactive Served Models Browser (`/api/v1/bridges/models`): Inspect all served LLM models across active bridges.
- One-click toggle switch to enable/disable bridges without restarts.
- Create new bridges with provider presets (`openai`, `openai-compatible`, `anthropic`, `gemini`).
- Safe deletion with modal confirmation.

### 2. 👤 Subagents Screen (`Agents.svelte`)
- Manage the 7 official Naruto Ninja Ranks:
  - `✧ Sannin` (MCP Router & Orchestrator)
  - `⚑ Genin` (Codebase Exploration Scout)
  - `◎ Kage` (Village Leader & Architecture/Security Audits)
  - `▫ Chunin` (Intel & Web Research)
  - `♦ Jonin` (Elite UI/Frontend Builder)
  - `♠ Anbu` (Black Ops Backend & DevOps)
  - `⬡ Tokubetsu-jonin` (Technical Writing & Scribe)
- Interactive embedded skill checkboxes: toggling instantly syncs `~/.agents/agents.yaml` and `konoha.db`. Primary dedicated skills (`kage-skill`, `jonin-skill`, etc.) are strictly preserved at priority index 0.
- **Official & Embedded Skills Visibility**: Cards accurately render all active embedded and official ninja subagent skills (`sannin-skill`, `genin-skill`, `kage-skill`, `chunin-skill`, `jonin-skill`, `anbu-skill`, `tokubetsu-jonin-skill`, `konoha`) with active status badges and smooth inside-card scrolling (`max-h-56 overflow-y-auto`).

### 3. 📚 Skills Management Screen (`Skills.svelte`)
- **3-Mode Search Switcher**:
  - `🔤 Local FTS5`: Instant full-text search with BM25 ranking across all local skills and references.
  - `⚡ Neural Vector`: 384-dimensional cosine similarity semantic search powered by IBM Granite Multilingual ONNX embeddings.
  - `🌐 skills.sh Registry`: Real-time global query against `skills.sh/api/skills` with exact parity to `konoha skill search <query>`, displaying rank, install count, GitHub author/repo source, and descriptions.
- **1-Click Skill Installation**:
  - Install any skill from `skills.sh` or Git repositories directly from the UI (`POST /api/v1/skills/install`) with non-interactive piped execution, automatic GitHub URL normalization, and instant SQLite FTS5 + Granite vector embedding migration.
- **Interactive Vector & Chunks Inspector & Re-Embedding**:
  - Skill detail modal includes a dedicated **Vector Embeddings & Chunks** tab displaying 384-dim Float32 vector samples (`vector_sample`), chunk index, and tokenized chunk text.
  - Vector status badge showing model (`IBM Granite Multilingual 384-dim`), indexed chunks, and RRF reranking metrics.
  - **On-Demand Neural Vector Re-Embedding**: Dedicated "Re-embed Vectors" 3D button in the action toolbar and skill card triggering `POST /api/v1/skills/reembed` to dynamically compute IBM Granite 384d ONNX embeddings for all skills with live feedback and SSE event synchronization.
- Create new skills directly in the browser with custom name, description, tags, and YAML frontmatter.
- Embed / Unembed skills to official ninja subagents with one click.
- Safe skill deletion with cascading foreign-key protection for chunk tables.
- One-click database re-indexing (`/api/v1/skills/reindex`).
- Click any skill to open an interactive modal with full markdown preview.

### 4. 📊 Token Savings Screen (`Savings.svelte`)
- **Unified Live Token Savings Metric**: Visual Savings (Tokens & Thought Reasoning), calculated relative to full context index sizing (2065 KB baseline) and Unified live metric from Konoha MCP + Semble Semantic Engine. Fragmented Client Provider Breakdown has been removed for a clean, unified counter across all 7 clients.
- Real-time token reduction telemetry:
  - Today Bytes Saved
  - Last 7 Days Bytes Saved
  - All-Time Bytes & Quota Saved (~83-98% typical)
- Visual breakdown by MCP tool with interactive progress bars.
- **Interactive Savings by Tool Operation Dropdown**: Expandable accordion detailing exact byte reductions and invocation counts per tool operation matching `konoha savings` TUI.

### 5. 🧠 Persona Memory Screen (`Persona.svelte`)
- Visual management of episodic persona memories (`/persona`):
  - Filter and search memories across all 7 ninja agents.
  - Add new episodic memories with importance ratings (1–10).
  - Edit or delete memories with real-time SQLite persistence.
  - 100% parity with `konoha data memory` CLI.

### 6. 💾 Project Context Memory Screen (`Context.svelte`)
- Per-project context memory explorer (`/context`):
  - View persistent project tech stack (`framework`, `styling`, `package_manager`).
  - Inspect verified architectural invariants and episodic learnings.
  - Edit project notes directly in the browser matching `konoha project` CLI.

### 7. 🔍 SearXNG Web Search Screen (`Search.svelte`)
- Dedicated web search interface powered by local SearXNG instance (`/search`).
- Zero API-key search across multiple upstream providers with privacy preservation.
- Instant search results with title, URL, snippet, and category badges.
- 100% parity with `konoha search` CLI.

### 8. 🎨 10 Refined Presets & Explicit Light / Dark Mode System
- **Default Appearance: Light Mode**: Default out-of-the-box appearance is strictly Light Mode, with Byakugan Deep Ocean as the active default preset.
- **Explicit Appearance Mode Selector**: Independently toggle between Light Mode and Dark Mode inside the Theme Picker (`themeState.setMode('light' | 'dark')`) with persistent storage across sessions. Switching appearance mode preserves the active preset, and switching presets preserves the chosen mode.
- **10 Visually Distinct Presets Across 3 Categories**:
  - *Cyberpunk*: Children of Midnight Violet, Byakugan Deep Ocean, Konoha Forest Aurora, Rasengan Cosmic Magenta
  - *Hacker*: Sharingan Royal Indigo, Hokage Crimson Flame, Anbu Abyssal Emerald, Sage Mode Nebula Orchid
  - *General UI*: Sound Imperial Bronze, Akatsuki Jade Matrix
- **Canonical 4-Gradient Theme System**: Every theme defines a calibrated 4-color gradient array (`--gradient-1` through `4`, `--gradient`, `--theme-grad-1` through `4`, `--theme-gradient`, `--theme-4gradient`, `--theme-4gradient-bar`, `--theme-4gradient-subtle`, `--theme-glow`), displayed with visual 4-stop swatch previews in `ThemeSwitcher.svelte` and a top accent bar.
- **Semantic Theme Contract**: `themeState.applyTheme()` writes the full contract for the active palette *and* appearance mode — `--theme-bg`, `--theme-surface`, `--theme-surface-raised`, `--theme-surface-hover`, `--theme-surface-active`, `--theme-overlay`, `--theme-text`, `--theme-text-secondary`, `--theme-muted`, `--theme-text-disabled`, `--theme-text-inverse`, `--theme-border`, `--theme-border-strong`, `--theme-border-subtle`, `--theme-border-hover`, `--theme-text-muted`, `--theme-focus`, `--theme-link`, `--theme-selection`, `--theme-success`, `--theme-warning`, `--theme-danger`, `--theme-info` (accent choices are luminance-checked against the surface) plus mode-aware `--shadow-3d`, `--shadow-3d-hover`, `--glass-edge`, and `--glass-highlight`. Form controls, placeholders, and `:focus-visible` outlines in `app.css` read these tokens instead of browser defaults.
- **Collapsible Submenu Accordion**: Sidebar navigation sections (`Overview`, `Clients & Finance`, `Tools & Integrations`, `Configuration`, `Operations`, `Resources`) feature interactive collapsible accordions that reveal sub-menus on click with smooth transitions and animated chevron indicators.
- **Collapsible Sidebar (Open/Close Toggle)**: Dedicated desktop sidebar toggle button (`[ ⇤ ]` / `[ ◨ ]`) in both sidebar brand header and top main header, allowing the central content stage to expand to 100% full screen width for maximum center workspace.
- **Mobile Menu Sidebar Toggle & Drawer Navigation**: In mobile view (`< lg`), the header renders a dedicated sidebar menu toggle button on the far left (`aria-label="Toggle mobile menu sidebar"`). Clicking it opens an accessible slide-out mobile drawer (`w-64 fixed inset-y-0 left-0 z-50 shadow-2xl`) with backdrop dismissal, providing comprehensive navigation access across all 15 screens.
- **Footer Author Attribution Link**: The sidebar status footer embeds a permanent author attribution: `Created by Andy Setiyawan` with a high-contrast link to `https://www.linkedin.com/in/andy-setiyawan-452396170/` directly under SQLite FTS5 + Semble Localhost metrics.
- **Universal 5px Card Border-Radius Invariant**: Strict 5px border-radius (`border-radius: 5px !important`) enforced across ALL cards (`.glass-card-3d`, `.theme-card`, `.card`, `[class*="card"]`, modals, and metric tiles).
- **Enhanced Glassmorphism**: Amplified glassmorphism with 28px backdrop blur, 195% saturation, enhanced specular highlight edges (`--glass-edge`, `--glass-highlight`), and deep layered 3D shadows adapted to both Light Mode and Dark Mode.
- **Authentic Rasengan Theme Switcher FAB**: Universal floating circular FAB button in the bottom-right corner (`fixed bottom-6 right-6 z-[100]`) featuring an authentic spinning SVG Rasengan with orbiting electric lightning bolts outside the rasengan orb, multi-stop radial gradient chakra containment orb, rapid clockwise and counter-clockwise swirling spiral filaments, and a pulsing energy core (all palette-driven via `var(--color-primary)` / `var(--color-accent)`).
- **Refined Theme Picker Dialog**: The picker is a focus-trapped `role="dialog"` (`aria-modal`, `aria-labelledby`, `aria-describedby`) grouped by category (Cyberpunk / Hacker / General UI), with `aria-pressed` palette selection, visible "Active" marker, Escape/backdrop close, a quick Light/Dark toggle beside the FAB, and a polite live region announcing palette/mode changes. Palette names and four-stop gradients are unchanged.
- **2-Second Procedural 3D WebGL Rasengan Theme Transition**: Selecting any of the 10 themes triggers an epic 2-second procedural 3D Three.js Rasengan transition with dynamic theme palette, optical shatter flash (`animate-shatter-flash`), and ambient vignette that cleanly transitions the entire UI into the chosen palette without wall distortion, screen shaking, or countdown timers.
- **Unified 3D Button Theme Consistency**: Interactive buttons throughout all dashboard and telemetry views leverage 3D tactile depth (`.btn-3d`, `.btn-3d-primary`, `.btn-3d-secondary`) powered dynamically by the active theme's CSS variables (`--theme-4gradient`, `--color-surface`, `--color-border`), strictly eliminating un-themed hardcoded dark backgrounds in light mode.
- **Hardware-Accelerated 3D Motion**: Perspective tilt and hover animations (`scene-3d`, `tilt-3d`, `rise-3d`) with zero Chrome GPU lag and full `prefers-reduced-motion` support.
- **Accessible Typography & Modals**: Custom Svelte 5 runes SweetAlert 3D dialogs with body scroll-lock and Escape/backdrop close.

### 9. 🩺 Environment Doctor Screen (`Doctor.svelte`)
- Comprehensive diagnostic checklist of 24+ components (Node.js, SQLite, MCP tools, client configs).
- Status badges: `HEALTHY`, `REPAIRED`, `ACTIVE`, `WARNING`, `FAILED`.
- "Run Auto-Repair" button at top to automatically resolve any missing or outdated integration templates.

### 10. 🔌 Coding Clients Screen (`Clients.svelte`)
- Status indicators for all 8 supported coding clients:
  - Antigravity IDE / CLI (`~/.gemini/config/mcp_config.json`)
  - Cursor IDE / CLI (`~/.cursor/mcp.json`)
  - Claude Code CLI (`~/.claude.json`)
  - OpenCode IDE (`~/.config/opencode/opencode.json`)
  - Command Code CLI (`~/.commandcode/mcp.json`)
  - Codex IDE / CLI (`~/.codex/config.toml`)
  - Pi (pi.dev) CLI (`~/.pi/agent/mcp.json`)
  - OMP Agent (`~/.omp/agent/mcp.json`)
- One-click Setup and Disconnect buttons.

### 11. 📋 SDLC Tasks & Governance Screen (`Tasks.svelte`)
- Full visual dashboard for the Native SDLC Governance Layer (`/tasks`):
  - **Task Registry & Audit Trail**: Real-time listing of recorded tasks from the `sdlc_tasks` SQLite WAL table (`GET /api/v1/sdlc/tasks`), showing task status (`pending`, `in_progress`, `completed`, `blocked`), target files, implementing and reviewer subagents, and timestamps.
  - **Task Detail & Evidence Modal**: Inspect granular task evidence (`GET /api/v1/sdlc/tasks/:id`), including full Definition-of-Readiness (DoR) diagnostics, validation output, and anti-slop audit history.
  - **Interactive Definition-of-Readiness (DoR) Tester**: Test any task string and project path interactively (`POST /api/v1/sdlc/check-readiness`) to evaluate substance, keyword alignment, file existence, and placeholder detection before dispatch.
  - **Governance Configuration Toggles**: Manage project-level governance modes (`GET/PATCH /api/v1/sdlc/config`):
    - *DoR Mode*: Toggle between `advisory` (diagnostic warnings only) and `enforced` (strict dispatch blocking).
    - *Review Independence Mode*: Configure cross-provider second-opinion enforcement (`independent`, `same_bridge`, `relaxed`).

---

## 🛠️ Development & Building

To modify or rebuild the web frontend:

```bash
# Install frontend dependencies
pnpm --dir apps/web install

# Run Vite dev server with hot reload
pnpm --dir apps/web run dev

# Build production distribution bundle
pnpm run build:web
```
