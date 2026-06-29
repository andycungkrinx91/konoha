# Go Fundamentals

> Read when: writing Go code involving error handling, interfaces, generics, or project structure.

## Contents

- [Error Handling](#error-handling)
- [Interface Design](#interface-design)
- [Generics](#generics)
- [Project Structure](#project-structure)

---

## Error Handling

### Best Practices

1. **Returned errors MUST always be checked** — NEVER discard with `_`
2. **Errors MUST be wrapped with context** using `fmt.Errorf("{context}: %w", err)`
3. **Error strings MUST be lowercase**, without trailing punctuation
4. **Use `%w` internally, `%v` at system boundaries** to control error chain exposure
5. **Use `errors.Is` for sentinel matching and `errors.As`/`errors.AsType` for typed chain inspection**
6. **Use `errors.Join`** (Go 1.20+) to combine independent errors
7. **Errors MUST be either logged OR returned**, NEVER both (single handling rule)
8. **Use sentinel errors** for expected conditions, custom types for carrying data
9. **NEVER use `panic` for expected error conditions** — reserve for truly unrecoverable states
10. **Use `slog`** (Go 1.21+) for structured error logging

### Error Creation

Go treats errors as ordinary values implementing `error`. Every function that can fail returns an `error` as its last return value.

```go
// ✗ Bad — silently discarding errors
data, _ := os.ReadFile("config.yaml")

// ✓ Good — always check before using other return values
data, err := os.ReadFile("config.yaml")
if err != nil {
    return fmt.Errorf("reading config: %w", err)
}
```

Error strings MUST be lowercase, without trailing punctuation:

```go
// ✗ Bad
return errors.New("Failed to connect to database.")

// ✓ Good — reads as a chain: "creating order: charging card: connection refused"
return errors.New("connection refused")
```

#### Decision Table

| Situation | Strategy | Example |
|---|---|---|
| Caller needs to match a specific condition | Sentinel error | `var ErrNotFound = errors.New("not found")` |
| Caller needs to extract structured data | Custom error type | `type ValidationError struct { Field, Msg string }` |
| Error is purely informational | `fmt.Errorf` or `errors.New` | `fmt.Errorf("connecting to %s: %w", addr, err)` |
| Need stack traces, user context, structured attrs | `samber/oops` | `oops.With("user_id", uid).Errorf("not found")` |

#### Low-Cardinality Error Messages

APM tools group events by message. Variable data in the message creates noisy dashboards:

```go
// ✗ Bad at log boundary — each file/line combo creates a unique group
fmt.Errorf("error in %s at line %d of the csv", csvPath, line)

// ✓ Good — static error, structured attributes at the log site
err := errors.New("csv parsing error")
slog.Error("csv parsing failed", "error", err, "csv_file_path", csvPath, "csv_file_line", line)
```

#### Custom Error Types

```go
type ValidationError struct {
    Field   string
    Message string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation failed on %s: %s", e.Field, e.Message)
}

// Custom types that wrap other errors — implement Unwrap()
type QueryError struct {
    Query string
    Err   error
}

func (e *QueryError) Error() string { return fmt.Sprintf("query %q: %v", e.Query, e.Err) }
func (e *QueryError) Unwrap() error { return e.Err }
```

### Error Wrapping and Inspection

```go
// ✓ Good — wraps with context, preserves the chain
func (s *UserService) GetUser(id string) (*User, error) {
    user, err := s.repo.FindByID(id)
    if err != nil {
        return nil, fmt.Errorf("getting user %s: %w", id, err)
    }
    return user, nil
}

// Use %w within module (preserves chain), %v at public API boundaries (hides internals)
```

#### Inspecting Errors

```go
// ✗ Bad — direct comparison breaks on wrapped errors
if err == sql.ErrNoRows {

// ✓ Good — traverses the entire error chain
if errors.Is(err, sql.ErrNoRows) {
    return nil, ErrNotFound
}

// Extract typed error
var ve *ValidationError
if errors.As(err, &ve) {
    log.Printf("validation failed on field %s", ve.Field)
}

// Go 1.26+ — simpler syntax
if ve, ok := errors.AsType[*ValidationError](err); ok {
    log.Printf("validation failed on field %s", ve.Field)
}
```

#### Combining Errors

```go
// errors.Join (Go 1.20+) — combines independent errors
func validateUser(u User) error {
    var errs []error
    if u.Name == "" { errs = append(errs, errors.New("name is required")) }
    if u.Email == "" { errs = append(errs, errors.New("email is required")) }
    return errors.Join(errs...) // returns nil if errs is empty
}

// errors.Is works through joined errors
err := errors.Join(ErrNotFound, ErrUnauthorized)
errors.Is(err, ErrNotFound)    // true
errors.Is(err, ErrUnauthorized) // true
```

### Single Handling Rule

An error MUST be handled exactly once: either log it or return it, never both.

```go
// ✗ Bad — logs AND returns (duplicate noise)
func processOrder(id string) error {
    if err := chargeCard(id); err != nil {
        log.Printf("failed to charge card: %v", err)
        return fmt.Errorf("charging card: %w", err)
    }
    return nil
}

// ✓ Good — return with context, let the caller decide
func processOrder(id string) error {
    if err := chargeCard(id); err != nil {
        return fmt.Errorf("charging card for order %s: %w", id, err)
    }
    return nil
}

// ✓ Good — handle at the top level (HTTP handler, main, etc.)
func handleOrder(w http.ResponseWriter, r *http.Request) {
    if err := processOrder(r.FormValue("id")); err != nil {
        slog.Error("order failed", "error", err)
        http.Error(w, "internal error", http.StatusInternalServerError)
        return
    }
    w.WriteHeader(http.StatusOK)
}
```

### Panic and Recover

Panic MUST only be used for truly unrecoverable states — programmer errors, impossible conditions:

```go
// ✓ Acceptable — programmer error in initialization
func MustCompileRegex(pattern string) *regexp.Regexp {
    re, err := regexp.Compile(pattern)
    if err != nil { panic(fmt.Sprintf("invalid regex %q: %v", pattern, err)) }
    return re
}

// Use recover at goroutine boundaries to prevent crash propagation
func safeHandler(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        defer func() {
            if r := recover(); r != nil {
                slog.Error("panic recovered", "panic", r, "stack", string(debug.Stack()))
                http.Error(w, "internal error", http.StatusInternalServerError)
            }
        }()
        next.ServeHTTP(w, r)
    })
}
```

---

## Interface Design

### Small, Focused Interfaces

```go
// Single-method interfaces (idiomatic Go)
type Reader interface { Read(p []byte) (n int, err error) }
type Writer interface { Write(p []byte) (n int, err error) }
type Closer interface { Close() error }

// Interface composition
type ReadWriteCloser interface { Reader; Writer; Closer }
```

### Accept Interfaces, Return Structs

```go
// Return concrete type
func NewStorage(baseDir string) *Storage { return &Storage{baseDir: baseDir} }

// Accept interface for flexibility and testability
func (s *Storage) SaveFile(filename string, data io.Reader) error { return nil }

// Dependency injection via interfaces
type UserService struct {
    repo   UserRepository
    mailer EmailSender
}
func NewUserService(repo UserRepository, mailer EmailSender) *UserService {
    return &UserService{repo: repo, mailer: mailer}
}
```

### Functional Options Pattern

```go
type Server struct { host string; port int; timeout time.Duration; maxConns int }
type Option func(*Server)

func WithHost(host string) Option    { return func(s *Server) { s.host = host } }
func WithPort(port int) Option       { return func(s *Server) { s.port = port } }
func WithTimeout(t time.Duration) Option { return func(s *Server) { s.timeout = t } }

func NewServer(opts ...Option) *Server {
    s := &Server{host: "localhost", port: 8080, timeout: 30 * time.Second, maxConns: 100}
    for _, opt := range opts { opt(s) }
    return s
}
```

### Interface Segregation

```go
// ✗ Bad: Fat interface
type BadRepository interface { Create(); Read(); Update(); Delete(); List(); Search(); Count() }

// ✓ Good: Segregated — compose only what you need
type Creator interface { Create(item Item) error }
type Reader interface  { Read(id string) (Item, error) }
type ReadWriter interface { Reader; Creator }
```

### Compile-Time Verification

```go
var _ io.Reader = (*MyReader)(nil)  // compile error if MyReader doesn't implement Reader
```

### Quick Reference

| Pattern | Use Case | Key Principle |
|---------|----------|---------------|
| Small interfaces | Flexibility | Single-method interfaces |
| Accept interfaces | Testability | Depend on abstractions |
| Return structs | Clarity | Concrete return types |
| Functional options | Configuration | Flexible constructors |
| Embedding | Composition | Extend behavior without inheritance |

---

## Generics

### Type Parameters and Constraints

```go
func Max[T constraints.Ordered](a, b T) T {
    if a > b { return a }
    return b
}

func Map[T, U any](slice []T, fn func(T) U) []U {
    result := make([]U, len(slice))
    for i, v := range slice { result[i] = fn(v) }
    return result
}

// Custom constraints
type Number interface { constraints.Integer | constraints.Float }
func Sum[T Number](numbers []T) T {
    var total T
    for _, n := range numbers { total += n }
    return total
}

// Approximate constraint using ~ (includes type aliases)
type Integer interface { ~int | ~int8 | ~int16 | ~int32 | ~int64 }
```

### Generic Data Structures

```go
type Stack[T any] struct { items []T }
func (s *Stack[T]) Push(item T)       { s.items = append(s.items, item) }
func (s *Stack[T]) Pop() (T, bool) {
    if len(s.items) == 0 { var zero T; return zero, false }
    item := s.items[len(s.items)-1]
    s.items = s.items[:len(s.items)-1]
    return item, true
}

// Generic collection operations
func Filter[T any](slice []T, pred func(T) bool) []T {
    result := make([]T, 0, len(slice))
    for _, v := range slice { if pred(v) { result = append(result, v) } }
    return result
}

func Reduce[T, U any](slice []T, initial U, fn func(U, T) U) U {
    acc := initial
    for _, v := range slice { acc = fn(acc, v) }
    return acc
}

func Keys[K comparable, V any](m map[K]V) []K {
    keys := make([]K, 0, len(m))
    for k := range m { keys = append(keys, k) }
    return keys
}
```

### Generic Channels

```go
func Merge[T any](channels ...<-chan T) <-chan T {
    out := make(chan T)
    var wg sync.WaitGroup
    for _, ch := range channels {
        wg.Add(1)
        go func(c <-chan T) { defer wg.Done(); for v := range c { out <- v } }(ch)
    }
    go func() { wg.Wait(); close(out) }()
    return out
}

func Stage[T, U any](in <-chan T, fn func(T) U) <-chan U {
    out := make(chan U)
    go func() { defer close(out); for v := range in { out <- fn(v) } }()
    return out
}
```

### Quick Reference

| Feature | Syntax | Use Case |
|---------|--------|----------|
| Basic generic | `func F[T any]()` | Any type |
| Constraint | `func F[T Constraint]()` | Restricted types |
| Comparable | `func F[T comparable]()` | Types supporting == |
| Ordered | `func F[T constraints.Ordered]()` | Types supporting < > |
| Union | `T interface{int \| string}` | Either type |
| Approximate | `~int` | Include type aliases |

---

## Project Structure

### Standard Layout

```
myproject/
├── cmd/                    # Main applications
│   ├── server/main.go
│   └── cli/main.go
├── internal/              # Private application code
│   ├── api/              # API handlers
│   ├── service/          # Business logic
│   └── repository/       # Data access layer
├── pkg/                   # Public library code
├── api/                   # OpenAPI spec, protobuf
├── configs/              # Configuration files
├── deployments/          # Docker, K8s configs
├── test/                 # Additional test data
├── go.mod / go.sum
├── Makefile
└── README.md
```

### Module Commands

```bash
go mod init github.com/user/project  # Initialize
go mod tidy                           # Add/remove deps
go get -u github.com/user/pkg@v1.2.3 # Update specific
go mod vendor                         # Vendor deps
go work init ./svc/api ./svc/worker   # Workspace (monorepo)
```

### Internal Packages

`internal/` packages can only be imported by code in the parent tree — enforced by the Go toolchain.

### Configuration Management

```go
type Config struct {
    Server   ServerConfig
    Database DatabaseConfig
}
type ServerConfig struct {
    Host         string        `envconfig:"SERVER_HOST" default:"0.0.0.0"`
    Port         int           `envconfig:"SERVER_PORT" default:"8080"`
    ReadTimeout  time.Duration `envconfig:"SERVER_READ_TIMEOUT" default:"10s"`
}
type DatabaseConfig struct {
    URL          string `envconfig:"DATABASE_URL" required:"true"`
    MaxOpenConns int    `envconfig:"DB_MAX_OPEN_CONNS" default:"25"`
}
```

### Dockerfile Multi-Stage Build

```dockerfile
FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o server ./cmd/server

FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /root/
COPY --from=builder /app/server .
EXPOSE 8080
CMD ["./server"]
```

### Makefile Essentials

```makefile
build:    go build -v -o bin/myapp ./cmd/server
test:     go test -v -race -coverprofile=coverage.out ./...
lint:     golangci-lint run ./...
fmt:      go fmt ./... && goimports -w .
run:      go run ./cmd/server
generate: go generate ./...
```

### Version Information with ldflags

```go
var (Version = "dev"; GitCommit = "none"; BuildTime = "unknown")
// Build: go build -ldflags "-X pkg/version.Version=1.0.0 -X pkg/version.GitCommit=$(git rev-parse HEAD)"
```
