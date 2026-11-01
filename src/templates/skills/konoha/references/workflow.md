# 🍃 Konoha LangGraph.js Production StateGraph Workflow (v2.2.17)

Technical specification and operational guide for the LangGraph.js cyclic StateGraph orchestration engine, per-turn token budget governor, and circuit breaker error edges.

---

## 🏗️ StateGraph Architecture Overview

In Konoha v2.2.17, all multi-step engineering tasks run on a compiled, cyclic LangGraph.js StateGraph (`src/mcp/langgraph/index.js`) with persistent SQLite checkpoints via `KonohaCheckpointSaver`. The legacy procedural engine (`runMcpWorkflow`) serves as a fail-closed fallback.

### Dual-Track Execution Model
1. **Branch B (Fast-Track / Website Builds)**: Direct request intent (UI builds, `build_from_text`, `build_from_source`, slash shortcuts `/jonin`) bypasses multi-stage state transitions and dispatches directly to `@jonin` with Taste-Skill directives.
2. **Branch A (Standard SDLC Pipeline)**: Complete software engineering workflows traverse the full cyclic StateGraph under Kage governance.

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
        [Gate 1: pending_plan_approval] ◄─── HITL Gate
                      │
               ┌──────▼───────┐
               │  briefNode   │
               └──────┬───────┘
                      │
               ┌──────▼───────┐
               │   todoNode   │
               └──────┬───────┘
                      │
        ┌─────────────┴─────────────┐
        │                           │
 ┌──────▼───────┐            ┌──────▼───────┐
 │ dispatchNode │ ◄───────── │ remediateNode│ (slop_cycles <= 7)
 └──────┬───────┘            └──────▲───────┘
        │                           │
 ┌──────▼───────┐                   │ (remediate)
 │ executeNode  │                   │
 └──────┬───────┘                   │
        │                           │
        ▼ (all tasks complete & no report)
   [status.phase = 'document', assigned = 'tokubetsu-jonin']
        │                           │
 ┌──────▼───────┐                   │
 │ reviewNode   │ ──────────────────┘
 └──────┬───────┘ (pass)
        │
  [Gate 2: pending_human_signoff] (or auto_signoff: true)
        │
 ┌──────▼───────┐
 │ completeNode │ ──► __end__
 └──────────────┘
```

### Node Responsibilities
- **`classifyNode`** (`src/mcp/langgraph/nodes/classify.js`): Evaluates prompt intent (`'fast_track'`, `'pentest'`, `'full_sdlc'`), derives deterministic 12-char `flowHash`, and measures turn token delta.
- **`planNode`** (`src/mcp/langgraph/nodes/plan.js`): Generates implementation blueprint (`plan.md`) via Kage. Blocks execution for **HITL Gate 1** (`pending_plan_approval`).
- **`briefNode`** (`src/mcp/langgraph/nodes/brief.js`): Synthesizes task objectives and architectural constraints.
- **`todoNode`** (`src/mcp/langgraph/nodes/todo.js`): Decomposes work into structured task slices with assigned specialist roles.
- **`dispatchNode`** (`src/mcp/langgraph/nodes/dispatch.js`): Assembles the lazy dispatch payload for the active subagent:
  - `skills`: Routed skills array.
  - `skill_directive`: FTS5 RAG retrieval directive.
  - `tool_block`: Client-specific subagent MCP tool permissions (`buildSubagentMcpBlock`).
  - `turn_budget`: Active turn token ceiling (8192 default).
  - `todo`: Current task slice.
- **`executeNode`** (`src/mcp/langgraph/nodes/execute.js`): Tracks task execution. When all tasks complete without a report, transitions `status.phase = 'document'` and assigns `@tokubetsu-jonin`.
- **`reviewNode`** (`src/mcp/langgraph/nodes/review.js`): Actively executes the Kage Review Gate via `runAislopGate`. Verifies `ai_slop_clean: true`, `ai_slop_findings: 0`, and `confidence >= 98%`.
- **`remediateNode`** (`src/mcp/langgraph/nodes/remediate.js`): Autonomous repair loop. Increments `slop_cycles` (circuit breaker ceiling $\le 7$). Re-delegates failing code slices to `@anbu` or `@jonin`.
- **`node_error`** (`src/mcp/langgraph/nodes/error.js`): Catches circuit breaker trips and uncaught node exceptions, routing to `__end__` with structured diagnostics.

---

## ⚡ Per-Turn Token Budget Governor

Konoha v2.2.17 replaces cumulative thread limits with a **strict per-turn token budget governor**:
- **Turn Scope**: Budget evaluates tokens consumed *within the current execution turn only*. `tokensUsed` remains cumulative for thread reporting, while `turnTokensUsed` resets at the beginning of each invoke.
- **Default Budget**: `8,192` tokens per turn.
- **Allowed Ceilings**: `{8192, 16384, 32768, 65536}`.
- **Resolution Precedence**: Explicit `token_budget` MCP argument > `options.turnBudget` > `process.env.KONOHA_TURN_BUDGET` > 8192 default.
- **Clamping Invariant**: Values not matching allowed ceilings are clamped **UP** to the nearest ceiling (fail-safe, never silently shrinks budget).
- **Halt & Resume**: When usage exceeds the turn ceiling, the graph routes to `node_budget_exceeded` and halts. Passing a higher ceiling (e.g. 16384 or 32768) in `sanninWorkflowNext` resumes execution cleanly from checkpoint.

---

## 🛡️ Circuit Breaker Error Edge (`node_error`)

- **Guarded Nodes**: Every node function added to `StateGraph` is wrapped via `guarded(name, fn)` in `src/mcp/langgraph/node_guard.js`.
- **Failure Recording**: Uncaught errors invoke `globalCircuitRegistry.getOrCreate('workflow').recordFailure()`.
- **Edge Routing**: Nodes return `{ error, circuitOpen, circuitState }` on failure, routing via conditional edge directly to `node_error` and `__end__`.
- **Fast-Fail on OPEN**: When the circuit breaker trips to `OPEN`, `guarded` fast-fails immediately without running the faulty node, protecting LLM context and downstream services.

---

## 🤝 Authoritative Two-Stage HITL Gates

1. **Gate 1 (`pending_plan_approval`)**:
   - Triggers immediately after `planNode` creates `plan.md`.
   - Prompt choices:
     `1. Compact and approve`
     `2. Reject and Regenerate PLAN`
2. **Gate 2 (`pending_human_signoff`)**:
   - Triggers after Kage review passes and Tokubetsu-Jonin finishes documentation.
   - Prompt choices:
     `1. Compact and approve`
     `2. Remediation`
   - **Optional Auto-Signoff**: When `auto_signoff: true` is passed (via MCP `sannin` tool or workflow options), Gate 2 HITL prompting is skipped if Kage review passes cleanly, immediately completing the workflow.
