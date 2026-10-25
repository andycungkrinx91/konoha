# Standards Mapping — Auditing and Remediating Shadow Credentials in Active Directory

## MITRE ATT&CK (Enterprise)

| ID | Name | Rationale |
|----|------|-----------|
| T1098.005 | Account Manipulation: Device Registration | Detection and auditing of unauthorized modification to `msDS-KeyCredentialLink` for alternate device/certificate registration. |

Reference: https://attack.mitre.org/techniques/T1098/005/

Related defensive techniques:
- M1026 (Privileged Account Management) — Restricting permissions over identity attributes.
- M1018 (User Account Management) — Periodic review of account key credentials and least-privilege DACL enforcement.

## NIST Cybersecurity Framework 2.0

| ID | Name | Rationale |
|----|------|-----------|
| PR.AA-05 | Access permissions, entitlements, and authorizations are defined, managed, and enforced incorporating least privilege | Preventing unauthorized credential manipulation by enforcing strict access control over directory objects and removing over-permissive ACEs. |
| DE.CM-01 | Networks and physical environments are monitored to find potentially adverse events | Monitoring directory service modification events (Event ID 5136) for anomalous key additions. |

Reference: https://csrc.nist.gov/projects/cybersecurity-framework
