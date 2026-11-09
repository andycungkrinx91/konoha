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
    darkMode: false
    background: '#ffffff'
    mainBkg: '#ffffff'
    primaryColor: '#ffffff'
    primaryTextColor: '#0f172a'
    primaryBorderColor: '#3b82f6'
    lineColor: '#334155'
    arrowheadColor: '#334155'
    secondaryColor: '#f8fafc'
    tertiaryColor: '#ffffff'
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
    fontSize: '13px'
  flowchart:
    nodeSpacing: 45
    rankSpacing: 55
    padding: 24
    wrappingWidth: 380
---
flowchart TB
    Developer["Developer"] --> Registry["skills.sh<br/>(Git repository)"]
    Registry --> Files["Workspace or Home<br/>.agents/skills/&lt;name&gt;"]
    Templates["src/templates/skills"] --> Files
    Files --> Migrate["konoha migrate<br/>(non-destructive)"]
    Migrate --> DB["SQLite konoha.db<br/>(skills + skills_fts)"]
    Client["Any Supported Client"] --> Find["find_skill(keyword)"]
    Find --> DB
    DB --> Authz{"classifySkill(name, tags)"}-->|red · caller @akatsuki| Red["Authorized retrieval<br/>(requires_lab: true)<br/>execution still lab-gated"]
    Authz -->|red · other caller| Denied["SKILL_AUTHORIZATION_DENIED<br/>body never returned"]
    Authz -->|blue| Get["get_skill(canonical name)"]
    Red --> Client
    Get --> Client

    linkStyle default stroke:#334155,stroke-width:2px;
    classDef actorNode fill:#ffffff,stroke:#3b82f6,color:#0f172a,stroke-width:2px;
    classDef sourceNode fill:#ffffff,stroke:#8b5cf6,color:#0f172a,stroke-width:2px;
    classDef processNode fill:#ffffff,stroke:#f59e0b,color:#0f172a,stroke-width:2px;
    classDef runtimeNode fill:#ffffff,stroke:#10b981,color:#0f172a,stroke-width:2px;

    class Developer,Client actorNode;
    class Registry,Files,Templates sourceNode;
    class Migrate processNode;
    class DB,Find,Get,Red runtimeNode;
    classDef denyNode fill:#ffffff,stroke:#ef4444,color:#0f172a,stroke-width:2px;
    class Denied denyNode;
```

---

## 🔴 Red Skills (Offensive)

A skill is classified red by `src/skill_authorization.js` when its name matches `RED_SKILL_PATTERN` (`pentest-*`, `patch-diff-exploit-*`), is listed in `RED_SKILLS`, or carries a `red-team` / `pentest` / `offensive` tag.

- Only `@akatsuki` may retrieve or invoke a red skill; every other caller gets `SKILL_AUTHORIZATION_DENIED` at discovery, retrieval, dispatch, delegation, and runtime.
- Discovery returns metadata with `content: '[REDACTED]'`, never the file body.
- Red skills run only inside the Akatsuki Lab (`requires_lab: true`). There is no host fallback.
- Do not add call-site checks — the shared gate already covers all surfaces. See [docs/security/RED-SKILL-INVENTORY.md](security/RED-SKILL-INVENTORY.md).

---

## 📋 Step-by-Step Guide

### Step 1: Find a Skill on skills.sh
Browse the [skills.sh registry](https://www.skills.sh/) or search directly from Konoha:
- **Web UI**: Open the Skills page (`http://127.0.0.1:1404/skills`), toggle the search bar to `🌐 skills.sh Registry`, and type your query (e.g. `react`, `docker`, `prd`).
- **CLI**: Run `konoha skill search <query>` to view interactive rankings, install counts, and GitHub sources.

### Step 2: Install the Skill

#### Option A: 1-Click Install from Web UI
On the Web UI Skills page in `🌐 skills.sh Registry` mode, click the **1-Click Install** button on any skill card. Konoha automatically runs non-interactive installation (`-y --agent '*'`), copies the skill to your project or global directory, normalizes repository URLs, and indexes both SQLite FTS5 and IBM Granite 384d vector embeddings.

#### Option B: Terminal CLI (`konoha skill add`)
Run the native `konoha skill add` command in your terminal, specifying the repository URL and the target skill name:

```bash
konoha skill add https://github.com/pageai-pro/ralph-loop prd-creator
```

> [!NOTE]
> * **If run inside a Git repository/project workspace**: The skill will be installed locally in `./.agents/skills/prd-creator`.
> * **If run outside a repository**: The skill will be installed globally in `~/.agents/skills/prd-creator`.
>
> `konoha` supports both locations out of the box and automatically triggers multi-directory database migration upon adding.
>
> **Cross-platform paths:**
> - `~/.agents/skills/` = `C:\Users\<you>\.agents\skills\` on Windows
> - `.agents/skills/` = same relative path on all platforms

### Step 3: Run the Migration (Optional)
If the database does not automatically sync or if you manually copied skill files, run the migration command to scan your skills directories and index the new content into your SQLite FTS5 database:

```bash
konoha migrate

# Or rebuild embeddings explicitly:
konoha migrate --rebuild-embeddings
```

In Konoha v2.2.18, migrations are strictly non-destructive and integrate directly with the existing SQLite Project Knowledge RAG (`~/.konoha/konoha.db`): existing user skills, custom agent configurations, project memories, and prior indexed references are preserved and never moved or deleted. The migration automatically:
1. Scans global and project-level skill directories across all 8 harnesses (`~/.agents/skills/`, `./.agents/skills/`, `.cursor/skills/`, `.claude/skills/`, `.gemini/skills/`, `.commandcode/skills/`, `.codex/skills/`, `.opencode/skills/`, `.pi/agent/skills/`, `.omp/agent/skills/`) in-place without modifying external files.
2. Enforces strict project isolation (`project_hash` / `isPathVisible`) so project-level skills belong exclusively to their originating project and never leak into other workspaces, while preserving distinct skills with matching names (`@proj-<hash>` / `@global-<harness>`).
3. Indexes the main `SKILL.md` instructions with content-hash deduplication and automatically detects nested `references/*.md` files.

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

**Cursor users:** `konoha skill add` and `konoha migrate` index the new skill in the canonical SQLite database. Cursor loads the content through `konoha.find_skill`/`konoha.get_skill`; Konoha does not create `~/.cursor/skills/` mirrors or symlinks.

### Step 5: Embed the Skill into a Subagent (Optional)
To associate the new skill with a specific specialist ninja subagent (e.g. `@anbu`, `@jonin`, or `@kage`):

```bash
# Direct syntax:
konoha skill <skillname> embed <agentname>

# Example:
konoha skill prd-creator embed kage
```

You can also view current subagent skill assignments interactively or via tabular summary:

```bash
konoha agent skill kage
```

### Step 6: Start Using the Skill
Your agent team is now ready to use the skill on-demand. When you prompt the agent with a task related to the new skill, the subagents will call `find_skill` or `get_skill` to retrieve the guidelines dynamically, avoiding start-up context bloat.

### Reference Example: A Shipped Cross-Agent Skill (`i-have-adhd`)

The built-in `i-have-adhd` skill (adapted from [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd), MIT) shows the full cross-agent pattern used by first-party skills:

1. Content lives in `src/templates/skills/i-have-adhd/SKILL.md` and is copied verbatim into every participating agent skill as `references/i-have-adhd.md`. Two trees are verified byte-identical: the shipped template tree (`src/templates/skills/`) and the deployed tree that `src/skill_manager.js` writes to (`~/.agents/skills/`, or the project `./.agents/skills/` when one exists). Per-client skill directories are scanned, not mirrored.
2. Agent mapping is declared once in `src/templates/agents.yaml` (`skills:` lists) and mirrored into the `src/templates/AGENTS.md` / `GEMINI.md` routing tables — it is embedded into exactly six agents (genin, chunin, jonin, anbu, tokubetsu-jonin, akatsuki) while sannin (router), kage (reviewer), and yamanaka (3D) stay out of scope.
3. Each of the six agent skills carries a Domain-Routing row pointing to `i-have-adhd`, so those agents load it when shaping final responses. Independently of this per-agent mapping, dispatched subagent prompts also receive the inline anti-slop + ADHD discipline contract from `src/mcp/discipline_contract.js`.
4. The contract is enforced by `tests/test_i_have_adhd_skill.js` (byte parity between the template and deployed trees, exact 6-agent mapping, all 10 output rules present).
