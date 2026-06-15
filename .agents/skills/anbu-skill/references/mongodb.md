# MongoDB Engineering and Security Guide

> Read when: user asks about MongoDB schema/modeling, indexes, aggregation, production tuning, or MongoDB security hardening.

## Contents

- When to use
- Schema and document modeling
- Collections and document design
- Validation and safe serialization
- Index strategy
- Aggregation pipeline patterns
- Query performance and diagnostics
- Transactions and consistency
- Connection pooling and timeouts
- Bulk operations and migrations
- Backup and restore
- Replica sets and high availability
- Sharding and scale-out
- Security hardening
- Authentication, authorization, RBAC
- Network exposure and TLS
- Secrets and configuration safety
- NoSQL injection prevention
- Atlas Search / Vector Search notes
- Production checklist
- Review checklist

## When to Use

Use this reference for MongoDB-specific design, performance, and security reviews in application or infrastructure contexts.

## Schema and Document Modeling

Design rules:
- Model by access patterns, not by strict normalization defaults.
- **Embed** when data is read together and bounded in size.
- **Reference** when data grows independently, is reused heavily, or needs separate lifecycle.
- Keep document growth predictable; avoid unbounded arrays in hot paths.

Practical examples:
- Embed: order with immutable line-item snapshot.
- Reference: user profile referenced by many collections.

## Collections and Document Design

- Use explicit field types and constraints at application boundary.
- Keep required fields explicit; avoid sparse ungoverned schemas for critical entities.
- Use timestamps (`createdAt`, `updatedAt`) consistently.
- Prefer immutable audit records over destructive overwrites.

## Validation and Safe Serialization

Application/ODM guidance (Mongoose-like patterns):
- Enforce schema validation and custom validators for complex constraints.
- Mark sensitive fields with `select: false` (e.g., password hash, API tokens).
- Use `toJSON`/`toObject` transforms to remove internal/sensitive fields.
- Reject unknown fields for sensitive writes where feasible.

## Index Strategy

Review index coverage for real query shapes:
- **Compound** indexes ordered by equality filters first, then range/sort.
- **Unique** indexes for business invariants.
- **Partial** indexes for selective subsets.
- **TTL** indexes for ephemeral/session/event retention.
- **Text** indexes for basic full-text search.
- **Geospatial** indexes for location queries.

Notes:
- Avoid index bloat from unused indexes; periodically review usage.
- Match sort direction and prefix usage to query patterns.

## Aggregation Pipeline Patterns

Common stages to review:
- `$match` early to reduce working set.
- `$project` to trim fields before expensive stages.
- `$group` only after filters; monitor memory impact.
- `$lookup` carefully; index join keys on both sides.
- `$unwind` can multiply documents; use intentionally.
- `$facet` is powerful but can be expensive.

## Query Performance and Diagnostics

Operational patterns:
- Use projection (`select`) to reduce payload size.
- Use `lean()` where model hydration is unnecessary.
- Use cursor-based iteration for large result sets.
- Use `bulkWrite` for batched writes.
- Validate hot queries with `explain("executionStats")`.

Red flags:
- Collection scans on high-traffic paths.
- Regex without anchors/index support.
- Large skip/limit pagination at deep offsets.

## Transactions and Consistency

Use transactions when multi-document invariants must hold.
- Start session explicitly.
- Keep transactions short; avoid long business logic inside transaction blocks.
- Define retry behavior for transient commit/lock conflicts.

## Connection Pooling and Timeouts

Recommended controls:
- Set bounded `maxPoolSize` and reasonable `minPoolSize`.
- Configure `serverSelectionTimeoutMS` and `socketTimeoutMS`.
- Avoid creating per-request client connections.
- Reuse singleton client/connection per process.

## Bulk Operations and Migrations

- Prefer idempotent migration scripts with checkpoints.
- For large backfills, process in controlled batches with resume capability.
- Use rolling migration patterns to maintain backward compatibility.
- Validate migration impact with sampled reads and metrics.

## Backup and Restore

- Define RPO/RTO and align backup frequency.
- Test restore regularly (not just backup success signals).
- Protect backups with encryption and strict access controls.
- For critical workloads, keep immutable/offsite backup copies.

## Replica Sets and High Availability

- Use replica sets for HA and failover.
- Monitor replication lag and election events.
- Tune read/write concerns to business consistency needs.
- Validate failover runbooks in staging.

## Sharding and Scale-Out

- Shard only when justified by data/throughput growth.
- Choose shard keys with high cardinality and good distribution.
- Avoid monotonically increasing shard keys causing hotspots.
- Review balancing behavior and chunk distribution regularly.

## Security Hardening

- Enable authentication; never run production in open mode.
- Enforce least-privilege users/roles.
- Require TLS for client and intra-cluster communication.
- Restrict network access to private boundaries.
- Enable auditing where compliance/risk requires it.

## Authentication, Authorization, RBAC

- Separate roles for app runtime, migration jobs, and admins.
- Grant only required actions on required databases/collections.
- Rotate credentials regularly and on personnel changes.
- Use temporary credentials where platform supports it.

## Network Exposure and TLS

- Bind to private interfaces only.
- Restrict ingress via security groups/firewalls/IP allowlists.
- Disable public admin surface unless explicitly required.
- Validate certificate lifecycle and expiry monitoring.

## Secrets and Configuration Safety

- Store credentials in secret managers, not source control.
- Avoid logging connection URIs with embedded credentials.
- Set environment-specific configs without insecure defaults.
- Protect config files and backups via file/role permissions.

## NoSQL Injection Prevention

Defensive rules:
- Validate and type-cast all user-supplied filters.
- Disallow arbitrary operator injection (`$ne`, `$where`, etc.) from user input.
- Use allowlists for dynamic sort/filter fields.
- Treat regex input as untrusted; constrain patterns and flags.

## Atlas Search / Vector Search Notes

- Use Atlas Search/Vector Search when retrieval requirements exceed basic text/metadata filtering.
- Validate index definitions against query intent and latency targets.
- Enforce access controls on retrieval sources to prevent cross-tenant leakage.

## Production Checklist

- [ ] Data model reviewed with embed vs reference rationale.
- [ ] Index coverage verified for all high-traffic queries.
- [ ] `explain("executionStats")` reviewed for top slow queries.
- [ ] Pool sizing and timeout settings tuned for expected concurrency.
- [ ] Backup + restore tested with documented RPO/RTO.
- [ ] Replica/failover behavior validated; lag/election alerts configured.
- [ ] Sharding strategy justified and monitored (if enabled).
- [ ] Auth, RBAC, TLS, network restrictions, and secrets management enforced.
- [ ] NoSQL injection defenses validated in API/query builder code.

## Review Checklist

- [ ] Schema validators prevent invalid/unsafe data shapes.
- [ ] Sensitive fields are excluded by default (`select: false`) and scrubbed in serialization transforms.
- [ ] Queries avoid over-fetch and large in-memory operations where possible.
- [ ] Aggregations place `$match` early and avoid unnecessary fan-out.
- [ ] Transactions used only where invariants require them.
- [ ] Migrations are reversible/idempotent with safe rollout and rollback.
- [ ] Logging/metrics include slow ops, connection pressure, errors, and auth failures.
