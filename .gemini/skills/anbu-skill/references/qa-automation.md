---
name: qa-automation
description: Token-efficient QA automation workflow with agent-browser and Playwright Test. Use for E2E testing, browser testing, UI bug reproduction, creating flow files, codifying Playwright tests, and running deterministic regression suites.
---

# QA Automation (agent-browser + Playwright)

Token-efficient QA automation owned by **Anbu**. Explore once with scoped `agent-browser`, codify deterministically to Playwright Test, and re-run for zero LLM browsing tokens.

> [!NOTE]
> Architecture and diagrams are documented in [`docs/QA-AUTOMATION.md`](file:///home/andycungkrinx/experiment/portofolio/data/konoha/docs/QA-AUTOMATION.md).

## Tool Selection Matrix

| Stage | Tool | Cost | Purpose |
|---|---|---|---|
| **Explore** | `agent-browser` | LLM tokens | Discovery, interactive scoped accessibility snapshots, console/error capture. |
| **Codify** | `qa_codify` | Zero LLM | Deterministic converter from verified flow JSON to Playwright spec. |
| **Execute / Re-run** | `qa_e2e_run` | Zero LLM | Headless Playwright execution with compact summary and unique `run_id`. |

## Token Rules & Budgets

- **Scoped Snapshots**: Always use `snapshot -i -c` (interactive + compact). Scope with `-s "<selector>"` or `-d <depth>`. Never bare `snapshot`.
- **Differential Inspection**: Use `diff snapshot` or specific state queries (`get text`, `is visible`, `wait --text`) instead of repeated full snapshots. Max 1 full snapshot per page.
- **Budget Limits**: Max 2 screenshots per finding (`~/.konoha/tmp/qa/`, JPEG q60). Max 15 actions per area without findings. Max output capped at 4000 chars.
- **Batch Sequences**: Execute multi-step commands via `agent-browser batch --bail --json`.
- **State Persistence**: Authenticate once, persist via `state save` under `~/.konoha/tmp/qa/state/` with `AGENT_BROWSER_ENCRYPTION_KEY`.

## Evidence Contract & No Fake Green

| Claim | Required Verification Evidence |
|---|---|
| Route / Selector exists | Genin Semble citation with exact `file:line`. |
| Flow verified | `agent-browser batch --bail --json` exit code 0 on flow hash. |
| Bug confirmed | RED `qa_e2e_run` summary carrying unique `run_id`. |
| Bug resolved | GREEN `qa_e2e_run` summary on identical test file and hash. |
| Clean scope | Report as `none found in <scope>, <N> actions` (never "bug-free"). |

**Strict Anti-Fake Green Rules**: Never add `test.skip`, `test.fixme`, `.only`, or `try/catch` around assertions. Never weaken expectations or increase timeouts to bypass failures.

## Playwright Overrides for Agent Runs

| Setting | Standard Human CI (`e2e-testing-expert`) | Agent QA Run (`qa_e2e_run`) | Rationale |
|---|---|---|---|
| Reporter | `html`, `junit` | `line` / JSON parsed by `qa_e2e_run` | Keeps context under 2,000 chars. |
| Retries | `2` in CI | `0` | Eliminates flaky loops and token sinks. |
| Tracing | `on-first-retry` | `retain-on-failure`, no video | Retains diagnostics without bloat. |
| Browsers | Chromium, Firefox, WebKit, Mobile | Chromium only | Fast single-engine repro loop. |

## 6-Step QA Execution Loop

1. **Explore**: Probe target routes using Genin `file:line` references and scoped snapshots (`snapshot -i -c -s`).
2. **Record Flow**: Write `<test-dir>/e2e/flows/<name>.json` using semantic locators (`find role|label|text|testid`).
3. **Verify Flow**: Execute `agent-browser batch --bail --json < flow.json` to guarantee repeatability.
4. **Codify & Prove Red**: Call `qa_codify` to emit Playwright spec, run `qa_e2e_run` to prove failure (RED).
5. **Fix & Prove Green**: Anbu fixes backend/API issues; Jonin fixes UI code. Anbu re-runs `qa_e2e_run` to prove pass (GREEN).
6. **Scan & Report**: Run `aislop_scan`, generate report using `qa-automation-assets/references/report-template.md`, and record `run_id` in SDLC task evidence.

## QA Run Housekeeping & Workspace Hygiene

- **Output Redirection**: `qa_e2e_run` passes `--output ~/.konoha/tmp/qa/projects/<hash>/artifacts` and `PLAYWRIGHT_JSON_OUTPUT_NAME=~/.konoha/tmp/qa/<run_id>/report.json`, keeping the project tree clean without modifying project configuration.
- **Managed `.gitignore` Block**: In git repositories, `qa_e2e_run` automatically adds an idempotent block between `# KONOHA-QA-START` and `# KONOHA-QA-END` ignoring `test-results/`, `playwright-report/`, `blob-report/`, and `playwright/.cache/`. Opt out by setting `KONOHA_QA_GITIGNORE=0`.
- **Deliverables Protected**: Deliverables (`<test-dir>/e2e/flows/`, specs, and `reports/`) are permanently tracked and never ignored or pruned.
- **Evidence Persistence**: Failure traces and screenshots (up to 5) are copied into `~/.konoha/tmp/qa/<run_id>/artifacts/` to preserve evidence across project runs.
- **Retention**: Old run folders are automatically pruned keeping newest N runs (default 20, overridable via `KONOHA_QA_RETENTION_COUNT`). Runs linked to open SDLC tasks are protected from pruning; if evidence lookup is unavailable, runs younger than 7 days are preserved.

