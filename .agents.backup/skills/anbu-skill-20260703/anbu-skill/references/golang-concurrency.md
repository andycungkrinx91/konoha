# Go Concurrency

> Read when: working with goroutines, channels, worker pools, sync primitives, or rate limiting in Go.

## Contents

- [Worker Pool](#worker-pool)
- [Channel Patterns](#channel-patterns)
- [Select Patterns](#select-patterns)
- [Sync Primitives](#sync-primitives)
- [Rate Limiting](#rate-limiting)
- [Pipeline Pattern](#pipeline-pattern)

---

## Worker Pool

```go
type WorkerPool struct {
    workers int
    tasks   chan func()
    wg      sync.WaitGroup
}

func NewWorkerPool(workers int) *WorkerPool {
    wp := &WorkerPool{workers: workers, tasks: make(chan func(), workers*2)}
    wp.start()
    return wp
}

func (wp *WorkerPool) start() {
    for i := 0; i < wp.workers; i++ {
        wp.wg.Add(1)
        go func() {
            defer wp.wg.Done()
            for task := range wp.tasks { task() }
        }()
    }
}

func (wp *WorkerPool) Submit(task func()) { wp.tasks <- task }
func (wp *WorkerPool) Shutdown()          { close(wp.tasks); wp.wg.Wait() }
```

### Core Pattern: Goroutine with Context

```go
// worker runs until ctx is cancelled or an error occurs.
func worker(ctx context.Context, jobs <-chan Job, errCh chan<- error) {
    for {
        select {
        case <-ctx.Done():
            errCh <- fmt.Errorf("worker cancelled: %w", ctx.Err())
            return
        case job, ok := <-jobs:
            if !ok { return }
            if err := process(ctx, job); err != nil {
                errCh <- fmt.Errorf("process job %v: %w", job.ID, err)
                return
            }
        }
    }
}
```

Key: bounded goroutine lifetime via `ctx`, error propagation with `%w`, no goroutine leak on cancellation.

---

## Channel Patterns

### Generator

```go
func generateNumbers(ctx context.Context, max int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for i := 0; i < max; i++ {
            select {
            case out <- i:
            case <-ctx.Done(): return
            }
        }
    }()
    return out
}
```

### Fan-out / Fan-in

```go
func fanOut(ctx context.Context, input <-chan int, workers int) []<-chan int {
    channels := make([]<-chan int, workers)
    for i := 0; i < workers; i++ { channels[i] = process(ctx, input) }
    return channels
}

func fanIn(ctx context.Context, channels ...<-chan int) <-chan int {
    out := make(chan int)
    var wg sync.WaitGroup
    for _, ch := range channels {
        wg.Add(1)
        go func(c <-chan int) {
            defer wg.Done()
            for val := range c {
                select {
                case out <- val:
                case <-ctx.Done(): return
                }
            }
        }(ch)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

---

## Select Patterns

### Timeout

```go
func fetchWithTimeout(ctx context.Context, url string) (string, error) {
    result := make(chan string, 1)
    go func() { /* fetch */ result <- "data" }()
    select {
    case res := <-result:             return res, nil
    case <-time.After(50 * time.Millisecond): return "", fmt.Errorf("timeout")
    case <-ctx.Done():                return "", ctx.Err()
    }
}
```

### Graceful Shutdown

```go
type Server struct { done chan struct{} }
func (s *Server) Shutdown() { close(s.done) }
func (s *Server) Run(ctx context.Context) {
    ticker := time.NewTicker(1 * time.Second)
    defer ticker.Stop()
    for {
        select {
        case <-ticker.C:   fmt.Println("tick")
        case <-s.done:     fmt.Println("shutting down"); return
        case <-ctx.Done(): fmt.Println("context cancelled"); return
        }
    }
}
```

---

## Sync Primitives

### Mutex / RWMutex

```go
// Mutex for protecting shared state
type Counter struct { mu sync.Mutex; count int }
func (c *Counter) Increment() { c.mu.Lock(); defer c.mu.Unlock(); c.count++ }
func (c *Counter) Value() int { c.mu.Lock(); defer c.mu.Unlock(); return c.count }

// RWMutex for read-heavy workloads
type Cache struct { mu sync.RWMutex; items map[string]string }
func (c *Cache) Get(key string) (string, bool) {
    c.mu.RLock(); defer c.mu.RUnlock()
    val, ok := c.items[key]; return val, ok
}
func (c *Cache) Set(key, value string) {
    c.mu.Lock(); defer c.mu.Unlock()
    c.items[key] = value
}
```

### sync.Once

```go
type Service struct { once sync.Once; config *Config }
func (s *Service) getConfig() *Config {
    s.once.Do(func() { s.config = loadConfig() })
    return s.config
}
```

---

## Rate Limiting

### Token Bucket

```go
import "golang.org/x/time/rate"

type RateLimiter struct { limiter *rate.Limiter }
func NewRateLimiter(rps int) *RateLimiter {
    return &RateLimiter{limiter: rate.NewLimiter(rate.Limit(rps), rps)}
}
func (rl *RateLimiter) Process(ctx context.Context, item string) error {
    if err := rl.limiter.Wait(ctx); err != nil { return err }
    return nil
}
```

### Semaphore

```go
type Semaphore struct { slots chan struct{} }
func NewSemaphore(n int) *Semaphore { return &Semaphore{slots: make(chan struct{}, n)} }
func (s *Semaphore) Acquire() { s.slots <- struct{}{} }
func (s *Semaphore) Release() { <-s.slots }
func (s *Semaphore) Do(fn func()) { s.Acquire(); defer s.Release(); fn() }
```

---

## Pipeline Pattern

```go
func pipeline(ctx context.Context, input <-chan int) <-chan int {
    // Stage 1: Square
    stage1 := make(chan int)
    go func() {
        defer close(stage1)
        for num := range input {
            select { case stage1 <- num * num: case <-ctx.Done(): return }
        }
    }()
    // Stage 2: Filter even
    stage2 := make(chan int)
    go func() {
        defer close(stage2)
        for num := range stage1 {
            if num%2 == 0 {
                select { case stage2 <- num: case <-ctx.Done(): return }
            }
        }
    }()
    return stage2
}
```

## Quick Reference

| Pattern | Use Case | Key Points |
|---------|----------|------------|
| Worker Pool | Bounded concurrency | Limit goroutines, reuse workers |
| Fan-out/Fan-in | Parallel processing | Distribute work, merge results |
| Pipeline | Stream processing | Chain transformations |
| Rate Limiter | API throttling | Control request rate |
| Semaphore | Resource limits | Cap concurrent operations |
| Done Channel | Graceful shutdown | Signal completion |
