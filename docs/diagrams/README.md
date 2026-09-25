# Konoha diagrams

`konoha-architecture.drawio` is the canonical editable source for the repository architecture diagrams. It contains twelve pages covering every logical diagram embedded in the README and documentation. Each owner also keeps a synchronized Mermaid companion for native Markdown rendering and text review.

**Format policy:** Draw.io owns editable geometry, page layout, and presentation routing. Mermaid owns Markdown-native rendering. The two formats must keep the same semantic nodes, relationships, titles, and implementation anchors; their visual layouts may differ.

**Synchronization checklist:**

- Page title and scope match.
- Current component and client names match implementation.
- Directional relationships and important labels match.
- Canonical `genin-skill` naming is used; `deep-code-explorer` is never a current diagram node.
- Draw.io ports/waypoints and Mermaid layout both keep dense flows readable.
- Bridge ownership is explicit: external `konoha-bridge` extension `127.0.0.1:1313`; embedded Konoha aggregate gateway `127.0.0.1:19999`.
- External extension installation is automated on fresh install (`konoha init`) and upgrade (`konoha upgrade`), cloned from live master, packaged into `konoha-bridge-1.6.0.vsix`, and installed ONLY into the Antigravity IDE CLI (`antigravity --install-extension`; never `code` or `cursor`), with atomic directory sync to `~/.antigravity-ide/extensions/andycungkrinx91.konoha-bridge-master-universal/`.


| Page | Scope | Markdown owner | Implementation anchors |
|---|---|---|---|
| 01 System Architecture | Client, orchestration, MCP (konoha, semble, aislop), persistence, workspace | `docs/ARCHITECTURE.md` | `src/server.js`, `src/db.js`, `src/vector_search.js`, `src/agent_manager.js`, `bin/cli.js` |
| 02 Runtime Query Lifecycle | Prompt, skill retrieval, code search, delegation, synthesis | `docs/ARCHITECTURE.md` | `src/server.js`, `src/prompt_hook.js` |
| 03 MCP Tool and Skill Routing | `sannin` routing to tools and ninja agents (genin, jonin, anbu, tokubetsu-jonin, chunin embed `references/i-have-adhd.md`; sannin and kage do not; kage embeds `references/antislop*`); includes `website_ai_detector` (AI-fingerprint scan, 0-20 = Human-Built, CLI `konoha detect-ai`) and `docs_ai_detector` (Document AI & 0%–1% ZeroGPT target defense, Web UI text paste mode, CLI `konoha detect-docs`, `POST /api/v1/detect-docs/text`) | `docs/ARCHITECTURE.md` | `src/server.js`, `src/templates/agents.yaml`, `.agents/skills/*/references/i-have-adhd.md`, `src/ai_detector.js`, `src/docs_ai_detector.js`, `src/mcp/ai_detector.js` |
| 04 LLM Bridge Gateway | Bridge selection, provider boundaries, sidecar protocol retries | `docs/LLM-BRIDGE-GATEWAY.md` | `src/bridge/gateway.js`, `src/bridge/sidecar/` |
| 05 Search Fallback Chain | SearXNG, DuckDuckGo, Startpage, Wikipedia fallback | `docs/SETUP-SEARXNG.md` | `src/server.js:web_search` |
| 06 Skill Registry Installation | Template/package sync, skills.sh registry proxy, Web UI 1-click install, multi-directory migration, SQLite FTS5 & IBM Granite 384d vector retrieval + MS MARCO MiniLM neural cross-encoder reranker for RAG with adaptive CPU duty-cycle throttling (<50% duty, zero 100% spikes) | `docs/ADDING-SKILLS.md` | `src/migrate.js`, `src/db.js`, `src/vector_search.js`, `bin/cli.js`, `src/skill_manager.js`, `src/web_server.js` |
| 07 Token Footprint Comparison | Folder loading versus bounded FTS5 retrieval | `README.md` | `src/server.js`, `src/migrate.js` |
| 08 Orchestrator Task Artifact Flow | Dispatch-scoped structured delegation, task evidence, Kage review, and `delegate.md`/`result.md` legacy fallback | `README.md` | `src/server.js`, `src/agent_manager.js` |
| 09 Jonin Taste-Skill Frontend Engine | Anti-slop standards, Taste Dials, multi-framework targets (Next.js, SvelteKit, Nuxt, Angular) | `docs/ARCHITECTURE.md` | `src/server.js:build_from_source`, `src/server.js:build_from_text` |
| 10 Persistent Project Context & Auto-Compaction | Stack detection, project invariants, 2-delegation auto-compaction (turn ≥ 2, 30m idle reset, SOP preservation, verified-only learnings) | `docs/ARCHITECTURE.md` | `src/persona_memory.js`, `src/server.js` |
| 11 Kage Pre-Delivery Reviewer Workflow Gate | 8-phase orchestration state machine, Native SDLC Governance (Definition-of-Readiness DoR pre-dispatch gate, cross-provider second opinion, SDLC task status block gate), Zero-AI-Slop Pre-Gate with `CircuitBreaker` fail-safe degrade (threshold=2, recovery=120s, SIGTERM) and dynamic mtime cache invalidation, Autonomous Kage → Anbu Remediation Loop, 98% Minimum Confidence Gate (≥ 98%), 100% task execution verification, clean evidence validation, security & CVE audit | `docs/ARCHITECTURE.md` | `src/mcp/workflow.js`, `src/sdlc_manager.js`, `src/circuit_breaker.js`, `tests/test_anti_slop_gate.js` |
| 12 CLI Upgrade & Progress Engine | 7-stage interactive upgrade pipeline, KonohaProgressBar with live pulse timers, animated braille spinner (startSpinner, TTY-only), in-process runtime sync, cross-client MCP auto-registration | `docs/ARCHITECTURE.md` | `bin/cli.js:cmdUpgrade`, `bin/cli.js:KonohaProgressBar`, `bin/cli.js:cmdInit` |

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
