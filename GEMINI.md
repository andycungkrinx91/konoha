# Konohagakure Workspace Instructions

> **⚠️ MANDATORY — READ BEFORE EVERY ACTION:**
> Global ninja subagent roster, MCP delegation protocols, and standard operating procedures are governed by the authoritative user rules in `~/.gemini/GEMINI.md`.
> Do NOT duplicate global definitions here. This file defines workspace-specific invariants and constraints for the `konohagakure` repository.

### Workspace Invariants & Guardrails

1. **Tool Boundaries**:
   - Code discovery & search → `semble` MCP (`search`, `find_related`).
   - Skill lookup & bounded file I/O → `konoha` MCP (`find_skill`, `get_skill`, `read_file_range`, `read_file_head`, `file_info`, `token_efficient_grep`).
   - Shell commands → Force-run with `rtk <command>` first to suppress noisy terminal output.
   - Forbidden native tools: Never use `view_file`, `grep_search`, `list_dir`, or shell `cat`/`head`/`grep`/`rg`/`find` directly.
2. **Strict Skill Protection**:
   - Under NO circumstances should any skill directory or reference file inside `src/templates/skills/`, `.agents/skills/`, or `~/.agents/skills/` ever be deleted, pruned, or stripped.
3. **Stable Gateway Isolation**:
   - Under no circumstances modify, refactor, or touch logic or configs related to the local LLM Proxy Gateway, bridge servers, or the Bridge Router.
4. **Zero AI Slop Gate**:
   - All code changes must achieve 100/100 score on `rtk aislop scan --changes` with 0 errors and 0 warnings before completion.
5. **Documentation & Changelog Synchronization**:
   - When maintaining Konoha, ensure documentation, diagrams, README, and CHANGELOG are updated in tandem with code changes.

<!-- KONOHA-CONTRACT-START -->
## Konoha runtime contract (2.0.0-cross-client-1)

You are the main agent running through Antigravity IDE/CLI. This contract is mandatory on every new session, resumed session, and follow-up turn.

- **Konoha is mandatory**: use the `konoha` MCP for skill discovery, skill loading, and bounded file operations. Use `konoha.find_skill` before work and load the matching skill with `konoha.get_skill`.
- **Semble is mandatory**: use the `semble` MCP tools `search` and `find_related` for all project codebase discovery and search. Always pass the absolute repository path. Do not replace Semble with native grep, glob, find, or IDE search.
- **RTK is mandatory for commands**: ALWAYS force-run all shell/command executions with `rtk <command>` first; prefix shell/command execution with `rtk` to filter noisy terminal output and minimize token consumption. When RTK is not installed, fails, or is unsupported for a specific command, immediately fall back to direct shell/bash (`sh` / `bash`) execution without silently claiming RTK was used.
- **Delegation remains mandatory**: the main agent coordinates through Konoha subagent tools; each official subagent follows this same Konoha, Semble, and RTK contract directly.
- **Resume safety**: when a session starts or resumes, re-read this contract, re-evaluate the prompt, repeat skill discovery, and restore the Konoha/Semble/RTK workflow before taking action. Never assume a previous turn established these requirements.
- **Tool boundaries**: Konoha handles skills and bounded file I/O; Semble handles code search; RTK wraps shell output. Do not mix their responsibilities.
- **Skill discovery vs file search**: Skills are discovered exclusively via `konoha.find_skill` or `konoha.list_skills`. NEVER call `get_file_structure` or `find_files_clean` on root directories (`.`) to search for skills. File tools are strictly for exploring project files.
- **IDE Directory Protection**: Access to IDE binary installation directories (containing `Antigravity IDE.exe`, `dxcompiler.dll`, `resources.pak`, etc.) is strictly forbidden across all file operations.
<!-- KONOHA-CONTRACT-END -->
