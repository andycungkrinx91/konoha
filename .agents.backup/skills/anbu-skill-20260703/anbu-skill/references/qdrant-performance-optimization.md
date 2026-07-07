# Qdrant Performance Optimization (Vector DB + RAG Latency)

## Contents

- Performance Model: Latency vs Throughput
- Collection and Vector Design
- HNSW Tuning (`m`, `ef_construct`, `hnsw_ef`)
- Index Build Behavior and `indexing_threshold`
- Payload Indexes and Filtered Search
- Ingestion Throughput (Batching + Parallelism)
- Shards, Replicas, and Capacity Planning
- Quantization and Memory Tradeoffs
- On-Disk vs RAM Strategy
- Memory: RSS vs Page Cache Expectations
- RAG Latency Optimization Pattern
- Optimizer Status and Safety Flags
- Backups, Snapshots, and Recovery
- Common Anti-Patterns
- Production Checklist

## Performance Model: Latency vs Throughput

Define success criteria first:

- Query p95/p99 latency by route (semantic search, filtered retrieval, rerank feed).
- Throughput target (QPS) under realistic concurrency.
- Recall/quality tolerance for approximation and quantization.

Tune for one dimension at a time:

- Lower latency often costs throughput and memory.
- Higher throughput often requires larger batches, more shards, or replicas.

## Collection and Vector Design

- Keep embedding model + vector dimension stable per collection.
- Validate distance metric compatibility (cosine/dot/euclidean) with embeddings.
- Avoid mixing incompatible embedding generations in one collection.
- Keep payload fields typed and predictable for filtering.

Design rule:

- Separate collections when index strategy/filter usage is materially different.

## HNSW Tuning (`m`, `ef_construct`, `hnsw_ef`)

- `m`: graph connectivity; higher improves recall, increases memory/build cost.
- `ef_construct`: build-time quality; higher improves recall, slower indexing.
- `hnsw_ef`: query-time candidate breadth; higher improves recall, increases latency.

Practical flow:

1. Start conservative defaults.
2. Sweep `hnsw_ef` to hit recall target.
3. If recall still weak, increase `m`/`ef_construct` and rebuild.
4. Re-check memory budget before production rollout.

## Index Build Behavior and `indexing_threshold`

- `indexing_threshold` determines when vectors get indexed.
- Too high threshold can delay optimized search readiness.
- Too low threshold may impact ingestion speed during bursts.

Operational pattern:

- Keep threshold aligned with ingestion profile.
- For strict latency SLOs, validate index readiness before serving traffic.

## Payload Indexes and Filtered Search

- Add payload indexes for filter fields used in production queries.
- Build payload indexes before high-volume filtered ANN traffic.
- For filter-heavy workloads, create payload indexes before final HNSW tuning so benchmarks reflect real execution paths.
- Validate query plans by load testing filtered routes specifically.

For strict behavior:

- Use `indexed_only`/`prevent_unoptimized` modes where supported by your deployment policy to avoid accidental slow fallback behavior.

## Ingestion Throughput (Batching + Parallelism)

- Batch upserts in the **64-256** range as a starting point.
- Use **2-4 parallel streams** to increase throughput without overload.
- Measure end-to-end ingestion latency, not only request duration.
- Apply backpressure/retry with jitter; avoid unbounded producer bursts.

## Shards, Replicas, and Capacity Planning

- Increase shards for distribution and parallel search at scale.
- Use replicas for read availability and throughput.
- Validate consistency and failover behavior for your SLA.
- Reassess shard count as dataset grows; avoid excessive tiny shards.

## Quantization and Memory Tradeoffs

- Quantization can reduce RAM and improve throughput.
- Measure recall impact on business metrics before enabling broadly.
- Consider staged rollout by collection to control risk.

## On-Disk vs RAM Strategy

- RAM-centric setup favors low-latency query response.
- On-disk modes reduce memory pressure but can increase tail latency.
- Match storage strategy to retrieval SLO and cost constraints.

## Memory: RSS vs Page Cache Expectations

- Track process RSS and host page cache jointly.
- Distinguish true memory leak signals from cache growth.
- Ensure headroom for compactions, index updates, and burst traffic.

## RAG Latency Optimization Pattern

For retrieval-augmented generation pipelines:

1. Keep query-time filters indexed and minimal.
2. Tune `hnsw_ef` to meet recall target with acceptable latency.
3. Avoid oversized top-k retrieval when reranker budget is fixed.
4. Cache stable retrieval contexts where correctness permits.
5. Profile full path: embed -> search -> rerank -> generation.

## Optimizer Status and Safety Flags

- Monitor optimizer/indexing status continuously.
- Block or divert traffic when collections are unoptimized for strict SLO routes.
- Use operational flags/policies that prevent serving unoptimized search in production-sensitive paths.

## Backups, Snapshots, and Recovery

- Schedule regular snapshots with retention policy.
- Test restore on representative collections and payload filters.
- Validate restore time against RTO and data loss against RPO.
- Secure snapshot storage and access permissions.

## Common Anti-Patterns

- Tuning only for max QPS without recall/latency SLO.
- Skipping payload indexes while relying on heavy filters.
- Single giant ingestion stream causing lock/contention spikes.
- Setting `hnsw_ef` excessively high without business recall gain.
- Ignoring optimizer readiness before serving production traffic.
- Treating memory usage as one number without RSS/page-cache breakdown.

## Production Checklist

- [ ] Latency and throughput SLOs are explicit by query class.
- [ ] Vector dimensions, metric, and collection boundaries are validated.
- [ ] HNSW parameters tuned with measured recall/latency tradeoffs.
- [ ] `indexing_threshold` and index readiness verified for serving paths.
- [ ] Payload indexes exist for production filters.
- [ ] Ingestion uses 64-256 batching and 2-4 controlled parallel streams.
- [ ] Shard/replica strategy aligns with scale and availability goals.
- [ ] Quantization/on-disk choices validated against quality and tail latency.
- [ ] Memory monitoring includes RSS + page cache and alert thresholds.
- [ ] Snapshot/restore drill passes RTO/RPO targets.
- [ ] Anti-pattern checks completed for RAG latency-sensitive routes.
