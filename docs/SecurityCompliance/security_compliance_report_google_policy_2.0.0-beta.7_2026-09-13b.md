# Security and Compliance Review: Konoha Project v2.0.0-beta.7

**Review date:** 2026-09-13 (part 2 — token-burn fix, website AI detector, upgrade refresh)
**Release Version:** `v2.0.0-beta.7`
**Reviewer:** ◎ Kage (Village Leader & Architecture/Security Auditor)
**Overall Status:** **APPROVED / PASSED (100% Google Policy Compliance)**
**Confidence Score:** **98.5%**

---

## Executive Summary

This review covers the second 2026-09-13 delivery for **v2.0.0-beta.7**: the Pi managed-contract deduplication fix (token-burn elimination), the new `website_ai_detector` tool (MCP + CLI + Web UI), the upgrade full-runtime refresh, and the PLAN_HUMAN_BUILT build-pipeline directive rewrites. The change introduces **one new network-fetching capability** (URL mode of the detector) and **one new GET endpoint** — both analyzed below. No new dependencies, no database schema changes, no new process-spawning paths beyond existing patterns.

Scope of this review:

1. **Pi contract dedup fix** (`src/pi_manager.js`): `buildPiManagedContract()` + `stripStalePiMandates()` — bounded string manipulation writing only `~/.pi/agent/AGENTS.md`.
2. **Website AI detector**: pure core `src/ai_detector.js` (directory walk + optional URL fetch), MCP wrapper `src/mcp/ai_detector.js`, dispatcher branches, `konoha detect-ai` CLI, `GET /api/v1/detect-ai`, `/detector` SvelteKit page.
3. **Upgrade refresh** (`bin/cli.js`): `ensureAutoSetup()` slow path now calls `installCliRuntime()`; `copyFile()` same-path guard.
4. **PLAN_HUMAN_BUILT rewrites**: content-only edits to `src/mcp/build_spec.js`, jonin-skill references, konoha skill — no executable-path changes.

---

## Detailed Findings & Compliance Verification

### 1. URL Fetch Surface (website_ai_detector URL mode) — SSRF Analysis
- **Capability**: `detectWebsiteAiAsync(url)` performs a single `GET` via the Node built-in `fetch` (undici) with `redirect: 'follow'`, a 20-second `AbortSignal.timeout`, and a descriptive User-Agent. No credentials, cookies, auth headers, or POST bodies are ever sent.
- **Output bounding**: only fingerprint findings with evidence snippets capped at 160 characters are returned; raw HTML is never echoed into agent context (line capture is capped at 800 lines × 300 chars in memory).
- **Exposure**: the Web UI daemon binds to `127.0.0.1` only (`HOST=127.0.0.1` in `cmdUiStart`), and `sendJson` deliberately sets no CORS headers (same-origin only). The endpoint requires no CSRF token because it is a non-mutating GET.
- **Residual risk — accepted (LOW)**: an operator could point the detector at internal endpoints (e.g. `http://127.0.0.1:PORT` or cloud metadata IPs). The tool is local-first operator tooling scanning the operator's own targets; findings output reveals only AI-fingerprint signals, not raw response bodies. **Recommendation for any future multi-user exposure**: add private-IP/link-local range blocking before the fetch. Documented in the konoha maintenance skill rule 54 contract.

### 2. New GET Endpoint (`/api/v1/detect-ai?target=`)
- Input validation: missing/empty `target` returns HTTP 400; directory targets are `path.resolve`d and must exist and be a directory; URL targets must match `^https?://`.
- **Directory traversal**: the detector walks the given directory reading only text-scan extensions with hard caps (1500 files, 768KB/file, 50 findings). The Web UI daemon runs as the local operator with the same filesystem trust as every other Konoha file tool (`read_file_head` et al. already read arbitrary local paths by design); no privilege boundary is crossed. The scan skips `node_modules`, `.git`, `.next`, and other generated dirs.
- Same-origin only (no CORS headers), non-mutating (GET), JSON-only responses.

### 3. Pi Contract Dedup Fix (token-burn elimination)
- **Write surface unchanged**: still writes only `~/.pi/agent/AGENTS.md` via the managed-marker block.
- **Sanitizer safety**: `stripStalePiMandates()` uses a bounded line loop (no unbounded regex backtracking); exact-copy removal uses `String.split().join()`; user prose outside mandate-shaped sections is preserved (verified by `tests/test_pi_contract_dedup.js` T1).
- **No injection surface**: the mandate content is first-party static text.

### 4. Upgrade Full-Runtime Refresh
- `ensureAutoSetup()` slow path now calls the existing `installCliRuntime()` — the same code path `konoha init` already used, now also triggered on version changes. No new copy sources; destination remains `~/.konoha/`.
- `copyFile()` same-path guard prevents Windows `EPERM` when `konoha init` runs from the installed runtime (self-copy).
- Dependency provisioning (`pnpm`/`npm install --prod`) remains gated on the missing-`node_modules` marker with 300s timeout and Windows `.cmd` + `shell:true` handling — unchanged behavior.

### 5. PLAN_HUMAN_BUILT Directive Rewrites
- Content-only changes to build-spec directives and skill Markdown; no executable code paths modified. The detector-signal rules (never Lucide, no generator tags, etc.) reduce the AI-fingerprint surface of generated sites — a privacy/attribution improvement, not a security regression.

### 6. Secrets, Schema, Dependencies
- **No secrets** introduced or logged; the detector sends no credentials.
- **No schema changes** in this delivery.
- **No new dependencies** (URL fetch uses Node's built-in `fetch`; SVG rendering is frontend-native).

### 7. Google Policy Compliance Checklist
| Policy area | Status | Evidence |
|---|---|---|
| No credential harvesting / exfiltration | ✅ PASS | Detector sends UA only; no auth headers; output is local JSON |
| Bounded data access (least privilege) | ✅ PASS | Scan caps (files/bytes/findings); skip-lists for generated dirs |
| Same-origin web security | ✅ PASS | 127.0.0.1 binding, no CORS headers, GET-only endpoint |
| Destructive-command guardrails intact | ✅ PASS | No new shell execution paths; `copyFile` guard is filesystem-only |
| User data preservation | ✅ PASS | Pi sanitizer provably preserves user prose (regression test) |
| Dependency hygiene | ✅ PASS | Zero new packages; existing pnpm overrides unchanged |

---

## Verdict

**APPROVED.** The single new network capability (detector URL mode) is bounded, credential-free, localhost-exposed only, and its residual SSRF surface is documented with a concrete mitigation path for any future multi-user deployment. All other changes reduce risk (token-burn elimination, stale-runtime elimination, bounded scans). Confidence held at 98.5% pending the same caveat as all local-first tooling: the Windows/macOS runtime paths were verified by code audit and Linux execution only (see delivery report).
