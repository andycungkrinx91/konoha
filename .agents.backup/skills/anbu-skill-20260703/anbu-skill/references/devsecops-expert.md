# DevSecOps Expert

> Read when: threat modeling, secure SDLC, cloud/container/K8s hardening, secrets management, supply chain security, vulnerability scanning, incident response, or security reviews.

## Threat Modeling

### Workflow
1. **Scope** — define system boundaries, data flows, trust boundaries.
2. **Identify** — enumerate threats using STRIDE or attack trees.
3. **Assess** — rate risk: `likelihood × impact`.
4. **Mitigate** — design controls for high-risk threats.
5. **Validate** — verify mitigations through testing.
6. **Document** — record model, decisions, residual risk.

### STRIDE Framework

| Threat | Mitigation |
|---|---|
| **S**poofing | MFA, strong auth, OIDC |
| **T**ampering | Input validation, TLS, signing |
| **R**epudiation | Audit logs, tamper-proof logging |
| **I**nformation Disclosure | Encryption, error handling |
| **D**enial of Service | Rate limiting, autoscaling, WAF |
| **E**levation of Privilege | RBAC, least privilege, deny-by-default |

### Attack Surface Analysis

| Surface | Key Threats |
|---|---|
| Public APIs | Injection, auth bypass, rate abuse |
| Web UI | XSS, CSRF, file traversal |
| Auth | Credential stuffing, token theft |
| Data stores | SQL injection, unauthorized access |
| Infrastructure | Privilege escalation, SSRF |
| Dependencies | Supply chain attacks, CVEs |
| Internal services | Lateral movement, data exfiltration |

## Secure Design Principles

- **Least privilege**: minimal permissions for all accounts and workloads.
- **Defense in depth**: multiple security layers, never rely on one.
- **Zero trust**: verify every request, assume breach.
- **Fail closed**: deny by default, allow explicitly.
- **Separation of duties**: no single person/system has full access.
- **Minimize attack surface**: disable unused features, ports, services.

## Container Security

### Build-Time
- Enforce `distroless` or `scratch` base images exclusively for production.
- Multi-stage builds excluding build tools.
- Non-root user (`USER nonroot`).
- Scan for vulnerabilities before push.
- Sign with Cosign. Generate SBOMs.

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force
COPY . .
RUN npm run build

FROM gcr.io/distroless/nodejs20-debian12:nonroot
COPY --from=builder --chown=nonroot:nonroot /app/dist /app/dist
COPY --from=builder --chown=nonroot:nonroot /app/node_modules /app/node_modules
WORKDIR /app
USER nonroot
CMD ["node", "dist/main.js"]
```

### Runtime (Kubernetes)
```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 65534
  readOnlyRootFilesystem: true
  allowPrivilegeEscalation: false
  capabilities:
    drop: [ALL]
  seccompProfile:
    type: RuntimeDefault
```

## Kubernetes Security

- **Pod Security Standards**: enforce `restricted` mode.
- **Network Policies**: deny-by-default, allow explicit traffic.
- **RBAC**: namespace-scoped roles, avoid `cluster-admin` for apps.
- **Admission Controllers**: Kyverno or OPA for policy enforcement.
- **Runtime Monitoring**: Falco for anomaly detection.
- **Service Account**: `automountServiceAccountToken: false` unless needed.

### Network Policy Example
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: deny-all-default }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
```

## Secrets Management

### Rules
- Never hardcode secrets in code, config, or Docker images.
- **Strictly ban** the use of `.env` files in production environments or baked into images.
- Never log secrets. Mask in CI output.
- Rotate regularly (90-day max for static credentials).
- Use separate secrets per environment.
- Encrypt at rest and in transit. Audit access.

### Tools
| Context | Tool |
|---|---|
| Development | `.env.local` (never committed, strictly dev-only) |
| CI/CD | GitHub Secrets, CI vault |
| Production/K8s | External Secrets Operator, HashiCorp Vault, AWS/GCP Secret Manager |
| Pre-commit | gitleaks, detect-secrets |

### External Secrets Operator
```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata: { name: app-secrets }
spec:
  refreshInterval: 1h
  secretStoreRef: { name: vault-backend }
  data:
    - secretKey: db-password
      remoteRef: { key: app/database, property: password }
```

## Supply Chain Security (SLSA)

| Level | Requirements |
|---|---|
| L1 | Document build process, generate provenance |
| L2 | Hosted build, authenticated provenance |
| L3 | Non-falsifiable provenance, no build secrets |
| L4 | Two-person review, hermetic builds |

### Checklist
- [ ] Artifacts signed with Cosign
- [ ] SBOM generated (SPDX/CycloneDX)
- [ ] Dependencies pinned with integrity hashes
- [ ] Ephemeral build environments
- [ ] Image signatures verified at deployment (Kyverno)
- [ ] Lock files committed and reviewed

## Vulnerability Scanning

| Tool | Scans | Stage |
|---|---|---|
| gitleaks/trufflehog | Leaked secrets | Pre-commit + CI |
| Semgrep/CodeQL | Code patterns (SAST) | CI test |
| Trivy/Grype | Container CVEs | CI build |
| Checkov/tfsec | IaC misconfigurations | CI plan |
| Snyk/npm audit | Dependency vulnerabilities | CI test |
| OWASP ZAP | Dynamic scanning (DAST) | Staging |

### Triage SLA
- Critical/High: fix within 48h.
- Medium: fix within 30d.
- Low: next sprint or accept with documentation.

## Incident Response

### Severity Levels
| Level | Impact | Response |
|---|---|---|
| SEV1 | Complete outage | Immediate |
| SEV2 | Major degradation | 15 min |
| SEV3 | Minor degradation | 1 hour |
| SEV4 | Low impact | Business hours |

### Workflow
1. Detect → 2. Assess severity → 3. Assign IC + engineer → 4. Triage (recent deploys, deps, dashboards) → 5. Mitigate (rollback/scale/hotfix) → 6. Verify 30 min → 7. Close + postmortem within 48h.

### Postmortem Rules
- Blameless — focus on systems, not people.
- Schedule within 48h. Track action items to completion.

## SRE & Observability

### Golden Signals
| Signal | Measure |
|---|---|
| Latency | p50, p95, p99 |
| Traffic | Requests/sec |
| Errors | 5xx rate |
| Saturation | CPU, memory, connections |

### SLO Targets
| Tier | Availability | Downtime/month |
|---|---|---|
| Critical | 99.99% | 4m 23s |
| Important | 99.9% | 43m 28s |
| Standard | 99.5% | 3h 37m |

### Alert Design
- Every alert links to a runbook.
- Use `for:` duration to prevent flapping.
- Use burn rate alerts over simple thresholds.
- Page-worthy: >5% user impact, SLO violation, security incident.

## Security Review Format

```
## Finding: [Title]
**Severity:** Critical | High | Medium | Low
**Location:** [file/resource/endpoint]
**Issue:** [What's wrong]
**Impact:** [What could happen]
**Fix:** [Concrete remediation]
```

Prioritize critical findings first. Give concrete fixes, not observations.

## Authentication & Authorization

| Layer | Mechanism |
|---|---|
| User auth | OIDC / OAuth 2.0 |
| API auth | JWT / API keys (short-lived) |
| Service-to-service | mTLS / SPIFFE |
| K8s workloads | Workload Identity (avoid static keys) |

Rules:
- Never roll your own auth. Use established providers.
- Short-lived access tokens (15min) with refresh.
- Validate JWTs server-side (signature, expiry, issuer, audience).
- Rate-limit auth endpoints aggressively.
- Log all auth events.

## Cryptography

| Use Case | Algorithm |
|---|---|
| Symmetric | AES-256-GCM |
| Hashing | SHA-256 / SHA-3 (never MD5/SHA-1) |
| Password | bcrypt / argon2id |
| Signing | Ed25519 / ECDSA P-256 |
| TLS | TLS 1.3 |

Never implement your own crypto. Use constant-time comparison. Store keys in HSM or Vault.
