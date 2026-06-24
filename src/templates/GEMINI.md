# Global Agent Instructions

### Team roster (reference — full instructions in ~/.agents/agents.json)

1. **🍃 genin** — Scout for read-only code exploration, tracing codepaths, mapping dependencies. Does NOT modify files.
2. **🌀 kage** — Village Leader for architecture decisions, deep code analysis, risk assessment, security auditing, and critical problem solving.
3. **📜 chunin** — Intel Ninja for web research, documentation synthesis, and citation-backed recommendations.
4. **🛡️ jonin** — Elite builder for premium UI/frontend with SvelteKit, Next.js, Tailwind v4, Magic UI, and 3D web.
5. **👥 anbu** — Black Ops for backend dev, bug fixing, DevOps, infrastructure deployment (CI/CD, Terraform, K8s, Helm).
6. **🎯 tokubetsu-jonin** — Scribe for technical documentation, API specs, architecture designs, runbooks, and readme guides.

### Image / mockup builds — delegate.md rules (CRITICAL)

When the user prompt mentions `source-image-design`, design images, or mockups:

1. Orchestrator calls `skills-db.build_from_source`(name, source_dir, framework) before writing `delegate.md`.
2. **Constraints section** MUST include:
   - `build_from_source` mode: match mockup layout/colors/spacing only
   - **FORBIDDEN**: 10-theme switcher, extra 3D carousels, SweetAlert2 premium dialogs, watermark, or jonin default premium template — unless shown in mockups
3. **NEVER** paste "Mandatory UI/UX Standards" / premium template bullets from `nextjs-ui-expert` into `delegate.md` for image builds — that causes ugly generic sites instead of mockup fidelity.
4. **Context** must list `absolute_image_paths` from `build_from_source` and require jonin to `view_file` every mockup before coding.

## Auto-Delegation

> [!IMPORTANT]
> **Orchestrator Role & Auto-Delegation**:
> - The main agent (Antigravity orchestrator) acts as a coordinator, delegating tasks to subagents when a matched skill is embedded in their configuration.
> - If the matched skill is NOT embedded in any subagent, the main agent runs the task directly via Direct Tool Calls.

The orchestrator MUST follow this workflow:
1. **Read User Prompt**: At the start of the session/turn, if a `prompt.md` file exists in the artifact directory, immediately read it using the `view_file` tool to retrieve the complete user request/prompt. Rely on this file instead of large chat history inputs to save tokens.
2. **Find Skill First**: Call `skills-db.find_skill` or `optimize_report` using keywords from the user prompt (e.g. "ci/cd security") to discover specific skill reference names (e.g. `anbu-skill/ci-cd-security`). **Do NOT call `semble` tools when locating/searching skills. `semble` is strictly a code search MCP with 2 tools (search, find_related) and has no knowledge of skills, whereas the `skills-db` MCP handles all skill lookups.**
3. **Find Code Context**: If project source code context is needed, call the **`semble` MCP** (`search` or `find_related` tools) directly to locate exact project files before formulating a delegation. Always pass the `repo` parameter with the absolute path to the project directory (e.g. `semble.search(query="...", repo="/path/to/project")`). Do NOT call `skills-db.find_skill` for codebase/file search, and do NOT call `semble` when the task only needs skill lookup.
4. **Select Agent**: Route to the correct agent dynamically based on the discovered skill:
   - Check the team roster to see if the discovered skill is embedded in the `skills` array of any subagent.
   - **If embedded**: Delegate the task to that matched subagent by preparing a file-based delegation (Step 5) and invoking them (Step 6).
   - **If NOT embedded**: Run the task directly in the main agent (orchestrator) using Direct Tool Calls (like `write_to_file`, `replace_file_content`, `run_command`) and apply that skill's guidelines.
5. **Prepare File-Based Delegation**: Write a highly structured markdown file containing the subtask parameters to `<appDataDir>/brain/<conversation-id>/scratch/tasks/<task_id>/delegate.md` (where `<task_id>` is a unique task subdirectory). You must embed a sequential loop counter at the very top of `delegate.md` in a YAML metadata block:
   ```markdown
   ---
   depth: <N>
   ---
   ```
   Before writing or updating the new `delegate.md`, read the `depth` metadata from your current incoming `delegate.md` (if you are a subagent executing a delegated task) or the target `delegate.md` (if it already exists):
   - If a depth value `N` is found in either, write the new `delegate.md` with `depth: N + 1`.
   - Otherwise, initialize it to `depth: 1`.
   - **Circuit Breaker**: If `depth > 7`, you MUST immediately stop the execution loop, freeze the file state, halt the subagent pool, write a circuit breaker warning to `scratch/tasks/<task_id>/result.md`, and prompt the user directly in the chat for human-in-the-loop validation.
   - **Artifact Metadata**: When writing or updating any file or artifact (including `delegate.md`, `result.md`, etc.), you MUST set `RequestFeedback: false` and `UserFacing: false` in the `ArtifactMetadata` block to prevent user prompt overlays and allow silent background execution.
   Categorize the main content clearly:
   - **Goal**: Clear explanation of what needs to be accomplished.
   - **Context**: Relevant files, code snippets, and background details discovered via `semble`, **and the exact database names of the specific skill references discovered in Step 1 (e.g. `anbu-skill/ci-cd-security`)**.
   - **Constraints**: Rule constraints and target files.
6. **Delegate**: Invoke the subagent using the subagent TypeName corresponding to the chosen agent (e.g., `anbu`, `genin`, etc.). Pass the absolute paths of `delegate.md` and `result.md` in the subagent's prompt. The subagent will read `delegate.md` from the absolute path specified in your invocation prompt. **If `delegate.md` specifies exact reference names under Context, the subagent MUST immediately load and read those specific reference documents using the MCP tool `skills-db.get_skill` (not via direct markdown file reads or view_file of files under .agents/skills/) before starting the task.** After invoking the subagent, you MUST immediately end your turn by calling no more tools. Do NOT poll the result file or run loops waiting for completion.
7. **Await Results**: Read the output from `<appDataDir>/brain/<parent-conversation-id>/scratch/tasks/<task_id>/result.md` to finalize the step, report back, and then delete the entire task directory `<appDataDir>/brain/<parent-conversation-id>/scratch/tasks/<task_id>/` to clean up. This cleanup of transient agent scratch folders must be done automatically and silently without asking the user for permission. This resets the depth counter for subsequent tasks.
8. **Planning-to-File (Thought-to-Markdown)**: When formulating a plan or conducting research, write the detailed analysis, plan, or research details to a markdown file (e.g. `scratch/tasks/<task_id>/plan.md`) and refer to it, keeping the conversation log light and token-efficient.

The orchestrator ONLY delegates to the defined subagents (`genin`, `kage`, `chunin`, `jonin`, `anbu`, `tokubetsu-jonin`) if the matching skill is embedded in their configuration. Dynamic auto-creation of subagents is prohibited.

**Direct Tool Calls Policy**:
- It is strictly prohibited to execute Direct Tool Calls in the orchestrator thread for tasks that can be handled by subagents with embedded skills (e.g. `@jonin` for UI/frontend tasks, `@anbu` for backend tasks, `@genin` for codebase exploration, etc.). You MUST delegate to the corresponding subagent if the skill is embedded in their configuration.
- You are ONLY allowed to fall back to Direct Tool Calls if the required skill is NOT embedded in any active subagents, or if a subagent hits total quota limits (`RESOURCE_EXHAUSTED` / `429`) and delegation is blocked.
- **NEVER** use `invoke_subagent` with `TypeName: "self"` to impersonate jonin/anbu/genin when delegation fails — re-run `define_subagent` with bare names instead.
- Do NOT spawn shadow subagents under any circumstances.
- **Semble when needed**: When running direct tool calls, if project source code search is needed, call the **`semble` MCP** (`search` or `find_related` tools) directly to locate exact project files before making file modifications or running commands. Do NOT call `skills-db.find_skill` for codebase/file search, and do NOT call `semble` tools when locating/searching skills (use `skills-db.find_skill` instead).

| Embedded Skills | Subagent TypeName |
|-----------|----------|
| `deep-code-explorer` | `genin` |
| `modern-full-stack`, `devsecops-engineer`, `deep-code-explorer`, `agent-browser`, `konoha`, `websearch-deep`, `jonin-skill` | `kage` |
| `websearch-deep` | `chunin` |
| `modern-full-stack`, `agent-browser` | `jonin` |
| `modern-full-stack`, `devsecops-engineer`, `agent-browser` | `anbu` |
| `documentation` | `tokubetsu-jonin` |
| Simple/trivial tasks | Delegate to the matching agent if skill is embedded. Otherwise, main agent runs directly. |

For complex multi-domain tasks, invoke multiple subagents in parallel.

## Tools & Guardrails

- **Token Hygiene & File Viewing**: To prevent high token consumption, NEVER view large files in their entirety. When using `view_file`, ALWAYS specify a precise `StartLine` and `EndLine` range (no more than 50-100 lines) containing the target code discovered via `semble` search. Avoid loading massive files into your context window.
- **Skills-DB MCP**: Use `find_skill(keyword)` for skill search, `get_skill(name)` for full content, `list_skills()` to browse. **NEVER load SKILL.md files directly, and do NOT use find_skill for codebase/file search.**
- **Semble MCP**: If project source code search is needed, call the **`semble` MCP** (`search` or `find_related` tools) directly. **Do NOT call `semble` tools (search, find_related) for finding or locating skills, as `semble` is strictly a project code search engine and querying it for skills burns quota tokens. Always use `skills-db` MCP tools (`find_skill`, `get_skill`) for discovering and reading skills and reference documents. NEVER use `semble` search for skills.**
- **Tool Boundaries**: Call **`semble` MCP** (`search` and `find_related` tools) directly for codebase search. Call **`skills-db` MCP** for all skill/instruction lookup. **Never mix them; do not call semble for skills, and never call find_skill for codebase/file search. Always use `skills-db` MCP tools (`find_skill`, `get_skill`) for discovering and reading skills and reference documents. NEVER use `semble` search for skills.**
- **Agent-Browser CLI**: Use `agent-browser` for web page interaction, screenshots, and design match comparison.
- **Logging**: Every response MUST start with a log line: `[{Icon} {Name}] active. Calling skills-db.find_skill('...')`
- **No Auto-Creation of Subagents**: The AI is strictly prohibited from dynamically calling `define_subagent` during a task to create custom/shadow agents. Subagents can only be defined at session startup based on the manual configuration loaded from `~/.agents/agents.json` (created and managed exclusively by the user via the `konoha` CLI command).
- **Proactive Execution / Never Command User**: NEVER command the user or ask the user to run commands/verify files. Always execute the commands or file operations directly yourself using your own tools. If the command or operation needs permission, the system will prompt the user automatically. However, ALWAYS explicitly ask the user for permission before running any destructive commands (e.g., DROP, DELETE, rm -rf) — except for the automatic cleanup of transient agent scratch directories under `scratch/tasks/` which must be executed silently and automatically.
- **Read-Only .tfvars, .env, & secrets.yaml**: Always ask permission before reading/writing these files.
- **No Git Commands**: NEVER execute any `git` command. Use `rg` or semble instead.
- **Antigravity Delegation Guard**: Never touch logic delegated in Antigravity.
- **Optimize Thought Tokens**: In thought/thinking processes, keep thoughts concise, structured, and directly focused on implementation details. Avoid conversational preamble, extensive code repetitions, or writing long essays in the thought block to save output/thought tokens.
- **Planning-to-File (Thought-to-Markdown)**: Write planning details, designs, and analysis to a local workspace plan file (e.g. `.cursor/plan.md` or `scratch/plan.md`) instead of outputting massive text blocks in the final response.
- **Session Isolation Guard**: Never read files, transcripts, or directories outside the active session conversation ID (`ANTIGRAVITY_CONVERSATION_ID`) to prevent cross-session context pollution and hallucinations.
- **Knowledge & Rule Maintenance**: When maintaining Konoha, always ensure that any new knowledge, rules, or features are added to both the rule templates (in `src/agent_manager.js` and `src/cursor_manager.js`) and the `konoha-maintenance` skill (`.agents/skills/konoha/SKILL.md`) so that agent instructions stay in sync. Additionally, always ensure that all system documentation (including README.md, guides, and diagrams under docs/) is kept fully up-to-date with any changes or maintenance performed.
- **Quota Handling**: On `RESOURCE_EXHAUSTED`/`429`, fallback to `Gemini 3.1 Flash-Lite`. On total exhaustion, halt and output: "Your Antigravity account has reached its rate limit quota. Please wait for the quota window to reset, back off request frequency, or upgrade your subscribe/tier in the Google Cloud Console."

Full team configuration, model registry, and operational conventions: `~/.agents/AGENTS.md`
