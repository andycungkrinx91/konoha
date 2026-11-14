# 🍃 Konoha LangGraph.js Production StateGraph Workflow (v2.2.22)

Technical specification and operational guide for the LangGraph.js cyclic StateGraph orchestration engine, parallel git worktree execution, Real-Time Idle `@advisor` worker guard, native walkthrough/TODO synchronization, per-turn token budget governor, and HITL gates.

---

## 🏗️ StateGraph Architecture Overview

In Konoha `v2.2.22`, all multi-step engineering tasks and `/konoha <prompt>` invocations run on a compiled, cyclic LangGraph.js StateGraph (`src/mcp/langgraph/index.js`) with persistent SQLite checkpoints via `KonohaCheckpointSaver`.

### Dual-Track Execution Model
1. **Branch B (Fast-Track / Single-Slice Tasks)**: Direct single-domain requests or slash shortcuts (`/jonin`, `/anbu`, `/genin`, etc.) dispatch with a compact delegation envelope (`<= 3KB` router payload) and client-native `spawn_directive`.
2. **Branch A (Full SDLC & Parallel Multi-Agent Pipeline)**: Multi-step engineering and `/konoha` workflows traverse the cyclic StateGraph with parallel git worktree isolation, Real-Time Idle `@advisor` monitoring, native TODO/walkthrough synchronization, and Kage 98% governance.

---

## 🔄 Graph Topology & Node Lifecycles

```
               ┌──────────────┐
               │ classifyNode │
               └──────┬───────┘
                      │
               ┌──────▼───────┐
               │   planNode   │
               └──────┬───────┘
                      │
        [Gate 1: pending_plan_approval] ◄─── HITL Gate 1 + Post-Approval Compaction
                      │
               ┌──────▼───────┐
               │  briefNode   │
               └──────┬───────┘
                      │
               ┌──────▼───────┐
               │   todoNode   │ ───► Syncs Native Walkthrough & Client TODOs
               └──────┬───────┘
                      │
        ┌─────────────┴─────────────┐
        │                           │
 ┌──────▼───────┐            ┌──────▼───────┐
 │ dispatchNode │ ◄───────── │ remediateNode│ (slop_cycles <= 7)
 └──────┬───────┘            └──────▲───────┘
        │ (Parallel Worktrees +     │
        │  Real-Time Idle @advisor) │
 ┌──────▼───────┐                   │ (remediate)
 │ executeNode  │                   │
 └──────┬───────┘                   │
        │ (3-Way Worktree Merge)    │
        ▼                           │
   [status.phase = 'document', assigned = 'tokubetsu-jonin']
        │                           │
 ┌──────▼───────┐                   │
 │ reviewNode   │ ──────────────────┘
 └──────┬───────┘ (100/100 aislop & >= 98% confidence)
        │
  [Gate 2: pending_human_signoff] (or auto_signoff: true)
        │
 ┌──────▼───────┐
 │ completeNode │ ──► __end__
 └──────────────┘
```

### Node Responsibilities
- **`classifyNode`** (`src/mcp/langgraph/nodes/classify.js`): Strips `/konoha` and `@sannin` prefixes, evaluates prompt intent (`'fast_track'`, `'pentest'`, `'full_sdlc'`), detects parallel workstreams across all 8 specialist domains, and derives deterministic 12-char `flowHash`.
- **`planNode`** (`src/mcp/langgraph/nodes/plan.js`): Generates implementation blueprint (`plan.md`) via Kage and synchronizes `walkthrough_steps` and `todos`. Blocks execution for **HITL Gate 1** (`pending_plan_approval`).
- **`briefNode`** (`src/mcp/langgraph/nodes/brief.js`): Synthesizes task objectives and architectural constraints after post-approval context compaction.
- **`todoNode`** (`src/mcp/langgraph/nodes/todo.js`): Decomposes work into structured task slices with assigned specialist roles, disjoint `owned_files`, and native client TODO directives (`src/mcp/todo_walkthrough_sync.js`).
- **`dispatchNode`** (`src/mcp/langgraph/nodes/dispatch.js`): Assembles single or concurrent (`parallel_dispatches`) payloads with isolated git worktrees (`prepareParallelWorktrees` / `prepareTaskWorktree`), `spawn_directive`, and `parallel_spawn_directive`.
- **`executeNode`** (`src/mcp/langgraph/nodes/execute.js`): Tracks worker completion, runs `mergeBackParallelGroup` across parallel worktree branches (enforcing `syntaxGateForFiles`), and transitions to `document` (`@tokubetsu-jonin`) or `review` (`@kage`).
- **`reviewNode`** (`src/mcp/langgraph/nodes/review.js`): Executes the Kage Review Gate via `runAislopGate`. Verifies `ai_slop_clean: true`, `ai_slop_findings: 0` (100/100 score), and `confidence >= 98%`.
- **`remediateNode`** (`src/mcp/langgraph/nodes/remediate.js`): Autonomous repair loop (`slop_cycles <= 7`), re-delegating failing slices to the responsible worker subagent.

---

## 🛡️ Real-Time Idle `@advisor` Worker Manager (`<= 1,000 Tokens` / Turn)

Implemented in `src/workflow/kage-reviewer/advisor_monitor.js` and integrated into `konoha.report_from_agent` and SDLC settings:
- **Zero-Token Idle State**: When workers are idle or compliant, `@advisor` returns `status: 'IDLE_OK'` with **`0` output tokens**.
- **Hard 1,000-Token Per-Turn Cap**: Input digests and interrupt directives are clamped via `clampAdvisorBytes` to **`<= 4,000 bytes` (`<= 1,000 tokens`)** per turn with `evict_stale_results: true` (OMP-aligned).
- **5-Point Real-Time Guard**:
  1. `todo_drift`: Worker output deviates from the delegated task slice.
  2. `owned_files_breach` / `worktree_escape`: Worker modifies files outside `owned_files` or outside `worktree_path`.
  3. `fabricated_file` / `conflict_marker`: Claimed file does not exist on disk or contains unresolved git conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`).
  4. `unverified_claim`: Worker claims completion without command/exit-code validation evidence.
  5. `placeholder_slop`: Summary contains placeholder or incomplete stub markers.
- **On-the-Fly Interruption**: When any violation occurs, `report_from_agent` returns `status: 'interrupted_by_advisor'` with a compact `INTERRUPT_CORRECTION` directive so the worker self-corrects immediately.

---

## 🤝 Authoritative Two-Stage HITL Gates & Post-Approval Compaction

1. **Gate 1 (`pending_plan_approval`)**:
   - Prompt choices:
     - `1. Compact and approve`
     - `2. Reject and Regenerate PLAN`
     - `3. Input your own choice`
   - **Automatic Post-Approval Compaction**: Selecting Option 1 automatically invokes `compactPostApprovalContext(taskDir, status)` (`src/mcp/workflow_gates.js`), pruning verbose pre-approval discovery dumps and compacting `plan.md` to actionable steps before Phase 2 starts.
2. **Gate 2 (`pending_human_signoff`)**:
   - Prompt choices:
     - `1. Compact and approve`
     - `2. Remediation`
     - `3. Input your own choice`
