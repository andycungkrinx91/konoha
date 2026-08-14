# 🔌 Adding Skills from skills.sh

This guide walks you through the step-by-step process of finding, installing, and indexing custom agent skills from [skills.sh](https://www.skills.sh/) to optimize token usage with `konoha`.

---

## 🗺️ Workflow Diagram

The following diagram shows how skills from the registry are installed, indexed by `konoha`, and utilized by your agent team:

> **Canonical editable diagram:** [06 Skill Registry Installation](diagrams/konoha-architecture.drawio) · [Diagram manifest](diagrams/README.md).

```mermaid
---
title: Skill Registry Installation and On-Demand Retrieval
config:
  theme: base
  themeVariables:
    background: '#ffffff'
    primaryColor: '#dbeafe'
    primaryTextColor: '#1e3a8a'
    primaryBorderColor: '#2563eb'
    lineColor: '#64748b'
    secondaryColor: '#e0e7ff'
    tertiaryColor: '#d1fae5'
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif'
  flowchart:
    nodeSpacing: 90
    rankSpacing: 110
    padding: 32
    wrappingWidth: 360
---
flowchart LR
    Developer([Developer]) --> Registry[skills.sh<br/>Git repository]
    Registry --> Files[Workspace or Home<br/>.agents/skills/&lt;name&gt;]
    Templates[src/templates/skills] --> Files
    Files --> Migrate[konoha migrate<br/>--clean]
    Migrate --> DB[(SQLite skills.db<br/>skills + skills_fts)]
    Client[Any Supported<br/>Client] --> Find[find_skill(keyword)]
    Find --> DB
    DB --> Get[get_skill<br/>(canonical name)]
    Get --> Client

    classDef actor fill:#dbeafe,stroke:#2563eb,color:#1e3a8a,stroke-width:2px
    classDef source fill:#e0e7ff,stroke:#6366f1,color:#312e81
    classDef process fill:#fef3c7,stroke:#d97706,color:#78350f
    classDef runtime fill:#d1fae5,stroke:#059669,color:#065f46,stroke-width:2px
    class Developer,Client actor
    class Registry,Files,Templates source
    class Migrate process
    class DB,Find,Get runtime
```

---

## 📋 Step-by-Step Guide

### Step 1: Find a Skill on skills.sh
Browse the [skills.sh registry](https://www.skills.sh/) or locate a repository containing compatible agent skills. For this example, we will use the `prd-creator` skill from the `ralph-loop` repository.

### Step 2: Install the Skill
Run the native `konoha skill add` command in your terminal, specifying the repository URL and the target skill name:

```bash
konoha skill add https://github.com/pageai-pro/ralph-loop prd-creator
```

> [!NOTE]
> * **If run inside a Git repository/project workspace**: The skill will be installed locally in `./.agents/skills/prd-creator`.
> * **If run outside a repository**: The skill will be installed globally in `~/.agents/skills/prd-creator`.
>
> `konoha` supports both locations out of the box and automatically triggers database migration upon adding.
>
> **Cross-platform paths:**
> - `~/.agents/skills/` = `C:\Users\<you>\.agents\skills\` on Windows
> - `.agents/skills/` = same relative path on all platforms

### Step 3: Run the Migration (Optional)
If the database does not automatically sync or if you manually copied skill files, run the migration command:
Run the migration command to scan your skills directories and index the new content into your SQLite FTS5 database:

```bash
konoha migrate
```


```bash
konoha migrate --force
```

The migration automatically:
1. Scans `~/.agents/skills/` and `./.agents/skills/`.
2. Indexes the main `SKILL.md` instructions.
3. Automatically detects other root markdown files (e.g., `JSON.md`, `PRD.md`) or nested `references/*.md` files and indexes them as reference assets in the database.

**Migration output example:**
```
📦 Migrating: prd-creator
  ✓ SKILL.md (6,520 bytes, 159 lines)
  ✓ JSON.md (28,955 bytes) [root reference]
  ✓ PRD.md (11,353 bytes) [root reference]
  
✅ Migration complete! 3 entries indexed.
```

### Step 4: Verify and Test the Search
Test that the MCP server can find the newly added skill rules. Run the sample query check:

```bash
konoha test
```

Or run a status check to verify the database stats have updated:

```bash
konoha status
```

You should see your total indexed count increase (e.g., from `93` to `96` entries).

**Cursor users:** `konoha skill add` and `konoha migrate` also mirror the new skill to `~/.cursor/skills/<name>/` (and project `.cursor/skills/` when deployed). Run `konoha doctor --yes` if the mirror is missing.

### Step 5: Start Using the Skill
Your agent team is now ready to use the skill on-demand. When you prompt the agent with a task related to the new skill, the subagents will call `find_skill` or `get_skill` to retrieve the guidelines dynamically, avoiding start-up context bloat.
