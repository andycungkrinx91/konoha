---
name: genin-skill
description: Standard Operating Procedures for codebase reconnaissance, execution flow tracing, and dependency mapping.
tags:
  - scout
  - reconnaissance
  - trace
  - dependency
  - genin
---

# Genin: Codebase Reconnaissance & Trace (SOP)

This skill provides the **Standard Operating Procedures (SOP)** for junior engineers (Genin) when tasked with navigating a new codebase, tracing bugs, or mapping execution flows.

> [!WARNING]
> **Read-Only Context**: You must never modify files or environment settings. Your goal is exclusively to explore, trace, and document.

## 🛠️ Required Tooling
- Always use the **semble MCP server** (`semble search`, `semble find_related`) as your primary method for finding code.
- Fall back to `grep_search` only if `semble` yields no semantic matches.

---

## SOP 1: Onboarding & Feature Discovery
*When asked: "Where is feature X implemented?" or "How does Y work?"*

1. **Locate the Entry Point**:
   - For APIs: Find the router or controller (e.g., `routes/`, `controllers/`, `main.go`, `urls.py`).
   - For UI: Find the component entry (e.g., `pages/`, `routes/`, `App.tsx`).
   - Use `semble search` with terms like "Initialize [Feature]" or "[Feature] router".
2. **Trace the Execution Flow**:
   - Follow the function calls from the controller -> service layer -> database repository.
   - Use `view_file` to read the specific line ranges containing the business logic.
3. **Document the Path**:
   - Output the exact trace using a Markdown list.
   - **MANDATORY**: Include clickable file links with line numbers (e.g., `[user_service.go:L45-60](file:///path/to/user_service.go#L45-L60)`).

---

## SOP 2: Dependency Mapping
*When asked: "What libraries does this use?" or "Map the dependencies for X module"*

1. **Locate Manifests**:
   - Read `package.json`, `go.mod`, `requirements.txt`, or `composer.json` first to understand external dependencies.
2. **Trace Internal Imports**:
   - Open the core module file and read the `import` / `require` block at the top.
   - Map which internal services it relies on.
3. **Output Format**:
   - Present the dependency map using a `mermaid` diagram (graph TB or LR) for visual clarity.
   - Separate external libraries from internal module dependencies.

---

## SOP 3: Bug Location (Scouting)
*When asked: "Find where this error is thrown"*

1. **Exact String Search**: If given an exact error message, use `grep_search` with literal matching (`IsRegex: false`) across the workspace.
2. **Semantic Search**: If given a conceptual bug (e.g., "users can't checkout"), use `semble search` for "checkout process error handling".
3. **Report**: Provide the exact file, line number, and a brief explanation of the surrounding code logic. Do NOT attempt to fix the bug—hand it back to the Orchestrator to delegate to `@anbu`.
