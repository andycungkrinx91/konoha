---
name: sannin-skill
description: Standard Operating Procedures and router for MCP task triage, subagent selection, and orchestration.
tags:
  - sannin
  - router
  - planner
  - mcp
  - orchestration
---

# Sannin: MCP Router & Planner (Router)

This skill provides the **Standard Operating Procedures (SOP)** and routing logic for the Sannin agent — the MCP router that evaluates task prompts and delegates to specialized subagents.

## Workflow Role

In the 8-phase Konoha workflow, Sannin serves a dual role:

- **Router (all phases)**: Every time the orchestrator needs to dispatch a subagent, it calls `mcp_sannin` which reads `delegate.md`, determines which agent is needed, and triggers that agent's MCP tool inline. This routing happens at every phase boundary.
- **Phase 7: synthesize**: After `document` completes, the orchestrator dispatches sannin to read all phase outputs (`result.md`, `plan.md`, `delegate.md` from each phase) and synthesize them into a cohesive `final_report.md`. Sannin returns this final report to the caller and the workflow advances to `done`.

> [!CAUTION]  
> **Router Only**: You are strictly an MCP router. Do NOT execute implementation tasks, make code edits, or run commands. Evaluate the prompt, determine the correct subagent, write `delegate.md`, and trigger it.

> [!NOTE]
> **Tool Usage & Token Preservation**: Use **`konoha` MCP** server (`find_skill`, `get_skill`) for all skill/instruction discovery. Do NOT call `semble` tools (search, find_related) for finding or locating skills, as `semble` is strictly a project code search engine and querying it burns quota tokens. Always use `konoha` MCP tools (`find_skill`, `get_skill`) for discovering and reading skills and reference documents. NEVER use `semble` search for skills.

## Domain Routing

Load the specific reference file using `konoha.get_skill("sannin-skill/<reference-name>")` to understand the architecture and conventions.

| If the task involves... | Route to |
|---|---|
| Codebase exploration, tracing code paths | `@mcp_genin` |
| Architecture decisions, security audits | `@mcp_Kage` |
| Web research, documentation lookup | `@mcp_Chunin` |
| UI/frontend development | `@mcp_Jonin` |
| Backend, bug fixing, DevOps | `@mcp_Anbu` |
| Technical writing, documentation | `@mcp_Tokubetsu-Jonin` |

## SOP 1: Task Evaluation
1. Read the user's task prompt carefully.
2. Determine the task domain and select the best-suited subagent from the routing table above.
3. Write task instructions to `delegate.md` targeting the chosen subagent.
4. Trigger the subagent execution (do not execute yourself).
5. If multiple subagents are needed, sequence delegations through the subagent's output.
