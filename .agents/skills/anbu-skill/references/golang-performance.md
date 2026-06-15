# Go Performance

> Read when: profiling Go applications, optimizing memory/CPU, tuning GC, or implementing caching patterns.

## Contents

- [Core Philosophy](#core-philosophy)
- [Decision Tree](#decision-tree)
- [Optimization Methodology](#optimization-methodology)
- [Memory Optimization](#memory-optimization)
- [CPU Optimization](#cpu-optimization)
- [I/O and Networking](#io-and-networking)
- [Runtime Tuning](#runtime-tuning)
- [Caching Patterns](#caching-patterns)
- [Observability](#observability)
- [Common Mistakes](#common-mistakes)

---

## Core Philosophy

1. **Profile before optimizing** — intuition about bottlenecks is wrong ~80% of the time. Use pprof to find actual hot spots
2. **Allocation reduction yields the biggest ROI** — Go's GC is fast but not free. Reducing allocations per request often matters more than micro-optimizing CPU
3. **Document optimizations** — add comments explaining why a pattern is faster, with benchmark numbers

### Rule Out External Bottlenecks First

Before optimizing Go code, verify the bottleneck is in your process. If 90% of latency is a slow DB query or API call, reducing allocations won't help.

- `fgprof` — captures on-CPU and off-CPU (I/O wait) time
- `go tool pprof` (goroutine profile) — many goroutines blocked in `net.(*conn).Read` = external wait
- Distributed tracing (OpenTelemetry) — span breakdown shows which upstream is slow

---

## Decision Tree

| Bottleneck | Signal (from pprof) | Action |
|---|---|---|
| Too many allocations | `alloc_objects` high in heap profile | [Memory optimization](#memory-optimization) |
| CPU-bound hot loop | function dominates CPU profile | [CPU optimization](#cpu-optimization) |
| GC pauses / OOM | high GC%, container limits | [Runtime tuning](#runtime-tuning) |
| Network / I/O latency | goroutines blocked on I/O | [I/O & networking](#io-and-networking) |
| Repeated expensive work | same computation/fetch multiple times | [Caching patterns](#caching-patterns) |
| Lock contention | mutex/block profile hot | See `golang-concurrency.md` |

---

## Optimization Methodology

### The Cycle: Define Goals → Benchmark → Diagnose → Improve → Benchmark

```bash
# 1. Define metric — latency, throughput, memory, or CPU
# 2. Measure baseline
go test -bench=BenchmarkMyFunc -benchmem -count=6 ./pkg/... | tee /tmp/report-1.txt
# 3. Diagnose — use pprof to find hot spots
# 4. Improve — apply ONE optimization with an explanatory comment
# 5. Compare
go test -bench=BenchmarkMyFunc -benchmem -count=6 ./pkg/... | tee /tmp/report-2.txt
benchstat /tmp/report-1.txt /tmp/report-2.txt
# 6. Commit — paste benchstat output in commit body
# 7. Repeat — next bottleneck
```

---

## Memory Optimization

### Slice Preallocation

```go
// ✗ Bad — grows slice with append, causes multiple allocations
var result []string
for _, item := range items { result = append(result, item.Name) }

// ✓ Good — preallocate with known length
result := make([]string, 0, len(items))
for _, item := range items { result = append(result, item.Name) }
```

### strings.Builder for Concatenation

```go
// ✗ Bad — creates a new string on every iteration
var s string
for _, item := range items { s += item.Name + "," }

// ✓ Good — single allocation
var b strings.Builder
b.Grow(len(items) * avgLen) // optional hint
for _, item := range items { b.WriteString(item.Name); b.WriteByte(',') }
result := b.String()
```

### sync.Pool for Hot-Path Allocations

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func process(data []byte) string {
    buf := bufPool.Get().(*bytes.Buffer)
    defer func() { buf.Reset(); bufPool.Put(buf) }()
    buf.Write(data)
    return buf.String()
}
```

### Struct Field Alignment

```go
// ✗ Bad — padding wastes memory (24 bytes on 64-bit)
type Bad struct { a bool; b int64; c bool }

// ✓ Good — group by size descending (17 bytes, packed)
type Good struct { b int64; a bool; c bool }
```

Check with: `go vet -fieldalignment ./...` or `fieldalignment -fix ./...`

### Backing Array Leaks

```go
// ✗ Bad — tiny slice holds reference to large backing array
func getFirst3(data []int) []int { return data[:3] }

// ✓ Good — copy to release backing array
func getFirst3(data []int) []int {
    result := make([]int, 3)
    copy(result, data[:3])
    return result
}
```

---

## CPU Optimization

### Inlining

The Go compiler inlines small functions (cost ≤ 80). Check with: `go build -gcflags="-m=2" ./...`

**What prevents inlining:** closures capturing variables, defer (sometimes), type switches, function calls over interfaces in some cases.

### Cache Locality

```go
// ✗ Bad — struct of arrays causes cache misses
type SoA struct { xs, ys, zs []float64 }

// ✓ Good — array of structs keeps related data together
type Point struct { x, y, z float64 }
type AoS struct { points []Point }
```

### False Sharing

```go
// ✗ Bad — counters on same cache line cause false sharing
type BadCounters struct { a, b int64 }

// ✓ Good — pad to separate cache lines (64 bytes)
type GoodCounters struct {
    a int64; _ [56]byte
    b int64; _ [56]byte
}
```

### Avoid Reflection in Hot Paths

```go
// ✗ Bad — reflect.DeepEqual is 50-200x slower
reflect.DeepEqual(a, b)

// ✓ Good — use typed comparison
slices.Equal(a, b)   // Go 1.21+
maps.Equal(a, b)     // Go 1.21+
bytes.Equal(a, b)
```

### Compiled Patterns

```go
// ✗ Bad — recompiles regex on every call
func match(s string) bool {
    matched, _ := regexp.MatchString(`^\d+$`, s)
    return matched
}

// ✓ Good — compile once, reuse
var digitPattern = regexp.MustCompile(`^\d+$`)
func match(s string) bool { return digitPattern.MatchString(s) }
```

---

## I/O and Networking

### HTTP Transport Configuration

```go
// ✗ Bad — default MaxIdleConnsPerHost is 2
client := &http.Client{}

// ✓ Good — tune for your concurrency level
client := &http.Client{
    Transport: &http.Transport{
        MaxIdleConns:        100,
        MaxIdleConnsPerHost: 20,    // match your concurrency
        IdleConnTimeout:     90 * time.Second,
        TLSHandshakeTimeout: 10 * time.Second,
    },
    Timeout: 30 * time.Second,
}
```

### JSON Performance

```go
// ✗ Bad — json.Marshal allocates; slow for hot paths
data, _ := json.Marshal(response)

// ✓ Good — stream directly to writer
enc := json.NewEncoder(w)
enc.Encode(response)

// ✓ Better for hot paths — use sonic or go-json
import "github.com/bytedance/sonic"
data, _ := sonic.Marshal(response)
```

### Streaming Large Responses

```go
// ✗ Bad — buffers entire response in memory
body, _ := io.ReadAll(resp.Body)

// ✓ Good — stream with io.Copy
io.Copy(writer, resp.Body)

// ✓ Good — limit size with io.LimitReader
io.Copy(writer, io.LimitReader(resp.Body, 10*1024*1024)) // 10MB max
```

### Batch Operations

```go
// ✗ Bad — N database calls
for _, id := range ids { db.QueryRow("SELECT...", id) }

// ✓ Good — single batch query
db.Query("SELECT * FROM users WHERE id = ANY($1)", pq.Array(ids))
```

### Database Connection Pooling

```go
// ✗ Bad — unbounded connections crash the DB under load
db, _ := sql.Open("postgres", uri)

// ✓ Good — explicit pool limits
db.SetMaxOpenConns(25)                 // max concurrent queries
db.SetMaxIdleConns(25)                 // keep connections warm
db.SetConnMaxLifetime(5 * time.Minute) // cycle to prevent stale drops
db.SetConnMaxIdleTime(1 * time.Minute) // free memory if unused
```

---

## Runtime Tuning

### GOGC (Garbage Collector Target)

```bash
GOGC=200  # Double the default heap headroom (less frequent GC, more memory)
GOGC=50   # Half the headroom (more frequent GC, less memory)
GOGC=off  # Disable GC (use for short-lived batch programs only)
```

### GOMEMLIMIT (Go 1.19+)

```bash
# Set to 80-90% of container memory to prevent OOM kills
GOMEMLIMIT=3600MiB  # For a 4GiB container
```

GOMEMLIMIT provides a soft memory cap. The GC works harder to stay under the limit. Combine with `GOGC=100` (default) for balanced behavior.

### GOMAXPROCS

```bash
# Default: number of available CPUs
# In containers, may over-provision — use automaxprocs
import _ "go.uber.org/automaxprocs"  # auto-detects container CPU quota
```

### GC Diagnostics

```bash
GODEBUG=gctrace=1 ./myapp  # GC trace output
```

### Profile-Guided Optimization (PGO) — Go 1.21+

```bash
# 1. Collect profile from production
curl http://localhost:6060/debug/pprof/profile?seconds=30 > default.pgo
# 2. Place default.pgo in main package directory
# 3. Rebuild — compiler automatically uses it
go build ./cmd/server
```

PGO typically improves performance 2-7% by optimizing inlining and devirtualization based on actual usage patterns.

---

## Caching Patterns

### singleflight — Deduplicate Concurrent Requests

```go
import "golang.org/x/sync/singleflight"

var group singleflight.Group

func getUser(id string) (*User, error) {
    result, err, _ := group.Do("user:"+id, func() (interface{}, error) {
        return db.GetUser(id) // only one in-flight request per key
    })
    if err != nil { return nil, err }
    return result.(*User), nil
}
```

### In-Memory Cache with TTL

```go
type CacheEntry[V any] struct {
    Value     V
    ExpiresAt time.Time
}

type Cache[K comparable, V any] struct {
    mu    sync.RWMutex
    items map[K]CacheEntry[V]
    ttl   time.Duration
}

func (c *Cache[K, V]) Get(key K) (V, bool) {
    c.mu.RLock()
    defer c.mu.RUnlock()
    entry, ok := c.items[key]
    if !ok || time.Now().After(entry.ExpiresAt) {
        var zero V
        return zero, false
    }
    return entry.Value, true
}
```

### Algorithmic Complexity

Before caching, check if the algorithm itself is the bottleneck:

| Operation | Bad | Good |
|---|---|---|
| Lookup in list | O(n) linear scan | O(1) map lookup |
| Sort + search | O(n log n) each time | O(1) pre-indexed map |
| Nested loops | O(n²) | O(n) with hash set |

---

## Observability

### Prometheus Metrics

```go
import "github.com/prometheus/client_golang/prometheus"

var (
    requestDuration = prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name:    "http_request_duration_seconds",
            Help:    "HTTP request latency",
            Buckets: prometheus.DefBuckets,
        }, []string{"method", "path", "status"},
    )
    allocsPerReq = prometheus.NewCounter(prometheus.CounterOpts{
        Name: "go_allocs_per_request_total",
        Help: "Total allocations per request",
    })
)
```

### Key PromQL Queries

```promql
# P99 latency
histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))

# Allocation rate
rate(go_memstats_alloc_bytes_total[5m])

# GC pause time
rate(go_gc_duration_seconds_sum[5m])
```

### Alerting Rules

```yaml
- alert: HighP99Latency
  expr: histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m])) > 0.5
  for: 5m
  annotations: { summary: "P99 latency > 500ms" }

- alert: HighGCPause
  expr: rate(go_gc_duration_seconds_sum[5m]) > 0.1
  for: 10m
  annotations: { summary: "GC consuming >10% of time" }
```

---

## Common Mistakes

| Mistake | Fix |
|---|---|
| Optimizing without profiling | Profile with pprof first — intuition is wrong ~80% of the time |
| Default `http.Client` without Transport | `MaxIdleConnsPerHost` defaults to 2; match your concurrency |
| Logging in hot loops | Log calls prevent inlining and allocate. Use `slog.LogAttrs` |
| `panic`/`recover` as control flow | Panic allocates a stack trace. Use error returns |
| `unsafe` without benchmark proof | Only justified when profiling shows >10% improvement |
| No GC tuning in containers | Set `GOMEMLIMIT` to 80-90% of container memory |
| `reflect.DeepEqual` in production | 50-200x slower. Use `slices.Equal`, `maps.Equal`, `bytes.Equal` |
