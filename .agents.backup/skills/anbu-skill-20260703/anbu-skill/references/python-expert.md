# Python Expert for DevSecOps Automation

> Read when: writing or reviewing Python automation, DevOps scripts, CLIs, infrastructure helpers, cloud/API clients, security tooling, CI utilities, or Python scripts that call Terraform, Helm, Kubernetes, or cloud APIs.

## Contents

- When to Use Python in DevSecOps
- Safety Rules for Python Automation
- Script Structure
- CLI Patterns: argparse, Typer, and Click
- File and System Automation
- API Clients with requests/httpx
- JSON, YAML, and TOML Parsing
- Subprocess Safety
- Environment Variables and Secret Safety
- Logging Without Leaking Secrets
- Error Handling and Retries
- Idempotency and Dry-Run Design
- Testing with pytest
- Linting, Formatting, and Type Checking
- Packaging, uv, venv, and pip Basics
- Cloud and Infrastructure Automation
- Terraform, Helm, Kubernetes, and CI Helpers
- Python Code Quality Rules
- Copy-Paste Output Style

## When to Use Python in DevSecOps

Use Python when shell scripts become too complex or when you need:

- structured JSON/YAML/TOML parsing and validation;
- API clients for cloud, Kubernetes, CI systems, scanners, or internal services;
- cross-platform file/system automation;
- robust error handling, retries, and tests;
- reusable CLI tooling with typed options;
- security scanners, reporting utilities, or policy checks;
- CI helper scripts that validate outputs, summarize reports, or enforce gates.

Prefer Bash for small glue commands and one-liners. Prefer Python when logic, data structures, testing, or API calls matter.

## Safety Rules for Python Automation

- Avoid destructive filesystem/cloud/infrastructure operations unless explicitly requested.
- Add `--dry-run` for scripts that modify files, cloud resources, Kubernetes objects, Terraform state, or production data.
- Validate paths before deleting, overwriting, moving, or chmod/chown operations.
- Never hardcode secrets; use environment variables, cloud secret managers, Vault, or CI secrets.
- Do not log secrets, tokens, cookies, private keys, full environment dumps, or sensitive payloads.
- Avoid `shell=True`; pass subprocess commands as argument lists.
- Add timeouts to network calls and subprocesses.
- Handle exceptions clearly with actionable messages and non-zero exit codes.
- Prefer idempotent scripts; make repeated runs safe.
- For infra scripts, include rollback, backup, or safe-failure notes when relevant.

## Script Structure

Use a small, explicit structure:

```python
#!/usr/bin/env python3
"""Validate Terraform output JSON for required keys."""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path


LOGGER = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate Terraform outputs")
    parser.add_argument("output_json", type=Path, help="Path to terraform output -json file")
    parser.add_argument("--required", action="append", default=[], help="Required output key")
    return parser.parse_args()


def load_outputs(path: Path) -> dict[str, object]:
    if not path.is_file():
        raise FileNotFoundError(f"output file not found: {path}")
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    args = parse_args()
    outputs = load_outputs(args.output_json)
    missing = [key for key in args.required if key not in outputs]
    if missing:
        LOGGER.error("missing required outputs: %s", ", ".join(missing))
        return 1
    LOGGER.info("all required outputs are present")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

## CLI Patterns: argparse, Typer, and Click

Choose by complexity:

| Tool | Use when |
|---|---|
| `argparse` | Standard-library CLI, minimal dependencies, CI helpers |
| `Typer` | Typed multi-command CLI, rich help, modern Python UX |
| `Click` | Mature multi-command CLI, plugin ecosystems |

Argparse is best for DevSecOps scripts that must run anywhere. Typer/Click are useful for internal tools with dependency management.

Typer skeleton:

```python
import typer

app = typer.Typer(no_args_is_help=True)


@app.command()
def rotate_logs(path: str, dry_run: bool = True) -> None:
    """Rotate logs under PATH with dry-run enabled by default."""
    typer.echo(f"dry_run={dry_run} path={path}")


if __name__ == "__main__":
    app()
```

## File and System Automation

- Use `pathlib.Path`, not ad-hoc string concatenation.
- Check parent directories and path boundaries before writing.
- Use context managers for files, locks, network clients, and temp dirs.
- Prefer atomic writes for config/report generation.
- Keep deletion operations behind `--dry-run` or explicit confirmation.

Path safety pattern:

```python
from pathlib import Path


def resolve_inside(base: Path, candidate: Path) -> Path:
    base_resolved = base.resolve()
    target = candidate.resolve()
    if base_resolved not in target.parents and target != base_resolved:
        raise ValueError(f"path escapes allowed base: {target}")
    return target
```

## API Clients with requests/httpx

Use `httpx` for modern sync/async clients; use `requests` when already standard in a project.

```python
import httpx


def fetch_json(url: str, token: str) -> dict[str, object]:
    headers = {"Authorization": f"Bearer {token}"}
    with httpx.Client(timeout=httpx.Timeout(10.0), follow_redirects=False) as client:
        response = client.get(url, headers=headers)
        response.raise_for_status()
        return response.json()
```

Rules:
- set connect/read/write timeouts;
- avoid logging authorization headers or full URLs with sensitive query strings;
- validate TLS by default;
- use retry/backoff for transient status codes only;
- avoid following redirects for security-sensitive internal requests unless intended.

## JSON, YAML, and TOML Parsing

- Use `json` for JSON.
- Use `tomllib` on Python 3.11+ for TOML reads.
- Use `yaml.safe_load` / `safe_dump`; never `yaml.load` on untrusted content.
- Validate parsed data with typed checks, dataclasses, Pydantic, or explicit schema logic.

```python
import tomllib
from pathlib import Path


def read_pyproject(path: Path) -> dict[str, object]:
    with path.open("rb") as handle:
        return tomllib.load(handle)
```

## Subprocess Safety

Use subprocess only when no native API/library is practical.

```python
import subprocess


def run_terraform_output(workdir: str) -> str:
    result = subprocess.run(
        ["terraform", "output", "-json"],
        cwd=workdir,
        text=True,
        capture_output=True,
        timeout=60,
        check=True,
    )
    return result.stdout
```

Rules:
- pass command arguments as a list;
- keep `shell=False` unless there is a documented, unavoidable reason;
- set `cwd` explicitly when command context matters;
- set `timeout`;
- capture and redact output before logging;
- treat command output as untrusted input.

## Environment Variables and Secret Safety

- Read required secrets from environment or secret managers.
- Validate required env vars at startup with clear missing-config messages.
- Do not print environment dumps in CI.
- Keep `.env.example` placeholders non-secret.

```python
import os


def require_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"required environment variable is missing: {name}")
    return value
```

## Logging Without Leaking Secrets

Prefer structured, contextual logging with redaction:

```python
SENSITIVE_KEYS = ("token", "secret", "password", "authorization", "api_key")


def redact(value: str) -> str:
    if len(value) <= 8:
        return "[REDACTED]"
    return f"{value[:4]}...[REDACTED]"


def safe_dict(data: dict[str, object]) -> dict[str, object]:
    return {
        key: "[REDACTED]" if any(s in key.lower() for s in SENSITIVE_KEYS) else value
        for key, value in data.items()
    }
```

Log request IDs, resource IDs, regions, durations, and result states. Avoid tokens, raw secrets, full payloads, and sensitive user data.

## Error Handling and Retries

- Catch specific exceptions.
- Preserve stack traces for debugging when safe, but avoid leaking internals to users.
- Return non-zero exit codes for CLI failures.
- Retry only idempotent operations.
- Use exponential backoff with jitter for transient API failures.

```python
import random
import time
from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")


def retry(operation: Callable[[], T], attempts: int = 3, base_delay: float = 0.5) -> T:
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return operation()
        except (TimeoutError, ConnectionError) as exc:
            last_error = exc
            if attempt == attempts:
                break
            time.sleep(base_delay * (2 ** (attempt - 1)) + random.random() / 10)
    raise RuntimeError("operation failed after retries") from last_error
```

## Idempotency and Dry-Run Design

Idempotent scripts are safe to rerun:

- check current state before changing it;
- compare desired vs actual state;
- write reports deterministically;
- do not duplicate resources on retry;
- make `--dry-run` show planned actions without changing state.

```python
def maybe_write(path: Path, content: str, dry_run: bool) -> bool:
    existing = path.read_text(encoding="utf-8") if path.exists() else None
    if existing == content:
        return False
    if dry_run:
        print(f"would update {path}")
        return True
    path.write_text(content, encoding="utf-8")
    return True
```

## Testing with pytest

Include tests for success, failure, dry-run, invalid config, and edge cases.

```python
from pathlib import Path

from mytool.validate_outputs import load_outputs


def test_load_outputs(tmp_path: Path) -> None:
    path = tmp_path / "outputs.json"
    path.write_text('{"bucket": {"value": "example"}}', encoding="utf-8")
    assert "bucket" in load_outputs(path)
```

Testing guidance:
- use `tmp_path` for filesystem tests;
- monkeypatch env vars with `monkeypatch`;
- mock network/cloud calls;
- add sample invocation in README or script docstring;
- test destructive code in dry-run mode.

## Linting, Formatting, and Type Checking

Typical commands:

```bash
python -m pytest
python -m ruff check .
python -m ruff format .
python -m mypy src
```

Use type hints on public functions, return types, and complex data structures. Prefer dataclasses for structured internal data.

## Packaging, uv, venv, and pip Basics

Prefer a `pyproject.toml` for tools and dependencies.

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install -U pip
python -m pip install -e '.[dev]'
```

With `uv`:

```bash
uv venv
uv pip install -e '.[dev]'
uv run pytest
```

Keep dependency installation documented and pinned where CI/reproducibility matters.

## Cloud and Infrastructure Automation

Patterns:
- prefer official SDKs for cloud APIs when available;
- make region/account/project explicit;
- use default credential chains only when project conventions allow;
- add pagination for list APIs;
- handle API throttling and eventual consistency;
- output machine-readable JSON when used in CI.

For infrastructure changes, print planned actions, support dry-run, and document rollback/safe-failure behavior.

## Terraform, Helm, Kubernetes, and CI Helpers

Python can validate and orchestrate, but avoid hiding critical IaC behavior.

Terraform helpers:
- parse `terraform output -json` or plan JSON;
- do not mutate state directly;
- call `terraform plan`/`validate` with explicit working directory and timeout.

Kubernetes helpers:
- prefer the Kubernetes Python client for API checks;
- when shelling out to `kubectl`, pass argument lists and set timeouts;
- avoid scripts that silently delete or restart workloads.

CI helpers:
- emit clear exit codes;
- write artifacts to predictable paths;
- redact logs;
- keep commands copy-paste-ready.

## Python Code Quality Rules

Correctness first:
- no mutable default arguments;
- no bare `except:` or silent failures;
- validate edge cases and input types;
- use context managers for files/resources.

Type safety:
- annotate function arguments and return values;
- use `dataclass(frozen=True)` for immutable config/data containers;
- avoid `Any` unless boundary data is truly untyped.

Performance:
- use comprehensions for simple transformations;
- use generators/cursors for large datasets;
- profile before optimizing;
- prefer standard library primitives before custom code.

Style:
- follow PEP 8 naming and formatting;
- write docstrings for public functions/classes;
- keep functions small and testable;
- comments explain why, not obvious what.

## Copy-Paste Output Style

For Python implementation tasks, provide:

```text
scripts/validate_terraform_outputs.py
tests/test_validate_terraform_outputs.py
pyproject.toml  # if dependencies/tooling are needed
```

Include:
- complete file contents, not fragments;
- exact install commands;
- sample invocation;
- validation commands;
- safety notes for dry-run/destructive behavior;
- rollback or safe-failure notes for infrastructure-changing scripts.
