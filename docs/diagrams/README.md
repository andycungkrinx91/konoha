# Konoha diagrams

`konoha-architecture.drawio` is the canonical editable source for the repository architecture diagrams. It contains eight pages covering every logical diagram embedded in the README and documentation. Each owner also keeps a synchronized Mermaid companion for native Markdown rendering and text review.

**Format policy:** Draw.io owns editable geometry, page layout, and presentation routing. Mermaid owns Markdown-native rendering. The two formats must keep the same semantic nodes, relationships, titles, and implementation anchors; their visual layouts may differ.

**Synchronization checklist:**

- Page title and scope match.
- Current component and client names match implementation.
- Directional relationships and important labels match.
- Canonical `genin-skill` naming is used; `deep-code-explorer` is never a current diagram node.
- Draw.io ports/waypoints and Mermaid layout both keep dense flows readable.


| Page | Scope | Markdown owner | Implementation anchors |
|---|---|---|---|
| 01 System Architecture | Client, orchestration, MCP, persistence, workspace | `docs/ARCHITECTURE.md` | `src/server.py`, `src/agent_manager.js`, `bin/cli.js` |
| 02 Runtime Query Lifecycle | Prompt, skill retrieval, code search, delegation, synthesis | `docs/ARCHITECTURE.md` | `src/server.py`, `src/prompt_hook.js` |
| 03 MCP Tool and Skill Routing | `sannin` routing to tools and ninja agents | `docs/ARCHITECTURE.md` | `src/server.py`, `src/templates/agents.yaml` |
| 04 LLM Bridge Gateway | Model selection, bridge providers, sidecar protocol retries | `docs/LLM-BRIDGE-GATEWAY.md` | `src/bridge/gateway.js`, `src/bridge/sidecar/` |
| 05 Search Fallback Chain | SearXNG, DuckDuckGo, Startpage, Wikipedia fallback | `docs/SETUP-SEARXNG.md` | `src/server.py:web_search` |
| 06 Skill Registry Installation | Template/package sync, migration, SQLite retrieval | `docs/ADDING-SKILLS.md` | `src/migrate.py`, `bin/cli.js`, `src/skill_manager.js` |
| 07 Token Footprint Comparison | Folder loading versus bounded FTS5 retrieval | `README.md` | `src/server.py`, `src/migrate.py` |
| 08 Orchestrator Task Artifact Flow | `delegate.md`, agent execution, `result.md`, synthesis | `README.md` | `src/server.py`, `src/agent_manager.js` |

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
