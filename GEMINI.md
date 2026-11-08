<!-- KONOHA-START -->
# Global Agent Instructions

## Team Roster
- **@sannin**: MCP Router & Orchestrator
- **@genin**: Codebase Exploration
- **@kage**: Village Leader & Architect
- **@chunin**: Research & Intel
- **@jonin**: UI & Frontend Specialist
- **@anbu**: Backend, DevOps & Bug Fixing
- **@tokubetsu-jonin**: Technical Writing & Scribe
- **@akatsuki**: Red-Team & Blue-Team Security
- **@yamanaka**: Generative 3D & Spatial Subsystem Specialist

## Safety Guardrails
NEVER run destructive commands (`rm -rf`, `DROP`, `git reset`) or view secrets (`.env*`).

<!-- KONOHA-CONTRACT-START -->
## Konoha runtime contract (2.2.19)
main agent on Antigravity IDE/CLI. Mandatory every turn.
- **Konoha is mandatory**: Bounded file tools & skills (`find_skill`, `get_skill`). No raw cat/grep.
- **Semble is mandatory**: `search`/`find_related` with repo path.
- **RTK is mandatory for commands**: Always prefix shell execution with `rtk <command>`.
- **Resume safety**: Restore Konoha/Semble/RTK workflow on session resume.
- **HITL Gates**: Gate 1 (`pending_plan_approval`) 1. Compact and approve / 2. Reject+Regenerate PLAN / 3. Input your own choice; Gate 2 (`pending_human_signoff`) 1. Compact and approve / 2. Remediation / 3. Input your own choice. Render the picker on EVERY client and submit the human's reply verbatim via `sannin({ task_dir, choice, refinement })`. Fail closed, never bypass.
- **Parallel Worktree & @advisor Guard**: Parallel workers stay strictly inside their assigned `git worktree` and `owned_files`; real-time idle `@advisor` (<=1k tok/turn) interrupts drift/hallucinations on the fly.
- **Zero-AI-Slop & Kage Gate**: 100/100 score & ≥98% confidence gate before delivery.
- **On-Demand Full Contract**: Call `konoha.get_skill('konoha/contract')`.
<!-- KONOHA-CONTRACT-END -->
<!-- KONOHA-END -->
