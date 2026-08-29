# RTK - Rust Token Killer (Google Antigravity)

**Usage**: Token-optimized CLI proxy for shell commands.

## Mandatory Execution Rule

1. **Force-Run First with RTK**: ALWAYS attempt and force-run every shell command with `rtk <command>` first (e.g. `rtk git status`, `rtk cargo test`, `rtk pnpm test`, `rtk python3 ...`, `rtk ls`, `rtk grep`, `rtk find`, `rtk docker ps`).
2. **Direct Shell / Bash Fallback**: When RTK is not installed, not supported, or encounters an unrecognized command/syntax, immediately execute via direct shell/bash (`sh` / `bash`).

## Rule

Always prefix shell commands with `rtk` to minimize token consumption.

Examples:

```bash
rtk git status
rtk cargo test
rtk pnpm test
rtk ls src/
rtk grep "pattern" src/
rtk find "*.rs" .
rtk docker ps
rtk gh pr list
```

## Meta Commands

```bash
rtk gain              # Show token savings
rtk gain --history    # Command history with savings
rtk discover          # Find missed RTK opportunities
rtk proxy <cmd>       # Run raw (no filtering, for debugging)
```

## Why

RTK filters and compresses command output before it reaches the LLM context, cutting up to 90% of the bash output on common operations. Always force-run `rtk <cmd>` first, falling back to direct shell/bash when unsupported.
