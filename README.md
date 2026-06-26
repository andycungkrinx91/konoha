<p align="center">
  <img src="assets/konoha_logo_kyubi.png" alt="Konoha Logo" width="320">
</p>

[![Antigravity](https://img.shields.io/badge/Antigravity-IDE%20%7C%20CLI-7c3aed?logo=rocket&logoColor=white)](README.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20macOS%20%7C%20Windows-informational)](README.md)
[![Python](https://img.shields.io/badge/Python-%E2%89%A5%203.8-3776AB?logo=python&logoColor=white)](README.md)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A5%2018-339933?logo=node.js&logoColor=white)](README.md)
[![MCP Tools](https://img.shields.io/badge/MCP%20Servers-3%20%7C%2018%20Tools-10b981)](README.md)
[![Token Savings](https://img.shields.io/badge/Token%20Savings-83--98%25-9ece6a)](README.md)

> SQLite FTS5 Skills-DB for Antigravity, Cursor, Claude Code, and OpenCode — on-demand skill content via MCP, reducing token usage by **83-98%**.

---

## 📸 Preview

* **Latest Security Compliance:** [Google Policy Compliance v1.1.6](docs/SecurityCompliance/security_compliance_report_google_policy_1.1.6_2026-06-26.md)

| | |
|:---:|:---:|
| **📊 Database Status (`konoha status`)**<br><img src="assets/konoha-status.png" alt="konoha status" width="450"> | **🥷 Subagent Team Status (`konoha agent status`)**<br><img src="assets/konoha-agent-status.png" alt="konoha agent status" width="450"> |
| **📜 Installed Skills List (`konoha skill list`)**<br><img src="assets/konoha-skill-list.png" alt="konoha skill list" width="450"> | **📈 Token Savings Dashboard (`konoha savings`)**<br><img src="assets/konoha-savings.png" alt="konoha savings" width="450"> |

---

## 📖 Setup & Usage Guides

* [LLM Bridge & Proxy Gateway Guide](docs/LLM-BRIDGE-GATEWAY.md)
* [Antigravity IDE Setup Guide](docs/SETUP-IDE.md)
* [Antigravity CLI Setup Guide](docs/SETUP-CLI.md)
* [Cursor IDE & CLI Setup Guide](docs/SETUP-CURSOR.md)
* [Claude Code, OpenCode & MCP Clients](docs/SETUP-MCP-CLIENTS.md)
* [Adding Skills from skills.sh](docs/ADDING-SKILLS.md)
* [Token Savings Benchmarks](docs/BENCHMARK.md)
* [Troubleshooting Guide](docs/TROUBLESHOOTING.md)

## ⚠️ The Problem

When using agent skills with Antigravity IDE/CLI, Cursor IDE/CLI, Claude Code, or OpenCode, the entire directory of `SKILL.md` files, reference documents, and auxiliary scripts is loaded directly into the starting conversation window. For a typical workspace configuration containing 5 custom skills:

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
> **Optimization Result**: Context size is reduced to **~12 KB** per query instead of **~550 KB** per session — achieving a **98% token reduction** and **42% faster response times**.

---
## ⚙️ How It Works

For a detailed breakdown of Konoha's internal mechanics, including system layers, data flows, and query lifecycle sequence diagrams, please see the [System Architecture Guide](docs/ARCHITECTURE.md).

---

## 🚀 Quick Start

> [!IMPORTANT]
> **Auto-Setup with Interactive Consent**:
> Starting with version `1.0.9`, Konoha features an auto-setup routine with built-in interactive `@inquirer/prompts` flows to comply with Google Policy. Running *any* `konoha` command (or launching the CLI for the first time) automatically triggers the bootstrap sequence. However, to ensure user consent, the CLI will interactively prompt you with Yes/No questions before modifying any `~/.gemini` configurations or configuring permanent auto-approval permissions for MCP tools.

Get Konoha up and running in under 2 minutes:

```bash
# 1. Initialize on any machine directly from GitHub
npx github:andycungkrinx91/konoha init

# 2. Verify the MCP server connection works
konoha test

# 3. Check installation status and index database statistics
konoha status
```

> [!NOTE]
> For step-by-step IDE integration, see the [Antigravity IDE Setup Guide](docs/SETUP-IDE.md), [Antigravity CLI Setup Guide](docs/SETUP-CLI.md), [Cursor IDE & CLI Setup Guide](docs/SETUP-CURSOR.md), or [Claude Code, OpenCode & MCP Clients](docs/SETUP-MCP-CLIENTS.md).

## 📋 Requirements

- **Node.js** ≥ 18
- **Python 3** ≥ 3.8 (for MCP server, uses standard library only — no external pip packages required)
- **Antigravity IDE** or **Antigravity CLI** (agy), **Cursor IDE / Cursor CLI**, and/or **Claude Code** / **OpenCode** (optional — auto-configured when CLI is detected)
- **Agent skills** in `~/.agents/skills/` (with `SKILL.md` files); Cursor users also get `~/.cursor/skills/` mirrored automatically

## 🛠️ CLI Commands

To run all commands simply as `konoha <command>`, install the package globally:

```bash
npm install -g github:andycungkrinx91/konoha
```

Once installed, the following CLI commands are available:

| Command | Description |
|:---|:---|
| `konoha init` | Full install: server + migration + MCP config + GEMINI.md |
| `konoha migrate` | Re-index skills (run after editing skills) |
| `konoha test` | Test MCP server with sample searches |
| `konoha status` | Show installation status and DB stats |
| `konoha version` | Display current local version (1.1.6) and check for updates from GitHub |
| `konoha upgrade` | Upgrade Konoha CLI to the latest version directly from GitHub |
| `konoha savings` | Show token savings metrics (Today, 7 days, All time) for Skills-DB and Semble |
| `konoha doctor` | Diagnose environment health and automatically repair missing files |
| `konoha uninstall` | Remove Skills-DB (original skills untouched) |
| `konoha skill <subcommand>` | Manage custom skills (`list`, `search`, `add`, `remove`) |
| `konoha agent <subcommand>` | Manage subagent configurations (`list`, `create`, `models`, `skill`, `delete`, `status`) |
| `konoha models <subcommand>` | Manage available LLM models and assign them to subagents |
| `konoha bridge <subcommand>` | Manage LLM bridge proxy gateway (`status`, `list`, `create`, `delete`, `enable`, `disable`) |
| `konoha help` | Show help |


## What Gets Installed

```
~/.gemini/
├── config/
│   └── mcp_config.json   ← skills-db + semble + konoha-files MCP (Antigravity)
└── GEMINI.md              ← Orchestrator + subagent instructions

~/.konoha/
├── server.py          ← skills-db MCP (Python, stdlib only)
├── file_tools_mcp.js  ← konoha-files MCP (Node orchestration)
├── file_tools_launcher.js ← cross-platform MCP launcher
├── file_tools_router.js
├── platform_utils.js  ← cross-OS path/Python helpers
├── .node_exec_path    ← recorded Node path (auto)
├── .python_cmd        ← recorded Python command (auto)
├── file_tools/        ← Python streaming helpers
├── bridge/            ← LLM Bridge and Proxy Gateway runtime modules
├── migrate.py         ← Migration script
└── skills.db          ← SQLite FTS5 database

~/.cursor/
├── mcp.json               ← skills-db + semble + konoha-files MCP (Cursor)
├── agents/                ← Six ninja subagents (model: inherit)
├── skills/                ← Agent skills (mirrored from ~/.agents/skills/)
├── hooks.json             ← sessionStart → cursor_bootstrap.js
└── cli-config.json        ← Cursor CLI MCP permissions

~/.claude.json             ← skills-db + semble + konoha-files (Claude Code, global only)
~/.config/opencode/
└── opencode.json          ← skills-db + semble + konoha-files (OpenCode, global only)
```

---

## Re-indexing After Skill Changes

If you add, edit, or remove skills:

```bash
konoha migrate
```

This re-scans `~/.agents/skills/` and updates the database. It's idempotent — safe to run repeatedly. `konoha skill add` and `konoha doctor --yes` also refresh the Cursor skills mirror (`~/.cursor/skills/` and project `.cursor/skills/` when deployed).

## Cross-Platform Notes

Konoha runs on **Linux**, **macOS**, and **Windows**. The installer auto-detects Python (`python3`, `python`, or `py -3` on Windows), Node (`process.execPath` + `file_tools_launcher.js`), and `uv`/`uvx` paths.

| OS | Python | Konoha paths | konoha-files launcher |
|----|--------|--------------|----------------------|
| Linux | `python3` | `~/.konoha/` | `node file_tools_launcher.js` |
| macOS | `python3` | `~/.konoha/` | `node file_tools_launcher.js` |
| Windows | `py -3` / `python` | `%USERPROFILE%\.konoha\` | `node file_tools_launcher.js` |

Recorded at install time: `~/.konoha/.node_exec_path`, `.python_cmd`. Run `konoha doctor --yes` to repair after OS or Node/Python upgrades.

---

## MCP Tools Available

After installation, Konoha registers **3 MCP servers** that work together:

### skills-db — Skill Knowledge Search

The `skills-db` server exposes 6 tools for on-demand skill retrieval and project scaffolding:

#### `find_skill(keyword, limit?)`
Search skills by keyword using FTS5 full-text search.

```
find_skill("terraform aws")     → anbu-skill references
find_skill("sveltekit tailwind") → jonin-skill references
find_skill("code review")       → genin-skill references
```

Returns top 3 matches with 4KB content previews. Truncated results include a hint to use `get_skill()` for full content.

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

#### `build_from_source(name, source_dir, framework)`
Scaffold from design mockups or reference source files (`.png`, `.html`, `.tsx`, etc.).

#### `build_from_text(name, description, framework)`
Scaffold from a text prompt using default premium templates.

### semble — Semantic Code Search (default)

The `semble` server provides AI-powered semantic code search across the entire codebase. Registered via `uvx --from semble[mcp]@latest semble`. **Use semble instead of built-in grep/glob/find or Cursor `Grep`/`Glob`/`SemanticSearch` for codebase discovery.**

#### `search(query)`
Semantic search across the codebase — understands code meaning, not just text matching.

```javascript
semble.search("authentication middleware")  → relevant code files
semble.search("database connection pool")   → connection handling code
```

#### `find_related(file_path)`
Find files semantically related to a given file — useful for understanding dependencies and impact.

> [!IMPORTANT]
> **All agents must use `semble` for semantic code discovery** — not built-in grep/glob, shell `grep`/`rg`/`find`, or Cursor `Grep`/`Glob`/`SemanticSearch`. Use `rg` only if semble MCP is unavailable after retry.

### konoha-files — Token-Efficient File Tools

The `konoha-files` server (Node.js orchestration + Python workers) provides capped, context-safe file operations. Registered via `node ~/.konoha/file_tools_launcher.js` (cross-platform; resolves Node from `.node_exec_path`).

| Tool | Purpose | Token guard |
|------|---------|-------------|
| `read_file_head(path, max_lines?)` | Preview first N lines (default 80) | Max **200** lines |
| `read_file_range(path, start_line, end_line)` | Stream a line range with line numbers | Max **500** line span |
| `file_info(path)` | Size, line count, mtime — no content load | Metadata only |
| `token_efficient_grep(pattern, dir, glob?, ignore_case?)` | Compressed regex search | Max **20** matches (cap 50) |
| `get_file_structure(path)` | Class/function signatures only (no bodies) | AST (Python) / regex (JS/TS) |
| `find_files_clean(pattern, dir)` | Glob walk with blacklist | Skips `.git`, `node_modules`, `dist`, lockfiles |

> [!IMPORTANT]
> **All agents must use konoha-files** for file reads and line grep — not Cursor `Read`/`Grep`/`Glob`, Antigravity `view_file`, or shell `cat`/`head`/`grep`. Workflow: **semble** → **konoha-files**.

---

## 🥷 Official Agent Team (Naruto Ninja Ranks)

The installer updates your configuration to define a cohesive, specialized team of **6 Naruto-ranked subagents**. Each agent represents a level of ninja hierarchy with clear responsibilities, preferred model tier, fallback settings, and tool access:

### 1. 🍃 Genin (Junior Scout)
* **Operational Role**: Codebase Reconnaissance & Scout
* **Primary Model**: `Gemini 3.1 Flash-Lite`
* **Key Responsibilities**:
  - Fast, read-only code exploration.
  - Traces codepaths, maps dependencies, and analyzes repository structure.
  - *Constraint*: Must never write or modify files on the filesystem.
* **Skills-DB Keyword**: `code exploration tracing` (invokes scout-level heuristics on startup).

### 2. 📜 Chunin (Journeyman Intel Gatherer)
* **Operational Role**: Intel Gathering, Web Research, & Documentation Synthesis
* **Primary Model**: `Gemini 3.5 Flash (Low)` | **Fallback**: `Gemini 3.1 Flash-Lite`
* **Key Responsibilities**:
  - Researches libraries, API specifications, version histories, and best practices.
  - Leverages semantic search (`semble`) to discover codebase context before executing web searches.
  - Batches parallel queries and ranks search results by credibility, freshness, and relevance.
  - Compiles comprehensive, citation-backed notes with full reference URLs.
* **Skills-DB Keyword**: `websearch deep research` (loads intel gathering methodologies).

### 3. 🛡️ Jonin (Elite Builder)
* **Operational Role**: UI/UX Master, Styling, & Component Architecture
* **Primary Model**: `Gemini 3.5 Flash (High)` | **Fallback**: `Gemini 3.1 Flash-Lite`
* **Key Responsibilities**:
  - Builds premium, visually stunning frontends (SvelteKit, Next.js, Tailwind v4, Magic UI, 3D web).
  - Enforces design tokens, custom typography, smooth gradients, and glassmorphism.
  - Performs design match comparisons using the `agent-browser` CLI.
  - Enforces the **Zero-Error Guarantee & Verification Loop** (running local installs, Svelte/Next syncs, check/lint diagnostics, and production builds to guarantee zero compilation errors/warnings before completion).
* **Skills-DB Keyword**: `sveltekit tailwind nextjs components` (fetches design standards).

### 4. 👥 Anbu (Special Black Ops)
* **Operational Role**: Backend Specialist, Bug Resolution, & DevOps Engineer
* **Primary Model**: `Gemini 3.1 Pro (High)` | **Fallback**: `Gemini 3.1 Flash-Lite`
* **Key Responsibilities**:
  - Designs backend systems, database schemas, and robust API endpoints.
  - Diagnoses complex runtime bugs, memory leaks, and environment failures.
  - Provisions infrastructure (Terraform, Kubernetes, Helm) and manages secure CI/CD pipelines.
  - Validates changes with dry-runs and establishes structured rollback procedures.
* **Skills-DB Keyword**: `terraform aws kubernetes helm ci-cd` (loads deployment recipes).

### 5. 🎯 Tokubetsu-jonin (Specialized Scribe)
* **Operational Role**: Technical Writing, Documentation, & API Specification
* **Primary Model**: `Gemini 3.1 Flash-Lite`
* **Key Responsibilities**:
  - Authors and maintains README files, API documentations, runbooks, and onboarding guides.
  - Emphasizes reader-first principles, clean code blocks, and visual diagrams.
* **Skills-DB Keyword**: `documentation README API runbook` (retrieves writing standards).

### 6. 🌀 Kage (Village Leader)
* **Operational Role**: Senior Architect, Strategist, & Deep Problem Solver
* **Primary Model**: `Gemini 3.1 Pro (High)` | **Fallback**: `Gemini 3.1 Flash-Lite`
* **Key Responsibilities**:
  - Guides high-level architecture decisions, security audits, and risk assessments.
  - Constructs trade-off matrices and designs disaster recovery/rollback strategies.
  - Orchestrates the entire subagent team for complex, multi-domain tasks.
* **Skills-DB Keyword**: `code review architecture devsecops` (loads advanced architectural frameworks).

---

## 🛡️ Default Guardrails

To ensure safety, consistency, and predictable execution, the Antigravity system enforces several strict behavioral guardrails across all subagents:

> [!IMPORTANT]
> **Core Safety & Operational Policies:**
>
> * **Proactive Execution (No commanding back)**: Subagents must never instruct the user to manually create/edit files or run terminal commands that the agent is equipped to perform itself.
> * **Protected Configuration & Secrets**: All `.env`, `.tfvars`, and `secrets.yaml` files are strictly **read-only** by default. Subagents must explicitly request user permission before accessing or modifying these files.
> * **No Git Execution**: Subagents are strictly prohibited from executing any `git` commands (including `status`, `diff`, `log`). Use `semble` for code search; `konoha-files` for targeted reads/grep; `rg` only if semble MCP is unavailable.
> * **Locked Subagent Delegation**: Subagent delegation is locked to the 6 official Konoha agents (`genin`, `kage`, `chunin`, `jonin`, `anbu`, `tokubetsu-jonin`). Never use Antigravity `@self` / `@research`. Creating custom subagents dynamically is prohibited.
> * **Orchestrator Pipeline (Antigravity)**: User prompt → `prompt.md` → orchestrator analyzes → `delegate.md` → Konoha subagent → `result.md` → user report. Main agent coordinates only — no direct project edits except quota fallback.
> * **Circuit Breaker**: Handoff loops are tracked via `depth` metadata in `delegate.md`. If depth exceeds **7**, execution freezes and prompts the user for manual validation.
> * **Quota Fallback**: In the event of API rate limits or `429 / RESOURCE_EXHAUSTED` errors, the system will fallback to `Gemini 3.1 Flash-Lite` and use direct tool calls instead of spawning additional subagents.

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

```mermaid
---
title: Token Footprint — Before vs After
---
flowchart LR
    %% ── Style Definitions ──────────────────────────────────────
    classDef stepBad fill:#2d202f,stroke:#f7768e,stroke-width:1px,color:#fca5a5;
    classDef stepGood fill:#1a2e1a,stroke:#9ece6a,stroke-width:1px,color:#bbf7d0;
    classDef metricBad fill:#f7768e,stroke:#f7768e,stroke-width:2px,color:#1a1b26;
    classDef metricGood fill:#9ece6a,stroke:#9ece6a,stroke-width:2px,color:#1a1b26;
    classDef verdict fill:#7c3aed,stroke:#a78bfa,stroke-width:2px,color:#f5f3ff;

    %% ── Before Path (Wasteful) ─────────────────────────────────
    subgraph BEFORE ["Before — Raw Disk Loading"]
        direction LR
        B1("Load SKILL.md files<br>72 KB") -->|"roundtrip 1"| B2("Parse router table<br>overhead")
        B2 -->|"roundtrip 2"| B3("Load reference files<br>478 KB")
        B3 -->|"roundtrip 3"| B4("Load scripts<br>547 KB")
    end
    B4 --> B_Total(["Total: 1.1 MB / session"])

    %% ── After Path (Optimized) ─────────────────────────────────
    subgraph AFTER ["After — Konoha FTS5 On-Demand"]
        direction LR
        A1("Agent calls find_skill") -->|"single roundtrip"| A2("FTS5 BM25 search<br>SQLite query")
    end
    A2 --> A_Total(["Total: 4-12 KB / query"])

    %% ── Verdict ────────────────────────────────────────────────
    B_Total --> Savings{"98% Token Reduction"}
    A_Total --> Savings

    %% ── Apply Styles ──────────────────────────────────────────
    class B1,B2,B3,B4 stepBad
    class B_Total metricBad
    class A1,A2 stepGood
    class A_Total metricGood
    class Savings verdict
```

📊 **Benchmark Comparison: Antigravity Session Metrics**

| Metric | Without Konoha + Semble (Baseline) | With Konoha + Semble (Optimized) | Impact / Savings |
| :--- | :---: | :---: | :---: |
| **Startup Context Load** | **~1.1 MB** (all SKILL.md rules + reference files loaded at start) | **~0 KB** (instructions are lazy-loaded on-demand via MCP) | **~100% startup context reduction** |
| **Single Search Query Payload** | **50 KB+** (entire files loaded/dumped) | **~4 KB - 12 KB** (precise matches returned) | **83% - 98% token reduction** per query |
| **Active Workspace Calls** | — | **~2,904 calls** | — |
| **Context Data Saved** | — | **~302 MB** | — |
| **Active Tokens Saved** | 0 (baseline) | **~110M tokens** | **~110M tokens saved** |
| **Response Latency** | Baseline (100%) | **~58%** (42% faster response times) | **~42% speed improvement** |
| **API Cost Footprint** | Baseline (100%) | **~5%** (95% cost reduction) | **~95% token cost savings** |

**Real-world Savings** (live metrics from `konoha savings`, captured 2026-06-23):
- **Combined Token Savings**: **~110M tokens saved** all-time across ~2,904 MCP calls (~302 MB of context data saved).
- **Skills-DB (konoha) Efficiency**: **97–99% reduction** per query (~79.1M tokens saved across 2,064 calls).
- **Semble MCP Efficiency**: **96% reduction** average per search query (~30.8M tokens saved across 840 calls).
- **Response Latency Reduction**: **~42% faster** agent responses due to minimized input context parsing.
- **API Cost Reduction**: **~95% reduction** in API token fees per agent session.

> [!TIP]
> Read the complete [Token Savings & Optimization Benchmark Report](docs/BENCHMARK.md) for full metrics breakdown and analysis.

### 🔄 Token-Efficient File-Based Delegation

Konoha implements a transient file-based Markdown communication protocol for Antigravity orchestration:

| Step | Actor | File |
|------|-------|------|
| 1 | `prompt_hook.js` | `prompt.md` (user request) |
| 2 | Orchestrator | reads `prompt.md`, discovers skills/code |
| 3 | Orchestrator | writes `scratch/tasks/<task_id>/delegate.md` |
| 4 | Subagent | reads `delegate.md`, executes, writes `result.md` |
| 5 | Orchestrator | reads `result.md`, reports to user, cleans up |

* **Structured Context Isolation**: Subagents do not inherit the full parent chat — they read `delegate.md` (Goal, Context, Constraints) only.
* **Substantial Savings**: Isolated subagent context yields up to **95%+ token savings** per invocation.
* **Recursive Loop Circuit Breaker**: `depth` in `delegate.md` YAML frontmatter; circuit breaks at **depth > 7**.

### Detailed Before vs After Comparison

For an in-depth breakdown of system behavior, token consumption, configuration fragmentation, and architectural overhead, please read the [Detailed Before vs After Comparison](docs/BENCHMARK.md#detailed-before-vs-after-comparison) section in the Benchmark Report.


## Credits

Special thanks to [semble](https://github.com/MinishLab/semble) by MinishLab for providing the powerful semantic search capability that forms the second half of Konoha's optimization stack.

## License

MIT © 2026 [Andy Setiyawan | The shadow ninja with coffee](https://www.linkedin.com/in/andy-setiyawan-452396170/)
