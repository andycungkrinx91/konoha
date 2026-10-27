# TestSSL.sh TLS/SSL Configuration Auditing Reference

TestSSL.sh is a command-line tool that checks any service on any port for support of TLS/SSL ciphers, protocols, cryptographic flaws, and vulnerabilities (such as Heartbleed, POODLE, ROBOT, DROWN).

## Source
- Skills.sh: `https://www.skills.sh/vchirrav-eng/product-security-ai-skills/tls-scan-testssl`
- Kali Linux Official: `https://www.kali.org/tools/testssl.sh/`

## When to Use
- Transport Security Assessment: verify TLS 1.2 and TLS 1.3 enforcement; identify deprecated SSLv3/TLS 1.0/TLS 1.1 protocols.
- Weak Cipher Identification: audit cipher suites for RC4, 3DES, EXPORT, or NULL encryption ciphers.
- Certificate Hygiene & Expiration: check certificate validity dates, SANs, chain order, and key lengths (RSA >= 2048, ECC >= 256).

## Konoha Sandbox Invocation
- Sandbox Required: `akatsuki-lab` (LXC or Docker container with non-host network bridge)
- Direct Host Execution: STRICTLY DENIED (fail-closed invariant)
- Binary Candidates: `testssl.sh`, `testssl`
- Target Scoping: Default `127.0.0.1:8443`
- Safety Class: `read_only`
- Timeout: 60000ms
- Evidence Outputs: `/tmp/akatsuki_testssl.json`
- Cleanup Steps: Remove `/tmp/akatsuki_testssl.*`, terminate lingering `testssl` processes

## Command Patterns
```bash
# 1. Fast TLS configuration audit with JSON output
testssl.sh --fast --jsonfile /tmp/akatsuki_testssl.json 127.0.0.1:8443

# 2. Check protocol versions, vulnerabilities, and certificates
testssl.sh -p -U -S --jsonfile /tmp/akatsuki_testssl.json 127.0.0.1:443

# 3. Check specific CVE vulnerabilities (Heartbleed, CCS, Ticketbleed)
testssl.sh -U --jsonfile /tmp/akatsuki_testssl.json 127.0.0.1:8443
```

## Fail-Closed Notes
- Testing non-local domains without written authorization is blocked.
- Container execution is mandatory to prevent local network interface leaks.
