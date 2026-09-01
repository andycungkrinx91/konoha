# Konoha diagrams

`konoha-architecture.drawio` is the canonical editable source for the repository architecture diagrams. It contains eleven pages covering every logical diagram embedded in the README and documentation. Each owner also keeps a synchronized Mermaid companion for native Markdown rendering and text review.

**Format policy:** Draw.io owns editable geometry, page layout, and presentation routing. Mermaid owns Markdown-native rendering. The two formats must keep the same semantic nodes, relationships, titles, and implementation anchors; their visual layouts may differ.

**Synchronization checklist:**

- Page title and scope match.
- Current component and client names match implementation.
- Directional relationships and important labels match.
- Canonical `genin-skill` naming is used; `deep-code-explorer` is never a current diagram node.
- Draw.io ports/waypoints and Mermaid layout both keep dense flows readable.
- Bridge ownership is explicit: external `konoha-bridge` extension `127.0.0.1:1313`; embedded Konoha aggregate gateway `127.0.0.1:19999`.
- External extension installation is Antigravity IDE-only, refreshed from the live `master` branch at `~/.antigravity-ide/extensions/andycungkrinx91.konoha-bridge-master-universal/`, and does not imply an enabled bridge record.


| Page | Scope | Markdown owner | Implementation anchors |
|---|---|---|---|
| 01 System Architecture | Client, orchestration, MCP, persistence, workspace | `docs/ARCHITECTURE.md` | `src/server.py`, `src/agent_manager.js`, `bin/cli.js` |
| 02 Runtime Query Lifecycle | Prompt, skill retrieval, code search, delegation, synthesis | `docs/ARCHITECTURE.md` | `src/server.py`, `src/prompt_hook.js` |
| 03 MCP Tool and Skill Routing | `sannin` routing to tools and ninja agents | `docs/ARCHITECTURE.md` | `src/server.py`, `src/templates/agents.yaml` |
| 04 LLM Bridge Gateway | Bridge selection, provider boundaries, sidecar protocol retries | `docs/LLM-BRIDGE-GATEWAY.md` | `src/bridge/gateway.js`, `src/bridge/sidecar/` |
| 05 Search Fallback Chain | SearXNG, DuckDuckGo, Startpage, Wikipedia fallback | `docs/SETUP-SEARXNG.md` | `src/server.py:web_search` |
| 06 Skill Registry Installation | Template/package sync, migration, SQLite retrieval | `docs/ADDING-SKILLS.md` | `src/migrate.py`, `bin/cli.js`, `src/skill_manager.js` |
| 07 Token Footprint Comparison | Folder loading versus bounded FTS5 retrieval | `README.md` | `src/server.py`, `src/migrate.py` |
| 08 Orchestrator Task Artifact Flow | Dispatch-scoped structured delegation, task evidence, Kage review, and `delegate.md`/`result.md` legacy fallback | `README.md` | `src/server.py`, `src/agent_manager.js` |
| 09 Jonin Taste-Skill Frontend Engine | Anti-slop standards, Taste Dials, multi-framework targets (Next.js, SvelteKit, Nuxt, Angular) | `docs/ARCHITECTURE.md` | `src/server.py:build_from_source`, `src/server.py:build_from_text` |
| 10 Persistent Project Context & Auto-Compaction | Stack detection, project invariants, 2-delegation auto-compaction (turn ≥ 2, 30m idle reset, SOP preservation, verified-only learnings) | `docs/ARCHITECTURE.md` | `src/persona_memory.py`, `src/server.py` |
| 11 Kage Pre-Delivery Reviewer Workflow Gate | 8-phase orchestration state machine, 100% task execution verification, clean evidence validation, security & CVE audit | `docs/ARCHITECTURE.md` | `src/server.py:run_mcp_workflow`, `src/server.py:_workflow_review_approved` |

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
