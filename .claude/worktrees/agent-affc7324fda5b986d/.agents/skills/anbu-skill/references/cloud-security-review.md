# Cloud Security Review

> Read when: performing cross-cloud security reviews, cloud posture assessments, compliance audits, or infrastructure security findings.

## Review Methodology

1. **Scope** — identify cloud accounts, regions, services in scope.
2. **Discover** — enumerate resources, configurations, access patterns.
3. **Assess** — check against security domains below.
4. **Report** — document findings with severity, impact, and fix.
5. **Remediate** — prioritize by severity, track to completion.

## Security Domains

### 1. Identity & IAM
- [ ] Strictly ban wildcard permissions (`*`) on any IAM policy
- [ ] Service accounts use least privilege, specific roles
- [ ] Workload Identity (GCP) / IRSA (AWS) / Managed Identity (Azure) over static keys
- [ ] MFA enforced for human accounts
- [ ] No unused service accounts or access keys
- [ ] Key rotation policies in place
- [ ] Cross-account/project access minimized and audited

### 2. Network Exposure
- [ ] Default deny on security groups / firewall rules / NSGs
- [ ] No 0.0.0.0/0 ingress on non-public ports
- [ ] Databases and internal services on private subnets only
- [ ] Private endpoints / Private Link for managed services
- [ ] TLS everywhere (no plaintext internal traffic in production)
- [ ] WAF on public-facing endpoints
- [ ] VPC flow logs / NSG flow logs enabled

### 3. Secrets & Credentials
- [ ] No hardcoded secrets in code, config, IaC, or CI/CD
- [ ] `.env` files strictly banned from production environments
- [ ] Secrets stored in cloud secret manager or Vault
- [ ] Rotation policies enforced
- [ ] Secrets not logged or exposed in error messages
- [ ] CI/CD uses OIDC, not static credentials

### 4. Encryption
- [ ] Data encrypted at rest (storage, databases, volumes)
- [ ] Customer-managed keys (CMK) for sensitive workloads
- [ ] TLS 1.2+ for data in transit
- [ ] Key management via KMS / Key Vault / Cloud KMS

### 5. Logging & Auditing
- [ ] Cloud audit logs enabled (CloudTrail / Cloud Audit / Activity Log)
- [ ] Logs shipped to centralized SIEM / log analytics
- [ ] Log retention meets compliance requirements
- [ ] Alert on suspicious activity (root login, policy changes, unusual API calls)
- [ ] No sensitive data in logs (PII, secrets, tokens)

### 6. Backups & Recovery
- [ ] Automated backups for databases and critical storage
- [ ] Backup retention meets RPO requirements
- [ ] Restore procedure tested
- [ ] Cross-region backups for disaster recovery

### 7. Public Access
- [ ] No unintended public S3 buckets / GCS buckets / Blob containers
- [ ] No public database endpoints
- [ ] No public Kubernetes API server (or restricted to known IPs)
- [ ] Container registries private (or restricted pull access)

### 8. Kubernetes & Container Posture
- [ ] Pod Security Standards enforced (restricted)
- [ ] Network Policies (deny-by-default)
- [ ] RBAC least privilege (no app cluster-admin)
- [ ] Container images scanned and signed
- [ ] No privileged containers or host mounts
- [ ] Resource limits set on all workloads
- [ ] Admission controllers active (Kyverno/OPA)

### 9. CI/CD Risks
- [ ] Pipeline credentials scoped and short-lived
- [ ] Security gates block vulnerable deploys
- [ ] Actions/runners pinned to SHA
- [ ] No secret leakage in build logs

### 10. Terraform State Risks
- [ ] State stored remotely with encryption
- [ ] State locking enabled (DynamoDB / GCS / Azure Blob)
- [ ] State file not in version control
- [ ] Sensitive outputs marked `sensitive = true`
- [ ] State access restricted to authorized principals

## Finding Severity Levels

| Severity | Criteria | SLA |
|---|---|---|
| **Critical** | Active exploitation risk, data exposure, full access | Fix within 24h |
| **High** | Exploitable vulnerability, significant blast radius | Fix within 48h |
| **Medium** | Potential risk, requires specific conditions | Fix within 30d |
| **Low** | Minor risk, defense-in-depth improvement | Next sprint |
| **Informational** | Best practice recommendation, no immediate risk | Backlog |

## Finding Report Template

```
## Finding: [Title]
**Severity:** Critical | High | Medium | Low | Informational
**Cloud:** AWS | Azure | GCP
**Service/Resource:** [specific resource]
**Location:** [account/project/region/resource ID]

### Issue
[What's wrong — be specific]

### Impact
[What could happen if exploited]

### Evidence
[CLI output, screenshot, or config snippet]

### Remediation
[Concrete fix — IaC code, CLI command, or console steps]

### Verification
[How to confirm the fix worked]
```

## Cross-Cloud Comparison

| Domain | AWS | Azure | GCP |
|---|---|---|---|
| IAM | IAM Policies, Roles | RBAC, Managed Identity | IAM Roles, Service Accounts |
| Secrets | Secrets Manager, SSM | Key Vault | Secret Manager |
| Encryption | KMS | Key Vault, Disk Encryption | Cloud KMS |
| Network | VPC, SG, NACL | VNet, NSG | VPC, Firewall Rules |
| Audit | CloudTrail | Activity Log | Cloud Audit Logs |
| Containers | ECR, ECS, EKS | ACR, AKS | AR, GKE, Cloud Run |
| State | S3 + DynamoDB | Azure Storage | GCS |

## Compliance Notes

| Framework | Key Requirements |
|---|---|
| SOC 2 | Access control, logging, encryption, incident response |
| GDPR | Data minimization, consent, right to erasure, breach notification (72h) |
| PCI DSS | Network segmentation, encryption, access control, logging |
| HIPAA | PHI encryption, access controls, audit trails, BAA required |
| CIS Benchmarks | Provider-specific hardening (run `prowler` / `ScoutSuite`) |
