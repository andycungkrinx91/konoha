#!/usr/bin/env bash
# One benchmark run = one cold agent session on a clean worktree at HEAD.
# Usage: BENCH_MODEL=<model-id> benchmarks/run.sh <task_id> <baseline|konoha> <run_number>
# Token counts are never read from Konoha; they come from the client CLI's
# reported `modelUsage` block (or `usage` fallback) in log.json.
set -euo pipefail

TASK_ID=${1:?task id, e.g. 3}
MODE=${2:?mode: baseline or konoha}
RUN=${3:?run number, e.g. 1}
: "${BENCH_MODEL:?set BENCH_MODEL to the pinned model id, identical for both modes}"

ROOT=$(cd "$(dirname "$0")/.." && pwd)
TASK_FILE="$ROOT/benchmarks/tasks/task_${TASK_ID}.txt"
OUT_ROOT=${BENCH_OUT_ROOT:-$ROOT/benchmarks/runs}
OUT="$OUT_ROOT/$(date +%F)/task_${TASK_ID}_${MODE}_run${RUN}"

[ -f "$TASK_FILE" ] || { echo "missing $TASK_FILE" >&2; exit 2; }
[ "$MODE" = baseline ] || [ "$MODE" = konoha ] || { echo "mode must be baseline or konoha" >&2; exit 2; }

# Every run gets its own throwaway worktree at HEAD, removed on exit (success,
# failure, or Ctrl-C). The caller's tree is never reset or cleaned.
WORK=$(mktemp -d "${TMPDIR:-/tmp}/konoha-bench-XXXXXX")
rmdir "$WORK"
git -C "$ROOT" worktree add -f "$WORK" HEAD >/dev/null 2>&1 \
  || { echo "cannot create worktree at $WORK" >&2; exit 2; }
trap 'git -C "$ROOT" worktree remove --force "$WORK" >/dev/null 2>&1 || true' EXIT
git -C "$WORK" reset --hard -q HEAD
git -C "$WORK" clean -fdq

PROMPT=$(cat "$TASK_FILE")
# Konoha mode differs only by this activation prefix; the task text stays byte-identical.
[ "$MODE" = konoha ] && PROMPT="/konoha $PROMPT"

mkdir -p "$OUT"
cp "$TASK_FILE" "$OUT/prompt.txt"

START=$(date +%s)
set +e
(cd "$WORK" && claude -p "$PROMPT" \
  --model "$BENCH_MODEL" \
  --output-format json \
  --permission-mode acceptEdits \
  --allowedTools "Read,Edit,Write,Grep,Glob,Bash,Task,TodoWrite" \
  > "$OUT/log.json" 2> "$OUT/stderr.txt")
EXIT=$?
set -e
END=$(date +%s)

printf 'task=%s\nmode=%s\nrun=%s\nmodel=%s\ngit_sha=%s\nduration_seconds=%s\nclaude_exit=%s\n' \
  "$TASK_ID" "$MODE" "$RUN" "$BENCH_MODEL" "$(git -C "$ROOT" rev-parse HEAD)" "$((END - START))" "$EXIT" \
  > "$OUT/meta.txt"
# Stage everything so new (untracked) files appear in the patch; the worktree is
# throwaway, so mutating its index is safe.
git -C "$WORK" add -A
git -C "$WORK" status --short > "$OUT/status.txt"
git -C "$WORK" diff --cached --stat > "$OUT/diff_stat.txt"
git -C "$WORK" diff --cached > "$OUT/diff.patch"

echo "-> $OUT"