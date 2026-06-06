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
    classDef middleware fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#f8fafc;
    classDef persistence fill:#451a03,stroke:#f97316,stroke-width:2px,color:#f8fafc;

    %% Subgraphs for Layered Architecture
    subgraph Layer1 ["1. Presentation & Control Layer"]
        User["👤 End User"]
        IDE["💻 Antigravity IDE / CLI"]
    end

    subgraph Layer2 ["2. Cognitive Agent Layer"]
        Router{"🔀 Task Router <br/> (User Rules)"}
        
        subgraph Subagents ["Specialized Ninja Agents"]
            Genin["🍃 Genin <br/> (Scout)"]
            Chunin["📜 Chunin <br/> (Intel)"]
            Jonin["🛡️ Jonin <br/> (UI Builder)"]
            Anbu["👥 Anbu <br/> (Ops/DevOps)"]
            Tokubetsu["🎯 Tokubetsu <br/> (Scribe)"]
            Kage["🌀 Kage <br/> (Architect)"]
        end
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
    Router -->|Delegate Task| Genin & Chunin & Jonin & Anbu & Tokubetsu & Kage
    
    Subagents -->|find_skill / get_skill| Server
    Server -->|Read / Search| DB
    DB -->|External Content Map| FTS5
    
    Server -->|Precise Snippet about 4KB Payload| IDE
    IDE -->|Context-Aware Response| User

    %% Alignment Layout Link
    IDE -.- Server

    %% Class Assigning
    class User,IDE presentation;
    class Router orchestration;
    class Genin,Chunin,Jonin,Anbu,Tokubetsu,Kage cognitive;
    class Server middleware;
    class DB,FTS5 persistence;
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
