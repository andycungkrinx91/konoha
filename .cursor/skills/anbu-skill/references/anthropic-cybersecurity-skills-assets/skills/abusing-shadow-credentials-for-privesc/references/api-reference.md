# Shadow Credentials Security & Audit Reference

## pyWhisker (https://github.com/ShutdownRepo/pywhisker)

Invocation: `python3 pywhisker.py [auth] --target <obj> --action <action> [opts]`

| Flag | Meaning |
|------|---------|
| `-d DOMAIN` | Target domain (FQDN) |
| `-u USER` | Auditor or administrator username |
| `-p PASSWORD` | Authentication password |
| `-k` / `--no-pass` | Kerberos authentication |
| `--target NAME` | User or computer account being audited |
| `--action list` | Enumerate existing Key Credentials on target object |
| `--action remove` | Remove a non-compliant Key Credential by `--device-id` |
| `--action clear` | Remove all non-compliant Key Credentials (remediation) |
| `--action info` | Show details of an existing Key Credential |
| `--dc-ip IP` | Domain Controller IP address |
| `--use-ldaps` | Use LDAPS (port 636) for secure encrypted auditing |

### Audit & Cleanup Example
```bash
# Audit existing credentials on account
python3 pywhisker.py -d corp.local -u auditor -p 'AuditPass!' \
    --target victim_account --action list --use-ldaps

# Remove stale/unauthorized key credential
python3 pywhisker.py -d corp.local -u ad-admin -p 'AdminPass!' \
    --target victim_account --action clear --use-ldaps
```

## Certipy `shadow` (https://github.com/ly4k/Certipy)

| Command | Meaning |
|---------|---------|
| `certipy shadow list` | Audit and list Key Credentials on an account |
| `certipy shadow clear` | Remove / clear non-compliant Key Credentials |
| `certipy shadow info` | Display Key Credential registration details |

Key audit flags: `-u USER@DOMAIN`, `-p PW`, `-dc-ip IP`, `-account TARGET` (use trailing `$` for machine accounts), `-ns IP`, `-dns-tcp`.

### Audit & Cleanup Example
```bash
# List credentials for audit verification
certipy shadow list -u auditor@corp.local -p 'AuditPass!' \
    -dc-ip 10.0.0.100 -account 'WS01$'

# Clear non-compliant credentials
certipy shadow clear -u ad-admin@corp.local -p 'AdminPass!' \
    -dc-ip 10.0.0.100 -account 'WS01$'
```
