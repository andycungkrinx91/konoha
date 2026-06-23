# Cursor IDE & Cursor CLI Setup Guide

Konoha **v1.1.6+** supports **Cursor IDE** and **Cursor CLI** alongside Antigravity. The same `skills-db` + `semble` + `konoha-files` MCP stack and six ninja subagents work in both environments.

## Prerequisites

- **Cursor IDE** or **Cursor CLI** installed
- **Python 3** ≥ 3.8
- **Node.js** ≥ 18
- Agent skills in `~/.agents/skills/` (with `SKILL.md` files) — Konoha mirrors these to `~/.cursor/skills/` for Cursor

## Step 1: Install Konoha (Auto-Setup)

Running any `konoha` command triggers `ensureAutoSetup()`, which self-heals MCP and subagent configuration.

For a full interactive install (including Cursor consent prompt):

```bash
npx github:andycungkrinx91/konoha init
```

When prompted **"Configure Konoha for Cursor IDE and Cursor CLI?"**, answer **Yes** to deploy:

| Path | Purpose |
|------|---------|
| `~/.cursor/mcp.json` | Registers `skills-db` + `semble` + `konoha-files` MCP servers |
| `~/.cursor/agents/*.md` | Six official ninja subagents (`model: inherit`) |
| `~/.cursor/skills/` | Agent skills mirrored from `~/.agents/skills/` (same layout as Antigravity) |
| `~/.cursor/hooks.json` | `sessionStart` → `cursor_bootstrap.js` (fail-open) |
| `~/.cursor/cli-config.json` | MCP allowlist for Cursor CLI |
| `.cursor/mcp.json` (project) | Project-scoped MCP config |
| `.cursor/rules/konoha.mdc` | Orchestrator delegation rules |
| `.cursor/agents/*.md` (project) | Project-scoped subagent definitions |
| `.cursor/skills/` (project) | Project-scoped skills (mirrored from `.agents/skills/` or `~/.agents/skills/`) |

## Step 2: Verify Installation

```bash
konoha doctor --yes
konoha test
konoha status
```

Confirm the **Cursor IDE/CLI Integrations** section shows **ACTIVE** for MCP, subagents (6/6), hooks, CLI permissions, and **Cursor skills** (mirrored from `~/.agents/skills/`).

## Step 3: Restart Cursor

Close and reopen Cursor (or start a new agent session) so MCP servers and subagents reload.

## How Cursor Orchestration Works

1. **Orchestrator** (main agent) reads `.cursor/rules/konoha.mdc`.
2. **Skills first**: Call `skills-db.find_skill` (pass `agent` when known).
3. **Code context**: Call `semble.search` / `semble.find_related` for project code — **not** Cursor `Grep`, `Glob`, or `SemanticSearch`.
4. **Delegate** via the **Task** tool with `subagent_type` matching a ninja name (`genin`, `kage`, `chunin`, `jonin`, `anbu`, `tokubetsu-jonin`).
5. Subagents are auto-loaded from `~/.cursor/agents/` and project `.cursor/agents/`.
6. **Skills on disk**: Konoha mirrors `~/.agents/skills/` → `~/.cursor/skills/` (and project `.cursor/skills/` on `konoha init`). Agents still load skill **content** via `skills-db` MCP — do not read `SKILL.md` files directly into context.

### Default search / grep / find → semble

When Konoha is installed, **semble MCP is the default** for all codebase discovery on Cursor and Antigravity:

| Avoid | Use instead |
|-------|-------------|
| Cursor `Grep`, `Glob`, `SemanticSearch` | `semble.search` / `semble.find_related` |
| Shell `grep`, `rg`, `find` | `semble.search` with `repo` = absolute project path |
| Antigravity built-in grep/glob | `semble` MCP |

`skills-db` remains for skill lookup only — never use it (or semble) for the wrong purpose. If semble MCP is down after retry, `rg` is allowed once as a documented fallback.

### Token-efficient file reads (`konoha-files`)

After semble locates targets, use **konoha-files** MCP for precise, capped file operations:

| Tool | Use when |
|------|----------|
| `read_file_head` | Read ≤200 lines from file start (default 80) |
| `read_file_range` | Read ≤500 lines with line numbers |
| `file_info` | File size + line count without loading content |
| `token_efficient_grep` | Regex search capped at 20 matches |
| `get_file_structure` | Class/function signatures without bodies |
| `find_files_clean` | Glob file list (skips `node_modules`, `.git`, lockfiles) |

### Subagent models (Cursor Free)

All official subagents default to **`model: inherit`** (Cursor Auto session model). No manual model selection is required on free-tier Cursor accounts.

## Agent Call Statistics (`konoha agent status`)

When MCP tools omit the `agent` parameter, `detect_active_agent()` resolves identity from:

- **Cursor**: `~/.cursor/projects/*/agent-transcripts/*/*.jsonl` — `Task` `subagent_type`, subagent `[Agent] active` text logs, or `[Konoha] orchestrator active`.
- **Antigravity**: `~/.gemini/antigravity-ide/brain` and `antigravity-cli/brain` — delegated `prompt.md` and recent `PLANNER_RESPONSE` transcripts.

Recent Cursor sessions are preferred over stale Antigravity brain folders so counters stay accurate in multi-client setups.

### Verification scripts

```bash
python3 src/test_cursor_attribution.py   # Cursor one-by-one attribution
python3 src/test_agent_attribution.py    # Antigravity one-by-one attribution
```

## Protected Default Subagents

The six official ninja agents in `src/templates/agents.json` **cannot be deleted**:

```bash
konoha agent delete genin
# ✗ Subagent "genin" is a protected default Konoha ninja and cannot be deleted.
```

Custom subagents you create via `konoha agent create` can still be deleted.

## Cursor CLI

Cursor CLI reads `~/.cursor/cli-config.json` for MCP permissions. After `konoha init`, these grants are added:

- `Mcp(skills-db)`, `Mcp(skills-db, find_skill)`, `Mcp(skills-db, get_skill)`, …
- `Mcp(semble)`, `Mcp(semble, search)`, `Mcp(semble, find_related)`
- `Mcp(konoha-files)`, `Mcp(konoha-files, read_file_head)`, `Mcp(konoha-files, read_file_range)`, `Mcp(konoha-files, file_info)`, `Mcp(konoha-files, token_efficient_grep)`, `Mcp(konoha-files, get_file_structure)`, `Mcp(konoha-files, find_files_clean)`

Run `konoha doctor --yes` to repair missing permissions.

## Troubleshooting

### MCP not detected in Cursor

1. Check `~/.cursor/mcp.json` contains `skills-db`, `semble`, and `konoha-files`.
2. Run `konoha doctor --yes`.
3. Run `node ~/.gemini/skills-db/cursor_bootstrap.js` (must exit 0).
4. Restart Cursor.

### Wrong agent in `konoha agent status`

1. Ensure subagents log `[Icon Agent] active` at response start (see `~/.cursor/agents/*.md`).
2. When delegating, use Task with correct `subagent_type`.
3. Pass `agent='genin'` (etc.) explicitly in `find_skill` / `get_skill` when possible.
4. Run `python3 src/test_cursor_attribution.py` to validate attribution.

### Missing or stale `~/.cursor/skills/`

1. Run `konoha doctor --yes` to re-sync from `~/.agents/skills/`.
2. After `konoha skill add` or editing skills, run `konoha migrate`.
3. See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) (Cursor skills mirror section).

### Dual-platform / multi-client (Antigravity + Cursor + others)

Konoha supports all configured stacks simultaneously. Agent detection uses transcript activity time — not Antigravity `prompt.md` touch time — so active Cursor sessions are not masked by Antigravity orchestrator prompt updates.

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for shared issues (Python, database, FTS5).

## Uninstall Cursor Integration Only

```bash
konoha uninstall
```

Removes Konoha-managed entries from `~/.cursor/` (MCP servers, subagents, bootstrap hook) without deleting your Antigravity configuration.
