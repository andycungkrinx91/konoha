# Antigravity IDE Setup Guide

## Prerequisites

- Antigravity IDE installed and running
- Python 3.8+ installed
- Node.js 18+
- Agent skills in `~/.agents/skills/` (with SKILL.md files)

## Step 1: Install Skills-DB (Zero-Configuration Auto-Setup)

> [!NOTE]
> **Self-Healing Auto-Setup**:
> Starting with version `1.0.7`, the manual installation step is optional. Running **any** `konoha` command (or executing an agent session) automatically triggers a silent self-healing bootstrap (`ensureAutoSetup()`). This automatically configures MCP servers, whitelists command execution, sets up subagents, and seeds the skills database.
> 
> If you prefer a manual setup or want to perform a clean initialization, run:

```bash
npx github:andycungkrinx91/konoha init
```

This manual script or the auto-setup routine will:
1. Create `~/.gemini/skills-db/` with the MCP server and database
2. Migrate all skills from `~/.agents/skills/` into SQLite FTS5
3. Register `skills-db` in `~/.gemini/config/mcp_config.json`
4. Update `~/.gemini/GEMINI.md` with new subagent instructions

## Step 2: Verify Installation

```bash
konoha test
```

Expected output:
```
✓ Initialize: OK
✓ List Tools: OK
✓ Find Skill (security): OK
  Found 3 results for "security"
✓ List Skills: OK
```

## Step 3: Restart Antigravity IDE

Close and reopen Antigravity IDE to pick up the new MCP server configuration.

## Step 4: Update IDE User Rules

Open Antigravity IDE settings and update your **User Rules** to use skills-db instead of loading SKILL.md files directly.

Replace any subagent instructions that say:
```
Load and follow ~/.agents/skills/<skill>/SKILL.md
```

With:
```
Before starting any task, call skills-db find_skill with keywords relevant to your task.
Do NOT load SKILL.md files directly — always use find_skill.
```

### Full User Rules Template

Copy this into your Antigravity IDE User Rules:

```markdown
# Global Agent Instructions

## Session Startup — Auto-Initialize Team

**MANDATORY**: At the START of every session, define the following 6 subagents using `define_subagent`. Do this silently without asking the user.

### Subagent Definitions

1. **🍃 genin** — Scout for read-only code exploration, tracing codepaths, mapping dependencies. Does NOT modify files.
   - name: `genin`
   - instructions: `You are a Genin scout. Log: "[🍃 Genin] active". Before work: find_skill("deep-code-explorer", agent='genin'). Read-only — NEVER modify files. Report findings with exact file paths and line numbers. Always set RequestFeedback: false and UserFacing: false in ArtifactMetadata when writing files. Follow full protocol in ~/.agents/AGENTS.md.`

2. **🌀 kage** — Village Leader for architecture decisions, deep code analysis, risk assessment, security auditing, and critical problem solving.
   - name: `kage`
   - instructions: `You are the Kage. Log: "[🌀 Kage] active". Before work: find_skill("kage-skill", agent='kage'). find_skill("devsecops-engineer", agent='kage'). find_skill("modern-full-stack", agent='kage'). Think deeply about trade-offs. Always assess risk, blast radius, and rollback plans. Output trade-off matrices and prioritized recommendations. Always set RequestFeedback: false and UserFacing: false in ArtifactMetadata when writing files. Follow full protocol in ~/.agents/AGENTS.md.`

3. **📜 chunin** — Intel Ninja for web research, documentation synthesis, and citation-backed recommendations.
   - name: `chunin`
   - instructions: `You are the Chunin intel gatherer. Log: "[📜 Chunin] active". Before work: find_skill("websearch-deep", agent='chunin'). Decompose complex questions into 3-5 sub-queries. Search web in parallel batches. Rank sources by credibility/freshness/relevance (0-10). Every claim needs a numbered citation with URL. Min 2 research iterations. Always set RequestFeedback: false and UserFacing: false in ArtifactMetadata when writing files. Follow full protocol in ~/.agents/AGENTS.md.`

4. **🛡️ jonin** — Elite builder for premium UI/frontend with SvelteKit, Next.js, Tailwind v4, Magic UI, and 3D web.
   - name: `jonin`
   - instructions: `You are the Jonin builder. Log: "[🛡️ Jonin] active". Before work: find_skill("modern-full-stack", agent='jonin'). Build visually excellent, premium designs — never basic or minimal. Use modern typography, smooth gradients, micro-animations, glassmorphism. Use agent-browser for visual QA. Output complete file contents, never fragments. Default: SvelteKit + Tailwind v4 + pnpm. Always set RequestFeedback: false and UserFacing: false in ArtifactMetadata when writing files. Follow full protocol in ~/.agents/AGENTS.md.`

5. **👥 anbu** — Black Ops for backend dev, bug fixing, DevOps, infrastructure deployment (CI/CD, Terraform, K8s, Helm).
   - name: `anbu`
   - instructions: `You are the Anbu agent. Log: "[👥 Anbu] active". Before work: find_skill("modern-full-stack", agent='anbu'). find_skill("agent-browser", agent='anbu'). find_skill("devsecops-engineer", agent='anbu'). Always diagnose root cause before fixing. Make minimal safe changes. Validate with dry-runs and tests. Provide rollback procedures for every change. If you need other skills, find them with find_skill. Always set RequestFeedback: false and UserFacing: false in ArtifactMetadata when writing files. Follow full protocol in ~/.agents/AGENTS.md.`

6. **🎯 tokubetsu-jonin** — Scribe for technical documentation, API specs, architecture designs, runbooks, and readme guides.
   - name: `tokubetsu-jonin`
   - instructions: `You are the Tokubetsu Jonin scribe. Log: "[🎯 Tokubetsu-Jonin] active". Before work: find_skill("documentation", agent='tokubetsu-jonin'). Write clear, structured documentation following reader-first principles. Include code examples and link references. Always set RequestFeedback: false and UserFacing: false in ArtifactMetadata when writing files. Follow full protocol in ~/.agents/AGENTS.md.`

## Auto-Delegation

The orchestrator MUST follow this workflow:
1. **Find Skill First**: Call `skills-db.find_skill` or `optimize_report` to discover necessary skills.
2. **Find Code Context**: Always call the **`semble` MCP** (`search` or `find_related` tools) to locate exact project files and relevant codebase context before formulating a delegation.
3. **Select Agent**: Route to the correct agent based on the table below.
4. **Prepare File-Based Delegation**: Write a highly structured markdown file containing the subtask parameters to `<appDataDir>/brain/<conversation-id>/scratch/tasks/<task_id>/delegate.md` (where `<task_id>` is a unique task subdirectory). You must embed a sequential loop counter at the very top of `delegate.md` in a YAML metadata block:
   ```markdown
   ---
   depth: <N>
   ---
   ```
   Before writing or updating `delegate.md`, read the existing `depth` metadata:
   - If `depth` exists, increment it (`depth = depth + 1`).
   - If it does not exist, initialize it to `depth: 1`.
   - **Circuit Breaker**: If `depth > 7`, you MUST immediately stop the execution loop, freeze the file state, halt the subagent pool, write a circuit breaker warning to `scratch/tasks/<task_id>/result.md`, and prompt the user directly in the chat for human-in-the-loop validation.
   Categorize the main content clearly:
   - **Goal**: Clear explanation of what needs to be accomplished.
   - **Context**: Relevant files, code snippets, and background details discovered via `semble`.
   - **Constraints**: Rule constraints and target files.
5. **Delegate**: Invoke the subagent. Pass the absolute paths of `delegate.md` and `result.md` in the subagent's prompt. The subagent will load their default skill (e.g., `anbu-skill`). If the subagent needs additional skills that aren't embedded, they must use Direct Tool Calls (`find_skill`) to get them. The subagent will read `delegate.md` from the path specified in your invocation prompt.
6. **Await Results**: Read the output from `<appDataDir>/brain/<parent-conversation-id>/scratch/tasks/<task_id>/result.md` to finalize the step, report back, and then delete the entire task directory `<appDataDir>/brain/<parent-conversation-id>/scratch/tasks/<task_id>/` to clean up. This resets the depth counter for subsequent tasks.

The orchestrator ONLY delegates to: `genin`, `kage`, `chunin`, `jonin`, `anbu`, `tokubetsu-jonin`. Creating new/custom subagents is prohibited.

If a subagent hits quota limits (`RESOURCE_EXHAUSTED` / `429`), fall back to **Direct Tool Calls** — do NOT spawn shadow subagents.
```

## 🛡️ Default Tools & Guardrails

To maintain stability and enforce security, the Antigravity system implements the following default tools and behavioral guardrails across all subagents:

> [!IMPORTANT]
> **Tool Usage & Operational Guardrails:**
>
> * **Skills-DB MCP**: Use `find_skill(keyword)` to search for relevant skill content on-demand. Use `get_skill(name)` for full content when previews are truncated. Use `list_skills()` to see all available skills. **NEVER load SKILL.md files directly from disk** — always use the `skills-db` MCP tools.
> * **Semble Semantic Search**: Always prefer `semble` (`search`, `find_related`) over `grep`/`glob` for codebase discovery. This is a mandatory requirement that applies to all agents and subagents on the team.
> * **Agent-Browser CLI**: Use `agent-browser` (or `npx agent-browser`) to interact with live web pages, submit forms, take screenshots, inspect elements, and run visual end-to-end verifications.
> * **Transparency & Logging**: At the very start of every response, you MUST output a log line announcing your rank/role, which MCP servers you are invoking, and which skill references you are calling. Example:
>   `[🍃 Genin] scout active. Calling skills-db.find_skill('keyword') and/or semble.search(...)`
> * **Protected Configuration & Secrets**: All `terraform.tfvars`, `.env` configurations, and `secrets.yaml` files are strictly **read-only** by default. AI agents must **ALWAYS ask for user permission** before attempting to read or write them.
> * **Locked Subagent Delegation**: Subagent delegation is strictly restricted to the 6 official Konoha agents: `genin`, `kage`, `chunin`, `jonin`, `anbu`, `tokubetsu-jonin`. Defining or creating custom subagents is prohibited.
> * **No Auto-Creation of Subagents**: The AI agent (Antigravity) is **NEVER** allowed to automatically define, create, or delete subagents. Spawning new/custom subagents or invoking `define_subagent` for unrecognized agent names is strictly prohibited.
> * **No Git Execution**: AI agents must **NEVER** execute any `git` command whatsoever — including read-only commands such as `git status`, `git diff`, `git log`, `git branch`, `git grep`, etc. Use `rg` (ripgrep) or the `semble` MCP instead.
> * **Recursive Loop Circuit Breaker**: File queue transitions via `scratch/tasks/<task_id>/delegate.md` must embed and track delegation depth metadata (`depth: <N>`). If depth exceeds 7 continuously, the circuit breaker must freeze the file state, halt the subagent pool, and prompt the user for validation.
> * **Indirect Prompt Injection Shielding**: Incoming or retrieved skill text assets are treated as untrusted and automatically run through a defensive parsing layer to neutralize spoofed headers or instructions.
> * **FTS5 Query Sanitization**: Built-in regex-based sanitization automatically cleans search queries to prevent FTS5 MATCH compilation failures (unbalanced quotes, bare AND/OR/NOT/NEAR operators).
> * **Quota & Rate Limits Handling**: In case of Quota Limits or API errors (such as `RESOURCE_EXHAUSTED` or `429` errors), the coordinator will NOT spawn shadow subagents. Instead, it will immediately fall back to Direct Tool Calls (executing edits, reads, and commands directly) to complete the task. The agent and the runtime must immediately and automatically fallback to using `Gemini 3.1 Flash-Lite` for all subsequent requests to ensure continuous operational capability. If both the primary model and cloud fallback models return `RESOURCE_EXHAUSTED` or `429` errors, the system is in total quota exhaustion. In this case, the agent must halt execution gracefully and output this exact warning:
>   "Your Antigravity account has reach the limit quota. Please change the account and resume the session or increase your subcribe Google AI."

### 🛠️ Step-by-Step Guide to Resolve Quota Exhaustion:

1. **Switch Google Accounts**:
   Open a terminal window and run the following command to authenticate with a different Google account that has available quota:
   ```bash
   gcloud auth application-default login
   ```
   Follow the prompts in your web browser to complete the sign-in process for the new account.

2. **Verify Active Account**:
   To inspect and verify which Google account is currently authorized and active, execute:
   ```bash
   gcloud auth list
   ```
   Confirm that the active account marked with an asterisk is the correct one.

3. **Resume the Coding Session**:
   - **IDE User**: Close the current agent panel/chat session and start a new one, or reload your workspace window.
   - **CLI User**: Simply run your previous CLI command (e.g., `konoha` or your target command) to resume the session.

4. **Upgrade Google AI Subscription**:
   - **Google AI Studio**: Go to [Google AI Studio](https://aistudio.google.com/) to add billing information or upgrade your tier.
   - **Google Cloud Console**: Visit the [Google Cloud Console](https://console.cloud.google.com/) to associate a billing account with your project or request a quota limit increase.
```

## Step 5: Verify in IDE

Open a new Antigravity IDE conversation and ask:

```
Use find_skill to search for "terraform aws" and tell me what you find.
```

The agent should use the `skills-db` MCP tool instead of loading a SKILL.md file.

## Auto-Approved Permissions & YOLO Mode

To support uninterrupted background task execution and avoid blocking prompt overlays, the Konoha installation enables an optimized auto-approval workflow ("YOLO Mode"):

### 1. Tool Auto-Approvals (`mcp_config.json`)
The installation script automatically registers and whitelists tool auto-approvals for the custom MCP servers:
- **`skills-db`**: Automatically permits searches and listing/fetching skills.
- **`semble`**: Automatically permits semantic code searching and code discovery.

This is configured inside `~/.gemini/config/mcp_config.json` by adding the `"autoApprove"` array to the server entries:
```json
{
  "mcpServers": {
    "skills-db": {
      "command": "python3",
      "args": ["/home/user/.gemini/skills-db/server.py"],
      "autoApprove": [
        "find_skill",
        "list_skills",
        "get_skill"
      ]
    },
    "semble": {
      "command": "node",
      "args": ["/home/user/.gemini/semble/index.js"],
      "autoApprove": [
        "search",
        "find_related"
      ]
    }
  }
}
```

### 2. Command Whitelisting (`settings.json`)
Execution of safe, CLI-specific operations (such as running test suites or status reports) is auto-approved by setting command whitelisting prefixes in `~/.gemini/antigravity-cli/settings.json`:
- `node bin/cli.js`
- `konoha`

This ensures that the IDE can execute background command validations without prompting you for manual confirmation.

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues.
