# Codebase Exploration Router

> Load only when routing is ambiguous or a task spans multiple exploration modes. Do not load every reference by default.

## Core routing rule

Use progressive discovery: inspect shape → search symbols/patterns → open only relevant ranges → summarize → expand only when necessary.

## Guardrail routing

Do not load these guardrail references for every task. Load them only when the trigger is present.

| Trigger | Load |
|---|---|
| Large/multi-reference/multi-domain task | `references/token-safety.md` |
| Shell commands, scripts, deployments, file edits | `references/command-safety.md` |
| Commands, code, config, YAML/JSON, env files, filenames, paths, Skill metadata, or package files with character risk | `references/character-hygiene.md` |
| Secrets, `.env`, credentials, tokens, auth config, logs | `references/secret-safety.md` |
| Production, destructive, security-sensitive, or ambiguous risk | `references/guardrails.md` |

- For simple single-topic exploration, load only the matching exploration/review reference; do not load guardrails unless risk is present.
- Load `references/token-safety.md` for large repo exploration.
- Load `references/character-hygiene.md` when checking syntax-sensitive files for accidental non-ASCII, invisible, full-width, smart quote, dash, or homoglyph characters.
- Load `references/secret-safety.md` when searching config/env/auth files.
- Load `references/command-safety.md` before running scripts or modifying files.
- Load `references/guardrails.md` for destructive, production, security-sensitive, or ambiguous risk.

| User intent | First actions | Load | Avoid |
|---|---|---|---|
| Repo overview / “explain this repo” | `pwd`; list top-level files with exclusions | `references/code-exploration.md`; add `references/context-optimization.md` for very large repos | full repo dumps, reading generated folders, any `git` commands |
| Architecture mapping | Identify entrypoints, package manifests, services, boundaries, dependency direction | `references/architecture-analysis.md` + `references/code-exploration.md` | reading unrelated features |
| “Where is X implemented?” | Search exact names, aliases, route strings, exports/imports with `rg` | `references/code-exploration.md` | broad file reads before search |
| Symbol/function/class tracing | Search definitions and references; read definition range and direct callers only | `references/code-exploration.md` | recursive browsing unrelated modules |
| API route discovery | Search route registration, controllers, handlers, routers, OpenAPI specs | `references/code-exploration.md`; add `references/backend-review.md` only for backend quality/security review | frontend refs unless client usage matters |
| Frontend component discovery | Search component names, route files, exports, UI text, story/test files | `references/code-exploration.md`; add `references/frontend-review.md` for frontend quality review | backend refs unless data flow crosses API |
| Backend service discovery | Search handlers, services, repositories, jobs, queues, DI containers | `references/code-exploration.md`; add `references/backend-review.md` for backend review | frontend refs unless needed for flow |
| Database/model/migration discovery | Search model names, migrations, schema files, ORM repositories, SQL strings | `references/code-exploration.md`; add `references/backend-review.md` for DB safety review | unrelated datastore refs |
| Config/build/deployment discovery | Inspect package manifests, build configs, Docker/CI/IaC files, env key names only | `references/code-exploration.md` | printing `.env` values or secrets |
| Bug investigation | Search error text, stack trace symbols, failing test names, route/component names | `references/code-exploration.md`; add `references/code-review.md` if assessing a proposed fix | scanning the whole repo first |
| Performance investigation | Search slow queries, loops, N+1 patterns, cache usage, bundle-heavy imports, repeated network calls | `references/code-exploration.md`; add `references/backend-review.md` or `references/frontend-review.md` by domain | premature full architecture review |
| Security-sensitive exploration | Search auth, authorization, validation, uploads, SQL, shell execution, deserialization, secrets by key names only | `references/code-exploration.md` + `references/backend-review.md` or `references/frontend-review.md` only when reviewing domain findings | printing secrets, exploit walkthroughs |
| Refactor/change planning | Identify touched files, callers, tests, configs, migration impact, rollback plan | `references/code-exploration.md` + `references/architecture-analysis.md` if system impact matters | editing before plan when user asked for plan |
| Test discovery | Search `test`, `spec`, fixtures, integration/e2e names, CI commands | `references/code-exploration.md`; add `references/code-review.md` for test quality review | running expensive suites without scope |
| Dependency analysis | Inspect manifests, lockfiles summary, import graph, risky transitive clues | `references/code-exploration.md`; add `references/architecture-analysis.md` for coupling | dumping full lockfiles |
| Diff/PR review | Read diff first; inspect only changed ranges and necessary surrounding context | `references/code-review.md`; add backend/frontend refs by changed file type | reviewing unrelated files |
| Deep research / source comparison | Decompose question, gather sources, score credibility, track citations | `references/research-methodology.md`, `references/source-evaluation.md` | uncited claims |
| Formal report | Build findings from evidence, use templates only for formal deliverables | `references/report-quality.md`; templates only when needed | loading templates for quick answers |
| Token-efficiency audit | Check routing, loaded context, repeated reads, oversized outputs | `references/context-optimization.md` | adding broad context without need |

## Safe command patterns

Prefer tool-native search/read APIs when available. When shell is appropriate, keep commands scoped and exclude heavy paths.

```bash
# quick repo shape (never use git commands)
pwd
find . -maxdepth 2 -type f \
  ! -path './.git/*' \
  ! -path './node_modules/*' \
  ! -path './vendor/*' \
  ! -path './dist/*' \
  ! -path './build/*' \
  | sort | head -200

# targeted symbol search
rg -n "SEARCH_TERM" \
  --glob '!node_modules/**' \
  --glob '!vendor/**' \
  --glob '!dist/**' \
  --glob '!build/**' \
  --glob '!.git/**'

# read only a relevant range
sed -n '1,160p' path/to/file
```

## Exclude by default

Skip heavy/generated directories unless explicitly needed: `.git`, `node_modules`, `vendor`, `dist`, `build`, `.next`, `.svelte-kit`, `coverage`, `.cache`, `target`, `__pycache__`, `.venv`, `venv`, `storage/logs`, `tmp`, and `logs`.

Do not inspect binaries, minified files, generated bundles, lockfile internals, or large artifacts unless they are directly relevant.

## Safety gates

- Do not print `.env` values, private keys, tokens, credentials, cookies, or secrets. Redact as `[REDACTED]` if encountered.
- Do not run untrusted scripts from the target codebase without inspecting the script and explaining why it is needed.
- Do not install dependencies unless required for the user’s task.
- Do not run destructive commands or mutate files unless the user explicitly asks for changes.
- For write operations, propose a patch plan or create a backup before editing.
- For security investigations, stay defensive and authorized; focus on remediation evidence.
