---
name: konoha
description: Guidelines and instructions for maintaining, extending, and debugging the Konoha MCP Tools Orchestrator, MCP middleware, and multi-archetype website builder across 8 coding clients (Antigravity IDE/CLI, Cursor, Claude Code, OpenCode, Command Code, Codex, Pi/pi.dev, OMP).
tags:
  - konoha
  - orchestrator
  - mcp
  - maintenance
  - engineering
  - website-builder
  - fts5
---

# 🍃 Konoha Maintenance & Engineering Skill (v2.2.20)

Core operational guide for maintaining, extending, and debugging the **Konoha MCP Tools Orchestrator**, SQLite FTS5 indexer, and multi-agent coordination server.

Konoha serves ALL 48 canonical tools through standard MCP protocols across 8 supported AI coding clients (Antigravity, Cursor, Claude Code, OpenCode, Command Code, Codex, Pi, OMP). All 48 canonical MCP tools (plus 2 hidden deprecated compatibility aliases, 50 total in manifest) are formally declared in `src/mcp_tool_manifest.json` and dispatched via `src/mcp/tool_dispatch.js` across 9 specialists:
- Deep Research (@chunin): Web research, documentation lookup, and evidence synthesis.
- Code Exploration (@genin): Read-only codebase exploration, symbol search, and architecture review.
- Architecture & Quality Gates (@kage): Architecture decisions, security audits, and delivery review gate.
- MCP Router & Orchestrator (@sannin): Request classification, triage, and multi-agent coordination.
- UI & Frontend (@jonin): Component architecture, design match, and taste-skill frontend builds.
- Backend & DevOps (@anbu): Backend services, bug fixing, DevOps, and infrastructure deployment.
- Technical Writing & Scribe (@tokubetsu-jonin): Publication-grade documentation, diagrams, and reports.
- Security Specialist (@akatsuki): Red-team penetration testing in sandboxes and blue-team defensive hardening.
- Generative 3D Specialist (@yamanaka): Autonomous 3D asset synthesis, Manifold-3D geometry validation, and live Blender refinement.

---

## 🔒 Cardinal Maintenance Invariants

1. **Tool Boundaries & Global-Only Configs**:
   - Repository code search: ALWAYS use Semble MCP (`semble.search`, `semble.find_related`).
   - Skill lookup: ALWAYS use Konoha MCP (`konoha.find_skill`, `konoha.get_skill`).
   - Bounded file I/O: ALWAYS use Konoha bounded tools (`read_file_range`, `read_file_head`, `token_efficient_grep`).
   - Shell commands: ALWAYS prefix with RTK (`rtk <command>`).
   - Global-Only & Append-Only Client Configs: Never write `.omp`, `.codex`, `.cursor`, `.claude`, `.agents`, or `.gitignore` rules (such as `/PLAN.md` or `.omp/.`) into user project directories; all client configs live under user home (`~/.omp`, `~/.codex`, `~/.cursor`, `~/.config/git/ignore`, etc.) and use automatic date-stamped backups (`~/.konoha/backups/configs/<client>/<scope>/`) + syntax-aware append-only merging (`src/config_backup_manager.js`, `src/config_merger.js`) with ownership tracking (`~/.konoha/backups/ownership_manifest.json`). Konoha never deletes external `agents/` or `conversations/` directories.
   - Ownership-Aware Rsync-Like Global Skill Sync & Targeted Diff-and-Patch (`src/global_skill_sync.js`): All 17 canonical Konoha skills (including cross-framework Motion references `motion-nextjs`, `motion-nuxt`, `motion-svelte`, `motion-angular`, `framer-motion-animator`) and `SOUL.md` are automatically synchronized across all 8 client global skill directories (`~/.agents/skills`, `~/.gemini/antigravity-cli/skills`, `~/.gemini/skills`, `~/.cursor/skills`, `~/.claude/skills`, `~/.config/opencode/skills`, `~/.commandcode/skills`, `~/.codex/skills`, `~/.pi/agent/skills`, `~/.omp/agent/skills`). Fresh installs skip pre-existing user files (`--ignore-existing`), and upgrades apply targeted line diff-and-patch updates (`computeLineDiffPatch` / `applyTargetedTextPatch`) while preserving user customizations.
   - Scoped Execution & External Skill RAG Integration: Hooks and tool blockers activate only inside Konoha-managed contexts (`/konoha <prompt>` or `/<subagent-name> <prompt>`). External global and project-level skills across all 8 harnesses are indexed in-place into the existing SQLite Project Knowledge RAG (`~/.konoha/konoha.db`) with strict project isolation (`isPathVisible`) so project skills never leak across workspaces.
   - Extension Isolation: The obsolete `andycungkrinx91.konoha-bridge-master-universal` extension directory is eliminated; all IDEs use direct MCP configuration.
2. **Quality & Security Delivery Gate**:
   - Shipped code must pass `rtk npx aislop scan --changes` with score **100/100 Healthy**, 0 errors, and 0 warnings.
   - Final Kage review requires `confidence >= 98%`, `ai_slop_clean: true`, and zero security findings.
3. **Source File Line Limit**: Keep all `.js`, `.py`, and `.svelte` source files strictly under 700 lines (`scripts/lint.js`).
4. **Draw.io Zero Collision Rule**: Never introduce overlapping cells or bounding-box collisions in Draw.io diagram pages (`tests/test_diagram_sync.js`).
5. **Single-Source Version Synchronization**: Keep all 18 managed repository targets strictly synchronized via `scripts/bump_version.js`. The manifest is the source of truth — read the count from `rtk node scripts/bump_version.js --check`, never hardcode it in prose or code. `src/templates/skills/konoha/SKILL.md` is not a managed target, so this skill's own title is edited by hand.
6. **Release Governance**: When maintaining or updating Konoha on branch `master`, ensure all discovered tests pass before release commits.
7. **Token Savings Flow Logic Preservation Invariant**: Never modify or disrupt the token savings telemetry flow logic. In `src/tools_savings_logger.js`, baseline bytes for `find_skill` / `find_skills` are dynamically computed from the actual `SUM(byte_size)` of retrieved skill candidates in SQLite FTS5 matching, authentically reflecting 83%–98% context savings.
8. **Schema Version Is Not the App Version**: `src/db_schema.js` owns `CURRENT_SCHEMA_VERSION` (5 today), the shipped `PRAGMA user_version` write, and the canonical 33-table list. Never reintroduce a version-derived schema constant — a `TARGET_SCHEMA_VERSION = 2218` once shipped and was removed in 2.2.18. `konoha doctor` reports `schema 5` and `app 2.2.20` separately and warns on drift; `tests/test_schema_migrations_and_lifecycle.js` fails if a second writer appears or the table count moves.
9. **Red-Skill Isolation Fails Closed**: `src/skill_authorization.js` classifies a skill by exact canonical name → `RED_SKILL_ROOT_PATTERN` (`^(?:akatsuki-skill)(?:[-_/@]|$)`) → legacy pattern → tags, and `src/mcp/skills_retrieval.js` resolves the row before authorizing it. Lab databases are rejected when they alias the main DB (same path, symlink, dangling symlink, hardlink), and any `stat` error other than `ENOENT`/`ENOTDIR` raises `LAB_DB_ISOLATION_VIOLATION` (`src/db.js`). Never widen those predicates "to be tolerant": this gate is what stops offensive tooling loading outside the sandbox.
10. **Cyber Pack Is Opt-In, Never Bundled**: the pack is downloaded only via `konoha akatsuki cyber-pack install --confirm`, sha256-verified, extracted under `~/.konoha/akatsuki-lab/cyber-pack/`, and indexed as `akatsuki-skill` references. `src/cyber_pack.js#remove` must keep using the deduped union of `bin/lib/paths.js#DEFAULT_SKILLS_DIRS` and `src/global_skill_sync.js#getGlobalHarnessSkillTargets`; the two client lists genuinely disagree, and hardcoding either one is the bug that left copies behind.
11. **Migration Runs In-Process**: every caller awaits `runMigration({...})` from `src/migrate` — `bin/lib/install_lifecycle.js`, `bin/lib/runtime_lifecycle.js`, `bin/commands/migrate.js`, `bin/commands/upgrade.js`, `bin/commands/init_migration.js`, `bin/commands/doctor_services.js`, `src/skill_manager.js`, `src/web/controllers/skills_controller.js`. Never restore `spawnSync(process.execPath, [...migrate.js...])`: it hid every failure behind `status !== 0`. Success returns `{ ok: true, indexed, deferredSkills, dbPath }`; incomplete required skills return `{ ok: false, reason: 'required_skills_missing', missingRequired, remainingLegacy }`. Only `main()` exits the process.
12. **Time Budgets Come From Config**: `bin/lib/config_defaults.js` holds the shipped defaults as code (23 keys, including `migrate_time_budget_seconds` 900 and `install_build_migrate_timeout_ms` 900000) so an upgrade never rewrites the user's `~/.konoha/config.json`; `bin/lib/paths.js` derives `MIGRATION_TIMEOUT_MS` / `INSTALL_BUILD_MIGRATE_TIMEOUT_MS` / `UI_READY_TIMEOUT_MS` from them. No `timeout: 900000` literal may reappear on the install path (`tests/test_config_centralization.js`, `tests/test_upgrade_timeout_budgets.js`).
13. **Mirrored Modules Load Config Through `src/config_access.js`**: `copyRuntimeConfigFiles` mirrors top-level `src/*.js` flat into `~/.konoha/`, so `require('../bin/lib/paths')` escapes to `~/bin/lib/paths` at runtime. Any `src/` module that may execute from the mirror must go through `config_access`, which tries `../bin/lib`, `./bin/lib`, `../../bin/lib`.
14. **Upgrade Success Requires PATH Agreement**: `konoha upgrade` runs the PATH-resolved `konoha --version` and compares it with the installed package (`bin/lib/upgrade_verify.js`). A missing binary, a rename, or output without a version line exits `1`. Never restore the old "located package root equals itself" comparison, which printed success while `konoha version` reported the previous release.
15. **No Install Scripts**: `postinstall` is deleted (npm aborts stock installs with `EALLOWSCRIPTS`). The supported flow is `npm install -g konoha-mcp` → `konoha init --yes` or `konoha upgrade`. `tests/test_postinstall_contract.js` no longer exists — do not cite or recreate it.
16. **The Token Governor Bounds Konoha's Own Graph, Not the Harness**: `src/mcp/langgraph/token_guard.js` accepts `ALLOWED_CEILINGS = [8192, 16384, 32768, 65536]`, defaults to 8192, and rounds invalid input up to the nearest allowed value. It clamps what Konoha hands the model *inside its internal LangGraph*. It does not budget harness model context. Never cite `8192` as a whole-session token ceiling.
17. **Two Databases, No Cross-Joins**: app data lives in `~/.konoha/konoha.db` (`src/db.js`); Akatsuki lab data lives in `~/.konoha/akatsuki-lab/lab.db` via `openLabDb()` (`src/workflow/akatsuki/lab_db.js`). A lab path handed to the main opener throws `LAB_DB_ISOLATION_VIOLATION`; `kali_tools` is created only by the lab opener, and no SQL may join the two databases — join in application code. Guards: `tests/test_akatsuki_lab_isolation_section_i.js`, `tests/test_akatsuki_skill_authz_db_isolation.js`.
18. **First-Run Login Opens on Set-New-Password**: while `GET /api/v1/auth/status` returns `is_bootstrap: true`, the web UI renders the setup form (`data-testid="first-run-setup-form"`) from `authState.isBootstrap`; never branch on a hardcoded `konohagakure` comparison. The 403 `requires_password_change` gate in `src/web_server.js` and the bootstrap password value in `src/auth.js` stay unchanged. Guard: `tests/e2e/login_default_password_redirect.spec.js`.

---

## 🚀 Quick Verification Commands

```bash
# Verify version consistency across all 18 managed targets
rtk node scripts/bump_version.js --check
rtk node tests/test_version_consistency.js

# Verify Draw.io zero geometric collisions
rtk node tests/test_diagram_sync.js

# Verify animated WebP assets
rtk node tests/test_all_assets_webp.js

# Verify LangGraph.js workflow activation (file keeps its historical v2217 name)
rtk node tests/test_langgraph_v2217.js

# Verify cross-platform install, upgrade, schema, and runtime-mirror integrity
rtk node tests/test_install_layout_integrity.js
rtk node tests/test_install_lifecycle_and_db_preservation.js
rtk node tests/test_install_migrate_embed_functions.js
rtk node tests/test_pnpm_config_migration.js
rtk node tests/test_upgrade_failure_reporting.js
rtk node tests/test_upgrade_timeout_budgets.js
rtk node tests/test_upgrade_version_verification.js
rtk node tests/test_upgrade_cyber_pack_purge.js
rtk node tests/test_config_backup_and_append_only.js
rtk node tests/test_config_centralization.js
rtk node tests/test_global_install.js
rtk node tests/test_global_skill_sync_8_clients.js
rtk node tests/test_schema_migrations_and_lifecycle.js

# Verify MCP argument boundaries, skill URI resolution, and red-skill precedence
rtk node tests/test_mcp_argument_parsing.js
rtk node tests/test_skill_uri_resolution.js
rtk node tests/test_skill_retrieval_precedence.js

# Verify the first-run login fix end to end (Playwright; boots the web app)
rtk pnpm run test:e2e

# Static analysis & Zero-AI-Slop audit
rtk node scripts/lint.js
rtk npx aislop scan --changes
```

---

## 📜 Change History That Constrains Maintenance (v2.2.17 → v2.2.20)

Read this before "fixing" the install, migrate, or upgrade path. Each row already shipped as a bug once.

| Trap | Do not | Guard |
|---|---|---|
| Schema/version conflation | Derive `user_version` from the app version | `src/db_schema.js` is the only writer; `konoha doctor` prints `schema 5, app 2.2.20` |
| Shelling out to migration | `spawnSync(process.execPath, [...migrate.js...])` and trust `status === 0` | in-process `runMigration()`, `tests/test_install_migrate_embed_functions.js` |
| Silent budget truncation | Cap the embedding pass below the caller's timeout | `migrate_time_budget_seconds` 900 / `install_build_migrate_timeout_ms` 900000 |
| `konoha embed` as a recovery hint | Recommend it for partial coverage | it implies `--rebuild-embeddings` → `DELETE FROM skill_chunks` then re-embeds everything (`src/vector_search.js:515`). Recovery is `konoha migrate` |
| Shorter cyber-pack dir list | Hardcode client skill dirs | deduped union of `DEFAULT_SKILLS_DIRS` + `getGlobalHarnessSkillTargets()` |
| Flat runtime mirror | `require('../bin/lib/...')` from a `src/` module | `src/config_access.js` |
| Transitive `image-size` | Trust the lockfile | `overrides.image-size >= 2.0.3`, `bundleDependencies`, `pnpm pack` (npm `pack` / global install drop bundled deps) |
| Install-script shim | Add `postinstall` back | no install scripts; `tests/test_global_install.js` |
| PATH-blind upgrade report | Compare the package root with itself | `bin/lib/upgrade_verify.js` |
| Doc-level pins | Let docs drift from code | `bin/lib/extension.js#PINNED_AB_PACKAGE` (`agent-browser@0.41.2`), asserted by `tests/test_agent_browser_provisioning.js` |
| Over-claiming the token ceiling | Quote 8192 as the harness budget | `token_guard.js` bounds Konoha's internal LangGraph payload only |
| Cyber-pack residue survives upgrade | Ship an upgrade that leaves legacy rows/on-disk copies and only `doctor --clean-cyber-pack` can remove them | `purgeLegacyResidue` runs from `src/migrate.js`; explicit opt-in is never destroyed; `tests/test_upgrade_cyber_pack_purge.js` |

Only `skill`-type rows are exempt from the embedding time budget (`src/vector_search.js:533`). Reference documents can therefore remain unembedded after a "successful" migrate, and `runMigration` reports them via `deferredSkills`.
