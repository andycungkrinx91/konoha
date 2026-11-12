# 🍃 Konoha 9-Ninja Specialist Roster, Parallel Worktree Isolation & Operational Boundaries (v2.2.21)

Technical reference on the 9-agent roster (`@sannin` router + 8 spawnable specialists), parallel git worktree contracts, strict tool permission matrices, compact skill loading (`use_skills`), and ADHD/anti-slop discipline.

---

## 👥 Official 9-Ninja Roster (`@sannin` Router + 8 Spawnable Specialists)

`@sannin` acts strictly as the MCP Router & Orchestrator (never spawned as a worker). All 8 specialist subagents (`SPAWNABLE_SUBAGENTS` in `src/mcp/lazy_subagent.js`) can be spawned individually or concurrently in parallel waves across all 8 supported clients:

| Specialist | Role | Core Responsibility | Tool Mutation Permission |
|---|---|---|---|
| **@sannin** | MCP Router & Orchestrator | Request triage, LangGraph StateGraph routing, parallel wave dispatch, Gate 1 & Gate 2 HITL. | **Router Only** (Never spawned as worker) |
| **@genin** | Codebase Exploration | Read-only codebase discovery, symbol search, call graph tracing, dependency mapping. | **Strictly Read-Only** |
| **@kage** | Chief Architect & Gatekeeper | Architecture trade-off matrices, plan creation (Gate 1), final delivery review gate (100/100 aislop, $\ge 98\%$ confidence). | **Read/Audit Only** (`aislop_scan`, `aislop_why`) |
| **@chunin** | Deep Research & Intel | Web search, official documentation lookup, evidence synthesis with verified citations (`rtk curl`). | **Read/Research Only** (`web_search`) |
| **@jonin** | UI & Frontend Specialist | Dynamic Astra/Fable-inspired UI, Dark & Light Mode, live browser monitor, `Build by konoha` watermark. | **Active Mutating** (Write, edit, `aislop_fix`) |
| **@anbu** | Backend, DevOps & Bug Fixing | Server architecture, database/API hardening, DevOps, bug repairs, minimal safe changes. | **Active Mutating** (Write, edit, `aislop_fix`) |
| **@tokubetsu-jonin** | Technical Writing & Scribe | Publication-grade documentation, DOCX, PDF, XLSX, PPTX, Draw.io/SVG diagrams, animated WebP (< 3.0% AI detection). | **Document & Docs Engines** |
| **@akatsuki** | Security Specialist | Red-team penetration testing in Docker/LXC (`mode: red`), blue-team defensive security auditing (`mode: blue`). | **Sandboxed Offensive & Defensive** |
| **@yamanaka** | Generative 3D Specialist | Autonomous 3D asset synthesis, Manifold-3D geometry validation, live Blender refinement (the Web UI 3D Studio menu is hidden). | **3D & Spatial Pipeline** |

---

## 🌿 Per-Agent Contract & Git Worktree (`git worktree`) Parallel Isolation

Implemented in `src/mcp/worktree_isolation.js` and enforced by `src/agent_contract.js`:
1. **Isolated Worktree Per Parallel Slice**: Each parallel mutating worker receives a dedicated git worktree (`~/.konoha/tmp/<client>/<session>/worktrees/<task_id>_<agent>_<slice>/`) on branch `konoha/wt/<task_id>-<agent>-<slice>` branched from a shared `base_sha`.
2. **Disjoint `owned_files` Contract**: Each parallel worker is assigned an explicit `owned_files` list. Modifying files outside `owned_files` or outside `worktree_path` triggers an immediate `@advisor` `INTERRUPT_CORRECTION` and is refused at merge-back.
3. **Pre-Commit Syntax & Conflict Gate (`syntaxGateForFiles`)**: Validates `.js`/`.cjs`/`.mjs` (`node --check`), `.py` (`py_compile`), `.json` (`JSON.parse`), and rejects any file containing git conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) before merging.
4. **Deterministic 3-Way Merge Barrier (`mergeBackParallelGroup`)**: Merges completed worker branches in deterministic slice order and aborts cleanly (`git merge --abort`) on any collision.

---

## ⚡ Compact Skill Loading (`use_skills` <= 6,400 Bytes) & Active Discipline Skills

- Every specialist subagent retains **`i-have-adhd`** and **`antislop*`** (`antislop`, `antislop-code`, `antislop-human`, `antislop-ui`, `antislop-layoutmobile`, `antislop-copywriting`) in `src/templates/agents.yaml`.
- When a subagent calls `konoha.use_skills` with multiple skills (e.g. `["genin-skill","i-have-adhd","antislop","antislop-human","antislop-code"]`), `src/mcp/skills_retrieval.js` compiles a structured digest capped at **`<= 6,400 bytes` (`<= 1,600 tokens`)** total (`~5.0 KB` on Turn 1, `~2.8 KB` on repeat calls via session deduplication), eliminating the legacy `~12.1k token` MCP response warning while preserving 100% of core rules and section pointers.
