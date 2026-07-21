# Snapshot tests

## What this is

Pre/post snapshots of every deterministic CLI command and Python tool. Used
as a behavior-preservation gate between every refactor step. Any diff after
a refactor = regression.

## Files

- `tests/snapshot_capture.js` — captures stdout/stderr for ~17 CLI commands
  and ~6 Python tools. Strips ANSI, RGB color codes, `$HOME`, pids,
  timestamps, durations, UUIDs before writing.
- `tests/snapshot_diff.py` — diffs `snapshots/pre/` vs `snapshots/post/`.
  Exits 1 on any diff.
- `tests/snapshots/pre/` — the baseline captured before any refactor.
- `tests/snapshots/post/` — captured fresh after each step; deleted and
  re-captured between steps.

## What's *excluded* and why

The following mutate persistent state on each call, so capture-pre and
capture-post always differ even with identical code:

- CLI `savings` (writes per-call telemetry)
- Python `run_web_search` (writes to activity log)
- Python `optimize_report`, `detect_active_agent`, `get_active_session_id`
  (write to telemetry / active_sessions)

These are spot-checked manually when their owning modules are refactored.

## Usage

```bash
# after a refactor step:
node tests/snapshot_capture.js capture post
python3 tests/snapshot_diff.py
# exit 0 = behavior preserved
# exit 1 = regression; revert and fix
```

To regenerate the baseline (e.g., after an intentional CLI redesign):

```bash
rm -rf tests/snapshots/pre tests/snapshots/post
node tests/snapshot_capture.js capture pre
```
