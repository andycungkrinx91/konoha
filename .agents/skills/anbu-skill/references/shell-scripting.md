# Shell Scripting

> Read when: writing Bash/shell scripts, deployment automation, diagnostic scripts, backup scripts, cron jobs, or safe CLI commands.

## Script Template

Every production script starts with this foundation:

```bash
#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_NAME="$(basename "$0")"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly TMP_DIR="$(mktemp -d)"

cleanup() {
  local exit_code=$?
  rm -rf "$TMP_DIR"
  if [[ $exit_code -ne 0 ]]; then
    echo "ERROR: $SCRIPT_NAME failed with exit code $exit_code" >&2
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

require_cmd() {
  if ! command -v "$1" &>/dev/null; then
    echo "ERROR: required command '$1' not found" >&2
    exit 1
  fi
}

main() {
  # Your logic here
  echo "Running $SCRIPT_NAME from $SCRIPT_DIR"
}

main "$@"
```

## Key Principles

1. **`set -euo pipefail`** — exit on error, unset vars, pipe failures.
2. **Quote everything** — `"$var"`, `"$@"`, `"${array[@]}"`. Always.
3. **Check dependencies upfront** — `require_cmd` before destructive work.
4. **Use functions** — `main()` pattern, `local` variables, clear names.
5. **Prefer built-ins** — `[[ ]]` over `[ ]`, `${var##*/}` over `basename`, `printf` over `echo`.

## Argument Parsing

```bash
usage() {
  cat >&2 <<EOF
Usage: $SCRIPT_NAME [OPTIONS] <input>
  -o, --output <dir>   Output directory (default: ./out)
  -v, --verbose        Enable verbose logging
  -n, --dry-run        Preview without executing
  -h, --help           Show this help
EOF
  exit "${1:-0}"
}

OUTPUT_DIR="./out"
VERBOSE=false
DRY_RUN=false

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -o|--output)  OUTPUT_DIR="$2"; shift 2 ;;
      -v|--verbose) VERBOSE=true; shift ;;
      -n|--dry-run) DRY_RUN=true; shift ;;
      -h|--help)    usage 0 ;;
      --)           shift; break ;;
      -*)           echo "ERROR: unknown option '$1'" >&2; usage 1 ;;
      *)            break ;;
    esac
  done
  INPUT_FILE="${1-}"
  [[ -n "$INPUT_FILE" ]] || { echo "ERROR: input file required" >&2; usage 1; }
}

parse_args "$@"
```

## Logging

```bash
setup_colors() {
  if [[ -t 1 ]]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
  else
    RED=''; GREEN=''; YELLOW=''; RESET=''
  fi
}
setup_colors

log_info()  { printf "${GREEN}[INFO]${RESET}  %s\n" "$*"; }
log_warn()  { printf "${YELLOW}[WARN]${RESET}  %s\n" "$*" >&2; }
log_error() { printf "${RED}[ERROR]${RESET} %s\n" "$*" >&2; }
```

## File Operations

```bash
# Read line by line safely
while IFS= read -r line; do
  echo "Processing: $line"
done < "$input_file"

# Read into array (bash 4+)
mapfile -t lines < "$input_file"

# Atomic write
write_atomic() {
  local target="$1" tmp
  tmp="$(mktemp "${target}.XXXXXX")"
  cat > "$tmp"
  mv "$tmp" "$target"
}
```

## String Operations (No External Tools)

```bash
path="/usr/local/bin/myapp"
echo "${path##*/}"        # "myapp"     (basename)
echo "${path%/*}"         # "/usr/local/bin" (dirname)

str="hello world"
echo "${str:6:5}"         # "world"
echo "${str,,}"           # lowercase (bash 4+)
echo "${str^^}"           # UPPERCASE

[[ "$str" == hello* ]]    # starts with
[[ -z "$var" ]]           # empty check
```

## Parallel Execution

```bash
# xargs with parallelism
find . -name "*.log" -print0 | xargs -0 -P4 -I{} gzip "{}"

# Background jobs with wait
pids=()
for host in "${hosts[@]}"; do
  ssh "$host" uptime &
  pids+=($!)
done
for pid in "${pids[@]}"; do
  wait "$pid" || log_warn "job $pid failed"
done
```

## Dry-Run Pattern

```bash
run_cmd() {
  if [[ "$DRY_RUN" == true ]]; then
    log_info "[DRY RUN] Would execute: $*"
  else
    "$@"
  fi
}

# Usage
run_cmd kubectl apply -f deployment.yaml
run_cmd rm -rf "$TEMP_DIR"
```

## Confirmation Pattern

```bash
confirm() {
  local prompt="${1:-Continue?} [y/N] "
  local reply
  read -r -p "$prompt" reply
  [[ "${reply,,}" == y || "${reply,,}" == yes ]]
}

confirm "Delete all backups older than 30 days?" || exit 0
```

## Retry Pattern

```bash
retry() {
  local n="$1" delay="${2:-2}"; shift 2
  local i
  for (( i=1; i<=n; i++ )); do
    "$@" && return 0
    log_warn "Attempt $i/$n failed. Retrying in ${delay}s..."
    sleep "$delay"
  done
  return 1
}
retry 3 2 curl -sf https://example.com/health
```

## Gotchas

1. **`local var=$(cmd)`** — always returns 0. Declare `local var` first, then `var=$(cmd)`.
2. **`set -e` in conditionals** — `if cmd; then` does NOT trigger `-e` on failure. Intentional.
3. **`mktemp` without `-d`** — creates a file, not a directory.
4. **Trap fires in subshells** — test `$BASH_SUBSHELL` inside trap if needed.
5. **`${arr[*]}` vs `${arr[@]}`** — `*` joins, `@` preserves words. Use `"${arr[@]}"`.

## Anti-Patterns

| Anti-Pattern | Fix |
|---|---|
| Missing `set -euo pipefail` | Add as second line |
| Unquoted `rm -rf $dir` | Quote: `rm -rf "$dir"` |
| Parsing `ls` output | Use `find -print0 \| xargs -0` |
| `cat file \| grep` | `grep pattern file` |
| Piping remote scripts to shell | Download, review, then execute |
| `echo -e` | Use `printf` (portable) |

## Dangerous Command Safeguards

For destructive commands, always:
1. Add `--dry-run` support.
2. Confirm with the user before execution.
3. Log what will be deleted/changed before doing it.
4. Back up state before modification.
5. Never run `rm -rf /` or similar without explicit path validation.

## Output Format

Scripts should be copy-paste-ready with:
- File path as comment at top
- Shebang line
- Inline documentation for non-obvious logic
- Usage function for any script taking arguments
