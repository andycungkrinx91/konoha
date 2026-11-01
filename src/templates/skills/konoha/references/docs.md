# 🍃 Konoha Documentation Maintenance Standard (v2.2.17)

Guidelines and requirements for authoring, updating, and synchronizing Konoha documentation, compliance records, and visual assets.

---

## 📁 Documentation Architecture & Directory Structure

Konoha maintains a strictly organized, single-source documentation hierarchy:
- `README.md`: Public entry point, ASCII splash, quick start, 47 canonical MCP tools table, LangGraph architecture, and compliance badges.
- `CHANGELOG.md`: Authoritative chronological release notes following Keep a Changelog format.
- `docs/ARCHITECTURE.md`: Technical architecture specification, LangGraph StateGraph engine, MCP transports, and data flows.
- `docs/ALL-WORKFLOW-DIAGRAMS.md`: Comprehensive Mermaid diagram catalog of all 16 system workflows.
- `docs/QA-TEST-CHECKLIST.md`: Full QA testing matrices, manual verification procedures, and release verification checklists.
- `docs/SecurityCompliance/`: Versioned Google Policy & security compliance audit reports (`security_compliance_report_google_policy_<version>_<date>.md`).
- `docs/architecture/`: Canonical specifications (`CANONICAL-API.md`, `CANONICAL-CLI.md`, `CAPABILITY-MAP.md`).
- `docs/diagrams/`: Draw.io XML source files (`konoha-architecture.drawio`, `konoha-enterprise-architecture.drawio`).
- `assets/`: 18 production animated WebP diagrams and demo walkthroughs (zero legacy `.gif` files).

---

## 📝 Tone, Anti-Slop & Zero-AI Fingerprint Standard

All documentation authored or updated by Konoha subagents (especially `@tokubetsu-jonin`) must strictly adhere to the Reader-First Craftsmanship standards:
1. **Zero Conversational Filler**: Never use conversational padding, artificial hesitation, or pleasantries (`"hmmmm"`, `"let me"`, `"wait - but"`, `"sure!", "I'd be happy to"`).
2. **High Perplexity & Natural Burstiness**: Vary sentence length dynamically. Use active verbs, direct declarative statements, and concrete numbers over vague generalities.
3. **No Decorative Emojis in Technical Contracts**: Keep technical identifiers, commands, URLs, and code blocks strictly verbatim and exact.
4. **Strict < 3.0% AI Detection Threshold**: Shipped engineering whitepapers, compliance audits, and architectural reports must score below 3.0% on AI content detection models.

---

## 🛡️ Security Compliance Reports Forward-Porting Rule

When creating a new compliance report for a version bump (e.g. `docs/SecurityCompliance/security_compliance_report_google_policy_2.2.17_2026-11-01.md`), **NEVER drop cumulative compliance guarantees** from prior releases:
- **Subagent Parity & Role Boundaries (§2.1)**: Manifest-driven official subagent tool parity via `src/mcp/memory_subagent_runner.js`. Role isolation prevents read-only agents from mutating files.
- **Upstream Skill Pins (§2.2)**: Strict Git commit SHA pinning for vendored skills (`taste-skill@12af471`, `anti-slop@3005235`).
- **PowerShell Script Eradication (§2.5)**: Strictly zero `.ps1` files exist anywhere in the working tree. Remote MSI downloaders are eliminated.
- **Windows 11 DEP0190 Child Process Hardening (§5.1)**: `windowsHide: true`, no shell wrappers on PE binaries, whitespace-safe argument quoting (`quotePath()`).
- **Node.js ≥ 24.0.0 Support Invariants (§5.2)**: Built-in `node:sqlite` driver, native crypto, and zero deprecated C++ native addons.
- **ADHD Cognitive Output Wiring (§5.3)**: Always-on behavioral shaping across all 6 execution specialists (action-first, numbered steps, max 5 items per list).
- **SQLite Provenance (§5.4)**: Centralized database provenance (`source=sqlite_fts5`) for skills and persona memories.
- **Socket & Audit Posture (§6)**: Zero production CVEs, zero high/critical alerts in Socket CI.
- **Default Authentication**: Default password invariant `konohagakure` preserved.

---

## 🔄 Release Pointer Synchronization Matrix

Whenever Konoha bumps versions, update active pointers while preserving historical records:
1. **README.md**:
   - Update version badges (lines 22, 25, 63, 1071) to link directly to the new `security_compliance_report_google_policy_<version>_<date>.md`.
2. **Integration Guides & Specs**:
   - `docs/TELEGRAM_INTEGRATION_GUIDE.md`: Bump header and runtime version tag.
   - `docs/architecture/CANONICAL-CLI.md`: Bump header version tag.
   - `docs/LLM-BRIDGE-GATEWAY.md`: Bump header version tag.
3. **QA Checklist**:
   - `docs/QA-TEST-CHECKLIST.md`: Bump `konoha version` row (line 18) to the new version.
   - **PRESERVE HISTORICAL SECTION NUMBERS**: Sections covering past release audits (e.g. Sections 26–28 for v2.2.14/v2.2.15) must keep their original historical numbers and titles.
4. **Verification**:
   - Always run `rtk node tests/test_docs_currency.js` and `rtk node tests/test_version_consistency.js` to ensure 100% synchronization across all 19 managed targets.

---

## 🎨 Visual Assets & Animated WebP Standards

- **Pure Light Mode Standard**: All flow diagrams in `assets/*.webp` follow pure light mode styling with high-contrast neutral backgrounds (`#FFFFFF` / `#F8FAFC`).
- **Animation Format**: Rendered via Playwright Chromium (`/usr/bin/google-chrome`) with `deviceScaleFactor: 2` (HiDPI / Retina $2400 \times 1350$ or $2400 \times 1520$), compiled with FFmpeg `libwebp_anim` at `-q:v 90`, 24 frames @ 12 fps.
- **Zero Legacy GIFs**: Strictly 0 `.gif` files in `assets/`. Active markdown documents must embed only `.webp` animations. Verify with `rtk node tests/test_all_assets_webp.js`.
