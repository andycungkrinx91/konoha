# FastAPI Expert

> Read when: building FastAPI backends, async Python APIs, Pydantic schemas, database-backed services, authentication, background tasks, or production-ready Python API layers.

## Contents

- [Architecture Defaults](#architecture-defaults)
- [Project Structure](#project-structure)
- [Application Entry](#application-entry)
- [Routers and API Versioning](#routers-and-api-versioning)
- [Pydantic Schemas](#pydantic-schemas)
- [Settings and Environment](#settings-and-environment)
- [Database and Session Pattern](#database-and-session-pattern)
- [Service and Repository Pattern](#service-and-repository-pattern)
- [Authentication and Authorization](#authentication-and-authorization)
- [Middleware and CORS](#middleware-and-cors)
- [Errors and Validation](#errors-and-validation)
- [Background Tasks](#background-tasks)
- [Testing](#testing)
- [Deployment Notes](#deployment-notes)
- [Output Style](#output-style)

## Architecture Defaults

- Use Python 3.11+ and FastAPI with Pydantic v2.
- Prefer async route handlers for I/O-bound APIs.
- Use `Annotated[..., Depends(...)]` for dependency aliases.
- Keep route handlers thin: validate/request orchestration only.
- Put business rules in services and persistence in repositories/CRUD modules.
- Do not hardcode secrets, database URLs, CORS origins, or token settings.

## Project Structure

```text
app/
├─ main.py
├─ api/
│  └─ v1/
│     ├─ router.py
│     └─ endpoints/
│        ├─ auth.py
│        └─ users.py
├─ core/
│  ├─ config.py
│  ├─ database.py
│  └─ security.py
├─ models/
├─ schemas/
├─ services/
├─ repositories/
└─ tests/
```

## Application Entry

```python
# app/main.py
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.database import engine

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await engine.dispose()

app = FastAPI(title=settings.APP_NAME, version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(api_router, prefix=settings.API_V1_PREFIX)
```

## Routers and API Versioning

```python
# app/api/v1/router.py
from fastapi import APIRouter
from app.api.v1.endpoints import auth, users

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
```

```python
# app/api/v1/endpoints/users.py
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.schemas.user import UserCreate, UserRead
from app.services.user_service import UserService, get_user_service

router = APIRouter()
DB = Annotated[AsyncSession, Depends(get_db)]
UserSvc = Annotated[UserService, Depends(get_user_service)]

@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def create_user(payload: UserCreate, db: DB, service: UserSvc) -> UserRead:
    return await service.create(db, payload)

@router.get("/{user_id}", response_model=UserRead)
async def get_user(user_id: Annotated[int, Path(gt=0)], db: DB, service: UserSvc) -> UserRead:
    user = await service.get(db, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User not found")
    return user
```

## Pydantic Schemas

```python
# app/schemas/user.py
from datetime import datetime
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)
    name: str = Field(min_length=1, max_length=100)

    @field_validator("password")
    @classmethod
    def strong_password(cls, value: str) -> str:
        if not any(char.isdigit() for char in value):
            raise ValueError("Password must contain a number")
        return value

class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    name: str
    created_at: datetime
```

## Settings and Environment

```python
# app/core/config.py
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    APP_NAME: str = "FastAPI App"
    API_V1_PREFIX: str = "/api/v1"
    DATABASE_URL: str
    SECRET_KEY: str
    CORS_ORIGINS: list[str] = ["http://localhost:3000"]
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30

@lru_cache
def get_settings() -> Settings:
    return Settings()

settings = get_settings()
```

## Database and Session Pattern

```python
# app/core/database.py
from collections.abc import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

engine = create_async_engine(settings.DATABASE_URL, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
```

Use one transaction boundary per request or command. Avoid committing in both repository and dependency unless intentional.

## Service and Repository Pattern

```python
# app/repositories/user_repository.py
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.user import User
from app.schemas.user import UserCreate
from app.core.security import hash_password

class UserRepository:
    async def get(self, db: AsyncSession, user_id: int) -> User | None:
        result = await db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    async def get_by_email(self, db: AsyncSession, email: str) -> User | None:
        result = await db.execute(select(User).where(User.email == email))
        return result.scalar_one_or_none()

    async def create(self, db: AsyncSession, payload: UserCreate) -> User:
        user = User(email=payload.email, name=payload.name, hashed_password=hash_password(payload.password))
        db.add(user)
        await db.flush()
        await db.refresh(user)
        return user
```

```python
# app/services/user_service.py
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.repositories.user_repository import UserRepository
from app.schemas.user import UserCreate

class UserService:
    def __init__(self, repo: UserRepository) -> None:
        self.repo = repo

    async def create(self, db: AsyncSession, payload: UserCreate):
        if await self.repo.get_by_email(db, payload.email):
            raise HTTPException(status.HTTP_409_CONFLICT, detail="Email already registered")
        return await self.repo.create(db, payload)

    async def get(self, db: AsyncSession, user_id: int):
        return await self.repo.get(db, user_id)

def get_user_service() -> UserService:
    return UserService(UserRepository())
```

## Authentication and Authorization

- Hash passwords with Argon2 or bcrypt; never store plaintext.
- Read `SECRET_KEY` from settings.
- Use short-lived access tokens; add refresh tokens for long sessions.
- Express authorization as dependencies (`get_current_user`, `require_roles`).

```python
CurrentUser = Annotated[User, Depends(get_current_user)]

def require_roles(*roles: str):
    async def checker(user: CurrentUser) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Forbidden")
        return user
    return checker
```

## Middleware, CORS, and Rate Limiting

- Restrict CORS origins in production; never use `*` with credentials.
- Use middleware for cross-cutting request concerns: request IDs, timing, logging, security headers.
- **Rate Limiting**: Always implement rate limiting on public and authentication endpoints to prevent abuse. Use an async Redis backend (e.g., `fastapi-limiter`).

```python
from fastapi_limiter import FastAPILimiter
from fastapi_limiter.depends import RateLimiter
from redis.asyncio import Redis

@asynccontextmanager
async def lifespan(app: FastAPI):
    redis = redis.from_url(settings.REDIS_URL, encoding="utf-8", decode_responses=True)
    await FastAPILimiter.init(redis)
    yield
    await redis.close()

# Apply to routes
@router.post("/login", dependencies=[Depends(RateLimiter(times=5, seconds=60))])
async def login():
    ...
```

## Errors and Validation

- Use Pydantic models for body validation and `Query`/`Path` constraints for params.
- Use `HTTPException` for expected HTTP errors.
- Add exception handlers when clients need stable error shapes.
- Do not expose internal exception messages in production responses.

## Background Tasks

Use `BackgroundTasks` for short post-response work such as email dispatch. Use a queue (Celery, RQ, Dramatiq, Arq) for retries, long tasks, or cross-process reliability.

```python
from fastapi import BackgroundTasks

@router.post("/emails", status_code=status.HTTP_202_ACCEPTED)
async def send_email(payload: EmailPayload, background_tasks: BackgroundTasks) -> dict[str, str]:
    background_tasks.add_task(send_email_async, payload)
    return {"status": "queued"}
```

## Testing

- Use `pytest`, `pytest-asyncio`/AnyIO, and `httpx.AsyncClient` with `ASGITransport`.
- Override dependencies with `app.dependency_overrides`.
- Test success, validation failure, unauthorized, forbidden, not found, and transaction rollback paths.

```python
from httpx import ASGITransport, AsyncClient

async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
    response = await client.post("/api/v1/users", json={...})
```

## Deployment Notes

- Run behind `gunicorn` with `uvicorn` workers for production concurrency:
  `gunicorn app.main:app -w 4 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000`
  *(Rule of thumb: `workers = (2 * CPU_CORES) + 1`)*
- Containerize with non-root user, pinned dependencies, and no `.env` baked into images.
- Run migrations before release; keep rollback plan.
- Configure CORS, trusted hosts, Redis rate limiting, log redaction, and monitoring.

## Output Style

For implementation answers, provide complete files with paths:

```text
app/core/config.py
app/core/database.py
app/api/v1/endpoints/users.py
tests/test_users.py
```

Include commands to run (`pytest`, `ruff`, `mypy`, migration commands) and avoid fragments unless the user asks for a patch only.
