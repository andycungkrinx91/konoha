# 🍃 Konoha Documentation Maintenance Standard (v2.2.18)

Guidelines and requirements for authoring, updating, and synchronizing Konoha `v2.2.18` documentation, compliance records, Draw.io diagrams, and visual assets.

---

## 📁 Documentation Architecture & Directory Structure

Konoha maintains a strictly organized, single-source documentation hierarchy:
- `README.md`: Executive entry point, quick start (`konoha init --client=<name>`), 9-agent roster (`@sannin` router + 8 specialists), 48 canonical MCP tools, LangGraph + Real-Time Idle `@advisor` + Git Worktree architecture, and compliance badges.
- `CHANGELOG.md`: Authoritative chronological release notes following Keep a Changelog format.
- `docs/ARCHITECTURE.md`: Technical architecture specification, LangGraph StateGraph engine, Real-Time Idle `@advisor` (`<= 1,000 tokens/turn`), Per-Agent Git Worktree isolation, MCP transports, and dynamic website builder specs.
- `docs/ALL-WORKFLOW-DIAGRAMS.md`: Comprehensive Mermaid diagram catalog of all system workflows.
- `docs/QA-TEST-CHECKLIST.md`: Full QA testing matrices, manual verification procedures, and release verification checklists.
- `docs/SecurityCompliance/`: Versioned Google Policy & security compliance audit reports (`security_compliance_report_google_policy_2.2.18_2026-11-04.md`).
- `docs/architecture/`: Canonical specifications (`CANONICAL-API.md`, `CANONICAL-CLI.md`, `CAPABILITY-MAP.md`).
- `docs/diagrams/`: Draw.io XML source files (`konoha-architecture.drawio`, `konoha-enterprise-architecture.drawio` — 18 pages each, 0 geometric collisions).
- `assets/`: 33 production animated WebP diagrams and demo walkthroughs (zero legacy `.gif` files).

---

## 📝 Tone, Anti-Slop & Zero-AI Fingerprint Standard

All documentation authored or updated by Konoha subagents (especially `@tokubetsu-jonin`) must strictly adhere to Reader-First Craftsmanship standards:
1. **Zero Conversational Filler**: Never use conversational padding, artificial hesitation, or pleasantries (`"hmmmm"`, `"let me"`, `"wait - but"`).
2. **High Perplexity & Natural Burstiness**: Vary sentence length dynamically. Use active verbs, direct declarative statements, and concrete numbers over vague generalities.
3. **No Legacy IPC References**: Active documentation must never instruct agents to use retired file-based IPC (`prompt.md`, `report.md`, `delegate.md`, `result.md`). All delegation uses structured MCP arguments and isolated `task_dir` state (`status.json`, `plan.md`, `walkthrough_todos.json`, `final_report.md`).
4. **Strict < 3.0% AI Detection Threshold**: Shipped engineering whitepapers, compliance audits, and architectural reports must score below 3.0% on `docs_ai_detector`.

---

## 🔄 Verification Commands

- Verify version synchronization across all 19 targets: `rtk node tests/test_version_consistency.js`
- Verify documentation symbol currency: `rtk node tests/test_docs_currency.js`
- Verify Draw.io zero collisions across all 18 pages: `rtk node tests/test_diagram_sync.js`
- Verify all 33 animated WebP assets and 27 markdown embeds: `rtk node tests/test_all_assets_webp.js`
