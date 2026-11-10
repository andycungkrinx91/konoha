# Konoha benchmark

Independent A/B measurement of whether Konoha reduces token spend without losing quality.
Konoha never judges itself: token counts come from the client CLI's provider-reported
`usage` block, and quality is scored by a third-party model using
[`judge_prompt.md`](judge_prompt.md).

## Design

| | Baseline | Konoha |
|---|---|---|
| Client | `claude -p` | `claude -p` |
| Model | pinned `BENCH_MODEL` | same `BENCH_MODEL` |
| Task text | `tasks/task_N.txt` | same file, byte-identical |
| Activation | none | prompt prefixed with `/konoha ` |
| Start state | clean worktree at HEAD | clean worktree at HEAD |
| Runs | 3 | 3 |

5 tasks x 2 modes x 3 runs = 30 runs. Report the **median** per task, never the mean.

Tokens counted per run: `usage.input_tokens + usage.output_tokens +
usage.cache_read_input_tokens + usage.cache_creation_input_tokens`.
Cache reads are included because they are billed context.

## Prerequisites

- `claude` CLI on PATH, authenticated, and `BENCH_MODEL` set to a model you can actually
  reach through the configured `ANTHROPIC_BASE_URL` (the harness fails fast if unset).
- Mode B needs the global skill installed: `konoha init --yes` (writes
  `~/.claude/skills/konoha/SKILL.md`).
- Nothing else. No daemons, no DB fixtures.

## Run

```bash
export BENCH_MODEL=<model-id-used-for-both-modes>
for t in 1 2 3 4 5; do
  for m in baseline konoha; do
    for r in 1 2 3; do
      benchmarks/run.sh "$t" "$m" "$r"
    done
  done
done
```

Each run creates its own throwaway worktree under `$TMPDIR` from HEAD and removes it on
exit, including on failure or Ctrl-C; your working tree is never reset or cleaned. Output
goes to `benchmarks/runs/<date>/task_<n>_<mode>_run<r>/`:

```
prompt.txt  log.json  stderr.txt  meta.txt  status.txt  diff_stat.txt  diff.patch
```

`diff.patch` is `git diff --cached` after `git add -A`, so files the agent created appear
as new-file hunks instead of vanishing with the worktree.

## Aggregate

```bash
node benchmarks/score.js            # -> benchmarks/results.csv + median table
node benchmarks/score.js --self-test
```

`results.csv` covers tokens, duration and exit code. Median columns use only runs that
exited 0 with non-zero usage; failed runs still appear in the CSV and in the `Valid runs`
column, so a cell of mostly crashes reads as `1/3`, not as a cheap run. Correctness,
quality, hallucination and minimal-change scores are filled in from the judge's table;
they are deliberately not automated.

`benchmarks/runs/` is committed with the results, not git-ignored: every run's `prompt.txt`,
`log.json`, `meta.txt`, `diff.patch` and `stderr.txt` ships alongside `results.csv`, so a
skeptic can recompute any median from the raw provider payloads.

## Tasks

Prompts are in [`tasks/`](tasks) and are byte-identical across modes (validity rule: one
changed word invalidates the comparison).

| # | Category | Target |
|---|---|---|
| 1 | Explore | `apps/web/src/` structure and dependencies, every claim cited |
| 2 | Bugfix | silent persistence failure in `src/mcp/todo_walkthrough_sync.js` |
| 3 | Feature | `--json` for the existing `konoha task list` |
| 4 | Refactor | split `src/mcp/workflow_gates.js` by gate phase, behavior frozen |
| 5 | UI | CSV export on the existing `/savings` page, no new endpoint |

The draft this benchmark came from proposed tasks that the repository contradicted:
`konoha task list` already exists (`bin/commands/task.js:107`) and `/savings` already
exists (`apps/web/src/routes/savings/+page.svelte`) with the `/api/v1/savings` payload
already wired. Re-issuing those as "build it" tasks would measure compliance with a stale
premise, not engineering. They are re-scoped to the gaps that still exist, verified against
source at commit `f3bef2e9`.

Task 2 asserts a real observable gap: the write is wrapped in `catch (_) {}`
(`src/mcp/todo_walkthrough_sync.js:132`), so a failed persist reports success.

## Validity rules

1. Same client, same model, same task text, same start commit. Only activation differs.
2. No self-reporting: tokens come from the provider `usage` block, never from Konoha.
3. Three runs per cell, median reported.
4. Failed runs are published, not retried into a nicer number. A run with
   `claude_exit != 0` or an empty diff is still a data point.
5. Publish every task, including ones where Konoha loses, with raw logs.

## Reporting

Do not write "83-98% context reduction" without this benchmark behind it. Write:

> Independent benchmark (third-party judge, 5 tasks, 3 runs each, one pinned model):
> median token saving 71%, correctness 9.2/10 (Konoha) vs 8.8/10 (baseline).
> Raw logs: `benchmarks/runs/2026-11-10/`.

## Status

Harness ready and self-tested; the 30 runs have not been executed, because they need your
provider budget and a reachable `BENCH_MODEL`. `results.csv` does not exist until the first
aggregate run.