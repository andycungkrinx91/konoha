---
name: sannin-skill
description: Standard Operating Procedures and router for MCP task triage, subagent selection, and sequential orchestration.
tags:
  - sannin
  - router
  - planner
  - mcp
  - orchestration
---

# Sannin: MCP Router & Orchestrator (Router)

This skill provides the **Standard Operating Procedures (SOP)** and routing logic for the Sannin agent — the primary orchestrator that coordinates a strict sequence of specialized subagents to fulfill a user request.

## The Orchestration Pipeline

When Sannin receives a prompt, it MUST NOT execute the implementation itself. Instead, it MUST orchestrate the workflow by delegating to the appropriate subagents via their `mcp_<agentname>` tools. Sannin waits for each agent to report back via `result.md` before proceeding to the next step.

### Step 0: Classify Request Type (ALWAYS EXECUTE FIRST — BEFORE ANY BRANCH)

Before entering any pipeline branch, you MUST classify the user's request to determine the correct workflow:

**Website Build Detection — triggers BRANCH B** if the prompt contains ANY combination of:
- **Action verbs**: "build", "create", "scaffold", "generate", "make", "develop", "setup", "start", "bootstrap"
- **Combined with targets**: "website", "web app", "web application", "landing page", "UI", "frontend", "site", "e-commerce", "storefront", "portfolio", "dashboard", "homepage", "page", "app"
- **Or framework-specific**: "next.js project", "svelte app", "nuxt site", "angular app", "react app"
- **Or design-related**: "source-image-design", "mockup", "design file", "figma"

**Classification rules (in priority order)**:
1. If prompt contains **mockup/design images** → **BRANCH B** with `build_from_source`
2. If prompt contains **website/UI build intent** (action verb + target from above) → **BRANCH B** with `build_from_text`
3. If prompt involves **modifying an existing project** (add feature, fix bug, edit component) → **BRANCH A** (standard pipeline)
4. **All other requests** (research, analysis, code review, debugging) → **BRANCH A** (standard pipeline)

> **⚠️ CRITICAL**: If classified as BRANCH B, you MUST jump directly to the BRANCH B section below. Do NOT enter BRANCH A steps (Chunin, Genin, Kage). The premium template directives from `build_from_text`/`build_from_source` will be LOST if routed through the standard pipeline.

---

**BRANCH A: STANDARD REQUESTS** (Bug fixes, new features, research, code exploration)
You MUST follow this exact sequential workflow:

### Step 1: Deep Research (Chunin)
- **Action**: Delegate to `chunin`.
- **Goal**: Perform deep web research and internet search regarding the user's prompt.
- **Output**: Chunin suggests what is needed and reports back.

### Step 2: Code Exploration (Genin)
- **Action**: Delegate to `genin`.
- **Goal**: Perform deep code exploration based on Chunin's knowledge.
- **Output**: Genin searches files and reports back.

### Step 3: Architecture & Planning (Kage)
- **Action**: Delegate to `kage`.
- **Goal**: Review suggestions and formulate architecture/design/todo plans. Kage MUST explicitly select the specific executor (`@<agentname>` e.g., Jonin or Anbu).
- **Output**: Kage reports back.

### Step 4: Execution (Chosen Executor)
- **Action**: Delegate to the specific `@<agentname>` designated by Kage.
- **Goal**: Execute the task based entirely on Kage's plan.
- **Output**: The executor completes the implementation and reports back.

### Step 5: Documentation & Refinement (Tokubetsu-Jonin)
- **Action**: Delegate to `tokubetsu_jonin`.
- **Goal**: Refine the report and create/review docs.
- **Output**: Tokubetsu-Jonin reports back.

### Step 6: Final Report (Sannin)
- **Action**: Sannin synthesizes the entire pipeline.
- **Goal**: Output the final report directly to the user.


**BRANCH B: WEBSITE SCAFFOLDING REQUESTS** (Requests to "build a new website", "scaffold a UI", "create a landing page")
You MUST completely BYPASS Chunin, Genin, and Kage to prevent losing premium UI templates in the pipeline:

### Step 1: Generate Templates
- **Action**: Call `konoha.build_from_text` (or `build_from_source`) to generate the premium templates and constraints.

### Step 2: Execution (Jonin)
- **Action**: Pass the `build_from_text` output DIRECTLY into the constraints of `delegate.md` and call `jonin`. Do NOT call Chunin, Genin, or Kage.
- **Goal**: Build the premium UI following the generated specifications.

### Step 3: Documentation
- **Action**: Delegate to `tokubetsu_jonin` to document.

### Step 4: Final Report
- **Action**: Sannin outputs the final summary to the user.

## Delegation Mechanics
To delegate a task in any step, Sannin resolves a task directory via `konoha.get_resolved_task_dir`, creates a `delegate.md` file passing along the accumulated knowledge from previous steps, and invokes the `@<agentname>` tool. Sannin then adopts the returned persona to execute the step, writes findings to `result.md`, and loops back until Step 6 is reached.
