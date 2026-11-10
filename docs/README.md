# Konoha Documentation Index

Single entry point for every live document. One topic, one source of truth. `docs/archive/` holds frozen dated snapshots and is never authoritative — see [archive/README.md](archive/README.md).

## Architecture

| Topic key | Document | Answers |
|---|---|---|
| `architecture/system` | [ARCHITECTURE.md](ARCHITECTURE.md) | How the orchestrator, archetypes, routing, and tool surface fit together |
| `architecture/canonical-api` | [architecture/CANONICAL-API.md](architecture/CANONICAL-API.md) | Authoritative exported API and MCP tool signatures |
| `architecture/canonical-cli` | [architecture/CANONICAL-CLI.md](architecture/CANONICAL-CLI.md) | Authoritative CLI command tree and flags |
| `architecture/canonical-naming` | [architecture/CANONICAL-NAMING.md](architecture/CANONICAL-NAMING.md) | Approved identifiers; blocks synonyms in code review |
| `architecture/capabilities` | [architecture/CAPABILITY-MAP.md](architecture/CAPABILITY-MAP.md) | Capability to file to tool mapping for v2.2.20 |
| `architecture/gaps` | [architecture/ARCHITECTURAL-GAPS.md](architecture/ARCHITECTURAL-GAPS.md) | Open architectural gaps and their remediation order |
| `architecture/token-baseline` | [architecture/TOKEN-BASELINE.md](architecture/TOKEN-BASELINE.md) | Measured token footprints; Section 11.4 is the evidence for the 83–98% context-saving claim |
| `workflows/diagrams` | [ALL-WORKFLOW-DIAGRAMS.md](ALL-WORKFLOW-DIAGRAMS.md) | End-to-end Mermaid flows for every workflow |

## Security

| Topic key | Document | Answers |
|---|---|---|
| `security/architecture` | [SECURITY.md](SECURITY.md) | v2.2.20 ingress, auth, Telegram, and queue controls |
| `security/database-isolation` | [security/DATABASE-ISOLATION-INVENTORY.md](security/DATABASE-ISOLATION-INVENTORY.md) | Which database every lab and skill may touch |
| `security/kali-tools-provenance` | [security/DB-KALI-TOOLS-PROVENANCE.md](security/DB-KALI-TOOLS-PROVENANCE.md) | Provenance and disposition of every `kali_tools` row |
| `security/red-skill-inventory` | [security/RED-SKILL-INVENTORY.md](security/RED-SKILL-INVENTORY.md) | Opt-in red pack contents and authorization model |
| `security/skill-authz` | [security/SKILL-AUTHZ-AND-LAB-DB-ISOLATION-2026-11-09.md](security/SKILL-AUTHZ-AND-LAB-DB-ISOLATION-2026-11-09.md) | Skill authorization rules and lab DB isolation as enforced |
| `security/schema-audit` | [security/DATABASE-SCHEMA-AUDIT-2026-11-09.md](security/DATABASE-SCHEMA-AUDIT-2026-11-09.md) | Live-vs-source schema consistency evidence for 2.2.20 |
| `compliance/current` | [SecurityCompliance/security_compliance_report_2.2.19_2026-11-09.md](SecurityCompliance/security_compliance_report_2.2.19_2026-11-09.md) | Newest external compliance audit; older audits are in the archive |

## Setup per client

Per-client pages stay separate on purpose — different binaries, paths, and tool sets.

| Topic key | Document | Answers |
|---|---|---|
| `setup/clients-matrix` | [SETUP-MCP-CLIENTS.md](SETUP-MCP-CLIENTS.md) | Auto-detect, RTK deployment, and per-client config paths |
| `setup/antigravity-ide` | [SETUP-IDE.md](SETUP-IDE.md) | Antigravity IDE install and workspace rules |
| `setup/antigravity-cli` | [SETUP-CLI.md](SETUP-CLI.md) | Antigravity CLI (`agy`) plus cross-platform install |
| `setup/cursor` | [SETUP-CURSOR.md](SETUP-CURSOR.md) | Cursor IDE and Cursor CLI |
| `setup/web-ui` | [SETUP-WEB-UI.md](SETUP-WEB-UI.md) | Local web console on `127.0.0.1:1404` |
| `setup/searxng` | [SETUP-SEARXNG.md](SETUP-SEARXNG.md) | Zero-key search chain and fallback order |
| `deploy/vps` | [VPS-INSTALL.md](VPS-INSTALL.md) | Headless VPS install and service wiring |

## Data, integrations, quality, operations

| Topic key | Document | Answers |
|---|---|---|
| `data/erd` | [DATABASE-ERD.md](DATABASE-ERD.md) | Tables, relations, and lifecycle rules |
| `integration/telegram` | [TELEGRAM_INTEGRATION_GUIDE.md](TELEGRAM_INTEGRATION_GUIDE.md) | Dual-mode bot setup and inbound prompting |
| `integration/llm-bridge` | [LLM-BRIDGE-GATEWAY.md](LLM-BRIDGE-GATEWAY.md) | Multi-provider proxy router on port 19999 |
| `skills/authoring` | [ADDING-SKILLS.md](ADDING-SKILLS.md) | Importing skills from skills.sh |
| `qa/harness` | [QA-AUTOMATION.md](QA-AUTOMATION.md) | Token-efficient QA workflow and agent-browser usage |
| `qa/test-matrix` | [QA-TEST-CHECKLIST.md](QA-TEST-CHECKLIST.md) | Verification checklist per subsystem |
| `metrics/benchmark` | [BENCHMARK.md](BENCHMARK.md) | Generated token-savings report; edit only via `scripts/generate_benchmark.js` |
| `ops/troubleshooting` | [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Symptom to cause to fix |
| `manual/operators` | [MANUAL.md](MANUAL.md) and [MANUAL.pdf](MANUAL.pdf) | The whole product for 2.2.20 in reading order: install, first run, CLI, TUI, Web UI, Telegram, harnesses, architecture, agents, token economy, diagnostics, troubleshooting, security, appendix |

## Assets

| Topic key | File | Answers |
|---|---|---|
| `diagrams/editable` | [diagrams/README.md](diagrams/README.md) | Which drawio file to open and how sync is validated |
| `diagrams/architecture` | [diagrams/konoha-architecture.drawio](diagrams/konoha-architecture.drawio) | Editable architecture source |
| `diagrams/infrastructure` | [diagrams/konoha-infrastructure-architecture.drawio](diagrams/konoha-infrastructure-architecture.drawio) | Editable infrastructure source |
| `templates/claude-code-mcp` | [templates/claude-code.mcp.yaml](templates/claude-code.mcp.yaml) | MCP server template installed into Claude Code projects |

## Conventions

- Live documents only. Dated audit reports, superseded guides, and completed reviews live in `docs/archive/`.
- 700-line ceiling per file. Recorded exceptions: `ALL-WORKFLOW-DIAGRAMS.md` (1417), `QA-TEST-CHECKLIST.md` (939), `ARCHITECTURE.md` (918), `TROUBLESHOOTING.md` (814), `MANUAL.md` (1655) — catalogs and checklists whose splitting would fragment embeds or break anchors, and a manual whose chapter order is the render order of the PDF.
- Every internal link resolves; `tests/test_docs_currency.js` walks `README.md` and `docs/**`, and `tests/test_docs_index.js` asserts this index matches the filesystem.
- `BENCHMARK.md` is generated. `node scripts/generate_benchmark.js --check` fails on manual edits.