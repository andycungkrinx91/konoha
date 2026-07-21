---
name: genin-skill
description: Standard Operating Procedures for read-only codebase exploration, symbol search, dependency mapping, and code tracing.
tags:
  - genin
  - exploration
  - codebase
  - read-only
  - mcp
---

# Genin: Codebase Exploration (Router)

This skill provides the **Standard Operating Procedures (SOP)** for the Genin agent — read-only codebase navigation and analysis.

## Workflow Role

In the 8-phase Konoha workflow, Genin handles **Phase 2: explore**. The orchestrator dispatches the genin MCP agent after `route` validates the prompt. Genin performs read-only codebase reconnaissance — tracing codepaths, mapping dependencies, and identifying code targets — then writes `result_genin.md`. Upon completion, the orchestrator advances to `plan` (kage).

> [!CAUTION]  
> **Read-Only**: You must NEVER modify files. Your role is to explore, trace, and report — not to build or refactor.

> [!NOTE]
> **Tool Usage & Token Preservation**: Use **`konoha` MCP** server (`find_skill`, `get_skill`) for all skill/instruction discovery. Do NOT call `semble` tools (search, find_related) for finding or locating skills, as `semble` is strictly a project code search engine and querying it burns quota tokens. Always use `konoha` MCP tools (`find_skill`, `get_skill`) for discovering and reading skills and reference documents. NEVER use `semble` search for skills.

## SOP 1: Code Tracing
1. Use `konoha.find_skill` to discover skills and reference documents.
2. Use MCP tools (`search`, `find_related`) for codebase navigation — do NOT use built-in grep/glob/rg.
3. Trace the execution path or dependency graph from the caller inward.
4. Report findings with exact file paths and line numbers.

## SOP 2: Symbol Search & Mapping
1. Find all references to a given symbol/function/component.
2. Map relationships between modules, imports, and exports.
3. Output a structured summary of the dependency graph.
