---
name: abusing-shadow-credentials-for-privesc
description: Audit, detect, and remediate Shadow Credentials misconfigurations on msDS-KeyCredentialLink in Active Directory. Focuses on access-controls, monitoring Event ID 5136, and credential-management hygiene.
domain: cybersecurity
subdomain: identity-security
tags:
- identity-defense
- active-directory
- shadow-credentials
- access-control
- monitoring
- credential-hygiene
- audit
version: '1.0'
author: mahipal
license: Apache-2.0
nist_csf:
- PR.AC-01
- PR.AC-04
- PR.AA-05
- DE.CM-01
- DE.CM-03
mitre_attack:
- T1098.005
---
# Auditing and Remediating Shadow Credentials in Active Directory

> **Security Advisory:** This guide provides defense and audit procedures for identifying, monitoring, and remediating overly permissive write access to `msDS-KeyCredentialLink` (Shadow Credentials) in Active Directory environments.

## Overview

The **Shadow Credentials** attack vector stems from misconfigured Active Directory Access Control Lists (ACLs) where non-administrative principals possess write permissions over the `msDS-KeyCredentialLink` attribute of user or computer accounts. This attribute normally stores raw public keys ("Key Credentials") used by Windows Hello for Business and Microsoft Entra ID device registration for passwordless PKINIT Kerberos authentication.

When access permissions are too permissive — such as unconstrained `GenericWrite`, `GenericAll`, `WriteProperty`, or `AddKeyCredentialLink` Access Control Entries (ACEs) — an unauthorized principal could append a key credential to an account, bypass password controls, and obtain Kerberos tickets.

Defending against this vulnerability requires establishing strict **access-controls**, enabling granular **directory service auditing**, and maintaining proactive **credential-management hygiene** across all directory objects.

## When to Use

- When auditing Active Directory Discretionary Access Control Lists (DACLs) for excessive write privileges.
- When configuring Windows Security Event logging and SIEM correlation rules for directory modifications.
- When performing identity security posture assessments and tiering model reviews.
- When cleaning up legacy or unauthorized key credentials from Active Directory objects.
- When establishing least-privilege controls for hybrid identity and device registration service accounts.

## Prerequisites

- Read access to Active Directory objects via LDAP / LDAPS (ports 389 / 636).
- Domain administrator or delegated audit privileges to inspect and remediate DACLs.
- Domain Controllers running Windows Server 2016 or later with Advanced Audit Policy configured.
- Audit tooling installed in a secure administrative workstation:
  ```bash
  # Python ldap3 or pyWhisker for attribute enumeration
  python3 -m pip install ldap3
  # Certipy for certificate template and key credential auditing
  pipx install certipy-ad
  ```

## Objectives

- Audit and identify accounts with permissive write ACEs on `msDS-KeyCredentialLink`.
- Enumerate existing Key Credentials on sensitive user and computer objects.
- Configure Windows Event ID 5136 auditing to detect unauthorized attribute modifications.
- Clean up orphaned or unauthorized Key Credentials.
- Enforce least privilege by removing hazardous ACEs and protecting Tier-0 identities.

## MITRE ATT&CK & NIST CSF Mapping

| Framework | ID | Category / Technique | Defense Application |
|---|---|---|---|
| MITRE ATT&CK | T1098.005 | Account Manipulation: Device Registration | Detect and block unauthorized modification of `msDS-KeyCredentialLink` |
| NIST CSF | PR.AC-01 | Access Control Management | Restrict write permissions over identity attributes to authorized registration agents |
| NIST CSF | DE.CM-01 | Network / Directory Monitoring | Monitor directory changes for anomalous key additions |

## Defense & Remediation Workflow

### Step 1: Audit Permissive Access Rights (Access Controls)
Identify which non-administrative principals have write access to sensitive user and computer objects. Query AD for dangerous ACEs (`GenericAll`, `GenericWrite`, `WriteProperty` targeting `msDS-KeyCredentialLink` schema GUID `{5b47d60f-6090-40b2-9f37-2a4de45f306e}`).

```bash
# Audit existing Key Credentials on target object without modifications
python3 pywhisker.py -d "corp.local" -u "auditor" -p "AuditPass!" \
    --target "target-account" --action "list" --use-ldaps
```

### Step 2: Enforce Directory Service Auditing (Monitoring)
Enable Advanced Audit Policy Configuration on all Domain Controllers to log attribute-level changes:
- Path: `Computer Configuration -> Policies -> Windows Settings -> Security Settings -> Advanced Audit Policy Configuration -> Audit Policies -> DS Access -> Audit Directory Service Changes` (Set to **Success and Failure**).

Configure the SACL on high-value Organizational Units (OUs) to generate **Event ID 5136**:
- **Event ID 5136**: Directory Service Object Modified
- **Attribute Name**: `msDS-KeyCredentialLink`
- **Operation Type**: `Value Added` (indicates new credential registration)

Set up SIEM alerts for Event ID 5136 where `SubjectUserName` is not a designated Azure AD Connect sync account or authorized device enrollment service principal.

### Step 3: Remove Unauthorized Key Credentials (Credential Hygiene)
If an unknown or stale Key Credential is discovered during the audit, remove it immediately to prevent unauthorized authentication:

```bash
# Remove specific unauthorized Key Credential by Device ID
python3 pywhisker.py -d "corp.local" -u "ad-admin" -p "AdminPass!" \
    --target "target-account" --action "remove" --device-id "<DEVICE-ID>" --use-ldaps

# Alternatively, clear all non-compliant credentials using Certipy
certipy shadow clear -u 'ad-admin@corp.local' -p 'AdminPass!' \
    -dc-ip 10.0.0.100 -account 'target-account'
```

### Step 4: Remediate ACL Permissions (Least Privilege)
Strip any non-system write permissions targeting `msDS-KeyCredentialLink`:
1. Open Active Directory Users and Computers (with Advanced Features enabled).
2. Inspect the **Security** tab of the affected object or parent OU.
3. Remove `GenericAll`, `GenericWrite`, and `Write msDS-KeyCredentialLink` permissions from all non-administrative users and groups.
4. Add high-value accounts (Domain Admins, Enterprise Admins) to the `Protected Users` security group, which restricts delegation and forces Kerberos hardening.

## Detection Rules & SIEM Correlation

```yaml
title: Unauthorized msDS-KeyCredentialLink Modification (Shadow Credentials)
id: 5b47d60f-6090-40b2-9f37-2a4de45f306e
status: stable
description: Detects modification of the msDS-KeyCredentialLink attribute by non-whitelisted principals.
logsource:
  product: windows
  service: security
detection:
  selection:
    EventID: 5136
    AttributeLDAPDisplayName: 'msDS-KeyCredentialLink'
    OperationType: 'Value Added'
  filter_sync_accounts:
    SubjectUserName|endswith:
      - '$'
      - 'MSOL_*'
      - 'AAD_*'
  condition: selection and not filter_sync_accounts
level: high
```

## Validation & Verification Checklist

- [ ] Directory Service Object Change auditing verified on all Domain Controllers.
- [ ] SIEM rule for Event ID 5136 with `msDS-KeyCredentialLink` active and alerting.
- [ ] Tier-0 and sensitive accounts audited for anomalous Key Credentials.
- [ ] Discretionary ACLs sanitized; extraneous `WriteProperty` and `GenericWrite` ACEs removed.
- [ ] Device registration delegation restricted to approved Microsoft Entra ID Sync service accounts.
