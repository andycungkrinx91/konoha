---
name: qa-automation
description: Token-efficient QA automation workflow with Playwright. Use for E2E testing, browser testing, UI bug reproduction, creating flow files, codifying Playwright tests, and running deterministic regression suites.
---

# QA Automation (Playwright)

Token-efficient QA automation owned by **Anbu**. Explore once with a scoped Playwright script, codify deterministically to Playwright Test, and re-run for zero LLM browsing tokens.

> [!NOTE]
> Architecture and diagrams are documented in [`docs/QA-AUTOMATION.md`](docs/QA-AUTOMATION.md).

## Tool Selection Matrix

| Stage | Tool | Cost | Purpose |
|---|---|---|---|
| **Explore** | Throwaway Playwright script | LLM tokens | Discovery, scoped accessibility snapshots, console/error capture. |
| **Codify** | `qa_codify` | Zero LLM | Deterministic converter from verified flow JSON to Playwright spec. |
| **Execute / Re-run** | `qa_e2e_run` | Zero LLM | Headless Playwright execution with compact summary and unique `run_id`. |

## Token Rules & Budgets

- **Scoped Snapshots**: `page.locator(scope).ariaSnapshot()` only. Pass a container selector and guard it with `count()`; fall back to `body` when the container is absent, never `html`.
- **Differential Inspection**: Re-query a specific locator (`textContent`, `isVisible`, `waitFor`) instead of taking a second full snapshot. Max 1 snapshot per page.
- **Budget Limits**: Max 2 screenshots per finding (`~/.konoha/tmp/qa/`, JPEG q60). Max 15 actions per area without findings. Max output capped at 4000 chars.
- **Batch Sequences**: Drive the whole sequence in one script run; launch the browser once, not once per step.
- **State Persistence**: Authenticate once, persist with `context.storageState({ path: '~/.konoha/tmp/qa/state/auth.json' })`, reuse via `browser.newContext({ storageState })`.

## Evidence Contract & No Fake Green

| Claim | Required Verification Evidence |
|---|---|
| Route / Selector exists | Genin `code_search` citation with exact `file:line`. |
| Flow verified | `qa_codify` compile + Playwright run exit code 0 on the flow hash. |
| Bug confirmed | RED `qa_e2e_run` summary carrying unique `run_id`. |
| Bug resolved | GREEN `qa_e2e_run` summary on identical test file and hash. |
| Clean scope | Report as `none found in <scope>, <N> actions` (never "bug-free"). |

**Strict Anti-Fake Green Rules**: Never add `test.skip`, `test.fixme`, `.only`, or `try/catch` around assertions. Never weaken expectations or increase timeouts to bypass failures.

## Prerequisite Check: `qa_blocked`

Playwright is a hard requirement for QA, not for the core install. Before starting any exploration, confirm it resolves from the target project:

```bash
pnpm exec playwright --version   # must exit 0
pnpm exec playwright install chromium   # browsers, when the probe says the binary is missing
```

- `qa_codify` returns `{ "ok": false, "error": "qa_blocked", "reason": "playwright-not-installed", "fix": "pnpm exec playwright install chromium" }` when no Playwright project resolves above the output path. It never emits a spec it could not run.
- `qa_e2e_run` shells out to Playwright Test directly, so it shares the same prerequisite.
- **A missing browser is an unexecuted test.** Report `qa_blocked` as BLOCKED, never as a pass and never as "no bugs found".

> [!WARNING]
> Playwright is invoked through the project's own package manager (`pnpm exec playwright`), so the target project owns the version, the browser cache, and `PLAYWRIGHT_BROWSERS_PATH`. Do not reach for a global CLI or `npx`: a second install diverges from the project's pinned browser build and produces version-skew failures that look like product bugs.

## Playwright Overrides for Agent Runs

| Setting | Standard Human CI (`e2e-testing-expert`) | Agent QA Run (`qa_e2e_run`) | Rationale |
|---|---|---|---|
| Reporter | `html`, `junit` | `line` / JSON parsed by `qa_e2e_run` | Keeps context under 2,000 chars. |
| Retries | `2` in CI | `0` | Eliminates flaky loops and token sinks. |
| Tracing | `on-first-retry` | `retain-on-failure`, no video | Retains diagnostics without bloat. |
| Browsers | Chromium, Firefox, WebKit, Mobile | Chromium only | Fast single-engine repro loop. |

## 6-Step QA Execution Loop

1. **Explore**: Probe target routes using Genin `file:line` references and a throwaway Playwright script with scoped `ariaSnapshot()`.
2. **Record Flow**: Write `<test-dir>/e2e/flows/<name>.json` using semantic locators (`find role|label|text|testid`).
3. **Verify Flow**: `qa_codify` compiles the flow, runs the compiled spec, and deletes it on exit 0.
4. **Codify & Prove Red**: Keep the emitted Playwright spec, run `qa_e2e_run` to prove failure (RED).
5. **Fix & Prove Green**: Anbu fixes backend/API issues; Jonin fixes UI code. Anbu re-runs `qa_e2e_run` to prove pass (GREEN).
6. **Scan & Report**: Run `aislop_scan`, generate report using `qa-automation-assets/references/report-template.md`, and record `run_id` in SDLC task evidence.

## QA Run Housekeeping & Workspace Hygiene

- **Output Redirection**: `qa_e2e_run` passes `--output ~/.konoha/tmp/qa/projects/<hash>/artifacts` and `PLAYWRIGHT_JSON_OUTPUT_NAME=~/.konoha/tmp/qa/<run_id>/report.json`, keeping the project tree clean without modifying project configuration.
- **Managed `.gitignore` Block**: In git repositories, `qa_e2e_run` automatically adds an idempotent block between `# KONOHA-QA-START` and `# KONOHA-QA-END` ignoring `test-results/`, `playwright-report/`, `blob-report/`, and `playwright/.cache/`. Opt out by setting `KONOHA_QA_GITIGNORE=0`.
- **Deliverables Protected**: Deliverables (`<test-dir>/e2e/flows/`, specs, and `reports/`) are permanently tracked and never ignored or pruned.
- **Evidence Persistence**: Failure traces and screenshots (up to 5) are copied into `~/.konoha/tmp/qa/<run_id>/artifacts/` to preserve evidence across project runs.
- **Retention**: Old run folders are automatically pruned keeping newest N runs (default 20, overridable via `KONOHA_QA_RETENTION_COUNT`). Runs linked to open SDLC tasks are protected from pruning; if evidence lookup is unavailable, runs younger than 7 days are preserved.
