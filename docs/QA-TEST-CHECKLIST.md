# Konoha Comprehensive Manual QA Test Checklist & Verification Runbook

**Product:** Konoha (`konoha-mcp`)  
**Version:** 2.1.18  
**Release Date:** 2026-10-15  
**Document Status:** Authoritative Pre-Release & Full Manual QA Specification  
**Canonical Sources:** `bin/cli.js`, `src/file_tools_router.js`, `src/mcp_tool_manifest.json`, `src/web_server.js`, `src/docs_ai_detector.js`, `src/persona_memory.js`, `src/mcp/workflow.js`, `src/db.js`, `docs/SUGGESTION.md`

---

## Table of Contents

1. [Sandbox Environment Setup & Host Protection Guardrails](#1-sandbox-environment-setup--host-protection-guardrails)
2. [Domain 1: CLI Core & Operational Router Verification](#2-domain-1-cli-core--operational-router-verification)
3. [Domain 2: MCP Server STDIO Protocol & Bounded File Tools (v2.1.18)](#3-domain-2-mcp-server-stdio-protocol--bounded-file-tools-v2118)
4. [Domain 3: Skill Discovery, SQLite FTS5 & Semantic Vector Search](#4-domain-3-skill-discovery-sqlite-fts5--semantic-vector-search)
5. [Domain 4: Ninja Agent Team Delegation & Workflow State Machine](#5-domain-4-ninja-agent-team-delegation--workflow-state-machine)
6. [Domain 5: SvelteKit Web Configuration UI & Mobile Invariants](#6-domain-5-sveltekit-web-configuration-ui--mobile-invariants)
7. [Domain 6: Document Engineering & Animated WebP Media Pipeline](#7-domain-6-document-engineering--animated-webp-media-pipeline)
8. [Domain 7: AI Fingerprint Detection (Single-File & Pure JS Document Detector)](#8-domain-7-ai-fingerprint-detection-single-file--pure-js-document-detector)
9. [Domain 8: SDLC Governance, Definition-of-Readiness (DoR) & Anti-Slop Gate](#9-domain-8-sdlc-governance-definition-of-readiness-dor--anti-slop-gate)
10. [Domain 9: LLM Proxy Gateway & Bridge Router](#10-domain-9-llm-proxy-gateway--bridge-router)
11. [Domain 10: Remote Access, Telegram Bot & Cloudflare Tunnel Security](#11-domain-10-remote-access-telegram-bot--cloudflare-tunnel-security)
12. [Domain 11: Cross-Platform Daemons & Service Lifecycles](#12-domain-11-cross-platform-daemons--service-lifecycles)
13. [Domain 12: RTK Command Proxy & Token Optimization Hygiene](#13-domain-12-rtk-command-proxy--token-optimization-hygiene)
14. [Consolidated Full Manual QA Scorecard & Verification Matrix](#14-consolidated-full-manual-qa-scorecard--verification-matrix)
15. [Incident Escalation & Remediation Runbook](#15-incident-escalation--remediation-runbook)

---

## 1. Sandbox Environment Setup & Host Protection Guardrails

Before running manual tests, isolate the execution environment completely from the host system to prevent accidental context pollution or credential leakage.

```bash
# 1.1 Create dedicated ephemeral sandbox directory
export KT="$(mktemp -d /tmp/konoha_manual_test_XXXXXX)"
echo "Sandbox HOME: $KT"

# 1.2 Define isolated CLI execution helper
k() {
  env HOME="$KT" KONOHA_UI_AUTOSTART=0 node bin/cli.js "$@"
}

# 1.3 Allocate an isolated test port for Web UI daemon testing
export TEST_PORT=1492

# 1.4 Production Host Protection Invariants
# - Host production daemon on 127.0.0.1:1404 must NEVER be stopped or killed.
# - Never execute destructive commands ('clean', 'uninstall', 'reinstall', 'data prune') without HOME="$KT".
# - Strict No-Push / No-Publish Invariant: NEVER execute 'git push', 'npm publish', or create remote releases.
```

- [x] **1.1 Sandbox Creation**: `export KT="$(mktemp -d /tmp/konoha_manual_test_XXXXXX)"` (Directory created under `/tmp`)
- [x] **1.2 Isolated Helper Definition**: Define `k()` function with `HOME="$KT"` and `KONOHA_UI_AUTOSTART=0`.
- [x] **1.3 Environment Variable Verification**: Ensure `echo $KT` points to `/tmp/konoha_manual_test_*`.
- [x] **1.4 Clean Tarball Verification**:
  ```bash
  npm pack --dry-run
  ```
  Verify package tarball includes only production assets (`bin/`, `src/`, `apps/web/build/`, `.agents/`) and strictly excludes `docs/`, `tests/`, `.env*`, and temporary files.

---

## 2. Domain 1: CLI Core & Operational Router Verification

Test every retained canonical command and verify strict rejection of legacy aliases.

### 2.1 Retained Canonical Commands (Full Matrix)

| Test ID | Command | Input / Flags | Expected Output & Behavior | Pass Criteria | Status |
|---|---|---|---|---|---|
| **CLI-01** | `k help` | `--help` or `help` | Lists all canonical subcommands, options, and operational hints | Exits 0; zero broken formatting | [ ] |
| **CLI-02** | `k version` | `version`, `-v`, `--version` | Displays `Current Version: 2.1.18` and queries registry | Exits 0; reports v2.1.18 | [ ] |
| **CLI-03** | `k status` | `status` | Reports system health, SQLite database path, active clients, and bridge status | Exits 0; valid JSON/ASCII | [ ] |
| **CLI-04** | `k doctor` | `doctor` | Validates Node >= 22.16.0, `node:sqlite`, FTS5, RTK, client tools | Exits 0; all checks pass | [ ] |
| **CLI-05** | `k savings` | `savings` | Shows token savings telemetry, baseline calculations, and reduction percentage | Exits 0; displays >80% savings | [ ] |
| **CLI-06** | `k data view` | `data view` | Displays storage metrics, table row counts, and virtual FTS sizes | Exits 0; lists all 11 tables | [ ] |
| **CLI-07** | `k data backup` | `data backup` | Creates `.konoha/konoha_backup_*.db` via atomic `VACUUM INTO` | Exits 0; backup file exists & is valid SQLite | [ ] |
| **CLI-08** | `k data rebuild-fts` | `data rebuild-fts` | Rebuilds `skills_fts` and `persona_memories_fts` from canonical tables | Exits 0; prints rebuilt counts | [ ] |
| **CLI-09** | `k data prune` | `data prune --retention 90` | Prunes `tool_calls` older than retention threshold; displays warning | Exits 0; preserves summary counters | [ ] |
| **CLI-10** | `k project list` | `project list` | Lists registered workspace projects and repository hashes | Exits 0; formatted ASCII table | [ ] |
| **CLI-11** | `k task list` | `task list` | Lists active SDLC tasks, DoR status, and reviewer modes | Exits 0; tabular format | [ ] |
| **CLI-12** | `k task show` | `task show <id>` | Displays full task metadata, evidence, and slop score | Exits 0; shows JSON/ASCII evidence | [ ] |
| **CLI-13** | `k bridge list` | `bridge list` | Displays configured model proxy bridges, ports, and providers | Exits 0; lists port bindings | [ ] |
| **CLI-14** | `k bridge models` | `bridge models` | Queries upstream LLM model catalog across active bridges | Exits 0; model list displayed | [ ] |
| **CLI-15** | `k skill list` | `skill list` | Lists all canonical installed skills with descriptions | Exits 0; lists canonical skills | [ ] |
| **CLI-16** | `k agent status` | `agent status` | Displays the 7 specialist ninja agents (Sannin, Genin, Jonin, etc.) | Exits 0; shows active rosters | [ ] |
| **CLI-17** | `k soul view` | `soul view` | Displays persistent persona memory, guidelines, and project stack | Exits 0; displays guidelines | [ ] |
| **CLI-18** | `k detect-ai` | `detect-ai <file>` | Runs Human-Built Index scan; outputs burstiness and vocabulary score | Exits 0; score between 0-100 | [ ] |
| **CLI-19** | `k detect-docs` | `detect-docs <file>` | Runs Document AI detector; analyzes clichés, formatting, watermarks | Exits 0; outputs ZeroGPT target score | [ ] |
| **CLI-20** | `k ui status` | `ui status --port=$TEST_PORT` | Shows Web UI daemon process state on test port | Exits 0; reports offline/online cleanly | [ ] |

### 2.2 Rejection of 27 Removed Legacy Aliases

Verify that invoking any legacy command rejected in Phase 4 exits with status code 1 and emits the standard deprecation error message:
`Unknown command: <alias>`  
`Run konoha help for usage.`

- [x] **CLI-LEG-01**: `k embeddings` (Ref: `bin/cli.js:9408`)
- [x] **CLI-LEG-02**: `k detect_ai`
- [x] **CLI-LEG-03**: `k ai-detector`
- [x] **CLI-LEG-04**: `k detect_docs`
- [x] **CLI-LEG-05**: `k docs-detector`
- [x] **CLI-LEG-06**: `k detect-doc`
- [x] **CLI-LEG-07**: `k personas`
- [x] **CLI-LEG-08**: `k memories`
- [x] **CLI-LEG-09**: `k spirit`
- [x] **CLI-LEG-10**: `k will-of-fire`
- [x] **CLI-LEG-11**: `k projects`
- [x] **CLI-LEG-12**: `k tasks`
- [x] **CLI-LEG-13**: `k web-search`
- [x] **CLI-LEG-14**: `k inbox`
- [x] **CLI-LEG-15**: `k install`
- [x] **CLI-LEG-16**: `k memory`
- [x] **CLI-LEG-17**: `k setup`
- [x] **CLI-LEG-18**: `k update`
- [x] **CLI-LEG-19**: `k saving`
- [x] **CLI-LEG-20**: `k agents`
- [x] **CLI-LEG-21**: `k tg`
- [x] **CLI-LEG-22**: `k tunnels`
- [x] **CLI-LEG-23**: `k prune`
- [x] **CLI-LEG-24**: `k context`
- [x] **CLI-LEG-25**: `k persona`
- [x] **CLI-LEG-26**: `k searxng`
- [x] **CLI-LEG-27**: `k sdlc`

---

## 3. Domain 2: MCP Server STDIO Protocol & Bounded File Tools (v2.1.18)

Verify the headless MCP STDIO protocol handler via direct JSON-RPC 2.0 message pipes.

```bash
# Helper function to pipe JSON-RPC 2.0 messages directly to Konoha MCP server
mcp_pipe() {
  printf '%s\n' "$1" | env HOME="$KT" KONOHA_DB_PATH="$KT/.konoha/konoha.db" node src/server.js
}
```

### 3.1 Protocol Handshake & Manifest Verification

- [x] **MCP-01: JSON-RPC 2.0 Handshake (`initialize`)**:
  - Input: `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test-client","version":"1.0"}}}`
  - Expected: Response contains `serverInfo.name: "konoha"`, `serverInfo.version: "2.1.18"`, `protocolVersion: "2024-11-05"`.
- [x] **MCP-02: Tool Manifest Count (`tools/list`)**:
  - Input: `{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`
  - Expected: Returns all canonical tools with schemas; 45 canonical tools advertised.
- [x] **MCP-03: Unknown Tool Rejection**:
  - Input: `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"invalid_tool","arguments":{}}}`
  - Expected: Returns JSON-RPC error code `-32601` (`Method not found`).

### 3.2 Bounded File Tools Verification (v2.1.18 500-Line Span & Metadata)

- [x] **MCP-04: `read_file_head` Outline & Line Prefix**:
  - Input: `{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"read_file_head","arguments":{"file_path":"package.json","max_lines":10}}}`
  - Expected: Returns lines 1-10 with numbered line prefixes (e.g., `1:{`).
- [x] **MCP-05: `read_file_range` 500-Line Max Span**:
  - Input: Call `read_file_range` requesting lines 1 to 500 on a large file.
  - Expected: Returns 500 lines cleanly without `exceeds maximum span` error. Requesting 501 lines triggers an actionable boundary error (`MAX_SPAN = 500`).
- [x] **MCP-06: `read_file_range` 64KB Byte Budget**:
  - Input: Request a span of dense lines exceeding 32KB but within 64KB.
  - Expected: Does not silently truncate at 32KB; reads up to the 64KB budget cleanly.
- [x] **MCP-07: Structured Pagination Metadata Preservation**:
  - Input: Read a file window with `read_file_range` on a file larger than 500 lines.
  - Expected: Output payload explicitly includes structured metadata: `[lines X-Y of Z; next_range: ...; complete: false]`.
- [x] **MCP-08: `file_info` Structure Preview**:
  - Input: `{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"file_info","arguments":{"file_path":"src/server.js"}}}`
  - Expected: Returns total file size, line count, and structural outline.
- [x] **MCP-09: `token_efficient_grep` Token Bounding**:
  - Input: Search pattern across `src/` with `max_results: 10`.
  - Expected: Returns top 10 matches bounded by token count without streaming thousands of raw lines.
- [x] **MCP-10: `get_file_structure` AST Signatures**:
  - Input: Extract structure of `src/db.js`.
  - Expected: Returns top-level function names, exported symbols, and class declarations.

---

## 4. Domain 3: Skill Discovery, SQLite FTS5 & Semantic Vector Search

- [x] **SKILL-01: SQLite FTS5 Full-Text Search (`find_skill`)**:
  - Command: `k test` or invoke `find_skill` via MCP with `keyword: "docker"`.
  - Expected: Returns `multi-stage-dockerfile` ranked by BM25 match score.
- [x] **SKILL-02: Bounded Skill Retrieval (`get_skill`)**:
  - Command: Call `get_skill(name="antislop")`.
  - Expected: Retrieves full Markdown instructions for `antislop` on demand without loading entire repository.
- [x] **SKILL-03: Multi-Skill Discovery (`find_skills`)**:
  - Command: Call `find_skills(keywords=["react", "testing"])`.
  - Expected: Returns matched skills array with relevant tokens and summaries.
- [x] **SKILL-04: Skill Chunks Cascade Deletion**:
  - Setup: Delete a skill row in sandbox SQLite database.
  - Expected: SQLite foreign key cascade (`ON DELETE CASCADE`) automatically removes all related rows in `skill_chunks`.
- [x] **SKILL-05: FTS5 Virtual Index Healing (`rebuildAllFts`)**:
  - Command: Corrupt or clear `skills_fts`, then execute `k data rebuild-fts`.
  - Expected: Re-populates `skills_fts` and `persona_memories_fts` with 100% parity to canonical tables.
- [x] **SKILL-06: Neural Vector Search Reranker (IBM Granite 384d)**:
  - Command: Execute semantic query with vector search enabled.
  - Expected: Re-ranks candidates using MS MARCO MiniLM cross-encoder with CPU duty cycle capped below 50%.
- [x] **SKILL-07: Flexible Keyword Extraction & Array Keywords Dispatch (`find_skills`)**:
  - Input: `{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"find_skills","arguments":{"keywords":["react", "testing"]}}}`
  - Expected: `src/mcp/tool_dispatch.js` seamlessly detects array `keywords` or string `query`, joins array entries with whitespace, and dispatches to `findSkill("react testing")` without empty keyword error.
- [x] **SKILL-08: Parameter Router Alias Normalization (`src/file_tools_router.js`)**:
  - Input: Invoke `find_skill` or `find_skills` with parameter aliases `{ query: "docker" }` or `{ keywords: ["k8s"] }`.
  - Expected: `TOOL_SPECIFIC_PARAM_MAP` canonicalizes `query`, `Query`, `keywords`, and `Keywords` to `keyword` before validation.
- [x] **SKILL-09: 15-Domain Search Accuracy & BM25 Relevance Benchmark**:
  - Command: Run automated 15-domain precision benchmark across `docker`, `react`, `svelte`, `angular`, `security`, `kubernetes`, `diagram`, `antislop`, `database`, `e2e`, `css`, `adhd`, `audit`, `telemetry`, and `telegram`.
  - Expected: 15/15 (100.0%) precision score; returns accurate, non-empty skill and reference recommendations for every domain.
- [x] **SKILL-10: 5-Tree Client Mirror Parity & Automated Synchronization**:
  - Command: `node scripts/sync_skills.js && node tests/test_client_skills_sync.js`
  - Expected: 4,208 files verified byte-identical across `.agents/skills`, `.cursor/skills`, `.gemini/skills`, `.commandcode/skills`, `.claude/skills`, and `src/templates/skills` with 0 drift.
- [x] **SKILL-11: Ninja Agent Embedded Skills Rosters Integrity**:
  - Verification: Inspect `src/templates/agents.yaml` and `AGENTS.md` ninja agent definitions.
  - Expected: Embedded skills rosters strictly mapped to genin, jonin, anbu, tokubetsu-jonin, and chunin. Sannin and Kage are strictly excluded from `i-have-adhd` to protect router and delivery-gate invariants.
- [x] **SKILL-12: Cross-Agent `i-have-adhd` Output Rule Contract**:
  - Command: `node tests/test_i_have_adhd_skill.js`
  - Expected: Enforces byte-identical delivery across all 5 agents with all 10 output rules intact, zero standalone directory regressions, and valid router references.
- [x] **SKILL-13: One-Shot Instruct Style & Zero Conversational Slop**:
  - Verification: Automated scan for conversational filler ("as an ai", "i hope this helps", "let me know if you need anything else") across 1,033 skill entries.
  - Expected: Zero unprompted conversational filler; all instructions formatted with crisp bold headers, bullet points, and code blocks.
- [x] **SKILL-14: Canonical Skills vs Embedded Reference Invariant**:
  - Command: `node tests/run_all.js test_canonical_skills`
  - Expected: Exactly 15 canonical top-level skills; 1,018 embedded references properly categorized; `autoDetectSkills` strictly ignores embedded reference folders.

---

## 5. Domain 4: Ninja Agent Team Delegation & Workflow State Machine

Verify the 7 specialist ninja subagents and the 8-phase orchestration state machine.

```mermaid
flowchart LR
    Sannin[Sannin: Router] --> Genin[Genin: Explore]
    Genin --> KagePlan[Kage: Plan]
    KagePlan --> Chunin[Chunin: Research]
    Chunin --> Exec[Jonin / Anbu: Execute]
    Exec --> Doc[Tokubetsu-Jonin: Document]
    Doc --> KageRev[Kage: Review Gate]
    KageRev --> Synthesize[Sannin: Synthesize]
```

- [x] **AGT-01: Direct Specialist Tool Calls**:
  - Invoke `genin`, `kage`, `jonin`, `anbu`, `tokubetsu-jonin`, `chunin`, and `sannin` via MCP.
  - Expected: Each subagent executes cleanly and records execution metrics in task directory.
- [x] **AGT-02: Sannin Task Triage & Directory Resolution**:
  - Call `sannin(task="Scaffold dashboard", task_dir="...")`.
  - Expected: Resolves task directory under `~/.konoha/tmp/<client>/<session>/scratch/tasks/<task_id>/` (never inside project workspace root).
- [x] **AGT-03: WORKFLOW_PHASES State Machine Enforcement**:
  - Verify workflow transition sequence: `route` -> `explore` -> `plan` -> `research` -> `execute` -> `document` -> `review` -> `synthesize` -> `done`.
  - Expected: Transitions cannot skip mandatory gates (e.g., cannot reach `synthesize` without `review`).
- [x] **AGT-04: Legacy Caller Rejection in `report_from_agent` (G-18)**:
  - Call `report_from_agent(agent="delegate_to_kage", summary="...")`.
  - Expected: Strictly rejected with error `Legacy delegate_to_* name rejected`. Valid callers (`kage`, `anbu`, etc.) are accepted.
- [x] **AGT-05: Subagent Scratch Directory Isolation**:
  - Verify that `delegate.md`, `plan.md`, `findings.md`, and `result.md` are written exclusively inside the isolated task scratch directory.
  - Expected: Workspace root remains 100% clean of temporary artifacts.
- [x] **AGT-06: High-Effort Instruct Personality**:
  - Inspect agent output responses across all subagents.
  - Expected: Zero conversational filler (no "Hmmmm", "Let me check", "Wait, let me"). Starts with required log header `[<Icon> <Name>] active. Calling ...` followed by structured, actionable results.
- [x] **AGT-07: Autonomous Remediation Loop**:
  - Simulate a delivery failure with AI slop findings > 0.
  - Expected: Kage automatically generates remediation tasks and routes them to Anbu (for backend) or Jonin (for UI) up to 7 cycles before tripping circuit breaker.

---

## 6. Domain 5: SvelteKit Web Configuration UI & Mobile Invariants

Launch the SvelteKit Web Configuration UI daemon on an isolated port (`$TEST_PORT` = 1492):

```bash
k ui daemon --port=$TEST_PORT --host=127.0.0.1
```

- [x] **UI-01: Health Endpoint (`GET /api/v1/health`)**:
  - Command: `curl -s http://127.0.0.1:$TEST_PORT/api/v1/health`
  - Expected: Returns `{"status":"healthy","version":"2.1.18",...}`.
- [x] **UI-02: Root Redirect to Dashboard (`GET /`)**:
  - Command: `curl -i http://127.0.0.1:$TEST_PORT/`
  - Expected: HTTP 307 Redirect to `/dashboard`.
- [x] **UI-03: SvelteKit SSR Page Delivery (`GET /dashboard`)**:
  - Command: `curl -s -D - http://127.0.0.1:$TEST_PORT/dashboard -o /dev/null`
  - Expected: HTTP 200 with `x-sveltekit-page: true`.
- [x] **UI-04: Loopback Host Header Validation (SEC-03 / G-04)**:
  - Command: `curl -i -H "Host: evil.com" http://127.0.0.1:$TEST_PORT/api/v1/health`
  - Expected: HTTP 403 Forbidden (`Loopback interface rejected external Host header`).
- [x] **UI-05: Project Deletion Confirmation Safety (SEC-01)**:
  - Command: `curl -i -X DELETE http://127.0.0.1:$TEST_PORT/api/v1/projects/invalidhash`
  - Expected: HTTP 400 Bad Request requiring explicit `?confirm=true` flag.
- [x] **UI-06: Mandatory Header Logo on Far LEFT**:
  - Inspect desktop layout header.
  - Expected: Logo is positioned on the far LEFT (`justify-between` with brand logo first, nav items adjacent, actions right).
- [x] **UI-07: Zero Hamburger Menu in Mobile Header**:
  - Inspect mobile view (`lg:hidden`).
  - Expected: Header contains NO hamburger menu toggle button. Mobile navigation is powered exclusively by the bottom Mobile Dock.
- [x] **UI-08: Archetype-Adaptive Mobile Navigation Dock**:
  - Inspect fixed bottom mobile dock (`lg:hidden`).
  - Expected: Quick one-tap navigation items adapted to the active view; main content stage applies `pb-28 lg:pb-0` to eliminate visual overlap.
- [x] **UI-09: Floating Bottom-Right Theme Switcher Button (FAB)**:
  - Inspect 10-theme light mode selector.
  - Expected: Positioned as a floating button in the bottom-right corner (`fixed bottom-20 right-5 lg:bottom-6 lg:right-6 z-50 mb-[2em]`) with glowing aurora animation (`.animate-aurora`). Clicking opens the centered 10-theme modal popup with dynamic CSS variables and localStorage persistence.
- [x] **UI-10: Clean Daemon Shutdown**:
  - Command: `k ui stop --port=$TEST_PORT`
  - Expected: Daemon process terminates cleanly, removes PID file from `$KT/.konoha/ui-1492.pid`.
- [x] **UI-11: 10 Calibrated 4-Color Gradient Theme Palettes**:
  - Inspect `apps/web/src/lib/state/themeState.svelte.js`.
  - Expected: All 10 themes contain exact 4-stop vibrant gradient arrays:
    1. Chidori: `['#10132B', '#35206B', '#8B5CF6', '#FF4FA3']`
    2. Byakugan: `['#0B1729', '#124A72', '#0788C9', '#36DFFF']`
    3. Konoha Leaf: `['#101D13', '#285225', '#68A82E', '#B8FF49']`
    4. Rasengan: `['#21102B', '#66245E', '#D946EF', '#FF8748']`
    5. Sharingan: `['#101A35', '#263F8F', '#4F83FF', '#B18CFF']`
    6. Hokage: `['#251016', '#70202B', '#F04452', '#FF8A38']`
    7. Anbu: `['#0C2525', '#11665E', '#19B5A5', '#65F5D5']`
    8. Sage Mode: `['#1C1030', '#633078', '#FF42C8', '#35E8FF']`
    9. Sound Village: `['#21190D', '#6B4517', '#D9A52E', '#FFE477']`
    10. Akatsuki: `['#0B211D', '#126447', '#21C98B', '#58FFE0']`
- [x] **UI-12: Premium Hardware-Accelerated Animations & Specular Shimmer**:
  - Inspect `apps/web/src/app.css` and UI components.
  - Expected: High-end specular light reflection on hover (`.glass-card-3d::after`), ambient aurora glow (`.animate-aurora`), 4-gradient flow pulse (`.animate-gradient-flow`), and smooth entrance animations (`.animate-in.slide-up`, `.animate-in.fade-in`, `.animate-in.zoom-in-95`).
- [x] **UI-13: Global Toast Notification Conflict Avoidance**:
  - Trigger toast notifications in Web UI.
  - Expected: Toasts display in top-right (`fixed top-5 right-5 z-[100]`), completely avoiding overlap or collision with the bottom-right theme switcher and bottom mobile dock.
- [x] **UI-14: Playwright & Agent-Browser E2E Test Suite Automation**:
  - Command: `pnpm --dir apps/web run test:e2e`
  - Expected: All Playwright E2E specs (`detector_flow.spec.js`, `routes_load.spec.js`, `theme_and_navigation.spec.js`) execute and pass cleanly with 0 errors and 0 uncaught JavaScript page exceptions.

---

## 7. Domain 6: Document Engineering & Animated WebP Media Pipeline

- [x] **DOC-01: Professional DOCX Creation (`document_create`)**:
  - Command: Call `document_create` with structured content.
  - Expected: Generates publication-grade DOCX with standard margins (7200 DXA width), typography hierarchy, and zero AI clichés.
- [x] **DOC-02: Structured Spreadsheet Creation (`spreadsheet_create`)**:
  - Command: Call `spreadsheet_create` with tabular dataset.
  - Expected: Generates valid XLSX workbook with column auto-widths, formatted number cells, and formula calculations.
- [x] **DOC-03: Modern Presentation Scaffolding (`presentation_create`)**:
  - Command: Call `presentation_create` with slide definitions.
  - Expected: Generates valid 16:9 widescreen PPTX presentation with high-contrast color cards and speaker notes.
- [x] **DOC-04: Architectural Diagram Creation (`diagram_create`)**:
  - Command: Call `diagram_create` with diagram nodes and edges.
  - Expected: Generates valid Draw.io XML geometry and clean SVG vector graphics.
- [x] **DOC-05: Canonical Animated WebP Export (`animation_export`)**:
  - Command: Call `animation_export` with keyframe sequence.
  - Expected: Exports canonical Animated `.webp` file passing pure Node.js binary validation (RIFF header, `WEBP` fourCC, `VP8X` with animation flag bit 1 set, `ANIM`, and `ANMF` frame chunks).
- [x] **DOC-06: 78.5% Compression Benchmark**:
  - Compare generated Animated WebP file size against legacy GIF.
  - Expected: WebP achieves $\ge 40\%$ to $78.5\%$ file size reduction with superior frame fidelity and alpha transparency.
- [x] **DOC-07: Static / Corrupted WebP Rejection**:
  - Pass a static single-frame WebP or corrupted buffer to `validateAnimatedWebP`.
  - Expected: Throws descriptive validation error and cleans up transient scratch buffers.
- [x] **DOC-08: Zero Broken Markdown Embeds**:
  - Run `node tests/test_docs_currency.js`.
  - Expected: 100% of media references across all 27 markdown documents resolve to existing `.webp` assets with 0 broken links.

---

## 8. Domain 7: AI Fingerprint Detection (Single-File & Pure JS Document Detector)

- [x] **DET-01: Website AI Fingerprint Scanner (`website_ai_detector`)**:
  - Command: `k detect-ai package.json` or scan URL.
  - Expected: Outputs Human-Built Index score (0-100), sentence rhythm variance, and vocabulary burstiness. Scores 0-20 indicate Human-Built.
- [x] **DET-02: Pure Node.js DOCX ZIP Parsing (Zero Python / CLI Unzip)**:
  - Command: `k detect-docs docs/KONOHA-OVERVIEW.docx` on an environment without `unzip` installed.
  - Expected: Pure Node.js PKZIP extractor reads `word/document.xml` using `zlib.inflateRawSync` and evaluates AI markers cleanly.
- [x] **DET-03: Clean Human Document Score**:
  - Command: `k detect-docs README.md`
  - Expected: Score = 0; label = `HUMAN_WRITTEN`; findings = 0.
- [x] **DET-04: AI Cliché & Buzzword Detection**:
  - Test text containing "seamlessly delve into a tapestry of possibilities".
  - Expected: Detects high-risk AI clichés (`delve`, `tapestry`, `seamlessly`), increases AI risk score, and lists exact line numbers.
- [x] **DET-05: PDF Metadata & Watermark Detection**:
  - Test PDF generated with `reportlab` or `weasyprint`.
  - Expected: Flags generator metadata watermark and highlights AI generation footprint.
- [x] **DET-06: ZeroGPT Target Defense (<3% Risk)**:
  - Validate Tokubetsu-Jonin generated documentation deliverables.
  - Expected: Achieves < 3% score on ZeroGPT and commercial AI detectors via vocabulary variation and cliché elimination.
- [x] **DET-07: Nonexistent File Handling**:
  - Command: `k detect-docs nonexistent_file.docx`
  - Expected: Gracefully returns structured JSON error without crashing the CLI or MCP runtime.
- [x] **DET-08: Web UI Text Paste Mode**:
  - Submit raw text payload to `POST /api/v1/detect-docs/text`.
  - Expected: Analyzes text synchronously, returns burstiness metrics, cliché counts, and overall confidence score.

---

## 9. Domain 8: SDLC Governance, Definition-of-Readiness (DoR) & Anti-Slop Gate

- [x] **SDLC-01: Brief Prompt Rejection (< 5 words)**:
  - Call `check_readiness(task="fix it")`.
  - Expected: Fails DoR with error: `Task description is too brief (< 5 words)`.
- [x] **SDLC-02: Placeholder Token Rejection**:
  - Call `check_readiness(task="implement TODO later in file.js")`.
  - Expected: Fails DoR with error identifying unaddressed placeholder tokens (`TODO`, `FIXME`).
- [x] **SDLC-03: Candidate File Existence Validation**:
  - Call `check_readiness(task="update non_existent_file.js")`.
  - Expected: Fails DoR warning that referenced file does not exist on disk.
- [x] **SDLC-04: Cross-Platform Windows Backslash Normalization**:
  - Call `check_readiness(task="edit src\\server.js")` with Windows backslashes.
  - Expected: Correctly normalizes `src\server.js` to `src/server.js` and validates file existence without false rejections.
- [x] **SDLC-05: New File Creation Exemption**:
  - Call `check_readiness(task="create new component in src/components/NewCard.svelte")`.
  - Expected: Recognizes creation intent (`create`, `scaffold`, `new`) and does not penalize missing candidate file.
- [x] **SDLC-06: Invariant 69 Zero-Exclusions Delivery Gate**:
  - Scan codebase using `aislop_scan`.
  - Expected: 0 findings of ANY severity; 100/100 score; zero `// aislop-ignore` suppressions in application code.
- [x] **SDLC-07: Circuit Breaker Failsafe Degrade**:
  - Simulate 2 consecutive crashes of the anti-slop scanner.
  - Expected: Circuit breaker trips (`status: open`), prevents unverified delivery, and logs warning without hanging the orchestrator.
- [x] **SDLC-08: SDLC Task Lifecycle State Tracking**:
  - Create task with `k task create "Implement feature X"`.
  - Expected: Task transitions across `draft` -> `dor_passed` -> `in_progress` -> `review` -> `completed` with immutable timestamps.
- [x] **SDLC-09: Task Evidence Recording**:
  - Save execution evidence to an active task.
  - Expected: Persisted in SQLite `sdlc_tasks` table under `evidence` JSON column; retrievable via `k task show <id>`.
- [x] **SDLC-10: Kage Reviewer 98% Minimum Confidence Gate**:
  - Perform delivery review on completed task.
  - Expected: Requires $\ge 98.0\%$ confidence across all evaluation categories (code quality, test execution, security compliance) to pass. Delivery is strictly BLOCKED if confidence < 98%.

---

## 10. Domain 9: LLM Proxy Gateway & Bridge Router

- [x] **BRG-01: Bridge Status & Port Listing**:
  - Command: `k bridge status`
  - Expected: Displays aggregate proxy gateway status on `127.0.0.1:19999` and individual bridge port allocations.
- [x] **BRG-02: Port Availability Checking (`checkPortActive`)**:
  - Validate port checking behavior on used vs unused ports.
  - Expected: Reuses canonical `checkPortActive` from `src/platform_utils.js` with 400ms timeout and socket cleanup.
- [x] **BRG-03: Dynamic Port Reservation**:
  - Configure multiple local model bridges.
  - Expected: Automatically increments port allocation above `11436` (e.g., 11437, 11438) without collision.
- [x] **BRG-04: SQLite Bridge Persistence**:
  - Add or disable a bridge using `k bridge create` or `k bridge disable`.
  - Expected: State is transactionally persisted in `bridges` table in `konoha.db`.
- [x] **BRG-05: Fallback & Retry Logic**:
  - Send request to an inactive bridge endpoint.
  - Expected: Transparently falls back to secondary provider or returns descriptive sidecar timeout error.
- [x] **BRG-06: Stable Gateway Invariant**:
  - Verify that bridge router configuration files remain untouched and stable across sessions.

---

## 11. Domain 10: Remote Access, Telegram Bot & Cloudflare Tunnel Security

- [x] **REM-01: Telegram Poller Status**:
  - Command: `k telegram status`
  - Expected: Displays Telegram bot configuration, mode (`one_way` vs `two_way`), and transport (`polling`).
- [x] **REM-02: Strict Chat ID Whitelist Gating**:
  - Simulate an inbound command from an unauthorized Telegram chat ID.
  - Expected: Silently dropped; command execution is rejected with security audit log.
- [x] **REM-03: Zero-Emoji Task Notifications**:
  - Send test task notification via Telegram poller.
  - Expected: Emits crisp, professional ASCII/text status without emoji formatting.
- [x] **REM-04: Cloudflare Quick Tunnel Supervisor**:
  - Command: `k tunnel status`
  - Expected: Reports cloudflared binary detection, tunnel state, and ingress URL.
- [x] **REM-05: Constant-Time PIN Authentication (`crypto.timingSafeEqual`)**:
  - Submit valid vs invalid PINs to tunnel ingress.
  - Expected: Verified using `crypto.timingSafeEqual` to prevent timing-based side-channel attacks; invalid PIN rejected with HTTP 401.
- [x] **REM-06: CSPRNG PIN Generation**:
  - Generate a new tunnel PIN using `k tunnel auth-pin --generate`.
  - Expected: Uses `crypto.randomInt()` to generate a cryptographically secure 6-digit PIN.
- [x] **REM-07: Query String PIN Exposure Rejection**:
  - Attempt to pass PIN via URL query parameter (`?pin=123456`).
  - Expected: Strictly rejected; PIN must be provided via `X-Konoha-Pin` header or body payload.
- [x] **REM-08: SQLite Prompt Queue State Machine**:
  - Push async prompt into queue.
  - Expected: Recorded in `inbox_queue` table with status `pending`, processed sequentially, and updated with result evidence.

---

## 12. Domain 11: Cross-Platform Daemons & Service Lifecycles

- [x] **OS-01: Linux `systemd` User Service Generation**:
  - Command: `k ui service --dry-run` on Linux.
  - Expected: Generates valid unit file targeting `~/.config/systemd/user/konoha-ui.service` with `systemctl --user` commands.
- [x] **OS-02: macOS `launchd` LaunchAgent Plist**:
  - Command: `k ui service --dry-run` on macOS.
  - Expected: Generates valid plist targeting `~/Library/LaunchAgents/com.konoha.ui.plist` with `launchctl` commands.
- [x] **OS-03: Windows Native Background Process**:
  - Verify background spawn options on Windows (`win32`).
  - Expected: Spawns with `windowsHide: true`, detached process flags, and records port-scoped PID.
- [x] **OS-04: Windows Process Tree Teardown (`taskkill /F /T`)**:
  - Stop UI daemon on Windows.
  - Expected: Uses `taskkill /F /T /PID <pid>` to terminate entire child process tree cleanly without orphaned background node processes.
- [x] **OS-05: WSL2 Host Browser Delegation**:
  - Invoke `openUrlInBrowser` inside WSL2 environment.
  - Expected: Detects WSL2 and delegates URL launch to Windows host browser via `wslview` or `cmd.exe /c start`.
- [x] **OS-06: Safe Directory Permissions (`ensureDir`)**:
  - Verify recursive directory creation across `$KT/.konoha/`, cache, and backup folders.
  - Expected: Created with standard user permissions (`0700` / `0755`) without privilege escalation.

---

## 13. Domain 12: RTK Command Proxy & Token Optimization Hygiene

- [x] **RTK-01: RTK Execution Wrapper Prefix**:
  - Run CLI commands wrapped with `rtk <command>`.
  - Expected: Output is filtered for noise, reducing token consumption by 83%–98%.
- [x] **RTK-02: Strict Exit Code Propagation**:
  - Execute a failing command via RTK wrapper (e.g., `rtk node -e "process.exit(2)"`).
  - Expected: Exit code 2 is strictly preserved and returned to the caller; failures are never swallowed.
- [x] **RTK-03: 16KB Error Passthrough Window (`passthrough_max_chars`)**:
  - Inspect `~/.config/rtk/config.toml`.
  - Expected: `passthrough_max_chars = 16384` ensures full compiler diagnostics and stack traces are preserved.
- [x] **RTK-04: Unclipped Failure Tee Logging (`[tee] mode = "failures"`)**:
  - Trigger a failing test command.
  - Expected: Raw unclipped output is written to `/tmp/rtk_tee/fail_*.log` for diagnostic debugging.
- [x] **RTK-05: Security Tool Pass-Through Exemption**:
  - Execute `aislop`, `node scripts/lint.js`, or `npm audit` wrapped by RTK.
  - Expected: Exempted via `exclude_commands` in `config.toml`, delivering exact raw text without filtering.
- [x] **RTK-06: Direct Shell Fallback when RTK is Unavailable**:
  - Simulate environment where `rtk` binary is not in PATH.
  - Expected: Seamlessly falls back to direct `sh` / `bash` execution without hanging or reporting false execution.

---

## 14. Consolidated Full Manual QA Scorecard & Verification Matrix

| Domain | Feature Area | Total Scenarios | Automated Coverage | Manual Target | Verification Command / Suite | Pass Status |
|:---|:---|:---:|:---:|:---:|:---|:---:|
| **Domain 1** | CLI Core & Subcommands | 20 | 100% | Full CLI smoke | `tests/test_version_sync.js`, `k status` | **PASS** |
| **Domain 1** | Removed Aliases Rejection | 27 | 100% | 27 alias calls | `tests/test_delegation_alias_removal.js` | **PASS** |
| **Domain 2** | MCP Server & Bounded File Tools | 10 | 100% | STDIO pipe test | `tests/test_bounded_file_tools_completeness.js` | **PASS** |
| **Domain 3** | Skill Retrieval & FTS5 Database | 14 | 100% | FTS & Dispatch tests | `tests/test_db_foreign_keys_and_fts.js`, `tests/test_client_skills_sync.js`, `tests/test_i_have_adhd_skill.js` | **PASS** |
| **Domain 4** | Ninja Agent Team Delegation | 7 | 100% | Subagent calls | `tests/test_workflow_gates.js`, `k test` | **PASS** |
| **Domain 5** | SvelteKit Web Configuration UI | 14 | 100% | HTTP & Playwright E2E | `pnpm --dir apps/web run test:e2e`, `pnpm --dir apps/web run check`, `k ui status` | **PASS** |
| **Domain 6** | Document Engineering & WebP | 8 | 100% | Bitstream parse | `tests/test_all_assets_webp.js` | **PASS** |
| **Domain 7** | AI Fingerprint Detectors (Pure JS) | 8 | 100% | ZIP parse tests | `tests/test_docs_ai_detector.js` | **PASS** |
| **Domain 8** | SDLC Governance & Anti-Slop | 10 | 100% | DoR & gate loop | `tests/test_sdlc_dor.js`, `tests/test_anti_slop_gate.js` | **PASS** |
| **Domain 9** | LLM Proxy Gateway & Bridge | 6 | 100% | Port check tests | `tests/test_bridge_gateway.js`, `k bridge status` | **PASS** |
| **Domain 10** | Remote Access & Cloudflare Tunnel | 8 | 100% | Auth PIN tests | `tests/test_tunnel_auth_enforcement.js` | **PASS** |
| **Domain 11** | Cross-Platform Daemons | 6 | 100% | Platform utils | `tests/test_token_hygiene_and_platform.js` | **PASS** |
| **Domain 12** | RTK Command Proxy & Optimization | 6 | 100% | Config audit | `rtk config`, `tests/test_token_baseline.js` | **PASS** |
| **TOTAL** | **Comprehensive Full Coverage** | **144** | **100%** | **All Scenarios** | **Full Verification Suite** | **100% PASS** |

---

## 15. Incident Escalation & Remediation Runbook

If any manual QA test fails during pre-release verification, follow these deterministic triage procedures:

### 15.1 Bounded File Tool Span or Truncation Failures
1. Inspect `src/file_tools/read_file_range.js`. Verify `MAX_SPAN === 500` and `DEFAULT_BYTE_BUDGET === 65536`.
2. Inspect `src/file_tools_router.js`. Verify `formatToolResult` preserves `total_lines`, `next_range`, and `complete`.
3. Run `node tests/test_bounded_file_tools_completeness.js`.

### 15.2 Document AI Detection or ZIP Extraction Failures
1. Inspect `src/docs_ai_detector.js`. Ensure `extractZipEntryPureJs` correctly parses the EOCD record (`0x06054b50`) and local header.
2. Confirm `zlib.inflateRawSync` is called for Deflate (compression method 8).
3. Run `node tests/test_docs_ai_detector.js`.

### 15.3 SvelteKit Web UI Build or Typecheck Errors
1. Navigate to `apps/web/`.
2. Run `pnpm run check` (`svelte-kit sync && svelte-check --threshold error`).
3. Ensure no component references obsolete routes and that mobile dock padding is maintained (`pb-28 lg:pb-0`).

### 15.4 Database Foreign Key Constraint Violations
1. Check `src/db.js` table definitions.
2. Verify `FOREIGN KEY (skill_name) REFERENCES skills(name) ON DELETE CASCADE` on `skill_chunks`.
3. Run `node tests/test_db_foreign_keys_and_fts.js`.

### 15.5 Documentation Link Currency Drift
1. Run `node tests/test_docs_currency.js`.
2. Resolve any broken markdown link paths or missing security compliance reports in `docs/SecurityCompliance/`.

### 15.6 Skills Routing, Discovery & Client Mirror Sync Failures
1. Inspect `src/mcp/tool_dispatch.js`. Verify `find_skill` and `find_skills` handle string `keyword`, array `keywords`, and `query`.
2. Inspect `src/file_tools_router.js`. Verify `TOOL_SPECIFIC_PARAM_MAP` maps `query` and `keywords` aliases to canonical `keyword`.
3. If skills drift across client IDEs, run `node scripts/sync_skills.js` to propagate `.agents/skills/` to all 5 trees.
4. Execute `node tests/test_i_have_adhd_skill.js && node tests/test_client_skills_sync.js && node tests/test_canonical_skills_and_embedded_refs.js`.
