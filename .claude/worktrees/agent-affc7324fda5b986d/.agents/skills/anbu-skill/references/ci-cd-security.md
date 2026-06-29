# CI/CD Security

> Read when: securing GitHub Actions/GitLab CI pipelines, image scanning, dependency scanning, artifact signing, OIDC, or deployment gates.

## Pipeline Security Principles

- Every pipeline: lint → test → security scan → build → deploy.
- Production deploys require explicit approval (environment protection rules).
- **Strictly pin** action versions to SHA hashes — never `@latest` or major versions (`@v4`).
- Use `permissions:` to restrict `GITHUB_TOKEN` scope.
- Never expose secrets in logs — use `::add-mask::`.
- **Enforce OIDC** exclusively for cloud auth — long-lived static credentials are banned.
- **Mandate SLSA Level 3+** provenance (SBOM generation and Cosign artifact signing).

## Secure GitHub Actions Pipeline

```yaml
name: Security Pipeline
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

permissions:
  contents: read
  security-events: write

jobs:
  secret-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: trufflesecurity/trufflehog@v3.63.0
        with: { path: ./, extra_args: --fail --json }

  sast:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: semgrep/semgrep-action@v1
        with: { config: p/security-audit }

  sca:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/dependency-review-action@v4
        with: { fail-on-severity: high }

  container-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t app:${{ github.sha }} .
      - uses: aquasecurity/trivy-action@0.16.1
        with:
          image-ref: app:${{ github.sha }}
          severity: 'CRITICAL,HIGH'
          exit-code: '1'
      - uses: anchore/sbom-action@v0.15.0
        with: { image: "app:${{ github.sha }}", format: spdx-json }

  sign-attest:
    needs: [secret-scan, sast, sca, container-scan]
    if: github.ref == 'refs/heads/main'
    permissions: { id-token: write, packages: write }
    runs-on: ubuntu-latest
    steps:
      - uses: sigstore/cosign-installer@v3
      - run: cosign sign --yes ghcr.io/${{ github.repository }}:${{ github.sha }}

  deploy-production:
    needs: sign-attest
    runs-on: ubuntu-latest
    environment: production  # Requires approval
    steps:
      - run: kubectl set image deployment/app app=ghcr.io/${{ github.repository }}:${{ github.sha }}
```

## OIDC to Cloud Providers

Avoid long-lived credentials. Use OIDC:

```yaml
# AWS
permissions: { id-token: write, contents: read }
steps:
  - uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: arn:aws:iam::123456789:role/github-actions
      aws-region: us-east-1

# GCP
steps:
  - uses: google-github-actions/auth@v2
    with:
      workload_identity_provider: projects/123/locations/global/workloadIdentityPools/github/providers/github
      service_account: deploy@project.iam.gserviceaccount.com

# Azure
steps:
  - uses: azure/login@v2
    with:
      client-id: ${{ secrets.AZURE_CLIENT_ID }}
      tenant-id: ${{ secrets.AZURE_TENANT_ID }}
      subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
```

## Performance Patterns

### Incremental Scanning
```yaml
- name: Get changed files
  id: changed
  run: |
    echo "files=$(git diff --name-only HEAD~1 | grep -E '\.(py|js|ts)$' | tr '\n' ' ')" >> $GITHUB_OUTPUT
- name: Scan changed files only
  if: steps.changed.outputs.files != ''
  run: semgrep --config auto ${{ steps.changed.outputs.files }}
```

### Parallel Gates
Run all security scans in parallel. Only deploy needs all gates:
```yaml
deploy:
  needs: [sast, sca, container-scan, secret-scan]
```

### Cache Vulnerability DBs
```yaml
- uses: actions/cache@v4
  with:
    path: ~/.cache/trivy
    key: trivy-db-${{ github.run_id }}
    restore-keys: trivy-db-
```

### Docker Layer Caching
```yaml
- uses: docker/build-push-action@v5
  with:
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

## Secrets Handling in CI

- Use GitHub Secrets / GitLab CI variables (masked, protected).
- Never echo secrets. Use `::add-mask::` for dynamic values.
- Rotate CI secrets on schedule or compromise.
- Use OIDC instead of static cloud credentials.
- Separate secrets per environment (dev/staging/prod).

## Artifact Signing & SBOM

```bash
# Sign with Cosign (keyless via OIDC)
cosign sign --yes ghcr.io/org/app:v1.0.0

# Generate SBOM
syft packages ghcr.io/org/app:v1.0.0 -o spdx-json > sbom.json

# Verify signature
cosign verify ghcr.io/org/app:v1.0.0
```

## Branch Protection

- Require PR reviews (≥1 reviewer).
- Require status checks to pass (security gates).
- Require signed commits for production branches.
- No force push to main/production.
- Restrict who can merge to production.

## Deployment Strategies

| Strategy | Use When | Rollback |
|---|---|---|
| Rolling | Standard, mixed versions OK | Health check auto-rollback |
| Blue-Green | Zero downtime, instant rollback | Switch traffic |
| Canary | Gradual rollout, risk mitigation | Scale down canary |
| Recreate | Breaking changes, stateful apps | Redeploy previous |

## GitLab CI Security

```yaml
stages: [validate, security, build, deploy]

checkov-scan:
  stage: security
  image: bridgecrew/checkov:latest
  script:
    - checkov --directory terraform/ --hard-fail-on HIGH,CRITICAL

trivy-scan:
  stage: security
  image: aquasec/trivy:latest
  script:
    - trivy image --severity HIGH,CRITICAL --exit-code 1 $IMAGE
```

## CI/CD Security Checklist

- [ ] Actions/runners strictly pinned to SHA hashes
- [ ] `permissions:` restricted (no default `write-all`)
- [ ] OIDC used exclusively for cloud auth (static credentials banned)
- [ ] Secrets never echoed or exposed in logs
- [ ] Security gates block deploy on failure
- [ ] Container images scanned before push
- [ ] SLSA Level 3+ enforced (SBOM generated, Cosign signed)
- [ ] Artifacts signed (Cosign/Sigstore)
- [ ] Branch protection enforced
- [ ] Production deploy requires approval
- [ ] Dependency scanning enabled (Dependabot/Renovate)
- [ ] Docker layer caching for performance
- [ ] Parallel security jobs (not sequential)
