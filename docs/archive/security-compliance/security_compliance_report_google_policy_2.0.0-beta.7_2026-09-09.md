# Security and Compliance Review: Konoha Project v2.0.0-beta.7

**Review date:** 2026-09-09
**Scope:** Pi (pi.dev) savings attribution fix + hard guardrail enforcement across coding clients

## Executive Summary

This review covers two security-relevant fixes delivered into the v2.0.0-beta.7 runtime on **2026-09-09**:

1. **Pi savings attribution** — Pi (pi.dev) sessions were invisible to `konoha savings` because `detectActiveClient()` in `src/tools_savings_logger.js` had no Pi detection path.
2. **Hard guardrail enforcement** — the konoha default guardrails (destructive commands, git safety, secret protection, MCP read-bypass) existed only as prompt text; every client's shell/bash tool could bypass them (confirmed live: `cat .env` and bare `grep` executed unchallenged).

Both fixes are implemented, deployed to `~/.konoha` / `~/.local/bin` / `~/.pi`, and verified with 39/39 harness checks + 17/17 live deployment checks + the full 64-suite automated test suite (0 failures).

---

## Findings & Compliance Verification

### 1. Shared Guardrail Engine — Single Source of Truth (`src/guardrails.js`)
- **Design**: A deliberately self-contained `checkCommandGuardrails(command)` function (no outer-scope identifiers, only standard built-ins) exported together with `buildGuardrailCheckerSource()`. Client managers inline the checker source verbatim into generated payloads (Pi TS extension, Claude Code / Command Code blocker scripts) via `JSON.stringify(buildGuardrailCheckerSource())` evaluated with `new Function`, so regex escapes survive verbatim and deployed scripts have **no runtime dependency** on `~/.konoha/guardrails.js`.
- **Local parity**: The local Node copy, the Pi TS extension, and both blocker scripts embed a byte-identical checker (verified by extracting and comparing all four embedded literals).
- **Compliance Status**: **PASS** (Single source of truth; byte-identical enforcement across all embedding clients).

### 2. Enforced Categories & Exemptions
- **Destructive**: `rm` with recursive+force flags targeting `/`, `~`, `$HOME` (or their `/*` globs), `mkfs`, `dd of=/dev/*`, `DROP DATABASE` / `TRUNCATE TABLE`, `chmod 777`, recursive `chown`, `curl|sh` / `wget|sh`.
- **Destructive-git**: `git reset --hard`, `git push --force` (`--force-with-lease` explicitly allowed), `git clean -f`, `git checkout -- .`, `git rebase -i`.
- **Secrets**: reading or committing `.env*`, `secrets.yaml/json`, `*.tfvars`, `*.pem`, `*.key`, `id_rsa*`, `credentials*` via reader binaries or `git add`/`git commit` token scans — checked in **every** pipe stage; `rtk` prefix does **not** exempt secrets.
- **Read-bypass**: bare `cat`/`head`/`tail`/`grep`/`egrep`/`fgrep`/`rg`/`find`/`fd`/`ag`/`ack`/`less`/`more`/`bat`/`wc`/`zcat` as the **first** stage of a command segment (filter positions like `ps aux | grep node` are allowed); an `rtk` prefix exempts the stage.
- **Segment/stage tokenization**: commands are split on `&&`/`||`/`;` and `|`; leading `sudo` and `FOO=bar` env assignments are stripped when resolving the effective binary.
- **Compliance Status**: **PASS** (All four guardrail categories enforced with correct exemption semantics; 62-case test matrix plus 39-case integration harness green).

### 3. Per-Client Enforcement Mechanisms
- **Claude Code**: `registerClaudeCodeBashGuard()` (`src/mcp_clients_manager.js`) writes the self-contained `~/.local/bin/konoha-bash-guard.js` and registers it as a PreToolUse hook under the `^Bash$` matcher in `~/.claude/settings.json` (idempotent; stale entries repaired in place). Violations emit a schema-valid deny (`decision: "block"` + `hookSpecificOutput.permissionDecision: "deny"`); allowed commands exit 0 silently.
- **Command Code**: `buildCommandCodeBlockerSource()` extends `~/.local/bin/konoha-native-blocker-cc.js` — previously `read_file`-only — to also guard `shell_command`/`ShellCommand`/`bash`/`Bash`/`shell`/`Shell` tool calls with defensive command extraction (`tool_input.command`/`cmd`, `input.input.command`, `input.command`/`cmd`). Output uses only the documented `hookSpecificOutput.permissionDecision: "deny"` shape.
- **Antigravity IDE/CLI**: `src/antigravity_tool_sanitize_hook.js` DENY-3 upgraded from a first-word blocklist to the full shared guardrail check on every `run_command` (via `require('./guardrails')`, resolved flat at `~/.konoha/guardrails.js`); the legacy first-word blocklist remains as a fallback if `guardrails.js` is missing.
- **Pi (pi.dev)**: `buildPiBlockerExtensionSource()` (`src/pi_manager.js`) embeds the checker in `~/.pi/agent/extensions/konoha-blocker.ts`; the single `tool_call` listener blocks native reads and enforces the guardrails on `bash`/`bash_command` tool calls.
- **Codex / Cursor / OpenCode**: No blocking-hook capability exists — these clients keep the prompt-only guardrail rules (documented as such in README/SETUP-IDE).
- **Compliance Status**: **PASS** (Every hook-capable client enforces the shared engine; verified live for all four).

### 4. Deployment & Repair Coverage (`bin/cli.js`)
- `guardrails.js` added to: the flat `filesToCopy` deploy list, the `refreshFiles` refresh list, the dedicated hook deploy block (alongside `hook-base.js`), and the doctor `checkAndRepairFile` set — guaranteeing `~/.konoha/guardrails.js` exists for the Antigravity hook and self-heals on `konoha doctor`.
- The `src/` tree mirror (`installCliRuntime` `copyTree`) carries `guardrails.js` for `require('./guardrails')` from the deployed `mcp_clients_manager.js` / `pi_manager.js`.
- **Compliance Status**: **PASS** (Deploy, refresh, and repair paths all cover the new module; doctor passes).

### 5. Pi Savings Attribution (`src/tools_savings_logger.js`, `bin/cli.js`)
- Pi detection added to `detectActiveClient()` (env vars `PI_CODING_AGENT=true` / `PI_SESSION_FILE` / `PI_SESSION_ID`, `~/.pi/agent/sessions` glob fallback, exact-match `pi` override) and a `▲ Pi` row added to the `konoha savings` client table. No other client's attribution changed (claudecode regression verified).
- **Compliance Status**: **PASS** (Attribution integrity restored with no cross-client regressions).

### 6. Verification Evidence
- **Integration harness (repo)**: 39/39 PASS — syntax checks on all 5 edited files; Claude Code bash guard deny/allow matrix (destructive, git, secrets, read-bypass, `rtk` exemption, benign commands); Command Code blocker matrix (read_file, display READ, shell_command variants, `cmd` field, `input.input.command`, benign writes); Antigravity hook matrix (CommandLine/command/commandLine arg shapes, `tools:`-prefixed names, DENY 1/2, rtk exemption) plus the missing-`guardrails.js` fallback; checker parity across all four embeddings; cli.js deploy-list coverage.
- **Live deployment checks**: 17/17 PASS against the deployed artifacts (`~/.local/bin/konoha-bash-guard.js`, `~/.claude/settings.json` `^Bash$` registration, `~/.local/bin/konoha-native-blocker-cc.js`, `~/.pi/agent/extensions/konoha-blocker.ts`, flat `~/.konoha/guardrails.js`, `~/.konoha/antigravity_tool_sanitize_hook.js`).
- **Automated suite**: 64/64 test suites pass (0 failures).
- **Doctor**: `konoha doctor` — all diagnostic checks pass; version 2.0.0-beta.7.
- **Compliance Status**: **PASS** (All verification layers green with real executed evidence).

### 7. Residual Risk & Notes
- Hooks initialize at client startup only — running client sessions (including the MCP server processes serving this review) must be restarted to pick up the new enforcement; deployment is otherwise live.
- Antigravity fallback path (missing `guardrails.js`) enforces only the first-word read-bypass blocklist — the shared engine is deployed and doctor-repaired, so this is defense-in-depth, not a gap.
- `rtk` prefix exempts read-bypass but never secrets or destructive categories — by design.
- **Compliance Status**: **PASS** (Residual risks documented and bounded).

---

## Verdict

**PASS** — Both fixes are implemented, deployed, and verified. Guardrails are now enforced at the tool-call level for every hook-capable client (Claude Code, Command Code, Antigravity, Pi), with a single self-contained source of truth and full deploy/refresh/doctor coverage.
