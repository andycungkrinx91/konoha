# QA Failure Triage Ladder

When a Playwright test or flow verification fails, follow this escalating triage ladder. **Stop at the first level that reveals the root cause** to minimize token consumption.

## Level 1: Compact Summary Inspection (Zero Browsing Tokens)

Inspect the compact output returned by `qa_e2e_run`:
- Examine failing test name, source `file:line`, and primary error message (first 12 lines).
- In ~80% of assertion or selector mismatches, Level 1 provides sufficient diagnosis.

## Level 2: Targeted Single-Test Reproduction

Re-run only the failing test with narrow filtering:
- Execute `qa_e2e_run` with `--grep "<test-name>" --max-failures 1`.
- Avoid running the full test suite while debugging a specific failure.

## Level 3: Targeted Browser Reproduction (Scoped Tokens)

If the failure cannot be explained by code and error snippets:
- Reproduce the failing step using `agent-browser`:
  ```bash
  agent-browser open "<url>"
  agent-browser snapshot -i -c -s "#failing-component"
  agent-browser errors
  agent-browser console
  ```
- Check for uncaught runtime exceptions or network API failures.

## Level 4: Trace File Inspection (Out-of-Context)

If timing, race conditions, or DOM detachment occurred:
- Note the trace path emitted by `qa_e2e_run` under `~/.konoha/tmp/qa/<run_id>/trace.zip`.
- Never paste raw trace archives or full JSON reports into conversation context.
