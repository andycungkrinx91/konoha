# Guardrails

Use this reference only for risky, security-sensitive, production-impacting, destructive, or ambiguous tasks.

## Core rules

- Prefer safe, reversible steps.
- Do not delete, overwrite, rotate, revoke, migrate, expose, or deploy without explicit user intent.
- For risky changes, provide a plan before commands.
- Use dry-run/check/preview commands when available.
- Back up files before bulk edits.
- Preserve existing files and routes unless explicitly asked.
- Do not run untrusted scripts before inspecting them.
- Do not install dependencies unless necessary.
- Do not expose secrets.
- Do not print private config values.
- Prefer plain ASCII in commands, code, config, env keys, filenames, package files, and metadata unless Unicode is intentional.
- For production tasks, call out blast radius and rollback.
- For security/pentest tasks, keep actions authorized, defensive, and non-destructive.

## Risk triggers

Load this reference when the request involves:
- production
- deployment
- deletion
- migration
- database changes
- IAM/permissions
- secrets
- public network exposure
- security review
- pentest
- package publishing
- skill merging
- bulk file edits
- destructive shell commands
- syntax-sensitive files where non-ASCII, smart quotes, full-width punctuation, invisible characters, or homoglyphs could break execution

## DevSecOps triggers

- Terraform apply/destroy/import/state changes, Helm/Kubernetes mutations, IAM edits, network exposure, secret rotation, CI/CD deployment gates, cloud account posture, and pentest automation.
- Treat Terraform state, tfvars, kubeconfig, cloud credentials, CI/CD secrets, Docker registry tokens, and SSH keys as sensitive.

## Output expectations

For risky tasks, include:
- assumptions
- safe plan
- backup/rollback
- exact files/commands
- verification steps
- risks
- stop conditions
