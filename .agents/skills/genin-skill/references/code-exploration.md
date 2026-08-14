# Code Exploration

> Load when: reading unfamiliar repos, tracing call flows, mapping dependencies, finding entrypoints, or understanding project structure.

## Exploration workflow

1. **Inspect structure** — read top-level directory, README, and key manifests only.
2. **Search symbols/patterns** — locate entrypoints, routes, classes, functions, tests, and configs with targeted search.
3. **Open relevant ranges** — read only matching files or line ranges; check size before opening huge files.
4. **Map call flows** — trace from entrypoint to the area of interest. Follow imports, not guesses.
5. **Inspect tests/configuration** — tests reveal behavior; CI/Docker/IaC reveal deployment context.
6. **Summarize findings** — before making changes, summarize what you've learned and what remains uncertain.

## Rules

- Read narrowly — start with the relevant file, expand only when needed.
- Do not read unrelated files, full repositories, generated bundles, binaries, or minified files unless explicitly needed.
- Prefer `rg` over recursive `grep`. Never use `git grep` or any `git` command.
- Prefer targeted `find` with `-maxdepth`; exclude heavy/generated folders.
- Use `wc -l` or file size checks before opening huge files.
- Use `sed -n 'start,endp' file` or equivalent range reads instead of full large-file reads.
- Cite file paths and symbols (function names, class names) in findings.
- Distinguish facts ("this file exports X") from assumptions ("this likely handles Y").
- Prefer file maps and symbol maps over full-file reads.
- Summarize long files before expanding into details.
- Avoid repeated full-file reads — read once, extract what you need.
- Do not print secrets from `.env`, private keys, tokens, credentials, cookies, or logs; redact as `[REDACTED]`.

## Default exclusions

Exclude these unless directly relevant: `.git`, `node_modules`, `vendor`, `dist`, `build`, `.next`, `.svelte-kit`, `coverage`, `.cache`, `target`, `__pycache__`, `.venv`, `venv`, `storage/logs`, `tmp`, and `logs`.

## Useful patterns

| Goal | Approach |
|------|----------|
| Find where X is defined | `rg -n "def X|class X|function X|export.*X" --glob '!node_modules/**' --glob '!vendor/**'` |
| Find where X is used | `rg -n "import.*X|from.*X|require.*X|X\(" --glob '!dist/**' --glob '!build/**'` |
| Understand data flow | Trace from API handler → service → repository → database |
| Find config shape | Check env key names, docker-compose, CI config, settings modules; do not print secret values |
| Map dependencies | Read package.json/pyproject.toml + import graph |
| Find test coverage | Look for `test_*`, `*.spec.*`, `*.test.*` files |

## Safety and mutation limits

- Do not run untrusted scripts before inspecting the script and understanding side effects.
- Do not install dependencies unless required for the task.
- Do not run destructive commands during exploration.
- Do not modify files unless the user explicitly asks; for write tasks, create a patch plan or backup first.

## Output format

```
## Exploration Summary

### Entrypoints
- [file:line] — description

### Key Components
- [file] — responsibility

### Data Flow
entrypoint → service → repository → database

### Findings
- [Fact] description (file:line)
- [Inference] description (reasoning)
- [Open question] what remains unclear
```
