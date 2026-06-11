# Konoha — Google Policy Review (High Priority)

> Scope: high-priority risks only. Full review available on request.

---

## 🔴 Risk 1 — MCP Auto-Approval Config

### What's happening

The installer writes `allowedTools` entries directly into `~/.gemini/config/mcp_config.json`,
auto-approving `find_skill`, `list_skills`, `get_skill`, and all Semble tools without any user
prompt.

### Why it matters

The Antigravity ban announcement explicitly stated that accounts would be recertified specifically
for **"bypassing system measures or circumventing usage limits."** Google's abuse detection is
automated and blunt. A non-Google MCP endpoint appearing in `mcp_config.json` with blanket
`allowedTools` approval could trigger their scanner — even though Konoha operates entirely locally.

### Fix

- Do **not** write `allowedTools` automatically via the installer.
- Make auto-approval an **opt-in** step, clearly documented as a developer convenience.
- Let users add it manually after understanding what it does.

---

## 🔴 Risk 2 — `postinstall` Silent Auto-Configuration

### What's happening

`package.json` runs `konoha init` automatically on every `npm install`:

```json
"postinstall": "node bin/cli.js init || true"
```

This silently:

- Writes to `~/.gemini/config/mcp_config.json`
- Writes to `~/.gemini/GEMINI.md`
- Writes to `~/.gemini/antigravity-cli/settings.json`
- Registers Semble and skills-db MCP servers with auto-approval

Users have no idea their Antigravity config was modified. The `|| true` means failures are
swallowed silently — a partial broken config with no indication to the user.

### Why it matters

If a user's account is later flagged and they're debugging, they won't know Konoha changed
system-level config files. This is also the kind of "install-time side effect that touches Google
config" that could be perceived as interference with the service.

### Fix

- **Remove the `postinstall` entry entirely.**
- Make `konoha init` an explicit, user-triggered command.
- If silent init is kept for UX reasons, at minimum: print a clear summary of every file being
  written, and exit non-zero on failures instead of swallowing errors.

---

*Generated: 2026-06-11 | Repo: github.com/andycungkrinx91/konoha*
