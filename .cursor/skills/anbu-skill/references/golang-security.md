# Go Security

> Read when: writing, reviewing, or auditing Go code for security. Covers injection, cryptography, filesystem, network, cookies, secrets, memory safety, logging, and threat modeling.

## Contents

- [Security Thinking Model](#security-thinking-model)
- [Quick Reference](#quick-reference)
- [Injection Vulnerabilities](#injection-vulnerabilities)
- [Cryptography](#cryptography)
- [Filesystem Security](#filesystem-security)
- [Network and Web Security](#network-and-web-security)
- [Cookie Security](#cookie-security)
- [Authentication Patterns](#authentication-patterns)
- [Secrets Management](#secrets-management)
- [Memory Safety](#memory-safety)
- [Logging Security](#logging-security)
- [Third-Party Data Leaks](#third-party-data-leaks)
- [Threat Modeling](#threat-modeling)
- [Security Review Checklist](#security-review-checklist)
- [Tooling](#tooling)

---

## Security Thinking Model

Before writing or reviewing code, ask:

1. **What are the trust boundaries?** — Where does untrusted data enter? (HTTP requests, file uploads, env vars)
2. **What can an attacker control?** — Which inputs flow into sensitive operations?
3. **What is the blast radius?** — If this defense fails, what's the worst outcome?

### Severity Levels (DREAD)

| Level | Score | Meaning |
|---|---|---|
| Critical | 8-10 | RCE, full data breach — fix immediately |
| High | 6-7.9 | Auth bypass, significant exposure — fix in current sprint |
| Medium | 4-5.9 | Limited exposure, defense weakening — fix in next sprint |
| Low | 1-3.9 | Minor info disclosure — fix opportunistically |

---

## Quick Reference

| Severity | Vulnerability | Defense | Go Solution |
|---|---|---|---|
| Critical | SQL Injection | Parameterized queries | `database/sql` with `$1` placeholders |
| Critical | Command Injection | Separate args | `exec.Command` with separate args |
| High | XSS | Auto-escaping | `html/template` |
| High | Path Traversal | Scoped file access | Go 1.24+: `os.Root`; pre-1.24: `filepath.IsLocal` |
| High | Crypto Issues | Vetted algorithms | `crypto/aes` GCM, `crypto/rand` |
| Medium | Timing Attacks | Constant-time comparison | `crypto/subtle.ConstantTimeCompare` |
| High | Race Conditions | Protect shared state | `sync.Mutex`, channels, `-race` flag |

---

## Injection Vulnerabilities

### SQL Injection — Critical

```go
// ✗ Bad
query := fmt.Sprintf("SELECT * FROM users WHERE name = '%s'", input)

// ✓ Good — parameterized
db.QueryRow("SELECT * FROM users WHERE name = $1", input)
```

**Dynamic IN clauses:**

```go
placeholders := make([]string, len(ids))
args := make([]any, len(ids))
for i, id := range ids {
    placeholders[i] = fmt.Sprintf("$%d", i+1)
    args[i] = id
}
query := fmt.Sprintf("SELECT * FROM users WHERE id IN (%s)", strings.Join(placeholders, ","))
```

**Dynamic column names (allowlist only):**

```go
allowed := map[string]string{"name": "name", "created": "created_at"}
col, ok := allowed[sortCol]
if !ok { col = "created_at" }
query := fmt.Sprintf("SELECT * FROM users ORDER BY %s", col) // safe: from allowlist
```

### Command Injection — Critical

```go
// ✗ Bad
cmd := exec.Command("sh", "-c", "rm -f /tmp/"+filename)

// ✓ Good — separate args, validate filename
if filepath.Base(filename) != filename { return errors.New("invalid filename") }
cmd := exec.Command("rm", "-f", filepath.Join("/tmp", filename))
```

### XSS — High

```go
// ✗ Bad
w.Write([]byte(fmt.Sprintf("<div>%s</div>", data)))

// ✓ Good — html/template auto-escapes
t := template.Must(template.New("safe").Parse("<div>{{.}}</div>"))
t.Execute(w, data)
```

### SSRF — High

```go
u, _ := url.Parse(targetURL)
if u.Scheme != "http" && u.Scheme != "https" { return errors.New("invalid scheme") }
if isInternalIP(u.Hostname()) { return errors.New("internal host blocked") }
if strings.Contains(u.Hostname(), "metadata.") { return errors.New("metadata blocked") }
```

---

## Cryptography

### Algorithm Selection

| Use Case | Recommended | Avoid |
|---|---|---|
| Symmetric encryption | AES-256-GCM, ChaCha20-Poly1305 | DES, AES-ECB, RC4 |
| Password hashing | Argon2id, bcrypt | MD5, SHA-1, plain SHA-256 |
| Message auth | HMAC-SHA256 | HMAC-MD5 |
| Signatures | Ed25519, ECDSA P-256 | RSA-PKCS1v1.5 |
| Random generation | `crypto/rand` | `math/rand` |
| TLS | 1.2+ (prefer 1.3) | TLS 1.0, 1.1, SSL |

### AES-GCM Encryption

```go
func EncryptAESGCM(key, plaintext []byte) ([]byte, error) {
    block, err := aes.NewCipher(key)
    if err != nil { return nil, err }
    aead, err := cipher.NewGCM(block)
    if err != nil { return nil, err }
    nonce := make([]byte, aead.NonceSize())
    if _, err := rand.Read(nonce); err != nil { return nil, err }
    return aead.Seal(nonce, nonce, plaintext, nil), nil
}
```

### Password Hashing

```go
// Argon2id (preferred)
import "golang.org/x/crypto/argon2"
hash := argon2.IDKey([]byte(password), salt, 3, 64*1024, 4, 32)

// bcrypt (simpler API)
import "golang.org/x/crypto/bcrypt"
hash, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
```

### Secure TLS Config

```go
func secureConfig() *tls.Config {
    return &tls.Config{
        MinVersion:       tls.VersionTLS12,
        CurvePreferences: []tls.CurveID{tls.X25519, tls.CurveP256},
    }
}
```

---

## Filesystem Security

### Path Traversal — High

```go
// ✓ Good (Go 1.24+) — os.Root scopes file access
root, err := os.OpenRoot("/var/www")
if err != nil { return err }
defer root.Close()
f, err := root.Open(filename) // cannot escape root

// ✓ Good (pre-1.24 fallback)
func safeJoin(baseDir, userPath string) (string, error) {
    if userPath == "" || filepath.IsAbs(userPath) || !filepath.IsLocal(userPath) {
        return "", errors.New("invalid path")
    }
    full := filepath.Join(baseDir, userPath)
    rel, _ := filepath.Rel(baseDir, full)
    if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
        return "", errors.New("path escapes base")
    }
    return full, nil
}
```

### Decompression Bomb — Medium

```go
const maxSize = 100 * 1024 * 1024 // 100MB
lr := io.LimitReader(gzipReader, maxSize)
if _, err := io.Copy(out, lr); err != nil { return err }
```

### File Permissions

```go
os.OpenFile("config.json", os.O_CREATE, 0600)  // Owner only (not 0644)
os.MkdirAll("/var/myapp/cache", 0750)           // Group-readable (not 0777)
f, _ := os.CreateTemp("", "myapp.*")            // Unpredictable name
defer os.Remove(f.Name())
```

---

## Network and Web Security

### HTTP Server Hardening

```go
server := &http.Server{
    Addr:           ":443",
    ReadTimeout:    5 * time.Second,
    WriteTimeout:   10 * time.Second,
    IdleTimeout:    120 * time.Second,
    MaxHeaderBytes: 1 << 20,
}
```

### Context Timeouts (Mandatory)

Never make a network or DB call without a context timeout to prevent resource exhaustion attacks (Slowloris, DB locking).

```go
// ✗ Bad — can block forever
db.QueryContext(ctx, "SELECT ...") 

// ✓ Good — enforce an upper bound
ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
defer cancel()
db.QueryContext(ctx, "SELECT ...")
```

### Security Headers Middleware

```go
func SecurityHeaders(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Security-Policy", "default-src 'self'")
        w.Header().Set("X-Frame-Options", "DENY")
        w.Header().Set("X-Content-Type-Options", "nosniff")
        w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
        next.ServeHTTP(w, r)
    })
}
```

### Timing-Safe Comparison

```go
import "crypto/subtle"
func checkToken(input, expected string) bool {
    return subtle.ConstantTimeCompare([]byte(input), []byte(expected)) == 1
}
```

### Rate Limiting Middleware

```go
import "golang.org/x/time/rate"
func RateLimitMiddleware(rps float64, burst int) func(http.Handler) http.Handler {
    limiter := rate.NewLimiter(rate.Limit(rps), burst)
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            if !limiter.Allow() {
                http.Error(w, "Too Many Requests", http.StatusTooManyRequests)
                return
            }
            next.ServeHTTP(w, r)
        })
    }
}
```

---

## Cookie Security

```go
cookie := &http.Cookie{
    Name:     "session",
    Value:    sessionID,
    HttpOnly: true,                    // Prevents JavaScript access
    Secure:   true,                    // HTTPS only
    SameSite: http.SameSiteStrictMode, // CSRF protection
    Path:     "/",
    MaxAge:   3600,
}
```

---

## Authentication Patterns

| Use Case | Pattern | Go Library |
|---|---|---|
| Web app | OAuth 2.0 + PKCE | `golang.org/x/oauth2` |
| API auth | JWT with short expiry | `github.com/golang-jwt/jwt/v5` |
| Service-to-service | mTLS | `crypto/tls` |
| CLI/Automation | API keys + IP allowlist | Custom middleware |

### JWT Validation (Pin Algorithm)

```go
token, err := jwt.ParseWithClaims(tokenString, &jwt.RegisteredClaims{},
    func(token *jwt.Token) (interface{}, error) {
        if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
            return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
        }
        return publicKey, nil
    },
    jwt.WithIssuer("your-issuer"),
    jwt.WithExpirationRequired(),
)
```

---

## Secrets Management

```go
// ✗ Bad — hardcoded
const JWT_SECRET = "my-super-secret-jwt-key"

// ✓ Good — environment variables
cfg := &Config{
    JWTSecret: os.Getenv("JWT_SECRET"),
    DBURL:     os.Getenv("DATABASE_URL"),
}
if cfg.JWTSecret == "" { return errors.New("JWT_SECRET required") }
```

**`.gitignore` must exclude:** `.env`, `*.key`, `*.pem`, `*.p12`, `secrets/`

---

## Memory Safety

### Integer Overflow — High

```go
func safeMultiply(a, b int) (int, error) {
    if a == 0 || b == 0 { return 0, nil }
    if a > math.MaxInt/b { return 0, errors.New("integer overflow") }
    return a * b, nil
}
```

### Data Races — High

```go
// Always run: go test -race ./...
type Counter struct { mu sync.Mutex; value int }
func (c *Counter) Inc() { c.mu.Lock(); defer c.mu.Unlock(); c.value++ }

// Or atomic for simple cases
var counter int64
atomic.AddInt64(&counter, 1)
```

### unsafe Package — High

Never use `unsafe` in application code. Restrict to low-level libraries with thorough review and benchmark justification.

---

## Logging Security

```go
// ✗ Bad — logs password, token
log.Printf("User logged in: %+v\n", user)

// ✓ Good — structured, no PII
logger.Info("user_login", "user_id", user.ID, "username", user.Username)

// ✗ Bad — exposes internal details to client
http.Error(w, "Error: "+err.Error(), 500)

// ✓ Good — generic to client, detailed server-side
logger.Error("database_error", "error", err.Error())
http.Error(w, "Internal server error", http.StatusInternalServerError)
```

**Sanitize log input** — remove control characters to prevent log injection.

---

## Third-Party Data Leaks

```go
// ✓ Good — filter PII before sending to error tracking
sentry.Init(sentry.ClientOptions{
    BeforeSend: func(event *sentry.Event, hint *sentry.EventHint) *sentry.Event {
        if event.Request != nil {
            delete(event.Request.Headers, "Authorization")
            delete(event.Request.Headers, "Cookie")
        }
        return event
    },
})

// ✓ Good — analytics without PII
analytics.Track("user_signed_up", Properties{
    "user_id": user.ID, "plan": user.Plan, // OK: non-identifying
    // NOT: email, phone, address
})
```

---

## Threat Modeling

### STRIDE per Element

| DFD Element | S | T | R | I | D | E |
|---|---|---|---|---|---|---|
| External Entity | X | | X | | | |
| Process | X | X | X | X | X | X |
| Data Store | | X | X | X | X | |
| Data Flow | | X | | X | X | |

### DREAD Scoring

Score = (Damage + Reproducibility + Exploitability + Affected users + Discoverability) / 5

### OWASP Top 10 Go Defenses

| # | Vulnerability | Go Defense |
|---|---|---|
| A01 | Broken Access Control | Server-side authz middleware, RBAC |
| A02 | Cryptographic Failures | `crypto/aes` GCM, `crypto/rand`, TLS 1.2+ |
| A03 | Injection | `database/sql` placeholders, `exec.Command` separate args |
| A05 | Security Misconfiguration | Server timeouts, no `InsecureSkipVerify` |
| A06 | Vulnerable Components | `govulncheck`, `go.sum` verification |
| A07 | Auth Failures | Argon2id/bcrypt, JWT algorithm pinning |
| A10 | SSRF | URL allowlists, block internal IPs |

---

## Security Review Checklist

### Input & Database
- [ ] **Critical** SQL uses parameterized placeholders
- [ ] **Critical** No `exec.Command` with shell args
- [ ] **High** All user input validated at boundaries
- [ ] **High** XSS protected via `html/template`

### Cryptography & Auth
- [ ] **High** `crypto/rand` for tokens (not `math/rand`)
- [ ] **High** Passwords hashed with Argon2id or bcrypt
- [ ] **High** JWT validated (algorithm, issuer, expiry)
- [ ] **High** TLS 1.2+ configured
- [ ] **Critical** No hardcoded secrets

### Web & Infrastructure
- [ ] **Medium** Security headers set (HSTS, CSP, X-Frame-Options)
- [ ] **Medium** Server timeouts configured
- [ ] **Medium** Rate limiting on auth and expensive endpoints
- [ ] **Medium** Request body size limited
- [ ] **Medium** Generic error messages to clients

### Concurrency & Dependencies
- [ ] **High** `-race` detector passes
- [ ] **High** `govulncheck` passes
- [ ] **Medium** No PII in logs

---

## Tooling

```bash
# Static analysis (SAST)
go get -tool github.com/securego/gosec/v2/cmd/gosec@latest
go tool gosec ./...

# Vulnerability scanner
go get -tool golang.org/x/vuln/cmd/govulncheck@latest
go tool govulncheck ./...

# Race detector
go test -race ./...

# Fuzz testing
go test -fuzz=Fuzz
```
