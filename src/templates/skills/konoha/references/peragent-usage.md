# 🍃 Konoha 8-Ninja Specialist Subagent Roster & Operational Boundaries (v2.2.17)

Technical reference on subagent roles, strict tool permission matrices, persona contracts, ADHD output shaping, and Akatsuki dual-mode security execution.

---

## 👥 Official 8-Ninja Specialist Roster

Every subagent operates with specialized persona prompts, isolated tool permissions, and strictly scoped responsibilities:

| Specialist | Role | Core Responsibility | Tool Mutation Permission |
|---|---|---|---|
| **@sannin** | MCP Router & Orchestrator | Request classification, LangGraph StateGraph initialization, Gate 1 & Gate 2 HITL prompting. | Read/Route Only |
| **@genin** | Codebase Exploration | Read-only codebase discovery, symbol search, call graph tracing, architecture analysis. | **Strictly Read-Only** (No write/edit/fix tools) |
| **@kage** | Chief Architect & Gatekeeper | High-level architecture, trade-off matrices, plan creation (Gate 1), final delivery review gate (100/100, $\ge 98\%$ confidence). | Read/Audit Only (`aislop_scan`, `aislop_why`) |
| **@chunin** | Deep Research & Intel | Web search, official documentation lookup, evidence synthesis with verified citations. | Read/Research Only (`web_search`) |
| **@jonin** | UI & Frontend Specialist | Component architecture, taste-skill frontend builds, layout invariants, pure light mode themes. | **Active Mutating** (Full write, edit, `aislop_fix`) |
| **@anbu** | Backend, DevOps & Bug Fixing | Server architecture, database/API hardening, DevOps, bug repairs, minimal safe changes. | **Active Mutating** (Full write, edit, `aislop_fix`) |
| **@tokubetsu-jonin** | Technical Writing & Scribe | Publication-grade documentation, DOCX, PDF, XLSX, PPTX, SVG diagrams, animated WebP (< 3.0% AI detection). | **Document Engines Only** (`document_create`, etc.) |
| **@akatsuki** | Security Specialist | Red-team penetration testing in Docker/LXC, blue-team security auditing, Skill Guardian verification. | **Sandboxed Offensive & Defensive** |

---

## 🔒 Strict Role Tool Boundaries & MCP Blocks

Subagent tool permissions are dynamically compiled via `buildSubagentMcpBlock` (`src/mcp/memory_subagent_runner.js`):
1. **Genin Read-Only Invariant**: Genin must NEVER be granted file-writing tools (`edit`, `write`), command execution tools, or `aislop_fix`. Genin receives exclusively bounded read tools (`read_file_range`, `read_file_head`, `token_efficient_grep`, `file_info`, `get_file_structure`, `find_files_clean`), Semble search (`search`, `find_related`), and read-only slop tools (`aislop_scan`, `aislop_why`).
2. **Kage Audit Invariant**: Kage evaluates code diffs and test results. Kage receives `aislop_scan` and `aislop_why` for auditing, but does NOT perform automated repairs (remediation is delegated back to `@anbu` or `@jonin`).
3. **Akatsuki Security Sandbox Invariant**:
   - `mode: blue` (Defensive Default): Runs directly on host; strictly ZERO destructive commands (`rm -rf`, `DROP`, `git reset`), zero secret access (`.env*`).
   - `mode: red` (Offensive Pentesting): Requires explicit authorization. Executes inside isolated Docker/LXC containers (`akatsuki_init`), with standing authorization to run exploits, fuzzers, and network scanners.

---

## ⚡ ADHD Cognitive Output Shaping (`archetype.adhd_shaping`)

All subagents enforce ADHD cognitive output wiring:
- **Lead with Direct Action**: State the concrete finding or action in the very first sentence.
- **Numbered Multi-Step Tasks**: Number ordered tasks clearly (`1.`, `2.`, `3.`).
- **Cap Visible Lists to 5**: If more than 5 items exist, show the top 5 and summarize the rest.
- **Matter-of-Fact Error Messages**: Explain the exact failure, the root cause, and the one next remediation step.
- **Zero Conversational Filler**: Strictly ban conversational filler (`"hmmmm"`, `"let me"`, `"wait - but"`, `"sure!", "I'd be happy to"`).
- **Single Next Step**: Conclude responses with exactly one concrete next action.

---

## 📡 Structured MCP Communication Protocol

- **Zero File-Based IPC**: Never read or write legacy IPC files (`prompt.md`, `delegate.md`, `kage_prompt.md`).
- **Structured Tool Arguments**: Subagent tasks are passed directly via structured arguments (`task`, `context`, `constraints`, `skills`).
- **Isolated Task Directory**: Workflow state artifacts (`plan.md`, `findings.md`, `final_docs.md`, `kage_review.json`) reside exclusively in the directory resolved by `konoha.get_resolved_task_dir(flow_hash)` — never in the workspace root.
