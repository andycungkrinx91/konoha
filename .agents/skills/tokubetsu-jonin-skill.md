---
name: tokubetsu-jonin-skill
description: Standard Operating Procedures for writing enterprise-grade technical documentation, APIs, and Runbooks.
tags:
  - tokubetsu-jonin
  - documentation
  - readme
  - api
  - runbook
---

# Tokubetsu-Jonin: Technical Scribe (SOP)

This skill provides the **Standard Operating Procedures (SOP)** for the Tokubetsu-Jonin (Scribe) when tasked with generating system documentation, README files, API specifications, or operational runbooks.

> [!NOTE]  
> **Reader-First Principle**: Documentation is useless if it's too dense. Use Mermaid diagrams, markdown tables, code blocks, and clear hierarchical headings. Never write a wall of text.

> [!NOTE]
> **Token Hygiene & Skill Discovery**: Use the **skills-db MCP** server (`find_skill`, `get_skill`) for all skill discovery and lookup. Do NOT call `semble` tools (search, find_related) for finding or locating skills, as `semble` is strictly a project code search engine and querying it for skills burns quota tokens. Always use `skills-db` MCP tools (`find_skill`, `get_skill`) for discovering and reading skills and reference documents. NEVER use `semble` search for skills.

## SOP 1: The Enterprise README
*When tasked with writing or updating a project's `README.md`.*

Every standard README must include:
1. **Title & Badges**: Project name, brief 1-line description, and relevant badges (CI status, version, license).
2. **Architecture**: A `mermaid` diagram mapping the high-level system (e.g., C4 model or basic Graph TB).
3. **Quick Start / Setup**: Exact, copy-pasteable commands to get the system running locally.
4. **Environment Variables**: A table listing required `.env` variables, their purpose, and default values.
5. **Key Commands**: A table of Makefile or NPM scripts (e.g., test, build, deploy).

## SOP 2: API Specification Writing
*When documenting a REST, GraphQL, or gRPC endpoint.*

For every endpoint, you must define:
1. **Endpoint Name & Method**: e.g., `POST /api/v1/users`
2. **Purpose**: 1-2 sentences on what the endpoint achieves.
3. **Authentication**: Required headers (e.g., `Authorization: Bearer <token>`).
4. **Request Body**: A JSON code block showing the expected payload.
5. **Response Body**: A JSON code block showing a successful `200 OK` payload.
6. **Error States**: A markdown table listing possible HTTP status codes (`400`, `401`, `404`, `500`) and the specific JSON error format returned.

## SOP 3: Incident Runbooks
*When writing a guide on how to fix a specific operational failure.*

1. **Trigger Condition**: What alert, log message, or symptom means this runbook applies?
2. **Diagnosis Steps**: 1-3 bash/kubectl commands to verify the exact failure state.
3. **Remediation Steps**: Copy-pasteable commands to resolve the issue (e.g., clearing cache, restarting pods, rolling back a deployment).
4. **Escalation**: Who to contact if the remediation fails.
