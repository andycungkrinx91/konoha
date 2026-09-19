# Backend Review

> Load when: reviewing backend code — Python, FastAPI, async patterns, databases, or API services.

## Security (backend)

| Check | Pattern to find | Severity |
|-------|----------------|----------|
| SQL injection | `execute(.*%\|.*format(\|.*f"` in queries | Critical |
| Path traversal | `open(.*+\|Path(.*+` with user input | Critical |
| SSRF | HTTP requests with user-controlled URLs | High |
| Insecure deserialization | `pickle.load(`, `yaml.load(` without SafeLoader | Critical |
| Weak crypto | `md5(`, `sha1(` for passwords | High |

## FastAPI patterns

| Check | What to verify | Severity |
|-------|---------------|----------|
| Missing `response_model` | All endpoints should declare response type | Medium |
| Untyped request bodies | POST/PUT/PATCH bodies should use Pydantic models | High |
| Missing status codes | POST→201, DELETE→204, etc. | Low |
| Sync in async routes | `time.sleep`, `requests.get`, `open()` in async def | High |
| Missing `Depends()` | Services/repos should be injected, not instantiated | Medium |
| N+1 queries | Queries inside loops — use eager loading | High |

## Pydantic validation

| Check | What to verify | Severity |
|-------|---------------|----------|
| Missing field validators | Sensitive fields (email, URL, password) need validation | Medium |
| `extra = "allow"` | Models should be strict, not accept arbitrary fields | Medium |
| Missing constraints | Strings without `max_length`, numbers without bounds | Low |
| `Optional[Any]` | Optional fields need explicit inner types | Medium |

## Async patterns

| Check | What to verify | Severity |
|-------|---------------|----------|
| Blocking calls in async | `time.sleep`, `requests.*`, synchronous `open()` | Critical |
| Missing `await` | Coroutine calls without `await` | Critical |
| Fire-and-forget tasks | `create_task()` without tracking or error handling | High |
| Missing timeouts | HTTP requests and external calls without `timeout=` | High |

## Error handling

| Check | What to verify | Severity |
|-------|---------------|----------|
| Bare `except:` | Catch specific exceptions, not generic | Medium |
| Generic exceptions in routes | Use `HTTPException` with proper status codes | Medium |
| Swallowed exceptions | `except: pass` — must log or re-raise | High |
| Missing error response schemas | Error responses should have consistent structure | Low |

## Database/ORM

| Check | What to verify | Severity |
|-------|---------------|----------|
| Sessions not managed | Use `with` or `yield` — never leave sessions open | High |
| Missing commit/rollback | Transactions must be explicitly committed or rolled back | High |
| Lazy loading in async | Access relationships with eager loading in async context | High |
| Missing indexes | Frequently queried/filtered fields need indexes | Medium |
| Raw SQL without params | `text(f"...")` or `execute(.*%)` — use bind parameters | Critical |
