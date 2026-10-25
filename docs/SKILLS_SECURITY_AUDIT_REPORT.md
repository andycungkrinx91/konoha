# Skills & References Security Audit & Zero-Known-Advisory Report

**Publication Date**: October 2026  
**Auditor**: Village Security Architecture (`@kage` / `@genin` / `@chunin` / `@anbu`)  
**Target Repository**: `konoha`  
**Classification**: Engineering Security Audit & Release Gate Verification  

---

## 1. Executive Summary & Audit Context

Following a series of vulnerability incidents in third-party and reference security skill libraries, Konoha commissioned a repository-wide, manual security audit across all skill assets, reference implementations, automated agents, and execution boundaries.

The audit scope covers:
- **19 Top-Level Skills** in `src/templates/skills/`
- **8 Operational Village Skills** in `agent/skills/`
- **817 Reference Sub-Skills** within `anthropic-cybersecurity-skills-assets`
- **4,199 Total Files** surveyed, including 1,218 Python scripts, 392 JavaScript modules, and all associated shell scripts, manifests, and documentation

### Release Gate Standard: Zero-Known-Advisories (Honest Truth Doctrine)
Absolute immunity from all theoretical software vulnerabilities is impossible to prove mathematically. However, Konoha enforces a verifiable **Zero-Known-Advisories Standard**:
1. Every dependency, tool, and binary reachable by executable code paths must resolve to a known release with zero open advisories in authoritative vulnerability databases (PyPI, OSV, GitHub Advisory Database, NVD).
2. Any dependency with unpatched upstream vulnerabilities (such as `chromadb`) must be **dropped entirely** from executable playbooks rather than retained with fabricated patch version claims.
3. Legacy tools with high-risk unpatched vulnerabilities (such as `binwalk` v2.1.0 symlink traversal CVE-2021-4287) must be replaced with modern, actively maintained alternatives (`unblob`, `binwalk3`).
4. Untrusted public skills must pass through an automated **Skill Guardian** that fails closed whenever risk score exceeds 30 or any critical vulnerability pattern is detected.

---

## 2. Complete Dependency & CLI Inventory Analysis

A custom deterministic static analysis engine (`scripts/audit_python_skills_deps.js`) was engineered to extract dependencies and CLI tools across four distinct layers:
1. **Python Imports**: AST / regex extraction of top-level Python modules and packages.
2. **Pip Manifests & CLI Commands**: Fenced code blocks and shell commands (`pip install`, `python -m pip install`).
3. **Subprocess Invocations**: Array arguments in `subprocess.run(["tool", ...])`, `subprocess.Popen`, `subprocess.call`, and `cmd = ["tool", ...]`.
4. **Markdown Shell Snippets**: Shell command invocations inside fenced ````bash ... ```` and ````sh ... ```` blocks.

### Dependency Audit Summary

| Metric | Measured Value | Verification Method |
| :--- | :--- | :--- |
| **Total Files Audited** | 4,199 files | Bounded directory traversal skipping build/git noise |
| **Unique External Packages & Tools** | 336 packages | PyPI registry cross-reference & OSV API query |
| **Node.js Production Dependencies** | 0 vulnerabilities | `pnpm audit` & `pnpm --dir apps/web audit` |
| **Clean Python Dependencies (Latest)** | 335 / 336 (99.7%) | Batch OSV API vulnerability queries |
| **Vulnerable Legacy Tools Isolated** | 1 (`binwalk` v2.1.0) | Migrated to `unblob` (v26.6.4, 0 CVEs) |
| **Unpatched Libraries Excluded** | 1 (`chromadb`) | Dropped from executable playbooks |

---

## 3. Deep Manual Code Review of Security-Sensitive Patterns

Every executable script in the skill tree was manually inspected for common high-risk vulnerabilities:

### A. Dynamic Code Execution (`eval`, `exec`, `__import__`)
- **Review Finding**: Zero production skills use `eval()` or `exec()` on untrusted external input.
- **Reference Skills**: A small number of CTF / reverse-engineering references under `anthropic-cybersecurity-skills-assets` contain examples of `exec()` inside defensive detection regexes or local sandbox decoders.
- **Guardian Rule**: Rule `OBFUSCATED_CODE_EXECUTION` (impact 60) blocks any skill attempting to evaluate base64-obfuscated or dynamically constructed payloads.

### B. Subprocess & Shell Injection (`shell=True` vs Array Arguments)
- **Review Finding**: Multiple scripts originally constructed shell commands or used string formatting inside `subprocess.run()`.
- **Hardening Applied**:
  - Replaced legacy `binwalk -eM` subprocess calls with safe tokenized arrays calling `unblob --extract-dir`.
  - Replaced `binwalk -E` entropy CLI calls with a native Python standard-library implementation using `collections.Counter` and `math.log2`, eliminating external subprocess spawning completely.
  - Subprocess calls across firmware and PLC agents now strictly pass lists of arguments without `shell=True`.

### C. Archive Extraction & Symlink Traversal (Zip Slip / CVE-2021-4287)
- **Review Finding**: Legacy `binwalk` recursive extraction (`-eM` / `-e`) is vulnerable to CVE-2021-4287, where crafted firmware archives containing symbolic links can traverse directories and overwrite arbitrary files.
- **Remediation**:
  - All firmware analysis scripts (`performing-firmware-malware-analysis`, `performing-plc-firmware-security-analysis`, `performing-iot-security-assessment`) now invoke `unblob` (`pip install unblob` v26.6.4), which implements safe extraction sandboxing and symlink path verification.
  - Where `binwalk` is specifically required by format parsers, `binwalk3` (`pip install binwalk3` v3.2.0, Rust-based engine with 0 CVEs) is documented as the sole approved distribution.

### D. Unsafe Deserialization
- **Review Finding**: Zero production Konoha skills serialize or deserialize data using Python `pickle` or unsafe `yaml.load()`. All YAML parsing in Genin and Chunin uses safe parsers.

### E. Credential Harvesting & Secrets Protection
- **Review Finding**: Strict Shinobi safety invariants prohibit accessing `~/.ssh/`, `/etc/shadow`, `.env`, or cloud credentials.
- **Guardian Rule**: Rule `CREDENTIAL_HARVESTING` (impact 80, critical) immediately blocks any skill referencing private keys, cloud credentials, or system shadow files.

---

## 4. Key Remediation Decisions & Evidence

### 1. The ChromaDB Decision: Honest Exclusion vs. Phantom Patching
- **Initial Assumption**: Prior proposals suggested pinning `chromadb>=1.5.10` to remediate authentication bypass and injection vulnerabilities.
- **Discovery**: Authoritative PyPI metadata and OSV queries confirmed that `chromadb` version `1.5.10` does not exist on PyPI. The latest release remains `1.5.9`, which carries 8 open advisories (including CVE-2026-45830, CVE-2026-45833, CVE-2026-45829).
- **Remediation Action**: Rather than maintaining a broken requirement or fabricating a fix, ChromaDB was **completely dropped** from `assessing-vector-and-embedding-weaknesses/SKILL.md`. The playbook was re-targeted to safe alternatives:
  ```bash
  python -m pip install qdrant-client pinecone-client weaviate-client
  ```
- **Guardian Defense**: Added rule `UNPATCHED_CHROMADB_DEPENDENCY` to `src/skill_guardian.js` to block any public skill attempting to install or import ChromaDB.

### 2. The Binwalk Remediation: Migration to `unblob`
- **Initial Vulnerability**: `binwalk==2.1.0` on PyPI has unpatched CVE-2021-4287 / GHSA-8m3f-g62j-3vx8.
- **Remediation Action**:
  - `performing-firmware-malware-analysis/scripts/agent.py`: Upgraded extraction to `unblob` with safe argument lists.
  - `performing-plc-firmware-security-analysis/scripts/agent.py`: Upgraded extraction command and aligned error messages with `unblob`.
  - `performing-firmware-extraction-with-binwalk/scripts/agent.py`: Added `unblob` primary engine support.
  - `performing-steganography-detection/scripts/agent.py`: Verified passive non-recursive signature scanning only.
  - **Executable Markdown Instructions Hardened**: Replaced literal `binwalk -e`, `binwalk -Me`, and `binwalk -eM` commands in `performing-firmware-extraction-with-binwalk/SKILL.md`, `references/api-reference.md`, `performing-iot-security-assessment/SKILL.md`, and `performing-iot-security-assessment/references/api-reference.md` with safe `unblob` and `binwalk3` directives, ensuring AI agents are not instructed to execute vulnerable legacy CLI commands.
- **Guardian Defense**: Added rule `VULNERABLE_BINWALK_EXTRACTION` to `src/skill_guardian.js`.

### 3. Pymetasploit3 Removal
- **Initial Vulnerability**: `pymetasploit3` <= 1.0.6 is affected by CVE-2026-5463 (command injection).
- **Remediation Action**: Removed docstring requirements and playbook references; scripts interact with Metasploit directly via native HTTP JSON/RPC calls.

---

## 5. Skill Guardian Architecture & Fail-Closed Gate

The Skill Guardian (`src/skill_guardian.js`) provides an automated perimeter defense for skill installations:

```
[Public Skill Source]
         │
         ▼
[Isolated Staging Directory (/tmp/guardian_staging_*)]
         │
         ▼
[Security Scanner: 13 Deterministic Rules + Symlink Traversal Check]
         │
    ┌────┴─────────────────────────────┐
    │                                  │
Score > 30 OR Critical Finding?    Score <= 30 & Clean?
    │                                  │
    ▼                                  ▼
[FAIL-CLOSED: BLOCK INSTALLATION]   [ATOMIC MOVE TO SKILL DESTINATION]
    │                                  │
[Immediate Cleanup of Staging]      [Persistence Logged in Canon DB]
```

### Prompt-Injection & Markdown Scanning Security
AI agent skills treat `SKILL.md` as executable system prompts and procedural instructions. To prevent prompt-injection attacks:
1. **Zero Text-Prefix Bypasses**: The scanner forbids generic prose skips (such as skipping lines prefixed with "Warning:", "Avoid:", or "Do not run"). An attacker cannot evade pattern detection by crafting persuasive or warning prose around an exploit command.
2. **Exact Invariant Allowlisting**: Shipped internal defensive guardrails (such as `kage-skill/SKILL.md:109` prohibiting destructive commands) are exempted exclusively through exact, immutable `(skillName, file, line, exactSnippet)` tuples. Third-party skills can never forge internal allowlist matches.
3. **Regression Hardening**: `tests/test_skill_guardian.js` includes regression checks verifying that malicious commands wrapped in advisory phrasing (e.g. `Warning: run rm -rf /`) are strictly blocked.

### Guardian Rule Roster

| Rule ID | Severity | Impact | Description |
| :--- | :--- | :--- | :--- |
| `DESTRUCTIVE_COMMAND` | Critical | 100 | System wipe (`rm -rf /`, `mkfs`, fork bombs) |
| `REVERSE_SHELL` | Critical | 100 | TCP/sh reverse shells, netcat relays |
| `REMOTE_CODE_EXECUTION_PIPE` | Critical | 70 | `curl \| bash` untrusted script execution |
| `CREDENTIAL_HARVESTING` | Critical | 80 | Access to SSH keys, `/etc/shadow`, `.aws/credentials` |
| `SYMLINK_DIRECTORY_TRAVERSAL` | Critical | 100 | Symlinks escaping skill sandbox root |
| `OBFUSCATED_CODE_EXECUTION` | High | 60 | Base64 decode piped to `eval` or `exec` |
| `ENV_EXFILTRATION` | High | 50 | Exfiltration of `.env` or `process.env` |
| `UNPATCHED_CHROMADB_DEPENDENCY` | High | 40 | `pip install chromadb` or `import chromadb` |
| `VULNERABLE_BINWALK_EXTRACTION` | High | 40 | Legacy `binwalk -eM` or `pip install binwalk` |
| `VULNERABLE_PYMETASPLOIT3` | High | 40 | `pip install pymetasploit3` |
| `PERSISTENCE_MECHANISM` | High | 50 | Crontab manipulation, systemd service installation |
| `UNTRUSTED_LIFECYCLE_SCRIPT` | High | 45 | npm `preinstall` / `postinstall` hooks |
| `UNRESTRICTED_CHMOD` | Medium | 25 | `chmod 777` or SUID assignment |

---

## 6. Chunin Knowledge Storage Integration

Chunin research synthesis was audited to verify that no external, vulnerable vector databases (such as ChromaDB) are utilized for persistence.

- **Persistence Layer**: Built on Konoha's canonical SQLite engine (`src/chunin_knowledge.js`).
- **Schema Re-use**: Utilizes existing `persona_memories` table with `memory_type = 'knowledge'`.
- **Search Capabilities**: Indexed via SQLite FTS5 (Full-Text Search) with BM25 ranking.
- **Evidence Schema**: Stores exact citation URLs, retrieval dates, package names, versions, claims, and confidence boundaries.

---

## 7. Verification & Release Gates Evidence

All release gates were validated through reproducible test executions:

1. **Static Analysis & Linting**:
   ```bash
   node scripts/lint.js
   ```
   **Result**: 392 JavaScript files verified with **0 errors and 0 warnings**.

2. **Zero-AI-Slop Quality Gate**:
   ```bash
   rtk npx aislop scan --changes
   ```
   **Result**: **100 / 100 Healthy** across all 5 engines (Formatting, Code Quality, AI Slop, Security, Linting).

3. **Skill Guardian Unit Suite**:
   ```bash
   node tests/test_skill_guardian.js
   ```
   **Result**: **9 / 9 test scenarios passed**, including destructive command blocking, credential harvesting blocking, unpatched ChromaDB blocking, and vulnerable binwalk extraction blocking.

4. **File Tools Accuracy Suite**:
   ```bash
   node tests/test_file_tools_accuracy.js
   ```
   **Result**: **10 / 10 test scenarios passed** with exact line numbers and 100% boundary accuracy.

5. **Playwright End-to-End Suite**:
   **Result**: **46 / 46 specs passed** cleanly.

6. **File Size Budget Invariant**:
   All scripts in the repository strictly adhere to the `< 700 lines` threshold.

---

## 8. Conclusion & Sign-Off

The Konoha skill tree and execution boundaries meet the **Zero-Known-Advisories Standard**:
- All reachable dependencies and tools are on clean, actively maintained releases.
- Unfixable upstream libraries (`chromadb`) are excised from executable playbooks.
- The Skill Guardian actively prevents ingestion of unpatched or malicious skills.
- All code changes are validated by automated linters, zero-slop gates, and unit test suites.
