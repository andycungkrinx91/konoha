# MCP Client Setup — Claude Code, OpenCode & Other Agentic CLIs

Konoha registers **skills-db**, **semble**, and **konoha-files** globally — same pattern as Antigravity and Cursor:

| Client | Auto-setup with `konoha init` | Global config only |
|--------|------------------------------|-------------------|
| **Antigravity** | Always | `~/.gemini/config/mcp_config.json` |
| **Cursor** | Yes (with consent) | `~/.cursor/mcp.json` + project `.cursor/` + `~/.cursor/skills/` mirror |
| **Claude Code** | When `claude` CLI detected | `~/.claude.json` → `mcpServers` |
| **OpenCode** | When `opencode` CLI detected | `~/.config/opencode/opencode.json` → `mcp` |

Claude Code and OpenCode use **global config only** — Konoha does not write project `.mcp.json` or `opencode.json`.

```bash
npx github:andycungkrinx91/konoha init
```

---

## If Claude Code or OpenCode is NOT installed

Konoha skips their config. After installing the CLI:

```bash
konoha doctor --yes
```

**Manual fallback** (merge into global config, not project files):

| Client | Template | Target |
|--------|----------|--------|
| Claude Code | [templates/claude-code.mcp.json](templates/claude-code.mcp.json) | `~/.claude.json` → `mcpServers` |
| OpenCode | [templates/opencode.mcp.json](templates/opencode.mcp.json) | `~/.config/opencode/opencode.json` → `mcp` |

---

## Verify

```bash
konoha status
konoha test
konoha doctor --yes
```

---

## Antigravity / Cursor

- [SETUP-IDE.md](SETUP-IDE.md) · [SETUP-CLI.md](SETUP-CLI.md) · [SETUP-CURSOR.md](SETUP-CURSOR.md)

---

## Claude Code (global)

**Detection**: `claude` in PATH, or `~/.claude/`, or `~/.claude.json`.

**Writes**:
- `~/.claude.json` → `mcpServers` (all projects on this machine).
- `~/.claude/agents/` → Six official ninja subagents (`genin.md`, `kage.md`, `chunin.md`, `jonin.md`, `anbu.md`, `tokubetsu-jonin.md`) configured with whitelisted tools (`allowed-tools` whitelist matching `mcp__semble__*`, `mcp__skills-db__*`, `mcp__konoha-files__*`).

**Verify**: `/agents` and `/mcp` in Claude Code session.

**Model Default**: All default Konoha subagents configure `"claudeModel": "Claude Sonnet 4.6 (Thinking)"` inside `~/.agents/agents.json` to leverage Claude 3.5 Sonnet in Claude Code. View assignments with `konoha models list`.

---

## OpenCode (global)

**Detection**: `opencode` in PATH, or `~/.config/opencode/`.

**Writes**: `~/.config/opencode/opencode.json` → `mcp` (`type: local`).

**Verify**: `opencode mcp list`

---

## Agent workflow (all clients)

1. `skills-db` `find_skill` for skills
2. `semble` `search` / `find_related` for code
3. `konoha-files` for bounded file reads
4. `ag-local-bridge` runs in-process inside `konoha-files` on port `11435` to expose OpenAI/Anthropic/Gemini APIs locally.

In the konoha repo: `find_skill("konoha maintenance")` after `konoha migrate`.

**Cursor note:** Skills on disk are mirrored to `~/.cursor/skills/`; agents still load skill **content** via `skills-db` — do not read `SKILL.md` files directly into context.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Skipped at init | Install CLI → `konoha doctor --yes` |
| MCP missing | `konoha status` → check global row |
| CLI not installed | Use `docs/templates/` → merge into **global** config |

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
