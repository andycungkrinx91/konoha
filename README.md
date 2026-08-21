<p align="center">
  <img src="assets/konoha_logo_kyubi.png" alt="Konoha Logo" width="320">
</p>

[![Antigravity](https://img.shields.io/badge/Antigravity-IDE%20%7C%20CLI-7c3aed?logo=rocket&logoColor=white)](README.md)
[![Cursor](https://img.shields.io/badge/Cursor-IDE%20%7C%20CLI-000000?logo=cursor&logoColor=white)](README.md)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-CLI-d97757?logo=anthropic&logoColor=white)](README.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20macOS%20%7C%20Windows-informational)](README.md)
[![Python](https://img.shields.io/badge/Python-%E2%89%A5%203.8-3776AB?logo=python&logoColor=white)](README.md)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A5%2018-339933?logo=node.js&logoColor=white)](README.md)
[![MCP Tools](https://img.shields.io/badge/MCP%20Servers-3%20%7C%2021%2B%20Tools-10b981)](README.md)
[![SearXNG](https://img.shields.io/badge/SearXNG-Zero%20API--Key%20Search-blue)](docs/SETUP-SEARXNG.md)
[![RTK](https://img.shields.io/badge/RTK-Rust%20Token%20Killer-ff6b35?logo=rust&logoColor=white)](README.md)
[![Observed Token Savings](https://img.shields.io/badge/Observed%20Token%20Savings-83--98%25-9ece6a)](docs/BENCHMARK.md)


---

## 📸 Preview

* **Latest Security Compliance:** [Google Policy Compliance v2.0.0 — Konoha v2.0.0](docs/SecurityCompliance/security_compliance_report_google_policy_2.0.0_2026-08-14.md)

| | |
|:---:|:---:|
| **📊 Database Status (`konoha status`)**<br><img src="assets/konoha-status.png" alt="konoha status" width="450"> | **🥷 Subagent Team Status (`konoha agent status`)**<br><img src="assets/konoha-agent-status.png" alt="konoha agent status" width="450"> |
| **📜 Installed Skills List (`konoha skill list`)**<br><img src="assets/konoha-skill-list.png" alt="konoha skill list" width="450"> | **📈 Token Savings Dashboard (`konoha savings`)**<br><img src="assets/konoha-savings.png" alt="konoha savings" width="450"> |

---

## 📖 Setup & Usage Guides

* [Konoha Bridge Router Guide](docs/LLM-BRIDGE-GATEWAY.md)
* [Antigravity IDE Setup Guide](docs/SETUP-IDE.md)
* [Antigravity CLI Setup Guide](docs/SETUP-CLI.md)
* [Cursor IDE & CLI Setup Guide](docs/SETUP-CURSOR.md)
* [Claude Code Setup Guide](docs/SETUP-MCP-CLIENTS.md)
* [SearXNG Multi-Source Search](docs/SETUP-SEARXNG.md)
* [Adding Skills from skills.sh](docs/ADDING-SKILLS.md)
* [Token Savings Benchmarks](docs/BENCHMARK.md)
* [Troubleshooting Guide](docs/TROUBLESHOOTING.md)
* [System Architecture](docs/ARCHITECTURE.md)

## ⚠️ The Problem


| Component | Size | Context Overhead |
|:---|:---:|:---|
| `SKILL.md` Files (×5) | ~72 KB | Core agent instructions |
| Reference Guides (×88) | ~478 KB | API documentation, guides |
| Helper Scripts (×23) | ~547 KB | Utility code, automation |
| **Total Startup Payload** | **~1.1 MB** | **~800,000+ API tokens** |

> [!WARNING]
> This "disk-dump" approach wastes tokens on content that is irrelevant to the current task, inflates API usage bills, increases latency, and risks hitting LLM context window limits.

## 💡 The Solution

**Konoha** establishes a high-performance local SQLite FTS5 Model Context Protocol (MCP) server that:

1. **Indexes** all skill content (`SKILL.md` + references + scripts) into a full-text search database.
2. **Serves on-demand** — agents invoke `find_skill("keyword")` to retrieve only the matching ~4 KB content block.
3. **Optimizes context** — replaces the redundant "load SKILL.md → parse router → load reference" chain.

> [!TIP]
> **Optimization Result**: Konoha and Semble retrieve bounded, task-relevant context instead of full skill trees. See [BENCHMARK.md](docs/BENCHMARK.md) for historical snapshots and reproducible `konoha savings` output; latency and cost reductions are environment-dependent and are not guaranteed.

---
## ⚙️ How It Works

For a detailed breakdown of Konoha's internal mechanics, including system layers, data flows, and query lifecycle sequence diagrams, please see the [System Architecture Guide](docs/ARCHITECTURE.md).

### Workflow: Forced MCP Delegation

All non-trivial work on a Konoha-configured host **MUST** flow through the Konoha MCP and Semble MCP tools and be delegated to a konoha subagent — never executed solo by the main orchestrator.

- **Skill lookup** (`konoha.find_skill`, `konoha.get_skill`) — always via `konoha` MCP, never `semble`.
- **Codebase search** (`semble.search`, `semble.find_related`) — always via `semble` MCP, never `grep`/`rg`/`find`.
- **Bounded file reads** — `konoha.read_file_head` / `read_file_range` / `file_info` / `token_efficient_grep`, never generic `Read` / `Grep` / `Glob` / shell `cat`/`head`/`tail`.
- **Project Knowledge Discovery** — inspect project-local `README.md`, `docs/`, `CONTRIBUTING.md`, `.cursorrules`, `.clauderules`, and canonical project skills (`.agents/skills`, `skills/`) before executing code.
- **Package Manager Mandate** — ALWAYS use `pnpm` (never standalone `npx` or `npm`) for all JS/TS scaffolding, installs, and builds.
- **Subagent routing** — match the task domain to a ninja agent:
  - `@genin` — codebase exploration, codepath tracing
  - `@kage` — architecture, security, deep analysis
  - `@chunin` — web research, documentation synthesis
  - `@jonin` — UI/frontend across 4 frameworks (SvelteKit, Next.js 16, Nuxt 3, Angular v19+) using `pnpm` + Tailwind v4
  - `@anbu` — backend, bug fixing, DevOps
  - `@tokubetsu-jonin` — technical writing, docs, READMEs

**The main orchestrator MUST NOT execute implementation tasks itself — it only coordinates and delegates.** Trivial edits on a known file may run inline; everything else routes through a subagent.

---

## 🏗️ Multi-Agent Architecture: MCP Tools Orchestrator

Konoha uses an **MCP Tools Orchestrator Model** (Single-Thread Persona Adoption via MCP Tools), specifically engineered to deliver maximum performance, complete cross-IDE portability, and **83–98% token savings**.

> **Canonical editable diagram:** [08 Orchestrator Task Artifact Flow](docs/diagrams/konoha-architecture.drawio) · [Diagram manifest](docs/diagrams/README.md).

```mermaid
---
title: Konoha Orchestrator Task Artifact Flow
config:
  theme: base
  themeVariables:
    background: '#ffffff'
    primaryColor: '#ede9fe'
    primaryTextColor: '#1e1b4b'
    primaryBorderColor: '#7c3aed'
    lineColor: '#64748b'
    secondaryColor: '#d1fae5'
    tertiaryColor: '#dbeafe'
    fontFamily: 'Inter, system-ui, sans-serif'
    fontSize: '14px'
  flowchart:
    nodeSpacing: 45
    rankSpacing: 55
    padding: 24
    wrappingWidth: 380
---
flowchart TB
    Prompt["User Prompt / Resume"] --> Orchestrator["Primary Orchestrator<br/>(Main Agent)"]
    Orchestrator --> Read["1. Read prompt spec<br/>(Konoha bounded file tools)"]
    Orchestrator --> Discover["2. Discover skill + code<br/>(Konoha MCP + Semble MCP)"]
    Read --> Contract["3. Write delegate.md<br/>(Isolated task directory)"]
    Discover --> Contract
    Contract --> Agent["4. Selected Ninja Agent<br/>(genin-skill · kage · jonin · anbu · chunin · tokubetsu)"]
    Agent --> Result["5. Write result.md<br/>(Task findings)"]
    Result --> Close["6. sannin closes loop<br/>(Synthesize findings)"]
    Close --> Response["Synthesized Response"]

    classDef user fill:#dbeafe,stroke:#2563eb,color:#1e3a8a,stroke-width:2px
    classDef orchestration fill:#ede9fe,stroke:#7c3aed,color:#4c1d95,stroke-width:2px
    classDef mcp fill:#d1fae5,stroke:#059669,color:#065f46
    classDef artifact fill:#fef3c7,stroke:#d97706,color:#78350f
    class Prompt,Response user
    class Orchestrator,Close orchestration
    class Read,Discover mcp
    class Contract,Result artifact
    class Agent orchestration
```

### Architectural Comparison

| Dimension | 1. Agent-to-Agent (Process Spawning) | 2. MCP-to-MCP (Server-to-Server RPC) | 3. MCP Tools Orchestrator (Konoha Model) |
|:---|:---|:---|:---|
| **Execution Model** | Spawns separate LLM child processes (`invoke_subagent`). | One MCP Server calls another downstream MCP Server via backend RPC. | Subagents run as **MCP Tools** (`anbu`, `kage`); Orchestrator adopts persona dynamically. |
| **Token Efficiency** | ❌ **Poor**: High token bloat from duplicating system prompts & context (3x–10x token cost). | ⚠️ **Moderate**: Depends on RPC serialization payload size. | ✅ **Extreme (83–98% Savings)**: In-flight execution using bounded MCP context. |
| **Startup Latency** | ❌ **High**: 3–10 seconds of cold-start delay per child process launch. | ⚠️ **Moderate**: Network/IPC serialization hops between cascading servers. | ✅ **Near-Zero Latency**: Instant inline tool invocations and persona handoffs. |
| **Task Auditability** | ⚠️ Complex transcript aggregation across detached process trees. | ❌ Hidden backend execution; opaque to the client UI/user. | ✅ **Fully Transparent**: Human-readable task contracts (`delegate.md` & `result.md`). |

### Why Konoha Uses the MCP Tools Orchestrator Model

1. 🚀 **Zero Process Cold-Start**: Subagents execute in-flight as standard MCP tools without waiting for multi-second process initialization.
3. 🛡️ **Seamless Conversation Resumption**: Re-evaluates state and enforces subagent delegation workflow on every resume or multi-turn request.

---

## 🚀 Quick Start

### Automatic Dependency & Environment Provisioning

When installing Konoha globally, all required Node.js libraries, Python helper dependencies, SQLite FTS5 database schemas, file tools MCP, and client configs are automatically provisioned:

```bash
pnpm add --global konoha
konoha init
```

Konoha handles all setup steps automatically:
- 📦 **Node.js dependencies**: Installed via `package.json` (`@inquirer/prompts`, `@bufbuild/protobuf`, `playwright`, `figlet`, `gradient-string`, `chalk`).
- 🗄️ **SQLite FTS5 Skills Database**: Automatically compiled and initialized at `~/.konoha/skills.db`.
- 🔮 **Semble Codebase Search MCP**: Auto-configured via `uvx` for zero-setup deep code discovery.
- ⚙️ **File Tools & Prompt Hooks**: Deployed automatically to `~/.konoha/` and registered with client IDE config schemas.

> [!IMPORTANT]
> **Zero-Prompt Auto-Setup**:
>
> **Cross-Platform**: Works on Linux, macOS, and Windows (native and WSL). Supports nvm on all platforms.

Get Konoha up and running in under 2 minutes:

```bash
# 1. Initialize on any machine directly from GitHub
pnpm dlx github:andycungkrinx91/konoha init

# 2. Verify the MCP server connection works
konoha test

# 3. Check installation status and index database statistics
konoha status
```

> [!NOTE]

## 📋 Requirements

- **Node.js** ≥ 18 (via nvm, Homebrew, or system package)
- **Python 3** ≥ 3.8 (for MCP server, uses standard library only — no external pip packages required)
- **Agent skills** in `~/.agents/skills/` (with `SKILL.md` files); Konoha indexes and serves skill content through SQLite FTS5 without filesystem mirrors
- **Cross-platform**: Linux, macOS, Windows (native and WSL)

## 🛠️ CLI Commands

To run all commands simply as `konoha <command>`, install the package globally:

```bash
pnpm add --global github:andycungkrinx91/konoha
```

Once installed, the following CLI commands are available:

| Command | Description |
|:---|:---|
| `konoha init` | Full install: server + migration + MCP config + GEMINI.md |
| `konoha test` | Test MCP server with sample searches |
| `konoha status` | Show installation status and DB stats |
| `konoha version` | Display current local version (2.0.0) and check for updates from GitHub |
| `konoha upgrade` | Upgrade Konoha CLI to the latest version directly from GitHub |
| `konoha bridge status` | Show bridge router status and Antigravity session liveness (sidecar-gated bridges show `AWAITING SIDECAR` when IDE is closed) |
| `konoha bridge list` | List all configured bridges with port/provider/enabled state |
| `konoha savings` | Show token savings metrics (Today, 7 days, All time) for Skills-DB and Semble |
| `konoha doctor` | Diagnose environment health and automatically repair missing files |
| `konoha uninstall` | Remove Skills-DB (original skills untouched) |
| `konoha skill <subcommand>` | Manage custom skills (`list`, `search`, `add`, `remove`) |
| `konoha agent <subcommand>` | Manage subagent configurations (`list`, `create`, `skill`, `delete`, `status`) |
| `konoha bridge <subcommand>` | Manage Konoha Bridge Router (`status`, `list`, `create`, `delete`, `enable`, `disable`) |
| `konoha help` | Show help |


## 🛰️ Cross-Platform Install

Konoha works seamlessly on Linux, macOS, and Windows (native and WSL). Install commands are the same across all platforms:

```bash
pnpm add --global konoha
konoha init
```

If `konoha` is not found after install:
- **nvm on Linux/macOS**: `source ~/.nvm/nvm.sh` then `nvm use stable`
- **nvm-windows**: `nvm use <version>` then `pnpm add --global konoha`
- **Windows without nvm**: Reinstall Node.js from [nodejs.org](https://nodejs.org/) and ensure PATH is set

Full platform-specific guides: [SETUP-CLI.md](docs/SETUP-CLI.md), [SETUP-IDE.md](docs/SETUP-IDE.md), [SETUP-CURSOR.md](docs/SETUP-CURSOR.md), [SETUP-MCP-CLIENTS.md](docs/SETUP-MCP-CLIENTS.md).

### RTK (Rust Token Killer)

If `rtk` is installed on your system (`cargo install rtk`), Konoha auto-deploys RTK rules to all detected supported clients during `konoha init`:

| Client | RTK Rule Location |
|--------|-------------------|
| **Antigravity** | `~/.gemini/antigravity-cli/rules/rtk.md` + `~/.gemini/antigravity-ide/rules/rtk.md` |
| **Cursor** | `~/.cursor/rules/rtk.mdc` |
| **Claude Code** | `~/.claude/rules/rtk.md` |
| **OpenCode** | `~/.opencode/rules/rtk.md` |
| **Command Code** | `~/.commandcode/rules/rtk.md` |

This instructs agents to prefix all shell commands with `rtk <command>`, reducing token consumption by up to 90% on common operations. If `rtk` is not installed, Konoha skips this step gracefully.

**Automatic Setup:** During `konoha init`, Konoha runs `rtk init -g` globally to install the Claude Code hook automatically — no manual configuration needed. The RTK rule (`~/.claude/rules/rtk.md`) and hook are deployed alongside the MCP server setup.

---

## 🛰️ Konoha Bridge Router

Konoha ships a local **Konoha Bridge Router** on port **`19999`** that multiplexes requests across one or more inner **LLM Bridges**. The optional Antigravity IDE extension is refreshed from the live `master` branch into `~/.antigravity-ide/extensions/andycungkrinx91.konoha-bridge-master-universal/` and serves `127.0.0.1:1313`; it is never installed on CLI-only hosts. The router forwards requests to a bridge based on the model name prefix `<bridge-name>-<model-name>`, strips inbound `Authorization` / `x-api-key` / `x-konoha-gateway-*` headers, and forwards to `127.0.0.1:<bridge-port>`. Local clients never need to send an API key to the router.

Bridge configuration examples (bridges are registered manually by the user — the `bridges` table starts empty on install and is persisted in `~/.konoha/skills.db` via `src/db_bridges.py`):

Bridges are registered manually by the user (the tables start empty on install).

Examples:

- Ollama-compatible endpoint — default `http://localhost:11434/v1`
- OpenAI-compatible endpoint — provide your own API key

Configure bridges with `konoha bridge create` (interactive wizard). You can add multiple bridges for different providers:

| Bridge Name | Default Port | Provider | Behavior |
|:---|:---:|:---|:---|
| `gpt-api` | User-defined | `openai` | Direct proxy to OpenAI-compatible endpoints (e.g. `https://api.openai.com/v1`). |
| `my-ollama` | User-defined | `openai-compatible` | Proxy to local LLM instances (e.g. Ollama, vLLM). |

> **Note:** `openai-oauth` (device code flow) support was removed in v2.0.0. Use `openai` (API key) or `openai-compatible` bridges instead.

Model routing examples:

- `my-ollama-llama3` → gateway strips `my-ollama-`, forwards `llama3` to the inner bridge on its designated local port.
- `gpt-api-gpt-4o` → gateway routes to `gpt-api` bridge configured with your OpenAI API key.

Routing behavior: the gateway selects one enabled bridge per request and does not perform gateway-level round-robin retry after an error.

Full reference: [docs/LLM-BRIDGE-GATEWAY.md](docs/LLM-BRIDGE-GATEWAY.md)

## What Gets Installed

```
~/.gemini/
├── config/
│   └── mcp_config.json   ← konoha + semble MCP (Antigravity)
└── GEMINI.md              ← Orchestrator + subagent instructions

~/.konoha/
├── file_tools_launcher.js ← cross-platform Node resolver (preferred launcher)
├── file_tools_mcp.js      ← konoha MCP server (core skill+file ops)
├── file_tools_launcher.sh ← Shell wrapper for Cursor CLI sandbox
├── file_tools_router.js   ← In-process tool dispatch router
├── platform_utils.js      ← cross-OS path/Python helpers
├── .node_exec_path        ← recorded Node path (auto)
├── .python_cmd            ← recorded Python command (auto)
├── konoha-bridge.json     ← live master extension commit/path manifest (Antigravity IDE only)
├── file_tools/            ← Python streaming helpers (grep, read, search)
├── bridge/                ← Proxy Gateway bridge modules
├── server.py              ← Legacy Python skill worker (kept for backward compat)
├── migrate.py             ← Migration script
└── skills.db              ← SQLite FTS5 database (+ `agents`, `bridges` tables)

~/.cursor/
├── mcp.json               ← konoha + semble MCP (Cursor)
├── agents/                ← Official ninja subagents
├── hooks.json             ← sessionStart → cursor_bootstrap.js
└── cli-config.json        ← Cursor CLI MCP permissions

~/.claude/
├── settings.json          ← MCP auto-approval (all projects)
├── CLAUDE.md              ← Global orchestrator instructions (Claude Code)
├── agents/                ← Six ninja subagents (model: inherit)
└── rules/
    └── rtk.md             ← RTK rule (if rtk binary detected)
```

---

## Re-indexing After Skill Changes

Run `konoha migrate` whenever you add, edit, or remove skills:

```bash
konoha migrate
```


```bash
konoha migrate --force
```

This updates `skills.db`, refreshes all system instructions, and repairs detected client MCP/rule/subagent integrations automatically. Cursor skill content remains SQLite/Konoha MCP-backed; no `.cursor/skills/` mirror is created.

---

## MCP Tools Available

After installation, Konoha registers **2 MCP servers** that work together:

### konoha — Skill Knowledge Search & Token-Efficient File Operations

The unified `konoha` server exposes 21 tools for skill retrieval, bounded file operations, project scaffolding, and subagent delegation workflows:

#### `sannin(prompt?, task_dir?)`
The Sannin routing workflow tool. Resolves the task prompt, dynamically chooses the most suitable subagent to run, sets up the task directory, and executes the chosen subagent inline.

#### Subagent Delegation Tools (`kage`, `jonin`, `anbu`, `chunin`, `tokubetsu_jonin`, `genin`)
Executes the specified subagent inline under a task directory (`task_dir`), loading its system instructions and skill references dynamically.

#### `web_search(query, num_results?, search_depth?)`
Enterprise-grade web search with multi-query decomposition, authoritative domain ranking, and Wikipedia OpenSearch fallback. Automatically invoked by `chunin` for deep research.

#### `find_skill(keyword, limit?)`
Search skills by keyword using FTS5 full-text search.

```
find_skill("terraform aws")     → anbu-skill references
find_skill("sveltekit tailwind") → jonin-skill references
find_skill("code review")       → genin-skill references
```

#### `get_skill(name)`
Get full content of a specific skill/reference by exact name.

```javascript
get_skill("jonin-skill/svelte-code-expert")
get_skill("anbu-skill/terraform-aws-modules")
```

#### `list_skills()`
List all indexed skills and references with metadata.

#### `optimize_report(keyword?)`
Token-efficient skill discovery report with usage hints.

#### `build_with_image_design(name, source_dir, framework)`
Legacy alias for `build_from_source`, preserved for compatibility with existing clients.

#### `build_from_source(name, source_dir, framework)`
Scaffold from design mockups or reference source files (`.png`, `.html`, `.tsx`, etc.).

#### `build_from_text(name, description, framework)`
Scaffold from a text prompt using default premium templates.

#### Bounded File Tools
| Tool | Purpose | Token guard |
|------|---------|-------------|
| `read_file_head(path, max_lines?)` | Preview first N lines (default 80) | Max **200** lines |
| `read_file_range(path, start_line, end_line)` | Stream a line range with line numbers | Max **500** line span |
| `file_info(path)` | Size, line count, mtime — no content load | Metadata only |
| `token_efficient_grep(pattern, dir, glob?, ignore_case?)` | Compressed regex search | Max **20** matches (cap 50) |
| `get_file_structure(path)` | Class/function signatures only (no bodies) | AST (Python) / regex (JS/TS) |
| `find_files_clean(pattern, dir)` | Glob walk with blacklist | Skips `.git`, `node_modules`, `dist`, lockfiles |

> [!IMPORTANT]
> **All agents must use konoha** for skill lookups, file reads, and line grep — not Cursor `Read`/`Grep`/`Glob`, Antigravity `view_file`, or shell `cat`/`head`/`grep`. Workflow: **semble** (semantic code search) → **konoha** (skills & file operations).

### semble — Semantic Code Search (default)

The `semble` server provides AI-powered semantic code search across the entire codebase. Registered via `uvx --from semble[mcp]@latest semble`. **Use semble instead of built-in grep/glob/find or Cursor `Grep`/`Glob`/`SemanticSearch` for codebase discovery.**

> Semble by MinishLab — [@software{minishlab2026semble}](https://github.com/MinishLab/semble). Uses ~98% fewer tokens than grep+read.

#### `search(query)`
Semantic search across the codebase — understands code meaning, not just text matching.

#### `find_related(file_path)`
Find files semantically related to a given file — useful for understanding dependencies and impact.

---

## 🥷 Official Agent Team (Naruto Ninja Ranks)

The installer updates your configuration to define a cohesive, specialized team of **7 Naruto-ranked subagents**. Each agent represents a level of ninja hierarchy with clear responsibilities, preferred model tier, fallback settings, and tool access:

### 1. 🍃 Genin (Junior Scout)
* **Operational Role**: Codebase Reconnaissance & Scout
* **Model**: `Claude Sonnet 4.6 (Thinking)` (all subagents unified in v2.0.0)
* **Key Responsibilities**:
  - Fast, read-only code exploration.
  - Traces codepaths, maps dependencies, and analyzes repository structure.
  - *Constraint*: Must never write or modify files on the filesystem.
* **Skills-DB Keyword**: `code exploration tracing` (invokes scout-level heuristics on startup).

### 2. 📜 Chunin (Journeyman Intel Gatherer)
* **Operational Role**: Intel Gathering, Web Research, & Documentation Synthesis
* **Model**: `Claude Sonnet 4.6 (Thinking)` (all subagents unified in v2.0.0)
* **Key Responsibilities**:
  - Researches libraries, API specifications, version histories, and best practices.
  - Leverages semantic search (`semble`) to discover codebase context before executing web searches.
  - Batches parallel queries and ranks search results by credibility, freshness, and relevance.
  - Compiles comprehensive, citation-backed notes with full reference URLs.
* **Skills-DB Keyword**: `websearch deep research` (loads intel gathering methodologies).

### 3. 🛡️ Jonin (Elite Builder)
* **Operational Role**: UI/UX Master, Styling, & Component Architecture
* **Model**: `Claude Sonnet 4.6 (Thinking)` (all subagents unified in v2.0.0)
* **Key Responsibilities**:
  - Builds premium, visually stunning frontends (SvelteKit, Next.js, Tailwind v4, Magic UI, 3D web).
  - Enforces design tokens, custom typography, smooth gradients, and glassmorphism.
  - Performs design match comparisons using the `agent-browser` CLI.
  - Enforces the **Zero-Error Guarantee & Verification Loop** (running local installs, Svelte/Next syncs, check/lint diagnostics, and production builds to guarantee zero compilation errors/warnings before completion).
* **Skills-DB Keyword**: `sveltekit tailwind nextjs components` (fetches design standards).

### 4. 👥 Anbu (Special Black Ops)
* **Operational Role**: Backend Specialist, Bug Resolution, DevOps, & Cybersecurity Defense Engineer
* **Model**: `Claude Sonnet 4.6 (Thinking)` (all subagents unified in v2.0.0)
* **Key Responsibilities**:
  - Designs backend systems, database schemas, APIs (Node.js, Express, GraphQL, Laravel, WordPress, Magento, PHP, Ruby, C++).
  - Architectures distributed messaging and caching layers (Kafka, RabbitMQ, Redis, Nginx, HAProxy, Varnish).
  - Implements defensive cybersecurity forensics, threat hunting, and OWASP remediation (`anthropic-cybersecurity-skills`).
  - Provisions infrastructure (Terraform, Kubernetes, Helm) and manages secure CI/CD pipelines.
  - Formulates AI prompt engineering strategies (`prompt-engineer`) and creates/maintains agent skills (`skill-creator`).
* **Skills-DB Keyword**: `terraform aws kubernetes helm ci-cd security kafka redis prompt` (loads backend and defense recipes).

### 5. 🎯 Tokubetsu-jonin (Specialized Scribe)
* **Operational Role**: Technical Writing, Documentation, PDF Reporting, & Postmortems
* **Model**: `Claude Sonnet 4.6 (Thinking)` (all subagents unified in v2.0.0)
* **Key Responsibilities**:
  - Authors and maintains README files, API specifications, runbooks, and onboarding guides (`documentation-writer`).
  - Produces printable professional PDF reports and styled documentation exports (`pdf`).
  - Drafts incident postmortems, root cause analyses (RCA), and project retrospectives (`postmortem-writer`).
  - Writes technical blog articles, whitepapers, engineering tutorials, and content (`technical-article-writer`).
* **Skills-DB Keyword**: `documentation README API runbook postmortem pdf report article` (retrieves writing standards).

### 6. 🌀 Kage (Village Leader)
* **Operational Role**: Senior Architect, Strategist, & Deep Problem Solver
* **Model**: `Claude Sonnet 4.6 (Thinking)` (all subagents unified in v2.0.0)
* **Key Responsibilities**:
  - Guides high-level architecture decisions, security audits, and risk assessments (`risk-assessment`, `improve-codebase-architecture`).
  - Constructs professional architecture diagrams and visualizations (`drawio-skill`, `mermaid-diagrams`).
  - Orchestrates the entire subagent team for complex, multi-domain tasks.
* **Skills-DB Keyword**: `code review architecture devsecops drawio mermaid risk` (loads advanced architectural frameworks).

---

## 🛡️ Default Guardrails

To ensure safety, consistency, and predictable execution, the Antigravity system enforces several strict behavioral guardrails across all subagents:

> [!IMPORTANT]
> **Core Safety & Operational Policies:**
>
> * **Proactive Execution (No commanding back)**: Subagents must never instruct the user to manually create/edit files or run terminal commands that the agent is equipped to perform itself.
> * **Protected Configuration & Secrets**: All `.env`, `.tfvars`, and `secrets.yaml` files are strictly **read-only** by default. Subagents must explicitly request user permission before accessing or modifying these files.
> * **No Git Execution**: Subagents are strictly prohibited from executing any `git` commands (including `status`, `diff`, `log`). Use `semble` for code search; `konoha` for targeted reads/grep.
> * **Locked Subagent Delegation**: Subagent delegation is locked to the 7 official Konoha agents (`genin`, `kage`, `chunin`, `jonin`, `anbu`, `tokubetsu-jonin`, `sannin`). You cannot route tasks to shadow agents or unstructured personas. Never use Antigravity `@self` / `@research`. Creating custom subagents dynamically is prohibited.
> * **Orchestrator Pipeline (Antigravity)**: User prompt → `prompt.md` → orchestrator analyzes → `delegate.md` → Konoha subagent → `result.md` → user report. Main agent coordinates only — no direct project edits.
> * **Circuit Breaker**: Handoff loops are tracked via `depth` metadata in `delegate.md`. If depth exceeds **7**, execution freezes and prompts the user for manual validation.
> * **Rate Limit Fallback**: In the event of API rate limits, the orchestrator falls back to direct tool calls (executing edits, reads, and commands directly) instead of spawning additional subagents.

---

##

### 📊 Benchmark: Token Footprint & Optimization

The following charts demonstrate the context footprint savings per conversation session achieved by moving from full-disk loading to SQLite FTS5 on-demand retrieval:

#### Context Size Comparison (Lower is Better)

```text
Startup Payload Size (KB)
────────────────────────────────────────────────────────────
Baseline (Disk Load):  ██████████████████████████████  550 KB
Konoha (On-Demand):   █                              12 KB   (97.8% savings)
────────────────────────────────────────────────────────────
```

> **Canonical editable diagram:** [07 Token Footprint Comparison](docs/diagrams/konoha-architecture.drawio) · [Diagram manifest](docs/diagrams/README.md).

```mermaid
---
title: Token Footprint Before and After Konoha
config:
  theme: base
  themeVariables:
    background: '#ffffff'
    primaryColor: '#fee2e2'
    primaryTextColor: '#7f1d1d'
    primaryBorderColor: '#ef4444'
    lineColor: '#64748b'
    secondaryColor: '#d1fae5'
    tertiaryColor: '#fef3c7'
    fontFamily: 'Inter, system-ui, sans-serif'
    fontSize: '14px'
  flowchart:
    nodeSpacing: 45
    rankSpacing: 55
    padding: 24
    wrappingWidth: 380
---
flowchart TB
    subgraph Before ["Before: Folder-Level Loading"]
        Raw["Raw SKILL.md files"] --> References["All references and scripts"]
        References --> FullContext["Entire context window<br/>(Large repeated payload)"]
    end

    subgraph After ["After: On-Demand Retrieval"]
        Index["SQLite FTS5 index"] --> Query["find_skill(keyword)"]
        Query --> Relevant["Relevant bounded reference<br/>(Preview or full content)"]
    end

    Before --> Compare["Smaller query payload<br/>(97–99% token reduction)"]
    After --> Compare

    classDef waste fill:#fee2e2,stroke:#ef4444,color:#7f1d1d,stroke-width:2px
    classDef optimized fill:#d1fae5,stroke:#059669,color:#065f46,stroke-width:2px
    classDef decision fill:#fef3c7,stroke:#d97706,color:#78350f,stroke-width:2px
    class Raw,References,FullContext waste
    class Index,Query,Relevant optimized
    class Compare decision
```

📊 **Benchmark Comparison: Antigravity Session Metrics**

| Metric | Without Konoha + Semble (Baseline) | With Konoha + Semble (Optimized) | Impact / Savings |
| :--- | :---: | :---: | :---: |
| **Startup Context Load** | **~1.1 MB** (all SKILL.md rules + reference files loaded at start) | **~0 KB** (instructions are lazy-loaded on-demand via MCP) | **~100% startup context reduction** |
| **Single Search Query Payload** | **50 KB+** (entire files loaded/dumped) | **~4 KB - 12 KB** (precise matches returned) | **83% - 98% token reduction** per query |
| **Active Workspace Calls** | — | **~2,904 calls** | — |
| **Context Data Saved** | — | **~302 MB** | — |
| **Active Tokens Saved** | 0 (baseline) | **~110M tokens** | **~110M tokens saved** |
| **Response Latency** | Environment-dependent | Not measured by the repository test suite | No fixed claim |
| **API Cost Footprint** | Provider/model-dependent | Not measured by the repository test suite | No fixed claim |

**Historical workspace snapshot** (captured 2026-06-23; not a universal benchmark):
- **Combined Token Savings**: **~110M tokens saved** all-time across ~2,904 MCP calls (~302 MB of context data saved).
- **Skills-DB (konoha) Efficiency**: **97–99% reduction** per query (~79.1M tokens saved across 2,064 calls).
- **Semble MCP Efficiency**: **96% reduction** average per search query (~30.8M tokens saved across 840 calls).
- **Response latency**: not measured by this repository’s reproducible test suite and varies by client, model, network, and prompt.
- **API cost**: not measured by this repository’s reproducible test suite and varies by provider/model pricing.

> [!TIP]
> Read the complete [Token Savings & Optimization Benchmark Report](docs/BENCHMARK.md) for full metrics breakdown and analysis.

### 🔄 Token-Efficient File-Based Delegation

Konoha implements a transient file-based Markdown communication protocol for Antigravity orchestration:

| Step | Actor | File |
|------|-------|------|
| 1 | `prompt_hook.js` | `prompt.md` (user request) |
| 2 | Orchestrator | reads `prompt.md`, discovers skills/code |
| 3 | Orchestrator | writes `delegate.md` under `~/.konoha/tmp/<client>/<session>/scratch/tasks/<task_id>/` (resolved by an internal orchestrator helper) — **never** inside the project workspace, so transient agent files cannot be accidentally committed |
| 4 | Subagent | reads `delegate.md`, executes, writes `result.md` |
| 5 | Orchestrator | reads `result.md`, reports to user, cleans up |

* **Structured Context Isolation**: Subagents do not inherit the full parent chat — they read `delegate.md` (Goal, Context, Constraints) only.
* **Substantial Savings**: Isolated subagent context yields up to **95%+ token savings** per invocation.
* **Recursive Loop Circuit Breaker**: `depth` in `delegate.md` YAML frontmatter; circuit breaks at **depth > 7**.

### Skill Resolution

When a subagent runs, `run_mcp_agent` resolves skills in three layers:

1. **Exact match** — `agents.skills` (per-agent YAML) is queried against `skills.skill_name` and `references.name`.
2. **Fuzzy match** — if a skill name has no exact hit, Levenshtein distance ≤ 3 finds close names. Example: `devsecops-enginer` → `devsecops-engineer`.
3. **Prompt-driven autoload** — when the agent's `skills` list is empty, the prompt is tokenized and matched against `skill_name` + the first 200 chars of each skill's content. The top 3 token-coverage matches are auto-loaded and embedded into the agent instructions.

The mismatch is reported on stderr (`fuzzy-resolved skill 'x' -> 'y'`) so the orchestrator can spot recurring typos and update the YAML.

### Workspace Hygiene

Transient subagent scratch directories (`delegate.md`, `plan.md`, `result.md`, etc.) are written **outside** the project tree at `~/.konoha/tmp/<client>/<session>/scratch/tasks/<task_id>/`. If `~/.konoha` is not writable, the resolver falls back to `/tmp/konoha-<pid>-<ts>/`. The path is **never** rooted under `WORKSPACE_ROOT`, so `git add .` cannot accidentally commit agent scratch files. This is enforced by `src/test_scratch_path.py`.

### Detailed Before vs After Comparison

For an in-depth breakdown of system behavior, token consumption, configuration fragmentation, and architectural overhead, please read the [Detailed Before vs After Comparison](docs/BENCHMARK.md#detailed-before-vs-after-comparison) section in the Benchmark Report.


## Credits

Special thanks to [Semble](https://github.com/MinishLab/semble) by MinishLab for providing the powerful semantic code search capability that forms the second half of Konoha's optimization stack.

Special thanks to [RTK (Rust Token Killer)](https://github.com/reachingforthejack/rtk) for providing the high-performance CLI proxy that filters and summarizes command outputs before they reach the LLM context, completing Konoha's token-efficient stack alongside Semble and the konoha MCP.

**Citation:** If you use Konoha in academic research, please also cite Semble as follows:

```bibtex
@software{minishlab2026semble,
  author       = {{van Dongen}, Thomas and Stephan Tulkens},
  title        = {Semble: Fast and Accurate Code Search for Agents},
  year         = {2026},
  url          = {https://github.com/MinishLab/semble},
  organization = {MinishLab}
}
```

## License

MIT © 2026 [Andy Setiyawan | The shadow ninja with coffee](https://www.linkedin.com/in/andy-setiyawan-452396170/)
