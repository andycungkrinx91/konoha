# MCP Client Setup — Claude Code, OpenCode & Other Agentic CLIs

Konoha registers **konoha** and **semble** globally for all supported clients. On first install, the existing config file is **backed up** to `<file>.back`, then **replaced** with only Konoha MCP servers:

| Client | Auto-setup with `konoha init` | Config backed up to | Replaced with |
|--------|------------------------------|---------------------|---------------|
| **Antigravity** | Always | `mcp_config.json.back` | `konoha` + `semble` only |
| **Cursor** | Yes (auto if detected) | `mcp.json.back` | `konoha` + `semble` only |
| **Claude Code** | When `claude` CLI detected | `.claude.json.back` | `konoha` + `semble` only |
| **OpenCode** | When `opencode` CLI detected | `opencode.json.back` | `konoha` + `semble` only |

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

**Verify**: `/mcp` in Claude Code session.

**Model Default**: All default Konoha subagents configure `"claudeModel": "Claude Sonnet 4.6 (Thinking)"` inside `~/.agents/agents.json` to leverage Claude 3.5 Sonnet in Claude Code. View assignments with `konoha models list`.

---

## OpenCode (global)

**Detection**: `opencode` in PATH, or `~/.config/opencode/`.

**Writes**:
- `~/.config/opencode/opencode.json` → `mcp` (`type: local`).

**Verify**: `opencode mcp list`.

**Model Default**: Configured with `opencodeModel` (defaults to `"inherit"`). View assignments with `konoha models list`.

---

## Agent workflow (all clients)

1. `konoha` `find_skill` for skills
2. `semble` `search` / `find_related` for code
3. `konoha` for bounded file reads
4. The Konoha Bridge Router runs in-process inside the `konoha` MCP server. The router listens on `19999` and routes to inner OpenAI / Local LLM bridges based on model name prefixes. Local clients do not send API keys to the router.

In the konoha repo: `find_skill("konoha maintenance")` after `konoha migrate`.

**Cursor note:** Skills on disk are mirrored to `~/.cursor/skills/`; agents still load skill **content** via `konoha` — do not read `SKILL.md` files directly into context.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Skipped at init | Install CLI → `konoha doctor --yes` |
| MCP missing | `konoha status` → check global row |
| CLI not installed | Use `docs/templates/` → merge into **global** config |

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

---

## Adding Multiple Bridges

Konoha Bridge Router supports multiple bridges per provider for failover.

### Add a bridge

```bash
konoha bridge create
# => choose 1 (OpenAI API Key)         => prompts for name, port, target URL, API key
# => choose 2 (OpenAI Compatible)     => prompts for name, port, target URL, API key
# => choose 3 (Antigravity Sidecar)   => passive, requires live Antigravity IDE session
```

### Manage bridges

```bash
konoha bridge list              # List all bridges with provider info
konoha bridge status            # Runtime status (AWAITING SIDECAR for Antigravity if IDE is closed)
konoha bridge enable <name>     # Enable a bridge
konoha bridge disable <name>    # Disable a bridge
konoha bridge delete <name>     # Remove a bridge

# Start the gateway
konoha bridge start
```

### Configure your IDE client to point at the gateway

Set your client's API base URL and key to:

```
API Base URL: http://127.0.0.1:19999/v1
API Key:      any-value   (gateway does not enforce key)
```

### Model names for OAuth bridges

All OAuth user slots share the `openai-` prefix namespace:

```
openai-gpt-4o
openai-o1
openai-gpt-4o-mini
```

For API-key bridges (Ollama, LM Studio, etc.) model names use `<bridge_name>-<model>`:

```
my-ollama-llama3
lm-studio-mistral-7b
```

### Automatic failover

When a bridge returns an error, the gateway automatically routes to the next available bridge (round-robin across providers).

See [LLM-BRIDGE-GATEWAY.md](LLM-BRIDGE-GATEWAY.md) for full architecture details.
