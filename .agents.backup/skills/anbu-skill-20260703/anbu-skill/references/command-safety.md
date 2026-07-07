# Command Safety

Use this reference when generating or running shell commands, scripts, deployments, package installs, infrastructure changes, or file modifications.

## Rules

- Prefer non-destructive commands.
- Show dry-run commands when available.
- Create backups before bulk edits.
- Avoid `rm -rf` unless explicitly necessary and scoped.
- Avoid piping remote scripts to shell.
- Avoid `sudo` unless required.
- Avoid `chmod 777`.
- Avoid exposing secrets in command history.
- Validate paths before writing/deleting.
- Quote variables.
- Use ASCII hyphens, quotes, spaces, variable names, and flags in commands; avoid smart quotes, Unicode dashes, non-breaking spaces, and homoglyphs.
- Use safe shell options in scripts: `set -euo pipefail`.
- Use traps for cleanup when needed.
- Add confirmation gates for destructive operations.
- Separate inspect, plan, apply, and verify steps.

## Dangerous command triggers

Apply extra caution for:
- `rm`
- `mv` over existing files
- `chmod`
- `chown`
- `terraform apply/destroy`
- `kubectl delete/apply`
- `helm upgrade --install`
- database migrations
- secret rotation
- production deploys
- package publishing

## DevSecOps command notes

- Prefer `terraform plan`, `kubectl diff`, `helm template`, and dry-run modes before apply.
- Confirm context, namespace, account, region, and workspace before mutations.
- Never run destructive cloud/Kubernetes/database commands against production without explicit approval.

## Output format for risky commands

Use:
1. inspect
2. backup
3. dry-run/plan
4. apply
5. verify
6. rollback
