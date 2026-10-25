# Socket Security Supply Chain Audit & SBOM Report

**Execution Date**: October 2026  
**Auditor**: Village Security Architecture (`@kage` / `@anbu` / `@genin`)  
**Tooling**: Socket CLI v1.8.4 (`/home/andycungkrinx/.nvm/versions/node/v22.23.3/bin/socket`)  
**Target Repository**: `konoha` (`konoha-mcp` v2.2.7)  
**Organization**: `personal` (ID: 372972, Plan: `free`)  
**Active Token**: `Xi-1v***`  

---

## 1. Executive Summary & Scope Boundaries

A software supply chain security audit of the Konoha codebase was conducted using the local **Socket Security CLI (v1.8.4)** with the refreshed API token.

### Audit Scope & Multi-Tier Coverage Boundaries
To ensure complete transparency and prevent overstating coverage, the evaluation boundaries are divided into three distinct audit tiers:

1. **Direct Packages Scored via Socket API (20 Packages)**:
   - **12 Direct NPM Dependencies**: 100% of production and web frameworks were directly queried against Socket's package security API (`socket package shallow npm ...`).
   - **8 PyPI Security Tools & Reference Packages**: Key firmware, reverse-engineering, and networking tools were queried against Socket (`socket package shallow pypi ...`).
2. **Transitive NPM Dependency Graph (147 Transitive Components)**:
   - Mapped into a CycloneDX v1.6 SBOM using `socket cdxgen` (159 components total).
   - Transitive vulnerability checking was executed via `pnpm audit` and `pnpm --dir apps/web audit` (**0 known vulnerabilities** found). Transitives were not individually queried against the Socket API due to rate-limit quotas.
3. **Full Python Skills Corpus (336 Packages)**:
   - The broader 336-package Python skill set across 4,199 files was evaluated via our deterministic OSV and PyPI JSON API database auditor (`scripts/audit_python_skills_deps.js`), not via Socket API.

### Key Audit Findings

| Category | Finding / Status | Evidence & Verification |
| :--- | :--- | :--- |
| **Total SBOM Components** | 159 packages | CycloneDX v1.6 SBOM generated via `socket cdxgen` |
| **Direct npm Vulnerability Score** | **100 / 100 Clean (12/12)** | Socket Security API (`socket package shallow npm ...`) |
| **PyPI Modern Replacements** | **100 / 100 Clean** | `unblob@26.6.4` and `binwalk3@3.2.0` both score 100 on Vuln |
| **Excluded Legacy Libraries** | **25 / 100 Critical Risk** | Socket flags `chromadb` & `pymetasploit3` with `criticalCVE` |
| **@socketregistry Overrides** | 10 active packages | Verified in dependency graph (zero known CVEs) |
| **Production Dependency CVEs** | 0 known vulnerabilities | `pnpm audit` & `pnpm --dir apps/web audit` |
| **NPM License Distribution** | 82 explicit, 77 undeclared | 54 MIT, 10 MPL-2.0 (weak copyleft), 9 Apache-2.0, 5 ISC, 2 Unknown |
| **Socket Remote Full-Scan** | Plan restricted | API 403: Personal free tier lacks `full-scans:create` |

---

## 2. Live Socket Security Scores: Direct NPM Dependencies

All 12 direct npm dependencies across the root and web workspaces were queried via `socket package shallow npm`:

| Package | Version | Vuln Score | Supply Chain | Quality | License | Socket Alerts / Capabilities |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `@bufbuild/protobuf` | 2.16.0 | **100 / 100** | 99 / 100 | 87 / 100 | Apache-2.0 / BSD-3 | `envVars` (low) |
| `docx` | 9.14.0 | **100 / 100** | 99 / 100 | 100 / 100 | MIT | `urlStrings` (low) |
| `hash-wasm` | 4.12.0 | **100 / 100** | 97 / 100 | 100 / 100 | Apache-2.0 / MIT | `urlStrings` (low) |
| `playwright` | 1.64.1 | **100 / 100** | 100 / 100 | 100 / 100 | Apache-2.0 / MIT | `urlStrings` (low) |
| `pptxgenjs` | 4.0.1 | **100 / 100** | 98 / 100 | 100 / 100 | MIT | `gptSecurity` (middle), `urlStrings` (low) |
| `xlsx-populate` | 1.21.0 | **100 / 100** | 99 / 100 | 100 / 100 | MIT | `filesystemAccess` (low), `unmaintained` (low) |
| `@sveltejs/kit` | 3.1.0 | **100 / 100** | 99 / 100 | 81 / 100 | MIT | `urlStrings` (low) |
| `@sveltejs/adapter-node` | 6.0.0 | **100 / 100** | 100 / 100 | 75 / 100 | MIT | `filesystemAccess` (low) |
| `svelte` | 5.57.2 | **100 / 100** | 87 / 100 | 87 / 100 | MIT | `urlStrings` (low) |
| `tailwindcss` | 4.3.3 | **100 / 100** | 100 / 100 | 83 / 100 | MIT | `urlStrings` (low) |
| `three` | 0.186.1 | **100 / 100** | 97 / 100 | 97 / 100 | Apache-2.0 / MIT | `gptSecurity` (middle), `gptAnomaly` (low) |
| `vite` | 8.3.5 | **100 / 100** | 98 / 100 | 82 / 100 | MIT / BSD / ISC | `urlStrings` (low) |

**Result**: 100% of Konoha's direct npm production dependencies achieve a perfect **100/100 Vulnerability Score** with zero high or critical security alerts.

---

## 3. Live Socket Security Scores: Audited PyPI Tools & Reference Libraries

Eight key Python tools and reference libraries were queried via `socket package shallow pypi`.

*Note: Specific CVE IDs listed below are cross-referenced from authoritative OSV/NVD database records matching Socket's severity alerts.*

| Package | Version | Vuln Score | Supply Chain | Quality | License | Socket Alerts & Cross-Referenced Findings |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`unblob`** *(Adopted)* | 26.6.4 | **100 / 100** | 98 / 100 | 100 / 100 | MIT / Zlib | `hasNativeCode` (middle), `shellAccess` (middle), `filesystemAccess` (low), `urlStrings` (low). 0 CVEs. |
| **`binwalk3`** *(Adopted)* | 3.2.0 | **100 / 100** | 98 / 100 | 99 / 100 | MIT | `gptDidYouMean` (middle), `shellAccess` (middle), `unpopularPackage` (middle). 0 CVEs. |
| **`pefile`** *(Audited)* | 2024.8.26 | **100 / 100** | 99 / 100 | 100 / 100 | MIT | `filesystemAccess` (low), `urlStrings` (low). 0 CVEs. |
| **`scapy`** *(Dual-Use)* | 2.7.0 | **100 / 100** | 74 / 100 | 100 / 100 | **GPL-2.0** (Copyleft) | `mildCVE` (low), `networkAccess` (middle), `shellAccess` (middle), `copyleftLicense` (low). |
| **`paramiko`** *(Dual-Use)* | 4.0.0 | **99 / 100** | 72–88 / 100 | 100 / 100 | **LGPL-2.1** (Weak copyleft) | `mildCVE` (low), `networkAccess` (middle), `shellAccess` (middle), `copyleftLicense` (low). |
| **`binwalk`** *(Replaced)* | 2.1.0 | **99 / 100** | 100 / 100 | 98 / 100 | MIT | `mediumCVE` (middle — *cross-ref CVE-2021-4287 symlink traversal*), `unmaintained` (low). |
| **`chromadb`** *(Dropped)* | 1.5.9 | **25 / 100** | 72–73 / 100 | 100 / 100 | Apache-2.0 | `criticalCVE` (critical — *cross-ref CVE-2026-45830 auth bypass*), multiple `cve` (high) alerts. |
| **`pymetasploit3`** *(Dropped)* | 1.0.6 | **25 / 100** | 99 / 100 | 100 / 100 | LGPL-3.0 | `criticalCVE` (critical — *cross-ref CVE-2026-5463 command injection*), `copyleftLicense` (low). |

### Key Observations on PyPI Tools
1. **Validation of Exclusions**: Socket rates both `chromadb@1.5.9` and `pymetasploit3@1.0.6` at **25 / 100** with `criticalCVE` alerts, confirming they represent critical supply chain risks.
2. **License Constraints in Skills**: `scapy` carries a **GPL-2.0 strong copyleft** license and `paramiko` carries an **LGPL-2.1 weak copyleft** license. While acceptable for optional standalone reference scripts, they must not be embedded into proprietary runtime binaries.
3. **Mild CVE Alerts**: `paramiko` and `scapy` flag `mildCVE` in Socket's feed (minor upstream protocol quirks), reinforcing that offensive networking libraries must only run within containerized sandboxes.

---

## 4. Supply Chain Hardening: `@socketregistry` Overrides

Konoha implements proactive supply chain protection by utilizing **Socket's verified registry overrides (`@socketregistry/*`)** directly in `package.json` under `pnpm.overrides`.

The `socket cdxgen` SBOM verified that 10 `@socketregistry` packages are compiled directly into the active dependency tree:
1. `@socketregistry/assert` (replaces `minimalistic-assert`)
2. `@socketregistry/is-arguments`
3. `@socketregistry/is-generator-function`
4. `@socketregistry/is-nan`
5. `@socketregistry/is-typed-array`
6. `@socketregistry/available-typed-arrays`
7. `@socketregistry/define-properties`
8. `@socketregistry/for-each`
9. `@socketregistry/function-bind`
10. `@socketregistry/hasown`

---

## 5. CycloneDX SBOM & License Compliance

A complete software bill of materials conforming to the **CycloneDX v1.6 Specification** was generated via `socket cdxgen -o /tmp/bom.json`:
- **Total Components Discovered**: **159 packages** across root and web workspaces.

### License Breakdown (from CycloneDX SBOM)
Of the 159 components in `/tmp/bom.json`, 82 carry explicit license declarations in the generated SBOM, while 77 transitive components omit top-level license metadata in pre-build manifest mode:
- **MIT License**: 54 packages (e.g. `@sveltejs/kit`, `playwright`, `three`, `tailwindcss`)
- **MPL-2.0 (Mozilla Public License 2.0)**: 10 packages — **weak copyleft** (specifically `lightningcss` native binary bindings used transitively by `@tailwindcss/vite`)
- **Apache-2.0**: 9 packages (e.g. `@bufbuild/protobuf`, `docx`)
- **ISC License**: 5 packages
- **BlueOak-1.0.0**: 1 package
- **BSD-3-Clause**: 1 package
- **Unknown / Unresolved in SBOM**: 2 packages (`jszip@3.10.2` and `pako@1.0.11`)
- **Strong Copyleft in NPM Production**: **0 packages** (no GPL/AGPL dependencies in root or web npm production packages).

---

## 6. Socket Platform Integration & Cloud API Details

The status of Socket CLI commands with the refreshed `personal` plan token (`Xi-1v***`):

### A. Local SBOM Generation (`socket cdxgen`) — Fully Operational
- Generates authenticated CycloneDX v1.6 SBOMs locally with 159 components.
- Zero API quota consumption.

### B. Package Score & Shallow API (`socket package shallow`) — Fully Operational
- Successfully executes batch queries across npm and PyPI ecosystems.
- Returns comprehensive vulnerability scores, supply chain scores, capabilities, and security alert lists.

### C. Cloud Full-Scan API (`socket scan create`) — Plan Restricted (403)
- Execution of `socket scan create .` returns HTTP 403: `Insufficient permissions (Permissions: full-scans:create)`.
- The user's token belongs to organization `personal` (Plan: `free`). In Socket.dev's API matrix, uploading full repository scans to the web dashboard requires a Team or Enterprise plan.

---

## 7. Conclusion & Next Steps

1. **Supply Chain Integrity Verified**: All 12 direct npm dependencies and all audited modern skills tools score **100/100 on Vulnerability**.
2. **Threat Feed Parity**: Socket's threat feed independently confirms that `chromadb` (25/100) and `pymetasploit3` (25/100) are critical risks that must remain excluded.
3. **Dual-Use Tooling Isolation**: Reference security tools carrying copyleft licenses (`scapy` GPL-2.0, `paramiko` LGPL-2.1) or `mildCVE` alerts must remain quarantined inside Docker environments.
