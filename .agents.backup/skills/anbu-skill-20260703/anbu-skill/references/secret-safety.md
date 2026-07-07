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

## DevSecOps secret notes

- Terraform: protect `*.tfvars`, state files, backend credentials, and sensitive outputs.
- Kubernetes: protect kubeconfig, service-account tokens, Secrets manifests, and sealed-secret keys.
- Cloud: protect AWS/Azure/GCP credentials, OIDC trust, role assumption config, and IAM keys.
- CI/CD: protect repository/environment secrets, deploy keys, Docker registry tokens, and signing keys.
- SSH/private keys must never be printed or committed.

## Redaction examples

Use:
- `API_KEY=***REDACTED***`
- `password=***REDACTED***`
- `Authorization: Bearer ***REDACTED***`

Do not show the real values.
