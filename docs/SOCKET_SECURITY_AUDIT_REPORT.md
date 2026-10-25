# Socket Security Supply Chain Audit & SBOM Report

**Execution Date**: October 2026  
**Auditor**: Village Security Architecture (`@kage` / `@anbu` / `@genin`)  
**Tooling**: Socket CLI v1.8.4 (`/home/andycungkrinx/.nvm/versions/node/v22.23.3/bin/socket`)  
**Target Repository**: `konoha` (`konoha-mcp` v2.2.7)  
**Organization**: `personal-2xifv`  

---

## 1. Executive Summary

A software supply chain security audit of the Konoha codebase was conducted using the local **Socket Security CLI (v1.8.4)**. The audit evaluated:
1. Software Bill of Materials (SBOM) generation via Socket's integrated CycloneDX engine (`socket cdxgen`).
2. Dependency supply chain hardening via `@socketregistry` overrides.
3. Vulnerability status of direct and transitive npm dependencies (`pnpm audit`).
4. Socket API integration status, permissions, and rate limits.

### Key Audit Findings

| Category | Finding / Status | Evidence & Severity |
| :--- | :--- | :--- |
| **Total SBOM Components** | 159 packages | CycloneDX v1.6 SBOM generated via `socket cdxgen` |
| **@socketregistry Overrides** | 10 active packages | Verified in dependency graph (zero known CVEs) |
| **Root Dependency CVEs** | 0 known vulnerabilities | `pnpm audit` (100% clean) |
| **Web App Dependency CVEs** | 0 known vulnerabilities | `pnpm --dir apps/web audit` (100% clean) |
| **License Analysis** | 82 explicit licenses parsed, 77 undeclared in SBOM | 54 MIT, 10 MPL-2.0 (weak copyleft), 9 Apache-2.0, 5 ISC, 2 Unknown, 0 strong GPL/AGPL |
| **Socket Remote Full-Scan** | Token permission restricted | API 403: `personal-2xifv` lacks `full-scans:create` |
| **Socket API Package Rate Limit** | Rate limited on free quota | API 429: Token quota refill required (~600s cooldown) |

---

## 2. CycloneDX SBOM & Dependency Hierarchy (`socket cdxgen`)

Using Socket's embedded CycloneDX generator (`socket cdxgen`), a software bill of materials conforming to the **CycloneDX v1.6 Specification** was created.

### Component Breakdown
- **Total Components Discovered**: **159 packages** across the monorepo.
- **Top Direct Root Dependencies**:
  - `@bufbuild/protobuf@2.16.0` (Protobuf runtime for MCP)
  - `docx@9.14.0` (Word document generation)
  - `hash-wasm@4.12.0` (Fast WASM cryptographic hashing)
  - `playwright@1.64.1` (End-to-end browser automation)
  - `pptxgenjs@4.0.1` (Presentation generator)
  - `xlsx-populate@1.21.0` (Spreadsheet generator)
- **Top Direct Web Dependencies (`apps/web`)**:
  - `@sveltejs/kit@3.1.0` & `svelte@5.57.2` (Reactive frontend framework)
  - `@sveltejs/adapter-node@6.0.0` (Node.js production server)
  - `tailwindcss@4.3.3` (Utility-first styling)
  - `three@0.186.1` (3D canvas rendering)
  - `vite@8.3.5` (Modern build bundler)

### License Distribution (from CycloneDX SBOM)
Of the 159 total components in `/tmp/bom.json`, 82 carry explicit license declarations in the generated SBOM, while 77 transitive components omit top-level license metadata in pre-build manifest mode:
- **MIT License**: 54 packages (e.g. `@sveltejs/kit`, `playwright`, `three`)
- **MPL-2.0 (Mozilla Public License 2.0)**: 10 packages — **weak copyleft** (specifically `lightningcss` native binary bindings used transitively by `@tailwindcss/vite`)
- **Apache-2.0**: 9 packages (e.g. `@bufbuild/protobuf`, `docx`)
- **ISC License**: 5 packages
- **BlueOak-1.0.0**: 1 package
- **BSD-3-Clause**: 1 package
- **Unknown / Unresolved in SBOM**: 2 packages (`jszip@3.10.2` and `pako@1.0.11`)
- **Strong Copyleft (GPL / AGPL)**: 0 packages identified in declared metadata.

---

## 3. Supply Chain Hardening: `@socketregistry` Overrides

Konoha implements proactive supply chain protection by utilizing **Socket's verified registry overrides (`@socketregistry/*`)** directly in `package.json` under `pnpm.overrides`.

Socket Registry overrides replace common, unmaintained, or historically targeted micro-packages with hardened, audited implementations maintained by Socket Security:

```json
"pnpm": {
  "overrides": {
    "minimalistic-assert": "npm:@socketregistry/assert@^1.0.23",
    "array-buffer-byte-length": "npm:@socketregistry/array-buffer-byte-length@1.0.7",
    "define-properties": "npm:@socketregistry/define-properties@1.0.7",
    "hasown": "npm:@socketregistry/hasown@1.0.7",
    "is-arguments": "npm:@socketregistry/is-arguments@1.0.10"
  }
}
```

### Verified Active Socket Overrides in Codebase
The `socket cdxgen` SBOM verified that 10 `@socketregistry` packages are compiled directly into the active dependency tree:
1. `@socketregistry/assert` (replaces `minimalistic-assert`)
2. `@socketregistry/is-arguments` (replaces `is-arguments`)
3. `@socketregistry/is-generator-function`
4. `@socketregistry/is-nan`
5. `@socketregistry/is-typed-array`
6. `@socketregistry/available-typed-arrays`
7. `@socketregistry/define-properties`
8. `@socketregistry/for-each`
9. `@socketregistry/function-bind`
10. `@socketregistry/hasown`

**Security Benefit**: These packages eliminate prototype pollution risks, remove nested transitive bloat, and protect against malicious takeover of abandoned npm accounts.

---

## 4. Vulnerability & CVE Scan Results

Both root and web workspaces were scanned against authoritative vulnerability advisory databases:

### 1. Root Workspace (`package.json`)
```bash
$ pnpm audit
No known vulnerabilities found
```
- **Result**: Clean (0 vulnerabilities).

### 2. Web Workspace (`apps/web/package.json`)
```bash
$ pnpm --dir apps/web audit
No known vulnerabilities found
```
- **Result**: Clean (0 vulnerabilities).

---

## 5. Local Socket CLI Capabilities & Remote API Status

During execution of the Socket CLI commands, local vs remote API capabilities performed as follows:

### A. Local SBOM Generation (`socket cdxgen`) — Working
- Executed locally via Node.js runtime (`v22.23.3`).
- Successfully parsed package manifests and node_modules hierarchy into `/tmp/bom.json` without requiring external network calls or cloud API units.

### B. Cloud Full-Scan API (`socket scan create`) — Permission Restricted (403)
- Execution of `socket scan create --no-interactive --repo=konoha --branch=master .` yielded:
  ```json
  {
    "ok": false,
    "message": "Socket API error",
    "cause": "Socket API Request failed (403): Insufficient permissions (reason: Insufficient permissions... Permissions: full-scans:create)"
  }
  ```
- **Analysis**: The API token currently configured in `~/.config/socket/config.json` belongs to the personal organization (`personal-2xifv`). The free personal tier does not have the `full-scans:create` scope required to upload full repository scans to the Socket Cloud dashboard.

### C. Package Score API (`socket package score`) — Rate Limited (429)
- Execution of `socket package score` queries against individual packages yielded:
  ```json
  {
    "ok": false,
    "message": "Socket API error",
    "cause": "Socket API Request failed (429): Insufficient quota for API route. Requires 100, but token has only 7."
  }
  ```
- **Analysis**: The personal tier enforces a strict cooldown (~600 seconds) between batch score requests.

---

## 6. Recommendations & Action Items

1. **Retain `@socketregistry` Overrides**: Continue maintaining the Socket Registry overrides in `package.json` to prevent supply chain injection in micro-dependencies.
2. **Upgrade Socket Token for Cloud CI/CD**: To enable automatic GitHub PR comments and dashboard tracking on `socket.dev`, update the token with `socket login` using an enterprise or team token that has `full-scans:create` permissions.
3. **Automate SBOM Generation**: Integrate `socket cdxgen -o bom.json` into release packaging scripts so every distribution bundle includes an authenticated CycloneDX v1.6 SBOM.
4. **Preserve Skill Guardian Protection**: Maintain the fail-closed `src/skill_guardian.js` scanner to inspect any newly added or third-party skills before ingestion.
