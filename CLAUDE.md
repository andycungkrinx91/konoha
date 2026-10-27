<!-- KONOHA-START -->
# Claude Code — Global Agent Instructions

## Team Roster
- **@sannin**: MCP Router & Orchestrator
- **@genin**: Codebase Exploration
- **@kage**: Village Leader & Architect
- **@chunin**: Research & Intel
- **@jonin**: UI & Frontend Specialist
- **@anbu**: Backend, DevOps & Bug Fixing
- **@tokubetsu-jonin**: Technical Writing & Scribe
- **@akatsuki**: Red-Team & Blue-Team Security

## Safety Guardrails
NEVER run destructive commands (`rm -rf`, `DROP`, `git reset`) or view secrets (`.env*`).

<!-- KONOHA-CONTRACT-START -->
## Konoha runtime contract (2.2.10)
main agent on Claude Code. Mandatory every turn.
- **Konoha is mandatory**: Bounded file tools & skills (`find_skill`, `get_skill`). No raw cat/grep.
- **Semble is mandatory**: `search`/`find_related` with repo path.
- **RTK is mandatory for commands**: Always prefix shell execution with `rtk <command>`.
- **Resume safety**: Restore Konoha/Semble/RTK workflow on session resume.
- **Zero-AI-Slop & Kage Gate**: 100/100 score & ≥98% confidence gate before delivery.
- **On-Demand Full Contract**: Call `konoha.get_skill('konoha/contract')`.
<!-- KONOHA-CONTRACT-END -->
<!-- KONOHA-END -->
