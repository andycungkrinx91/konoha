# Database Isolation Inventory

The Akatsuki Lab has its own SQLite database. It is not a schema inside `konoha.db`, not a table prefix, and not a connection with a mode flag. The two files never share a connection, a migration, or a backup.

## Stores

| Store | Path | Resolver | Schema owner |
|-------|------|----------|--------------|
| Main DB | `KONOHA_DB_PATH` or `~/.konoha/konoha.db` | `src/db.js#getConnection` | `src/db_schema.js#setupSchema` |
| Lab DB | `KONOHA_LAB_DB_ROOT` + `lab.db`, default `~/.konoha/akatsuki-lab/lab.db` | `src/workflow/akatsuki/lab_db.js#getLabDbPath` | `src/workflow/akatsuki/lab_db.js#setupLabSchema` |

`KONOHA_AKATSUKI_LAB_DB` overrides the explicit file path, but only through `assertLabDbPath` — an override pointing outside the lab root, or at the main DB, throws.

## Boundary enforcement

| Guard | Location | Behavior |
|-------|----------|----------|
| Persona-memory writes | `src/workflow/kage-reviewer/skill_guardian.js` | Passes `db.DB_PATH` (main connection getter) explicitly; never inherits a lab path |
| `isLabDbPath(p)` | `src/skill_authorization.js` | True only when `p` resolves strictly under `KONOHA_LAB_DB_ROOT` and is not the main DB path |
| `assertLabDbPath(p)` | `src/skill_authorization.js` | Throws `LAB_DB_ISOLATION_VIOLATION` |
| `openRawConnection(dbPath)` | `src/db.js` | Opens an explicit path with pragmas only: no legacy skills migration, no vector setup, no `KONOHA_DB_PATH` inheritance |
| Main connector guard | `src/db.js#getConnection` | Throws `LAB_DB_ISOLATION_VIOLATION: Use lab_db.openLabDb() for lab paths.` for any lab path |
| `openLabDb()` | `src/workflow/akatsuki/lab_db.js` | Asserts the path, then opens via `openRawConnection`; never reads `KONOHA_DB_PATH` |
| Lab child env | `src/workflow/akatsuki/lab.js#_labChildEnv` | Every `lxc`/`docker` child gets `KONOHA_DB_PATH` pinned to the lab DB |

The guards are path-based, so a config flag, an option object, or an environment variable cannot move a lab write into the main store. The main connector refuses lab paths; the lab opener refuses everything else.

## Schemas

Lab DB (`setupLabSchema`) creates exactly four tables:

| Table | Purpose |
|-------|---------|
| `lab_runs` | One row per sandboxed red/blue execution: `lab_name`, `engine`, `workflow`, `started_at` |
| `lab_tool_invocations` | One row per tool invocation inside the sandbox |
| `kali_tools` | Lab-local Kali catalog, seeded once from the bundled `kali_tools.json` (360+ rows) |
| `red_skill_audit` | Red-skill authorization decisions: `allowed`/`denied`, code, reason, surface. Appended by `auditRedSkill` through a caller-supplied connection, or an existing-file-only open (`openLabAuditConnection`) that cannot create the store |

The lab DB has no `skills`, `agents`, `tasks`, `persona_memories`, or `prompt_queue` tables. The main DB no longer defines `kali_tools` at all — the catalog lives only here, so `listKaliTools` reads `openLabDb()` and returns nothing if the table is absent. Nothing in the Akatsuki tree calls `setupSchema` on the main connection.

## Lifecycle

| Phase | Main DB | Lab DB |
|-------|---------|--------|
| Provision | untouched | created on first `openLabDb()` / `setupLabSchema` |
| Execute | untouched | writes `lab_runs` / `lab_tool_invocations` |
| Teardown (`cleanup_confirmed === true`) | untouched | `purgeLabDb()` deletes `lab.db`, `lab.db-wal`, `lab.db-shm` |
| Teardown failure | untouched | retained for post-mortem; no automatic purge |
| Backup | `backupDatabase` via `getConnection` | none by design — nothing worth preserving, and a backup path would create a second write surface |

Teardown purge is best-effort by construction: a failed unlink leaves the file in the lab root, where no main-DB reader can reach it.

## Templates

`src/templates/akatsuki_lab/` (`docker/`, `lxc/`, `kali_tools.json`) contains no reference to `konoha.db`, `KONOHA_DB_PATH`, `persona_memories`, or `~/.konoha/`. Enforced by test F30, so a future template edit that tries to reach the main store fails CI.

## Verification

`tests/test_akatsuki_skill_authz_db_isolation.js` sections E–G:

- distinct realpaths for main and lab files
- lab schema is exactly `lab_runs` + `lab_tool_invocations` + `kali_tools` + `red_skill_audit`
- main schema has no lab tables (including `kali_tools` and `red_skill_audit`), and a lab write is invisible to the main connection
- `recordRedSkillAudit` refuses to write without an already-open lab connection and never creates a lab DB
- a denied red workflow appends one `denied` row to a supplied connection, and appends nothing when none is supplied
- an allowed red workflow appends an `allowed` row carrying the identity the gate resolved
- `auditRedSkill` returns `false` and creates nothing when the lab store is absent, `true` when it writes
- lab-path override at the main DB / outside the root throws
- main connector refuses the lab path
- `openLabDb` ignores `KONOHA_DB_PATH`
- purge removes the file and both WAL sidecars
- provisioner children receive the lab path
- Windows-style, canonical, and traversal paths classify correctly
- existing-file-only open refuses to create a lab DB, including paths carrying `?`, `#`, or spaces

`tests/test_akatsuki_lab_isolation_section_i.js` section I — physical isolation, measured:

| Case | Assertion | Result |
|------|-----------|--------|
| I1 | sha256 of `konoha.db`, `-wal`, `-shm` unchanged across `initLab` + `provisionLab` (mock runner) | byte-identical |
| I2 | `initLab` completes with `db.getConnection` monkeypatched to throw; call count 0 | main connector never reached |
| I3 | confirmed teardown removes `lab.db`, `-wal`, `-shm`; main DB and its rows survive | pass |
| I4 | unconfirmed teardown (`status: 1`, `permission denied`) retains the lab DB; main DB byte-identical | pass |
| I5 | `lab.db` symlinked to `konoha.db` → `openLabDb()` throws `LAB_DB_ISOLATION_VIOLATION` | pass |
| I6 | 25 interleaved writes on both connections; counts independent; main DB has no `lab_runs` table | pass |
| I7 | reopen `openLabDb()` keeps `lab_runs` rows, seeds exactly 361 `kali_tools`, main DB unchanged | pass |
| I8 | with `KONOHA_LAB_DB_ROOT` unset, `getLabDbPath()` is `~/.konoha/akatsuki-lab/lab.db` and `getConnection()` refuses it | pass |

I1 and I2 are not vacuous: `initLab` returns `ok: true` with `status: 'created'` and `provisionLab` returns `ok: true` in the same configuration, so the provisioning path runs to completion while the main DB stays byte-identical. `initLab` does not create `lab.db` — only `openLabDb()` does — which is why I1's byte comparison is the meaningful assertion.

## Cross-platform

The guards are path arithmetic plus SQLite, so nothing is platform-specific in the enforcement
itself. Engine selection is the only per-OS branch.

| Platform | Engine | Verified by |
|----------|--------|-------------|
| Linux | LXC only, no Docker fallback | `getRequiredEngine('linux')`, `test_akatsuki_lab_isolation` |
| Windows | Docker; `where` for tool probing | `getRequiredEngine('win32')`, `where` branch in `lab.js#_probeBinary` |
| macOS | Docker | `getRequiredEngine('darwin')`, mock-runner `getLabStatus` cases |
| Anything else | `null` → prerequisite check fails closed | `getRequiredEngine('sunos')` |

Path classification is tested against Windows drive-letter paths on every platform (G32), so the
`getConnection`/`isLabDbPath` boundary does not depend on the host separator being `/`.

Schema diagram: `docs/DATABASE-ERD.md`.
