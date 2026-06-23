# FastAPI Code Review

> Read when: reviewing, auditing, or hardening FastAPI applications, route handlers, Pydantic schemas, dependencies, async behavior, database sessions, or Python API security.

## Contents

- [Review Output Format](#review-output-format)
- [Verification Gates](#verification-gates)
- [Security Checks](#security-checks)
- [Routing Checks](#routing-checks)
- [Validation and Pydantic Checks](#validation-and-pydantic-checks)
- [Dependency Injection Checks](#dependency-injection-checks)
- [Async and Blocking I/O Checks](#async-and-blocking-io-checks)
- [Database Session and Transaction Checks](#database-session-and-transaction-checks)
- [CORS, Middleware, and Config Checks](#cors-middleware-and-config-checks)
- [Performance Checks](#performance-checks)
- [Testing Gaps](#testing-gaps)
- [Concrete Fix Examples](#concrete-fix-examples)
- [Final Checklist](#final-checklist)

## Review Output Format

Report findings in severity order:

```text
severity | location | issue | impact | concrete fix
```

Severity guide:
- **Critical** — auth bypass, data exposure, SQL injection, arbitrary file access, credential leak.
- **High** — broken authorization, unsafe CORS with credentials, blocking production endpoints, transaction corruption.
- **Medium** — missing response models, weak validation, error leakage, test gaps on important flows.
- **Low** — style, consistency, docs, non-blocking maintainability improvements.

Only report findings with a file/line anchor. Avoid generic FastAPI advice unless it maps to visible code.

## Verification Gates

Before asserting a FastAPI finding:
1. Inspect the route decorator: method, path, `response_model`, `status_code`, router-level dependencies.
2. Inspect the full handler body and dependencies it calls.
3. For missing auth claims, search router, app include site, and dependency aliases for `Depends`, `Security`, `OAuth2`, `HTTPBearer`, or project auth helpers.
4. For missing validation claims, confirm the parameter is not already a Pydantic model or constrained `Query`/`Path`/`Body`.
5. For async/blocking claims, name each blocking call with location.

## Security Checks

- Protected resources require authentication and object-level authorization.
- Role checks use dependencies or service policies, not frontend-only logic.
- Secrets come from settings/env, never literals or committed `.env` files.
- Passwords are hashed with a current password hashing library.
- JWT verification checks signature, expiration, token type/audience when used.
- Error handlers do not leak stack traces, SQL errors, tokens, or internal IDs unnecessarily.
- File uploads validate size, content type, extension, and storage location.
- Logs redact passwords, access tokens, refresh tokens, API keys, and PII.
- Public mutations and auth endpoints are strictly rate-limited to prevent brute-force attacks.

## Routing Checks

- Routes are grouped with `APIRouter(prefix=..., tags=[...])`.
- Versioned APIs use a consistent prefix such as `/api/v1`.
- Mutations use POST/PATCH/PUT/DELETE, not GET.
- Create routes return `201`; async job routes return `202`; deletes return `204` when no body.
- Response models are explicit for public routes.
- Path parameters use constraints where needed (`Path(gt=0)`).

## Validation and Pydantic Checks

- Request bodies use Pydantic v2 models, not raw `dict`/manual JSON parsing.
- Pydantic v2 syntax is used: `field_validator`, `model_validator`, `ConfigDict`, `model_dump()`.
- Response schemas exclude secrets (`password_hash`, tokens, internal notes).
- Query params have bounds for pagination and filters.
- Unknown extra fields are rejected when strict input is required.
- Custom business validation lives in schemas or services, not duplicated across handlers.

## Dependency Injection Checks

- Dependencies are injected with `Depends()` / `Annotated[..., Depends(...)]`, not manually called.
- Yield dependencies clean up resources in `finally`.
- Database sessions are request-scoped.
- Shared mutable state is not stored in dependencies without proper concurrency control.
- Router-level security dependencies are used where all routes require the same guard.
- Cross-cutting side effects such as request logging belong in middleware, not random dependencies.

## Async and Blocking I/O Checks

Flag blocking work inside `async def` handlers:
- `requests.*` instead of `httpx.AsyncClient`.
- `time.sleep()` instead of `asyncio.sleep()`.
- sync SQLAlchemy session/driver in async routes.
- sync file I/O for large files or hot paths.
- CPU-heavy work running inline instead of a worker queue.

Do not flag `async def` without `await` by itself; it may be a valid lightweight handler.

## Database Session and Transaction Checks

- Async routes use `AsyncSession` and SQLAlchemy async APIs.
- Transactions have one clear commit/rollback owner.
- Repository methods avoid hidden commits when the request dependency commits.
- Queries are parameterized; raw SQL uses bound parameters.
- List endpoints paginate and avoid unbounded `.all()` over large tables.
- Relationship loading avoids N+1 (`selectinload`, `joinedload`).
- Test dependency overrides isolate test database state.

## CORS, Middleware, and Config Checks

- `allow_origins=["*"]` is not combined with `allow_credentials=True` in production.
- Allowed methods/headers are no broader than needed.
- Trusted hosts, HTTPS redirects, proxy headers, and async Redis rate limiting are configured.
- Settings use `pydantic-settings` and environment variables.
- Debug mode and docs exposure are intentional for the environment.

## Performance Checks

- Independent async calls are awaited concurrently when safe (`asyncio.gather`).
- Long tasks use `BackgroundTasks` only for small non-critical work; reliable jobs use a queue.
- External HTTP clients use timeouts.
- Database indexes support common filters and unique constraints.
- Large responses stream or paginate.

## Testing Gaps

Look for tests covering:
- validation failures (`422`), not found (`404`), unauthorized (`401`), forbidden (`403`), conflicts (`409`), success paths.
- dependency overrides for auth and database.
- transaction rollback on errors.
- async route behavior using `httpx.AsyncClient`/`ASGITransport`.
- security-sensitive flows: login, refresh, logout, role checks, file upload.

## Concrete Fix Examples

Blocking HTTP call:

```python
# Replace requests in async routes
async with httpx.AsyncClient(timeout=10) as client:
    response = await client.get(url)
```

Validated pagination:

```python
async def list_items(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100)):
    ...
```

Yield dependency cleanup:

```python
async def get_db():
    async with SessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
```

Router-level auth:

```python
router = APIRouter(prefix="/admin", dependencies=[Depends(require_admin)])
```

## Final Checklist

- [ ] Findings sorted by severity.
- [ ] Every finding has `file:line` evidence.
- [ ] FastAPI automatic behavior was considered before flagging missing code.
- [ ] Auth and authorization checked separately.
- [ ] Pydantic validation and response filtering checked.
- [ ] Dependency cleanup and DB transaction ownership checked.
- [ ] Async handlers checked for real blocking I/O.
- [ ] CORS/secrets/logging reviewed.
- [ ] Tests and concrete fixes included.
