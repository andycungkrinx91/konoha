# SQLite Database Expert

> Read when: using SQLite for local-first apps, embedded databases, desktop/mobile apps, small production services, schema design, migrations, WAL mode, indexes, FTS5, backups, or SQLite performance/security.

## Contents

- [When SQLite Is Appropriate](#when-sqlite-is-appropriate)
- [Schema Design](#schema-design)
- [Migrations](#migrations)
- [Indexes](#indexes)
- [WAL Mode](#wal-mode)
- [Transactions](#transactions)
- [Concurrency Limits](#concurrency-limits)
- [Backups](#backups)
- [Local-First Use Cases](#local-first-use-cases)
- [Security](#security)
- [Performance](#performance)
- [Production Caveats](#production-caveats)

## When SQLite Is Appropriate

Good fit:
- desktop/mobile/local-first apps;
- embedded app storage;
- test databases;
- small services with modest write concurrency;
- cache/configuration data;
- edge deployments with local persistence.

Poor fit:
- high write concurrency across many app servers;
- complex role/permission needs inside the DB;
- managed multi-tenant SaaS requiring central DB operations;
- large analytics workloads.

## Schema Design

- Enable foreign keys.
- Use constraints for invariants.
- Use `INTEGER PRIMARY KEY` for rowid-backed IDs.
- Store timestamps consistently (ISO-8601 UTC text or integer epoch).

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

## Migrations

- Track schema version in a migrations table or `PRAGMA user_version`.
- Wrap migrations in transactions.
- For complex column changes, create new table → copy data → swap tables.
- Backup before destructive migrations.

## Indexes

- Index foreign keys and frequent filters.
- Use composite indexes matching query predicates.
- Use FTS5 for full-text search instead of `%LIKE%` scans.

```sql
CREATE INDEX idx_notes_user_created ON notes(user_id, created_at DESC);

CREATE VIRTUAL TABLE notes_fts USING fts5(title, body, content=notes, content_rowid=id);
```

## WAL Mode

WAL mode is MANDATORY for any production or concurrent workload. It dramatically improves concurrent read/write behavior.

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
```

Set PRAGMAs at connection initialization and document why they are safe for the app.

## Transactions

- Wrap related writes in a single transaction.
- Keep transactions short.
- Use prepared statements for repeated inserts.
- Batch writes where possible.

```sql
BEGIN IMMEDIATE;
UPDATE accounts SET balance = balance - ? WHERE id = ?;
UPDATE accounts SET balance = balance + ? WHERE id = ?;
COMMIT;
```

## Concurrency Limits

- Many readers are fine; only one writer at a time.
- Use `busy_timeout` and retry logic for write contention.
- Avoid long-running write transactions.
- For multi-process apps, test locking behavior on target OS/filesystem.

## Backups

- Use SQLite backup API or safe file copy when DB is quiescent.
- Include `-wal` and `-shm` files when copying an active WAL database, or checkpoint first.
- Test restore.
- Encrypt backups if they contain sensitive local data.

## Local-First Use Cases

- Keep sync metadata columns (`updated_at`, `deleted_at`, `sync_version`).
- Model conflict resolution explicitly.
- Use durable local migrations because users may skip many app versions.
- Keep a recovery/export path for user data.

## Security

- Always use parameterized queries.
- Whitelist dynamic identifiers such as sort columns.
- Avoid exposing raw DB errors to users.
- Restrict file permissions for database files.
- Consider SQLCipher or platform encryption for sensitive data at rest.

```sql
-- parameterized at driver layer
SELECT id, email FROM users WHERE id = ?;
```

## Performance

- Use `EXPLAIN QUERY PLAN` for hot queries.
- Avoid `LIKE '%term%'` on large tables; use FTS5.
- Avoid N+1 reads from app code.
- Run `ANALYZE` after large data changes.
- Consider `VACUUM` for reclaiming space when appropriate.

## Production Caveats

- SQLite is reliable, but operational assumptions differ from client-server DBs.
- Network filesystems can break locking semantics.
- Backups and migrations are app responsibilities.
- If write concurrency or centralized access grows, plan migration to PostgreSQL/MySQL.
