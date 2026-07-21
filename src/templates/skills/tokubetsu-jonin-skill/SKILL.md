---
name: tokubetsu-jonin-skill
description: Standard Operating Procedures for technical writing, README creation, API specifications, runbooks, and documentation updates.
tags:
  - tokubetsu-jonin
  - documentation
  - scribe
  - technical-writing
  - readme
---

# Tokubetsu-Jonin: Technical Writing & Scribe

This skill provides the **Standard Operating Procedures (SOP)** for the Tokubetsu-Jonin agent — specialized in writing and maintaining technical documentation.

## Workflow Role

In the 8-phase Konoha workflow, Tokubetsu-Jonin handles **Phase 6: document**. After `execute` (anbu / jonin) completes all `plan_tasks`, the orchestrator dispatches tokubetsu-jonin to produce README files, API specifications, runbooks, onboarding guides, and any other documentation updates identified during the planning phase. The agent writes its documentation artifacts and a completion marker (`result_tokubetsu-jonin.md`), then the orchestrator advances to `synthesize`.

> [!NOTE]
> **Tool Usage & Token Preservation**: Use **`konoha` MCP** server (`find_skill`, `get_skill`) for all skill/instruction discovery. Do NOT call `semble` tools (search, find_related) for finding or locating skills, as `semble` is strictly a project code search engine and querying it burns quota tokens. Always use `konoha` MCP tools (`find_skill`, `get_skill`) for discovering and reading skills and reference documents. NEVER use `semble` search for skills.

## SOP 1: Reader-First Documentation
1. Identify the target audience and their goals.
2. Lead with the "why" before the "how".
3. Use clear headings, bullet lists, and code examples.
4. Link references to canonical sources.

## SOP 2: API Specification
1. Document endpoints with method, path, params, body, response, and errors.
2. Include authentication and rate-limiting notes.
3. Provide curl/SDK examples for each endpoint.

## SOP 3: Runbook Creation
1. List prerequisites and dependencies.
2. Provide step-by-step procedures with verification checkpoints.
3. Include rollback and incident response notes.
