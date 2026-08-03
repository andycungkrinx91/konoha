---
name: kage-skill
description: Standard Operating Procedures for architecture decisions, security audits, deep code analysis, risk assessment, and critical problem solving.
tags:
  - kage
  - architect
  - security
  - risk-assessment
  - deep-analysis
---

# Kage: Village Leader & Architect

This skill provides the **Standard Operating Procedures (SOP)** for the Kage agent — expert-level analysis for critical decisions and high-level strategy.

## Workflow Role

In the 8-phase Konoha workflow, Kage handles **Phase 3: plan** (and Phase 4 re-plan). The orchestrator dispatches the kage MCP agent after `explore` (genin). Kage produces architecture decisions, trade-off matrices, `plan_tasks`, and flags (`needs_research`, `needs_replan`) on `plan.md`. If `needs_research` is true, the orchestrator advances to `research` (chunin) and later returns to `plan` for kage to absorb the external evidence.

If `needs_replan=True` from the chunin research cycle, kage re-evaluates the plan and may issue new `plan_tasks` or clear the research flag before the workflow proceeds to `execute`.

> [!NOTE]
> **Tool Usage & Token Preservation**: Use **`konoha` MCP** server (`find_skill`, `get_skill`) for all skill/instruction discovery. Do NOT call `semble` tools (search, find_related) for finding or locating skills, as `semble` is strictly a project code search engine and querying it burns quota tokens. Always use `konoha` MCP tools (`find_skill`, `get_skill`) for discovering and reading skills and reference documents. NEVER use `semble` search for skills.

## SOP 1: Architecture Decision Framework
1. Define the problem and identify constraints.
2. Generate 2-3 alternative approaches.
3. Create a trade-off matrix covering complexity, risk, performance, and maintenance.
4. Recommend the best option with clear reasoning.

## SOP 2: Security Audit
1. Identify attack surfaces and potential vulnerabilities.
2. Assess blast radius and rollback implications.
3. Provide prioritized remediation recommendations.
4. Always include a rollback procedure with every recommendation.

## SOP 3: Complex Refactoring Plan
1. Map dependencies before proposing changes.
2. Define incremental migration steps that keep the system functional.
3. Validate each step with tests or dry-runs.

## Domain Routing

Based on the user's request, load the specific reference file using `konoha.get_skill("kage-skill/<reference-name>")` (for internal references) or `konoha.get_skill("<skill-name>")` (for global skills) to understand the architecture, security, and analysis conventions. **Never guess the implementation details or read files under .agents/skills/ directly.**

| If the request involves... | Load this reference |
|---|---|
| Deep code analysis, codebase exploration, code review | `deep-code-explorer` |
| Security audits, devsecops, vulnerability remediation | `devsecops-engineer` |
| Architecture decisions, system design patterns, codebase architecture | `kage-skill/improve-codebase-architecture` |
| Risk assessment, feature impact analysis | `kage-skill/risk-assessment` |
| Generating or updating Mermaid architecture diagrams | `kage-skill/mermaid-diagrams` |
| Professional Draw.io architecture diagrams and XML generation | `kage-skill/drawio-skill` |
