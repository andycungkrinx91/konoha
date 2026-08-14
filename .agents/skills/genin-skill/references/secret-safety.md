# Secret Safety

Use this reference when requests involve environment files, credentials, auth, tokens, API keys, CI/CD secrets, kubeconfig, Terraform variables, logs, or config files.

## Rules

- Never print raw secrets.
- Never paste `.env` values.
- Redact tokens, passwords, cookies, private keys, API keys.
- Keep environment variable names ASCII unless an existing user-provided key intentionally uses Unicode; never rewrite secret values, only redact them.
- Do not hardcode secrets in code.
- Use environment variables or secret managers.
- Keep client-side/public env vars separate from server-only secrets.
- Do not log sensitive values.
- Do not commit secrets.
- Review `.gitignore` and CI secret handling when relevant.
- Use least privilege for credentials.
- Rotate exposed credentials if secrets were leaked.

## Code exploration secret notes

- Search config/auth/log files by key names or filenames; do not print values.
- Do not dump credential files, `.env`, kubeconfig, SSH keys, cloud credentials, cookie jars, or logs containing tokens.
- Redact secrets found during search as `***REDACTED***` and report only file path, key name, and remediation.

## Redaction examples

Use:
- `API_KEY=***REDACTED***`
- `password=***REDACTED***`
- `Authorization: Bearer ***REDACTED***`

Do not show the real values.
