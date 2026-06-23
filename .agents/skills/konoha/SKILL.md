---
name: konoha-maintenance
description: Guidelines and instructions for maintaining, extending, and debugging the Konoha SQLite FTS5 Skills-DB system.
---

# Konoha Maintenance Skill

This skill contains the structural guidelines, command specifications, and architectural rules for maintaining and developing the **Konoha** SQLite FTS5 Skills-DB application.

## System Architecture

Konoha optimizes AI agent token usage by replacing massive folder-level context loading with SQLite FTS5 on-demand full-text search.

```mermaid
graph TB
    %% Styling Configuration
    classDef presentation fill:#0f172a,stroke:#38bdf8,stroke-width:2px,color:#f8fafc;
    classDef orchestration fill:#1e293b,stroke:#475569,stroke-width:2px,color:#e2e8f0;
    classDef cognitive fill:#1e1b4b,stroke:#6366f1,stroke-width:2px,color:#f8fafc;
    classDef modelLayer fill:#311b92,stroke:#651fff,stroke-width:2px,color:#f8fafc;
    classDef middleware fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#f8fafc;
    classDef persistence fill:#451a03,stroke:#f97316,stroke-width:2px,color:#f8fafc;
    classDef mgmt fill:#172554,stroke:#3b82f6,stroke-width:2px,color:#dbeafe;

    %% Subgraphs for Layered Architecture
    subgraph Layer1 ["1. Presentation & Control Layer"]
        User["👤 End User"]
        IDE["💻 Antigravity IDE / CLI"]
    end

    subgraph Layer15 ["1.5 Management & Configuration Layer"]
        CLI["🛠️ Konoha CLI<br>(init, migrate, upgrade, models, skill, agent)"]
        AgentConfig["📄 Subagent Config<br>(~/.agents/agents.json)"]
        MCPConfig["📄 MCP Config<br>(mcp_config.json)"]
    end

    subgraph Layer2 ["2. Cognitive Agent Layer"]
        Router{"🔀 Orchestrator <br/> (Main Agent)"}
        
        subgraph Subagents ["Specialized Ninja Agents"]
            Genin["🍃 Genin <br/> (Scout)"]
            Chunin["📜 Chunin <br/> (Intel)"]
            Jonin["🛡️ Jonin <br/> (UI Builder)"]
            Anbu["👥 Anbu <br/> (Ops/DevOps)"]
            Tokubetsu["🎯 Tokubetsu <br/> (Scribe)"]
            Kage["🌀 Kage <br/> (Architect)"]
        end
    end

    subgraph Layer25 ["2.5 Model Execution & Fallback Layer"]
        Registry["🤖 LLM Model Registry <br/> (Gemini, Claude, GPT)"]
        Fallback{"⚠️ Fallback Router <br/> (Fail -> Gemini 3.1 Flash-Lite)"}
        QuotaLimit["🛑 Quota Exhaustion? <br/> (Warning & Recovery Guide)"]
    end

    subgraph Layer3 ["3. Context Middleware Layer (MCP)"]
        Server["⚙️ skills-db MCP Server <br/> (stdio / JSON-RPC 2.0)"]
    end

    subgraph Layer4 ["4. Persistence & Search Layer"]
        DB[("🗄️ SQLite Database <br/> $HOME/.gemini/skills-db/skills.db")]
        FTS5["🔍 SQLite FTS5 <br/> Full-Text Index"]
    end

    %% Workflow Connections
    User -->|Prompts| IDE
    IDE -->|Rules Evaluation| Router
    
    %% CLI and Configuration flow
    CLI -->|Updates configuration| MCPConfig
    CLI -->|Manages agents/models| AgentConfig
    CLI -->|Triggers index/migration| DB
    IDE -->|Loads MCP servers| MCPConfig
    Router -->|Reads agent definitions| AgentConfig
    
    Router -->|1. find_skill (Discover)| Server
    Router -->|2. Delegate Task| Genin & Chunin & Jonin & Anbu & Tokubetsu & Kage
    
    Subagents -->|3. Base Skill + Extra| Server
    Server -->|Read / Search| DB
    DB -->|External Content Map| FTS5
    
    %% Model Execution Workflow
    Subagents -->|Execute Prompts| Registry
    Registry -->|Quota Error / 429| Fallback
    Fallback -->|Route to Fallback Model| Registry
    Fallback -->|Total Exhaustion| QuotaLimit
    QuotaLimit -->|Instruct User| User
    
    Server -->|Precise Snippet about 4KB Payload| IDE
    IDE -->|Context-Aware Response| User

    %% Alignment Layout Link
    IDE -.- Server

    %% Class Assigning
    class User,IDE presentation;
    class Router orchestration;
    class Genin,Chunin,Jonin,Anbu,Tokubetsu,Kage cognitive;
    class Registry,Fallback,QuotaLimit modelLayer;
    class Server middleware;
    class DB,FTS5 persistence;
    class CLI,AgentConfig,MCPConfig mgmt;
```

## Database Schema

The SQLite database is stored at `~/.gemini/skills-db/skills.db`. It consists of the following tables:

1. **`skills`** (Standard content table):
   - `name` (TEXT, PRIMARY KEY): Unique identifier (e.g. `golang-security` or `golang-security/injection`).
   - `skill_name` (TEXT): Name of the parent skill folder.
   - `type` (TEXT): `skill` (for main SKILL.md) or `reference` (for references).
   - `tags` (TEXT): Comma-separated keywords.
   - `content` (TEXT): Full markdown file content.
   - `file_path` (TEXT): Absolute path to the source file on disk (used for workspace scoping).
   - `byte_size` (INTEGER): Size of the content.
   - `line_count` (INTEGER): Number of lines.

2. **`skills_fts`** (FTS5 Virtual Table):
   - External content table mapped to `skills`.
   - Fields: `name`, `skill_name`, `tags`, `content`.

3. **`tool_calls`** (Usage & Metrics logging):
   - Tracks metrics, timestamps, query strings, returned bytes, and calculated token savings.

## Core Commands

Maintainers must use these CLI commands to build, inspect, and test the database:

| Command | Action |
|---------|--------|
| `node bin/cli.js init --force` | Re-installs server, forces re-migration of all active skills, registers MCP, and redeploys subagent profiles. |
| `node bin/cli.js migrate` | Re-indexes all detected skill folders, removing stale entries first. |
| `node bin/cli.js test` | Runs internal JSON-RPC tests on the local MCP server. |
| `node bin/cli.js status` | Checks existence of required files, validates MCP configurations, and prints database counts. |
| `node bin/cli.js version` | Displays the current local version (1.1.4) and checks for updates from GitHub. |
| `node bin/cli.js upgrade` | Upgrades the Konoha CLI to the latest version directly from GitHub. |
| `node bin/cli.js savings` | Queries and displays token and bytes savings metrics. |

## Development Guidelines

### 1. Workspace Scoping & Security
- All tool outputs returned by `server.py` (`find_skill`, `list_skills`, `get_skill`) must run through `is_path_visible(file_path)` checks.
- Paths must be normalized using `os.path.realpath` to resolve symlinks before checking boundary permissions (i.e. checking if the path is in `~/.agents/`, `~/.gemini/`, or `os.getcwd()`).

### 2. Process Spawning
- **NEVER** use raw string concatenation in shell execution commands (`execSync`).
- **ALWAYS** use parameterized spawns (`spawnSync`) and validate inputs (checking name regex `/^[a-zA-Z0-9_-]+$/` and URL schemes) to protect against command injection.

### 3. Persistent Storage
- User configurations (e.g. subagent JSON settings) must be saved to the user's home directory (`~/.agents/agents.json`).
- Template files inside `src/templates/` serve only as fallbacks. Package template updates should fail silently in read-only global node_modules environments.

### 4. Model Registry & Quota Failures
- The Konoha application natively integrates with the **Antigravity Model Registry**. Subagent profiles in `agents.json` and `AGENTS.md` map directly to models available in the IDE (e.g., `Gemini 2.5 Flash`, `Gemini 3.1 Pro (High)`, `Claude Sonnet 4.6 (Thinking)`).
- Maintainers must ensure that subagent configurations define fail-safe models, defaulting to `Gemini 3.1 Flash-Lite` or `Gemini 2.5 Flash` as the primary fallback model tier during `RESOURCE_EXHAUSTED` / `429` (Quota limits) scenarios.
- The system must display the standard quota limit warning message (`"Your Antigravity account has reached its rate limit quota. Please wait for the quota window to reset, back off request frequency, or upgrade your subscribe/tier in the Google Cloud Console."`) and follow the upgrade flow if total exhaustion occurs.

### 5. Compliance Reports
- Whenever updating Konoha versions or conducting security checks, you MUST generate a compliance report in the `docs/SecurityCompliance/` folder using the exact filename format: `security_compliance_report_google_policy_<version>_<YYYY-MM-DD>.md`.
- **Mandatory Compliance Report Structure**: All generated compliance reports MUST strictly adhere to the following Markdown structure to maintain auditing transparency:
  1. **# Security and Compliance Review: Konoha Project [vVersion]** (H1 Header)
  2. **## Executive Summary**: Summarizes the version reviewed, specific audit goals, and overall compliance outcome.
  3. **## Findings**: Contains sub-headings for each analyzed control (e.g. `### 1. Interactive Consent Prompts`, `### 2. Sandbox Boundary Validation`). Each finding must contain:
     - **Action Verified**: The specific code change, file modification, or config setting inspected.
     - **Impact**: The security benefit or policy compliance outcome (e.g. preventing silent writes).
  4. **## Conclusion**: Summary of the overall security posture and final verification declaration.

### 6. Changelog Maintenance
- Whenever you make an update to the codebase or bump the version, you MUST update the `CHANGELOG.md` file to reflect your changes.

### 7. File Modification Rule
- **File Modification Rule**: Only use `sed` if you are modifying an existing file (e.g., replacing specific strings or appending lines).
- **README Protection Rule**: DO NOT change the structure, layout, or existing content of README.md. When updating README.md, you MUST only modify specific strings (like version numbers) using targeted search-and-replace.

### 8. Agent Telemetry and Call Statistics
- **Case-Insensitive Grouping**: Agent status metrics calculation must aggregate statistics case-insensitively using lowercase agent names, resolving misattribution to `Direct Tool Calls`.
- **Dynamic Active Agent Detection**: When the `agent` parameter is omitted from MCP tool arguments, `detect_active_agent()` must dynamically resolve the calling agent's identity by scanning prompt and transcript files in the `brain/` directory.
- **Bypassing Orchestrator Override**: To prevent the orchestrator's parent conversation from masking active subagents (since the orchestrator's folder is updated on every turn and thus is the newest), the detection logic must prioritize registered subagent ranks (`anbu`, `genin`, etc.) and treat the orchestrator only as a fallback candidate, continuing the loop to search older folders.
- **Deep Directory Search**: The directory scanning loop must scan up to `15` recently modified directories to ensure subagent folders are reached even when multiple other workspaces or conversations are active.

### 9. Dependency Version Auto-Fix
- **Auto-Fix Version Mismatches**: When running package installation or build commands (`pnpm install`, `pnpm run build`), if the output reports mismatched, outdated, or conflicting dependencies (such as `- lucide-react 1.21.0` and `+ lucide-react 0.468.0 (1.21.0 is available)`), agents must automatically parse the output, update `package.json` to specify the latest available version (or the recommended version) for the conflicting packages, and re-run the installation/build command again to align and fix the dependencies before proceeding.

### 10. Source Design or Code Reference Build Selection
- **Visual Mockup or Reference Source Context Detection**: When a task requests building or scaffolding a website or user interface, the agent must check if a source design or reference source code folder (e.g., `source-design`, `source-image-design`) exists.
- **`build_from_source` Tool**: If design mockups or reference source code files are present, the agent must invoke `build_from_source`. This tool instructs the build processor to strictly match layout design mockups and reference source code files while disabling the default premium template visual effects (10-theme switcher, 3D interactive carousels, 3D GPU card hovers, 3D SweetAlert2 modal dialogs, and watermark) unless they are explicitly requested or shown in the source files.
- **`build_from_text` Tool**: If no visual design mockup or reference source code directory exists, the agent must call `build_from_text` to scaffold the project using standard premium interactive features and templates.

### 11. Migration Optimization and Database Integrity
- **Preserving Markdown Integrity (HTML Comments)**: When optimizing skills during the `konoha migrate` process (`src/migrate.py`), the system MUST NEVER strip HTML comments (`<!-- -->`). Stripping HTML comments is destructive and drops the quality of skills because it accidentally removes critical Svelte compiler directives (e.g., `<!-- svelte-ignore a11y_click_events_have_key_events -->`) and structural markdown markers (e.g., `<!-- slide -->` for carousels).
- **Ghost Skill Purging**: To prevent deleted skills (e.g., `modern-full-stack`, `devsecops-engineer`) from persisting in the SQLite FTS5 database, the migration script (`migrate.py`) must always perform a clean truncation (`DELETE FROM skills;`) before re-indexing.
- **Legacy Tool Deprecation**: The legacy tools `build_with_image_design`, `render_image`, and the local `konoha render` CLI command (`visual_compare.py`) are permanently deprecated. Agents must use the unified `build_from_source` tool instead.

### 12. Subagent Model Property Allocation
- **Mandatory Model Injection**: When generating configuration files (`GEMINI.md` or `AGENTS.md`) in `src/agent_manager.js`, the `model` property must always be explicitly injected into the `define_subagent` syntax (e.g., `- model: \`Gemini 3.5 Flash (High)\``). Failure to include this property will cause all subagents to lose their specialized model tiers and fall back to the system's default generic model.
