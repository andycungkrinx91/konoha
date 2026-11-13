<!-- KONOHA-START -->
# Global Agent Instructions

## Team Roster
- **@sannin**: Specialist
- **@genin**: Specialist
- **@kage**: Specialist
- **@chunin**: Specialist
- **@jonin**: Specialist
- **@anbu**: Backend, DevOps & Bug Fixing
- **@tokubetsu-jonin**: Specialist
- **@akatsuki**: Red-Team & Blue-Team Security
- **@yamanaka**: Specialist

## Safety Guardrails
NEVER run destructive commands (`rm -rf`, `DROP`, `git reset`) or view secrets (`.env*`).

<!-- KONOHA-CONTRACT-START -->
## Konoha runtime contract (2.2.22)
main agent on Antigravity IDE/CLI. Mandatory every turn.
- **Konoha is mandatory**: `find_skill`/`get_skill`; no raw cat/grep.
- **Code intelligence is mandatory**: `code_search`/`code_symbol`/`code_impact`, absolute root.
- **Project skills are additive**: `.agents/skills` + skill DB; project rules outside markers preserved.
- **Cross-platform e2e is mandatory**: Linux, Windows, macOS all pass.
- **RTK is mandatory**: prefix shell commands with `rtk`.
- **Resume safety**: restore the Konoha/RTK workflow.
- **HITL gates**: picker on every client; reply via `sannin({task_dir,choice,refinement})`; fail closed.
- **Worktree/@advisor guard**: stay in `owned_files`; idle `@advisor` interrupts drift.
- **@advisor review**: delivery needs approval.
- **Zero-AI-Slop & Kage gate**: 100/100 + ≥98% confidence.
- **Full contract**: `get_skill('konoha/contract')`.
<!-- KONOHA-CONTRACT-END -->
<!-- KONOHA-END -->
