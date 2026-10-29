# Konoha diagrams

`konoha-architecture.drawio` is the canonical editable source for the repository architecture diagrams. It contains sixteen pages covering every logical diagram embedded in the README and documentation. Each owner also keeps a synchronized Mermaid companion for native Markdown rendering and text review.

**Format policy:** Draw.io owns editable geometry, page layout, and presentation routing. Mermaid owns Markdown-native rendering. The two formats must keep the same semantic nodes, relationships, titles, and implementation anchors; their visual layouts may differ.

**Synchronization checklist:**

- Page title and scope match.
- Current component and client names match implementation.
- Directional relationships and important labels match.
- Canonical `genin-skill` naming is used; `deep-code-explorer` is never a current diagram node.
- Draw.io ports/waypoints and Mermaid layout both keep dense flows readable.
- Bridge ownership is explicit: embedded Konoha aggregate gateway `127.0.0.1:19999` for local model multiplexing.


| Page | Scope | Markdown owner | Implementation anchors |
|---|---|---|---|
| 01 System Architecture | Multi-client support (Antigravity CLI/IDE, Cursor, Claude Code, OpenCode, Command Code, Codex, Pi, OMP), orchestration, MCP (konoha, semble, aislop), persistence, workspace | `docs/ARCHITECTURE.md` | `src/server.js`, `src/db.js`, `src/vector_search.js`, `src/agent_manager.js`, `bin/cli.js` |
| 02 Runtime Query Lifecycle | Prompt, skill retrieval, code search, delegation, synthesis | `docs/ARCHITECTURE.md` | `src/server.js`, `src/prompt_hook.js` |
| 03 MCP Tool and Skill Routing | `sannin` routing to 47 canonical tools (47 manifest-backed) and ninja agents (genin, jonin, anbu, tokubetsu-jonin, chunin embed `references/i-have-adhd.md`; sannin, kage, and akatsuki do not; kage embeds `references/antislop*`); includes 5 Document Engineering tools (`document_create`, `spreadsheet_create`, `presentation_create`, `diagram_create`, `animation_export` with canonical Animated WebP), `website_ai_detector` (AI-fingerprint scan, 0-20 = Human-Built, CLI `konoha detect-ai`) and `docs_ai_detector` (Document AI & 0%–1% ZeroGPT target defense, Web UI text paste mode, CLI `konoha detect-docs`, `POST /api/v1/detect-docs/text`) | `docs/ARCHITECTURE.md` | `src/server.js`, `src/templates/agents.yaml`, `.agents/skills/*/references/i-have-adhd.md`, `src/workflow/tokubetsu-scribe/document_engine.js`, `src/workflow/jonin-builder/ai_detector.js`, `src/workflow/kage-reviewer/docs_ai_detector.js`, `src/mcp/ai_detector.js` |
| 04 LLM Bridge Gateway | Bridge selection, provider boundaries, sidecar protocol retries, and cross-platform port termination (:19999) | `docs/LLM-BRIDGE-GATEWAY.md` | `src/bridge/gateway.js`, `src/bridge/sidecar/`, `src/platform_utils.js:killProcessOnPort` |
| 05 Search Fallback Chain | SearXNG, DuckDuckGo, Startpage, Wikipedia fallback | `docs/SETUP-SEARXNG.md` | `src/server.js:web_search` |
| 06 Skill Registry Installation | Template/package sync, skills.sh registry proxy, Web UI 1-click install, multi-directory migration, SQLite FTS5 & IBM Granite 384d vector retrieval + MS MARCO MiniLM neural cross-encoder reranker for RAG with adaptive CPU duty-cycle throttling (<50% duty, zero 100% spikes) | `docs/ADDING-SKILLS.md` | `src/migrate.js`, `src/db.js`, `src/vector_search.js`, `bin/cli.js`, `src/skill_manager.js`, `src/web_server.js` |
| 07 Token Footprint Comparison | Folder loading versus bounded FTS5 retrieval, dynamic baseline telemetry, and transcript caching | `README.md` | `src/server.js`, `src/migrate.js`, `src/db_savings.js`, `src/tools_savings_logger.js` |
| 08 Orchestrator Task Artifact Flow | Dispatch-scoped structured tool call delegation (task, context, constraints, skills), task evidence, and Kage review | `README.md` | `src/server.js`, `src/agent_manager.js` |
| 09 Jonin Taste-Skill Frontend Engine | Anti-slop standards, Taste Dials, multi-framework targets (Next.js, SvelteKit, Nuxt, Angular) | `docs/ARCHITECTURE.md` | `src/server.js:build_from_source`, `src/server.js:build_from_text` |
| 10 Persistent Project Context & Auto-Compaction | Stack detection, project invariants, unified deterministic token-bounded prompts (< 8 KB, 100% prefix cacheability), on-demand skills via `konoha.get_skill` | `docs/ARCHITECTURE.md` | `src/persona_memory.js`, `src/mcp/memory_reporting.js`, `src/server.js` |
| 11 Kage Pre-Delivery Reviewer Workflow Gate | 8-phase orchestration state machine, Two-Stage HITL Gates (Gate 1: Plan Approval `pending_plan_approval`, Gate 2: Delivery Sign-Off `pending_human_signoff`), Native SDLC Governance (Definition-of-Readiness DoR pre-dispatch gate, cross-provider second opinion, SDLC task status block gate), Zero-AI-Slop Pre-Gate with `CircuitBreaker` fail-safe degrade (threshold=2, recovery=120s, SIGTERM) and dynamic mtime cache invalidation, Autonomous Kage → Anbu Remediation Loop, 98% Minimum Confidence Gate (≥ 98%), 100% task execution verification, clean evidence validation, security & CVE audit | `docs/ARCHITECTURE.md`, `docs/ALL-WORKFLOW-DIAGRAMS.md` | `src/mcp/workflow.js`, `src/workflow/kage-reviewer/sdlc_manager.js`, `src/circuit_breaker.js`, `tests/test_anti_slop_gate.js` |
| 12 CLI Upgrade & Progress Engine | 7-stage interactive upgrade pipeline, KonohaProgressBar with live pulse timers, animated braille spinner (startSpinner, TTY-only), non-destructive user skill & config preservation (zero pruning of pre-existing skills, additive-only sync, managed boundary injection, custom agent union-merge), in-process runtime sync, cross-client MCP auto-registration | `docs/ARCHITECTURE.md` | `bin/cli.js:cmdUpgrade`, `bin/cli.js:KonohaProgressBar`, `bin/cli.js:cmdInit`, `src/deploy_utils.js` |
| 13 QA Automation Workflow | Bounded token-preserving pipeline, `agent-browser` scoped exploration, flow declaration (`tests/e2e/flows/*.json`), deterministic `qa_codify`, `qa_e2e_run` RED/GREEN loop, remediation fix branches (Anbu backend / Jonin UI), Zero-AI-Slop gate, Anbu QA evidence (`run_id`), Kage review gate | `docs/QA-AUTOMATION.md` | `src/workflow/qa-automation/qa_tools.js`, `src/file_tools_router.js`, `docs/QA-AUTOMATION.md`, `tests/e2e/` |
| 14 Remote Access & Telegram Inbound/Outbound | Zero-emoji task reporting, whitelisted long polling daemon (`/run`, `/status`, `/savings`, `/kage`), chat ID gating, dynamic OMP session detection, outbound webhook engine (`src/webhook_manager.js`) | `docs/TELEGRAM_INTEGRATION_GUIDE.md`, `docs/ALL-WORKFLOW-DIAGRAMS.md` | `src/telegram/notifier.js`, `src/telegram/poller.js`, `src/webhook_manager.js`, `bin/cli.js:cmdTelegram`, `bin/commands/webhook.js` |
| 15 Inbound Prompt Queue & Worker Pipeline | Argon2id encrypted password login with timing-safe verification, protected password reset with session invalidation, SQLite prompt queue & atomic inbox mirror, SvelteKit Remote Access dashboard | `docs/TELEGRAM_INTEGRATION_GUIDE.md`, `docs/ALL-WORKFLOW-DIAGRAMS.md` | `src/auth.js`, `src/queue/inbox.js`, `src/queue/worker.js`, `apps/web/src/components/RemoteAccess.svelte` |
| 16 Akatsuki Security Controls & Dual-Mode Lab Lifecycle | Dual-mode security engine (Blue defensive SAST / Red unprivileged sandbox with written RoE), unprivileged Docker/LXC lab container lifecycle, offensive tool execution (nmap, tshark, metasploit, zap, nuclei, ffuf, sqlmap, testssl, trivy, curl_probe), non-Akatsuki agent fail-closed persona firewall, Phase 8 security review gate | `docs/ALL-WORKFLOW-DIAGRAMS.md` | `src/workflow/akatsuki/config.js`, `src/workflow/akatsuki/lab.js`, `bin/commands/akatsuki.js`, `src/tools/akatsuki_tools.js` |

## Enterprise Cloud Architecture Diagrams (Official AWS / GCP / Azure Style)

> **Architectural Invariant:** Konoha is a 100% local, self-contained MCP orchestrator running on Node.js and local SQLite with zero AWS cloud dependencies. The enterprise edition diagram (`konoha-enterprise-architecture.drawio`) uses standard AWS/GCP stencils strictly as conceptual visual analogies for enterprise architecture reviews (e.g., representing local queue workers or SQLite tables with standard enterprise iconography), not as deployed cloud infrastructure.

In addition to `konoha-architecture.drawio`, `konoha-enterprise-architecture.drawio` provides a dedicated 16-page professional cloud architecture edition modeled in official industry cloud architecture styling (AWS 2024 / GCP / Azure official stencils and group containers). Every page mirrors the 16 canonical pages with zero generic boxes, using official cloud palettes, VPC and Security Group containers, and crisp orthogonal connectors:

| Page | Scope | Cloud Architecture Stencils | Systems Covered |
|---|---|---|---|
| 01 System Architecture | Multi-tier cloud topology across developer workstations, MCP API gateway, agent compute grid, DoR & Zero-AI-Slop security gates, and storage cluster | AWS Cloud, VPC, Corporate Data Center, API Gateway, Lambda, Database, S3 | Full Konoha Architecture |
| 02 Runtime Query Lifecycle | End-to-end prompt resolution, skill search, Semble indexing, agent dispatch, and final synthesis | AWS Workspaces, API Gateway, Step Functions, OpenSearch, S3 | Query Lifecycle |
| 03 MCP Tool and Skill Routing | Sannin MCP router, tool dispatch, Taste Dials, and specialized ninja agent execution | AWS API Gateway, Lambda Functions, EventBridge, CloudWatch | Tool & Skill Routing |
| 04 LLM Bridge Gateway | Local LLM bridge proxy, port 1313 and 19999 endpoints, provider failover, and health state store | AWS Transit Gateway, VPC Router, ElastiCache, Aurora DB | Bridge Gateway |
| 05 Search Fallback Chain | Multi-engine SearXNG ingress, DuckDuckGo, Startpage, and Wikipedia fallback chain | AWS API Gateway, Route 53, CloudFront, Lambda | Search Engine |
| 06 Skill Registry Installation | Registry proxy, CLI installer, migration engine, and SQLite FTS5 vector store | AWS CodeArtifact, S3, ECS, OpenSearch | Skill Registry |
| 07 Token Footprint Comparison | Raw context vs bounded MCP retrieval comparative telemetry | AWS Cost Explorer, CloudWatch Metrics, S3 | Token Telemetry |
| 08 Orchestrator Task Artifact Flow | Structured delegation, isolated task dirs, Kage confidence gate, and synthesis | AWS Step Functions, EventBridge, EFS, S3 | Task Artifact Flow |
| 09 Jonin Taste-Skill Frontend Engine | Taste Dials, anti-slop rules, and 4-framework builders (Next.js, SvelteKit, Nuxt, Angular) | AWS Amplify, Lambda, CloudFront, S3 | UI Builder Engine |
| 10 Persistent Project Context & Unified Token-Bounded Prompts | Tech stack detection, project invariants, and single deterministic token-bounded prompt architecture (< 8 KB) | AWS DynamoDB, Systems Manager Parameter Store, S3 | Context Memory Bank |
| 11 Kage Pre-Delivery Reviewer Workflow Gate | 8-phase SDLC state machine, DoR gate, Zero-AI-Slop gate, and 98% confidence firewall | AWS Shield, WAF, Audit Manager, Security Hub | SDLC Governance Gate |
| 12 CLI Upgrade & Progress Engine | 7-stage interactive upgrade pipeline, pulse timers, and atomic client sync | AWS Systems Manager, CodeDeploy, CloudWatch | CLI Upgrade Pipeline |
| 13 QA Automation Workflow | Bounded token QA pipeline, agent-browser explorer, Playwright codifier, and RED/GREEN loop | AWS Systems Manager, Device Farm, Lambda, S3 | QA Automation Pipeline |
| 14 Remote Access & Telegram Inbound/Outbound | Zero-emoji task reporting, whitelisted long polling, bi-directional command ingress, and session switcher | AWS API Gateway, SQS, SNS, Lambda, DynamoDB | Telegram Remote Ingress |
| 15 Inbound Prompt Queue & Worker Pipeline | Argon2id authenticated session validation, SQLite prompt queue, and atomic inbox mirror | AWS API Gateway, SQS, DynamoDB, ECS Worker | Prompt Queue & Worker Pipeline |
| 16 Akatsuki Security Controls & Dual-Mode Lab Lifecycle | Dual-mode security architecture, unprivileged sandbox provisioning, network isolation, and persona authorization firewall | AWS Security Hub, Inspector, GuardDuty, ECS Unprivileged Fargate, IAM Policies | Akatsuki Security Controls |

## Source policy

- Edit the `.drawio` source, not a duplicated diagram definition in Markdown.
- Markdown pages link to the relevant page and source file for navigation.
- The diagram uses Draw.io-native XML with explicit page names, cell IDs, and labeled orthogonal edges.
- Runtime terminology is verified against the implementation before diagram changes are accepted.

## Export

The Draw.io desktop CLI is optional during repository maintenance. When available, export a clean preview and editable deliverables from the repository root:

```bash
drawio -x -f png --width 2000 -o docs/diagrams/konoha-architecture.png docs/diagrams/konoha-architecture.drawio
drawio -x -f svg -e -o docs/diagrams/konoha-architecture.svg docs/diagrams/konoha-architecture.drawio
drawio -x -f pdf -e -o docs/diagrams/konoha-architecture.pdf docs/diagrams/konoha-architecture.drawio
```

If the binary is named `draw.io`, substitute that name. Do not commit generated exports unless they are intentionally reviewed; the editable `.drawio` file remains canonical.

Validate the source with the bundled structural checker:

```bash
python3 .agents/skills/kage-skill/references/drawio-skill-assets/scripts/validate.py docs/diagrams/konoha-architecture.drawio --score
```
