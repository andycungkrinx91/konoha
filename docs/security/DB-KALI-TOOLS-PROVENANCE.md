# `kali_tools` — provenance audit and disposition

Plan reference: §7. Audit scope: the `kali_tools` table observed in the developer's
live `~/.konoha/konoha.db`. **No live database was modified by this audit.**

## 1. Evidence base

| Item | Value |
|------|-------|
| Snapshot method | `VACUUM INTO '/tmp/konoha-phase6/live-copy.db'` from the live DB, read-only connection |
| Snapshot size | 88.5 MiB, byte-stable copy |
| Live table rows | 361 |
| `MIN(id)` / `MAX(id)` | `0trace` / `zsh-syntax-highlighting` |
| `id` range anomalies | 0 rows outside the seeded set |
| Indexes | `sqlite_autoindex_kali_tools_1`, `sqlite_autoindex_kali_tools_2`, `idx_kali_tools_category`, `idx_kali_tools_slug` |

DDL as observed:

```sql
CREATE TABLE kali_tools (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    package TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    url TEXT
)
```

## 2. Consumer audit

`rtk grep -rn 'kali_tools' src bin scripts tests`:

| Role | Location | Which DB |
|------|----------|----------|
| DDL | `src/workflow/akatsuki/lab_db.js:55-68` | lab |
| Seed | `src/workflow/akatsuki/lab.js#_seedLabKaliTools` (called from `lab_db.js#openLabDb`) | lab |
| Reader | `src/workflow/akatsuki/init.js#_queryKaliToolsFromDb` → `openLabDb()` | lab |
| Index | `lab_db.js:75-77` (`idx_lab_kali_tools_slug`) and the table's own `UNIQUE`/index set | lab |
| Assertion | `tests/test_akatsuki_init.js:40` — main DB must **not** define `kali_tools` | main (negative) |
| Assertion | `tests/test_akatsuki_skill_authz_db_isolation.js:351` — lab tables are exactly the four lab tables | lab |

**Main-DB readers: zero.** `src/db_schema.js` contains no `kali_tools` reference in the
current tree; `git log -S kali_tools -- src/db_schema.js` shows the last touch was the
`a7c0e153 fixing bug installer` commit that also reshaped the installer. The table survives
in the live file as residue from an earlier schema generation, not from current DDL.

## 3. Row comparison

Compared against two independent references:

| Reference | Rows | Field mismatches vs live |
|-----------|------|--------------------------|
| `src/templates/akatsuki_lab/kali_tools.json` | 361 | 0 |
| Lab DB seeded by `openLabDb()` on a throwaway root | 361 | 0 |

Comparison covered `slug`, `name`, `package`, `category`, `description`, `url` per row, plus
set equality in both directions:

- in catalog, missing from live: **0**
- in live, absent from catalog: **0**

Disposition branch from plan §7.4 is therefore **(a): identical to the JSON**. No local
additions exist, so nothing is user data and nothing needs migrating to the lab DB.

## 4. Disposition

**Not executed, by design.** Plan §7 states "do not schedule a drop", and §7.4's deletion
procedure is conditional on explicit authorisation. This audit stops at the evidence boundary:

- The lab DB already holds a complete, field-identical 361-row catalog, seeded on every
  `openLabDb()` when the table is empty.
- No code path reads the main-DB table.
- A fresh `setupSchema` does not create it (33 tables, verified; see
  `tests/test_schema_migrations_and_lifecycle.js`).
- The only remaining occurrence is in the developer's live file.

If and when removal is authorised, the plan's procedure is the one to follow:
`VACUUM INTO` a verified backup (the snapshot above is exactly that artefact), then
`DELETE FROM kali_tools` in a single transaction on the live DB with before/after counts
recorded. This document is the evidence package for that decision; it does not perform it.

## 5. What was changed in-tree

Only the canonical-schema test:

- `tests/test_schema_migrations_and_lifecycle.js` now asserts that a fresh `setupSchema`
  produces exactly **33** tables, that none of `kali_tools`, `lab_runs`,
  `lab_tool_invocations`, `red_skill_audit` appear, and that `_sqliteai_vector` is absent
  from base DDL (extension-owned runtime state).

That test is the guard against the table ever reappearing in new installs. Existing installs
are not touched.

## 6. `_sqliteai_vector`

Extension-owned. Created by `src/vector_extension.js#initVectorExtension` only when the
extension loads, and dropped/recreated by SQLite-AI. It is runtime state, not schema, and no
action is required.

Table counts, measured on the same snapshot and on a fresh `setupSchema`:

| Store | `sqlite_master` tables (all) | Excluding `sqlite_%` |
|-------|------------------------------|----------------------|
| Fresh `setupSchema` | 33 | 32 |
| Live (isolated copy) | 35 | 34 |

The two-entry diff in the user-table count is exactly `kali_tools` + `_sqliteai_vector`.
`_sqliteai_vector` is runtime state owned by the extension; `kali_tools` is the only residue.
The `+1` in each row is `sqlite_sequence`, which SQLite creates for the `AUTOINCREMENT`
tables.