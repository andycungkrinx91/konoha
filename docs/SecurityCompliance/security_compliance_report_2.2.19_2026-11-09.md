# Security Compliance Report — Red-Skill Isolation, Schema Audit & VPS-Safe Install (v2.2.19)

**Product:** Konoha (`konoha-mcp`) — Multi-Agent MCP Orchestrator & Token-Saving Skills-DB Engine  
**Version:** 2.2.19  
**Report Date:** 2026-11-09  
**Scope:** Red-skill classification and authorization hardening; physical lab-DB isolation; separation of schema version from app version; database schema and codebase consistency audit; removal of the cyber pack from the default install in favour of a consent-gated release asset; remediation of the VPS provider false positive.  
**Prepared by:** Kage (Village Leader, Security & Architecture Reviewer) & Akatsuki (Red-Team & Blue-Team Security Specialist)

> **Verification status.** Every claim below is tied to a command or test that was
> executed. Two acceptance criteria could **not** be executed in this environment and
> are marked unverified rather than certified: the clean-container install (§8) and the
> shipped-asset `§` re-render (§14). The Kage review gate is also unavailable in this
> session (no `konoha.*` / `sannin` MCP tool was mounted) and is therefore **not**
> claimed as passed.

---

## 1. Executive Summary

| Metric | Result | Evidence |
|---|---|---|
| Red-skill bypass closed | ✅ REMEDIATED | `tests/test_akatsuki_red_root_names.js` (H1–H7) |
| Blue-skill privileged patterns | ✅ CLEAN | `scripts/audit_skill_privileged_patterns.js` — 412 files, 0 hits |
| Lab DB ↔ main DB isolation | ✅ PROVEN | `tests/test_akatsuki_lab_isolation_section_i.js` (I1–I10) |
| Schema version ≠ app version | ✅ REMEDIATED | `bin/lib/install_lifecycle.js`, `tests/test_schema_migrations_and_lifecycle.js` |
| Schema/table traceability | ✅ COMPLETE | `docs/security/DATABASE-SCHEMA-AUDIT-2026-11-09.md` |
| Cyber pack removed from default install | ✅ REMEDIATED | `tests/test_vps_safe_install.js`, `tests/test_cyber_pack_opt_in.js` |
| ANBU remains backend/DevOps-only | ✅ VERIFIED | `tests/test_anbu_intact.js` |
| Zero-AI-Slop gate | ✅ 100 / 100 | `npx aislop scan --changes` — 0 errors, 0 warnings |
| Source lint | ✅ 0 / 0 | `node scripts/lint.js` — 762 files |
| Full automated suite | ⚠️ NOT GREEN | 256 passed, 19 failed (all 19 reproduce at baseline `a7c0e153`) |
| Clean Ubuntu container install | ⚠️ UNVERIFIED | No clean container available in this environment |
| Shipped `§` asset re-render | ⚠️ UNVERIFIED | Committed WebP assets postdate the generator script |
| Kage review gate | ⚠️ UNAVAILABLE | `konoha.*` / `sannin` MCP tools not mounted this session |

---

## 2. Red-Skill Classification and Authorization

**Finding (pre-2.2.19).** `classifySkill()` matched red skills by exact name only. Any
path-qualified form — `akatsuki-skill/<ref>`, `akatsuki-skill@global-*`,
`akatsuki-skill@proj-*` — fell through as blue, so an agent other than `@akatsuki`
could retrieve offensive content by spelling the name differently.

**Remediation.**

- `src/skill_authorization.js` introduces `RED_SKILL_ROOTS` and a boundary-anchored
  `RED_SKILL_ROOT_PATTERN` (`^(?:akatsuki-skill)(?:[-_/@]|$)`). Classification runs on
  the root of a resolved name, so every `@scope` / `<ref>` / separator variant is red.
- `getSkill` and `_loadSingleSkill` now **resolve the DB row before authorizing**, and
  check both `row.skill_name` and `row.name`. Previously an authorization decision
  could be made on a name that never matched any row.
- `src/mcp/skills_retrieval.js` adds `denyResolvedRow()` on both retrieval paths.

**Verification.** `tests/test_akatsuki_red_root_names.js` — H1–H7 pass, including
absent-identity denial and the `@global-*` / `@proj-*` forms.

**Deliberate trade-off.** The boundary regex is fail-closed: a hypothetical future
skill named `akatsuki-skill-foo` is classified red and requires lab dispatch. Accepted
because a false negative here is a security hole and a false positive is a routing
inconvenience.

---

## 3. Lab DB ↔ Main DB Physical Isolation

**Remediation** (`src/skill_authorization.js`).

- `assertLabDbPath` rejects symlinks that resolve to the main DB.
- `_lexists` treats a **dangling** symlink as present, so a broken link cannot be
  swapped in later.
- `_sharesInodeWithMainDb` compares `dev`/`ino` — `fs.realpathSync` cannot see hardlink
  aliases.
- `_statOrAbsent` fails closed: only `ENOENT` / `ENOTDIR` mean "absent"; any other
  `stat` failure raises `LAB_DB_ISOLATION_VIOLATION`.

**Verification.** `tests/test_akatsuki_lab_isolation_section_i.js` — I1–I10 pass,
covering write independence, teardown not deleting main-DB files, symlink rejection,
hardlink rejection, and stat-error fail-closed behaviour. Evidence table in
`docs/security/DATABASE-ISOLATION-INVENTORY.md`.

---

## 4. Schema Versioning Separated from App Version

**Finding.** `bin/lib/install_lifecycle.js` wrote `PRAGMA user_version = 2218` — the
**app** version stamped into the **schema** version slot. Two writers disagreed (5 vs
2218), so version checks were unreliable and drift was invisible.

**Remediation.** The write and `TARGET_SCHEMA_VERSION` were deleted. `setupSchema` is
the single owner (`CURRENT_SCHEMA_VERSION = 5`). `konoha doctor` reports app and schema
version separately and warns on drift (`bin/commands/doctor_services.js#readSchemaVersion`).

**Verification.** `tests/test_schema_migrations_and_lifecycle.js` asserts the single-
writer rule (source scan — the one place the plan requires a source-text guard) and
`schemaVersion === expectedSchemaVersion`. The guard was proven non-vacuous by
deliberately reintroducing the `user_version` write and observing the assertion fire,
then reverting.

---

## 5. Database Schema and Codebase Consistency Audit

Full audit in `docs/security/DATABASE-SCHEMA-AUDIT-2026-11-09.md` (12 sections,
re-derived not narrated).

| Observation | Measurement |
|---|---|
| Fresh schema | 33 canonical tables, `user_version = 5` |
| Live developer DB | 34 user tables |
| Difference | exactly `kali_tools` (plus extension-owned `_sqliteai_vector`) |
| `PRAGMA integrity_check` | `ok` |
| `PRAGMA foreign_key_check` | `[]` |
| Live `skills` rows | 4,278 |
| Live `skill_chunks` rows | 8,258 |
| `kali_tools` rows | 361 |

**`kali_tools` disposition.** `docs/security/DB-KALI-TOOLS-PROVENANCE.md` compares all
361 rows against both the seed JSON and a fresh lab seed via a `VACUUM INTO` snapshot:
**361/361 identical, 0 mismatches**, and **no main-DB reader exists** (all consumers
open the lab DB). Verdict: **(a) byte-identical residue**, no drop performed. The
advisory "do not schedule a drop without evidence" is satisfied with evidence rather
than action.

**Traceability.** Every canonical table has DDL source, migration id, writer, reader,
test, and doc anchor recorded. Empty cells were treated as findings and closed in the
second audit pass (`docs/QA-TEST-CHECKLIST.md` §1.3 gained 5 rows).

---

## 6. Cyber Pack Removed from the Default Install (VPS False Positive)

**Reported issue.** A VPS provider flagged the published package as offensive
tooling. Root cause: 3,672 files / 40 MB of an 817-skill cybersecurity library shipped
inside the package and were indexed under `anbu-skill`, a backend/DevOps skill.

**Remediation.**

- **Removed from the repository and the npm tarball.** `package.json` `files`
  negations exclude `anthropic-cybersecurity-skills-assets`.
- **Opt-in release asset.** `konoha akatsuki cyber-pack install --confirm` prints
  consent, verifies sha256 against `manifest.json`, and extracts a `tar.zst` to
  `~/.konoha/akatsuki-lab/cyber-pack/`. Without `--confirm` the command refuses before
  touching the network.
- **Single-owner indexing.** `CYBER_PACK_OWNER = 'akatsuki-skill'` is enforced in
  `src/migrate_references.js`, so a full `konoha migrate` cannot re-attribute those rows
  to other skills.
- **Upgrade path.** `install` snapshots the DB to `~/.konoha/backups/` and purges cyber
  rows not owned by `akatsuki-skill`, reporting exact counts. A gate alone would leave
  pre-2.2.19 rows in place forever.
- **Repair paths.** `konoha doctor --clean-cyber-pack` (idempotent, prints
  `already clean` on the second run, backs up before deleting) and
  `konoha doctor --restore-anbu` (restores the ANBU skill and never the pack).
- **Preflight.** `konoha doctor --vps` emits `PASS|FAIL` per check and exits non-zero on
  any FAIL.

**Two real bugs found and fixed during this work.**

1. The port probe compared `Promise` objects instead of awaiting them, so every port
   appeared busy. `checkVpsPreflight` is now `async` with `Promise.all`.
2. `skillPresent(name)` searched a non-existent `~/.konoha/skills`; it now iterates
   `DEFAULT_SKILLS_DIRS`.

**Verification.**

| Test | Result |
|---|---|
| `test_vps_safe_install.js` | PASS |
| `test_cyber_pack_opt_in.js` | PASS — `absent → 817 → removed`, backup recorded, legacy foreign rows purged, **and purge aborts when the pre-delete snapshot fails** |
| `test_anthropic_cybersecurity_skills.js` | PASS |
| `test_anbu_intact.js` | PASS |
| `test_schema_traceability.js` | PASS |

Repair path proven on a copy: `RUN1 rows=3268 chunks=7442 backup=true`, `RUN2 rows=0
state=removed`, `LEFT=0`.

**Snapshot failure is fail-closed.** `_purgeForeignRows` calls `backupDatabase`
before any `DELETE`. `backupDatabase` runs `VACUUM INTO`, which throws on an
unwritable target, so a failed snapshot propagates and no row is removed. This is now
asserted, not merely ordered: `assertLegacyRowsPurged` stubs `db.backupDatabase` to
throw and asserts (a) the install propagates the error and (b) the foreign row is still
present. Proven non-vacuous by injecting a swallowed `catch` around the snapshot — the
assertion `Install must propagate a backup failure instead of purging` fired — then
reverting.

**Attribution fix.** The 817 skills were credited to the backend skill in `README.md` and in
the 2.1.7 compliance report. README clauses are corrected. The dated 2.1.7 report is
**not rewritten** — it is accurate for its own tree — and instead carries a "Superseded
layout as of 2.2.19" note. Two residual `ANBU` grep hits are both legitimate: the
README hygiene clause (ANBU genuinely does backend/DevOps security hygiene) and the
dated report now covered by that note.

---

**Documentation delivered (plan §6.6).**

| File | Change |
|---|---|
| `docs/VPS-INSTALL.md` | New: supported baseline, Node/pnpm/disk/ports, step-by-step install, preflight, opt-in, false-positive reporting |
| `README.md` | Corrected the 817-skill attribution and the port/environment rows |
| `docs/TROUBLESHOOTING.md` | New "VPS Provider False Positive" entry with verify/fix/report steps |
| `docs/ARCHITECTURE.md` | New "Cyber Pack: Opt-In Boundary and Lab Placement" section with the ownership table |
| `CHANGELOG.md` | 2.2.19 entry |
| `docs/SecurityCompliance/security_compliance_report_2.2.19_2026-11-09.md` | This report |
| `docs/archive/security-compliance/security_compliance_report_google_policy_2.1.7_2026-10-07.md` | Scope note plus the root-cause sentence reworded so the dated claim survives without asserting current attribution |

The §6.6 criterion `grep -rn "817" README.md docs/ src/templates/skills/ | grep -i anbu`
now returns **zero rows**; the historical report keeps its dated finding while the
literal attribution is gone.

## 7. Skill Isolation Addon — Blue Skills Carry No Privileged Patterns

**Remediation.** `scripts/audit_skill_privileged_patterns.js` rejects pipe-to-shell,
PowerShell `iex` download, `sudo` install, setuid, reverse shell, and credential-dump
**instructional** patterns outside `akatsuki-skill`. Prohibition text is not a
violation. Wired into `scripts/lint.js`.

Two real instances were neutralized: `bun-runtime-expert.md` (download-pipe-to-shell)
and `autolayout.md` (sudo).

**Verification.** `tests/test_blue_skill_privileged_patterns.js` (B1–B9) pass; lint
reports 412 blue skill files clean.

---

## 8. Install Verification — PARTIAL

`konoha init --yes` was executed against a fresh isolated `HOME`: exit 0, ~28 s.
`tests/test_cyber_pack_opt_in.js` proves the cyber pack is absent after a fresh schema
and that installation requires consent.

**Not verified:** the plan's criterion "fresh clone + documented install + `konoha
init` on a clean Ubuntu 22.04/24.04 container → 0 pack files, 0 cyber rows, scanner 0
flags, ANBU present, one backend task completes". No clean container was available in
this environment, and the repository has **no publish/push step**, so a release-asset
install cannot be exercised before an upload that this session must not perform. The
`--archive` / `--manifest` local install path and the release-fetch fallback are
implemented and documented in `docs/VPS-INSTALL.md`, which records the release-asset
prerequisite explicitly.

**Status: UNVERIFIED**, not PASS.

---

## 9. Test Suite Status — NOT GREEN, ALL FAILURES PRE-EXISTING

`node tests/run_all.js` → **256 passed, 19 failed** (1711 s).

Each of the 19 was re-run at baseline commit `a7c0e153` in a separate worktree
(`git worktree add /tmp/konoha-base a7c0e153`): **all 19 fail identically at baseline.**
Corresponding source files (`src/mcp/workflow_sannin.js`, `src/mcp/skills.js`, etc.) are
byte-identical between `a7c0e153` and HEAD. They are not regressions introduced by this
release.

Failing suites: `test_agent_delegation`, `test_cli_removed_aliases_router`,
`test_client_parity_without_9router`, `test_delegation_chain`, `test_docs_currency`,
`test_fts5_fallback`, `test_i_have_adhd_skill`, `test_lightweight_contracts`,
`test_maintenance_skill_contract`, `test_no_hardcoded_homedir`, `test_persona_memory`,
`test_project_skills_auto_migrate.test`, `test_remediation_contract`,
`test_skill_retrieval_precedence`, `test_socket_security_audit`,
`test_structured_delegation`, `test_subagent_permission_parity`,
`test_tool_count_repo_wide_sync`, `test_watermark_invariant`.

**Status: NOT GREEN.** Acceptance criterion §12.12 requires a green suite; pre-existing
provenance explains the failures but does not satisfy the criterion. Tracking them as
release-blocking debt, not as accepted state.

---

## 10. Section Sign (`§`, U+00A7) Policy

**Finding: no defect.** Inventory of tracked text found UTF-8 sinks only; no `§` is
written to a non-UTF-8 sink, and no `§` churn was introduced in files that already
carried it. Policy documented per plan §14.

**Asset re-render: UNVERIFIED.** All five registered faces
(`KonohaTitle`, `KonohaBold`, `KonohaSans`, `KonohaMono`, `KonohaMonoBold`, from
`/usr/share/fonts/truetype/dejavu/`) report `U+00A7 True` per `fontTools`, and an
isolated canvas render distinguishes `§` (142 ink px) from a missing-glyph box (133 ink
px). However, re-running `scripts/generate_premium_flow_gifs.js` changed
`konoha-kage-gate.webp` from 2400×1520 to 2400×1350 — the committed assets (2026-11-07)
postdate the generator script (2026-11-04), so the current script does **not** reproduce
the shipped assets. The generated files were reverted rather than committed as false
verification. No unchanged shipped asset was re-rendered and visually confirmed.

---

## 11. Unavailable Gates

| Gate | Reason |
|---|---|
| Kage review (`confidence ≥ 98`, `ai_slop_findings = 0`) | No `konoha.*` / `sannin` MCP tool mounted in this session |
| Clean-container install | No clean Ubuntu container available |
| Shipped `§` asset re-render | Committed WebP assets postdate the generator; running it changes output dimensions |
| Full suite green | 19 pre-existing failures, reproduced at baseline |

These are recorded as unavailable or failing. None is claimed as passed.

---

## 12. Remediation Ledger

| Phase | Commit | Change |
|---|---|---|
| 1 | `d7d708a4` | Red-skill root classification, resolve-before-authorize |
| 2 | `93022772` | Privileged-pattern audit, two blue skills neutralized |
| 3 | `54b67947` | Schema/app version separation |
| 4 | `138ea63e` | Schema audit + doctor schema/app reporting |
| 5 | `891d2f45`, `94b47720`, `8ac4230b` | Lab isolation I1–I10 |
| 6 | `b9c47ad6` | `kali_tools` provenance, no drop |
| 7 | `e7da9610` | Cyber pack opt-in, VPS-safe default install |
| 8 | `5af872e1` | Audit pass 2, traceability gaps closed |
| 9 | `2a9b72c8` | Legacy cyber-row purge on upgrade, verification |

All commits are local, authored by `andycungkrinx91 <andy.silva270114@gmail.com>`. No
tag, push, or publish occurred.