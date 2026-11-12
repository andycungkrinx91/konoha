# Konoha MCP Security Architecture & Ingress Controls (v2.2.21)

## 1. Overview & Threat Model

Konoha MCP operates as an orchestrator and tool provider across AI coding clients (OMP, Antigravity, Cursor, Claude Code, Codex, OpenCode, CommandCode, Pi). In version 2.2.1, substantive security hardening was executed in response to supply-chain and ingress audit findings.

---

## 2. Web Authentication & HTTP Ingress Hardening

### 2.1 Privileged Token Isolation
- **No Token on Public Status Endpoints**: `/api/v1/auth/status` and `/api/v1/auth/session` return session metadata (`authenticated`, `is_bootstrap`, `requires_password_change`) without leaking `sessionToken`.
- **Authorized Token Channels Only**: The session token is strictly obtainable via:
  1. Successful `POST /api/v1/auth/login`
  2. Successful `POST /api/v1/auth/pin`
  3. Loopback authenticated `GET /api/v1/csrf` or `GET /api/v1/token`
- **Gate Capabilities, Not the Master Token**: the HITL picker routes (`/api/v1/hitl/picker`, `/api/v1/hitl/verdict`) are the only `/api/v1/` paths exempt from the session-cookie and CSRF-header checks, and they enforce their own control: an HMAC-SHA256 signature of the task directory, keyed by the persisted session token and compared in constant time. The signature is scoped to one directory (a link for one gate cannot approve another), never contains the token, and the page is served `Referrer-Policy: no-referrer` with `Cache-Control: no-store` so the capability does not leak through a referrer or a shared cache.
- **Health Metadata Gating**: `GET /api/v1/health` returns only minimal status (`status: "healthy"`, `version`, `uptime`) to unauthenticated callers. Internal system details (ports, host, database paths, agent counts, Node runtime) are restricted to authenticated sessions.

### 2.2 Request Body Size Limits
- **1 MiB Payload Cap**: `MAX_BODY_BYTES = 1048576` is enforced on all `POST`, `PUT`, `PATCH`, and `DELETE` requests.
- **Early Rejection**: Requests specifying `Content-Length > 1 MiB` are immediately rejected with `413 Payload Too Large`.
- **Stream Protection**: Chunked request streams exceeding 1 MiB are aborted and the socket is destroyed (`req.destroy()`).

---

## 3. Remote Ingress Architecture & Local Authentication

- **Local Loopback & Stdio Exclusivity**: Public tunnel subsystems (Cloudflare Tunnel, ngrok) are permanently eradicated from the Konoha runtime. All ingress routes exclusively over local stdio MCP processes and the authenticated local Web console on `127.0.0.1:1404`.
- **Argon2id Session Authentication**: Web UI access enforces Argon2id password hashing, session tokens, and strict cookie flags (`HttpOnly`, `SameSite: Lax`). All unauthenticated endpoints reject access without leaking tokens.

---

## 4. Telegram Bot Surface Hardening

### 4.1 Deprecation of Shell Handlers (`/sh` and `/exec`)
- Arbitrary host shell execution via Telegram (`/sh` and `/exec`) was permanently removed in v2.2.1.
- Incoming commands receive a decline notification directing operators to use governed autonomous task execution (`/run <task>`).

### 4.2 Universal HTML Escaping
- All dynamic inputs, usernames, workspace paths, session IDs, task prompts, and task summaries are escaped via `escapeHtml(...)` to eliminate HTML injection in Telegram parse mode.

---

## 5. Queue Worker & Autonomous Task Execution

### 5.1 Config-Gated Autonomy
- The `--dangerously-skip-permissions` flag passed to headless CLI workers is strictly disabled by default.
- It is enabled only when explicitly configured via environment variable:
  ```bash
  export KONOHA_ALLOW_UNSAFE_AUTONOMY=1
  ```

### 5.2 SSH Command Hygiene
- Prompts extracting remote SSH executions validate `key` path (`/^[~/][\w.\-/]*$/`), `host` FQDN pattern, and path.
- Injections containing shell command chaining, backticks, subshells (`$()`), pipes (`|`), redirects (`<`, `>`), or newlines are immediately rejected.
- Remote commands are enclosed in single quotes with escaped inner single quotes (`'...'`).

### 5.3 Extended Dangerous Pattern Interception
- Safety guardrails intercept and reject destructive patterns including `drop table`, `chmod 777 /`, `chmod -r 777 /`, `mkfs.`, `> /dev/sd`, `curl | bash`, `curl | sh`, `wget | bash`, `wget | sh`, and forkbombs (`:(){`).

---

## 6. Document & Diagram Engine Hardening

### 6.1 Shared Chromium Launcher (`src/workflow/tokubetsu-scribe/chromium_utils.js`)
- Chromium launches headless with sandbox enabled by default. Safe `--no-sandbox` fallback is attempted only when container host permissions specifically demand it, emitting an explicit warning log.
- Hardcoded `/usr/bin/google-chrome` paths were eliminated in favor of Playwright bundled Chromium resolution or optional `process.env.KONOHA_CHROME_PATH`.

### 6.2 Offline Network Interception
- Render pages intercept network calls: external HTTP/HTTPS and `file:` schemes are blocked. Local system font stacks replace external Google Fonts `@import` calls.

### 6.3 Formula Injection Guard
- Spreadsheet generation validates formula strings, rejecting Excel DDE and dangerous functions: `WEBSERVICE`, `ENCODEURL`, `HYPERLINK`, `CALL`, `REGISTER.ID`, `DDEREFERENCE`, `SQL.REQUEST`.

---

## 7. Bridge Architecture: Extension Removal vs. Proxy Gateway

- **Removed**: The external `konoha-bridge` VSIX extension feature from `https://github.com/andycungkrinx91/konoha-bridge` and its auto-install routines.
- **Preserved**: The **OpenAI-Compatible Local LLM Proxy Gateway** (`src/bridge/*`) running locally on port **19999** for token-efficient model routing remains active and protected.

---

## 8. Multi-Workflow Delegation & File Tools

- **Anti-Lost-in-the-Middle**: Dual-Boundary Anchoring (Sandwich Pattern) repeats invariants at prompt headers and tails.
- **Large File Pagination**: `read_file_range` auto-clamps spans $> 250$ lines to 200-line windows with actionable pagination metadata, eliminating exception refusals. Line-by-line stream reading bounds heap usage to $O(1)$.

---

## 9. Runtime Security & Node.js CVE Mitigation

- **October 2026 Node.js Security Advisory Compliance**: Shipped environments target Node.js LTS `v22.23.4+` (mitigating high-severity Brotli remote code execution and TLS/DNS security advisories).
- **Zero Known Vulnerabilities**: Verified through continuous automated auditing (`pnpm audit` reporting zero vulnerabilities across root and `apps/web` manifests).
- **Package Manager Mandate**: Scaffolding and installs strictly utilize `pnpm` with token-safe non-interactive flags; standalone unconstrained `npx` or `npm` fallbacks are permanently decommissioned.

---

## 10. Akatsuki Security Sandbox Controls & Dual-Mode Isolation

`@akatsuki` is the successor to the legacy BlackOps security identity and holds all dedicated offensive and defensive security responsibilities in Konoha. `@anbu` remains an independent agent focused on Backend engineering, DevOps, infrastructure automation, and bug fixing, escalating security reviews and vulnerability assessments to `@akatsuki`.

### 10.1 Dual-Mode Operation (`mode: blue | red`) & Governance Integration
- **Default Mode (`blue` — Defensive Security Review & SDLC Gate)**:
  - By default, `@akatsuki` operates in **Blue Mode (`mode: blue`)** as a standard, non-invasive defensive security reviewer integrated into Konoha SDLC governance (`runAkatsukiFinalGate`).
  - Blue Mode performs static application security testing (SAST) on modified files, secret/credential leakage detection (`.env*`, API tokens, private keys), dependency supply-chain CVE verification (`pnpm audit`, Socket CLI), and Skill Guardian policy checks (`src/workflow/kage-reviewer/skill_guardian.js`) before `@kage` evaluates the final delivery gate.
  - Normal defensive code review is standard engineering governance—not an invasive or unauthorized activity. In Blue Mode, any offensive `akatsuki-lab` container is stopped and removed (`fail-closed` safety invariant).
- **Authorized Red-Team Mode (`red` — Isolated Sandbox Assessment)**:
  - Switching to Red Mode via `konoha akatsuki mode red` or `konoha akatsuki enable` provisions an isolated, unprivileged sandbox container (`akatsuki-lab`) for authorized security assessments, penetration testing, and exploit verification within Konoha or an explicitly user-approved local/dev project scope.

### 10.2 Container Execution Engine Isolation (`env: docker | lxc`)
- **Host Execution Prohibited**: Direct execution of offensive security tools (`nmap`, `metasploit`, `zap`, `nuclei`, `ffuf`, `sqlmap`, `tshark`, `testssl`, `trivy`, `curl_probe`) on the host system is strictly blocked.
- **Docker Sandbox Engine (Default)**: Executes within container `akatsuki-lab` with `--security-opt=no-new-privileges:true`, `--cap-drop=ALL`, `--cap-add=NET_RAW`, non-root user `akatsuki` (UID 1000), internal bridge isolation (`internal: true`), 2GB memory cap, and 2 CPU core limit.
- **LXC Container Engine**: Executes within an unprivileged system container (`security.privileged=false`) bound to isolated bridge `labbr0` with strict egress ACL rejection (`lab-egress`).

### 10.3 Authorized Scope Boundaries & Persona Gating
- **Authorized vs. Prohibited Activity**:
  - **Authorized Scope**: Defensive Blue-Mode code review of the active workspace, dependency auditing, and authorized Red-Mode testing against `localhost`, `127.0.0.1`, local containers, or explicitly user-approved project targets under written Rules of Engagement (RoE).
  - **Prohibited Activity**: Targeting unauthorized external infrastructure, destructive payloads (`rm -rf`, `DROP`), credential exfiltration, or unconsented network probing is strictly forbidden and fails closed immediately.
- **Strict Persona Access**: Dedicated security skills (`akatsuki-skill` today; any skill named under the `pentest-` / `patch-diff-exploit-` prefixes, listed in `RED_SKILLS`, or tagged `red-team` / `pentest` / `offensive`) are classified red by the single registry `src/skill_authorization.js` and are strictly quarantined to `@akatsuki`. Invocations from other Ninja agents, or from anonymous callers, return `SKILL_AUTHORIZATION_DENIED` fail-closed. The gate runs at discovery (`find_skill`, `list_skills`), retrieval (`get_skill`), MCP dispatch, delegation (`buildSpawnDirective`), Sannin route/envelope, and inside `runRedTeamWorkflow`. At the MCP boundary the caller identity comes from `_resolveAgentIdentity(args)`, never from the requested tool name; an absent identity is a denial, not a pass. Discovery returns redacted metadata (`content: '[REDACTED]'`) rather than file bodies. See [docs/security/RED-SKILL-INVENTORY.md](security/RED-SKILL-INVENTORY.md).

### 10.4 Lab Database Segregation
- **Physically Separate SQLite File**: The Akatsuki Lab stores its run history, tool invocations, Kali catalog, and red-skill audit trail (`red_skill_audit`) in `~/.konoha/akatsuki-lab/lab.db` (`KONOHA_LAB_DB_ROOT` / `KONOHA_AKATSUKI_LAB_DB` overrides), opened only through `src/workflow/akatsuki/lab_db.js#openLabDb`. The main store (`~/.konoha/konoha.db`) remains untouched by lab provisioning, execution, and teardown.
- **Enforced by Connection Boundary**: `getConnection` refuses any path under the lab root (`LAB_DB_ISOLATION_VIOLATION`); `openRawConnection` never inherits `KONOHA_DB_PATH` and skips the main schema, migration, and vector setup. Lab child processes get `KONOHA_DB_PATH` pinned to the lab file. No config flag or option can move a lab write onto the main connection. See [docs/security/DATABASE-ISOLATION-INVENTORY.md](security/DATABASE-ISOLATION-INVENTORY.md).
- **Audit Write Is Never an Authority**: `runRedTeamWorkflow` attempts to record each red-skill decision (`allowed`/`denied`) through `auditRedSkill` (`src/workflow/akatsuki/lab_audit.js`) → `recordRedSkillAudit`, into a caller-supplied connection or an existing-file-only open that cannot create or migrate the store. Best-effort: a missing lab or a failed write costs the row and never changes the decision. Both the denial and allowed paths are covered; the identity recorded is the one the gate resolved.
- **Teardown Purge**: On confirmed teardown the lab file and its WAL sidecars are deleted; a failed teardown retains them for post-mortem. There is no backup surface for the lab store.

---

## 11. Bridge Payload Budget & 3D Reference-Image Ingress (v2.2.21)

### 11.1 Bridge Request Budget
- **Hard Ceilings**: `src/bridge/request_budget.js` enforces `MAX_BODY_BYTES = 32 MiB`, `MAX_INPUT_TOKENS = 200000` (estimated at ~3.5 chars/token), and `MAX_MESSAGES = 2000` per bridge request.
- **Reject Before Read**: `rejectOversizedByHeader()` runs before the request body is buffered, so an oversized `Content-Length` never allocates payload memory. In-stream payloads that exceed the transcript ceiling are cut off at the same boundary.
- **Cache Capability Is Never Assumed**: `src/bridge/cache_capability.js` reports cached-token support only for recognised Anthropic, OpenAI, and Google hosts (with Anthropic's 1024-token minimum and 4-breakpoint limit). An unrecognised endpoint is reported as `unknown` instead of being treated as cache-capable.
- **Prefix Stability**: `src/bridge/prefix_stability.js` refuses to emit provider cache hints when the prompt prefix contains volatile material (ISO timestamps, UUIDs, epoch milliseconds, job IDs), preventing cache-miss storms that silently multiply billed input tokens.

### 11.2 3D Reference-Image Upload
- **Decoded Size Cap**: `POST /api/v1/3d/upload-image` accepts at most 12 MiB of decoded image data; larger payloads are refused with `413`.
- **Magic-Byte Sniffing**: The declared filename extension is ignored. Only PNG, JPEG, and WebP signatures are accepted; anything else is refused with `415`.
- **Filename Sanitisation**: the reference stem is reduced to `[a-zA-Z0-9_-]` before it is used as a filesystem name, so upload names cannot traverse directories.
- **Authenticated Only**: the route requires an authenticated Web session like every other mutating `/api/v1/*` endpoint.

---
