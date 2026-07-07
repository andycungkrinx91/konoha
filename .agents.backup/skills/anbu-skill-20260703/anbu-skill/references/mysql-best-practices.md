# MySQL Best Practices

> Read when: designing MySQL schemas, writing MySQL queries, reviewing indexes, tuning performance, planning migrations, or preparing MySQL for production.

## Contents

- [Schema Design](#schema-design)
- [Indexes](#indexes)
- [Query Performance](#query-performance)
- [Transactions](#transactions)
- [Constraints](#constraints)
- [Migrations](#migrations)
- [Connection Pooling](#connection-pooling)
- [Backups](#backups)
- [Security](#security)
- [EXPLAIN Usage](#explain-usage)
- [Common Anti-Patterns](#common-anti-patterns)
- [Production Checklist](#production-checklist)

## Schema Design

- Use InnoDB by default for ACID transactions and row-level locking.
- Use `utf8mb4` for full Unicode support.
- Use the smallest data type that safely fits.
- Use `DECIMAL` for money, not `FLOAT`/`DOUBLE`.
- Prefer `DATETIME`/`TIMESTAMP` consistently with timezone strategy documented.

```sql
CREATE TABLE orders (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id BIGINT UNSIGNED NOT NULL,
  total_amount DECIMAL(12, 2) NOT NULL,
  status ENUM('pending','paid','shipped','cancelled') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  INDEX idx_orders_customer_created (customer_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

## Indexes

- Index columns used in `WHERE`, `JOIN`, `ORDER BY`, and high-cardinality filters.
- Order composite indexes by equality filters, then range/order columns.
- Use covering indexes for hot queries when practical.
- Avoid redundant and unused indexes.
- Use FULLTEXT for natural-language text search.

## Query Performance

- Reject `SELECT *` in production paths; explicitly select required columns.
- Use keyset pagination for large offsets.
- Avoid functions on indexed columns in predicates.
- Avoid implicit type conversion.
- Keep joins supported by indexes on both sides.

```sql
-- Prefer range query over YEAR(created_at)
SELECT id, total_amount
FROM orders
WHERE created_at >= '2026-01-01' AND created_at < '2027-01-01';
```

## Transactions

- Keep transactions short.
- Access rows in consistent order to reduce deadlocks.
- Retry deadlocks at the application layer.
- Pick isolation level deliberately; default `REPEATABLE READ` may surprise teams expecting `READ COMMITTED`.

## Constraints

- Use `NOT NULL`, `UNIQUE`, foreign keys, and `CHECK` constraints where supported.
- Ensure foreign keys are indexed to prevent table scans during cascading deletes or joins.
- Keep application validation and database constraints aligned.
- Avoid relying on app code alone for data integrity.

## Migrations

- Make migrations reversible where possible.
- Plan large table changes with online DDL strategy.
- Backfill in batches.
- Add nullable columns first, deploy code, backfill, then enforce `NOT NULL`.
- Review locks and replication impact before production migration.

## Connection Pooling

- Use framework/driver pool settings rather than creating connections per request.
- For highly concurrent systems, consider an external connection pooler (e.g. ProxySQL).
- Set max pool size according to DB capacity, not app instance count alone.
- Configure timeouts and connection lifetime.
- Monitor connection saturation.

## Backups

- Test restore, not just backup creation.
- Use point-in-time recovery/binlogs for production.
- Encrypt backups and restrict access.
- Document RPO/RTO.

## Security

- Use parameterized queries/prepared statements.
- Grant least-privilege roles per app/service.
- Do not use root users from applications.
- Require TLS for remote DB connections.
- Rotate credentials and avoid logging query parameters with secrets.

## EXPLAIN Usage

```sql
EXPLAIN FORMAT=JSON
SELECT c.id, COUNT(o.id)
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.created_at >= '2026-01-01'
GROUP BY c.id;
```

Review:
- table access type (`ALL` often indicates scan);
- chosen key;
- rows examined;
- temporary tables/filesort;
- whether predicates are indexable.

## Common Anti-Patterns

- Leading wildcard search (`LIKE '%term%'`) on large tables.
- Storing UUID strings as `CHAR(36)` when `BINARY(16)` is needed for hot indexes.
- Missing composite indexes for multi-column filters.
- Unbounded list endpoints.
- Financial values in floating point columns.
- JSON used as an escape hatch for relational data that needs constraints.

## Production Checklist

- [ ] InnoDB and `utf8mb4` used.
- [ ] Query plans checked for critical queries.
- [ ] Indexes match real access patterns.
- [ ] Constraints enforce important invariants.
- [ ] Migrations reviewed for locks/backfill.
- [ ] Connection pooling configured.
- [ ] Backups and restore drills documented.
- [ ] Least-privilege users and TLS configured.
