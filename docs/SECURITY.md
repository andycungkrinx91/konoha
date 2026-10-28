# Konoha MCP Security Architecture & Ingress Controls (v2.2.11)

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

### 10.1 Dual-Mode Operation (`mode: blue | red`)
- **Default Mode (`blue`)**: Blue-Team defensive security operates directly on the host for static application security testing (SAST), secrets scanning, dependency CVE verification, and delivery gate checks. In blue mode, any offensive `akatsuki-lab` container is stopped and removed (`fail-closed` safety invariant).
- **Offensive Mode (`red`)**: Requires explicit authorization. Switching to red mode via `konoha akatsuki mode red` or `konoha akatsuki enable` automatically provisions an isolated, unprivileged sandbox container (`akatsuki-lab`).

### 10.2 Container Execution Engine Isolation (`env: docker | lxc`)
- **Host Execution Prohibited**: Direct execution of offensive security tools (`nmap`, `metasploit`, `zap`, `nuclei`, `ffuf`, `sqlmap`, `tshark`, `testssl`, `trivy`, `curl_probe`) on the host system is strictly blocked.
- **Docker Sandbox Engine (Default)**: Executes within container `akatsuki-lab` with `--security-opt=no-new-privileges:true`, `--cap-drop=ALL`, `--cap-add=NET_RAW`, non-root user `akatsuki` (UID 1000), internal bridge isolation (`internal: true`), 2GB memory cap, and 2 CPU core limit.
- **LXC Container Engine**: Executes within an unprivileged system container (`security.privileged=false`) bound to isolated bridge `labbr0` with strict egress ACL rejection (`lab-egress`).

### 10.3 Persona Boundary & Offensive Skill Gating
- **Strict Persona Access**: Offensive security skills (`akatsuki-skill`, `patch-diff-exploit`, `pentest-osint-recon`, `php-cve-patch-collection-maintenance`) are strictly quarantined to `@akatsuki`. Invocations from other Ninja agents (`@genin`, `@anbu`, `@jonin`, `@kage`, `@chunin`) are denied fail-closed.
- **Rules of Engagement (RoE) Authorization**: Offensive tasks must include written authorization defining target scope, emergency cutoff, and authorized operator consent. Ambiguous or out-of-scope targets are refused.
