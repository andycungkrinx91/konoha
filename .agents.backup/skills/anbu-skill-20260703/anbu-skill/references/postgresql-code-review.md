# PostgreSQL Code Review

> Read when: reviewing PostgreSQL SQL, migrations, schema design, indexes, query plans, transaction safety, RLS policies, or PostgreSQL-specific performance/security concerns.

## Contents

- [Review Output Format](#review-output-format)
- [SQL Correctness](#sql-correctness)
- [Index Review](#index-review)
- [Query Performance](#query-performance)
- [Transaction Safety](#transaction-safety)
- [Locking and Deadlocks](#locking-and-deadlocks)
- [Migrations](#migrations)
- [Constraints](#constraints)
- [Security and SQL Injection](#security-and-sql-injection)
- [Row Level Security](#row-level-security)
- [EXPLAIN ANALYZE Review](#explain-analyze-review)
- [Concrete Fix Examples](#concrete-fix-examples)

## Review Output Format

```text
severity | location | issue | impact | concrete fix
```

Severity:
- Critical: injection, data exposure, destructive migration, broken RLS.
- High: table-wide locks on hot tables, missing tenant filter, severe query plan regression.
- Medium: missing indexes/constraints, inefficient JSONB/array usage, unsafe transaction pattern.
- Low: style, naming, minor maintainability.

## SQL Correctness

- Verify joins preserve intended cardinality.
- Check NULL semantics (`NOT IN` with NULL, `LEFT JOIN` filters in `WHERE`).
- Confirm time zones use `TIMESTAMPTZ` for instants.
- Use `CITEXT` or normalized unique index for case-insensitive emails.
- Reject `SELECT *` in application queries; always use explicit column lists.

## Index Review

- Match indexes to real predicates and sort order.
- Ensure foreign keys are backed by an index to prevent full table locks during cascading operations.
- Use B-tree for equality/range, GIN for JSONB/arrays/full-text, GiST/SP-GiST for ranges/geospatial where appropriate.
- Avoid duplicate or unused indexes.
- Use partial indexes for filtered hot paths.

```sql
CREATE INDEX CONCURRENTLY idx_orders_open_account
ON orders (account_id, created_at DESC)
WHERE status = 'open';
```

## Query Performance

- Watch sequential scans on large tables.
- For highly concurrent systems, require connection pooling (e.g., PgBouncer or Prisma Accelerate).
- Prefer keyset pagination for deep lists.
- Use JSONB containment operators with GIN indexes when querying JSONB.
- Avoid CTE materialization surprises on older PostgreSQL versions.
- Ensure `ORDER BY` can use an index when combined with `LIMIT`.

## Transaction Safety

- Keep transactions short.
- Use consistent row access order.
- Avoid network/API calls inside open transactions.
- Use `SELECT ... FOR UPDATE` only when row locking is required.
- Ensure retries for serialization failures/deadlocks where appropriate.

## Locking and Deadlocks

- Review migrations for lock level.
- Use `CREATE INDEX CONCURRENTLY` for large production tables.
- Add `NOT VALID` constraints first, then `VALIDATE CONSTRAINT` for safer rollout.
- Avoid long-running DDL in peak traffic windows.

## Migrations

Safe migration sequence:
1. add nullable column/default-free metadata change;
2. deploy code writing both old/new if needed;
3. backfill in batches;
4. add constraints/indexes concurrently or with validation strategy;
5. clean up old column later.

## Constraints

- Use `NOT NULL`, `UNIQUE`, `CHECK`, and foreign keys for invariants.
- Use domains/enums only when lifecycle is well understood.
- Validate JSONB structure with CHECK constraints when it affects logic.

## Security and SQL Injection

- Queries must be parameterized.
- Dynamic identifiers must be whitelisted, not user-concatenated.
- App roles should have least privilege.
- Avoid granting broad schema/table privileges.

## Row Level Security

Use RLS for multi-tenant or user-scoped data where database-level enforcement is needed.

```sql
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON documents
USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

Review that the app reliably sets required session variables and tests denied access.

## EXPLAIN ANALYZE Review

Ask for `EXPLAIN (ANALYZE, BUFFERS)` on real-ish data for performance claims.

Check:
- estimated vs actual rows;
- node timing and loops;
- buffers read/hit;
- sort/hash spill to disk;
- index condition vs filter;
- nested loop over unexpectedly large rows.

## Concrete Fix Examples

JSONB query:

```sql
CREATE INDEX idx_orders_data_gin ON orders USING gin (data);
SELECT id, data FROM orders WHERE data @> '{"status":"shipped"}';
```

Case-insensitive email:

```sql
CREATE EXTENSION IF NOT EXISTS citext;
ALTER TABLE users ALTER COLUMN email TYPE citext;
CREATE UNIQUE INDEX CONCURRENTLY users_email_unique ON users (email);
```

Safe enum-like check:

```sql
ALTER TABLE transactions
ADD CONSTRAINT transactions_status_check
CHECK (status IN ('pending', 'completed', 'failed')) NOT VALID;
ALTER TABLE transactions VALIDATE CONSTRAINT transactions_status_check;
```
