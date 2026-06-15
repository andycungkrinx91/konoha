# Go Testing

> Read when: writing tests, benchmarks, fuzz tests, or using the race detector in Go.

## Contents

- [Table-Driven Tests](#table-driven-tests)
- [Test Helpers](#test-helpers)
- [Mocking with Interfaces](#mocking-with-interfaces)
- [Benchmarking](#benchmarking)
- [Fuzzing](#fuzzing)
- [Race Detector and Coverage](#race-detector-and-coverage)
- [Golden Files and Integration Tests](#golden-files-and-integration-tests)

---

## Table-Driven Tests

```go
func TestAdd(t *testing.T) {
    tests := []struct {
        name     string
        a, b     int
        expected int
    }{
        {"positive numbers", 2, 3, 5},
        {"negative numbers", -2, -3, -5},
        {"mixed signs", -2, 3, 1},
        {"zeros", 0, 0, 0},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            if result := Add(tt.a, tt.b); result != tt.expected {
                t.Errorf("Add(%d, %d) = %d; want %d", tt.a, tt.b, result, tt.expected)
            }
        })
    }
}
```

### Parallel Subtests

```go
for _, tt := range tests {
    tt := tt // Capture range variable
    t.Run(tt.name, func(t *testing.T) {
        t.Parallel()
        result := strings.ToUpper(tt.input)
        if result != tt.want { t.Errorf("got %q, want %q", result, tt.want) }
    })
}
```

---

## Test Helpers

```go
func setupTestDB(t *testing.T) *DB {
    t.Helper() // Doesn't show in stack trace
    db, err := NewDB(":memory:")
    if err != nil { t.Fatalf("failed to create test DB: %v", err) }
    return db
}

func cleanupTestDB(t *testing.T, db *DB) {
    t.Helper()
    if err := db.Close(); err != nil { t.Errorf("failed to close DB: %v", err) }
}

func TestWithSetup(t *testing.T) {
    db := setupTestDB(t)
    defer cleanupTestDB(t, db)
    // ... tests ...
}
```

---

## Mocking with Interfaces

```go
type EmailSender interface { Send(to, subject, body string) error }

type MockEmailSender struct {
    SentEmails []Email
    ShouldFail bool
}

func (m *MockEmailSender) Send(to, subject, body string) error {
    if m.ShouldFail { return fmt.Errorf("failed to send email") }
    m.SentEmails = append(m.SentEmails, Email{to, subject, body})
    return nil
}

func TestUserService_Register(t *testing.T) {
    mock := &MockEmailSender{}
    service := NewUserService(mock)
    if err := service.Register("user@example.com"); err != nil {
        t.Fatalf("Register failed: %v", err)
    }
    if len(mock.SentEmails) != 1 {
        t.Errorf("expected 1 email sent, got %d", len(mock.SentEmails))
    }
}
```

---

## Benchmarking

### Basic Benchmarks

```go
func BenchmarkAdd(b *testing.B) {
    for i := 0; i < b.N; i++ { Add(100, 200) }
}

// With subtests for different input sizes
func BenchmarkStringOps(b *testing.B) {
    for _, size := range []int{10, 100, 1000} {
        input := strings.Repeat("hello", size)
        b.Run(fmt.Sprintf("size-%d", size), func(b *testing.B) {
            for i := 0; i < b.N; i++ { _ = strings.ToUpper(input) }
        })
    }
}
```

### Benchmarking Methodology

Follow the iterative cycle: **Define metric → Benchmark → Diagnose → Improve → Compare**

```bash
# 1. Measure baseline (6 runs for statistical significance)
go test -bench=BenchmarkMyFunc -benchmem -count=6 ./pkg/... | tee /tmp/report-1.txt

# 2. Make ONE optimization, then re-measure
go test -bench=BenchmarkMyFunc -benchmem -count=6 ./pkg/... | tee /tmp/report-2.txt

# 3. Compare with benchstat
benchstat /tmp/report-1.txt /tmp/report-2.txt
```

### Memory Allocation Benchmark

```go
func BenchmarkAllocation(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ { s := make([]int, 1000); _ = s }
}
```

### Parallel Benchmark

```go
func BenchmarkConcurrentAccess(b *testing.B) {
    var counter int64
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() { atomic.AddInt64(&counter, 1) }
    })
}
```

---

## Fuzzing

```go
func FuzzReverse(f *testing.F) {
    f.Add("hello")
    f.Add("world")
    f.Fuzz(func(t *testing.T, input string) {
        reversed := Reverse(input)
        doubleReversed := Reverse(reversed)
        if input != doubleReversed {
            t.Errorf("Reverse(Reverse(%q)) = %q", input, doubleReversed)
        }
    })
}
```

Run: `go test -fuzz=FuzzReverse`

---

## Race Detector and Coverage

```bash
go test -race ./...              # Detect data races
go test -cover ./...             # Show coverage
go test -coverprofile=c.out ./...; go tool cover -html=c.out  # HTML report
go test -cpuprofile cpu.prof     # CPU profiling
go test -memprofile mem.prof     # Memory profiling
```

---

## Golden Files and Integration Tests

### Golden Files

```go
func TestRenderHTML(t *testing.T) {
    result := RenderHTML(Data{Title: "Test"})
    golden := filepath.Join("testdata", "expected.html")
    if *update { os.WriteFile(golden, []byte(result), 0644) }
    expected, _ := os.ReadFile(golden)
    if result != string(expected) {
        t.Errorf("output doesn't match golden file")
    }
}
var update = flag.Bool("update", false, "update golden files")
```

### Integration Tests

```go
//go:build integration
func TestIntegration(t *testing.T) {
    if testing.Short() { t.Skip("skipping in short mode") }
    server := startTestServer(t)
    defer server.Stop()
    // ... test against running server ...
}
// Run: go test -tags=integration
```

### Testable Examples

```go
func ExampleAdd() {
    fmt.Println(Add(2, 3))
    // Output: 5
}
```

## Quick Reference

| Command | Description |
|---------|-------------|
| `go test` | Run tests |
| `go test -v` | Verbose output |
| `go test -run TestName` | Run specific test |
| `go test -bench .` | Run benchmarks |
| `go test -cover` | Show coverage |
| `go test -race` | Race detector |
| `go test -short` | Skip long tests |
| `go test -fuzz FuzzName` | Run fuzzing |
