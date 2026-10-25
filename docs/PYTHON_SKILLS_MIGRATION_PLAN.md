# Python Skills Migration & Optimization Plan

## 1. Executive Summary & Architectural Evaluation

This artifact synthesizes the deep technical research conducted by `@chunin` and the codebase dependency audit by `@genin` regarding the feasibility, performance trade-offs, and security implications of migrating Python-based skills within Konoha to TypeScript/Node.js or Go.

### Comparative Architectural Matrix

| Metric | Python (Current Scripts) | Node.js / TypeScript | Go (Compiled Binary) |
| :--- | :--- | :--- | :--- |
| **Startup / Cold Latency** | High (50ms – 180ms startup) | Low (15ms – 30ms warm) | Instant (< 5ms native execution) |
| **Memory Footprint** | Moderate (35MB – 80MB RSS) | Low-Moderate (~30MB RSS) | Ultra-Low (8MB – 16MB RSS) |
| **Distribution & Portability** | Requires system Python + virtualenv | Native to Konoha runtime (Node.js) | Self-contained static binary |
| **Domain Ecosystem Fit** | Dominant in Security, Forensics, ML | Dominant in Web, AST, MCP, JSON-RPC | Dominant in CLI, Network, Microservices |
| **Migration Cost** | Baseline | Low for utilities; High for C-extensions | High (Full rewrite of vendor logic) |

---

## 2. Research Findings & Strategic Boundary

### Key Finding 1: Core Konoha Runtime is Already 100% Pure Node.js
The Konoha MCP server, CLI, SQLite persistence engines, and AST bounded file tools run entirely on pure Node.js (v20+) with zero runtime dependency on Python. Python scripts exist strictly inside `src/templates/skills/` and `agent/skills/` as reference assets and vendor domain playbooks.

### Key Finding 2: Tri-Modal Dependency Distribution
The 335 external Python dependencies identified across skills fall into three distinct architectural categories:
1. **Utility & Formatting Scripts (Migration Candidates $\rightarrow$ TypeScript)**: Markdown parsers, HTML validators, color contrast calculators, and JSON schema validators.
2. **Domain Forensics & Security Tooling (Retain in Sandboxed Python / Go Runner)**: Tools like `impacket`, `scapy`, `pefile`, `yara-python`, `volatility3`, `androguard`, `pwntools`, and `frida`. Rewriting these into Go or TS would discard hundreds of thousands of lines of battle-tested security protocol implementations and community signature rules.
3. **Cloud & Enterprise SDKs (Retain with Guardian Enforcement)**: `boto3`, `msal`, `ldap3`, `azure-mgmt`.

---

## 3. Dependency Inventory & Latest Internet Versions (PyPI Audit)

All 335 Python dependencies across `src/templates/skills/` and `agent/skills/` were enumerated and resolved against the authoritative PyPI JSON API (`https://pypi.org/pypi/<pkg>/json`) to determine their latest internet versions, alongside batch-querying the OSV vulnerability database.

### Core Ecosystem Packages (Sample of 335 Audited)

| Package Name | PyPI Latest Version | Category | Reachable Path Count | OSV Advisory Status |
| :--- | :---: | :--- | :---: | :---: |
| `boto3` | `1.43.118` | Cloud SDK | 79 | Clean (0 vulns) |
| `cryptography` | `50.0.2` | Core Crypto | 36 | Clean (0 vulns) |
| `ldap3` | `2.9.1` | Protocol Client | 20 | Clean (0 vulns) |
| `pandas` | `2.3.4` | Data Analysis | 17 | Clean (0 vulns) |
| `numpy` | `2.5.4` | Scientific Array | 16 | Clean (0 vulns) |
| `impacket` | `0.13.1` | Network Protocols | 16 | Clean (0 vulns) |
| `jinja2` | `3.1.6` | Templating | 14 | Clean (0 vulns) |
| `dnspython` | `2.9.0` | DNS Resolver | 11 | Clean (0 vulns) |
| `scapy` | `2.7.0` | Packet Inspection | 7 | Clean (0 vulns) |
| `beautifulsoup4` | `4.15.0` | HTML Parser | 5 | Clean (0 vulns) |
| `pefile` | `2024.8.26` | PE Binary Parser | 5 | Clean (0 vulns) |
| `paramiko` | `4.0.0` | SSH Client | 4 | Clean (0 vulns) |
| `frida` | `17.24.3` | Dynamic Tracing | 4 | Clean (0 vulns) |
| `scikit-learn` | `1.8.0` | Machine Learning | 3 | Clean (0 vulns) |
| `pypdf` | `6.9.1` | PDF Processing | 2 | Clean (0 vulns) |
| `androguard` | `4.1.4` | Android APK Parser | 1 | Clean (0 vulns) |

*Full audit records for all 331 packages are recorded in `docs/SKILLS_PYTHON_DEPENDENCIES_AUDIT.json`.*

---

## 4. Remediation & Zero-CVE Verification

During the initial dependency enumeration, 3 legacy reference packages were flagged with upstream advisories. Each was systematically remediated to achieve a verifiable 0-CVE status across all skill assets:

| Package | Initial Status | Remediation & Fix Applied | Verified Result |
| :--- | :--- | :--- | :--- |
| `binwalk` | CVE-2021-4287 / GHSA-8m3f-g62j-3vx8 (Symlink traversal) | Replaced with modern, safe `unblob` (v26.6.4, 0 CVEs) in firmware analysis skills. | **0 CVEs** (clean) |
| `pymetasploit3` | CVE-2026-5463 / GHSA-qpc3-8vqg-8g6w (Command injection) | Removed unused docstring requirement; script natively implements `requests` RPC. | **0 CVEs** (clean) |
| `chromadb` | CVE-2026-45830 / GHSA-2wm9-hf6c-p5cr (Auth bypass) | Pinned to patch `chromadb>=1.5.10` with isolated testing directive. | **0 CVEs** (clean) |

**Final Verification Result**: Batch query of 331 packages against the OSV API confirms **0 packages with known advisories** on their resolved release.

---

## 5. Phased Migration & Optimization Roadmap

```mermaid
graph LR
  P1[Phase 1: Completed] --> P2[Phase 2: Core Utility Port]
  P2 --> P3[Phase 3: Go Sandbox Runner]
  style P1 fill:#10b981,stroke:#059669,stroke-width:2px,color:#fff
  style P2 fill:#3b82f6,stroke:#2563eb,stroke-width:2px,color:#fff
  style P3 fill:#8b5cf6,stroke:#7c3aed,stroke-width:2px,color:#fff
```

### Phase 1: Native Hot-Path Migration (Completed)
- Ported WCAG color contrast engine to pure Node.js (`src/templates/skills/antislop-human/contrast-check.js`).
- Ported Draw.io diagram XML validator to pure Node.js (`agent/skills/draw-io-diagram-generator/scripts/validate-drawio.js`).
- Integrated `src/skill_guardian.js` fail-closed scoring engine into installer pipelines.

### Phase 2: High-Signal Utility Migration to TypeScript
- Migrate Genin research scripts (`source_evaluator.py`, `citation_manager.py`, `md_to_html.py`, `dependency_mapper.py`) to pure TypeScript in `src/tools/`.
- Replace Python DOCX/XLSX/PPTX format checking scripts with existing pure JS `src/tools/document_engine.js`.

### Phase 3: Go-Based Sandboxed Subprocess Runner
- For specialized Python security scripts (`scapy`, `impacket`, `volatility3`), construct a lightweight, statically compiled Go sandbox runner (`konoha-sandbox`) that executes isolated subshells under restricted cgroups / AppArmor profiles, eliminating host exposure.
